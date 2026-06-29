/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER: a Pokemon that sets up on switch-in via an ability (e.g. Air Blower casts
// Tailwind on entry) must NOT have that setup cancelled by an opponent's
// on-switch-in flinch move (e.g. Jumpscare's Astonish, when it goes first).
//
// The on-entry SELF-BUFF cast used MoveUseMode.INDIRECT, which is NOT
// ignore-status (move-use-mode.ts isIgnoreStatus -> false), so its MovePhase ran
// firstFailureCheck()'s FLINCHED cancel (move-phase.ts) - a faster on-entry
// flincher could wipe the setup. Self-targeting on-entry casts now use
// MoveUseMode.FOLLOW_UP (ignore-status -> the FLINCHED pre-move cancel is
// skipped); offensive on-entry casts (which target the foe) keep INDIRECT.
//
// We assert the USE MODE the ability picks (the fix) + that Air Blower still sets
// Tailwind on entry (integration). The "FOLLOW_UP bypasses the flinch cancel"
// half is guaranteed by move-phase.ts (isIgnoreStatus gates firstFailureCheck,
// which is the ONLY thing that runs the FLINCHED cancel).
//
// Gated ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

async function erId(id: number): Promise<AbilityId | undefined> {
  const map = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return map.abilities[id] as AbilityId | undefined;
}

/** Fire `attr` and return the useMode of the MovePhase it unshifts. */
function castUseMode(attr: PostSummonScriptedMoveAbAttr): MoveUseMode | undefined {
  const player = globalScene.getPlayerPokemon()!;
  const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew");
  attr.apply({ pokemon: player });
  const call = spy.mock.calls.find(c => c[0] === "MovePhase");
  spy.mockRestore();
  return call?.[4] as MoveUseMode | undefined;
}

describe.skipIf(!RUN)("ER on-entry setup is not cancelled by flinch", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .moveset(MoveId.SPLASH)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
  });

  it("Air Blower sets Tailwind on entry (integration)", async () => {
    const airBlower = await erId(320);
    if (airBlower === undefined) {
      return;
    }
    game.override.ability(airBlower);
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    expect(globalScene.arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER)).toBeDefined();
  });

  it("FIX: a SELF-targeting on-entry cast uses FOLLOW_UP (flinch-immune)", async () => {
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    const mode = castUseMode(new PostSummonScriptedMoveAbAttr({ moveId: MoveId.TAILWIND, targetsSelf: true }));
    expect(mode).toBe(MoveUseMode.FOLLOW_UP);
  });

  it("an OFFENSIVE on-entry cast keeps INDIRECT (flinch may interrupt an attack)", async () => {
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    const mode = castUseMode(new PostSummonScriptedMoveAbAttr({ moveId: MoveId.ASTONISH, targetsSelf: false }));
    expect(mode).toBe(MoveUseMode.INDIRECT);
  });
});
