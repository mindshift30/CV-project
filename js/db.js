/* ============================================================
   Forest Monitor — Supabase Database Client
   js/db.js

   Replaces the PHP/MySQL backend entirely.
   Uses the Supabase JS client loaded via CDN in index.html.

   Set your project URL and anon key in index.html:
     window.SUPABASE_URL = 'https://xxxx.supabase.co'
     window.SUPABASE_KEY = 'your-anon-public-key'
   ============================================================ */

/* ── Lazy Supabase client singleton ─────────────────────────── */
let _sb = null;
function sb() {
  if (!_sb) {
    if (!window.SUPABASE_URL || !window.SUPABASE_KEY) {
      throw new Error('Supabase credentials not set. Add SUPABASE_URL and SUPABASE_KEY to index.html');
    }
    _sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);
  }
  return _sb;
}

/* ── Error helper ────────────────────────────────────────────── */
function _check(error, context) {
  if (error) throw new Error(`[${context}] ${error.message}`);
}

// ════════════════════════════════════════════════════════════
// CORE FUNCTIONS
// ════════════════════════════════════════════════════════════

/**
 * Fetch all satellite_media rows with status='pending'.
 * @returns {Promise<Array>}
 */
async function fetchPendingMedia() {
  const { data, error } = await sb()
    .from('satellite_media')
    .select('*')
    .eq('status', 'pending')
    .order('uploaded_at', { ascending: true });
  _check(error, 'fetchPendingMedia');
  return data ?? [];
}

/**
 * Save a completed analysis result.
 * @param {{ media_id, loss_pct, gain_pct, fire_pct, ndvi_score,
 *           alert_level, notes, affected_lat, affected_lng,
 *           affected_area_km2, pixel_x, pixel_y, bounding_box }} data
 * @returns {Promise<{ result_id: number }>}
 */
async function saveAnalysisResult(data) {
  const { data: rows, error } = await sb()
    .from('analysis_results')
    .insert([{
      media_id:           data.media_id,
      loss_pct:           data.loss_pct           ?? 0,
      gain_pct:           data.gain_pct           ?? 0,
      fire_pct:           data.fire_pct           ?? 0,
      ndvi_score:         data.ndvi_score         ?? 0,
      alert_level:        data.alert_level        ?? 'safe',
      notes:              data.notes              ?? null,
      affected_lat:       data.affected_lat       ?? null,
      affected_lng:       data.affected_lng       ?? null,
      affected_area_km2:  data.affected_area_km2  ?? null,
      pixel_x:            data.pixel_x            ?? null,
      pixel_y:            data.pixel_y            ?? null,
      bounding_box:       data.bounding_box       ?? null,
    }])
    .select('id')
    .single();
  _check(error, 'saveAnalysisResult');

  const resultId = rows.id;

  // Auto-create alerts_log for warning / critical
  if (data.alert_level === 'warning' || data.alert_level === 'critical') {
    const locStr = data.affected_lat != null
      ? ` @ ${(+data.affected_lat).toFixed(5)}, ${(+data.affected_lng).toFixed(5)}`
      : '';
    const message = `Alert level ${data.alert_level.toUpperCase()} — `
                  + `Loss: ${(+data.loss_pct).toFixed(2)}%, `
                  + `Fire: ${(+data.fire_pct).toFixed(2)}%, `
                  + `NDVI: ${(+data.ndvi_score).toFixed(2)}${locStr}`;
    await sb().from('alerts_log').insert([{
      media_id:   data.media_id,
      alert_type: data.alert_level === 'critical' ? 'CRITICAL_ALERT' : 'WARNING_ALERT',
      message,
    }]);
  }

  // Auto-create location_alert if we have coordinates
  if (data.affected_lat != null && data.alert_level !== 'safe') {
    await sb().from('location_alerts').insert([{
      result_id:  resultId,
      lat:        data.affected_lat,
      lng:        data.affected_lng,
      alert_type: (+data.fire_pct > 5) ? 'fire' : 'deforestation',
      severity:   data.alert_level === 'critical' ? 'critical' : 'medium',
      area_km2:   data.affected_area_km2 ?? null,
    }]);
  }

  return { success: true, result_id: resultId };
}

