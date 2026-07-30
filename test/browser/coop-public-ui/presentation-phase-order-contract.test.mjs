import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../../src/dynamic-queue-manager.ts", import.meta.url), "utf8");
const hideAbilityPhase = readFileSync(new URL("../../../src/phases/hide-ability-phase.ts", import.meta.url), "utf8");
const replayPhases = readFileSync(new URL("../../../src/phases/coop-replay-phases.ts", import.meta.url), "utf8");
const replayTurn = readFileSync(new URL("../../../src/phases/coop-replay-turn-phase.ts", import.meta.url), "utf8");
const transport = readFileSync(
  new URL("../../../src/data/elite-redux/coop/coop-transport.ts", import.meta.url),
  "utf8",
);

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

test("ability teardown is an ordered, bounded authoritative presentation event", () => {
  assert.match(transport, /\| \{ k: "hideAbility" \}/u);
  assert.match(hideAbilityPhase, /recordCoopEvent\(\{ k: "hideAbility" \}\)/u);
  assert.match(replayTurn, /case "hideAbility":[\s\S]*CoopHideAbilityReplayPhase/u);
  assert.match(replayPhases, /class CoopHideAbilityReplayPhase[\s\S]*armCoopPresentationProgressWatchdog/u);
  assert.match(replayPhases, /killTweensOf\(globalScene\.abilityBar\)[\s\S]*setVisible\(false\)/u);
});

test("battle animations terminate safely when their field actors are retired mid-tween", () => {
  const battleAnims = readFileSync(new URL("../../../src/data/battle-anims.ts", import.meta.url), "utf8");
  assert.match(battleAnims, /presentationActorsIntact/u);
  assert.match(battleAnims, /user\.getSprite\(\) === userSprite/u);
  assert.match(battleAnims, /playbackTween\?\.stop\(\);\s*cleanUpAndComplete\(\)/u);
});
