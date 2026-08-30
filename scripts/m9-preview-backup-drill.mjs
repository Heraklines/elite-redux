import { readFileSync, writeFileSync } from "node:fs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const mode = required("--mode");
if (mode === "prepare") {
  prepare();
} else if (mode === "verify") {
  verify();
} else {
  throw new Error("preview backup drill mode must be prepare or verify");
}

function prepare() {
  const source = d1Row(required("--input"));
  const runId = required("--run-id");
  if (!/^[0-9]{1,32}$/u.test(runId)) {
    throw new Error("preview backup drill run id is invalid");
  }
  const drillAccount = `rust-preview:restore-drill-${runId}`;
  const drillSlot = "rust-slot-4";
  const expected = saveIdentity(source);
  writeFileSync(required("--expected"), JSON.stringify(expected));
  const sql = [
    "PRAGMA foreign_keys = ON;",
    `INSERT INTO rust_preview_accounts (account_id, token_hash, created_at, last_seen_at, disabled) VALUES (${sqlString(drillAccount)}, ${sqlString(`drill-token-${runId}`)}, 0, 0, 1);`,
    `INSERT INTO rust_preview_saves (account_id, slot, release_id, kernel_generation, content_identity, active_model_identity, mechanics_sha256, save_schema, payload_sha256, data, revision, created_at, updated_at) VALUES (${[
      drillAccount,
      drillSlot,
      source.release_id,
      source.kernel_generation,
      source.content_identity,
      source.active_model_identity,
      source.mechanics_sha256,
      source.save_schema,
      source.payload_sha256,
      source.data,
      source.revision,
      source.created_at,
      source.replaced_at,
    ]
      .map(sqlValue)
      .join(", ")});`,
  ].join("\n");
  writeFileSync(required("--output"), sql);
  writeFileSync(
    required("--cleanup"),
    `DELETE FROM rust_preview_saves WHERE account_id = ${sqlString(drillAccount)} AND slot = ${sqlString(drillSlot)};\nDELETE FROM rust_preview_accounts WHERE account_id = ${sqlString(drillAccount)};\n`,
  );
}

function verify() {
  const expected = JSON.parse(readFileSync(required("--expected"), "utf8"));
  const actual = saveIdentity(d1Row(required("--input")));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("preview backup restore drill readback differs from the immutable backup");
  }
  process.stdout.write(`${JSON.stringify(actual)}\n`);
}

function d1Row(path) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  const row = value?.[0]?.results?.[0];
  if (row == null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("preview backup drill D1 result has no row");
  }
  return row;
}

function saveIdentity(row) {
  const stringFields = [
    "release_id",
    "content_identity",
    "active_model_identity",
    "mechanics_sha256",
    "payload_sha256",
    "data",
  ];
  const integerFields = ["kernel_generation", "save_schema", "revision", "created_at"];
  for (const field of stringFields) {
    if (typeof row[field] !== "string" || row[field].length === 0) {
      throw new Error(`preview backup drill ${field} is invalid`);
    }
  }
  for (const field of integerFields) {
    if (!Number.isSafeInteger(row[field]) || row[field] < 0) {
      throw new Error(`preview backup drill ${field} is invalid`);
    }
  }
  const replacedAt = row.replaced_at ?? row.updated_at;
  if (!Number.isSafeInteger(replacedAt) || replacedAt < 0) {
    throw new Error("preview backup drill replacement timestamp is invalid");
  }
  return {
    release_id: row.release_id,
    kernel_generation: row.kernel_generation,
    content_identity: row.content_identity,
    active_model_identity: row.active_model_identity,
    mechanics_sha256: row.mechanics_sha256,
    save_schema: row.save_schema,
    payload_sha256: row.payload_sha256,
    data: row.data,
    revision: row.revision,
    created_at: row.created_at,
    replaced_at: replacedAt,
  };
}

function sqlValue(value) {
  if (typeof value === "string") {
    return sqlString(value);
  }
  if (Number.isSafeInteger(value)) {
    return String(value);
  }
  throw new Error("preview backup drill cannot encode SQL value");
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function required(name) {
  const value = args.get(name);
  if (value == null || value.length === 0) {
    throw new Error(`missing ${name}`);
  }
  return value;
}
