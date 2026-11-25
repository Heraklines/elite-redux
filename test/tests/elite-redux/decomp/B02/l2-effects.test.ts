/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 1: the shared L2 suite proves "same trace". This test adds what the owner reads by eye: for the contact
// and weather classes it prints what the ORIGINAL ability did in each scenario (attr evaluations that applied, random
// draws, the foe's final state) and asserts that the effect really happened for the hit that should trigger it and
// did not happen for the hit that should not. Without this, two identical traces could both be "nothing happened".
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { checkIdentity } from "#test/tests/elite-redux/decomp/harness/differential";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { liveAbility, scenariosFor, twinRebuild } from "#test/tests/elite-redux/decomp/harness/twin";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

interface Case {
  readonly abilityId: number;
  readonly className: string;
  /** Per foe move: must the attr APPLY (true), must it NOT apply (false), or either (undefined, RNG decides). */
  readonly applies: Readonly<Record<string, boolean | undefined>>;
}

const CASES: readonly Case[] = [
  { abilityId: 24, className: "PostDefendContactDamageAbAttr", applies: { TACKLE: true, WATER_GUN: false } },
  { abilityId: 5289, className: "PostDefendContactDamageAbAttr", applies: { TACKLE: true, WATER_GUN: false } },
  { abilityId: 253, className: "PostDefendPerishSongAbAttr", applies: { TACKLE: true, WATER_GUN: false } },
  { abilityId: 245, className: "PostDefendWeatherChangeAbAttr", applies: { WATER_GUN: true, LEER: false } },
  { abilityId: 130, className: "PostDefendMoveDisableAbAttr", applies: { TACKLE: undefined, WATER_GUN: false } },
  { abilityId: 254, className: "PostDefendAbilitySwapAbAttr", applies: { TACKLE: true, WATER_GUN: false } },
  { abilityId: 152, className: "PostDefendAbilityGiveAbAttr", applies: { TACKLE: true, WATER_GUN: false } },
  { abilityId: 5377, className: "PostDefendAbilityGiveAbAttr", applies: { TACKLE: true, WATER_GUN: false } },
];

describe("B02 chunk 1: L2 traces read by eye", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  for (const testCase of CASES) {
    it(`${testCase.className} on ability ${testCase.abilityId}: identical traces, and the effect happens exactly when it should`, async () => {
      const original = liveAbility(testCase.abilityId);
      const module = declRegistry.get(testCase.className)!;
      const site = allAttrSites().find(s => s.abilityId === testCase.abilityId && s.className === testCase.className)!;
      expect(checkIdentity(site, module).outcome).toBe("identical");
      const lines: string[] = [];
      for (const scenario of scenariosFor(module)) {
        const outcome = await twinRebuild(phaserGame, original, declRegistry, scenario);
        const mine = outcome.original.attrEvents.filter(e => e.includes(` ${testCase.className} `));
        const applied = mine.filter(e => e.endsWith("!")).length;
        lines.push(
          `${original.name} | ${scenario.label} | evaluated=${mine.length} applied=${applied} rngCalls=${outcome.original.rngCalls} `
            + `rebuiltEvaluated=${outcome.rebuild.attrEvents.filter(e => e.includes(` ${testCase.className} `)).length} diffs=${outcome.differences.length}`,
        );
        expect(outcome.differences.map(d => d.message)).toEqual([]);
        const foeMove = String(scenario.axes.foeMove ?? "");
        const expected = testCase.applies[foeMove];
        if (expected === true) {
          expect(applied, `${scenario.label}: the effect must happen`).toBeGreaterThan(0);
        } else if (expected === false) {
          expect(applied, `${scenario.label}: the effect must not happen: ${mine.join(" | ")}`).toBe(0);
        }
        expect(mine.length, `${scenario.label}: the attr must be looked at`).toBeGreaterThan(0);
      }
      console.log(`B02_L2_EYE\n${lines.join("\n")}`);
    }, 120000);
  }
});
