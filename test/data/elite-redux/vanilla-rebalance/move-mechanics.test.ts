/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase B Task B3 round 3: vanilla move mechanic-rebalance tests.
//
// Asserts that each vanilla move whose mechanic ER rebalances has its
// type / category / attrs / flags / moveTarget mutated as expected at startup.
// Same pattern as the sibling `ability-mechanics.test.ts`: the harness's
// global init pipeline (`initEliteReduxVanillaRebalance()`) has already run by
// the time the test suite loads, so we assert on the post-init state of the
// live `allMoves[<id>]` entries.
// =============================================================================

import { allMoves } from "#data/data-lists";
import {
  ConfuseAttr,
  FlinchAttr,
  HighCritAttr,
  HitHealAttr,
  type Move,
  MultiHitAttr,
  OneHitKOAttr,
  PhotonGeyserCategoryAttr,
  RecoilAttr,
  StatStageChangeAttr,
  StatusEffectAttr,
} from "#data/moves/move";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";
import { describe, expect, it } from "vitest";

function getMove(id: MoveId): Move {
  const move = allMoves.find(m => m?.id === id);
  expect(move, `move ${MoveId[id]} not found`).toBeDefined();
  return move!;
}

function hasAttrCtor(move: Move, ctor: new (...args: never[]) => unknown): boolean {
  return move.attrs.some(a => a.constructor === ctor);
}

describe("ER vanilla move rebalance — TOTAL OHKO nerfs", () => {
  it("GUILLOTINE is re-typed to Bug and no longer OHKO", () => {
    const move = getMove(MoveId.GUILLOTINE);
    expect(move.type).toBe(PokemonType.BUG);
    expect(hasAttrCtor(move, OneHitKOAttr)).toBe(false);
    expect(hasAttrCtor(move, HighCritAttr)).toBe(true);
    expect(move.hasFlag(MoveFlags.SLICING_MOVE)).toBe(true);
  });

  it("HORN_DRILL drops OHKO and gains high crit + ignore-abilities + horn flag", () => {
    const move = getMove(MoveId.HORN_DRILL);
    expect(hasAttrCtor(move, OneHitKOAttr)).toBe(false);
    expect(hasAttrCtor(move, HighCritAttr)).toBe(true);
    expect(move.hasFlag(MoveFlags.IGNORE_ABILITIES)).toBe(true);
    expect(move.hasFlag(MoveFlags.HORN_BASED)).toBe(true);
  });

  it("FISSURE drops OHKO and widens target to all near enemies", () => {
    const move = getMove(MoveId.FISSURE);
    expect(hasAttrCtor(move, OneHitKOAttr)).toBe(false);
    expect(move.moveTarget).toBe(MoveTarget.ALL_NEAR_ENEMIES);
  });

  it("SHEER_COLD drops OHKO and adds a freeze/frostbite status proc", () => {
    const move = getMove(MoveId.SHEER_COLD);
    expect(hasAttrCtor(move, OneHitKOAttr)).toBe(false);
    expect(hasAttrCtor(move, StatusEffectAttr)).toBe(true);
  });
});

describe("ER vanilla move rebalance — TOTAL STATUS → damaging conversions", () => {
  it("WHIRLWIND becomes a Special Flying wind move", () => {
    const move = getMove(MoveId.WHIRLWIND);
    expect(move.category).toBe(MoveCategory.SPECIAL);
    expect(move.type).toBe(PokemonType.FLYING);
    expect(move.hasFlag(MoveFlags.WIND_MOVE)).toBe(true);
  });

  it("GROWL becomes a Special sound damaging move", () => {
    const move = getMove(MoveId.GROWL);
    expect(move.category).toBe(MoveCategory.SPECIAL);
    expect(move.hasFlag(MoveFlags.SOUND_BASED)).toBe(true);
  });

  it("POISON_GAS becomes a Special spread move", () => {
    const move = getMove(MoveId.POISON_GAS);
    expect(move.category).toBe(MoveCategory.SPECIAL);
    expect(move.moveTarget).toBe(MoveTarget.ALL_NEAR_ENEMIES);
  });

  it("FLASH becomes a Special Electric damaging move", () => {
    const move = getMove(MoveId.FLASH);
    expect(move.category).toBe(MoveCategory.SPECIAL);
    expect(move.type).toBe(PokemonType.ELECTRIC);
    expect(move.hasFlag(MoveFlags.FIELD_BASED)).toBe(true);
  });

  it("NIGHTMARE becomes a Special damaging move", () => {
    const move = getMove(MoveId.NIGHTMARE);
    expect(move.category).toBe(MoveCategory.SPECIAL);
  });

  it("OCTOLOCK becomes a Physical damaging move", () => {
    const move = getMove(MoveId.OCTOLOCK);
    expect(move.category).toBe(MoveCategory.PHYSICAL);
  });

  it("DECORATE becomes a Special damaging move", () => {
    const move = getMove(MoveId.DECORATE);
    expect(move.category).toBe(MoveCategory.SPECIAL);
  });

  it("CAPTIVATE becomes a Special Fairy damaging move", () => {
    const move = getMove(MoveId.CAPTIVATE);
    expect(move.category).toBe(MoveCategory.SPECIAL);
    expect(move.type).toBe(PokemonType.FAIRY);
  });
});

