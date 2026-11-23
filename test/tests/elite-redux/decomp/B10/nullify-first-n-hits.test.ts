/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import type { NullifyFirstNHitsAbAttr } from "#data/elite-redux/archetypes/nullify-first-n-hits";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";
import { rebuildWithClassGate } from "./rebuild-with-class-gate";

const module = declRegistry.get("NullifyFirstNHitsAbAttr") as DeclModule;

function hit(attr: NullifyFirstNHitsAbAttr, holder: Pokemon, amount: number, simulated = false): number {
  const damage = new NumberHolder(amount);
  const params = { pokemon: holder, damage, simulated } as never;
  if (attr.canApply(params)) {
    attr.apply(params);
  }
  return damage.value;
}

describe("B10: first hits do nothing (NullifyFirstNHitsAbAttr)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  const sitesOf = () => allAttrSites().filter(site => site.className === "NullifyFirstNHitsAbAttr");

  it("has the two live users, Cheating Death (2 hits) and Gallantry (1 hit), and the rebuild keeps n", async () => {
    await startWorld(phaserGame);
    const sites = sitesOf();
    expect(
      sites.map(site => `${site.abilityName}:${(site.attr as unknown as NullifyFirstNHitsAbAttr).getN()}`).sort(),
    ).toEqual(["Cheating Death:2", "Gallantry:1"]);
    for (const site of sites) {
      const rebuilt = rebuildWithClassGate(
        module,
        site.attr,
        site.abilityId,
        site.attrIndex,
      ) as unknown as NullifyFirstNHitsAbAttr;
      expect(rebuilt).not.toBe(site.attr);
      expect(rebuilt.getN()).toBe((site.attr as unknown as NullifyFirstNHitsAbAttr).getN());
    }
  });

  it("the original and the rebuild each cancel exactly n real hits, then let damage through", async () => {
    const { holder } = await startWorld(phaserGame);
    for (const site of sitesOf()) {
      const n = (site.attr as unknown as NullifyFirstNHitsAbAttr).getN();
      const original = site.attr as unknown as NullifyFirstNHitsAbAttr;
      const rebuilt = rebuildWithClassGate(
        module,
        site.attr,
        site.abilityId,
        site.attrIndex,
      ) as unknown as NullifyFirstNHitsAbAttr;
      // The memory is a WeakMap keyed by the Pokemon, and every startWorld makes a new Pokemon, so the live original starts empty too.
      for (const attr of [original, rebuilt]) {
        const results = Array.from({ length: n + 2 }, () => hit(attr, holder, 50));
        expect(results, `${site.abilityName}`).toEqual([...Array.from({ length: n }, () => 0), 50, 50]);
        expect(attr.used(holder)).toBe(n);
      }
    }
  });

  it("a preview shows 0 without using a charge, and a hit that already does nothing keeps the charge", async () => {
    const { holder } = await startWorld(phaserGame);
    const site = sitesOf().find(candidate => candidate.abilityName === "Gallantry")!;
    const rebuilt = rebuildWithClassGate(
      module,
      site.attr,
      site.abilityId,
      site.attrIndex,
    ) as unknown as NullifyFirstNHitsAbAttr;
    expect(hit(rebuilt, holder, 40, true)).toBe(0);
    expect(rebuilt.used(holder)).toBe(0);
    expect(hit(rebuilt, holder, 0)).toBe(0);
    expect(rebuilt.used(holder)).toBe(0);
    expect(hit(rebuilt, holder, 40)).toBe(0);
    expect(rebuilt.used(holder)).toBe(1);
    expect(hit(rebuilt, holder, 40)).toBe(40);
  });

  it("the charges come back in a new battle (the memory is keyed by the battle)", async () => {
    const { holder } = await startWorld(phaserGame);
    const site = sitesOf().find(candidate => candidate.abilityName === "Cheating Death")!;
    const rebuilt = rebuildWithClassGate(
      module,
      site.attr,
      site.abilityId,
      site.attrIndex,
    ) as unknown as NullifyFirstNHitsAbAttr;
    let battle: unknown = { id: 1 };
    (rebuilt as unknown as { battleKey: () => unknown }).battleKey = () => battle;
    expect(hit(rebuilt, holder, 30)).toBe(0);
    expect(hit(rebuilt, holder, 30)).toBe(0);
    expect(hit(rebuilt, holder, 30)).toBe(30);
    battle = { id: 2 };
    expect(rebuilt.used(holder)).toBe(0);
    expect(hit(rebuilt, holder, 30)).toBe(0);
  });
});
