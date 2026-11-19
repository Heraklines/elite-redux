/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 1, IgnoreResistancesAbAttr (while-active flag, read by name in Pokemon.getAttackTypeEffectiveness).
// The shared tests can only compare whole battles for a flag, so the clamp itself is proven here through the REAL engine
// function: the holder's active attrs are the original, then the rebuild, then none, and a target of each typing is hit with
// a Normal move. Resisted matchups (0.5 and 0.25) must become 1, immunities must stay 0, weaknesses must stay.
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { PokemonType } from "#enums/pokemon-type";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const module = declRegistry.get("IgnoreResistancesAbAttr") as DeclModule;

describe("B10: ignore type resistances (IgnoreResistancesAbAttr)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("clamps resisted matchups to neutral in the engine, for the original and for the rebuild alike", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const sites = allAttrSites().filter(site => site.className === "IgnoreResistancesAbAttr");
    expect(sites.map(site => site.abilityName)).toEqual(["Normalize"]);
    const original = sites[0].attr;
    const rebuilt = recomposeAttr(module, original, sites[0].abilityId, sites[0].attrIndex);
    expect(rebuilt).not.toBe(original);

    let defenderTypes: PokemonType[] = [PokemonType.NORMAL];
    vi.spyOn(foe, "getTypes").mockImplementation(() => [...defenderTypes]);
    const matchup = (attrs: readonly unknown[], types: PokemonType[]): number => {
      defenderTypes = types;
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue(attrs as never);
      return foe.getAttackTypeEffectiveness(PokemonType.NORMAL, { source: holder });
    };

    const cases: { types: PokemonType[]; plain: number; clamped: number }[] = [
      { types: [PokemonType.ROCK], plain: 0.5, clamped: 1 },
      { types: [PokemonType.STEEL], plain: 0.5, clamped: 1 },
      { types: [PokemonType.ROCK, PokemonType.STEEL], plain: 0.25, clamped: 1 },
      { types: [PokemonType.GHOST], plain: 0, clamped: 0 },
      { types: [PokemonType.ROCK, PokemonType.GHOST], plain: 0, clamped: 0 },
      { types: [PokemonType.NORMAL], plain: 1, clamped: 1 },
      { types: [PokemonType.FIGHTING], plain: 1, clamped: 1 },
    ];
    for (const { types, plain, clamped } of cases) {
      const label = types.map(type => PokemonType[type]).join("/");
      expect(matchup([], types), `${label} without the flag`).toBe(plain);
      expect(matchup([original], types), `${label} with the original`).toBe(clamped);
      expect(matchup([rebuilt], types), `${label} with the rebuild`).toBe(clamped);
    }
    // a weakness stays a weakness: Fighting vs Normal is 2 and is left alone
    defenderTypes = [PokemonType.NORMAL];
    vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([original] as never);
    expect(foe.getAttackTypeEffectiveness(PokemonType.FIGHTING, { source: holder })).toBe(2);
    // the clamp is not applied when the holder's ability is ignored (what Mold Breaker sets)
    defenderTypes = [PokemonType.ROCK];
    expect(foe.getAttackTypeEffectiveness(PokemonType.NORMAL, { source: holder, ignoreSourceAbility: true })).toBe(0.5);
  });
});
