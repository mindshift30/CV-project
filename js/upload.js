/* ============================================================
   Forest Monitor — Upload Handler (v2 — with GPS tagging)
   js/upload.js
   ============================================================ */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {

    const fileInput    = document.getElementById('sat-upload-input');
    const sourceInput  = document.getElementById('sat-upload-source');
    const uploadBtn    = document.getElementById('sat-upload-btn');
    const previewWrap  = document.getElementById('sat-preview-wrap');
    const previewImg   = document.getElementById('sat-preview-img');
    const progressBar  = document.getElementById('sat-progress-bar');
    const progressWrap = document.getElementById('sat-progress-wrap');
    const uploadStatus = document.getElementById('sat-upload-status');

    // GPS coordinate inputs
    const gpsFields = {
      top_left_lat:     document.getElementById('gps-tl-lat'),
      top_left_lng:     document.getElementById('gps-tl-lng'),
      top_right_lat:    document.getElementById('gps-tr-lat'),
      top_right_lng:    document.getElementById('gps-tr-lng'),
      bottom_left_lat:  document.getElementById('gps-bl-lat'),
      bottom_left_lng:  document.getElementById('gps-bl-lng'),
      bottom_right_lat: document.getElementById('gps-br-lat'),
      bottom_right_lng: document.getElementById('gps-br-lng'),
      center_lat:       document.getElementById('gps-center-lat'),
      center_lng:       document.getElementById('gps-center-lng'),
      zoom_level:       document.getElementById('gps-zoom'),
    };
    const exifStatus   = document.getElementById('exif-status');
    const coordPreview = document.getElementById('coord-preview');

    if (!fileInput) return;

    /* ── File selection → preview + EXIF ─────────────────── */
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;

      _setStatus('', '');
      _setProgress(0, false);

      const allowedTypes = ['image/jpeg', 'image/png', 'video/mp4'];
      if (!allowedTypes.includes(file.type)) {
        _setStatus('Only JPG, PNG, and MP4 files are allowed.', 'error');
        fileInput.value = '';
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        _setStatus('File exceeds the 50 MB limit.', 'error');
        fileInput.value = '';
        return;
      }

      // Image preview
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        if (previewImg)  { previewImg.src = url; previewImg.alt = file.name; }
        if (previewWrap) previewWrap.hidden = false;

        // Attempt EXIF GPS extraction
        if (exifStatus) exifStatus.textContent = 'Reading EXIF metadata…';
        try {
          const coords = await readEXIFCoordinates(file);
          if (coords) {
            _fillCenterCoords(coords.lat, coords.lng);
            if (exifStatus) {
              exifStatus.textContent =
                `EXIF GPS found: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`;
              exifStatus.style.color = '#166534';
            }
            _updateCoordPreview(coords.lat, coords.lng);
          } else {
            if (exifStatus) {
              exifStatus.textContent = 'No EXIF GPS data — enter coordinates manually.';
              exifStatus.style.color = '#57606a';
            }
          }
        } catch (e) {
          if (exifStatus) { exifStatus.textContent = 'EXIF read failed.'; exifStatus.style.color = '#ef4444'; }
        }
      } else {
        if (previewWrap) previewWrap.hidden = true;
        if (exifStatus)  exifStatus.textContent = '';
      }

      if (uploadBtn) uploadBtn.disabled = false;
      _setStatus(`Ready to upload: ${file.name} (${_formatBytes(file.size)})`, '');
    });

    /* ── Live coord preview on manual input ──────────────── */
    ['gps-center-lat','gps-center-lng'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', _onCoordInput);
    });

    function _onCoordInput() {
      const lat = parseFloat(gpsFields.center_lat?.value);
      const lng = parseFloat(gpsFields.center_lng?.value);
      if (!isNaN(lat) && !isNaN(lng)) _updateCoordPreview(lat, lng);
    }

    function _updateCoordPreview(lat, lng) {
      if (!coordPreview) return;
      coordPreview.innerHTML = coordDisplayHtml(lat, lng);
    }

    function _fillCenterCoords(lat, lng) {
      if (gpsFields.center_lat) gpsFields.center_lat.value = lat;
      if (gpsFields.center_lng) gpsFields.center_lng.value = lng;
    }

    /* ── Upload button ────────────────────────────────────── */
    if (uploadBtn) {
      uploadBtn.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) return;

        uploadBtn.disabled = true;
        _setProgress(0, true);
        _setStatus('Uploading…', 'running');

        // Collect GPS coordinate fields
        const coords = {};
        let hasAnyCoord = false;
        Object.entries(gpsFields).forEach(([key, el]) => {
          if (el && el.value !== '') {
            coords[key] = key === 'zoom_level' ? parseInt(el.value, 10) : parseFloat(el.value);
            hasAnyCoord = true;
          }
        });

        try {
          const result = await _xhrUpload(
            file,
            sourceInput ? sourceInput.value.trim() : 'Manual',
            hasAnyCoord ? coords : null,
            (pct) => _setProgress(pct, true)
          );

          _setProgress(100, true);
          const locNote = result.center_lat != null
            ? ` — GPS: ${(+result.center_lat).toFixed(5)}, ${(+result.center_lng).toFixed(5)}`
            : '';
          _setStatus(
            `Uploaded — #${result.media_id} (pending)${locNote}`,
            'done'
          );

          if (previewImg && previewImg.src.startsWith('blob:')) URL.revokeObjectURL(previewImg.src);

          // Reset form
          fileInput.value = '';
          if (sourceInput) sourceInput.value = '';
          if (previewWrap) previewWrap.hidden = true;
          if (exifStatus)  exifStatus.textContent = '';
          if (coordPreview) coordPreview.innerHTML = '';
          Object.values(gpsFields).forEach(el => { if (el) el.value = ''; });
          setTimeout(() => _setProgress(0, false), 1500);

          // Refresh map if loaded
          if (window.MapModule) window.MapModule.refresh();

        } catch (err) {
          _setStatus(`Upload failed: ${err.message}`, 'error');
          _setProgress(0, false);
          uploadBtn.disabled = false;
        }
      });
    }

    /* ── XHR upload with progress ─────────────────────────── */
    function _xhrUpload(file, source, coords, onProgress) {
      return new Promise((resolve, reject) => {
        const fd = new FormData();
        fd.append('file',   file);
        fd.append('source', source || 'Manual');
        if (coords) {
          Object.entries(coords).forEach(([k, v]) => fd.append(k, v));
        }

        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'php/api.php?action=upload_image', true);

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener('load', () => {
          try {
            const json = JSON.parse(xhr.responseText);
            if (json.success) resolve(json);
            else reject(new Error(json.error || 'Upload error'));
          } catch { reject(new Error('Invalid server response')); }
        });
        xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
        xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));
        xhr.send(fd);
      });
    }

    /* ── UI helpers ─────────────────────────────────────────── */
    function _setProgress(pct, visible) {
      if (!progressWrap) return;
      progressWrap.hidden = !visible;
      if (progressBar) {
        progressBar.style.width = pct + '%';
        progressBar.setAttribute('aria-valuenow', pct);
      }
    }
    function _setStatus(msg, state) {
      if (!uploadStatus) return;
      uploadStatus.textContent = msg;
      uploadStatus.className   = 'upload-status' + (state ? ' ' + state : '');
    }
    function _formatBytes(bytes) {
      if (bytes < 1024)        return bytes + ' B';
      if (bytes < 1048576)     return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1048576).toFixed(1) + ' MB';
    }

  });

})();
