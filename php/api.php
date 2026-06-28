<?php
/* ============================================================
   Forest Monitor — REST API (v2 — with Location Tracking)
   php/api.php
   ============================================================ */

require_once __DIR__ . '/config.php';

$action = $_REQUEST['action'] ?? '';

try {
    switch ($action) {
        case 'get_pending':           getPending();          break;
        case 'save_result':           saveResult();          break;
        case 'mark_analysed':         markAnalysed();        break;
        case 'get_history':           getHistory();          break;
        case 'upload_image':          uploadImage();         break;
        case 'get_alerts':            getAlerts();           break;
        case 'mark_alert_read':       markAlertRead();       break;
        // ── Location actions ──────────────────────────────
        case 'save_location_alert':   saveLocationAlert();   break;
        case 'get_location_alerts':   getLocationAlerts();   break;
        case 'resolve_alert':         resolveAlert();        break;
        case 'get_map_data':          getMapData();          break;
        default:
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Unknown action: ' . htmlspecialchars($action)]);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}

// ════════════════════════════════════════════════════════════
// EXISTING HANDLERS
// ════════════════════════════════════════════════════════════

function getPending(): void {
    $stmt = db()->prepare(
        "SELECT id, name, file_path, type, uploaded_at, source,
                top_left_lat, top_left_lng, top_right_lat, top_right_lng,
                bottom_left_lat, bottom_left_lng, bottom_right_lat, bottom_right_lng,
                center_lat, center_lng, zoom_level
         FROM satellite_media
         WHERE status = 'pending'
         ORDER BY uploaded_at ASC"
    );
    $stmt->execute();
    echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
}

function saveResult(): void {
    $body = getJsonBody();

    $mediaId    = (int)   ($body['media_id']    ?? 0);
    $lossPct    = (float) ($body['loss_pct']    ?? 0);
    $gainPct    = (float) ($body['gain_pct']    ?? 0);
    $firePct    = (float) ($body['fire_pct']    ?? 0);
    $ndviScore  = (float) ($body['ndvi_score']  ?? 0);
    $alertLevel = trim(   ($body['alert_level'] ?? 'safe'));
    $notes      = trim(   ($body['notes']       ?? ''));

    // ── Location fields ───────────────────────────────────
    $affectedLat  = isset($body['affected_lat'])       ? (float) $body['affected_lat']       : null;
    $affectedLng  = isset($body['affected_lng'])       ? (float) $body['affected_lng']       : null;
    $areaKm2      = isset($body['affected_area_km2'])  ? (float) $body['affected_area_km2']  : null;
    $pixelX       = isset($body['pixel_x'])            ? (int)   $body['pixel_x']            : null;
    $pixelY       = isset($body['pixel_y'])            ? (int)   $body['pixel_y']            : null;
    $boundingBox  = isset($body['bounding_box'])       ? json_encode($body['bounding_box'])  : null;

    if ($mediaId <= 0) {
        http_response_code(422);
        echo json_encode(['success' => false, 'error' => 'media_id is required']);
        return;
    }

    $allowed = ['safe', 'warning', 'critical'];
    if (!in_array($alertLevel, $allowed, true)) $alertLevel = 'safe';

    $pdo = db();

    $stmt = $pdo->prepare(
        "INSERT INTO analysis_results
           (media_id, loss_pct, gain_pct, fire_pct, ndvi_score, alert_level, notes,
            affected_lat, affected_lng, affected_area_km2, pixel_x, pixel_y, bounding_box)
         VALUES
           (:media_id, :loss_pct, :gain_pct, :fire_pct, :ndvi_score, :alert_level, :notes,
            :affected_lat, :affected_lng, :affected_area_km2, :pixel_x, :pixel_y, :bounding_box)"
    );
    $stmt->execute([
        ':media_id'          => $mediaId,
        ':loss_pct'          => $lossPct,
        ':gain_pct'          => $gainPct,
        ':fire_pct'          => $firePct,
        ':ndvi_score'        => $ndviScore,
        ':alert_level'       => $alertLevel,
        ':notes'             => $notes ?: null,
        ':affected_lat'      => $affectedLat,
        ':affected_lng'      => $affectedLng,
        ':affected_area_km2' => $areaKm2,
        ':pixel_x'           => $pixelX,
        ':pixel_y'           => $pixelY,
        ':bounding_box'      => $boundingBox,
    ]);
    $resultId = (int) $pdo->lastInsertId();

    // Auto-create alerts_log
    if (in_array($alertLevel, ['warning', 'critical'], true)) {
        $alertType = $alertLevel === 'critical' ? 'CRITICAL_ALERT' : 'WARNING_ALERT';
        $locStr    = ($affectedLat !== null)
                     ? sprintf(' @ %.5f, %.5f', $affectedLat, $affectedLng)
                     : '';
        $message   = sprintf(
            'Alert level %s — Loss: %.2f%%, Fire: %.2f%%, NDVI: %.2f%s',
            strtoupper($alertLevel), $lossPct, $firePct, $ndviScore, $locStr
        );
        $aStmt = $pdo->prepare(
            "INSERT INTO alerts_log (media_id, alert_type, message)
             VALUES (:media_id, :alert_type, :message)"
        );
        $aStmt->execute([
            ':media_id'   => $mediaId,
            ':alert_type' => $alertType,
            ':message'    => $message,
        ]);
    }

    // Auto-create location_alert if we have coordinates
    if ($affectedLat !== null && $affectedLng !== null && $alertLevel !== 'safe') {
        $severity  = $alertLevel === 'critical' ? 'critical' : 'medium';
        $alertType = $firePct > 5 ? 'fire' : 'deforestation';
        $laStmt = $pdo->prepare(
            "INSERT INTO location_alerts (result_id, lat, lng, alert_type, severity, area_km2)
             VALUES (:result_id, :lat, :lng, :alert_type, :severity, :area_km2)"
        );
        $laStmt->execute([
            ':result_id'  => $resultId,
            ':lat'        => $affectedLat,
            ':lng'        => $affectedLng,
            ':alert_type' => $alertType,
            ':severity'   => $severity,
            ':area_km2'   => $areaKm2,
        ]);
    }

    echo json_encode(['success' => true, 'result_id' => $resultId]);
}

function markAnalysed(): void {
    $body    = getJsonBody();
    $mediaId = (int) ($body['media_id'] ?? 0);
    if ($mediaId <= 0) {
        http_response_code(422);
        echo json_encode(['success' => false, 'error' => 'media_id is required']);
        return;
    }
    $stmt = db()->prepare("UPDATE satellite_media SET status = 'analysed' WHERE id = :id");
    $stmt->execute([':id' => $mediaId]);
    echo json_encode(['success' => true, 'affected' => $stmt->rowCount()]);
}

function getHistory(): void {
    $limit = min((int) ($_GET['limit'] ?? 100), 1000);
    $stmt  = db()->prepare(
        "SELECT
           r.id, r.media_id,
           m.name          AS media_name,
           m.file_path,
           m.source,
           m.type          AS media_type,
           m.center_lat    AS media_center_lat,
           m.center_lng    AS media_center_lng,
           r.loss_pct, r.gain_pct, r.fire_pct, r.ndvi_score,
           r.alert_level,  r.notes,
           r.affected_lat, r.affected_lng,
           r.affected_area_km2,
           r.pixel_x,      r.pixel_y,
           r.bounding_box,
           r.analysed_at
         FROM analysis_results r
         JOIN satellite_media  m ON m.id = r.media_id
         ORDER BY r.analysed_at DESC
         LIMIT :lim"
    );
    $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();
    // Decode bounding_box JSON
    foreach ($rows as &$row) {
        if ($row['bounding_box']) {
            $row['bounding_box'] = json_decode($row['bounding_box'], true);
        }
    }
    unset($row);
    echo json_encode(['success' => true, 'data' => $rows]);
}

function uploadImage(): void {
    if (empty($_FILES['file'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'No file uploaded']);
        return;
    }
    $file   = $_FILES['file'];
    $source = trim($_POST['source'] ?? 'Manual');

    if ($file['size'] > MAX_FILE_BYTES) {
        http_response_code(413);
        echo json_encode(['success' => false, 'error' => 'File exceeds 50 MB limit']);
        return;
    }
    $finfo    = new finfo(FILEINFO_MIME_TYPE);
    $mimeType = $finfo->file($file['tmp_name']);
    if (!in_array($mimeType, ALLOWED_TYPES, true)) {
        http_response_code(415);
        echo json_encode(['success' => false, 'error' => 'File type not allowed. Use JPG, PNG, or MP4.']);
        return;
    }
    $origExt = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!in_array($origExt, ALLOWED_EXT, true)) {
        http_response_code(415);
        echo json_encode(['success' => false, 'error' => 'File extension not allowed.']);
        return;
    }
    if (!is_dir(UPLOAD_DIR)) mkdir(UPLOAD_DIR, 0755, true);

    $safeName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', pathinfo($file['name'], PATHINFO_FILENAME));
    $safeName = substr($safeName, 0, 100);
    $filename = $safeName . '_' . uniqid() . '.' . $origExt;
    $destPath = UPLOAD_DIR . $filename;
    $urlPath  = UPLOAD_URL_BASE . $filename;

    if (!move_uploaded_file($file['tmp_name'], $destPath)) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Failed to save file on server']);
        return;
    }

    $mediaType = str_starts_with($mimeType, 'video/') ? 'video' : 'image';

    // ── Parse GPS corner fields from POST ────────────────────
    $coordFields = [
        'top_left_lat','top_left_lng','top_right_lat','top_right_lng',
        'bottom_left_lat','bottom_left_lng','bottom_right_lat','bottom_right_lng',
        'center_lat','center_lng',
    ];
    $coords    = [];
    $hasCoords = false;
    foreach ($coordFields as $f) {
        if (isset($_POST[$f]) && $_POST[$f] !== '') {
            $coords[$f] = (float) $_POST[$f];
            $hasCoords  = true;
        } else {
            $coords[$f] = null;
        }
    }
    $zoomLevel = isset($_POST['zoom_level']) ? (int) $_POST['zoom_level'] : 12;

    // Auto-compute center from corners if not supplied
    if ($hasCoords && $coords['center_lat'] === null && $coords['top_left_lat'] !== null) {
        $coords['center_lat'] = ($coords['top_left_lat'] + $coords['bottom_right_lat']) / 2;
        $coords['center_lng'] = ($coords['top_left_lng'] + $coords['bottom_right_lng']) / 2;
    }

    $stmt = db()->prepare(
        "INSERT INTO satellite_media
           (name, file_path, type, source,
            top_left_lat, top_left_lng, top_right_lat, top_right_lng,
            bottom_left_lat, bottom_left_lng, bottom_right_lat, bottom_right_lng,
            center_lat, center_lng, zoom_level)
         VALUES
           (:name, :file_path, :type, :source,
            :tl_lat, :tl_lng, :tr_lat, :tr_lng,
            :bl_lat, :bl_lng, :br_lat, :br_lng,
            :c_lat, :c_lng, :zoom)"
    );
    $stmt->execute([
        ':name'      => $file['name'],
        ':file_path' => $urlPath,
        ':type'      => $mediaType,
        ':source'    => $source ?: 'Manual',
        ':tl_lat'    => $coords['top_left_lat'],
        ':tl_lng'    => $coords['top_left_lng'],
        ':tr_lat'    => $coords['top_right_lat'],
        ':tr_lng'    => $coords['top_right_lng'],
        ':bl_lat'    => $coords['bottom_left_lat'],
        ':bl_lng'    => $coords['bottom_left_lng'],
        ':br_lat'    => $coords['bottom_right_lat'],
        ':br_lng'    => $coords['bottom_right_lng'],
        ':c_lat'     => $coords['center_lat'],
        ':c_lng'     => $coords['center_lng'],
        ':zoom'      => $zoomLevel,
    ]);
    $mediaId = (int) db()->lastInsertId();

    echo json_encode([
        'success'   => true,
        'media_id'  => $mediaId,
        'file_path' => $urlPath,
        'name'      => $file['name'],
        'center_lat'=> $coords['center_lat'],
        'center_lng'=> $coords['center_lng'],
    ]);
}

