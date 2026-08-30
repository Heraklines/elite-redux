CREATE TABLE IF NOT EXISTS rust_preview_accounts (
  account_id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  disabled INTEGER NOT NULL CHECK (disabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS rust_preview_saves (
  account_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  release_id TEXT NOT NULL,
  kernel_generation INTEGER NOT NULL,
  content_identity TEXT NOT NULL,
  active_model_identity TEXT NOT NULL,
  mechanics_sha256 TEXT NOT NULL,
  save_schema INTEGER NOT NULL,
  payload_sha256 TEXT NOT NULL,
  data TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, slot),
  FOREIGN KEY (account_id) REFERENCES rust_preview_accounts(account_id)
);

CREATE TABLE IF NOT EXISTS rust_preview_save_backups (
  account_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  revision INTEGER NOT NULL,
  release_id TEXT NOT NULL,
  kernel_generation INTEGER NOT NULL,
  content_identity TEXT NOT NULL,
  active_model_identity TEXT NOT NULL,
  mechanics_sha256 TEXT NOT NULL,
  save_schema INTEGER NOT NULL,
  payload_sha256 TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  replaced_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, slot, revision),
  FOREIGN KEY (account_id) REFERENCES rust_preview_accounts(account_id)
);

CREATE TABLE IF NOT EXISTS rust_preview_save_leases (
  account_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  holder TEXT NOT NULL,
  lease_hash TEXT NOT NULL,
  generation INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, slot),
  FOREIGN KEY (account_id) REFERENCES rust_preview_accounts(account_id)
);

CREATE INDEX IF NOT EXISTS rust_preview_save_leases_expiry
  ON rust_preview_save_leases(expires_at);
