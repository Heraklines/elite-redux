import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const script = resolve(root, "scripts/m9-preview-backup-drill.mjs");

describe("M9 preview backup restore drill", () => {
  it("prepares an isolated restore and verifies exact payload identity", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "m9-preview-backup-"));
    const backup = resolve(directory, "backup.json");
    const expected = resolve(directory, "expected.json");
    const restore = resolve(directory, "restore.sql");
    const cleanup = resolve(directory, "cleanup.sql");
    const readback = resolve(directory, "readback.json");
    writeFileSync(backup, JSON.stringify([{ results: [backupRow()] }]));

    execFileSync(process.execPath, [
      script,
      "--mode",
      "prepare",
      "--input",
      backup,
      "--expected",
      expected,
      "--output",
      restore,
      "--cleanup",
      cleanup,
      "--run-id",
      "12345",
    ]);
    const restoreSql = readFileSync(restore, "utf8");
    expect(restoreSql).toContain("rust-preview:restore-drill-12345");
    expect(restoreSql).toContain("payload with ''quote''");
    expect(readFileSync(cleanup, "utf8")).toContain("DELETE FROM rust_preview_accounts");

    const row = backupRow();
    const restored = { ...row, updated_at: row.replaced_at };
    writeFileSync(readback, JSON.stringify([{ results: [restored] }]));
    expect(
      execFileSync(process.execPath, [script, "--mode", "verify", "--input", readback, "--expected", expected], {
        encoding: "utf8",
      }),
    ).toContain(row.payload_sha256);

    writeFileSync(readback, JSON.stringify([{ results: [{ ...restored, data: "corrupt" }] }]));
    const mismatch = spawnSync(
      process.execPath,
      [script, "--mode", "verify", "--input", readback, "--expected", expected],
      { stdio: "pipe" },
    );
    expect(mismatch.status).not.toBe(0);
  });
});

function backupRow() {
  return {
    release_id: "release-1",
    kernel_generation: 3,
    content_identity: "content-1",
    active_model_identity: "model-1",
    mechanics_sha256: "a".repeat(64),
    save_schema: 1,
    payload_sha256: "b".repeat(64),
    data: "payload with 'quote'",
    revision: 7,
    created_at: 10,
    replaced_at: 20,
  };
}