/**
 * Mark a satellite_media row as 'analysed'.
 * @param {number} id
 */
async function markMediaAnalysed(id) {
  const { error } = await sb()
    .from('satellite_media')
    .update({ status: 'analysed' })
    .eq('id', id);
  _check(error, 'markMediaAnalysed');
  return { success: true };
}

/**
 * Fetch full analysis history joined with satellite_media, newest first.
 * @returns {Promise<Array>}
 */
async function fetchHistory() {
  const { data, error } = await sb()
    .from('analysis_results')
    .select(`
      id, media_id, loss_pct, gain_pct, fire_pct, ndvi_score,
      alert_level, notes, analysed_at,
      affected_lat, affected_lng, affected_area_km2,
      pixel_x, pixel_y, bounding_box,
      satellite_media (
        name, file_path, source, type,
        center_lat, center_lng
      )
    `)
    .order('analysed_at', { ascending: false })
    .limit(100);
  _check(error, 'fetchHistory');

  // Flatten nested satellite_media join into top-level keys
  return (data ?? []).map(r => ({
    ...r,
    media_name:       r.satellite_media?.name,
    file_path:        r.satellite_media?.file_path,
    source:           r.satellite_media?.source,
    media_type:       r.satellite_media?.type,
    media_center_lat: r.satellite_media?.center_lat,
    media_center_lng: r.satellite_media?.center_lng,
  }));
}

/**
 * Upload a File to Supabase Storage bucket 'satellite-images'
 * and insert a row into satellite_media.
 * @param {File}   file
 * @param {string} source
 * @param {object} [coords]
 * @returns {Promise<{ media_id, file_path, name }>}
 */
async function uploadMedia(file, source = 'Manual', coords = null) {
  const safeExt   = file.name.split('.').pop().toLowerCase();
  const safeName  = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const storagePath = `satellite/${safeName}`;

  // Upload file to Supabase Storage
  const { error: upErr } = await sb()
    .storage
    .from('satellite-images')
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  _check(upErr, 'uploadMedia:storage');

  // Get public URL
  const { data: urlData } = sb()
    .storage
    .from('satellite-images')
    .getPublicUrl(storagePath);
  const publicUrl = urlData.publicUrl;

  // Build insert row
  const row = {
    name:      file.name,
    file_path: publicUrl,
    type:      file.type.startsWith('video/') ? 'video' : 'image',
    source:    source || 'Manual',
  };
  if (coords) {
    Object.assign(row, {
      top_left_lat:     coords.top_left_lat     ?? null,
      top_left_lng:     coords.top_left_lng     ?? null,
      top_right_lat:    coords.top_right_lat    ?? null,
      top_right_lng:    coords.top_right_lng    ?? null,
      bottom_left_lat:  coords.bottom_left_lat  ?? null,
      bottom_left_lng:  coords.bottom_left_lng  ?? null,
      bottom_right_lat: coords.bottom_right_lat ?? null,
      bottom_right_lng: coords.bottom_right_lng ?? null,
      center_lat:       coords.center_lat       ?? null,
      center_lng:       coords.center_lng       ?? null,
      zoom_level:       coords.zoom_level       ?? 12,
    });
  }

  const { data: inserted, error: insErr } = await sb()
    .from('satellite_media')
    .insert([row])
    .select('id, file_path, name, center_lat, center_lng')
    .single();
  _check(insErr, 'uploadMedia:insert');

  return {
    success:    true,
    media_id:   inserted.id,
    file_path:  inserted.file_path,
    name:       inserted.name,
    center_lat: inserted.center_lat,
    center_lng: inserted.center_lng,
  };
}

/**
 * Fetch all unread alerts_log rows.
 * @returns {Promise<{ data: Array, count: number }>}
 */
async function fetchAlerts() {
  const { data, error } = await sb()
    .from('alerts_log')
    .select(`
      id, media_id, alert_type, message, created_at, is_read,
      satellite_media ( name )
    `)
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(200);
  _check(error, 'fetchAlerts');

  const rows = (data ?? []).map(r => ({
    ...r,
    media_name: r.satellite_media?.name,
  }));
  return { success: true, data: rows, count: rows.length };
}

