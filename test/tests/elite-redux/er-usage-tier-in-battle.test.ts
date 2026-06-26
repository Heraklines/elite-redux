/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Anti-cheat #384 (Phase A): the Usage Tier challenge must ENFORCE the tier in
// BATTLE, not just at add-time (starter / catch). UsageTierChallenge now
// overrides applyPokemonInBattle so the existing POKEMON_IN_BATTLE bench net
// (turn-init-phase.ts + summon-phase.ts -> pokemon.isAllowedInBattle()) blocks a
// tier-illegal mon every turn, no matter HOW it reached the team (egg, event,
// mystery encounter, or a cheated save). Mirrors the sibling roster challenges
// (Mono Color / Mono Type / Single Generation).
//
// Correctness pieces verified here:
//   (i)   a clearly high-tier mon (a Legendary) is BENCHED under NU. This is the
//         one absolute verdict we can rely on: a Legendary's egg tier alone is
//         above NU's COMMON cap, and that gate is LOCAL (no CDN), so it benches
//         even when the usage JSON fails to load headless.
//   (ii)  a legit NU-tier mon is NOT benched.
//   (iii) a mon whose tier cannot be resolved is NOT benched (FAIL-SAFE - a mon
//         we cannot confidently judge is never wrongly benched).
//   (iv)  an ER custom MEGA of an NU-legal base is NOT benched: it resolves to
//         the BASE line's tier via erMegaTargetToBaseSpeciesId, NOT its own
//         standalone custom-species id (whose plain getRootSpeciesId would be
//         the mega itself - an empty bucket that mis-judges the tier).
//
// CDN CAVEAT: the per-line usage JSON is CDN-fetched and may fail-open headless,
// so the EXACT NU verdict of a given vanilla line is not reproducible. Wherever
// an absolute verdict isn't reliable we assert EQUIVALENCE to the already-trusted
// starter-choice gate (the same technique er-challenge-catch-restriction.test.ts
// uses for the tier case): the in-battle bench check must reach the SAME answer
// for a line as starter select does, and a mega must be judged identically to its
// resolved base. (ii) and (iv) therefore derive their "legal" example at runtime
// from the starter gate rather than hardcoding a line we cannot guarantee.
//
// Gated behind ER_SCENARIO=1 (boots the real ER GameManager), same as the
// catch-restriction test it is modelled on.
// =============================================================================

import { UsageTierChallenge } from "#data/challenge";
import { allSpecies } from "#data/data-lists";
import { erMegaTargetToBaseSpeciesId } from "#data/elite-redux/er-generic-pool-bans";
import { hasErUsageTierData } from "#data/elite-redux/er-usage-tiers";
import type { PokemonSpecies } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { ErSpeciesId } from "#enums/er-species-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { BooleanHolder } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const NU = 4; // UsageTier challenge value: 1=UU, 2=RU, 3=PU, 4=NU.

