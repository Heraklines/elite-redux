/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro (#332/#333): Gifted Mind "Nulls Psychic weakness" read as broken on
// Galar Articuno — it only halved Dark/Ghost DAMAGE (so the move still announced
// "super effective"). Now it nulls the matchup in the type chart itself: the
// Psychic type's super-effective contribution is divided out, so Dark/Ghost read
// neutral (1×) with no SE message, while a SECOND-type weakness (Flying's
// Electric/Ice/Rock — like Galar Articuno) still applies. Plus the "status moves
// always hit" half (ConditionalAlwaysHit on STATUS-category moves).
// =============================================================================

import { allAbilities } from "#data/data-lists";
import { DefensiveTypeWeaknessNullAbAttr } from "#data/elite-redux/archetypes/offensive-type-chart-override";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { PokemonType } from "#enums/pokemon-type";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER Gifted Mind — nulls Psychic weakness in the type chart", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame); // boots globalScene (getTypeDamageMultiplier needs it)
  });

  it("Gifted Mind carries the defensive null + status-moves-always-hit", () => {
    const ab = allAbilities[ER_ID_MAP.abilities[422]];
    expect(ab.attrs.some(a => a.constructor.name === "DefensiveTypeWeaknessNullAbAttr")).toBe(true);
    expect(ab.attrs.some(a => a.constructor.name === "ConditionalAlwaysHitAbAttr")).toBe(true);
  });

  it("divides out Psychic's SE contribution; leaves the Flying-type weaknesses", () => {
    const attr = new DefensiveTypeWeaknessNullAbAttr(PokemonType.PSYCHIC);
    const types = [PokemonType.PSYCHIC, PokemonType.FLYING]; // Galar Articuno / Lugia / Xatu

    // Dark & Ghost are super-effective via Psychic (×2) → nulled to neutral.
    const dark = new NumberHolder(2);
    attr.fire(PokemonType.DARK, types, dark);
    expect(dark.value).toBe(1);
    const ghost = new NumberHolder(2);
    attr.fire(PokemonType.GHOST, types, ghost);
    expect(ghost.value).toBe(1);

    // Electric & Ice are super-effective via FLYING (not Psychic) → untouched.
    const elec = new NumberHolder(2);
    attr.fire(PokemonType.ELECTRIC, types, elec);
    expect(elec.value).toBe(2);
    const ice = new NumberHolder(2);
    attr.fire(PokemonType.ICE, types, ice);
    expect(ice.value).toBe(2);

    // Psychic's own resistance (Fighting 0.5×) is not a weakness → untouched.
    const fighting = new NumberHolder(0.5);
    attr.fire(PokemonType.FIGHTING, types, fighting);
    expect(fighting.value).toBe(0.5);

    // No Psychic type on the defender → attr declines entirely.
    const pureFlying = new NumberHolder(2);
    attr.fire(PokemonType.ELECTRIC, [PokemonType.FLYING], pureFlying);
    expect(pureFlying.value).toBe(2);
  });
});
