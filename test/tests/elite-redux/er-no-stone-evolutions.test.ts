/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Elite Redux has NO stone/trade evolutions — everything evolves by level. The
// evo patcher used to update the ER level but keep the vanilla evolution item,
// so e.g. Vulpix still needed a Fire Stone. This verifies that, after init, the
// formerly stone/trade evolutions are pure level-ups (item === NONE, level > 0).

import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { EvolutionItem } from "#enums/evolution-item";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER evolutions are level-only (no stones/trade)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  // (source species, evolution target) pairs that were stone/trade in vanilla.
  const cases: [SpeciesId, SpeciesId][] = [
    [SpeciesId.VULPIX, SpeciesId.NINETALES], // Fire Stone
    [SpeciesId.EEVEE, SpeciesId.VAPOREON], // Water Stone (one of the branches)
    [SpeciesId.GLOOM, SpeciesId.VILEPLUME], // Leaf Stone
    [SpeciesId.KADABRA, SpeciesId.ALAKAZAM], // trade (Linking Cord)
    [SpeciesId.MAGNETON, SpeciesId.MAGNEZONE], // Thunder Stone
  ];

  it.each(cases)("%s → %s is a level-up with no item", (from, to) => {
    const evos = pokemonEvolutions[from] ?? [];
    const edge = evos.find(e => e.speciesId === to);
    expect(edge, `no evolution edge ${from} → ${to}`).toBeDefined();
    expect(edge!.level, "should evolve by level").toBeGreaterThan(0);
    expect(edge!.item ?? EvolutionItem.NONE, "should require no item/stone").toBe(EvolutionItem.NONE);
  });
});
