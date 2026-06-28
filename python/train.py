"""
Forest Monitor — U-Net Semantic Segmentation Training Pipeline
python/train.py

Dataset  : assets/Forest Segmented/Forest Segmented/
Model    : EfficientNetB3 encoder + U-Net decoder
Classes  : auto-detected from mask pixel values
           (expected: 0=Background, 1=Healthy Forest,
                      2=Deforested, 3=Fire, 4=Bare Soil)
Output   : models/forest_unet.h5
           models/forest_unet_savedmodel/
           models/forest_unet_tfjs/       (TF.js export)
           outputs/predictions/           (visualisations)
           outputs/deforestation_coords.csv

Usage:
    pip install tensorflow efficientnet tensorflow-addons
         pandas numpy Pillow matplotlib scikit-learn
         tensorflowjs
    python python/train.py
    python python/train.py --epochs 50 --batch 8 --size 256
"""

import argparse
import csv
import os
import random
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# ── Runtime import checks ─────────────────────────────────────
def _require(pkg, install):
    try:
        return __import__(pkg)
    except ImportError:
        sys.exit(f"❌  Missing: {pkg}. Install with:  pip install {install}")

tf        = _require("tensorflow",   "tensorflow")
Image_mod = _require("PIL",          "Pillow")
plt_mod   = _require("matplotlib",   "matplotlib")
sklearn   = _require("sklearn",      "scikit-learn")

from PIL import Image
import matplotlib
matplotlib.use("Agg")          # headless — no display needed
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, backend as K
from sklearn.model_selection import train_test_split

# ══════════════════════════════════════════════════════════════
# PATHS  (adjust if your layout differs)
# ══════════════════════════════════════════════════════════════
ROOT        = Path(__file__).parent.parent          # project root
DATASET_DIR = ROOT / "assets" / "Forest Segmented" / "Forest Segmented"
META_CSV    = DATASET_DIR / "meta_data.csv"
IMG_DIR     = DATASET_DIR / "images"
MASK_DIR    = DATASET_DIR / "masks"
MODEL_DIR   = ROOT / "models"
OUT_DIR     = ROOT / "outputs" / "predictions"
TFJS_DIR    = ROOT / "models" / "forest_unet_tfjs"

MODEL_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── Class definitions ─────────────────────────────────────────
DEFAULT_CLASSES = {
    0: ("Background",     (64,  64,  64)),
    1: ("Healthy Forest", (34, 139,  34)),
    2: ("Deforested",     (220,  20,  60)),
    3: ("Fire Zone",      (255, 140,   0)),
    4: ("Bare Soil",      (139,  69,  19)),
}

# ══════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════
def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--epochs",     type=int,   default=40)
    p.add_argument("--batch",      type=int,   default=8)
    p.add_argument("--size",       type=int,   default=256)
    p.add_argument("--val_split",  type=float, default=0.15)
    p.add_argument("--test_split", type=float, default=0.10)
    p.add_argument("--lr",         type=float, default=1e-3)
    p.add_argument("--seed",       type=int,   default=42)
    p.add_argument("--no_tfjs",    action="store_true",
                   help="Skip TF.js export (requires tensorflowjs installed)")
    return p.parse_args()

# ══════════════════════════════════════════════════════════════
# STEP 1 — LOAD METADATA & DISCOVER CLASS COUNT
# ══════════════════════════════════════════════════════════════
def load_pairs(meta_csv, img_dir, mask_dir):
    df = pd.read_csv(meta_csv)
    print(f"\n📄  Metadata — first 5 rows:")
    print(df.head().to_string(index=False))

    pairs = []
    missing = 0
    for _, row in df.iterrows():
        img_path  = img_dir  / row["image"]
        mask_path = mask_dir / row["mask"]
        if img_path.exists() and mask_path.exists():
            pairs.append((str(img_path), str(mask_path)))
        else:
            missing += 1

    print(f"\n✅  Valid pairs found : {len(pairs)}")
    if missing:
        print(f"⚠️   Missing files     : {missing} (skipped)")
    return pairs


