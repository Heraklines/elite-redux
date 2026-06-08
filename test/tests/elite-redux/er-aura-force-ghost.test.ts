/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro: Spinda's Aura Force (a Fighting-type move that's "super-effective
// on Ghost") couldn't hit a Cofagrigus at all. Fighting is normally IMMUNE to
// Ghost (0×), and the old wiring used a power multiplier — ×2 of a 0× hit is
// still 0, so the move did nothing. The fix wires Aura Force (ER move 806) to
// ErSuperEffectiveVsTypeAttr(GHOST), which recomputes the type chart with the
// Ghost component forced to 2× — so it both HITS Ghosts and is super-effective.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import type { ErSuperEffectiveVsTypeAttr } from "#data/moves/move";
import { PokemonType } from "#enums/pokemon-type";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER Aura Force — super effective (2×) vs Ghost", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  const auraForce = () => allMoves[ER_ID_MAP.moves[806]];

  it("Aura Force (806) resolves to a real registered move", () => {
    expect(ER_ID_MAP.moves[806]).toBeDefined();
    expect(auraForce()).toBeDefined();
    expect(auraForce().type).toBe(PokemonType.FIGHTING);
  });

  it("carries a type-effectiveness override (not a silent power multiplier)", () => {
    const move = auraForce();
    expect(move.getAttrs("ErSuperEffectiveVsTypeAttr").length).toBeGreaterThan(0);
    expect(move.getAttrs("MovePowerMultiplierAttr").length).toBe(0);
  });

  it("forces the Ghost component to 2× and bypasses Fighting's immunity", () => {
    const move = auraForce();
    const attr = move.getAttrs("ErSuperEffectiveVsTypeAttr")[0] as ErSuperEffectiveVsTypeAttr;
    const user = {} as never;
    const target = {} as never;

    // Cofagrigus (pure Ghost): Fighting normally 0× (immune) → forced to 2×.
    const cofagrigus = new NumberHolder(0);
    const hit = attr.apply(user, target, move, [cofagrigus, [PokemonType.GHOST], PokemonType.FIGHTING]);
    expect(hit).toBe(true);
    expect(cofagrigus.value).toBe(2);

    // Non-Ghost target → attr declines, normal chart stands.
    const machamp = new NumberHolder(1);
    const declined = attr.apply(user, target, move, [machamp, [PokemonType.FIGHTING], PokemonType.FIGHTING]);
    expect(declined).toBe(false);
    expect(machamp.value).toBe(1);

    // Dusknoir (Ghost): same as pure Ghost → 2×.
    const dusknoir = new NumberHolder(0);
    attr.apply(user, target, move, [dusknoir, [PokemonType.GHOST], PokemonType.FIGHTING]);
    expect(dusknoir.value).toBe(2);
  });
});
