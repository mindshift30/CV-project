<?php
/* ============================================================
   Forest Monitor — Database Configuration
   php/config.php
   ============================================================ */

// ── CORS headers (allow JS fetch from any origin) ───────────
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

// Preflight OPTIONS request — respond immediately
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Database credentials ─────────────────────────────────────
// Supports Railway env vars automatically; falls back to localhost defaults.
// Set these env vars on Railway (or any host):
//   MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQLPASSWORD,
//   MYSQL_DATABASE, MYSQL_PORT
define('DB_HOST',    getenv('MYSQL_HOST')                                      ?: 'localhost');
define('DB_PORT',    (int)(getenv('MYSQL_PORT')                                ?: 3306));
define('DB_NAME',    getenv('MYSQL_DATABASE')                                  ?: 'forest_monitor');
define('DB_USER',    getenv('MYSQL_USER')                                      ?: 'root');
define('DB_PASS',    getenv('MYSQLPASSWORD') ?: getenv('MYSQL_PASSWORD')       ?: '');
define('DB_CHARSET', 'utf8mb4');

// ── Upload settings ──────────────────────────────────────────
define('UPLOAD_DIR',      __DIR__ . '/../uploads/satellite/');
define('UPLOAD_URL_BASE', '../uploads/satellite/');
define('MAX_FILE_BYTES',  50 * 1024 * 1024);   // 50 MB
define('ALLOWED_TYPES',   ['image/jpeg', 'image/png', 'video/mp4']);
define('ALLOWED_EXT',     ['jpg', 'jpeg', 'png', 'mp4']);

// ── PDO connection (singleton) ───────────────────────────────
function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            DB_HOST, DB_PORT, DB_NAME, DB_CHARSET
        );
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => 'Database connection failed: ' . $e->getMessage()]);
            exit;
        }
    }
    return $pdo;
}
