-- ============================================================
--  Forest Monitor — Supabase Schema (PostgreSQL)
--  Paste this into: Supabase → SQL Editor → New query → Run
-- ============================================================

-- ── Table 1: satellite_media ─────────────────────────────────
CREATE TABLE IF NOT EXISTS satellite_media (
  id               BIGSERIAL     PRIMARY KEY,
  name             TEXT          NOT NULL,
  file_path        TEXT          NOT NULL,
  file_hash        CHAR(32)      UNIQUE,
  type             TEXT          NOT NULL DEFAULT 'image'
                                 CHECK (type IN ('image','video')),
  uploaded_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  status           TEXT          NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','processing','analysed','failed')),
  source           TEXT,
  -- GPS bounding-box corners
  top_left_lat     NUMERIC(10,7),
  top_left_lng     NUMERIC(10,7),
  top_right_lat    NUMERIC(10,7),
  top_right_lng    NUMERIC(10,7),
  bottom_left_lat  NUMERIC(10,7),
  bottom_left_lng  NUMERIC(10,7),
  bottom_right_lat NUMERIC(10,7),
  bottom_right_lng NUMERIC(10,7),
  center_lat       NUMERIC(10,7),
  center_lng       NUMERIC(10,7),
  zoom_level       INT           NOT NULL DEFAULT 12
);

-- ── Table 2: analysis_results ────────────────────────────────
CREATE TABLE IF NOT EXISTS analysis_results (
  id                BIGSERIAL   PRIMARY KEY,
  media_id          BIGINT      NOT NULL REFERENCES satellite_media(id) ON DELETE CASCADE,
  loss_pct          NUMERIC(5,2) NOT NULL DEFAULT 0,
  gain_pct          NUMERIC(5,2) NOT NULL DEFAULT 0,
  fire_pct          NUMERIC(5,2) NOT NULL DEFAULT 0,
  ndvi_score        NUMERIC(5,2) NOT NULL DEFAULT 0,
  alert_level       TEXT         NOT NULL DEFAULT 'safe'
                                 CHECK (alert_level IN ('safe','warning','critical')),
  analysed_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  notes             TEXT,
  affected_lat      NUMERIC(10,7),
  affected_lng      NUMERIC(10,7),
  affected_area_km2 NUMERIC(10,4),
  pixel_x           INT,
  pixel_y           INT,
  bounding_box      JSONB
);

-- ── Table 3: alerts_log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts_log (
  id          BIGSERIAL    PRIMARY KEY,
  media_id    BIGINT       NOT NULL REFERENCES satellite_media(id) ON DELETE CASCADE,
  alert_type  TEXT         NOT NULL,
  message     TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  is_read     BOOLEAN      NOT NULL DEFAULT FALSE
);

-- ── Table 4: location_alerts ─────────────────────────────────
CREATE TABLE IF NOT EXISTS location_alerts (
  id                   BIGSERIAL    PRIMARY KEY,
  result_id            BIGINT       NOT NULL REFERENCES analysis_results(id) ON DELETE CASCADE,
  lat                  NUMERIC(10,7) NOT NULL,
  lng                  NUMERIC(10,7) NOT NULL,
  alert_type           TEXT          NOT NULL DEFAULT 'deforestation'
                                     CHECK (alert_type IN ('deforestation','fire','illegal_logging')),
  severity             TEXT          NOT NULL DEFAULT 'medium'
                                     CHECK (severity IN ('low','medium','high','critical')),
  area_km2             NUMERIC(10,4),
  reported_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  is_resolved          BOOLEAN       NOT NULL DEFAULT FALSE,
  authority_notified   BOOLEAN       NOT NULL DEFAULT FALSE
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_media_status   ON satellite_media   (status);
CREATE INDEX IF NOT EXISTS idx_media_hash     ON satellite_media   (file_hash);
CREATE INDEX IF NOT EXISTS idx_media_center   ON satellite_media   (center_lat, center_lng);
CREATE INDEX IF NOT EXISTS idx_result_media   ON analysis_results  (media_id);
CREATE INDEX IF NOT EXISTS idx_result_level   ON analysis_results  (alert_level);
CREATE INDEX IF NOT EXISTS idx_result_coords  ON analysis_results  (affected_lat, affected_lng);
CREATE INDEX IF NOT EXISTS idx_alert_media    ON alerts_log        (media_id);
CREATE INDEX IF NOT EXISTS idx_alert_unread   ON alerts_log        (is_read);
CREATE INDEX IF NOT EXISTS idx_loc_result     ON location_alerts   (result_id);
CREATE INDEX IF NOT EXISTS idx_loc_coords     ON location_alerts   (lat, lng);
CREATE INDEX IF NOT EXISTS idx_loc_resolved   ON location_alerts   (is_resolved);

-- ── Enable Row Level Security (open read/write for anon key) ──
-- This lets your frontend JS talk directly to Supabase safely.
ALTER TABLE satellite_media   ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_results  ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_alerts   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_satellite_media"  ON satellite_media   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_analysis_results" ON analysis_results  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_alerts_log"       ON alerts_log        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_location_alerts"  ON location_alerts   FOR ALL USING (true) WITH CHECK (true);
