/* ============================================================
   Forest Monitor — Dashboard (v2 — with Location columns)
   js/dashboard.js
   ============================================================ */

(function () {
  'use strict';

  const REFRESH_MS = 60_000;

  window.DashboardModule = {
    prependRow (row) { _prependRow(row); },
    refresh    ()    { _loadDashboard(); },
    _readAlert,      // called by inline onclick
  };

  document.addEventListener('DOMContentLoaded', () => {
    _loadDashboard();
    _loadAlertCount();
    setInterval(_loadDashboard,  REFRESH_MS);
    setInterval(_loadAlertCount, REFRESH_MS);

    const clearBtn = document.getElementById('alerts-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        try {
          await apiRequest({ action: 'mark_alert_read' }, { all: true });
          _loadAlertCount();
        } catch (e) { console.error('[Dashboard] Clear alerts error:', e); }
      });
    }
  });

  /* ── Load & render history table ─────────────────────────── */
  async function _loadDashboard() {
    const tbody = document.getElementById('dashboard-tbody');
    const empty = document.getElementById('dashboard-empty');
    if (!tbody) return;
    try {
      const rows = await fetchHistory();
      if (rows.length === 0) {
        tbody.innerHTML = '';
        if (empty) empty.hidden = false;
        return;
      }
      if (empty) empty.hidden = true;
      tbody.innerHTML = rows.map(_rowHtml).join('');
    } catch (err) {
      console.error('[Dashboard] Load error:', err);
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="11" style="color:#ef4444;text-align:center">
          Failed to load history: ${err.message}</td></tr>`;
      }
    }
  }

  /* ── Build a single <tr> ─────────────────────────────────── */
  function _rowHtml(r) {
    const bg  = { safe: '#f0fdf4', warning: '#fefce8', critical: '#fef2f2' };
    const fg  = { safe: '#166534', warning: '#854d0e', critical: '#991b1b' };
    const dot = { safe: '#22c55e', warning: '#eab308', critical: '#ef4444' };

    const level  = r.alert_level || 'safe';
    const date   = new Date(r.analysed_at).toLocaleString('en-GB', {
                     day:'2-digit', month:'short', year:'numeric',
                     hour:'2-digit', minute:'2-digit'
                   });
    const thumb  = r.file_path
      ? `<img src="${_esc(r.file_path)}" alt="${_esc(r.media_name)}"
              style="width:52px;height:36px;object-fit:cover;border-radius:4px">`
      : '—';

    // Coordinates + action buttons
    const lat = r.affected_lat != null ? parseFloat(r.affected_lat) : null;
    const lng = r.affected_lng != null ? parseFloat(r.affected_lng) : null;
    let coordCell = '<span style="color:#57606a;font-size:0.75rem">—</span>';
    let areaCell  = r.affected_area_km2 != null
                    ? `${(+r.affected_area_km2).toFixed(4)} km²`
                    : '—';

    if (lat != null && lng != null) {
      coordCell = coordDisplayHtml(lat, lng);
    }

    // Map button — pans Leaflet map to the location
    const mapBtn = lat != null
      ? `<button onclick="MapModule && MapModule.panTo(${lat},${lng},14)"
            style="font-size:0.73rem;padding:2px 8px;border:1px solid #3b82d4;
                   color:#3b82d4;background:none;border-radius:4px;cursor:pointer;margin-top:4px">
           Map ↗
         </button>`
      : '';

    // Report button
    const reportBtn = `
      <button onclick="DashboardModule._showReport(${JSON.stringify(r).replace(/"/g,'&quot;')})"
         style="font-size:0.73rem;padding:2px 8px;border:1px solid #57606a;
                color:#57606a;background:none;border-radius:4px;cursor:pointer;margin-top:4px">
        Report
      </button>`;

    return `
      <tr style="background:${bg[level]}">
        <td>${thumb}</td>
        <td style="font-size:0.82rem;max-width:130px;word-break:break-word">${_esc(r.media_name)}</td>
        <td style="font-size:0.79rem;white-space:nowrap">${date}</td>
        <td style="text-align:right">${r.loss_pct}%</td>
        <td style="text-align:right">${r.gain_pct}%</td>
        <td style="text-align:right">${r.fire_pct}%</td>
        <td style="text-align:right">${r.ndvi_score}</td>
        <td style="min-width:160px">${coordCell}${mapBtn}</td>
        <td style="text-align:right;white-space:nowrap">${areaCell}</td>
        <td>
          <span style="display:inline-flex;align-items:center;gap:4px;
                       padding:2px 8px;border-radius:99px;font-size:0.78rem;font-weight:600;
                       color:${fg[level]};background:${bg[level]};border:1px solid ${dot[level]}">
            <span style="width:7px;height:7px;border-radius:50%;background:${dot[level]}"></span>
            ${level.charAt(0).toUpperCase() + level.slice(1)}
          </span>
        </td>
        <td>${reportBtn}</td>
      </tr>`;
  }

  /* ── Show alert report modal ─────────────────────────────── */
  window.DashboardModule._showReport = function(r) {
    const { text } = generateAlertReport(r);
    const modal = document.getElementById('report-modal');
    const body  = document.getElementById('report-modal-body');
    if (!modal || !body) {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(text).catch(() => alert(text));
      return;
    }
    body.textContent = text;
    modal.hidden = false;
  };

  /* ── Prepend row (used by auto-analyser) ─────────────────── */
  function _prependRow(row) {
    const tbody = document.getElementById('dashboard-tbody');
    const empty = document.getElementById('dashboard-empty');
    if (!tbody) return;
    if (empty) empty.hidden = true;
    tbody.insertAdjacentHTML('afterbegin', _rowHtml(row));
  }

  /* ── Alert badge + dropdown ──────────────────────────────── */
  async function _loadAlertCount() {
    const badge = document.getElementById('alert-count-badge');
    if (!badge) return;
    try {
      const res   = await fetchAlerts();
      const count = res.count ?? 0;
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden      = count === 0;
      _renderAlertsDropdown(res.data ?? []);
    } catch (e) {
      console.error('[Dashboard] Alert count error:', e);
    }
  }

  function _renderAlertsDropdown(alerts) {
    const list = document.getElementById('alerts-list');
    if (!list) return;
    if (alerts.length === 0) {
      list.innerHTML = '<li style="padding:8px 12px;color:#57606a">No unread alerts</li>';
      return;
    }
    list.innerHTML = alerts.slice(0, 10).map(a => {
      const dot = a.alert_type === 'CRITICAL_ALERT' ? '#ef4444' : '#f59e0b';
      return `
        <li style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:0.82rem;
                   display:flex;gap:8px;align-items:flex-start;cursor:pointer"
            data-alert-id="${a.id}"
            onclick="DashboardModule._readAlert(this,${a.id})">
          <span style="width:8px;height:8px;border-radius:50%;background:${dot};
                       margin-top:4px;flex-shrink:0"></span>
          <span>
            <strong>${_esc(a.media_name)}</strong><br>
            <span style="color:#57606a">${_esc(a.message || '')}</span>
          </span>
        </li>`;
    }).join('');
  }

  async function _readAlert(li, id) {
    try {
      await markAlertRead(id);
      li.style.opacity = '0.4';
      _loadAlertCount();
    } catch (e) { /* silent */ }
  }

  /* ── Helper ──────────────────────────────────────────────── */
  function _esc(str) {
    return String(str ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

})();