/**
 * Mark a single alert as read.
 * @param {number} alertId
 */
async function markAlertRead(alertId) {
  const { error } = await sb()
    .from('alerts_log')
    .update({ is_read: true })
    .eq('id', alertId);
  _check(error, 'markAlertRead');
  return { success: true };
}

// ════════════════════════════════════════════════════════════
// LOCATION FUNCTIONS
// ════════════════════════════════════════════════════════════

/**
 * Save a location_alert row.
 * @param {{ result_id, lat, lng, alert_type, severity, area_km2 }} data
 */
async function saveLocationAlert(data) {
  const { data: row, error } = await sb()
    .from('location_alerts')
    .insert([{
      result_id:  data.result_id,
      lat:        data.lat,
      lng:        data.lng,
      alert_type: data.alert_type ?? 'deforestation',
      severity:   data.severity   ?? 'medium',
      area_km2:   data.area_km2   ?? null,
    }])
    .select('id')
    .single();
  _check(error, 'saveLocationAlert');
  return { success: true, id: row.id };
}

/**
 * Fetch all unresolved location_alerts.
 * @param {{ all: boolean }} opts
 */
async function fetchLocationAlerts(opts = {}) {
  let q = sb()
    .from('location_alerts')
    .select(`
      id, result_id, lat, lng, alert_type, severity,
      area_km2, reported_at, is_resolved, authority_notified,
      analysis_results (
        loss_pct, fire_pct, alert_level,
        satellite_media ( name, file_path )
      )
    `)
    .order('reported_at', { ascending: false })
    .limit(500);
  if (!opts.all) q = q.eq('is_resolved', false);
  const { data, error } = await q;
  _check(error, 'fetchLocationAlerts');
  return (data ?? []).map(r => ({
    ...r,
    loss_pct:   r.analysis_results?.loss_pct,
    fire_pct:   r.analysis_results?.fire_pct,
    alert_level:r.analysis_results?.alert_level,
    media_name: r.analysis_results?.satellite_media?.name,
    file_path:  r.analysis_results?.satellite_media?.file_path,
  }));
}

/**
 * Mark a location_alert as resolved.
 * @param {number} id
 */
async function resolveLocationAlert(id) {
  const { error } = await sb()
    .from('location_alerts')
    .update({ is_resolved: true })
    .eq('id', id);
  _check(error, 'resolveLocationAlert');
  return { success: true };
}

/**
 * Fetch all coordinate data for map rendering.
 */
async function fetchMapData() {
  const [resultsRes, alertsRes, centersRes] = await Promise.all([
    sb()
      .from('analysis_results')
      .select('id, media_id, loss_pct, fire_pct, ndvi_score, alert_level, analysed_at, affected_lat, affected_lng, affected_area_km2, satellite_media(name, file_path)')
      .not('affected_lat', 'is', null)
      .order('analysed_at', { ascending: false })
      .limit(500),
    sb()
      .from('location_alerts')
      .select('id, lat, lng, alert_type, severity, area_km2, reported_at, is_resolved, analysis_results(satellite_media(name))')
      .order('reported_at', { ascending: false })
      .limit(500),
    sb()
      .from('satellite_media')
      .select('id, name, center_lat, center_lng, source, zoom_level')
      .not('center_lat', 'is', null)
      .order('uploaded_at', { ascending: false })
      .limit(200),
  ]);

  _check(resultsRes.error, 'fetchMapData:results');
  _check(alertsRes.error,  'fetchMapData:alerts');
  _check(centersRes.error, 'fetchMapData:centers');

  return {
    results: (resultsRes.data ?? []).map(r => ({
      ...r,
      media_name: r.satellite_media?.name,
      file_path:  r.satellite_media?.file_path,
      lat: r.affected_lat,
      lng: r.affected_lng,
      area_km2: r.affected_area_km2,
    })),
    location_alerts: (alertsRes.data ?? []).map(r => ({
      ...r,
      media_name: r.analysis_results?.satellite_media?.name,
    })),
    media_centers: centersRes.data ?? [],
  };
}