function getAlerts(): void {
    $showAll = isset($_GET['all']) && $_GET['all'] === '1';
    $sql = "SELECT a.id, a.media_id, m.name AS media_name,
                   a.alert_type, a.message, a.created_at, a.is_read
            FROM alerts_log a
            JOIN satellite_media m ON m.id = a.media_id";
    if (!$showAll) $sql .= " WHERE a.is_read = 0";
    $sql .= " ORDER BY a.created_at DESC LIMIT 200";
    $stmt = db()->prepare($sql);
    $stmt->execute();
    $rows = $stmt->fetchAll();
    foreach ($rows as &$row) $row['is_read'] = (bool) $row['is_read'];
    unset($row);
    echo json_encode(['success' => true, 'data' => $rows, 'count' => count($rows)]);
}

function markAlertRead(): void {
    $body = getJsonBody();
    if (!empty($body['all'])) {
        $stmt = db()->prepare("UPDATE alerts_log SET is_read = 1 WHERE is_read = 0");
        $stmt->execute();
        echo json_encode(['success' => true, 'affected' => $stmt->rowCount()]);
        return;
    }
    $id = (int) ($body['id'] ?? 0);
    if ($id <= 0) {
        http_response_code(422);
        echo json_encode(['success' => false, 'error' => 'id is required']);
        return;
    }
    $stmt = db()->prepare("UPDATE alerts_log SET is_read = 1 WHERE id = :id");
    $stmt->execute([':id' => $id]);
    echo json_encode(['success' => true, 'affected' => $stmt->rowCount()]);
}

