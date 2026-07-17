/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import test from "node:test";
import { semanticSurfaceView } from "./evidence.mjs";

const PREFIX = "[coop-browser:surface2] ";

function valid(overrides = {}) {
  return {
    version: 2,
    surfaceId: "reward-shop",
    operationClass: "reward",
    ownerModel: "interaction",
    coop: true,
    address: { epoch: 7, wave: 10, turn: 2 },
    membershipRevision: 3,
    connectionGeneration: 1,
    localSeat: 0,
    localRole: "host",
    ownerSeat: 1,
    seatsWithInput: [1],
    selectedOptionId: "RARE_CANDY",
    optionIds: ["RARE_CANDY"],
    optionCount: 1,
    teamSpeciesIds: null,
    ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: false },
    phase: "SelectModifierPhase",
    phaseInstance: 4,
    surfaceGeneration: 2,
    mysteryEncounterType: 17,
    stateDigest: "0123456789abcdef",
    uiMode: "MODIFIER_SELECT",
    ...overrides,
  };
}

test("semantic evidence ignores unrelated console lines and freezes a valid proof", () => {
  assert.equal(semanticSurfaceView("ordinary game log"), null);
  const parsed = semanticSurfaceView(`${PREFIX}${JSON.stringify(valid())}`);
  assert.equal(parsed.surfaceId, "reward-shop");
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.address));
  assert.ok(Object.isFrozen(parsed.ready));
  assert.ok(Object.isFrozen(parsed.seatsWithInput));
});

test("semantic evidence accepts an exact non-actionable replay watcher", () => {
  const parsed = semanticSurfaceView(
    `${PREFIX}${JSON.stringify(
      valid({
        surfaceId: "command:watcher",
        operationClass: "command",
        ownerModel: "local",
        ownerSeat: null,
        seatsWithInput: [],
        selectedOptionId: null,
        optionIds: null,
        optionCount: null,
        ready: { handlerActive: false, awaitingActionInput: false, inputBlocked: true },
        phase: "CoopReplayTurnPhase",
        surfaceGeneration: null,
        uiMode: "MESSAGE",
      }),
    )}`,
  );
  assert.equal(parsed.surfaceId, "command:watcher");
  assert.deepEqual(parsed.seatsWithInput, []);
});

test("semantic evidence accepts an exact locally owned battle target surface", () => {
  const parsed = semanticSurfaceView(
    `${PREFIX}${JSON.stringify(
      valid({
        surfaceId: "command:target",
        operationClass: "command",
        ownerModel: "local",
        ownerSeat: null,
        seatsWithInput: [1],
        localSeat: 1,
        localRole: "guest",
        selectedOptionId: "battle-target:2",
        optionIds: ["battle-target:2", "battle-target:3"],
        optionCount: 2,
        ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
        phase: "SelectTargetPhase",
        surfaceGeneration: null,
        uiMode: "TARGET_SELECT",
      }),
    )}`,
  );
  assert.equal(parsed.surfaceId, "command:target");
  assert.equal(parsed.selectedOptionId, "battle-target:2");
});

test("semantic evidence accepts the paired pre-battle title surface without weakening gameplay epochs", () => {
  const parsed = semanticSurfaceView(
    `${PREFIX}${JSON.stringify(
      valid({
        surfaceId: "confirm:TitlePhase",
        operationClass: "confirm",
        address: { epoch: 0, wave: 0, turn: 0 },
        selectedOptionId: "yes",
        optionIds: ["yes", "no"],
        optionCount: 2,
        phase: "TitlePhase",
        stateDigest: null,
        uiMode: "CONFIRM",
      }),
    )}`,
  );
  assert.deepEqual(parsed.address, { epoch: 0, wave: 0, turn: 0 });
  assert.throws(
    () =>
      semanticSurfaceView(
        `${PREFIX}${JSON.stringify(
          valid({
            address: { epoch: 0, wave: 1, turn: 1 },
          }),
        )}`,
      ),
    /invalid semantic surface observation/u,
  );
});

test("semantic evidence rejects every malformed claimed proof", () => {
  assert.throws(() => semanticSurfaceView(`${PREFIX}{`), /invalid semantic surface JSON/u);
  assert.throws(
    () => semanticSurfaceView(`${PREFIX}${JSON.stringify(valid({ ownerModel: "ambient" }))}`),
    /invalid semantic surface observation/u,
  );
  assert.throws(
    () => semanticSurfaceView(`${PREFIX}${JSON.stringify(valid({ ready: { handlerActive: "yes" } }))}`),
    /invalid semantic surface observation/u,
  );
  assert.throws(
    () =>
      semanticSurfaceView(
        `${PREFIX}${JSON.stringify(valid({ ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: "no" } }))}`,
      ),
    /invalid semantic surface observation/u,
  );
  assert.throws(
    () => semanticSurfaceView(`${PREFIX}${JSON.stringify(valid({ address: { epoch: 0, wave: 10, turn: 2 } }))}`),
    /invalid semantic surface observation/u,
  );
  assert.throws(
    () => semanticSurfaceView(`${PREFIX}${JSON.stringify(valid({ seatsWithInput: [1, 1] }))}`),
    /invalid semantic surface observation/u,
  );
  assert.throws(
    () => semanticSurfaceView(`${PREFIX}${JSON.stringify(valid({ mysteryEncounterType: "17" }))}`),
    /invalid semantic surface observation/u,
  );
  assert.throws(
    () => semanticSurfaceView(`${PREFIX}${JSON.stringify(valid({ stateDigest: "0000000000000000" }))}`),
    /invalid semantic surface observation/u,
  );
  assert.throws(
    () => semanticSurfaceView(`${PREFIX}${JSON.stringify(valid({ stateDigest: null }))}`),
    /invalid semantic surface observation/u,
  );
});
