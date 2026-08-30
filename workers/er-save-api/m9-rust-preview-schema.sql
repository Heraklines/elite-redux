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
  PRIMARY KEY (account_id, slot)
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
  PRIMARY KEY (account_id, slot, revision)
);
