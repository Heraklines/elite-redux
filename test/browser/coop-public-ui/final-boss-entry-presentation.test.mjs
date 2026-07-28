import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtime = await readFile(new URL("../../../src/data/elite-redux/coop/coop-runtime.ts", import.meta.url), "utf8");
const replay = await readFile(new URL("../../../src/phases/coop-replay-turn-phase.ts", import.meta.url), "utf8");
const replayPhases = await readFile(new URL("../../../src/phases/coop-replay-phases.ts", import.meta.url), "utf8");

test("a late turn-one renderer reads and reasserts its exact retired command prefix", () => {
  assert.match(runtime, /export function readRetainedCoopV2CommandEntryPresentation\(/u);
  assert.match(runtime, /runtime\.v2ControlLedger\.sourceEntryOf\(control\)/u);
  assert.match(runtime, /source\?\.kind !== "CONTROL_COMMIT"/u);
  assert.match(runtime, /material\?\.kind !== "command-open"/u);
  assert.match(runtime, /!controlsEqual\(source\.nextControl, control\)/u);
  assert.match(runtime, /events: structuredClone\(material\.entryPresentation\)/u);
  assert.match(runtime, /authoritativeState: structuredClone\(material\.authoritativeState\)/u);
  assert.match(runtime, /controlOperationId: source\.operationId/u);

  const readIndex = replay.indexOf("readRetainedCoopV2CommandEntryPresentation(this.sourceWave, this.turn)");
  const waitIndex = replay.indexOf("this.v2EntryPresentationResolver = resolve", readIndex);
  assert.ok(readIndex >= 0, "the presentation-only replay must consult the retained global-log source");
  assert.ok(waitIndex > readIndex, "the impossible network wait may only be installed after the ledger fallback");
  assert.match(replay.slice(readIndex, waitIndex), /return Promise\.resolve\(retained\)/u);
  assert.match(replay, /const prefixState = prefix\.authoritativeState/u);
  assert.match(replay, /applyCoopAuthoritativeBattleState\(prefixState, true\)/u);
  assert.match(replay, /const acceptedPrefixTick = coopAppliedStateTick\(\)/u);
  assert.match(replay, /acceptedPrefixTick > prefix\.stateTick/u);
  assert.match(replay, /acceptedPrefixTick === prefix\.stateTick/u);
  assert.match(replay, /reapplyAcceptedCoopAuthoritativeBattleState\(prefixState, true\)/u);
});

test("entry presentation restores the signed state after every visual cue and before command release", () => {
  const queueIndex = replay.indexOf('"CoopFinalizeEntryPresentationPhase"');
  const endIndex = replay.indexOf("this.end();", queueIndex);
  assert.ok(queueIndex >= 0 && endIndex > queueIndex, "the retained prefix must queue its proof fence");
  assert.match(
    replay.slice(queueIndex, endIndex),
    /prefix\.authoritativeState == null \? undefined : structuredClone\(prefix\.authoritativeState\)/u,
  );

  const finalizerStart = replayPhases.indexOf("export class CoopFinalizeEntryPresentationPhase");
  const nextPhase = replayPhases.indexOf("export class CoopFinalizeTurnPhase", finalizerStart);
  assert.ok(finalizerStart >= 0 && nextPhase > finalizerStart, "the entry finalizer must remain an explicit phase");
  const finalizer = replayPhases.slice(finalizerStart, nextPhase);
  const restoreIndex = finalizer.indexOf("if (!this.restoreAuthoritativeState())");
  const watermarkIndex = finalizer.indexOf("this.streamer.noteRenderedThrough", restoreIndex);
  const controlIndex = finalizer.indexOf("this.streamer.noteConsumedCommandPresentation", restoreIndex);
  assert.ok(restoreIndex >= 0, "the finalizer must restore mechanics after presentation drains");
  assert.ok(watermarkIndex > restoreIndex, "render proof cannot precede the exact-state restore");
  assert.ok(controlIndex > restoreIndex, "command control cannot precede the exact-state restore");
  assert.match(
    finalizer,
    /coopAppliedStateTick\(\) === state\.tick[\s\S]*reapplyAcceptedCoopAuthoritativeBattleState\(state, true\)/u,
  );
  assert.match(finalizer, /appliedTick > state\.tick[\s\S]*readLatestAcceptedCoopAuthoritativeBattleState\(\)/u);
  assert.doesNotMatch(finalizer, /appliedTick > state\.tick\) \{\s*return true/u);
  assert.match(finalizer, /applyCoopAuthoritativeBattleState\(state, true\)/u);
  assert.match(finalizer, /return this\.controlOperationId == null/u);
});
