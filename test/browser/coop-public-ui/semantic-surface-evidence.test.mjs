/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import test from "node:test";
import { semanticSurfaceView, trainerPostconditionView, trainerTransitionView } from "./evidence.mjs";

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
    connectionGenerations: [1, 1],
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
    displayedWave: 10,
    stateDigest: "0123456789abcdef",
    presentation: {
      trainerVisible: false,
      enemyTrainerVisible: true,
      enemyTrainerAlpha: 0,
      enemyTrainerPresented: false,
      expectedPlayerFieldIds: [101, 102],
      playerField: [
        {
          pokemonId: 101,
          partySlot: 0,
          visible: true,
          alpha: 1,
          spriteVisible: true,
          spriteAlpha: 1,
          infoVisible: true,
          infoAlpha: 1,
        },
        {
          pokemonId: 102,
          partySlot: 1,
          visible: true,
          alpha: 1,
          spriteVisible: true,
          spriteAlpha: 1,
          infoVisible: true,
          infoAlpha: 1,
        },
      ],
      playerFieldReady: true,
    },
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
  assert.ok(Object.isFrozen(parsed.connectionGenerations));
  assert.ok(Object.isFrozen(parsed.presentation));
  assert.ok(Object.isFrozen(parsed.presentation.expectedPlayerFieldIds));
  assert.ok(Object.isFrozen(parsed.presentation.playerField));
  assert.ok(Object.isFrozen(parsed.presentation.playerField[0]));
});

test("semantic evidence rejects a dishonest defeated-trainer presentation verdict", () => {
  assert.throws(
    () =>
      semanticSurfaceView(
        `${PREFIX}${JSON.stringify(
          valid({
            presentation: {
              ...valid().presentation,
              trainerVisible: false,
              enemyTrainerVisible: true,
              enemyTrainerAlpha: 1,
              enemyTrainerPresented: false,
            },
          }),
        )}`,
      ),
    /invalid semantic surface/u,
  );
});

test("trainer postcondition evidence is exact, frozen, and rejects a dishonest derived verdict", () => {
  const event = { k: "switch", bi: 2, partySlot: 2, pokemonId: 44, speciesId: 10, switchType: 1, doReturn: true };
  const valid = {
    version: 1,
    role: "guest",
    epoch: 7,
    wave: 11,
    turn: 3,
    seq: 0,
    event,
    trainerVisible: true,
    trainerAlpha: 0,
    trainerPresented: false,
  };
  const prefix = "[coop-browser:trainer-postcondition] ";
  const parsed = trainerPostconditionView(`${prefix}${JSON.stringify(valid)}`);
  assert.equal(parsed.trainerPresented, false);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.event));
  assert.throws(
    () => trainerPostconditionView(`${prefix}${JSON.stringify({ ...valid, trainerAlpha: 1 })}`),
    /invalid trainer-postcondition/u,
  );
});

test("trainer transition evidence requires a visible trainer over mechanically retained hidden field seats", () => {
  const prefix = "[coop-browser:trainer-transition] ";
  const valid = {
    version: 1,
    role: "guest",
    epoch: 17,
    wave: 7,
    trainerVisible: true,
    trainerAlpha: 1,
    trainerPresented: true,
    playerField: [
      {
        pokemonId: 101,
        onField: true,
        pokemonVisible: false,
        spriteVisible: false,
        infoVisible: false,
      },
    ],
  };
  assert.deepEqual(trainerTransitionView(`${prefix}${JSON.stringify(valid)}`), valid);
  assert.throws(
    () => trainerTransitionView(`${prefix}${JSON.stringify({ ...valid, trainerPresented: false })}`),
    /invalid trainer-transition/u,
  );
  assert.throws(
    () =>
      trainerTransitionView(
        `${prefix}${JSON.stringify({
          ...valid,
          playerField: [{ ...valid.playerField[0], pokemonVisible: true }],
        })}`,
      ),
    /invalid trainer-transition/u,
  );
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

test("semantic evidence accepts an authoritative partner-command watcher", () => {
  const parsed = semanticSurfaceView(
    `${PREFIX}${JSON.stringify(
      valid({
        surfaceId: "command:watcher",
        operationClass: "command",
        ownerModel: "local",
        localSeat: 0,
        localRole: "host",
        ownerSeat: 1,
        seatsWithInput: [1],
        selectedOptionId: "cursor:0",
        optionIds: null,
        optionCount: null,
        ready: { handlerActive: true, awaitingActionInput: false, inputBlocked: null },
        phase: "CommandPhase",
        surfaceGeneration: null,
        uiMode: "MESSAGE",
      }),
    )}`,
  );
  assert.equal(parsed.surfaceId, "command:watcher");
  assert.equal(parsed.ownerSeat, 1);
  assert.deepEqual(parsed.seatsWithInput, [1]);
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
        displayedWave: null,
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
    () => semanticSurfaceView(`${PREFIX}${JSON.stringify(valid({ displayedWave: "10" }))}`),
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