def detect_classes(pairs, sample_n=200, seed=42):
    """Sample up to sample_n masks and collect unique pixel values."""
    random.seed(seed)
    sample = random.sample(pairs, min(sample_n, len(pairs)))
    classes = set()
    for _, mask_path in sample:
        mask = np.array(Image.open(mask_path).convert("L"))
        classes.update(np.unique(mask).tolist())
    classes = sorted(classes)
    print(f"\n🔍  Detected mask classes (pixel values): {classes}")
    return classes


# ══════════════════════════════════════════════════════════════
# STEP 2 — DATA PIPELINE (tf.data)
# ══════════════════════════════════════════════════════════════
def build_dataset(pairs, img_size, batch_size, augment=False):
    img_paths  = [p[0] for p in pairs]
    mask_paths = [p[1] for p in pairs]

    ds = tf.data.Dataset.from_tensor_slices((img_paths, mask_paths))

    def load_pair(img_path, mask_path):
        # Image
        img = tf.io.read_file(img_path)
        img = tf.image.decode_jpeg(img, channels=3)
        img = tf.image.resize(img, [img_size, img_size])
        img = tf.cast(img, tf.float32) / 255.0

        # Mask — grayscale, integer class labels
        msk = tf.io.read_file(mask_path)
        msk = tf.image.decode_jpeg(msk, channels=1)
        msk = tf.image.resize(msk, [img_size, img_size],
                              method="nearest")
        msk = tf.cast(msk, tf.int32)
        return img, msk

    def augment_pair(img, msk):
        # Identical spatial transforms on both image and mask
        seed_val = tf.random.uniform([], 0, 2**31, dtype=tf.int32)

        # Horizontal flip
        do_flip = tf.random.uniform([]) > 0.5
        img = tf.cond(do_flip, lambda: tf.image.flip_left_right(img), lambda: img)
        msk = tf.cond(do_flip, lambda: tf.image.flip_left_right(msk), lambda: msk)

        # Vertical flip
        do_vflip = tf.random.uniform([]) > 0.5
        img = tf.cond(do_vflip, lambda: tf.image.flip_up_down(img), lambda: img)
        msk = tf.cond(do_vflip, lambda: tf.image.flip_up_down(msk), lambda: msk)

        # 90° rotation
        k = tf.random.uniform([], 0, 4, dtype=tf.int32)
        img = tf.image.rot90(img, k)
        msk = tf.image.rot90(msk, k)

        # Colour jitter (image only)
        img = tf.image.random_brightness(img, 0.15)
        img = tf.image.random_contrast(img, 0.85, 1.15)
        img = tf.image.random_saturation(img, 0.85, 1.15)
        img = tf.clip_by_value(img, 0.0, 1.0)

        return img, msk

    ds = ds.map(load_pair, num_parallel_calls=tf.data.AUTOTUNE)
    if augment:
        ds = ds.map(augment_pair, num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.batch(batch_size).prefetch(tf.data.AUTOTUNE)
    return ds


# ══════════════════════════════════════════════════════════════
# STEP 3 — MODEL: EfficientNetB3 encoder + U-Net decoder
# ══════════════════════════════════════════════════════════════
def conv_block(x, filters, name):
    x = layers.Conv2D(filters, 3, padding="same",
                      kernel_initializer="he_normal", name=f"{name}_c1")(x)
    x = layers.BatchNormalization(name=f"{name}_bn1")(x)
    x = layers.Activation("relu", name=f"{name}_r1")(x)
    x = layers.Conv2D(filters, 3, padding="same",
                      kernel_initializer="he_normal", name=f"{name}_c2")(x)
    x = layers.BatchNormalization(name=f"{name}_bn2")(x)
    x = layers.Activation("relu", name=f"{name}_r2")(x)
    return x


def upsample_block(x, skip, filters, name):
    x = layers.Conv2DTranspose(filters, 2, strides=2, padding="same",
                               name=f"{name}_up")(x)
    # Crop skip if spatial sizes differ (can happen with EfficientNet strides)
    if x.shape[1] != skip.shape[1] or x.shape[2] != skip.shape[2]:
        skip = layers.Resizing(x.shape[1], x.shape[2],
                               name=f"{name}_resize_skip")(skip)
    x = layers.Concatenate(name=f"{name}_cat")([x, skip])
    x = conv_block(x, filters, name)
    return x


def build_unet(img_size, num_classes):
    """
    EfficientNetB3 encoder with U-Net skip connections.
    Skip layers chosen to give 4 decoder upsamples → full resolution.
    """
    inputs = keras.Input(shape=(img_size, img_size, 3), name="input_image")

    # Scale inputs to [0,255] range EfficientNet expects
    x = layers.Rescaling(255.0, name="rescale")(inputs)

    base = keras.applications.EfficientNetB3(
        include_top=False,
        weights="imagenet",
        input_tensor=x,
    )

    # Freeze base initially; we'll unfreeze top layers later
    base.trainable = False

    # ── Encoder skip layers (EfficientNetB3 feature map names) ───
    # Strides: 2→4→8→16→32 from input
    s1 = base.get_layer("block2a_expand_activation").output  # /4
    s2 = base.get_layer("block3a_expand_activation").output  # /8
    s3 = base.get_layer("block4a_expand_activation").output  # /16
    s4 = base.get_layer("block6a_expand_activation").output  # /32
    bridge = base.output                                      # /32 deep

    # ── Decoder ──────────────────────────────────────────────────
    d4 = upsample_block(bridge, s4, 256, "dec4")   # /16
    d3 = upsample_block(d4,     s3, 128, "dec3")   # /8
    d2 = upsample_block(d3,     s2,  64, "dec2")   # /4
    d1 = upsample_block(d2,     s1,  32, "dec1")   # /2

    # Final upsample to full resolution (no skip at /1 from EfficientNet)
    out = layers.Conv2DTranspose(32, 2, strides=2, padding="same",
                                 name="dec0_up")(d1)
    out = conv_block(out, 32, "dec0")

    # Segmentation head
    out = layers.Conv2D(num_classes, 1, activation="softmax",
                        name="seg_output")(out)

    model = keras.Model(inputs=inputs, outputs=out, name="ForestUNet")
    return model, base


# ══════════════════════════════════════════════════════════════
# STEP 4 — LOSSES & METRICS
# ══════════════════════════════════════════════════════════════
def dice_loss(y_true, y_pred, num_classes, smooth=1e-6):
    y_true_oh = tf.one_hot(tf.squeeze(y_true, -1), num_classes)
    y_true_oh = tf.cast(y_true_oh, tf.float32)
    intersection = tf.reduce_sum(y_true_oh * y_pred, axis=[1, 2])
    union        = tf.reduce_sum(y_true_oh + y_pred, axis=[1, 2])
    dice         = (2 * intersection + smooth) / (union + smooth)
    return 1.0 - tf.reduce_mean(dice)


def combined_loss(num_classes):
    cce = keras.losses.SparseCategoricalCrossentropy()
    def loss_fn(y_true, y_pred):
        return 0.5 * cce(y_true, y_pred) + \
               0.5 * dice_loss(y_true, y_pred, num_classes)
    loss_fn.__name__ = "combined_dice_cce"
    return loss_fn


class MeanIoU(keras.metrics.MeanIoU):
    """Wrapper that accepts (sparse_labels, softmax_probs)."""
    def update_state(self, y_true, y_pred, sample_weight=None):
        y_pred_cls = tf.argmax(y_pred, axis=-1)
        y_true_sq  = tf.squeeze(tf.cast(y_true, tf.int32), axis=-1)
        return super().update_state(y_true_sq, y_pred_cls, sample_weight)


class PixelAccuracy(keras.metrics.Metric):
    def __init__(self, **kw):
        super().__init__(name="pixel_accuracy", **kw)
        self._correct = self.add_weight("correct", initializer="zeros")
        self._total   = self.add_weight("total",   initializer="zeros")

    def update_state(self, y_true, y_pred, sample_weight=None):
        y_pred_cls = tf.argmax(y_pred, axis=-1, output_type=tf.int32)
        y_true_sq  = tf.squeeze(tf.cast(y_true, tf.int32), -1)
        correct = tf.cast(tf.equal(y_pred_cls, y_true_sq), tf.float32)
        self._correct.assign_add(tf.reduce_sum(correct))
        self._total.assign_add(tf.cast(tf.size(y_true_sq), tf.float32))

    def result(self):
        return self._correct / (self._total + 1e-7)

    def reset_state(self):
        self._correct.assign(0.0)
        self._total.assign(0.0)


# ══════════════════════════════════════════════════════════════
# STEP 5 — VISUALISATION
# ══════════════════════════════════════════════════════════════
COLORMAP = {
    0: (64,  64,  64),    # background — grey
    1: (34, 139,  34),    # healthy forest — green
    2: (220,  20,  60),   # deforested — red
    3: (255, 140,   0),   # fire — orange
    4: (139,  69,  19),   # bare soil — brown
}

def label_to_rgb(label_map, num_classes):
    """Convert integer label map (H,W) → RGB image (H,W,3)."""
    rgb = np.zeros((*label_map.shape, 3), dtype=np.uint8)
    for cls_id in range(num_classes):
        color = COLORMAP.get(cls_id, (128, 128, 128))
        rgb[label_map == cls_id] = color
    return rgb


def save_prediction_plot(img, gt_mask, pred_mask, out_path,
                         num_classes, class_names, per_class_iou):
    fig, axes = plt.subplots(1, 4, figsize=(20, 5))
    fig.suptitle(Path(out_path).stem, fontsize=11)

    axes[0].imshow(img);              axes[0].set_title("Satellite Image");   axes[0].axis("off")
    axes[1].imshow(label_to_rgb(gt_mask,   num_classes)); axes[1].set_title("Ground Truth"); axes[1].axis("off")
    axes[2].imshow(label_to_rgb(pred_mask, num_classes)); axes[2].set_title("Prediction");   axes[2].axis("off")

    # Overlay
    overlay = (img * 255).astype(np.uint8).copy()
    pred_rgb = label_to_rgb(pred_mask, num_classes)
    mask_non_bg = pred_mask > 0
    overlay[mask_non_bg] = (
        overlay[mask_non_bg] * 0.45 +
        pred_rgb[mask_non_bg] * 0.55
    ).astype(np.uint8)
    axes[3].imshow(overlay); axes[3].set_title("Overlay"); axes[3].axis("off")

    # Legend + per-class IoU
    patches = []
    for cls_id, name in class_names.items():
        c = [v/255 for v in COLORMAP.get(cls_id, (128,128,128))]
        iou_str = f"{per_class_iou[cls_id]:.3f}" if cls_id < len(per_class_iou) else "—"
        patches.append(mpatches.Patch(color=c, label=f"{name} IoU={iou_str}"))
    fig.legend(handles=patches, loc="lower center", ncol=num_classes,
               fontsize=8, frameon=False)

    plt.tight_layout()
    plt.savefig(out_path, dpi=100, bbox_inches="tight")
    plt.close(fig)


# ══════════════════════════════════════════════════════════════
# STEP 6 — GPS COORDINATE EXTRACTION FROM PREDICTIONS
# ══════════════════════════════════════════════════════════════
def extract_deforestation_coords(meta_df, predictions, img_size,
                                 num_classes, out_csv):
    """
    If meta_data.csv has columns tl_lat/tl_lng/br_lat/br_lng,
    compute lat/lng of deforested centroid for each image.
    Otherwise skip GPS and write class stats only.
    """
    has_gps = all(c in meta_df.columns
                  for c in ["tl_lat","tl_lng","br_lat","br_lng"])

    rows = []
    for item in predictions:
        fname     = item["image_name"]
        pred_mask = item["pred_mask"]       # (H,W)
        conf_map  = item["confidence"]      # (H,W) max softmax prob

        defor_pixels = np.sum(pred_mask == 2)
        fire_pixels  = np.sum(pred_mask == 3)
        total_pixels = pred_mask.size

        defor_pct = defor_pixels / total_pixels * 100
        fire_pct  = fire_pixels  / total_pixels * 100
        alert     = ("critical" if defor_pct > 15 or fire_pct > 10
                     else "warning" if defor_pct > 5  or fire_pct > 3
                     else "safe")
        avg_conf  = float(conf_map[pred_mask == 2].mean()) if defor_pixels > 0 else 0.0

        row = {
            "image_name":     fname,
            "defor_pixels":   int(defor_pixels),
            "defor_pct":      round(defor_pct, 4),
            "fire_pct":       round(fire_pct, 4),
            "confidence":     round(avg_conf, 4),
            "alert_level":    alert,
            "deforested_lat": None,
            "deforested_lng": None,
            "area_km2":       None,
        }

        if has_gps:
            meta_row = meta_df[meta_df["image"] == fname]
            if not meta_row.empty:
                tl_lat = float(meta_row["tl_lat"].values[0])
                tl_lng = float(meta_row["tl_lng"].values[0])
                br_lat = float(meta_row["br_lat"].values[0])
                br_lng = float(meta_row["br_lng"].values[0])

                ys, xs = np.where(pred_mask == 2)
                if len(ys) > 0:
                    cy = float(np.mean(ys))
                    cx = float(np.mean(xs))
                    H, W = pred_mask.shape
                    lat = tl_lat + (cy / H) * (br_lat - tl_lat)
                    lng = tl_lng + (cx / W) * (br_lng - tl_lng)
                    # Haversine area estimate
                    lat_km = abs(br_lat - tl_lat) * 111.32
                    lng_km = abs(br_lng - tl_lng) * 111.32 * np.cos(np.radians((tl_lat+br_lat)/2))
                    pixel_km2 = (lat_km * lng_km) / total_pixels
                    area_km2  = round(defor_pixels * pixel_km2, 6)

                    row["deforested_lat"] = round(lat, 7)
                    row["deforested_lng"] = round(lng, 7)
                    row["area_km2"]       = area_km2

        rows.append(row)

    out_csv.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(out_csv, index=False)
    print(f"\n📍  Coordinates CSV saved → {out_csv}")
    return rows


# ══════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════
def main():
    args = parse_args()
    random.seed(args.seed)
    np.random.seed(args.seed)
    tf.random.set_seed(args.seed)

    IMG_SIZE   = args.size
    BATCH_SIZE = args.batch
    EPOCHS     = args.epochs

    print("=" * 60)
    print("  Forest Monitor — U-Net Segmentation Training")
    print("=" * 60)

    # ── 1. Load metadata ──────────────────────────────────────
    pairs  = load_pairs(META_CSV, IMG_DIR, MASK_DIR)
    meta_df = pd.read_csv(META_CSV)

    # ── 2. Detect classes ─────────────────────────────────────
    class_values = detect_classes(pairs, seed=args.seed)
    num_classes  = max(class_values) + 1
    class_names  = {k: v[0] for k, v in DEFAULT_CLASSES.items()
                    if k < num_classes}
    for k in range(num_classes):
        if k not in class_names:
            class_names[k] = f"Class_{k}"
    print(f"   Number of classes   : {num_classes}")
    for k, name in class_names.items():
        print(f"   Class {k}: {name}")

    # ── 3. Split data ─────────────────────────────────────────
    train_val, test_pairs = train_test_split(
        pairs, test_size=args.test_split, random_state=args.seed)
    train_pairs, val_pairs = train_test_split(
        train_val, test_size=args.val_split/(1-args.test_split),
        random_state=args.seed)

    print(f"\n📊  Split — Train: {len(train_pairs)} | "
          f"Val: {len(val_pairs)} | Test: {len(test_pairs)}")

    # ── 4. Build tf.data datasets ─────────────────────────────
    train_ds = build_dataset(train_pairs, IMG_SIZE, BATCH_SIZE, augment=True)
    val_ds   = build_dataset(val_pairs,   IMG_SIZE, BATCH_SIZE, augment=False)
    test_ds  = build_dataset(test_pairs,  IMG_SIZE, 1,          augment=False)

    # ── 5. Build model ────────────────────────────────────────
    print("\n🏗️   Building EfficientNetB3 U-Net…")
    model, base_model = build_unet(IMG_SIZE, num_classes)
    model.summary(line_length=90)

    # ── 6. Compile — Phase 1 (frozen encoder) ────────────────
    model.compile(
        optimizer=keras.optimizers.Adam(args.lr),
        loss=combined_loss(num_classes),
        metrics=[
            MeanIoU(num_classes=num_classes, name="mean_iou"),
            PixelAccuracy(),
        ]
    )

    callbacks = [
        keras.callbacks.ModelCheckpoint(
            str(MODEL_DIR / "forest_unet_best.h5"),
            monitor="val_mean_iou", mode="max",
            save_best_only=True, verbose=1),
        keras.callbacks.EarlyStopping(
            monitor="val_mean_iou", patience=10,
            restore_best_weights=True, verbose=1),
        keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5,
            patience=4, min_lr=1e-6, verbose=1),
        keras.callbacks.CSVLogger(
            str(MODEL_DIR / "training_log.csv")),
    ]

    warmup_epochs = min(10, EPOCHS // 4)
    print(f"\n🔥  Phase 1 — Warm-up ({warmup_epochs} epochs, encoder frozen)")
    history1 = model.fit(
        train_ds, validation_data=val_ds,
        epochs=warmup_epochs, callbacks=callbacks, verbose=1)

    # ── 7. Compile — Phase 2 (unfreeze top encoder layers) ───
    for layer in base_model.layers[-80:]:
        if not isinstance(layer, layers.BatchNormalization):
            layer.trainable = True

    model.compile(
        optimizer=keras.optimizers.Adam(args.lr * 0.1),
        loss=combined_loss(num_classes),
        metrics=[
            MeanIoU(num_classes=num_classes, name="mean_iou"),
            PixelAccuracy(),
        ]
    )

    remaining = EPOCHS - warmup_epochs
    print(f"\n🔓  Phase 2 — Fine-tune ({remaining} epochs, top encoder unfrozen)")
    history2 = model.fit(
        train_ds, validation_data=val_ds,
        initial_epoch=warmup_epochs,
        epochs=EPOCHS, callbacks=callbacks, verbose=1)

    # ── 8. Save model ─────────────────────────────────────────
    h5_path  = MODEL_DIR / "forest_unet.h5"
    sm_path  = MODEL_DIR / "forest_unet_savedmodel"
    model.save(str(h5_path))
    model.save(str(sm_path))
    print(f"\n💾  Saved  → {h5_path}")
    print(f"💾  Saved  → {sm_path}")

    # ── 9. TF.js export ──────────────────────────────────────
    if not args.no_tfjs:
        try:
            import tensorflowjs as tfjs
            tfjs.converters.save_keras_model(model, str(TFJS_DIR))
            print(f"🌐  TF.js export → {TFJS_DIR}")
        except ImportError:
            print("⚠️   tensorflowjs not installed — skipping TF.js export.")
            print("     Install with: pip install tensorflowjs")

    # ── 10. Evaluate on test set ──────────────────────────────
    print("\n📊  Evaluating on test set…")
    results = model.evaluate(test_ds, verbose=1)
    print(f"   Test Loss       : {results[0]:.4f}")
    print(f"   Test Mean IoU   : {results[1]:.4f}")
    print(f"   Test Pixel Acc  : {results[2]:.4f}")

    # ── 11. Per-class IoU + visualisations ───────────────────
    print(f"\n🖼️   Generating visualisations for {len(test_pairs)} test images…")
    predictions_list = []
    iou_accum = np.zeros(num_classes)
    dice_accum = np.zeros(num_classes)
    n_batches = 0

    test_ds_unbatched = build_dataset(test_pairs, IMG_SIZE, 1, augment=False)

    for idx, (img_batch, mask_batch) in enumerate(test_ds_unbatched):
        img_np   = img_batch[0].numpy()            # (H,W,3)
        gt_np    = mask_batch[0].numpy()[..., 0]   # (H,W)
        pred_raw = model.predict(img_batch, verbose=0)[0]  # (H,W,C)
        pred_cls = np.argmax(pred_raw, axis=-1)    # (H,W)
        conf_map = np.max(pred_raw, axis=-1)       # (H,W)

        # Per-class IoU
        per_iou = []
        per_dice = []
        for c in range(num_classes):
            tp = np.sum((pred_cls == c) & (gt_np == c))
            fp = np.sum((pred_cls == c) & (gt_np != c))
            fn = np.sum((pred_cls != c) & (gt_np == c))
            iou  = tp / (tp + fp + fn + 1e-7)
            dice = (2*tp) / (2*tp + fp + fn + 1e-7)
            per_iou.append(iou)
            per_dice.append(dice)
        iou_accum  += per_iou
        dice_accum += per_dice
        n_batches  += 1

        # Save plot for first 20 test images
        if idx < 20:
            img_name = Path(test_pairs[idx][0]).name
            plot_path = OUT_DIR / f"pred_{idx:03d}_{img_name}"
            save_prediction_plot(img_np, gt_np, pred_cls, plot_path,
                                 num_classes, class_names, per_iou)

        predictions_list.append({
            "image_name": Path(test_pairs[idx][0]).name,
            "pred_mask":  pred_cls,
            "confidence": conf_map,
        })

    mean_per_class_iou  = iou_accum  / n_batches
    mean_per_class_dice = dice_accum / n_batches

    print("\n" + "─"*55)
    print(f"  {'Class':<22} {'IoU':>8}  {'Dice':>8}")
    print("─"*55)
    for c, name in class_names.items():
        print(f"  {name:<22} {mean_per_class_iou[c]:>8.4f}  "
              f"{mean_per_class_dice[c]:>8.4f}")
    print("─"*55)
    print(f"  {'Mean':<22} {np.mean(mean_per_class_iou):>8.4f}  "
          f"{np.mean(mean_per_class_dice):>8.4f}")
    print("─"*55)

    # Target check
    miou = np.mean(mean_per_class_iou)
    defor_iou = mean_per_class_iou[2] if num_classes > 2 else 0
    print(f"\n🎯  Target Mean IoU > 0.85   → {'✅ PASS' if miou       > 0.85 else '❌ Not yet'}")
    print(f"🎯  Target Pixel Acc > 92%   → {'✅ PASS' if results[2] > 0.92 else '❌ Not yet'}")
    print(f"🎯  Deforestation IoU > 0.80 → {'✅ PASS' if defor_iou  > 0.80 else '❌ Not yet'}")

    # ── 12. Coordinate extraction ─────────────────────────────
    extract_deforestation_coords(
        meta_df, predictions_list, IMG_SIZE, num_classes,
        out_csv=ROOT / "outputs" / "deforestation_coords.csv")

    print(f"\n✅  All done!")
    print(f"   Predictions  → {OUT_DIR}")
    print(f"   Model (.h5)  → {h5_path}")
    print(f"   SavedModel   → {sm_path}")
    if not args.no_tfjs:
        print(f"   TF.js        → {TFJS_DIR}")


if __name__ == "__main__":
    main()
