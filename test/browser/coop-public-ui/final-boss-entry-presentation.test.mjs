import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtime = await readFile(new URL("../../../src/data/elite-redux/coop/coop-runtime.ts", import.meta.url), "utf8");
const replay = await readFile(new URL("../../../src/phases/coop-replay-turn-phase.ts", import.meta.url), "utf8");

test("a late turn-one renderer reads its exact retired command prefix from the V2 ledger", () => {
  assert.match(runtime, /export function readRetainedCoopV2CommandEntryPresentation\(/u);
  assert.match(runtime, /runtime\.v2ControlLedger\.sourceEntryOf\(control\)/u);
  assert.match(runtime, /source\?\.kind !== "CONTROL_COMMIT"/u);
  assert.match(runtime, /material\?\.kind !== "command-open"/u);
  assert.match(runtime, /!controlsEqual\(source\.nextControl, control\)/u);
  assert.match(runtime, /events: structuredClone\(material\.entryPresentation\)/u);
  assert.match(runtime, /controlOperationId: source\.operationId/u);

  const readIndex = replay.indexOf("readRetainedCoopV2CommandEntryPresentation(this.sourceWave, this.turn)");
  const waitIndex = replay.indexOf("this.v2EntryPresentationResolver = resolve", readIndex);
  assert.ok(readIndex >= 0, "the presentation-only replay must consult the retained global-log source");
  assert.ok(waitIndex > readIndex, "the impossible network wait may only be installed after the ledger fallback");
  assert.match(replay.slice(readIndex, waitIndex), /return Promise\.resolve\(retained\)/u);
});