// ════════════════════════════════════════════════════════════
// LOCATION HANDLERS
// ════════════════════════════════════════════════════════════

/* ── save_location_alert ─────────────────────────────────────
   POST: { result_id, lat, lng, alert_type, severity, area_km2 }
*/
function saveLocationAlert(): void {
    $body = getJsonBody();

    $resultId  = (int)   ($body['result_id']  ?? 0);
    $lat       = (float) ($body['lat']        ?? 0);
    $lng       = (float) ($body['lng']        ?? 0);
    $alertType = trim(   ($body['alert_type'] ?? 'deforestation'));
    $severity  = trim(   ($body['severity']   ?? 'medium'));
    $areaKm2   = isset($body['area_km2']) ? (float) $body['area_km2'] : null;

    if ($resultId <= 0) {
        http_response_code(422);
        echo json_encode(['success' => false, 'error' => 'result_id is required']);
        return;
    }
    $validTypes = ['deforestation','fire','illegal_logging'];
    $validSev   = ['low','medium','high','critical'];
    if (!in_array($alertType, $validTypes, true)) $alertType = 'deforestation';
    if (!in_array($severity,  $validSev,   true)) $severity  = 'medium';

    $stmt = db()->prepare(
        "INSERT INTO location_alerts (result_id, lat, lng, alert_type, severity, area_km2)
         VALUES (:result_id, :lat, :lng, :alert_type, :severity, :area_km2)"
    );
    $stmt->execute([
        ':result_id'  => $resultId,
        ':lat'        => $lat,
        ':lng'        => $lng,
        ':alert_type' => $alertType,
        ':severity'   => $severity,
        ':area_km2'   => $areaKm2,
    ]);
    echo json_encode(['success' => true, 'id' => (int) db()->lastInsertId()]);
}

