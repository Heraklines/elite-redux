/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// AUDIT TOOL - dumps every ER-custom species currently registered in the
// egg-hatch pool (speciesEggTiers) to dev-logs/egg-pool-audit.json, with
// name/tier/family/divisor/BST, for the egg-pool decluttering audit.
// Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/tools/dump-egg-pool-audit.test.ts
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { allSpecies } from "#data/data-lists";
import { getErEggWeightDivisor } from "#data/elite-redux/init-elite-redux-egg-tiers";
import type { EggTier } from "#enums/egg-type";
import { GameManager } from "#test/framework/game-manager";
import { mkdirSync, writeFileSync } from "node:fs";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const VANILLA_ID_CUTOFF = 10000;
const TIER_NAMES = ["COMMON", "RARE", "EPIC", "LEGENDARY"];

describe.skipIf(!RUN)("TOOL: dump ER egg pool for audit", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("writes dev-logs/egg-pool-audit.json", () => {
    const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
    const costs = speciesStarterCosts as Record<number, number | undefined>;
    const byId = new Map(allSpecies.map(sp => [sp.speciesId as number, sp]));
    const vanillaNames = new Set<string>();
    for (const sp of allSpecies) {
      if (sp.speciesId < VANILLA_ID_CUTOFF) {
        vanillaNames.add(sp.name.toLowerCase());
      }
    }
    const familyKey = (name: string): string => {
      const words = name.split(/\s+/);
      for (let n = words.length; n >= 1; n--) {
        const prefix = words.slice(0, n).join(" ").toLowerCase();
        if (vanillaNames.has(prefix)) {
          return prefix;
        }
      }
      return name.toLowerCase();
    };

    const entries: object[] = [];
    for (const key of Object.keys(tiers)) {
      const id = Number(key);
      if (id < VANILLA_ID_CUTOFF || tiers[id] === undefined) {
        continue;
      }
      const sp = byId.get(id);
      const bst = sp ? sp.baseTotal : null;
      entries.push({
        id,
        name: sp?.name ?? "<unregistered>",
        tier: TIER_NAMES[tiers[id] as number] ?? tiers[id],
        cost: costs[id] ?? null,
        bst,
        family: sp ? familyKey(sp.name) : null,
        familySize: getErEggWeightDivisor(id),
        types: sp ? [sp.type1, sp.type2] : null,
      });
    }
    entries.sort((a, b) =>
      `${(a as { family: string }).family}|${(a as { name: string }).name}`.localeCompare(
        `${(b as { family: string }).family}|${(b as { name: string }).name}`,
      ),
    );
    mkdirSync("dev-logs", { recursive: true });
    writeFileSync("dev-logs/egg-pool-audit.json", JSON.stringify(entries, null, 1));
    console.log(`[egg-audit] dumped ${entries.length} ER egg-pool entries`);
    expect(entries.length).toBeGreaterThan(0);
  });
});
