/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP REPLICATION CONTRACT TEST (accepted-review item 4 - single source of field truth).
//
// The replicated per-turn contract lives in THREE hand-maintained implementations that must
// agree field-for-field - CAPTURE (captureCoopAuthoritativeBattleState), APPLY
// (applyCoopAuthoritativeBattleState), HASH (captureCoopChecksumState). #875 (material state
// omitted from the hash) and #876 (ephemeral state hashed but unappliable) are both DRIFT
// between those three. This file MECHANICALLY diffs the LIVE runtime keys of capture + hash
// against the declared contract (coop-replication-contract.ts) and FAILS on any field present
// in one set but missing from another without a documented exclusion.
//
//   PURE (always runs): the contract table is internally consistent - every non-applied field
//     carries an applyExcluded reason, every non-hashed field an excluded reason, and every
//     `direct`/`derived` hash reference names a real checksum field.
//   ER_SCENARIO=1: the LIVE capture/hash runtime keys EQUAL the contract exactly - so adding a
//     wire field without hashing it, or DROPPING a hash field (the #875 class - remove
//     `benchMoves`), FAILS the exact-set diff.
//
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-replication-contract.test.ts
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import {
  captureCoopAuthoritativeBattleState,
  captureCoopChecksumState,
} from "#data/elite-redux/coop/coop-battle-engine";
import {
  COOP_AUTHORITATIVE_WIRE_FIELDS,
  COOP_CHECKSUM_FIELDS,
  coopChecksumFieldNames,
  coopWireFieldNames,
} from "#data/elite-redux/coop/coop-replication-contract";
import { clearCoopRuntime, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe("co-op replication contract - single source of field truth (item 4)", () => {
  // ---- PURE (always runs): the contract table's internal consistency. ----
  describe("contract table consistency", () => {
    it("every wire field is either applied or carries an applyExcluded reason", () => {
      for (const f of COOP_AUTHORITATIVE_WIRE_FIELDS) {
        if (!f.applied) {
          expect(
            typeof f.applyExcluded === "string" && f.applyExcluded.length > 0,
            `wire field '${f.name}' is not applied and MUST document an applyExcluded reason`,
          ).toBe(true);
        }
      }
    });

    it("every wire field's hash coverage is documented (excluded reason, or a real checksum reference)", () => {
      const checksumNames = coopChecksumFieldNames();
      for (const f of COOP_AUTHORITATIVE_WIRE_FIELDS) {
        if (f.hash.kind === "excluded") {
          expect(f.hash.reason.length > 0, `wire field '${f.name}' is hash-excluded and MUST carry a reason`).toBe(
            true,
          );
          continue;
        }
        expect(f.hash.into.length, `wire field '${f.name}' hash coverage names no checksum field`).toBeGreaterThan(0);
        for (const target of f.hash.into) {
          expect(
            checksumNames.has(target),
            `wire field '${f.name}' hash reference '${target}' is not a registered checksum field`,
          ).toBe(true);
        }
      }
    });

    it("wire + checksum field names are unique (no duplicate contract entries)", () => {
      const wire = COOP_AUTHORITATIVE_WIRE_FIELDS.map(f => f.name);
      const checksum = COOP_CHECKSUM_FIELDS.map(f => f.name);
      expect(new Set(wire).size, "duplicate wire field name").toBe(wire.length);
      expect(new Set(checksum).size, "duplicate checksum field name").toBe(checksum.length);
    });

    it("every checksum field names at least one source wire field", () => {
      for (const f of COOP_CHECKSUM_FIELDS) {
        expect(f.source.length, `checksum field '${f.name}' names no source wire field`).toBeGreaterThan(0);
      }
    });
  });

  // ---- ER_SCENARIO: the LIVE capture/hash runtime keys EQUAL the contract exactly. ----
  describe.skipIf(!RUN)("live runtime keys match the contract (real engine)", () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      game.override
        .battleStyle("double")
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyMoveset(MoveId.SPLASH)
        .moveset([MoveId.TACKLE, MoveId.SPLASH]);
    });

    afterEach(() => {
      clearCoopRuntime();
    });

    const startCoopDouble = async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      startLocalCoopSession({ username: "Host", netcodeMode: "authoritative" });
      game.scene.gameMode = getGameMode(GameModes.COOP);
      const field = game.scene.getPlayerField();
      field[COOP_HOST_FIELD_INDEX].coopOwner = "host";
      field[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";
      return field;
    };

    it("captureCoopAuthoritativeBattleState emits EXACTLY the contracted wire fields", async () => {
      await startCoopDouble();
      const state = captureCoopAuthoritativeBattleState(globalScene.currentBattle.turn);
      expect(state, "capture produced a state").not.toBeNull();
      const runtimeKeys = new Set(Object.keys(state!));
      const contractKeys = coopWireFieldNames();
      const missingFromCapture = [...contractKeys].filter(k => !runtimeKeys.has(k));
      const undocumentedInCapture = [...runtimeKeys].filter(k => !contractKeys.has(k));
      expect(missingFromCapture, "contract declares wire fields the capture no longer emits").toEqual([]);
      expect(
        undocumentedInCapture,
        "capture emits wire fields absent from the contract (register them + document hash coverage)",
      ).toEqual([]);
    });

    it("captureCoopChecksumState hashes EXACTLY the contracted fields (a dropped hash field FAILS here)", async () => {
      await startCoopDouble();
      const runtimeKeys = new Set(Object.keys(captureCoopChecksumState()));
      const contractKeys = coopChecksumFieldNames();
      const missingFromHash = [...contractKeys].filter(k => !runtimeKeys.has(k));
      const undocumentedInHash = [...runtimeKeys].filter(k => !contractKeys.has(k));
      // A field the contract requires but the hash no longer emits = the #875 class (material state dropped
      // from detection, e.g. benchMoves). An exact-set mismatch reds the contract.
      expect(missingFromHash, "contract requires hash fields the checksum no longer emits (#875 class)").toEqual([]);
      expect(undocumentedInHash, "the checksum hashes fields absent from the contract (register them)").toEqual([]);
    });
  });
});
