import { achvs } from "#system/achv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const NEW_ER_ACHIEVEMENTS = [
  ["BEAM_SPAM", "beamSpam"],
  ["GOOD_CHIP", "goodChip"],
  ["BACK_IN_BLOOD", "backInBlood"],
  ["SHIELD_BREAK", "shieldBreak"],
  ["CCC_COMBO", "cccCombo"],
  ["GEAR_5", "gear5"],
  ["METAL_SLIME", "metalSlime"],
  ["JURASSIC_END", "jurassicEnd"],
  ["HEEDING_THE_WARNING", "heedingTheWarning"],
  ["MEGAFLARE", "megaflare"],
  ["YO", "yo"],
  ["WEAVE_NATION_CERTIFIED", "weaveNationCertified"],
  ["CRIT_MATTERED", "critMattered"],
  ["AUTO_COUNTER", "autoCounter"],
  ["SNAKES_ON_A_PLANE", "snakesOnAPlane"],
  ["BELIEVE_IT", "believeIt"],
  ["HOLD_IT", "holdIt"],
  ["CHAIN_REACTION", "chainReaction"],
  ["I_JUST_GOT_HERE", "iJustGotHere"],
  ["SORRY_FOR_THE_WAIT", "sorryForTheWait"],
  ["HOLLOW_WICKER_BASKET", "hollowWickerBasket"],
] as const;

describe("Elite Redux achievements", () => {
  it("registers the new achievement ids with English names and descriptions", () => {
    const locale = JSON.parse(readFileSync(join(process.cwd(), "locales/en/achv.json"), "utf8"));

    for (const [id, localizationKey] of NEW_ER_ACHIEVEMENTS) {
      expect(achvs[id]).toBeDefined();
      expect(achvs[id].id).toBe(id);
      expect(achvs[id].localizationKey).toBe(localizationKey);
      expect(locale[localizationKey]?.name).toEqual(expect.any(String));
      expect(locale[localizationKey]?.description).toEqual(expect.any(String));
    }
  });
});
