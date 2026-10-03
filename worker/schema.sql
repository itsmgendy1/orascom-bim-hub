-- Orascom Hub Auth+Data Worker — D1 schema (SQLite).
-- Apply once: POST /d1/database/{id}/query with each statement, or wrangler d1 execute --file.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('ADMIN','MANAGER','COORDINATOR','QA','VIEWER','USER')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','DISABLED','REJECTED')),
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ip TEXT,
  ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

-- Per-user Hub stores. store_key is allowlisted in code (ohub_* dataset names).
CREATE TABLE IF NOT EXISTS user_data (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_key TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, store_key)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings(key, value) VALUES ('registration_open', '1');

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor_id TEXT,
  actor_username TEXT,
  action TEXT NOT NULL,
  target_id TEXT,
  detail TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit(action);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  username TEXT NOT NULL,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempts_user_ts ON login_attempts(username, ts);
