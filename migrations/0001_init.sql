-- HookBox schema (Cloudflare D1 / SQLite)
-- Every table is intentionally small: HookBox stores short-lived debugging data only.

CREATE TABLE IF NOT EXISTS inboxes (
  id             TEXT PRIMARY KEY,
  token_hash     TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active',
  request_count  INTEGER NOT NULL DEFAULT 0,
  storage_bytes  INTEGER NOT NULL DEFAULT 0,
  creator_hash   TEXT,
  label          TEXT
);

CREATE INDEX IF NOT EXISTS idx_inboxes_expires ON inboxes (expires_at);
CREATE INDEX IF NOT EXISTS idx_inboxes_creator ON inboxes (creator_hash, created_at);

CREATE TABLE IF NOT EXISTS requests (
  id              TEXT PRIMARY KEY,
  inbox_id        TEXT NOT NULL,
  method          TEXT NOT NULL,
  path            TEXT NOT NULL,
  query           TEXT NOT NULL DEFAULT '[]',
  headers         TEXT NOT NULL DEFAULT '[]',
  body_text       TEXT,
  body_b64        TEXT,
  body_kind       TEXT NOT NULL DEFAULT 'empty',
  body_truncated  INTEGER NOT NULL DEFAULT 0,
  content_type    TEXT,
  body_size       INTEGER NOT NULL DEFAULT 0,
  source_ip_hash  TEXT,
  user_agent      TEXT,
  status_code     INTEGER NOT NULL DEFAULT 200,
  received_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_inbox_time ON requests (inbox_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_requests_inbox_method ON requests (inbox_id, method);
CREATE INDEX IF NOT EXISTS idx_requests_received ON requests (received_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket        TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);