describe("ER vanilla move rebalance — TOTAL type/category swaps", () => {
  it("VISE_GRIP becomes Bug-type", () => {
    expect(getMove(MoveId.VISE_GRIP).type).toBe(PokemonType.BUG);
  });

  it("CUT becomes Steel-type with FIELD_BASED flag", () => {
    const move = getMove(MoveId.CUT);
    expect(move.type).toBe(PokemonType.STEEL);
    expect(move.hasFlag(MoveFlags.FIELD_BASED)).toBe(true);
  });

  it("RAZOR_WIND becomes Flying-type", () => {
    expect(getMove(MoveId.RAZOR_WIND).type).toBe(PokemonType.FLYING);
  });

  it("EGG_BOMB becomes Fire-type with burn proc + THROW_BASED", () => {
    const move = getMove(MoveId.EGG_BOMB);
    expect(move.type).toBe(PokemonType.FIRE);
    expect(move.hasFlag(MoveFlags.THROW_BASED)).toBe(true);
    expect(hasAttrCtor(move, StatusEffectAttr)).toBe(true);
  });

  it("SPIKE_CANNON becomes Water-type with PULSE_MOVE flag", () => {
    const move = getMove(MoveId.SPIKE_CANNON);
    expect(move.type).toBe(PokemonType.WATER);
    expect(move.hasFlag(MoveFlags.PULSE_MOVE)).toBe(true);
  });

  it("BARRAGE becomes Steel-type", () => {
    expect(getMove(MoveId.BARRAGE).type).toBe(PokemonType.STEEL);
  });

  it("HOLD_BACK becomes Fighting-type with confuse rider", () => {
    const move = getMove(MoveId.HOLD_BACK);
    expect(move.type).toBe(PokemonType.FIGHTING);
    expect(hasAttrCtor(move, ConfuseAttr)).toBe(true);
  });

  it("AXE_KICK becomes Dark-type with confuse rider", () => {
    const move = getMove(MoveId.AXE_KICK);
    expect(move.type).toBe(PokemonType.DARK);
    expect(hasAttrCtor(move, ConfuseAttr)).toBe(true);
  });
});

describe("ER vanilla move rebalance — MAJOR UseHighestOffenseAttr", () => {
  it("BLAST_BURN uses highest-offense category selection", () => {
    expect(hasAttrCtor(getMove(MoveId.BLAST_BURN), PhotonGeyserCategoryAttr)).toBe(true);
  });

  it("HYDRO_CANNON uses highest-offense category selection", () => {
    expect(hasAttrCtor(getMove(MoveId.HYDRO_CANNON), PhotonGeyserCategoryAttr)).toBe(true);
  });

  it("FRENZY_PLANT uses highest-offense category selection", () => {
    expect(hasAttrCtor(getMove(MoveId.FRENZY_PLANT), PhotonGeyserCategoryAttr)).toBe(true);
  });

  it("TRI_ATTACK uses highest-offense category selection", () => {
    expect(hasAttrCtor(getMove(MoveId.TRI_ATTACK), PhotonGeyserCategoryAttr)).toBe(true);
  });

  it("BLEAKWIND_STORM / WILDBOLT_STORM / SANDSEAR_STORM use highest-offense", () => {
    expect(hasAttrCtor(getMove(MoveId.BLEAKWIND_STORM), PhotonGeyserCategoryAttr)).toBe(true);
    expect(hasAttrCtor(getMove(MoveId.WILDBOLT_STORM), PhotonGeyserCategoryAttr)).toBe(true);
    expect(hasAttrCtor(getMove(MoveId.SANDSEAR_STORM), PhotonGeyserCategoryAttr)).toBe(true);
  });

  it("ROCK_WRECKER uses highest-offense + THROW_BASED flag", () => {
    const move = getMove(MoveId.ROCK_WRECKER);
    expect(hasAttrCtor(move, PhotonGeyserCategoryAttr)).toBe(true);
    expect(move.hasFlag(MoveFlags.THROW_BASED)).toBe(true);
  });

  it("PRISMATIC_LASER uses highest-offense + PULSE_MOVE flag", () => {
    const move = getMove(MoveId.PRISMATIC_LASER);
    expect(hasAttrCtor(move, PhotonGeyserCategoryAttr)).toBe(true);
    expect(move.hasFlag(MoveFlags.PULSE_MOVE)).toBe(true);
  });
});

