import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../../src/dynamic-queue-manager.ts", import.meta.url), "utf8");

test("authoritative Pokemon presentation phases cannot be speed-reordered", () => {
  const nonDynamicList = source.match(/const nonDynamicPokemonPhases:[^=]+=\s*\[([\s\S]*?)\]\s*as const;/u)?.[1];
  assert.ok(nonDynamicList, "the explicit non-dynamic phase policy remains present");

  for (const phaseName of [
    "CoopHpDrainReplayPhase",
    "CoopStatStageReplayPhase",
    "CoopStatusReplayPhase",
    "CoopFaintReplayPhase",
  ]) {
    assert.match(
      nonDynamicList,
      new RegExp(`(["'])${phaseName}\\1`, "u"),
      `${phaseName} must preserve the authority event order instead of entering a speed-priority queue`,
    );
  }
});