/* ── get_location_alerts ─────────────────────────────────────
   GET ?all=1 to include resolved alerts
*/
function getLocationAlerts(): void {
    $showAll = isset($_GET['all']) && $_GET['all'] === '1';
    $sql = "SELECT
              la.id, la.result_id,
              r.media_id,
              m.name          AS media_name,
              m.file_path,
              la.lat, la.lng,
              la.alert_type,  la.severity,
              la.area_km2,    la.reported_at,
              la.is_resolved, la.authority_notified,
              r.loss_pct,     r.fire_pct,
              r.alert_level
            FROM location_alerts la
            JOIN analysis_results r ON r.id  = la.result_id
            JOIN satellite_media  m ON m.id  = r.media_id";
    if (!$showAll) $sql .= " WHERE la.is_resolved = 0";
    $sql .= " ORDER BY la.reported_at DESC LIMIT 500";

    $stmt = db()->prepare($sql);
    $stmt->execute();
    $rows = $stmt->fetchAll();
    foreach ($rows as &$row) {
        $row['is_resolved']        = (bool) $row['is_resolved'];
        $row['authority_notified'] = (bool) $row['authority_notified'];
    }
    unset($row);
    echo json_encode(['success' => true, 'data' => $rows, 'count' => count($rows)]);
}

