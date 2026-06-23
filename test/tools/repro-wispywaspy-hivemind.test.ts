/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// REPRO: "Wispywaspy Hivemind" (the differently-named DUMP species, pkrg 10638)
// fielded DIRECTLY (not via the trainer redirect that swaps it for the base).
//
// Questions to answer:
//   1. Will it only have Struggle, or a real moveset?  (-> inspect its learnset)
//   2. Does it properly use Locust Swarm (school) when switched in, player OR
//      enemy?  (-> spawn it on both sides and check ability/passives/formIndex)
//
// The base Wispywaspy (10065) is the working reference: it has the "hivemind"
// FORM injected on it + the Locust Swarm form-change edges. The dump (10638) is
// a separate species ER ships for that form's art — it is NOT meant to be a
// standalone battler.
//
// Run:  ER_SCENARIO=1 npx vitest run test/tools/repro-wispywaspy-hivemind.test.ts
// =============================================================================

import Overrides from "#app/overrides";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const BASE = 10065 as SpeciesId; // Wispywaspy (base, has the hivemind form + edges)
const HIVEMIND = 10638 as SpeciesId; // "Wispywaspy Hivemind" dump species

/**
 * Set an enemy-species override DIRECTLY (the `game.override.enemySpecies`
 * helper logs the name via `enumValueToKey`, which throws on an ER-injected id
 * like 10638). Convert the spied getter back to a writable data prop first.
 */
function forceEnemySpecies(id: number): void {
  const o = Overrides as unknown as Record<string, unknown>;
  Object.defineProperty(o, "ENEMY_SPECIES_OVERRIDE", { value: id, writable: true, configurable: true });
}

function dumpMon(label: string, mon: Pokemon | undefined): void {
  if (!mon) {
    console.log(`  ${label}: (none)`);
    return;
  }
  const passives = mon
    .getPassiveAbilities()
    .map(a => a?.name)
    .filter(Boolean)
    .join(", ");
  const moves = mon.getMoveset().map(m => MoveId[m.moveId]);
  const onlyStruggle = moves.length === 1 && moves[0] === "STRUGGLE";
  console.log(
    `  ${label}: ${mon.species.name} form#${mon.formIndex} ability="${mon.getAbility()?.name}"`
      + ` passives=[${passives}] moves=[${moves.join(", ")}]${onlyStruggle ? "  <<< ONLY STRUGGLE" : ""}`,
  );
}

describe.skipIf(!RUN)("repro: Wispywaspy Hivemind dump fielded directly", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("species learnset + forms (data)", async () => {
    const game = new GameManager(phaserGame);
    await game.runToTitle();
    for (const id of [BASE, HIVEMIND]) {
      const sp = getPokemonSpecies(id);
      const lm = sp.getLevelMoves();
      console.log(
        `\nspecies ${id} "${sp.name}": forms=[${sp.forms.map(f => f.formKey || "(base)").join(", ")}]`
          + ` | levelMoves=${lm.length}`
          + ` | sample=${lm
            .slice(0, 8)
            .map(([l, m]) => `${l}:${MoveId[m]}`)
            .join(", ")}`,
      );
    }
    expect(true).toBe(true);
  }, 120_000);

  it("wild-override of the dump id 10638 does NOT resolve to the dump (id collision)", async () => {
    // Forcing ENEMY_SPECIES_OVERRIDE = 10638 in the wild-spawn path resolves to a
    // vanilla form species (Floette Blue), NOT "Wispywaspy Hivemind". So the dump
    // is not reachable as a plain wild enemy by id — a directly-fielded dump would
    // only come from a serialized/ghost/custom-enemy path, not a wild roll.
    const game = new GameManager(phaserGame);
    game.override.battleStyle("single").startingLevel(60).enemyLevel(60).criticalHits(false);
    forceEnemySpecies(HIVEMIND);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const e = game.field.getEnemyPokemon();
    console.log(`\n--- wild ENEMY_SPECIES_OVERRIDE=10638 actually spawned: "${e?.species.name}" ---`);
    dumpMon("ENEMY ", e);
    expect(true).toBe(true);
  }, 120_000);

  it("battle spawn: ENEMY base Wispywaspy (working reference — has moves + Locust Swarm)", async () => {
    const game = new GameManager(phaserGame);
    game.override.battleStyle("single").startingLevel(60).enemyLevel(60).criticalHits(false);
    forceEnemySpecies(BASE);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    console.log("\n--- ENEMY = base Wispywaspy (reference) ---");
    dumpMon("ENEMY ", game.field.getEnemyPokemon());
    expect(true).toBe(true);
  }, 120_000);
});
