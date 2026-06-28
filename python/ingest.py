"""
Forest Monitor — Kaggle Dataset Ingestion Script
python/ingest.py

Downloads the Akhil Chibber deforestation detection dataset from Kaggle,
then bulk-inserts every image into the satellite_media table in MySQL
(Railway or localhost), skipping duplicates via MD5 hash.

Setup:
    pip install kagglehub mysql-connector-python
    Set Kaggle credentials:  ~/.kaggle/kaggle.json  or env vars
    Set DB credentials below (or export as env vars for Railway).

Usage:
    python python/ingest.py
    python python/ingest.py --dry-run        # preview without inserting
    python python/ingest.py --limit 100      # ingest first 100 images only
"""

import argparse
import hashlib
import os
import shutil
import sys
from pathlib import Path

# ── Third-party imports (checked at runtime for clear error messages) ─────────
try:
    import kagglehub
except ImportError:
    sys.exit("❌  kagglehub not installed. Run:  pip install kagglehub")

try:
    import mysql.connector
    from mysql.connector import Error as MySQLError
except ImportError:
    sys.exit("❌  mysql-connector-python not installed. Run:  pip install mysql-connector-python")


# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION — edit here OR export as environment variables
# ══════════════════════════════════════════════════════════════════════════════

DB_CONFIG = {
    "host":     os.getenv("MYSQL_HOST",     "localhost"),
    "port":     int(os.getenv("MYSQL_PORT", "3306")),
    "user":     os.getenv("MYSQL_USER",     "root"),
    "password": os.getenv("MYSQLPASSWORD") or os.getenv("MYSQL_PASSWORD", ""),
    "database": os.getenv("MYSQL_DATABASE", "forest_monitor"),
    "charset":  "utf8mb4",
    "collation":"utf8mb4_unicode_ci",
}

