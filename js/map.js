/* ============================================================
   Forest Monitor — Leaflet Map Handler
   js/map.js

   Renders a live map with deforestation and fire markers.
   Auto-updates every 60 seconds.

   Requires:
     Leaflet CSS + JS (loaded via CDN in index.html)
     location.js (for generateGoogleMapsLink)
     db.js       (for fetchHistory, fetchLocationAlerts)
   ============================================================ */

(function () {
  'use strict';

  const MAP_REFRESH_MS = 60_000;
  const MAP_DIV_ID     = 'forest-map';

  let   leafletMap   = null;
  let   markerLayer  = null;
  let   heatLayer    = null;   // leaflet-heat (optional, CDN-loaded)

  /* ── Marker icon factories ─────────────────────────────── */
  const _makeIcon = (color) => L.divIcon({
    className: '',
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:${color};border:2px solid #fff;
      box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize:   [14, 14],
    iconAnchor: [ 7,  7],
    popupAnchor:[ 0,-10],
  });

  const icons = {
    deforestation : _makeIcon('#ef4444'),
    fire          : _makeIcon('#f97316'),
    safe          : _makeIcon('#22c55e'),
    warning       : _makeIcon('#eab308'),
    critical      : _makeIcon('#ef4444'),
  };

  /* ── Init map ───────────────────────────────────────────── */
  function initMap() {
    const container = document.getElementById(MAP_DIV_ID);
    if (!container || typeof L === 'undefined') return;

    leafletMap = L.map(MAP_DIV_ID, {
      center: [0, 20],
      zoom:   3,
      scrollWheelZoom: true,
    });

    /* OpenStreetMap tile layer (free, no API key) */
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(leafletMap);

    markerLayer = L.layerGroup().addTo(leafletMap);

    /* Optional layer control */
    const baseMaps = {};
    const overlays = { 'Detection Markers': markerLayer };
    L.control.layers(baseMaps, overlays, { collapsed: false }).addTo(leafletMap);

    _loadMarkers();
    setInterval(_loadMarkers, MAP_REFRESH_MS);
  }

  /* ── Load markers from history ─────────────────────────── */
  async function _loadMarkers() {
    if (!leafletMap) return;
    try {
      const rows = await fetchHistory();
      _renderMarkers(rows);
    } catch (e) {
      console.error('[Map] Load error:', e);
    }
  }

  /* ── Render markers ─────────────────────────────────────── */
  function _renderMarkers(rows) {
    markerLayer.clearLayers();
    const heatPoints = [];

    for (const r of rows) {
      const lat = parseFloat(r.affected_lat);
      const lng = parseFloat(r.affected_lng);
      if (isNaN(lat) || isNaN(lng)) continue;

      const level    = r.alert_level || 'safe';
      const isFire   = +r.fire_pct > 5;
      const iconKey  = isFire ? 'fire' : level;
      const icon     = icons[iconKey] || icons.safe;

      const mapsUrl  = generateGoogleMapsLink(lat, lng);
      const area     = r.affected_area_km2 != null
                       ? `${(+r.affected_area_km2).toFixed(4)} km²`
                       : '—';
      const date     = new Date(r.analysed_at).toLocaleString('en-GB', {
                         day:'2-digit', month:'short', year:'numeric',
                         hour:'2-digit', minute:'2-digit'
                       });

      const popupHtml = `
        <div style="font-size:0.82rem;line-height:1.6;min-width:200px">
          <strong style="font-size:0.9rem">${_esc(r.media_name || '—')}</strong><br>
          <span style="color:#57606a">${date}</span><br>
          <hr style="margin:6px 0;border-color:#e5e7eb">
          Loss: <b>${r.loss_pct}%</b> &nbsp;|&nbsp;
          Fire: <b>${r.fire_pct}%</b><br>
          Area: <b>${area}</b><br>
          <span style="font-size:0.75rem;color:#57606a">${lat.toFixed(5)}, ${lng.toFixed(5)}</span><br>
          <a href="${_esc(mapsUrl)}" target="_blank" rel="noopener"
             style="color:#3b82d4;font-size:0.78rem">Open in Google Maps ↗</a>
        </div>`;

      const marker = L.marker([lat, lng], { icon })
                      .bindPopup(popupHtml);
      markerLayer.addLayer(marker);

      // Collect heat points (weighted by loss_pct)
      const weight = Math.min(1, (+r.loss_pct + +r.fire_pct) / 30);
      heatPoints.push([lat, lng, weight]);
    }

    /* Heatmap overlay — requires leaflet-heat CDN plugin */
    if (typeof L.heatLayer === 'function') {
      if (heatLayer) leafletMap.removeLayer(heatLayer);
      heatLayer = L.heatLayer(heatPoints, {
        radius:  25,
        blur:    20,
        maxZoom: 15,
        gradient: { 0.3: '#22c55e', 0.6: '#f59e0b', 1.0: '#ef4444' },
      }).addTo(leafletMap);
    }

    /* Auto-fit bounds if markers exist */
    const layers = markerLayer.getLayers();
    if (layers.length > 0) {
      try {
        const group = new L.featureGroup(layers);
        leafletMap.fitBounds(group.getBounds().pad(0.1), { maxZoom: 10 });
      } catch (_) { /* silent — bounds fit is best-effort */ }
    }
  }

  /* ── Pan map to a coordinate (callable externally) ─────── */
  window.MapModule = {
    panTo(lat, lng, zoom = 13) {
      if (!leafletMap) return;
      leafletMap.setView([lat, lng], zoom);
    },
    refresh() {
      _loadMarkers();
    },
    init: initMap,
  };

  /* ── Boot on DOM ready ──────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', initMap);

  /* ── Legend control ─────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    // Inject map legend below the map div if it exists
    const container = document.getElementById(MAP_DIV_ID);
    if (!container) return;
    const legend = document.createElement('div');
    legend.id    = 'map-legend';
    legend.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;padding:8px 0;font-size:0.8rem;color:#57606a';
    legend.innerHTML = [
      ['#ef4444', 'Deforestation / Critical'],
      ['#f97316', 'Fire Detected'],
      ['#eab308', 'Warning'],
      ['#22c55e', 'Safe / Gain'],
    ].map(([c, l]) =>
      `<span style="display:flex;align-items:center;gap:5px">
         <span style="width:11px;height:11px;border-radius:50%;background:${c};border:2px solid #fff;
                      box-shadow:0 1px 3px rgba(0,0,0,.3);display:inline-block"></span>
         ${l}
       </span>`
    ).join('');
    container.insertAdjacentElement('afterend', legend);
  });

  /* ── Helper ─────────────────────────────────────────────── */
  function _esc(str) {
    return String(str ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

})();
