/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 2, the Power Outage pair: OneShotTypeBoostAbAttr (power) and OneShotTypeBoostFollowupAbAttr (lose the type). Both are
// packages that share ONE flag on the Pokemon object (a module-private Symbol), so the shared L1 grid and L2 twin cannot see the
// rule. It is driven here on the ORIGINAL pair and on the REBUILT pair: before the first Electric move the boost applies to Electric
// moves only; the preview of the first move changes nothing; the real first move spends the flag and removes the type; afterwards
// neither half does anything; a Pokemon whose only type is the chosen one keeps it.
import { allMoves } from "#data/data-lists";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { setTypesOf } from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const POWER = declRegistry.get("OneShotTypeBoostAbAttr") as DeclModule;
const FOLLOWUP = declRegistry.get("OneShotTypeBoostFollowupAbAttr") as DeclModule;

/** The one-time flag both classes share: a Symbol property on the Pokemon object. */
function forgetFlag(holder: Pokemon): void {
  for (const symbol of Object.getOwnPropertySymbols(holder)) {
    if (symbol.description === "OneShotTypeBoost.used") {
      delete (holder as unknown as Record<symbol, unknown>)[symbol];
    }
  }
}

function flagOf(holder: Pokemon): boolean {
  return Object.getOwnPropertySymbols(holder).some(
    symbol =>
      symbol.description === "OneShotTypeBoost.used" && (holder as unknown as Record<symbol, unknown>)[symbol] === true,
  );
}

describe("B10: Power Outage pair (OneShotTypeBoost and its follow-up)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sitePower = () => allAttrSites().find(site => site.className === "OneShotTypeBoostAbAttr")!;
  const siteFollowup = () => allAttrSites().find(site => site.className === "OneShotTypeBoostFollowupAbAttr")!;

  it("Power Outage is the only user of both; settings read back as Electric and 2; the rebuilds are identical", async () => {
    await startWorld(phaserGame);
    expect(
      allAttrSites()
        .filter(site => site.className.startsWith("OneShotTypeBoost"))
        .map(site => site.abilityName),
    ).toEqual(["Power Outage", "Power Outage"]);
    for (const [module, site] of [
      [POWER, sitePower()],
      [FOLLOWUP, siteFollowup()],
    ] as const) {
      expect(readDeclParams(module, site.attr)).toEqual(module === POWER ? { type: "ELECTRIC", multiplier: 2 } : { type: "ELECTRIC", factor: 2 });
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
      expect(rebuilt).not.toBe(site.attr);
      expect(attrFingerprint(rebuilt as never)).toEqual(attrFingerprint(site.attr as never));
    }
  });

  it("the original pair and the rebuilt pair boost, spend the flag and lose the type in exactly the same way", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    vi.spyOn(holder, "updateInfo").mockImplementation((() => Promise.resolve()) as never);
    const pairs = [
      ["original", sitePower().attr, siteFollowup().attr],
      [
        "rebuild",
        recomposeAttr(POWER, sitePower().attr, sitePower().abilityId, sitePower().attrIndex),
        recomposeAttr(FOLLOWUP, siteFollowup().attr, siteFollowup().abilityId, siteFollowup().attrIndex),
      ],
    ] as const;
    const thunderbolt = allMoves[MoveId.THUNDERBOLT];
    const tackle = allMoves[MoveId.TACKLE];
    for (const [name, power, followup] of pairs) {
      forgetFlag(holder);
      setTypesOf(holder, [PokemonType.ELECTRIC, PokemonType.FLYING]);
      const boosted = (move: typeof tackle): number => {
        const value = new NumberHolder(40);
        const params = { pokemon: holder, opponent: foe, move, power: value, simulated: false } as never;
        if (power.canApply(params)) {
          power.apply(params);
        }
        return value.value;
      };
      const after = (move: typeof tackle, simulated: boolean) =>
        ({ pokemon: holder, opponent: foe, move, simulated, hitResult: 0 }) as never;

      expect(boosted(thunderbolt), `${name}: first Electric move is doubled`).toBe(80);
      expect(boosted(tackle), `${name}: a Normal move is not boosted`).toBe(40);
      expect(followup.canApply(after(tackle, false)), `${name}: a Normal move does not start the follow-up`).toBe(
        false,
      );
      expect(followup.canApply(after(thunderbolt, false)), `${name}: an Electric move does`).toBe(true);

      followup.apply(after(thunderbolt, true));
      expect(flagOf(holder), `${name}: a preview keeps the flag`).toBe(false);
      expect(holder.getTypes(true), `${name}: a preview keeps the types`).toEqual([
        PokemonType.ELECTRIC,
        PokemonType.FLYING,
      ]);
      expect(boosted(thunderbolt), `${name}: still boosted after a preview`).toBe(80);

      followup.apply(after(thunderbolt, false));
      expect(flagOf(holder), `${name}: the real move spends the flag`).toBe(true);
      expect(holder.getTypes(true), `${name}: Electric is lost`).toEqual([PokemonType.FLYING]);
      expect(boosted(thunderbolt), `${name}: no boost afterwards`).toBe(40);
      expect(followup.canApply(after(thunderbolt, false)), `${name}: no second follow-up`).toBe(false);

      // a Pokemon whose only type is Electric keeps it, but still spends the flag
      forgetFlag(holder);
      setTypesOf(holder, [PokemonType.ELECTRIC]);
      followup.apply(after(thunderbolt, false));
      expect(holder.getTypes(true), `${name}: a single type is kept`).toEqual([PokemonType.ELECTRIC]);
      expect(flagOf(holder), `${name}: the flag is still spent`).toBe(true);
    }
  });

  it("the settings change the type and the factor of the rebuild, and of nothing else", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    forgetFlag(holder);
    const power = recomposeAttr(POWER, sitePower().attr, sitePower().abilityId, sitePower().attrIndex, {
      params: { type: "FIRE", multiplier: 3 },
    });
    const value = new NumberHolder(10);
    const run = (move: (typeof allMoves)[number]) => {
      const params = { pokemon: holder, opponent: foe, move, power: value, simulated: false } as never;
      if (power.canApply(params)) {
        power.apply(params);
      }
    };
    run(allMoves[MoveId.THUNDERBOLT]);
    expect(value.value, "an Electric move is not boosted by a Fire setting").toBe(10);
    run(allMoves[MoveId.EMBER]);
    expect(value.value, "a Fire move is tripled").toBe(30);
  });
});
