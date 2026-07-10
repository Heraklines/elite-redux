/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER dex-fidelity tier-8 batch 2 — BEHAVIOUR (GameManager) regression tests.
//
//   - 564 Tactical Retreat — switches out on a stat drop, ONCE PER BATTLE (the
//     used-flag now lives in per-wave data, so it RESETS each battle — the bug
//     was a persistent object flag that fired only once per RUN).
//   - 325 Intoxicate / 459 Emanate / 279 Immolate — Normal moves convert type;
//     the 10% secondary fires ONLY on an on-type holder (badly poison / confuse /
//     burn), never on an off-type holder (which gets STAB instead).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ForceSwitchOutHelper } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { SelfSwitchOnStatLowerAbAttr } from "#data/elite-redux/archetypes/self-switch-on-stat-lower";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const TACTICAL_RETREAT = ER_ID_MAP.abilities[564] as AbilityId;
const INTOXICATE = ER_ID_MAP.abilities[325] as AbilityId;
const EMANATE = ER_ID_MAP.abilities[459] as AbilityId;
const IMMOLATE = ER_ID_MAP.abilities[279] as AbilityId;

describe.skipIf(!RUN)("ER dex tier-8 batch 2 — behaviour", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  afterEach(() => vi.restoreAllMocks());

  // Force any 10% (etc.) secondary roll to fire by returning the minimum for the
  // 100-range roll only; every other seeded draw keeps its real value.
  const forceProcs = () => {
    const real = game.scene.randBattleSeedInt.bind(game.scene);
    vi.spyOn(game.scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) =>
      range === 100 ? min : real(range, min),
    );
  };

  it("Tactical Retreat (564): fires on a stat drop, is once-per-battle, and RESETS the next battle", async () => {
    // Mock the real switch (which would open the PARTY UI) so apply() is side-effect
    // free; we assert the ability's trigger + its once-per-battle bookkeeping.
    const spy = vi.spyOn(ForceSwitchOutHelper.prototype, "switchOutLogic").mockReturnValue(true);
    game.override.ability(TACTICAL_RETREAT).moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU);

    const lead = game.field.getPlayerPokemon();
    expect(lead.species.speciesId).toBe(SpeciesId.SNORLAX);
    // The wired ability instance (proves the dispatcher attached the archetype).
    const attr = lead
      .getAbility()
      .attrs.find((a): a is SelfSwitchOnStatLowerAbAttr => a instanceof SelfSwitchOnStatLowerAbAttr);
    expect(attr).toBeDefined();

    const drop = { pokemon: lead, stats: [Stat.ATK] as const, stages: -1, selfTarget: false, simulated: false };

    // A lowered stat (incl. self-drops) triggers it; a raised stat does not.
    expect(attr!.canApply(drop)).toBe(true);
    expect(attr!.canApply({ ...drop, stages: 1 })).toBe(false);

    // It fires the switch and marks itself used FOR THIS BATTLE.
    attr!.apply(drop);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(lead.waveData.entryEffectsFired.size).toBeGreaterThan(0);
    expect(attr!.canApply(drop)).toBe(false); // once per battle — won't fire again this battle

    // THE FIX: the used-flag lives in per-wave data, so it RESETS at the next
    // battle/wave boundary (resetWaveData runs every EncounterPhase). The old
    // impl kept the flag on the persistent Pokemon object -> fired once per RUN.
    lead.resetWaveData();
    expect(attr!.canApply(drop)).toBe(true); // fires AGAIN in the next battle
  });

  it("Intoxicate (325): converts a Normal move to Poison; 10% badly-poison fires ONLY on a Poison holder", async () => {
    // On-type (Poison) holder: the move converts AND the 10% secondary can fire.
    game.override.ability(INTOXICATE).moveset(MoveId.TACKLE);
    forceProcs();
    await game.classicMode.startBattle(SpeciesId.MUK);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Conversion: the Normal move resolves as Poison-type.
    expect(player.getMoveType(allMoves[MoveId.TACKLE])).toBe(PokemonType.POISON);

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    // Poison holder -> 10% badly-poison branch (forced) landed TOXIC on the target.
    expect(enemy.status?.effect).toBe(StatusEffect.TOXIC);
  });

  it("Intoxicate (325): an OFF-type holder gets NO status (STAB branch), even with the roll forced", async () => {
    game.override.ability(INTOXICATE).moveset(MoveId.TACKLE);
    forceProcs();
    await game.classicMode.startBattle(SpeciesId.PIKACHU); // Electric, not Poison
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(player.getMoveType(allMoves[MoveId.TACKLE])).toBe(PokemonType.POISON); // still converts

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    // Off-type holder is in the "gains Poison STAB" branch -> the toxic secondary never fires.
    expect(enemy.status?.effect).not.toBe(StatusEffect.TOXIC);
  });

  it("Emanate (459): on a Psychic holder a converted Psychic move confuses the target (forced 10%)", async () => {
    game.override.ability(EMANATE).moveset(MoveId.TACKLE);
    forceProcs();
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM); // Psychic
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(player.getMoveType(allMoves[MoveId.TACKLE])).toBe(PokemonType.PSYCHIC);

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    expect(enemy.getTag(BattlerTagType.CONFUSED)).toBeDefined();
  });

  it("Immolate (279): on a Fire holder a converted Fire move burns the target (forced 10%)", async () => {
    game.override.ability(IMMOLATE).moveset(MoveId.TACKLE);
    forceProcs();
    await game.classicMode.startBattle(SpeciesId.ARCANINE); // Fire
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(player.getMoveType(allMoves[MoveId.TACKLE])).toBe(PokemonType.FIRE);

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    expect(enemy.status?.effect).toBe(StatusEffect.BURN);
  });

  it("Ghastly Echo (848): is now SOUND_BASED and still deals damage + force-switches; Take Flight (976) unchanged", async () => {
    // Boot once so ER custom moves are registered in allMoves.
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const ghastlyEcho = allMoves[ER_ID_MAP.moves[848]];
    expect(ghastlyEcho, "Ghastly Echo (848) is registered").toBeDefined();
    // Fixed: the move is sound-based (was missing).
    expect(ghastlyEcho.hasFlag(MoveFlags.SOUND_BASED)).toBe(true);
    // Preserved: it still force-switches (dex "Deals damage and switches").
    expect(ghastlyEcho.hasAttr("ForceSwitchOutAttr")).toBe(true);

    // Regression guard: Take Flight (976) still force-switches and did NOT gain the
    // sound flag from the case split.
    const takeFlight = allMoves[ER_ID_MAP.moves[976]];
    expect(takeFlight.hasAttr("ForceSwitchOutAttr")).toBe(true);
    expect(takeFlight.hasFlag(MoveFlags.SOUND_BASED)).toBe(false);
  });
});
