/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import test from "node:test";
import { commanderObservationView } from "./evidence.mjs";

test("Commander observer parser binds the owner, command address, species, and mechanical digest", () => {
  const observation = {
    version: 1,
    localRole: "host",
    localSeat: 0,
    commanderOwnerRole: "guest",
    epoch: 73,
    membershipRevision: 4,
    connectionGeneration: 2,
    observationPhase: "CoopReplayTurnPhase",
    wave: 1,
    turn: 3,
    point: "cmd:1:3",
    stateDigest: "0123456789abcdef",
    commanderPokemonId: 42,
    commanderSpeciesId: 978,
    commanderBattlerIndex: 1,
    commandedPokemonId: 41,
    commandedSpeciesId: 977,
    commandedBattlerIndex: 0,
  };
  assert.deepEqual(commanderObservationView(`[coop-browser:commander] ${JSON.stringify(observation)}`), observation);
  assert.throws(
    () => commanderObservationView(`[coop-browser:commander] ${JSON.stringify({ ...observation, point: "cmd:1:4" })}`),
    /invalid Commander observation/u,
  );
  assert.throws(
    () =>
      commanderObservationView(
        `[coop-browser:commander] ${JSON.stringify({ ...observation, stateDigest: "0000000000000000" })}`,
      ),
    /invalid Commander observation/u,
  );
  assert.throws(
    () =>
      commanderObservationView(
        `[coop-browser:commander] ${JSON.stringify({ ...observation, observationPhase: "MovePhase" })}`,
      ),
    /invalid Commander observation/u,
  );
});