/* ── resolve_alert ───────────────────────────────────────────
   POST: { id: <int> }
*/
function resolveAlert(): void {
    $body = getJsonBody();
    $id   = (int) ($body['id'] ?? 0);
    if ($id <= 0) {
        http_response_code(422);
        echo json_encode(['success' => false, 'error' => 'id is required']);
        return;
    }
    $stmt = db()->prepare(
        "UPDATE location_alerts SET is_resolved = 1 WHERE id = :id"
    );
    $stmt->execute([':id' => $id]);
    echo json_encode(['success' => true, 'affected' => $stmt->rowCount()]);
}

/* ── get_map_data ────────────────────────────────────────────
   Returns all coordinates for map rendering.
   { results: [...], location_alerts: [...] }
*/
function getMapData(): void {
    $pdo = db();

    // Analysis results with coordinates
    $r = $pdo->prepare(
        "SELECT r.id, r.media_id, m.name AS media_name, m.file_path,
                r.loss_pct, r.fire_pct, r.ndvi_score, r.alert_level,
                r.affected_lat AS lat, r.affected_lng AS lng,
                r.affected_area_km2 AS area_km2,
                r.analysed_at
         FROM analysis_results r
         JOIN satellite_media m ON m.id = r.media_id
         WHERE r.affected_lat IS NOT NULL
         ORDER BY r.analysed_at DESC
         LIMIT 500"
    );
    $r->execute();
    $results = $r->fetchAll();

    // Location alerts
    $a = $pdo->prepare(
        "SELECT la.id, la.lat, la.lng, la.alert_type, la.severity,
                la.area_km2, la.reported_at, la.is_resolved,
                m.name AS media_name
         FROM location_alerts la
         JOIN analysis_results ar ON ar.id = la.result_id
         JOIN satellite_media  m  ON m.id  = ar.media_id
         ORDER BY la.reported_at DESC
         LIMIT 500"
    );
    $a->execute();
    $alerts = $a->fetchAll();
    foreach ($alerts as &$row) $row['is_resolved'] = (bool) $row['is_resolved'];
    unset($row);

    // Media centers (for images with known footprint but no analysis yet)
    $mc = $pdo->prepare(
        "SELECT id, name, center_lat AS lat, center_lng AS lng, source, zoom_level
         FROM satellite_media
         WHERE center_lat IS NOT NULL
         ORDER BY uploaded_at DESC
         LIMIT 200"
    );
    $mc->execute();

    echo json_encode([
        'success'          => true,
        'results'          => $results,
        'location_alerts'  => $alerts,
        'media_centers'    => $mc->fetchAll(),
    ]);
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

function getJsonBody(): array {
    $raw = file_get_contents('php://input');
    if ($raw) {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) return $decoded;
    }
    return $_POST ?: [];
}
