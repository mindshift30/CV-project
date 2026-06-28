/* ============================================================
   Forest Monitor — Auto Analysis Worker (v2 — with GPS)
   js/auto-analyse.js
   ============================================================ */

(function () {
  'use strict';

  const POLL_INTERVAL_MS = 30_000;
  const MAX_DIM          = 512;
  const CHANGE_THRESH    = 45;

  let monitorEnabled = false;
  let pollTimer      = null;
  let isRunning      = false;

  window.AutoMonitor = {
    start() {
      if (monitorEnabled) return;
      monitorEnabled = true;
      _updateToggleUI(true);
      _log('Auto-monitor started.');
      _runCycle();
      pollTimer = setInterval(_runCycle, POLL_INTERVAL_MS);
    },
    stop() {
      monitorEnabled = false;
      clearInterval(pollTimer);
      pollTimer = null;
      _updateToggleUI(false);
      _log('Auto-monitor stopped.');
    },
    toggle() { monitorEnabled ? this.stop() : this.start(); },
    get enabled() { return monitorEnabled; },
  };

  /* ── Main poll cycle ──────────────────────────────────────── */
  async function _runCycle() {
    if (isRunning || !monitorEnabled) return;
    isRunning = true;
    _setLastChecked();
    try {
      const pending = await fetchPendingMedia();
      if (pending.length === 0) { _log('No pending images.'); return; }
      _log(`Processing ${pending.length} pending image(s)…`);
      for (const media of pending) {
        if (!monitorEnabled) break;
        await _analyseMedia(media);
      }
    } catch (err) {
      console.error('[AutoMonitor] Poll error:', err);
      _log(`Error: ${err.message}`, 'error');
    } finally {
      isRunning = false;
    }
  }

  /* ── Analyse a single media row ─────────────────────────── */
  async function _analyseMedia(media) {
    if (media.type !== 'image') { _log(`Skipping non-image: ${media.name}`); return; }

    try {
      _log(`Analysing: ${media.name}`);
      const img = await _loadImage(media.file_path);

      // Build corners object from media row (may be null)
      const corners = _buildCorners(media);

      const {
        lossPct, gainPct, firePct, ndviScore,
        lossRegions, fireRegions,
        canvasW, canvasH,
      } = _runPixelAnalysis(img);

      const alertLevel = _determineAlertLevel(lossPct, firePct);

      // ── GPS coordinate extraction ──────────────────────────
      let affectedLat  = null;
      let affectedLng  = null;
      let affectedArea = null;
      let pixelX       = null;
      let pixelY       = null;
      let boundingBox  = null;

      if (corners) {
        // Use the largest detected region (loss first, then fire)
        const primaryRegions = lossRegions.length > 0 ? lossRegions : fireRegions;
        if (primaryRegions.length > 0) {
          // Sort by pixel count descending — largest patch first
          primaryRegions.sort((a, b) => b.count - a.count);
          const top = primaryRegions[0];

          pixelX = top.cx;
          pixelY = top.cy;
          boundingBox = { x: top.x, y: top.y, w: top.w, h: top.h };

          const gps = pixelToGPS(top.cx, top.cy, canvasW, canvasH, corners);
          affectedLat  = gps.lat;
          affectedLng  = gps.lng;
          affectedArea = estimateAreaKm2(top.count, canvasW, canvasH, corners);
        }
      } else if (media.center_lat != null) {
        // Fall back to image center GPS
        affectedLat = parseFloat(media.center_lat);
        affectedLng = parseFloat(media.center_lng);
      }

      const locNote = affectedLat != null
        ? ` @ ${affectedLat.toFixed(5)}, ${affectedLng.toFixed(5)}`
        : '';
      const notes = `Auto-analysed. Loss ${lossPct.toFixed(2)}%, `
                  + `Gain ${gainPct.toFixed(2)}%, Fire ${firePct.toFixed(2)}%, `
                  + `NDVI ${ndviScore.toFixed(2)}%.${locNote}`;

      const saved = await saveAnalysisResult({
        media_id:           media.id,
        loss_pct:           +lossPct.toFixed(2),
        gain_pct:           +gainPct.toFixed(2),
        fire_pct:           +firePct.toFixed(2),
        ndvi_score:         +ndviScore.toFixed(2),
        alert_level:        alertLevel,
        notes,
        affected_lat:       affectedLat,
        affected_lng:       affectedLng,
        affected_area_km2:  affectedArea != null ? +affectedArea.toFixed(4) : null,
        pixel_x:            pixelX,
        pixel_y:            pixelY,
        bounding_box:       boundingBox,
      });

      // Save location_alert separately if we have coordinates
      if (affectedLat != null && alertLevel !== 'safe') {
        await saveLocationAlert({
          result_id:  saved.result_id,
          lat:        affectedLat,
          lng:        affectedLng,
          alert_type: firePct > 5 ? 'fire' : 'deforestation',
          severity:   alertLevel === 'critical' ? 'critical' : 'medium',
          area_km2:   affectedArea,
        });
      }

      await markMediaAnalysed(media.id);
      _log(`Done: ${media.name} → ${alertLevel.toUpperCase()}${locNote}`, alertLevel);

      if (alertLevel === 'critical') {
        _sendBrowserNotification(media.name, lossPct, firePct, affectedLat, affectedLng);
        _flashAlertBadge();
      }

      // Push row to dashboard immediately
      if (typeof DashboardModule !== 'undefined' && DashboardModule.prependRow) {
        DashboardModule.prependRow({
          media_name:        media.name,
          file_path:         media.file_path,
          analysed_at:       new Date().toISOString(),
          loss_pct:          lossPct.toFixed(2),
          gain_pct:          gainPct.toFixed(2),
          fire_pct:          firePct.toFixed(2),
          ndvi_score:        ndviScore.toFixed(2),
          alert_level:       alertLevel,
          affected_lat:      affectedLat,
          affected_lng:      affectedLng,
          affected_area_km2: affectedArea,
        });
      }

      // Refresh map markers
      if (window.MapModule) window.MapModule.refresh();

    } catch (err) {
      console.error(`[AutoMonitor] Failed: ${media.name}`, err);
      _log(`Failed: ${media.name} — ${err.message}`, 'error');
    }
  }

  /* ── Pixel analysis — returns regions for GPS extraction ── */
  function _runPixelAnalysis(img) {
    const canvas = document.createElement('canvas');
    const scale  = Math.min(1, MAX_DIM / img.naturalWidth, MAX_DIM / img.naturalHeight);
    canvas.width  = Math.round(img.naturalWidth  * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);

    const { data } = ctx.getImageData(0, 0, W, H);
    const total = W * H;

    // Flagged pixel maps for connected-component grouping
    const lossMap = new Uint8Array(total);
    const fireMap = new Uint8Array(total);

    let lossCount = 0, gainCount = 0, fireCount = 0, ndviSum = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const ndvi = (g - r) / (g + r + 1);
      ndviSum += ndvi;

      const lum      = 0.299 * r + 0.587 * g + 0.114 * b;
      const wasGreen = g > r * 1.1 && g > b * 1.1;
      const px       = i >> 2;

      if (!wasGreen && lum < 100) { lossMap[px] = 1; lossCount++; }
      if (wasGreen && ndvi > 0.1)  gainCount++;

      const t3     = r + g + b + 1;
      const rRatio = r / t3;
      const bRatio = b / t3;
      if (rRatio > 0.40 && bRatio < 0.22 && r > 100 && r > g * 1.5) {
        fireMap[px] = 1;
        fireCount++;
      }
    }

    // Extract bounding regions from flagged maps
    const lossRegions = _extractRegions(lossMap, W, H);
    const fireRegions = _extractRegions(fireMap, W, H);

    return {
      lossPct:     (lossCount / total) * 100,
      gainPct:     (gainCount / total) * 100,
      firePct:     (fireCount / total) * 100,
      ndviScore:   ((ndviSum  / total) + 1) * 50,
      lossRegions, fireRegions,
      canvasW: W, canvasH: H,
    };
  }

  /* ── Simple bounding-box region extractor ─────────────────
     Groups flagged pixels into rectangular blobs using a
     lightweight scan-line approach (no full flood-fill needed
     for the coarse centroid estimate we require).
  */
  function _extractRegions(flagMap, W, H) {
    // Divide image into a coarse grid of cells; collect stats per cell
    const CELL = 16;
    const cols = Math.ceil(W / CELL);
    const rows = Math.ceil(H / CELL);
    const cells = new Array(cols * rows).fill(0);

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        if (flagMap[py * W + px]) {
          cells[Math.floor(py / CELL) * cols + Math.floor(px / CELL)]++;
        }
      }
    }

    const regions = [];
    const MIN_CELL_PIX = 4;     // minimum flagged pixels in a cell

    for (let ci = 0; ci < cells.length; ci++) {
      if (cells[ci] < MIN_CELL_PIX) continue;
      const cr = Math.floor(ci / cols);
      const cc = ci % cols;
      const x1 = cc * CELL, y1 = cr * CELL;
      const x2 = Math.min(x1 + CELL, W);
      const y2 = Math.min(y1 + CELL, H);

      // Accumulate centroid within this cell
      let sx = 0, sy = 0, cnt = 0;
      for (let py = y1; py < y2; py++) {
        for (let px = x1; px < x2; px++) {
          if (flagMap[py * W + px]) { sx += px; sy += py; cnt++; }
        }
      }
      regions.push({
        cx:    Math.round(sx / cnt),
        cy:    Math.round(sy / cnt),
        x:     x1,  y:    y1,
        w:     x2 - x1,
        h:     y2 - y1,
        count: cnt,
      });
    }

    // Merge overlapping cells into larger blobs
    return _mergeRegions(regions);
  }

  function _mergeRegions(regions) {
    // Simple greedy merge: absorb any region whose centre is within 2*CELL of another
    const CELL = 16;
    const out = [];
    const used = new Array(regions.length).fill(false);

    for (let i = 0; i < regions.length; i++) {
      if (used[i]) continue;
      let cx = regions[i].cx * regions[i].count;
      let cy = regions[i].cy * regions[i].count;
      let total = regions[i].count;
      let x1 = regions[i].x, y1 = regions[i].y;
      let x2 = x1 + regions[i].w, y2 = y1 + regions[i].h;

      for (let j = i + 1; j < regions.length; j++) {
        if (used[j]) continue;
        const dx = regions[i].cx - regions[j].cx;
        const dy = regions[i].cy - regions[j].cy;
        if (Math.sqrt(dx*dx + dy*dy) < CELL * 2) {
          cx    += regions[j].cx * regions[j].count;
          cy    += regions[j].cy * regions[j].count;
          total += regions[j].count;
          x1 = Math.min(x1, regions[j].x);
          y1 = Math.min(y1, regions[j].y);
          x2 = Math.max(x2, regions[j].x + regions[j].w);
          y2 = Math.max(y2, regions[j].y + regions[j].h);
          used[j] = true;
        }
      }
      out.push({
        cx: Math.round(cx / total), cy: Math.round(cy / total),
        x: x1, y: y1, w: x2 - x1, h: y2 - y1, count: total,
      });
    }
    return out;
  }

  /* ── Build corners from media row ─────────────────────────── */
  function _buildCorners(media) {
    const tllat = parseFloat(media.top_left_lat);
    const tllng = parseFloat(media.top_left_lng);
    const trlat = parseFloat(media.top_right_lat);
    const trlng = parseFloat(media.top_right_lng);
    const bllat = parseFloat(media.bottom_left_lat);
    const bllng = parseFloat(media.bottom_left_lng);
    const brlat = parseFloat(media.bottom_right_lat);
    const brlng = parseFloat(media.bottom_right_lng);
    if ([tllat,tllng,trlat,trlng,bllat,bllng,brlat,brlng].some(isNaN)) return null;
    return {
      topLeft:     { lat: tllat, lng: tllng },
      topRight:    { lat: trlat, lng: trlng },
      bottomLeft:  { lat: bllat, lng: bllng },
      bottomRight: { lat: brlat, lng: brlng },
    };
  }

  /* ── Alert level ────────────────────────────────────────────── */
  function _determineAlertLevel(lossPct, firePct) {
    if (lossPct < 5 && firePct < 2)  return 'safe';
    if (lossPct < 15 || firePct < 5) return 'warning';
    return 'critical';
  }

  /* ── Image loader ───────────────────────────────────────────── */
  function _loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error(`Cannot load image: ${src}`));
      img.src = src;
    });
  }

  /* ── Browser notification ──────────────────────────────────── */
  function _sendBrowserNotification(name, lossPct, firePct, lat, lng) {
    if (!('Notification' in window)) return;
    const locStr = lat != null ? `\n📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}` : '';
    const send = () => new Notification('🌲 Forest Monitor — CRITICAL', {
      body: `${name}\nLoss: ${lossPct.toFixed(1)}%  Fire: ${firePct.toFixed(1)}%${locStr}`,
      icon: 'favicon.ico',
    });
    if (Notification.permission === 'granted') send();
    else if (Notification.permission !== 'denied')
      Notification.requestPermission().then(p => { if (p === 'granted') send(); });
  }

  /* ── UI helpers ─────────────────────────────────────────────── */
  function _log(msg, level = '') {
    const el = document.getElementById('monitor-log');
    if (!el) return;
    const colors = { error:'#ef4444', warning:'#f59e0b', critical:'#ef4444', safe:'#22c55e' };
    const time   = new Date().toLocaleTimeString();
    el.insertAdjacentHTML('afterbegin',
      `<div style="color:${colors[level]||'#57606a'};font-size:0.82rem">[${time}] ${msg}</div>`
    );
    while (el.children.length > 40) el.removeChild(el.lastChild);
  }
  function _setLastChecked() {
    const el = document.getElementById('monitor-last-checked');
    if (el) el.textContent = 'Last checked: ' + new Date().toLocaleTimeString();
  }
  function _updateToggleUI(on) {
    const btn   = document.getElementById('monitor-toggle');
    const badge = document.getElementById('monitor-status-badge');
    if (btn)   { btn.textContent = on ? 'Auto Monitor: ON' : 'Auto Monitor: OFF'; btn.dataset.on = on ? '1' : '0'; }
    if (badge) { badge.textContent = on ? 'LIVE' : 'OFF'; badge.className = 'monitor-badge ' + (on ? 'badge-live' : 'badge-off'); }
  }
  function _flashAlertBadge() {
    const badge = document.getElementById('alert-count-badge');
    if (!badge) return;
    badge.classList.add('badge-flash');
    setTimeout(() => badge.classList.remove('badge-flash'), 2000);
  }

  /* ── Toggle button wiring ──────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('monitor-toggle');
    if (btn) btn.addEventListener('click', () => window.AutoMonitor.toggle());
  });

})();