describe.skipIf(!RUN)("ER Usage Tier challenge: in-battle enforcement (anti-cheat #384 Phase A)", () => {
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
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(20)
      .startingLevel(20)
      .ability(AbilityId.BALL_FETCH);
  });

  // The starter gate is the already-trusted source of a line's tier legality.
  const starterLegal = (challenge: UsageTierChallenge, species: PokemonSpecies): boolean => {
    const holder = new BooleanHolder(true);
    challenge.applyStarterChoice(species, holder);
    return holder.value;
  };

  // Drive the in-battle bench hook with `player` wearing `species`, restoring the
  // original species after. Returns whether the mon stays usable (true) / is
  // benched (false).
  const inBattleValidAs = (challenge: UsageTierChallenge, player: PlayerPokemon, species: PokemonSpecies): boolean => {
    const original = player.species;
    try {
      player.species = species;
      const holder = new BooleanHolder(true);
      challenge.applyPokemonInBattle(player, holder);
      return holder.value;
    } finally {
      player.species = original;
    }
  };

  it("benches a Legendary (out-of-tier under NU) via the local egg-tier gate", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.scene.getPlayerPokemon()!;

    const nu = new UsageTierChallenge();
    nu.value = NU;

    // Mewtwo's egg tier is LEGENDARY (above NU's COMMON cap); this gate is local,
    // so the verdict is reliable headless regardless of the CDN usage data.
    const mewtwo = getPokemonSpecies(SpeciesId.MEWTWO);
    expect(starterLegal(nu, mewtwo)).toBe(false); // sanity: rejected at the gate too
    expect(inBattleValidAs(nu, player, mewtwo)).toBe(false); // BENCHED in battle.

    // A second clear Legendary, to show it is not Mewtwo-specific.
    const rayquaza = getPokemonSpecies(SpeciesId.RAYQUAZA);
    expect(inBattleValidAs(nu, player, rayquaza)).toBe(false);
  });

  it("keeps a legit NU-tier mon usable (NOT benched) - matching the starter gate", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.scene.getPlayerPokemon()!;

    const nu = new UsageTierChallenge();
    nu.value = NU;

    // The point of (ii): a mon the tier ALLOWS stays usable in battle (never
    // benched). WHICH lines are NU-legal depends on the CDN usage JSON, which
    // loads racily / fail-open headless - so derive a genuinely NU-legal line at
    // runtime from the trusted starter gate rather than hardcoding one. There is
    // always at least one NU-legal line (the challenge would be unplayable
    // otherwise): when the JSON has not loaded, every COMMON-egg line counts as
    // 0% usage (legal); when it has, the deep-off-meta tail still qualifies. Scan
    // all vanilla species for the first the gate accepts.
    const nuLegal = allSpecies.find(sp => sp.speciesId < 10000 && starterLegal(nu, sp));
    expect(nuLegal, `expected at least one NU-legal line (usage data loaded: ${hasErUsageTierData()})`).toBeDefined();

    // That NU-legal mon is NOT benched in battle, and the in-battle verdict equals
    // the starter-gate verdict for it (the equivalence contract).
    expect(inBattleValidAs(nu, player, nuLegal!)).toBe(true);
    expect(inBattleValidAs(nu, player, nuLegal!)).toBe(starterLegal(nu, nuLegal!));
  });

  it("never benches an ENEMY mon (player-only gate)", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const enemy = game.scene.getEnemyPokemon()!;
    const original = enemy.species;
    const nu = new UsageTierChallenge();
    nu.value = NU;
    try {
      // Even a Legendary ENEMY is untouched - the bench net only governs the
      // player's own roster.
      enemy.species = getPokemonSpecies(SpeciesId.MEWTWO);
      const holder = new BooleanHolder(true);
      nu.applyPokemonInBattle(enemy, holder);
      expect(holder.value).toBe(true);
    } finally {
      enemy.species = original;
    }
  });

  it("FAIL-SAFE: a mon whose tier cannot be resolved is NOT benched", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.scene.getPlayerPokemon()!;

    const nu = new UsageTierChallenge();
    nu.value = NU;

    // Forge an unresolvable species id (>= 2000 and absent from allSpecies, so
    // getPokemonSpecies returns undefined). The resolver fails OPEN: a mon we
    // cannot confidently judge is treated as ALLOWED, never benched - so a legit
    // mon we simply can't read the tier of is never wrongly removed from battle.
    expect(getPokemonSpecies(99999 as SpeciesId)).toBeUndefined();
    const ghost = Object.create(player.species) as PokemonSpecies;
    ghost.speciesId = 99999 as SpeciesId;

    expect(inBattleValidAs(nu, player, ghost)).toBe(true); // unresolved => not benched.
  });

  it("an ER custom MEGA is judged by its BASE line, not its standalone id", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.scene.getPlayerPokemon()!;

    const nu = new UsageTierChallenge();
    nu.value = NU;

    // Flygon Mega is a STANDALONE custom species (id 10487) with no prevolution:
    // a plain getRootSpeciesId() returns the mega itself, mis-judging the tier.
    // erMegaTargetToBaseSpeciesId collapses it to base Flygon -> root Trapinch.
    const megaId = ErSpeciesId.FLYGON_MEGA;
    const baseId = erMegaTargetToBaseSpeciesId(megaId);
    expect(baseId, "premise: the mega resolves to a base line").toBeDefined();

    const megaSpecies = getPokemonSpecies(megaId as unknown as SpeciesId);
    const baseSpecies = getPokemonSpecies(baseId!);
    expect(megaSpecies).toBeDefined();

    // The mega's in-battle verdict must EQUAL its resolved base line's verdict at
    // the trusted starter gate - i.e. resolution made the mega share the base's
    // tier (whatever that tier is under the live CDN data). Without the resolver
    // the mega would read its own empty bucket and could diverge.
    const megaInBattle = inBattleValidAs(nu, player, megaSpecies);
    expect(megaInBattle).toBe(starterLegal(nu, baseSpecies));

    // Flygon's line is an off-meta COMMON-egg line, so under NU it is legal and
    // therefore the mega stays usable. (If the live data ever pushed Flygon over
    // the gate, the equivalence assert above still holds - that is the contract.)
    if (starterLegal(nu, baseSpecies)) {
      expect(megaInBattle).toBe(true);
    }
  });

  it("in-battle verdict == starter-choice verdict across a mix of lines", async () => {
    // Belt-and-braces equivalence sweep over high- and low-tier lines: the bench
    // check and the starter gate must never disagree for the same species.
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.scene.getPlayerPokemon()!;
    const nu = new UsageTierChallenge();
    nu.value = NU;

    const lines = [
      SpeciesId.MEWTWO,
      SpeciesId.RAYQUAZA,
      SpeciesId.ARCEUS,
      SpeciesId.SUNKERN,
      SpeciesId.CATERPIE,
      SpeciesId.MAGIKARP,
      SpeciesId.TRAPINCH,
    ];
    for (const id of lines) {
      const species = getPokemonSpecies(id);
      expect(inBattleValidAs(nu, player, species), `line ${id}`).toBe(starterLegal(nu, species));
    }
  });
});
