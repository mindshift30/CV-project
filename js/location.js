/* ============================================================
   Forest Monitor — Location Utilities
   js/location.js

   Provides GPS coordinate conversion, EXIF reading,
   area estimation, and report generation.

   Requires: exifr (loaded via CDN in index.html)
   ============================================================ */

'use strict';

/* ═══════════════════════════════════════════════════════════
   1. pixelToGPS
   Convert a pixel position (x, y) within a W×H image to
   real-world GPS coordinates using bilinear interpolation
   across the four corner coordinates.
   ═══════════════════════════════════════════════════════════ */
/**
 * @param {number} x        - pixel column (0 = left)
 * @param {number} y        - pixel row    (0 = top)
 * @param {number} W        - image width  in pixels
 * @param {number} H        - image height in pixels
 * @param {{ topLeft, topRight, bottomLeft, bottomRight }} corners
 *   Each corner: { lat: number, lng: number }
 * @returns {{ lat: number, lng: number }}
 */
function pixelToGPS(x, y, W, H, corners) {
  const { topLeft: tl, topRight: tr, bottomLeft: bl, bottomRight: br } = corners;

  const tx = W > 1 ? x / (W - 1) : 0;   // normalised [0,1]
  const ty = H > 1 ? y / (H - 1) : 0;

  // Bilinear interpolation: top edge then bottom edge, then blend vertically
  const topLat  = tl.lat + tx * (tr.lat  - tl.lat);
  const topLng  = tl.lng + tx * (tr.lng  - tl.lng);
  const botLat  = bl.lat + tx * (br.lat  - bl.lat);
  const botLng  = bl.lng + tx * (br.lng  - bl.lng);

  return {
    lat: +(topLat + ty * (botLat - topLat)).toFixed(7),
    lng: +(topLng + ty * (botLng - topLng)).toFixed(7),
  };
}

/* ═══════════════════════════════════════════════════════════
   2. getContourCenter
   Given a flat array of {x,y} points (OpenCV-style contour),
   return the centroid pixel.
   ═══════════════════════════════════════════════════════════ */
/**
 * @param {Array<{x:number, y:number}>} contour
 * @returns {{ x: number, y: number }}
 */
function getContourCenter(contour) {
  if (!contour || contour.length === 0) return { x: 0, y: 0 };
  let sumX = 0, sumY = 0;
  for (const pt of contour) { sumX += pt.x; sumY += pt.y; }
  return {
    x: Math.round(sumX / contour.length),
    y: Math.round(sumY / contour.length),
  };
}

/* ═══════════════════════════════════════════════════════════
   3. estimateAreaKm2
   Estimate the real-world area (km²) of a detected region
   given its pixel count, the image dimensions, and the
   four GPS corner coordinates.

   Uses the Haversine formula to compute the width and height
   of the image footprint, then scales by pixel density.
   ═══════════════════════════════════════════════════════════ */
/**
 * @param {number} pixelCount   - number of flagged pixels
 * @param {number} W            - image width in pixels
 * @param {number} H            - image height in pixels
 * @param {{ topLeft, topRight, bottomLeft, bottomRight }} corners
 * @returns {number}  area in km²
 */
function estimateAreaKm2(pixelCount, W, H, corners) {
  const { topLeft: tl, topRight: tr, bottomLeft: bl } = corners;

  const widthKm  = _haversineKm(tl.lat, tl.lng, tr.lat, tr.lng);
  const heightKm = _haversineKm(tl.lat, tl.lng, bl.lat, bl.lng);

  if (W <= 0 || H <= 0 || widthKm === 0 || heightKm === 0) return 0;

  const pixelAreaKm2 = (widthKm * heightKm) / (W * H);
  return +(pixelCount * pixelAreaKm2).toFixed(4);
}

/** Haversine distance in km between two lat/lng points */
function _haversineKm(lat1, lng1, lat2, lng2) {
  const R   = 6371;
  const dLat = _toRad(lat2 - lat1);
  const dLng = _toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2))
          * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function _toRad(deg) { return deg * (Math.PI / 180); }

/* ═══════════════════════════════════════════════════════════
   4. readEXIFCoordinates
   Uses exifr.js to extract GPSLatitude / GPSLongitude from
   an image File object.  Returns null if not found.
   ═══════════════════════════════════════════════════════════ */
/**
 * @param {File} file
 * @returns {Promise<{lat:number, lng:number}|null>}
 */
