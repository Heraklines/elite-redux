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
