/* ============================================================
   Forest Monitor — Database API Client (v2 — with Location)
   js/db.js
   ============================================================ */

// Auto-detect: Vercel production uses /api/, localhost uses php/api.php
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'php/api.php'
  : '/api/';

async function apiRequest(params = {}, body = null, method = 'GET') {
  const url = new URL(API_BASE, window.location.href);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const opts = { method };
  if (body !== null) {
    if (body instanceof FormData) {
      opts.body = body;
    } else {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body    = JSON.stringify(body);
      opts.method  = 'POST';
    }
  }

  const res  = await fetch(url.toString(), opts);
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json;
}

// ── Core functions ─────────────────────────────────────────────

async function fetchPendingMedia() {
  const json = await apiRequest({ action: 'get_pending' });
  return json.data ?? [];
}

async function saveAnalysisResult(data) {
  return apiRequest({ action: 'save_result' }, data);
}

async function markMediaAnalysed(id) {
  return apiRequest({ action: 'mark_analysed' }, { media_id: id });
}

async function fetchHistory() {
  const json = await apiRequest({ action: 'get_history' });
  return json.data ?? [];
}

async function uploadMedia(file, source = 'Manual', coords = null) {
  const fd = new FormData();
  fd.append('file',   file);
  fd.append('source', source);
  if (coords) {
    // Flatten corners + center into form fields
    const fields = [
      'top_left_lat','top_left_lng','top_right_lat','top_right_lng',
      'bottom_left_lat','bottom_left_lng','bottom_right_lat','bottom_right_lng',
      'center_lat','center_lng','zoom_level',
    ];
    fields.forEach(f => { if (coords[f] != null) fd.append(f, coords[f]); });
  }
  return apiRequest({ action: 'upload_image' }, fd, 'POST');
}

async function fetchAlerts() {
  return apiRequest({ action: 'get_alerts' });
}

async function markAlertRead(alertId) {
  return apiRequest({ action: 'mark_alert_read' }, { id: alertId });
}

// ── Location functions ──────────────────────────────────────────

/**
 * Save a location_alert row.
 * @param {{ result_id, lat, lng, alert_type, severity, area_km2 }} data
 */
async function saveLocationAlert(data) {
  return apiRequest({ action: 'save_location_alert' }, data);
}

/**
 * Fetch all location_alerts (unresolved by default).
 * Pass { all: true } to include resolved ones.
 */
async function fetchLocationAlerts(opts = {}) {
  const params = { action: 'get_location_alerts' };
  if (opts.all)  params.all  = '1';
  const json = await apiRequest(params);
  return json.data ?? [];
}

/**
 * Mark a location_alert as resolved.
 * @param {number} id
 */
async function resolveLocationAlert(id) {
  return apiRequest({ action: 'resolve_alert' }, { id });
}

/**
 * Fetch all lat/lng data points for map rendering.
 * Returns { results: Array, location_alerts: Array }
 */
async function fetchMapData() {
  return apiRequest({ action: 'get_map_data' });
}
