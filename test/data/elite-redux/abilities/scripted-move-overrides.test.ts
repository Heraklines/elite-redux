/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { AbAttrBaseParams } from "#abilities/ab-attrs";
import { dispatchBespoke } from "#data/elite-redux/archetype-dispatcher";
import { PostAttackScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-attack-scripted-move";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { ScriptedMagnitudePowerAttr, scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { ErMoveId } from "#enums/er-move-id";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import { MagnitudePowerAttr } from "#moves/move";
import { describe, expect, it } from "vitest";

interface PostAttackOptions {
  readonly moveId: MoveId;
  readonly power?: number;
  readonly categoryFilter?: MoveCategory;
  readonly typeFilter?: readonly PokemonType[];
  readonly flagFilter?: MoveFlags;
  readonly magnitudeRange?: readonly [number, number];
}

interface PostSummonOptions {
  readonly moveId: MoveId;
  readonly power?: number;
  readonly oncePerBattleKey?: string;
}

function postAttackOptions(id: number): PostAttackOptions {
  const attr = dispatchBespoke(id).attrs.find(candidate => candidate instanceof PostAttackScriptedMoveAbAttr);
  expect(attr).toBeDefined();
  return (attr as unknown as { opts: PostAttackOptions }).opts;
}

function postSummonOptions(id: number): PostSummonOptions {
  const attr = dispatchBespoke(id).attrs.find(candidate => candidate instanceof PostSummonScriptedMoveAbAttr);
  expect(attr).toBeDefined();
  return (attr as unknown as { opts: PostSummonOptions }).opts;
}

describe("ER scripted move overrides", () => {
  it("uses the dex move, power, and trigger filters", () => {
    expect(postAttackOptions(382)).toEqual({
      moveId: MoveId.ERUPTION,
      power: 50,
      typeFilter: [PokemonType.FIRE],
    });
    expect(postAttackOptions(397)).toEqual({
      moveId: ErMoveId.OUTBURST,
      power: 50,
      flagFilter: MoveFlags.PULSE_MOVE,
    });
    expect(postAttackOptions(491)).toEqual({
      moveId: MoveId.MAGNITUDE,
      magnitudeRange: [4, 7],
    });
    expect(postAttackOptions(853)).toEqual({
      moveId: MoveId.POISON_GAS,
      power: 20,
    });
    expect(postAttackOptions(876)).toEqual({
      moveId: ErMoveId.VENOM_BOLT,
      power: 35,
    });
    expect(postAttackOptions(993)).toEqual({
      moveId: MoveId.THUNDERBOLT,
      power: 35,
      categoryFilter: MoveCategory.SPECIAL,
    });
  });

  it("replaces Magnitude's unrestricted power roll for Aftershock", () => {
    const move = scriptedPokemonMove(MoveId.MAGNITUDE, undefined, { magnitudeRange: [4, 7] }).getMove();
    expect(move.attrs.some(attr => attr instanceof ScriptedMagnitudePowerAttr)).toBe(true);
    expect(
      move.attrs.some(attr => attr instanceof MagnitudePowerAttr && !(attr instanceof ScriptedMagnitudePowerAttr)),
    ).toBe(false);
  });

  it("limits Jumpscare to its first switch-in and uses 40 BP Astonish", () => {
    const opts = postSummonOptions(718);
    expect(opts).toEqual({
      moveId: MoveId.ASTONISH,
      power: 40,
      oncePerBattleKey: "jumpscare-scripted-move",
    });

    const fired = new Set<string>();
    const pokemon = {
      waveData: { entryEffectsFired: fired },
      getOpponents: () => [{ isFainted: () => false }],
    } as unknown as Pokemon;
    const attr = new PostSummonScriptedMoveAbAttr(opts);
    const params = { pokemon, simulated: false } as AbAttrBaseParams;

    expect(attr.canApply(params)).toBe(true);
    fired.add("jumpscare-scripted-move");
    expect(attr.canApply(params)).toBe(false);
  });

  it("keeps Echolocation as fog-only power and accuracy effects", () => {
    const names = dispatchBespoke(947).attrs.map(attr => attr.constructor.name);
    expect(names).toEqual(["MovePowerBoostAbAttr", "ConditionalAlwaysHitAbAttr"]);
  });
});
