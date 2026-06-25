/* ============================================================
   AI Fighting Deforestation — cv.js
   Computer Vision demos: all run 100% in-browser.

   1. Object Detection  — TensorFlow.js COCO-SSD
   2. Change Detection  — pixel-diff (green loss / gain map)
   3. Fire Heatmap      — channel-ratio fire-pixel detector
   4. NDVI / Sobel Edge — vegetation index + Sobel edge filter
   ============================================================ */

(function () {
  'use strict';

  /* ── Tiny helpers ─────────────────────────────────────── */
  const qs = (id) => document.getElementById(id);

  function setStatus (id, msg, state /* 'running'|'done'|'error'|'' */) {
    const el = qs(id);
    if (!el) return;
    el.textContent = msg;
    el.className = 'cv-status' + (state ? ' ' + state : '');
  }

  function setResults (id, html) {
    const el = qs(id);
    if (el) el.innerHTML = html;
  }

  /** Show/hide the canvas placeholder */
  function showPlaceholder (id, show) {
    const el = qs(id);
    if (!el) return;
    el.classList.toggle('hidden', !show);
  }

  /** Inject a spinner overlay into a canvas-wrap parent */
  function showSpinner (canvasId, label) {
    const canvas = qs(canvasId);
    if (!canvas) return;
    const wrap = canvas.closest('.cv-canvas-wrap');
    removeSpinner(canvasId);
    const div = document.createElement('div');
    div.className = 'cv-spinner';
    div.id = canvasId + '-spinner';
    div.innerHTML = `<div class="cv-spinner-ring"></div><span>${label}</span>`;
    wrap.appendChild(div);
  }

  function removeSpinner (canvasId) {
    const el = qs(canvasId + '-spinner');
    if (el) el.remove();
  }

  /**
   * Load an image File into an HTMLImageElement.
   * Returns a Promise<HTMLImageElement>.
   */
  function loadImageFile (file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
      img.src = url;
    });
  }

  /**
   * Draw an image into a canvas, scaling to fit within maxW × maxH.
   * Returns the canvas 2D context.
   */
  function drawImageToCanvas (canvas, img, maxW = 900, maxH = 520) {
    const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
    canvas.width  = Math.round(img.naturalWidth  * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return ctx;
  }

  /* ════════════════════════════════════════════════════════
     1. OBJECT DETECTION — COCO-SSD (TensorFlow.js)
  ════════════════════════════════════════════════════════ */
  let cocoModel = null; // cached after first load

  const detectUpload  = qs('detect-upload');
  const detectRun     = qs('detect-run');
  let   detectImgFile = null;

  if (detectUpload) {
    detectUpload.addEventListener('change', (e) => {
      detectImgFile = e.target.files[0] || null;
      detectRun.disabled = !detectImgFile;
      if (detectImgFile) {
        setStatus('detect-status', `Image selected: ${detectImgFile.name}`, '');
      }
    });
  }

  if (detectRun) {
    detectRun.addEventListener('click', async () => {
      if (!detectImgFile) return;
      detectRun.disabled = true;
      showSpinner('detect-canvas', 'Loading model…');
      setStatus('detect-status', 'Loading COCO-SSD model (first run may take a moment)…', 'running');
      setResults('detect-results', '');

      try {
        /* Lazy-load the model once */
        if (!cocoModel) {
          if (typeof cocoSsd === 'undefined') {
            throw new Error('TensorFlow.js COCO-SSD not loaded. Check your internet connection.');
          }
          cocoModel = await cocoSsd.load();
        }

        setStatus('detect-status', 'Running detection…', 'running');
        showSpinner('detect-canvas', 'Detecting objects…');

        const img    = await loadImageFile(detectImgFile);
        const canvas = qs('detect-canvas');
        const ctx    = drawImageToCanvas(canvas, img);

        showPlaceholder('detect-placeholder', false);
        removeSpinner('detect-canvas');

        /* Run inference */
        const predictions = await cocoModel.detect(canvas);

        /* Draw bounding boxes */
        ctx.lineWidth   = Math.max(2, canvas.width / 200);
        ctx.font        = `bold ${Math.max(12, canvas.width / 50)}px system-ui`;
        ctx.textBaseline = 'top';

        const COLORS = [
          '#3b82d4', '#22c55e', '#f59e0b', '#ef4444',
          '#a855f7', '#06b6d4', '#f97316', '#84cc16'
        ];

        predictions.forEach((pred, i) => {
          const [x, y, w, h] = pred.bbox;
          const color = COLORS[i % COLORS.length];
          const label = `${pred.class} ${(pred.score * 100).toFixed(0)}%`;

          /* Box */
          ctx.strokeStyle = color;
          ctx.strokeRect(x, y, w, h);

          /* Label background */
          const tw = ctx.measureText(label).width;
          const th = parseInt(ctx.font, 10) + 4;
          ctx.fillStyle = color;
          ctx.fillRect(x, y - th, tw + 8, th);

          /* Label text */
          ctx.fillStyle = '#fff';
          ctx.fillText(label, x + 4, y - th + 2);
        });

        /* Summary */
        if (predictions.length === 0) {
          setStatus('detect-status', 'No objects detected.', 'done');
          setResults('detect-results', '<em>Try a clearer or different image.</em>');
        } else {
          const counts = {};
          predictions.forEach(p => { counts[p.class] = (counts[p.class] || 0) + 1; });
          const tags = Object.entries(counts)
            .map(([cls, n]) => `<span class="result-tag">${cls} ×${n}</span>`)
            .join('');
          setStatus('detect-status', `Found ${predictions.length} object(s).`, 'done');
          setResults('detect-results', `<strong>Detected:</strong><br>${tags}`);
        }

      } catch (err) {
        removeSpinner('detect-canvas');
        setStatus('detect-status', `Error: ${err.message}`, 'error');
        console.error('[CV] Object detection error:', err);
      } finally {
        detectRun.disabled = false;
      }
    });
  }

  /* ════════════════════════════════════════════════════════
     2. CHANGE DETECTION — pixel diff
  ════════════════════════════════════════════════════════ */
  const changeUploadA = qs('change-upload-a');
  const changeUploadB = qs('change-upload-b');
  const changeRun     = qs('change-run');
  let   changeFileA   = null;
  let   changeFileB   = null;

  function updateChangeBtn () {
    if (changeRun) changeRun.disabled = !(changeFileA && changeFileB);
  }

  if (changeUploadA) {
    changeUploadA.addEventListener('change', (e) => {
      changeFileA = e.target.files[0] || null;
      updateChangeBtn();
      if (changeFileA) setStatus('change-status', `Before: ${changeFileA.name}${changeFileB ? ' — both ready.' : ' — upload After image.'}`, '');
    });
  }
  if (changeUploadB) {
    changeUploadB.addEventListener('change', (e) => {
      changeFileB = e.target.files[0] || null;
      updateChangeBtn();
      if (changeFileB) setStatus('change-status', `After: ${changeFileB.name}${changeFileA ? ' — both ready.' : ' — upload Before image.'}`, '');
    });
  }

  if (changeRun) {
    changeRun.addEventListener('click', async () => {
      if (!changeFileA || !changeFileB) return;
      changeRun.disabled = true;
      showSpinner('change-canvas', 'Computing difference…');
      setStatus('change-status', 'Analysing pixel differences…', 'running');
      setResults('change-results', '');

      try {
        const [imgA, imgB] = await Promise.all([
          loadImageFile(changeFileA),
          loadImageFile(changeFileB)
        ]);

        /* Normalise both images to the same size (image A dimensions) */
        const W = Math.min(imgA.naturalWidth,  900);
        const H = Math.min(imgA.naturalHeight, 520);
        const scale = Math.min(1, W / imgA.naturalWidth, H / imgA.naturalHeight);
        const cw = Math.round(imgA.naturalWidth  * scale);
        const ch = Math.round(imgA.naturalHeight * scale);

        /* Off-screen canvases */
        const offA = document.createElement('canvas');
        offA.width = cw; offA.height = ch;
        offA.getContext('2d').drawImage(imgA, 0, 0, cw, ch);

        const offB = document.createElement('canvas');
        offB.width = cw; offB.height = ch;
        offB.getContext('2d').drawImage(imgB, 0, 0, cw, ch);

        const dataA = offA.getContext('2d').getImageData(0, 0, cw, ch);
        const dataB = offB.getContext('2d').getImageData(0, 0, cw, ch);

        /* Build difference map */
        const canvas = qs('change-canvas');
        canvas.width  = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');

        /* Draw image A as base (dimmed) */
        ctx.globalAlpha = 0.55;
        ctx.drawImage(offA, 0, 0);
        ctx.globalAlpha = 1;

        const outData = ctx.createImageData(cw, ch);
        const pA = dataA.data, pB = dataB.data;

        /* Threshold: a pixel is "changed" if its luminance diff > threshold */
        const THRESH = 30;
        let lossCount = 0, gainCount = 0;

        for (let i = 0; i < pA.length; i += 4) {
          const rA = pA[i], gA = pA[i+1], bA = pA[i+2];
          const rB = pB[i], gB = pB[i+1], bB = pB[i+2];

          /* Luminance */
          const lumA = 0.299*rA + 0.587*gA + 0.114*bA;
          const lumB = 0.299*rB + 0.587*gB + 0.114*bB;
          const diff = lumA - lumB; // positive = became darker (loss)

          if (Math.abs(diff) > THRESH) {
            if (diff > 0) {
              /* Darkened → forest loss → red overlay */
              outData.data[i]   = 239;
              outData.data[i+1] = 68;
              outData.data[i+2] = 68;
              outData.data[i+3] = Math.min(255, Math.round(Math.abs(diff) * 2));
              lossCount++;
            } else {
              /* Brightened (green gain) → green overlay */
              outData.data[i]   = 34;
              outData.data[i+1] = 197;
              outData.data[i+2] = 94;
              outData.data[i+3] = Math.min(255, Math.round(Math.abs(diff) * 2));
              gainCount++;
            }
          }
        }

        ctx.putImageData(outData, 0, 0);

        showPlaceholder('change-placeholder', false);
        removeSpinner('change-canvas');

        const total = cw * ch;
        const lossPct = ((lossCount / total) * 100).toFixed(1);
        const gainPct = ((gainCount / total) * 100).toFixed(1);

        setStatus('change-status', 'Change map rendered.', 'done');
        setResults('change-results',
          `<span class="result-tag" style="background:#fee2e2;color:#991b1b">Loss ${lossPct}%</span>` +
          `<span class="result-tag" style="background:#dcfce7;color:#166534">Gain ${gainPct}%</span>` +
          `<br><small>Red = areas that darkened (potential forest loss). ` +
          `Green = areas that brightened (potential regrowth).</small>`
        );

      } catch (err) {
        removeSpinner('change-canvas');
        setStatus('change-status', `Error: ${err.message}`, 'error');
        console.error('[CV] Change detection error:', err);
      } finally {
        changeRun.disabled = false;
      }
    });
  }

  /* ════════════════════════════════════════════════════════
     3. FIRE HEATMAP — channel-ratio fire-pixel detector
  ════════════════════════════════════════════════════════ */
  const fireUpload = qs('fire-upload');
  const fireRun    = qs('fire-run');
  const fireThresh = qs('fire-thresh');
  const fireThreshVal = qs('fire-thresh-val');
  let   fireFile   = null;

  if (fireThresh) {
    fireThresh.addEventListener('input', () => {
      if (fireThreshVal) fireThreshVal.textContent = fireThresh.value;
    });
  }

  if (fireUpload) {
    fireUpload.addEventListener('change', (e) => {
      fireFile = e.target.files[0] || null;
      if (fireRun) fireRun.disabled = !fireFile;
      if (fireFile) setStatus('fire-status', `Image selected: ${fireFile.name}`, '');
    });
  }

  if (fireRun) {
    fireRun.addEventListener('click', async () => {
      if (!fireFile) return;
      fireRun.disabled = true;
      showSpinner('fire-canvas', 'Analysing thermal signatures…');
      setStatus('fire-status', 'Processing…', 'running');
      setResults('fire-results', '');

      try {
        const img    = await loadImageFile(fireFile);
        const canvas = qs('fire-canvas');
        const ctx    = drawImageToCanvas(canvas, img);
        const { width: cw, height: ch } = canvas;

        const srcData = ctx.getImageData(0, 0, cw, ch);
        const src     = srcData.data;
        const out     = ctx.createImageData(cw, ch);
        const o       = out.data;

        /* Draw dimmed original first */
        for (let i = 0; i < src.length; i += 4) {
          o[i]   = src[i]   >> 1;  // R / 2
          o[i+1] = src[i+1] >> 1;
          o[i+2] = src[i+2] >> 1;
          o[i+3] = src[i+3];
        }

        const sensitivity = parseInt(fireThresh ? fireThresh.value : '40', 10);
        /* Map 10-90 sensitivity → fire threshold score 0.55-0.25 (inverted) */
        const fireScore = 0.55 - (sensitivity - 10) / 80 * 0.3;

        let firePixels = 0;

        for (let i = 0; i < src.length; i += 4) {
          const r = src[i], g = src[i+1], b = src[i+2];
          /* Fire signature: high R, moderate G, low B, R dominates */
          const total = r + g + b + 1;
          const rRatio = r / total;
          const bRatio = b / total;
          const isHot  = rRatio > fireScore && bRatio < 0.22 && r > 80;

          if (isHot) {
            /* False-colour: map intensity to yellow → orange → red */
            const intensity = Math.min(1, (rRatio - fireScore) / 0.25);
            o[i]   = 255;
            o[i+1] = Math.round(200 * (1 - intensity));
            o[i+2] = 0;
            o[i+3] = Math.round(200 + 55 * intensity);
            firePixels++;
          }
        }

        ctx.putImageData(out, 0, 0);

        showPlaceholder('fire-placeholder', false);
        removeSpinner('fire-canvas');

        const pct = ((firePixels / (cw * ch)) * 100).toFixed(2);
        setStatus('fire-status', 'Heatmap rendered.', 'done');
        setResults('fire-results',
          `<span class="result-tag" style="background:#fef2f2;color:#991b1b">` +
          `Fire pixels: ${firePixels.toLocaleString()} (${pct}%)</span>` +
          `<br><small>Orange/red pixels match fire-signature colour ratios ` +
          `(high red channel, low blue, dominant heat tone).</small>`
        );

      } catch (err) {
        removeSpinner('fire-canvas');
        setStatus('fire-status', `Error: ${err.message}`, 'error');
        console.error('[CV] Fire heatmap error:', err);
      } finally {
        fireRun.disabled = false;
      }
    });
  }

  /* ════════════════════════════════════════════════════════
     4. NDVI SIMULATION + SOBEL EDGE DETECTION
  ════════════════════════════════════════════════════════ */
  const edgeUpload = qs('edge-upload');
  const edgeRun    = qs('edge-run');
  let   edgeFile   = null;

  if (edgeUpload) {
    edgeUpload.addEventListener('change', (e) => {
      edgeFile = e.target.files[0] || null;
      if (edgeRun) edgeRun.disabled = !edgeFile;
      if (edgeFile) setStatus('edge-status', `Image selected: ${edgeFile.name}`, '');
    });
  }

  /** Compute Sobel gradient magnitude from greyscale ImageData */
  function sobelGradient (grey, w, h) {
    const mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const tl = grey[(y-1)*w + (x-1)], tm = grey[(y-1)*w + x], tr = grey[(y-1)*w + (x+1)];
        const ml = grey[ y   *w + (x-1)],                          mr = grey[ y   *w + (x+1)];
        const bl = grey[(y+1)*w + (x-1)], bm = grey[(y+1)*w + x], br = grey[(y+1)*w + (x+1)];
        const gx = -tl - 2*ml - bl + tr + 2*mr + br;
        const gy = -tl - 2*tm - tr + bl + 2*bm + br;
        mag[i] = Math.sqrt(gx*gx + gy*gy);
      }
    }
    return mag;
  }

  if (edgeRun) {
    edgeRun.addEventListener('click', async () => {
      if (!edgeFile) return;
      edgeRun.disabled = true;
      showSpinner('edge-canvas', 'Processing…');
      setStatus('edge-status', 'Running filter…', 'running');
      setResults('edge-results', '');

      try {
        const img    = await loadImageFile(edgeFile);
        const canvas = qs('edge-canvas');
        const ctx    = drawImageToCanvas(canvas, img);
        const { width: cw, height: ch } = canvas;

        const src    = ctx.getImageData(0, 0, cw, ch).data;
        const out    = ctx.createImageData(cw, ch);
        const o      = out.data;

        /* Selected mode */
        const modeRadio = document.querySelector('input[name="edge-mode"]:checked');
        const mode = modeRadio ? modeRadio.value : 'ndvi';

        /* ── NDVI simulation ───────────────────────────── */
        /* Approximate: NIR is unavailable from RGB cameras.
           Proxy: (R - G) / (R + G + 1) → range ~[-1, 1]
           High green relative to red = healthy vegetation = positive NDVI. */
        const ndviMap = new Float32Array(cw * ch);
        let   vegPixels = 0;

        for (let i = 0; i < src.length; i += 4) {
          const r = src[i], g = src[i+1];
          const ndvi = (g - r) / (g + r + 1); // proxy NDVI
          ndviMap[i >> 2] = ndvi;
          if (ndvi > 0.05) vegPixels++;
        }

        /* ── Sobel edges ───────────────────────────────── */
        const grey = new Float32Array(cw * ch);
        for (let i = 0; i < src.length; i += 4) {
          grey[i >> 2] = 0.299*src[i] + 0.587*src[i+1] + 0.114*src[i+2];
        }
        const sobel = sobelGradient(grey, cw, ch);
        const maxSobel = Math.max(...sobel) || 1;

        /* ── Compose output ────────────────────────────── */
        for (let idx = 0; idx < cw * ch; idx++) {
          const base = idx << 2;

          if (mode === 'ndvi' || mode === 'both') {
            const n = ndviMap[idx];
            if (n > 0.05) {
              /* Healthy vegetation: green palette */
              const t = Math.min(1, (n - 0.05) / 0.45);
              o[base]   = Math.round(20  + 40  * (1 - t));
              o[base+1] = Math.round(120 + 100 * t);
              o[base+2] = Math.round(20  + 30  * (1 - t));
              o[base+3] = 230;
            } else if (n < -0.05) {
              /* Bare soil / non-veg: brown palette */
              const t = Math.min(1, (-n - 0.05) / 0.45);
              o[base]   = Math.round(160 + 60 * t);
              o[base+1] = Math.round(100 - 40 * t);
              o[base+2] = Math.round(40  - 20 * t);
              o[base+3] = 230;
            } else {
              /* Neutral: greyscale */
              const lum = grey[idx];
              o[base] = o[base+1] = o[base+2] = lum;
              o[base+3] = 180;
            }
          } else {
            /* Sobel-only mode: greyscale base */
            const lum = grey[idx];
            o[base] = o[base+1] = o[base+2] = lum;
            o[base+3] = 255;
          }

          /* Overlay Sobel edges in yellow */
          if (mode === 'sobel' || mode === 'both') {
            const s = sobel[idx] / maxSobel;
            if (s > 0.18) {
              const strength = Math.min(1, (s - 0.18) / 0.4);
              o[base]   = Math.round(o[base]   * (1 - strength) + 250 * strength);
              o[base+1] = Math.round(o[base+1] * (1 - strength) + 200 * strength);
              o[base+2] = Math.round(o[base+2] * (1 - strength) + 0   * strength);
              o[base+3] = 255;
            }
          }
        }

        ctx.putImageData(out, 0, 0);

        showPlaceholder('edge-placeholder', false);
        removeSpinner('edge-canvas');

        const vegPct = ((vegPixels / (cw * ch)) * 100).toFixed(1);
        setStatus('edge-status', 'Processing complete.', 'done');
        setResults('edge-results',
          `<span class="result-tag">Vegetation proxy: ${vegPct}%</span>` +
          `<br><small>` +
          (mode === 'ndvi' ? 'NDVI false-colour: green = healthy canopy, brown = bare soil.' :
           mode === 'sobel' ? 'Sobel edges: yellow lines highlight canopy boundaries and structural transitions.' :
           'Combined: NDVI false-colour with Sobel edge overlay on canopy boundaries.') +
          `</small>`
        );

      } catch (err) {
        removeSpinner('edge-canvas');
        setStatus('edge-status', `Error: ${err.message}`, 'error');
        console.error('[CV] Edge/NDVI error:', err);
      } finally {
        edgeRun.disabled = false;
      }
    });
  }

  /* ════════════════════════════════════════════════════════
     CV TAB SWITCHING
  ════════════════════════════════════════════════════════ */
  const tabBtns   = document.querySelectorAll('.cv-tab');
  const tabPanels = document.querySelectorAll('.cv-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      tabBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      tabPanels.forEach(p => {
        p.classList.remove('active');
        p.hidden = true;
      });

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      const panel = document.getElementById('tab-' + target);
      if (panel) {
        panel.classList.add('active');
        panel.hidden = false;
      }
    });
  });

})();
