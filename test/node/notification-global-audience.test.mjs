import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workerSource = readFileSync(new URL("../../workers/er-save-api/src/index.ts", import.meta.url), "utf8");

test("notification delivery includes global and account-specific rows", () => {
  assert.match(workerSource, /WHERE \(username = '\*' OR lower\(username\) = lower\(\?1\)\) AND created_at > \?2/);
  assert.match(workerSource, /ORDER BY created_at DESC/);
});
