import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("segments run and decision observations by the latest ER patch", () => {
  const directory = mkdtempSync(join(tmpdir(), "er-balance-observations-"));
  const now = Date.parse("2026-08-25T12:00:00Z");
  try {
    writeFileSync(
      join(directory, "_runs.json"),
      JSON.stringify({
        until: now,
        rows: [
          { playerKey: "p1", difficulty: "elite", outcome: "victory", progression_wave: 100, er_version: "0.0.6.1", created_at: now - 1000 },
          { playerKey: "p1", difficulty: "elite", outcome: "defeat", progression_wave: 60, er_version: "0.0.6.1", created_at: now - 2000 },
          { playerKey: "p2", difficulty: "hell", outcome: "defeat", wave: 50, pacing: "sprint", er_version: "0.0.6.1", created_at: now - 3000 },
          { playerKey: "p3", difficulty: "elite", outcome: "victory", wave: 200, er_version: "0.0.6.0", created_at: now - 4000 }
        ]
      }),
    );
    writeFileSync(
      join(directory, "_decisions.json"),
      JSON.stringify({
        collectionStartedAt: now - 10000,
        previous: null,
        watermark: { uploadedAt: now, keys: ["one"] },
        exportError: null,
        events: [
          { kind: "biome_decision", action: "travel", t: now - 500, difficulty: "elite", erVersion: "0.0.6.1", currentBiome: 1, chosenBiome: 3, wavesSpent: 10 },
          { kind: "biome_decision", action: "stay", t: now - 450, difficulty: "elite", erVersion: "0.0.6.1", currentBiome: 3, wavesSpent: 8 },
          { kind: "biome_decision", action: "leave", t: now - 425, difficulty: "elite", erVersion: "0.0.6.1", currentBiome: 3, wavesSpent: 12 },
          { kind: "mystery_encounter", stage: "opened", t: now - 400, difficulty: "elite", erVersion: "0.0.6.1", encounterType: 24 },
          { kind: "mystery_encounter", stage: "choice", t: now - 300, difficulty: "elite", erVersion: "0.0.6.1", encounterType: 24, optionIndex: 2, subSelection: false }
        ]
      }),
    );

    execFileSync(process.execPath, [fileURLToPath(new URL("./gen-balance-observations.mjs", import.meta.url))], {
      env: { ...process.env, BALANCE_OBSERVATIONS_DATA_DIR: directory },
      stdio: "pipe",
    });

    const output = JSON.parse(readFileSync(join(directory, "balance-observations.json"), "utf8"));
    assert.equal(output.currentPatch, "0.0.6.1");
    assert.equal(output.previousPatch, "0.0.6.0");
    assert.deepEqual(Object.keys(output.patches), ["0.0.6.1", "0.0.6.0"]);
    assert.equal(output.windows.currentPatch.summary.runs, 3);
    assert.equal(output.windows.currentPatch.summary.victories, 1);
    assert.equal(output.windows.currentPatch.summary.medianWave, 100);
    assert.equal(output.windows.currentPatch.biomeTransitions[0].count, 1);
    assert.equal(output.windows.currentPatch.biomeDecisions.length, 2);
    assert.equal(output.windows.currentPatch.biomeDecisions[0].share, 0.5);
    assert.equal(output.windows.currentPatch.mysteryEvents[0].share, 1);
    assert.equal(output.windows.previousPatch.summary.runs, 1);
    assert.equal(output.patches["0.0.6.0"].summary.medianWave, 200);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