KAGGLE_DATASET  = "akhilchibber/deforestation-detection-dataset"
UPLOAD_DIR      = Path("uploads/satellite")          # relative to project root
SOURCE_LABEL    = "Kaggle-Akhil"
ALLOWED_EXT     = {".jpg", ".jpeg", ".png"}
MAX_FILENAME    = 255                                  # VARCHAR(255) in DB


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def md5_of_file(filepath: Path) -> str:
    """Return the MD5 hex digest of a file (chunked to avoid OOM on large files)."""
    h = hashlib.md5()
    with open(filepath, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_filename(original: str, file_hash: str) -> str:
    """Build a collision-safe filename: <first8ofhash>_<original>."""
    stem = Path(original).stem[:80]            # truncate long names
    ext  = Path(original).suffix.lower()
    name = f"{file_hash[:8]}_{stem}{ext}"
    return name[:MAX_FILENAME]


def connect_db() -> mysql.connector.MySQLConnection:
    """Open a MySQL connection; raise with a helpful message on failure."""
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        conn.autocommit = False
        return conn
    except MySQLError as e:
        sys.exit(
            f"❌  Cannot connect to MySQL:\n"
            f"    host={DB_CONFIG['host']}  port={DB_CONFIG['port']}\n"
            f"    user={DB_CONFIG['user']}  db={DB_CONFIG['database']}\n"
            f"    Error: {e}"
        )


def hash_exists(cursor, file_hash: str) -> bool:
    cursor.execute(
        "SELECT 1 FROM satellite_media WHERE file_hash = %s LIMIT 1",
        (file_hash,)
    )
    return cursor.fetchone() is not None


def insert_media(cursor, name: str, file_path: str, file_hash: str) -> int:
    cursor.execute(
        """
        INSERT INTO satellite_media
            (name, file_path, file_hash, type, status, source)
        VALUES
            (%s, %s, %s, 'image', 'pending', %s)
        """,
        (name[:MAX_FILENAME], file_path, file_hash, SOURCE_LABEL)
    )
    return cursor.lastrowid


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Ingest Kaggle deforestation images into MySQL.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would be inserted without touching the DB or filesystem.")
    parser.add_argument("--limit",   type=int, default=0,
                        help="Stop after inserting N images (0 = no limit).")
    parser.add_argument("--dataset", default=KAGGLE_DATASET,
                        help=f"Kaggle dataset slug (default: {KAGGLE_DATASET})")
    args = parser.parse_args()

    # ── 1. Download dataset ────────────────────────────────────────────────
    print(f"📥  Downloading dataset: {args.dataset}")
    try:
        dataset_path = Path(kagglehub.dataset_download(args.dataset))
    except Exception as e:
        sys.exit(f"❌  Kaggle download failed: {e}")
    print(f"✅  Dataset path: {dataset_path}\n")

    # ── 2. Connect to DB ───────────────────────────────────────────────────
    if args.dry_run:
        print("⚠️   DRY RUN — no database writes, no file copies.\n")
        conn = cursor = None
    else:
        conn   = connect_db()
        cursor = conn.cursor()
        print(f"✅  Connected to MySQL @ {DB_CONFIG['host']}:{DB_CONFIG['port']}"
              f" → {DB_CONFIG['database']}\n")

    # ── 3. Ensure upload directory exists ─────────────────────────────────
    if not args.dry_run:
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # ── 4. Walk dataset and ingest ─────────────────────────────────────────
    uploaded = skipped_dup = skipped_ext = errors = 0

    for src_path in sorted(dataset_path.rglob("*")):
        if not src_path.is_file():
            continue
        if src_path.suffix.lower() not in ALLOWED_EXT:
            skipped_ext += 1
            continue

        try:
            file_hash = md5_of_file(src_path)
        except OSError as e:
            print(f"  ⚠️  Cannot read {src_path.name}: {e}")
            errors += 1
            continue

        # ── Duplicate check ────────────────────────────────────────────────
        if not args.dry_run and hash_exists(cursor, file_hash):
            skipped_dup += 1
            continue

        # ── Build destination path ─────────────────────────────────────────
        dest_name = safe_filename(src_path.name, file_hash)
        dest_path = UPLOAD_DIR / dest_name
        # Relative URL stored in the DB (web-accessible path)
        db_path   = f"uploads/satellite/{dest_name}"

        if args.dry_run:
            print(f"  [DRY] Would insert: {src_path.name!r:60s} → {dest_name}")
            uploaded += 1
        else:
            # ── Copy file ──────────────────────────────────────────────────
            try:
                shutil.copy2(src_path, dest_path)
            except OSError as e:
                print(f"  ⚠️  Copy failed for {src_path.name}: {e}")
                errors += 1
                continue

            # ── Insert row ─────────────────────────────────────────────────
            try:
                row_id = insert_media(cursor, src_path.name, db_path, file_hash)
                conn.commit()
                uploaded += 1
                print(f"  [{uploaded:>5}] id={row_id:<8} {src_path.name}")
            except MySQLError as e:
                conn.rollback()
                # If another process inserted the same hash concurrently, just skip
                if e.errno == 1062:   # Duplicate entry
                    skipped_dup += 1
                    dest_path.unlink(missing_ok=True)
                else:
                    print(f"  ⚠️  DB error for {src_path.name}: {e}")
                    dest_path.unlink(missing_ok=True)
                    errors += 1
                continue

        # ── Respect --limit ────────────────────────────────────────────────
        if args.limit and uploaded >= args.limit:
            print(f"\n  Reached --limit {args.limit}. Stopping.")
            break

    # ── 5. Summary ─────────────────────────────────────────────────────────
    print(
        f"\n{'─'*50}\n"
        f"  Inserted   : {uploaded}\n"
        f"  Duplicates : {skipped_dup}\n"
        f"  Non-image  : {skipped_ext}\n"
        f"  Errors     : {errors}\n"
        f"{'─'*50}"
    )

    if conn:
        cursor.close()
        conn.close()


if __name__ == "__main__":
    main()
