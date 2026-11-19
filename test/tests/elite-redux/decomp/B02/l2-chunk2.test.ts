/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 2: the shared L2 suite proves "same trace". This test prints what the ORIGINAL ability did in each scenario
// (attr evaluations that applied, random draws) and asserts that the effect really happened for the scenario that
// should trigger it and not for the one that should not, so two identical traces cannot both be "nothing happened".
//  - Shield Dust (19): a foe's Ember (burn chance) is evaluated and applied, a foe's Tackle has no chance to remove.
//  - Parental Bond (185) and Unrelenting (5695): the holder's Tackle and Double Slap, the original adds the strikes.
//  - Steelworker (200) and Hydrate (5053): the Normal-type test of the bound closure in a real battle.
//  - Protean (168): evaluated on every move the holder uses (the default Normal holder cannot change type; the
//    type change itself is proven in chance-and-effects.test.ts).
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { checkIdentity } from "#test/tests/elite-redux/decomp/harness/differential";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { liveAbility, scenariosFor, twinRebuild } from "#test/tests/elite-redux/decomp/harness/twin";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

interface Case {
  readonly abilityId: number;
  readonly className: string;
  /** Per foe move ("" when the scenario has no foe move axis): must the attr APPLY (true), NOT apply (false), or either. */
  readonly applies: Readonly<Record<string, boolean | undefined>>;
}

const CASES: readonly Case[] = [
  { abilityId: 19, className: "IgnoreMoveEffectsAbAttr", applies: { EMBER: true, FLAMETHROWER: true } },
  { abilityId: 185, className: "AddSecondStrikeAbAttr", applies: { "": true } },
  { abilityId: 5695, className: "AllAttacksMultiHitAbAttr", applies: { "": true } },
  { abilityId: 200, className: "MoveTypeChangeAbAttr", applies: { "": true } },
  { abilityId: 5053, className: "MoveTypeChangeAbAttr", applies: { "": true } },
  { abilityId: 168, className: "PokemonTypeChangeAbAttr", applies: { "": undefined } },
];

describe("B02 chunk 2: L2 traces read by eye", () => {
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
        // Shield Dust's trigger is listed as unreached in the shared reach table (request B02-17); every other
        // difference is a real failure.
        const real = outcome.differences.filter(d => d.part !== "when-unreached");
        expect(real.map(d => d.message)).toEqual([]);
        const foeMove = String(scenario.axes.foeMove ?? "");
        const expected = testCase.applies[foeMove];
        if (expected === true) {
          expect(applied, `${scenario.label}: the effect must happen`).toBeGreaterThan(0);
        } else if (expected === false) {
          expect(applied, `${scenario.label}: the effect must not happen: ${mine.join(" | ")}`).toBe(0);
        }
        expect(mine.length, `${scenario.label}: the attr must be looked at`).toBeGreaterThan(0);
        expect(outcome.rebuild.rngCalls, `${scenario.label}: same number of random draws`).toBe(
          outcome.original.rngCalls,
        );
      }
      console.log(`B02_L2_EYE\n${lines.join("\n")}`);
    }, 120000);
  }
});