describe("ER vanilla move rebalance — MAJOR status/stat-on-hit additions", () => {
  it("VINE_WHIP gains flinch", () => {
    expect(hasAttrCtor(getMove(MoveId.VINE_WHIP), FlinchAttr)).toBe(true);
  });

  it("ROUND gains flinch", () => {
    expect(hasAttrCtor(getMove(MoveId.ROUND), FlinchAttr)).toBe(true);
  });

  it("DRAGON_RUSH gains recoil", () => {
    expect(hasAttrCtor(getMove(MoveId.DRAGON_RUSH), RecoilAttr)).toBe(true);
  });

  it("CROSS_POISON gains MultiHitAttr (TWO)", () => {
    expect(hasAttrCtor(getMove(MoveId.CROSS_POISON), MultiHitAttr)).toBe(true);
  });

  it("PSYBEAM gains SPATK-drop StatStageChangeAttr", () => {
    const move = getMove(MoveId.PSYBEAM);
    expect(hasAttrCtor(move, StatStageChangeAttr)).toBe(true);
  });

  it("PECK gains multi-hit + HORN_BASED flag", () => {
    const move = getMove(MoveId.PECK);
    expect(hasAttrCtor(move, MultiHitAttr)).toBe(true);
    expect(move.hasFlag(MoveFlags.HORN_BASED)).toBe(true);
  });

  it("ESPER_WING gains drain (HitHealAttr)", () => {
    expect(hasAttrCtor(getMove(MoveId.ESPER_WING), HitHealAttr)).toBe(true);
  });

  it("WILD_CHARGE gains paralysis status", () => {
    expect(hasAttrCtor(getMove(MoveId.WILD_CHARGE), StatusEffectAttr)).toBe(true);
  });
});

describe("ER vanilla move rebalance — MAJOR spread / category swaps", () => {
  it("ACID widens to ALL_NEAR_ENEMIES", () => {
    expect(getMove(MoveId.ACID).moveTarget).toBe(MoveTarget.ALL_NEAR_ENEMIES);
  });

  it("BUBBLE widens to ALL_NEAR_ENEMIES", () => {
    expect(getMove(MoveId.BUBBLE).moveTarget).toBe(MoveTarget.ALL_NEAR_ENEMIES);
  });

  it("BIND swaps to SPECIAL category", () => {
    expect(getMove(MoveId.BIND).category).toBe(MoveCategory.SPECIAL);
  });

  it("AIR_CUTTER swaps to PHYSICAL category", () => {
    expect(getMove(MoveId.AIR_CUTTER).category).toBe(MoveCategory.PHYSICAL);
  });

  it("MAGNET_BOMB swaps to SPECIAL category", () => {
    expect(getMove(MoveId.MAGNET_BOMB).category).toBe(MoveCategory.SPECIAL);
  });

  it("DIAMOND_STORM swaps to SPECIAL category", () => {
    expect(getMove(MoveId.DIAMOND_STORM).category).toBe(MoveCategory.SPECIAL);
  });
});

describe("ER vanilla move rebalance — MINOR-flag fixes", () => {
  it("EARTHQUAKE gains FIELD_BASED flag", () => {
    expect(getMove(MoveId.EARTHQUAKE).hasFlag(MoveFlags.FIELD_BASED)).toBe(true);
  });

  it("DIG gains FIELD_BASED flag", () => {
    expect(getMove(MoveId.DIG).hasFlag(MoveFlags.FIELD_BASED)).toBe(true);
  });

  it("BONEMERANG gains THROW_BASED + BONE_BASED flags", () => {
    const move = getMove(MoveId.BONEMERANG);
    expect(move.hasFlag(MoveFlags.THROW_BASED)).toBe(true);
    expect(move.hasFlag(MoveFlags.BONE_BASED)).toBe(true);
  });

  it("MEGAHORN gains HORN_BASED flag", () => {
    expect(getMove(MoveId.MEGAHORN).hasFlag(MoveFlags.HORN_BASED)).toBe(true);
  });

  it("WOOD_HAMMER gains HAMMER_BASED flag", () => {
    expect(getMove(MoveId.WOOD_HAMMER).hasFlag(MoveFlags.HAMMER_BASED)).toBe(true);
  });

  it("PIN_MISSILE gains ARROW_BASED flag", () => {
    expect(getMove(MoveId.PIN_MISSILE).hasFlag(MoveFlags.ARROW_BASED)).toBe(true);
  });
});

describe("ER vanilla move rebalance — idempotency", () => {
  it("re-running the patcher is a no-op (moveDeltas of mech-patcher is 0)", async () => {
    // Re-import the function and verify a fresh call returns 0 deltas because
    // every patcher target carries the MOVE_PATCHED_MARKER sentinel after the
    // harness's startup run.
    const { initEliteReduxVanillaMovePatches } = await import(
      "#data/elite-redux/init-elite-redux-vanilla-move-patches"
    );
    const result = initEliteReduxVanillaMovePatches();
    expect(result.moveDeltas).toBe(0);
    expect(result.moveErrors).toHaveLength(0);
  });
});
