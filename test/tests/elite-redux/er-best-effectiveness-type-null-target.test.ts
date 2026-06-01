/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// `getMoveType` is invoked outside real targeting (e.g. weather-cancellation
// checks via Arena.isMoveWeatherCancelled) with a NULL target. ER's
// BestEffectivenessTypeAttr (Aqua/Lava Crest, Crystal Beam, …) dereferenced that
// target to pick the most-effective type, crashing combat with
// "Cannot read properties of null (reading 'getAttackTypeEffectiveness')".
// With no target there's no effectiveness data, so it must fall back to the
// first candidate type instead of throwing.
import { BestEffectivenessTypeAttr } from "#data/elite-redux/move-archetype-dispatcher";
import { PokemonType } from "#enums/pokemon-type";
import { NumberHolder } from "#utils/common";
import { describe, expect, it } from "vitest";

describe("ER BestEffectivenessTypeAttr — null target safety", () => {
  const candidates = [PokemonType.WATER, PokemonType.FIRE] as const;

  it("does not throw and uses the first candidate when target is null", () => {
    const attr = new BestEffectivenessTypeAttr([...candidates]);
    const holder = new NumberHolder(PokemonType.NORMAL);
    // user/move are not dereferenced on the null-target path.
    const user = {} as any;
    const move = {} as any;

    expect(() => attr.apply(user, null as any, move, [holder])).not.toThrow();
    expect(holder.value).toBe(PokemonType.WATER);
  });

  it("returns false (no mutation) when the holder is not a NumberHolder", () => {
    const attr = new BestEffectivenessTypeAttr([...candidates]);
    expect(attr.apply({} as any, null as any, {} as any, [undefined])).toBe(false);
  });
});
