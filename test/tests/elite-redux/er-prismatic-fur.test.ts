/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Prismatic Fur (ER ability 440 = "Color Change + Protean +
// Fur Coat + Ice Scales"), the signature ability of the Kecleong fusion.
//
// The ER ROM behaviour: the "Color Change" half changes the holder's type to
// one that RESISTS (or is immune to) an incoming move BEFORE the hit lands, so
// the swap actually reduces the damage taken. Vanilla Color Change is a POST-hit
// swap to the move's own type — the wrong timing (the player reported the swap
// happening too late to matter). We re-time it: dispatchBespoke(440) now leads
// with PreHitResistTypeChangeAbAttr, which runs in move-effect-phase right before
// the type-effectiveness check.
//
// Dispatch shape is asserted unconditionally; the live-battle behaviour is gated
// behind ER_SCENARIO=1 (matches the rest of the ER battle suite).
// =============================================================================

import { allAbilities } from "#data/data-lists";
import { dispatchBespoke } from "#data/elite-redux/archetype-dispatcher";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const PRISMATIC_FUR_ER_ID = 440;
const RUN = process.env.ER_SCENARIO === "1";

describe("ER Prismatic Fur — dispatch shape", () => {
  it("leads with the PRE-hit resist swap, then Protean + Fur Coat + Ice Scales", () => {
    const res = dispatchBespoke(PRISMATIC_FUR_ER_ID);
    expect(res).not.toBeNull();
    const names = (res.attrs ?? []).map(a => a.constructor.name);
    expect(names[0]).toBe("PreHitResistTypeChangeAbAttr");
    expect(names).toContain("PokemonTypeChangeAbAttr");
    expect(names.filter(n => n === "ReceivedMoveDamageMultiplierAbAttr")).toHaveLength(1);
  });

  it("the registered ER ability carries the pre-hit resist primitive", () => {
    const pkrgId = ER_ID_MAP.abilities[PRISMATIC_FUR_ER_ID];
    expect(pkrgId).toBeDefined();
    const ability = allAbilities[pkrgId];
    expect(ability, `allAbilities[${pkrgId}] must exist`).toBeDefined();
    expect(ability.hasAttr("PreHitResistTypeChangeAbAttr")).toBe(true);
  });
});

describe.skipIf(!RUN)("ER Prismatic Fur — pre-hit resist swap in a real battle", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const prismaticFurId = ER_ID_MAP.abilities[PRISMATIC_FUR_ER_ID] as AbilityId;
  const immunityCases: {
    label: string;
    move: MoveId;
    expectedType: PokemonType;
    enemySpecies?: SpeciesId;
  }[] = [
    { label: "Normal -> Ghost", move: MoveId.TACKLE, expectedType: PokemonType.GHOST },
    { label: "Fighting -> Ghost", move: MoveId.BRICK_BREAK, expectedType: PokemonType.GHOST },
    { label: "Poison -> Steel", move: MoveId.POISON_JAB, expectedType: PokemonType.STEEL },
    { label: "Ground -> Flying", move: MoveId.EARTHQUAKE, expectedType: PokemonType.FLYING },
    { label: "Electric -> Ground", move: MoveId.THUNDERBOLT, expectedType: PokemonType.GROUND },
    { label: "Psychic -> Dark", move: MoveId.CONFUSION, expectedType: PokemonType.DARK },
    {
      label: "Ghost -> Normal",
      move: MoveId.LICK,
      expectedType: PokemonType.NORMAL,
      enemySpecies: SpeciesId.DROWZEE,
    },
    { label: "Dragon -> Fairy", move: MoveId.DRAGON_CLAW, expectedType: PokemonType.FAIRY },
  ];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.RATTATA) // pure Normal holder
      .enemyAbility(prismaticFurId)
      .passiveAbility(AbilityId.NONE)
      .enemyPassiveAbility(AbilityId.NONE)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("changes the holder's type to become immune to an incoming Fighting move (takes no damage)", async () => {
    await game.classicMode.startBattle([SpeciesId.MACHAMP]);
    const enemy = game.field.getEnemyPokemon();
    const maxHp = enemy.getMaxHp();

    // Brick Break is Fighting (super-effective vs Normal Rattata). Prismatic Fur
    // re-types the holder to Ghost BEFORE the hit → Fighting is nullified → the
    // holder takes 0 damage instead of a super-effective chunk.
    game.move.use(MoveId.BRICK_BREAK);
    await game.toEndOfTurn();

    expect(enemy.hp).toBe(maxHp);
    // And the holder is now (temporarily) the resisting type.
    expect(enemy.getTypes(true, true)).toContain(PokemonType.GHOST);
  });

  it.each(immunityCases)("chooses the immune type before damage for $label attacks", async ({
    move,
    expectedType,
    enemySpecies,
  }) => {
    game.override.enemySpecies(enemySpecies ?? SpeciesId.RATTATA).moveset([move]);

    await game.classicMode.startBattle([SpeciesId.SHUCKLE]);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;

    game.move.use(move);
    await game.toEndOfTurn();

    expect(enemy.hp).toBe(hpBefore);
    expect(enemy.getTypes(true, true)).toContain(expectedType);
  });

  it("falls back to a resistant type when the incoming move has no immunity target", async () => {
    game.override.enemyMoveset(MoveId.TAIL_WHIP).moveset([MoveId.FLAMETHROWER]);

    await game.classicMode.startBattle([SpeciesId.SHUCKLE]);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;

    game.move.use(MoveId.FLAMETHROWER);
    await game.toEndOfTurn();

    expect(enemy.getTypes(true, true)).toContain(PokemonType.ROCK);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });
});
