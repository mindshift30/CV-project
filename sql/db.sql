-- ============================================================
--  Forest Monitor — MySQL Schema (v2 — with Location Tracking)
--  Import via: mysql -u root -p < sql/db.sql
--  Upgrade only: run the ALTER TABLE blocks at the bottom
--  if upgrading from v1.
-- ============================================================

CREATE DATABASE IF NOT EXISTS forest_monitor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE forest_monitor;

-- ── Table 1: satellite_media ─────────────────────────────────
CREATE TABLE IF NOT EXISTS satellite_media (
  id               INT           NOT NULL AUTO_INCREMENT,
  name             VARCHAR(255)  NOT NULL,
  file_path        VARCHAR(500)  NOT NULL,
  file_hash        CHAR(32)      DEFAULT NULL,
  type             ENUM('image','video') NOT NULL DEFAULT 'image',
  uploaded_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status           ENUM('pending','processing','analysed','failed') NOT NULL DEFAULT 'pending',
  source           VARCHAR(255)  DEFAULT NULL,
  -- GPS bounding-box corners (decimal degrees)
  top_left_lat     DECIMAL(10,7) DEFAULT NULL,
  top_left_lng     DECIMAL(10,7) DEFAULT NULL,
  top_right_lat    DECIMAL(10,7) DEFAULT NULL,
  top_right_lng    DECIMAL(10,7) DEFAULT NULL,
  bottom_left_lat  DECIMAL(10,7) DEFAULT NULL,
  bottom_left_lng  DECIMAL(10,7) DEFAULT NULL,
  bottom_right_lat DECIMAL(10,7) DEFAULT NULL,
  bottom_right_lng DECIMAL(10,7) DEFAULT NULL,
  center_lat       DECIMAL(10,7) DEFAULT NULL,
  center_lng       DECIMAL(10,7) DEFAULT NULL,
  zoom_level       INT           NOT NULL DEFAULT 12,
  PRIMARY KEY (id),
  UNIQUE KEY uq_file_hash (file_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 2: analysis_results ────────────────────────────────
CREATE TABLE IF NOT EXISTS analysis_results (
  id              INT            NOT NULL AUTO_INCREMENT,
  media_id        INT            NOT NULL,
  loss_pct        DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
  gain_pct        DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
  fire_pct        DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
  ndvi_score      DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
  alert_level     ENUM('safe','warning','critical') NOT NULL DEFAULT 'safe',
  analysed_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes           TEXT           DEFAULT NULL,
  -- Location of detected event
  affected_lat    DECIMAL(10,7)  DEFAULT NULL,
  affected_lng    DECIMAL(10,7)  DEFAULT NULL,
  affected_area_km2 DECIMAL(10,4) DEFAULT NULL,
  pixel_x         INT            DEFAULT NULL,
  pixel_y         INT            DEFAULT NULL,
  bounding_box    JSON           DEFAULT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_result_media
    FOREIGN KEY (media_id) REFERENCES satellite_media(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 3: alerts_log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts_log (
  id          INT           NOT NULL AUTO_INCREMENT,
  media_id    INT           NOT NULL,
  alert_type  VARCHAR(100)  NOT NULL,
  message     TEXT          DEFAULT NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_read     TINYINT(1)    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT fk_alert_media
    FOREIGN KEY (media_id) REFERENCES satellite_media(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Table 4: location_alerts ─────────────────────────────────
CREATE TABLE IF NOT EXISTS location_alerts (
  id                   INT            NOT NULL AUTO_INCREMENT,
  result_id            INT            NOT NULL,
  lat                  DECIMAL(10,7)  NOT NULL,
  lng                  DECIMAL(10,7)  NOT NULL,
  alert_type           ENUM('deforestation','fire','illegal_logging') NOT NULL DEFAULT 'deforestation',
  severity             ENUM('low','medium','high','critical')         NOT NULL DEFAULT 'medium',
  area_km2             DECIMAL(10,4)  DEFAULT NULL,
  reported_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_resolved          TINYINT(1)     NOT NULL DEFAULT 0,
  authority_notified   TINYINT(1)     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT fk_loc_result
    FOREIGN KEY (result_id) REFERENCES analysis_results(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX idx_media_status      ON satellite_media   (status);
CREATE INDEX idx_media_hash        ON satellite_media   (file_hash);
CREATE INDEX idx_media_center      ON satellite_media   (center_lat, center_lng);
CREATE INDEX idx_result_media      ON analysis_results  (media_id);
CREATE INDEX idx_result_level      ON analysis_results  (alert_level);
CREATE INDEX idx_result_coords     ON analysis_results  (affected_lat, affected_lng);
CREATE INDEX idx_alert_media       ON alerts_log        (media_id);
CREATE INDEX idx_alert_unread      ON alerts_log        (is_read);
CREATE INDEX idx_loc_result        ON location_alerts   (result_id);
CREATE INDEX idx_loc_coords        ON location_alerts   (lat, lng);
CREATE INDEX idx_loc_resolved      ON location_alerts   (is_resolved);

-- ── Sample seed data (optional) ──────────────────────────────
INSERT INTO satellite_media
  (name, file_path, type, source,
   top_left_lat, top_left_lng, top_right_lat, top_right_lng,
   bottom_left_lat, bottom_left_lng, bottom_right_lat, bottom_right_lng,
   center_lat, center_lng, zoom_level)
VALUES
  ('Amazon_North_2024_01.jpg', 'uploads/satellite/Amazon_North_2024_01.jpg', 'image', 'Sentinel-2',
   -1.4500, -48.5000, -1.4500, -48.3500,
   -1.6000, -48.5000, -1.6000, -48.3500,
   -1.5250, -48.4250, 12),
  ('Congo_Basin_2024_03.jpg', 'uploads/satellite/Congo_Basin_2024_03.jpg', 'image', 'NASA',
   -0.2500, 24.2000, -0.2500, 24.4500,
   -0.5000, 24.2000, -0.5000, 24.4500,
   -0.3750, 24.3250, 11),
  ('Borneo_Fire_Zone.jpg', 'uploads/satellite/Borneo_Fire_Zone.jpg', 'image', 'Manual',
   1.3500, 113.9000, 1.3500, 114.1000,
   1.1500, 113.9000, 1.1500, 114.1000,
   1.2500, 114.0000, 12);

-- ════════════════════════════════════════════════════════════
-- UPGRADE SCRIPT — run these if you already have v1/v2 tables
-- Comment out the CREATE TABLE blocks above and run only these:
-- ════════════════════════════════════════════════════════════
-- ALTER TABLE satellite_media
--   ADD COLUMN file_hash        CHAR(32)      DEFAULT NULL AFTER file_path,
--   ADD COLUMN top_left_lat     DECIMAL(10,7) DEFAULT NULL AFTER source,
--   ADD COLUMN top_left_lng     DECIMAL(10,7) DEFAULT NULL,
--   ADD COLUMN top_right_lat    DECIMAL(10,7) DEFAULT NULL,
--   ADD COLUMN top_right_lng    DECIMAL(10,7) DEFAULT NULL,
--   ADD COLUMN bottom_left_lat  DECIMAL(10,7) DEFAULT NULL,
--   ADD COLUMN bottom_left_lng  DECIMAL(10,7) DEFAULT NULL,
--   ADD COLUMN bottom_right_lat DECIMAL(10,7) DEFAULT NULL,
--   ADD COLUMN bottom_right_lng DECIMAL(10,7) DEFAULT NULL,
--   ADD COLUMN center_lat       DECIMAL(10,7) DEFAULT NULL,
--   ADD COLUMN center_lng       DECIMAL(10,7) DEFAULT NULL,
--   ADD COLUMN zoom_level       INT NOT NULL DEFAULT 12,
--   MODIFY COLUMN status ENUM('pending','processing','analysed','failed') NOT NULL DEFAULT 'pending',
--   ADD UNIQUE KEY uq_file_hash (file_hash);
--
-- ALTER TABLE analysis_results
--   ADD COLUMN affected_lat       DECIMAL(10,7) DEFAULT NULL AFTER notes,
--   ADD COLUMN affected_lng       DECIMAL(10,7) DEFAULT NULL,
--   ADD COLUMN affected_area_km2  DECIMAL(10,4) DEFAULT NULL,
--   ADD COLUMN pixel_x            INT DEFAULT NULL,
--   ADD COLUMN pixel_y            INT DEFAULT NULL,
--   ADD COLUMN bounding_box       JSON DEFAULT NULL;