async function readEXIFCoordinates(file) {
  try {
    if (typeof exifr === 'undefined') {
      console.warn('[Location] exifr.js not loaded — EXIF skipped.');
      return null;
    }
    const gps = await exifr.gps(file);
    if (gps && gps.latitude != null && gps.longitude != null) {
      return {
        lat: +gps.latitude.toFixed(7),
        lng: +gps.longitude.toFixed(7),
      };
    }
  } catch (e) {
    console.warn('[Location] EXIF read error:', e.message);
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════
   5. generateGoogleMapsLink
   ═══════════════════════════════════════════════════════════ */
/**
 * @param {number} lat
 * @param {number} lng
 * @param {number} [zoom=15]
 * @returns {string}  Google Maps URL
 */
function generateGoogleMapsLink(lat, lng, zoom = 15) {
  return `https://maps.google.com/?q=${lat},${lng}&z=${zoom}`;
}

/** Street View link */
function generateStreetViewLink(lat, lng) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}

/* ═══════════════════════════════════════════════════════════
   6. generateAlertReport
   Produces a formatted plain-text + HTML report for a result.
   ═══════════════════════════════════════════════════════════ */
/**
 * @param {{ alert_level, affected_lat, affected_lng, affected_area_km2,
 *           loss_pct, fire_pct, ndvi_score, analysed_at, media_name }} result
 * @returns {{ text: string, html: string }}
 */
function generateAlertReport(result) {
  const lat   = result.affected_lat  ?? null;
  const lng   = result.affected_lng  ?? null;
  const area  = result.affected_area_km2 != null
                ? (+result.affected_area_km2).toFixed(4) + ' km²'
                : 'Unknown';
  const level  = (result.alert_level || 'safe').toUpperCase();
  const mapsUrl = lat != null && lng != null
                  ? generateGoogleMapsLink(lat, lng)
                  : null;
  const date   = result.analysed_at
                 ? new Date(result.analysed_at).toLocaleString('en-GB', {
                     day:'2-digit', month:'short', year:'numeric',
                     hour:'2-digit', minute:'2-digit'
                   })
                 : 'Unknown';

  const coordLine = lat != null
    ? `${formatCoordDMS(lat, 'lat')}  ${formatCoordDMS(lng, 'lng')}`
    : 'Coordinates not set';

  const text = [
    '⚠️  DEFORESTATION DETECTED',
    `Image     : ${result.media_name || 'Unknown'}`,
    `Location  : ${coordLine}`,
    `Decimal   : ${lat ?? 'N/A'}, ${lng ?? 'N/A'}`,
    `Area Lost : ${area}`,
    `Loss      : ${(+result.loss_pct || 0).toFixed(2)}%`,
    `Fire      : ${(+result.fire_pct || 0).toFixed(2)}%`,
    `NDVI Score: ${(+result.ndvi_score || 0).toFixed(2)}`,
    `Alert     : ${level}`,
    mapsUrl ? `Google Maps: ${mapsUrl}` : '',
    `Detected  : ${date}`,
  ].filter(Boolean).join('\n');

  const colors = { SAFE:'#166534', WARNING:'#854d0e', CRITICAL:'#991b1b' };
  const bgs    = { SAFE:'#f0fdf4', WARNING:'#fefce8', CRITICAL:'#fef2f2' };
  const color  = colors[level] || '#333';
  const bg     = bgs[level]    || '#fff';

  const html = `
    <div style="font-family:monospace;font-size:0.82rem;background:${bg};
                border:1px solid ${color};border-radius:8px;padding:14px 16px;
                color:${color};white-space:pre-wrap;line-height:1.7">
${_escHtml(text)}${mapsUrl ? `\n<a href="${_escHtml(mapsUrl)}" target="_blank"
  rel="noopener" style="color:${color};font-weight:700">Open in Google Maps ↗</a>` : ''}
    </div>`;

  return { text, html };
}

/* ═══════════════════════════════════════════════════════════
   Coordinate formatting helpers
   ═══════════════════════════════════════════════════════════ */

/**
 * Format decimal degrees as DMS string.
 * @param {number} decimal
 * @param {'lat'|'lng'} axis
 * @returns {string}  e.g. "11°7'37.56\"N"
 */
function formatCoordDMS(decimal, axis) {
  const abs  = Math.abs(decimal);
  const deg  = Math.floor(abs);
  const minF = (abs - deg) * 60;
  const min  = Math.floor(minF);
  const sec  = ((minF - min) * 60).toFixed(2);
  let dir;
  if (axis === 'lat') dir = decimal >= 0 ? 'N' : 'S';
  else                dir = decimal >= 0 ? 'E' : 'W';
  return `${deg}°${min}'${sec}"${dir}`;
}

/**
 * Build a full 3-format coordinate display HTML block.
 * @param {number} lat
 * @param {number} lng
 * @returns {string} HTML
 */
function coordDisplayHtml(lat, lng) {
  if (lat == null || lng == null) return '<em style="color:#57606a">No coordinates</em>';
  const dec     = `${lat}, ${lng}`;
  const dms     = `${formatCoordDMS(lat,'lat')}  ${formatCoordDMS(lng,'lng')}`;
  const mapsUrl = generateGoogleMapsLink(lat, lng);
  const svUrl   = generateStreetViewLink(lat, lng);
  return `
    <div style="font-size:0.78rem;line-height:1.9">
      <div title="Decimal degrees">${_escHtml(dec)}</div>
      <div title="Degrees Minutes Seconds" style="color:#57606a">${_escHtml(dms)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
        <a href="${_escHtml(mapsUrl)}" target="_blank" rel="noopener"
           style="font-size:0.75rem;color:#3b82d4;text-decoration:none;
                  border:1px solid #3b82d4;border-radius:4px;padding:1px 7px">
          Maps ↗
        </a>
        <a href="${_escHtml(svUrl)}" target="_blank" rel="noopener"
           style="font-size:0.75rem;color:#7c5cd8;text-decoration:none;
                  border:1px solid #7c5cd8;border-radius:4px;padding:1px 7px">
          Street View ↗
        </a>
        <button onclick="navigator.clipboard.writeText('${lat},${lng}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)"
           style="font-size:0.75rem;color:#57606a;background:none;border:1px solid #d1d5db;
                  border-radius:4px;padding:1px 7px;cursor:pointer">
          Copy
        </button>
      </div>
    </div>`;
}

/* ── Internal HTML escape ─────────────────────────────────── */
function _escHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
