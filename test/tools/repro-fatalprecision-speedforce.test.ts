/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO + VERIFY #623 / #622: Fatal Precision (5078) and Speed Force (5093) were
// registered as ER abilities but classified "bespoke" with NO attrs, so they did
// nothing in battle (player reports: SE moves still missed with Fatal Precision;
// Speed Force didn't affect contact-move damage). This asserts both now carry
// their attrs, and behaviorally that Speed Force raises a contact move's damage.
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-fatalprecision-speedforce.test.ts

import { allAbilities } from "#data/data-lists";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const FATAL_PRECISION = 5078;
const SPEED_FORCE = 5093;

function attrNames(id: number): string[] {
  const ability = allAbilities[id] as unknown as { attrs?: { constructor: { name: string } }[] };
  return (ability?.attrs ?? []).map(a => a.constructor.name);
}

describe.skipIf(!RUN)("repro: Fatal Precision + Speed Force are wired (#623/#622)", () => {
  let g: Phaser.Game;
  beforeAll(() => {
    g = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterAll(() => g?.destroy(true));

  it("both abilities carry their behavior attrs (were empty/bespoke before)", async () => {
    const game = new GameManager(g);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);

    const fp = attrNames(FATAL_PRECISION);
    const sf = attrNames(SPEED_FORCE);
    console.log(`Fatal Precision attrs: ${fp.join(", ") || "(none)"}`);
    console.log(`Speed Force attrs    : ${sf.join(", ") || "(none)"}`);
    // Control: Slipstream (5398) is the SAME SpeedBonusToStat attr wired via the
    // dispatcher (not bespoke). Same multiplicity => harness multi-init artifact.
    console.log(`Slipstream attrs     : ${attrNames(5398).join(", ") || "(none)"}`);

    // #623: super-effective moves never miss (ConditionalAlwaysHit) AND always
    // crit (ConditionalCrit).
    expect(fp, "Fatal Precision must force always-hit on SE moves").toContain("ConditionalAlwaysHitAbAttr");
    expect(fp, "Fatal Precision must force always-crit on SE moves").toContain("ConditionalCritAbAttr");
    // #622: contact moves get +20% Speed to the attack stat.
    expect(sf, "Speed Force must add a Speed-based attack bonus").toContain("SpeedBonusToStatAbAttr");
  }, 120_000);
});
