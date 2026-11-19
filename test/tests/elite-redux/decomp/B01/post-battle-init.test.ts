/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 probe for PostBattleInitFormChangeAbAttr. Every user passes a form function that returns a NUMBER, so all ten are
// legacy closures and none can be rebuilt by recomposeAttr. What can be proven is the declaration's wiring: a fresh
// attr built through the declaration with each user's real function behaves like the original in canApply (the
// order "form function first, then the simulated test") and apply (the one form-change trigger), and the live
// ability keeps its closure bindings.
import type { PostBattleInitFormChangeAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { buildAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

type Params = { pokemon: Pokemon; simulated?: boolean };

describe("B01 PostBattleInitFormChangeAbAttr", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const sites = () => allAttrSites().filter(site => site.className === "PostBattleInitFormChangeAbAttr");

  it("all ten users carry a written legacy-closure reason and no library tree", () => {
    const list = sites();
    expect(list).toHaveLength(10);
    for (const site of list) {
      const binding = getBinding(site.abilityId, site.attrIndex, "ctor:0");
      expect(binding?.legacyClosure?.reason.length, `${site.abilityName} attr ${site.attrIndex}`).toBeGreaterThan(40);
      expect(binding?.spec).toBeUndefined();
    }
  });

  it("a fresh attr built from the declaration around each user's own function agrees with the original over every form index and both simulated values", async () => {
    const world = await startWorld(phaserGame);
    const mon = world.holder;
    const module = declRegistry.get("PostBattleInitFormChangeAbAttr");
    expect(module).toBeDefined();
    let compared = 0;
    for (const site of sites()) {
      const original = site.attr as PostBattleInitFormChangeAbAttr;
      const formFunc = (original as unknown as { formFunc: unknown }).formFunc;
      expect(typeof formFunc).toBe("function");
      const fresh = buildAttr(module!, {}, { "ctor:0": formFunc as never }) as PostBattleInitFormChangeAbAttr;
      expect(fresh.constructor.name).toBe("PostBattleInitFormChangeAbAttr");
      expect(fresh.showAbility).toBe(original.showAbility);
      for (let formIndex = 0; formIndex < 9; formIndex++) {
        mon.formIndex = formIndex;
        for (const simulated of [false, true, undefined]) {
          const params: Params = simulated === undefined ? { pokemon: mon } : { pokemon: mon, simulated };
          expect(fresh.canApply(params as never), `${site.abilityName} form ${formIndex} sim ${simulated}`).toBe(
            original.canApply(params as never),
          );
          compared++;
        }
      }
    }
    expect(compared).toBe(10 * 9 * 3);
  });

  it("apply triggers exactly one form change of the ability kind, with no extra argument", async () => {
    const world = await startWorld(phaserGame);
    const mon = world.holder;
    const module = declRegistry.get("PostBattleInitFormChangeAbAttr")!;
    const spy = vi.spyOn(globalScene, "triggerPokemonFormChange").mockImplementation(() => true);
    try {
      const fresh = buildAttr(module, {}, { "ctor:0": () => 0 });
      fresh.apply({ pokemon: mon } as never);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe(mon);
      expect(spy.mock.calls[0][2]).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
