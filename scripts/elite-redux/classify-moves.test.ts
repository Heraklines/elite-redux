/*
 * SPDX-FileCopyrightText: 2025-2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classify, emitArchetypesBody, parseErMoves } from "./classify-moves.mjs";

/**
 * Convenience: classify a synthetic ER move draft. The classifier is pure
 * over `{ id, name, description, longDescription, flags, archetype }`
 * shape so we don't need to load the full data file for unit testing.
 */
function asMove(
  name: string,
  description: string,
  longDescription = description,
  id = 1,
  flags: readonly number[] = [],
) {
  return {
    id,
    name,
    description,
    longDescription,
    flags,
    archetype: "unknown" as const,
  };
}

describe("classify-moves — archetype regex matchers", () => {
  describe("flag-tagged-move", () => {
    it("matches the canonical '... Strong Jaw boost.' suffix shape", () => {
      const r = classify(asMove("Aqua Fang", "Bites with aquatic fangs. Has 20% flinch chance. Strong Jaw boost."));
      expect(r.archetype).toBe("flag-tagged-move");
      expect((r.params as { flags: string[] })?.flags).toContain("STRONG_JAW");
    });

    it("matches 'Mega Launcher boost' (no trailing period)", () => {
      const r = classify(
        asMove("Plasma Pulse", "Double damage against status. 10% paralyze chance. Mega Launcher boost"),
      );
      expect(r.archetype).toBe("flag-tagged-move");
      expect((r.params as { flags: string[] })?.flags).toContain("MEGA_LAUNCHER");
    });

    it("captures multiple flag suffixes (Iron Fist + Hammer-based)", () => {
      const r = classify(
        asMove(
          "Molten Strike",
          "Lowers the user's speed. Iron fist boost. Hammer-based.",
          "Lowers the user's speed. Iron fist boost. Hammer-based.",
        ),
      );
      expect(r.archetype).toBe("flag-tagged-move");
      const flags = (r.params as { flags: string[] })?.flags;
      expect(flags).toContain("IRON_FIST");
      expect(flags).toContain("HAMMER_BASED");
    });

    it("surfaces the status-chance rider alongside the flag", () => {
      const r = classify(asMove("Shadow Fangs", "The foe shudders. 10% chance to curse the foe. Strong Jaw boost."));
      expect(r.archetype).toBe("flag-tagged-move");
      expect((r.params as { statusChance?: { chance: number; status: string } })?.statusChance).toEqual({
        chance: 10,
        status: "CURSE",
      });
    });

    it("matches 'Archer boost' / treats Arrow synonym as ARROW flag", () => {
      const r = classify(asMove("Archer Shot", "Shoots a dead center arrow at the target. Archer boost."));
      expect(r.archetype).toBe("flag-tagged-move");
      expect((r.params as { flags: string[] })?.flags).toContain("ARROW");
    });

    it("matches 'Hammer-based' / 'Hammer based' / 'Super Slammer boost' as HAMMER_BASED", () => {
      const a = classify(asMove("Berry Smash", "User smashes its berry, gaining its effect. Super Slammer boost."));
      const b = classify(asMove("Femur Breaker", "The user strikes the foe's legs. Always paralyzes. Hammer-based."));
      expect(a.archetype).toBe("flag-tagged-move");
      expect(b.archetype).toBe("flag-tagged-move");
      expect((a.params as { flags: string[] })?.flags).toContain("HAMMER_BASED");
      expect((b.params as { flags: string[] })?.flags).toContain("HAMMER_BASED");
    });

    it("captures the recoil rider for flag-tagged moves (Zephyr Rush)", () => {
      // Synthetic shape — Zephyr Rush itself has 'Hurts on miss' not '% recoil'
      // but ER does combine flag-tagged with recoil percentages elsewhere.
      const r = classify(asMove("Custom", "Strikes with thunder. Mega Launcher boost. 33% recoil damage."));
      expect(r.archetype).toBe("flag-tagged-move");
      expect((r.params as { recoilPct?: number })?.recoilPct).toBeCloseTo(0.33);
    });
  });

  describe("chance-status-on-hit", () => {
    it("matches 'N% chance to STATUS' phrasing", () => {
      const r = classify(asMove("Black Magic", "Calls on dark power to attack. 20% chance to inflict bleed."));
      expect(r.archetype).toBe("chance-status-on-hit");
      expect(r.params).toMatchObject({ chance: 20, status: "BLEED" });
    });

    it("matches 'N% STATUS chance' phrasing (status word before 'chance')", () => {
      const r = classify(
        asMove("Smite", "Attacks from above with strong electricity. 20% paralysis chance. Smack Down effect."),
      );
      expect(r.archetype).toBe("chance-status-on-hit");
      expect(r.params).toMatchObject({ chance: 20, status: "PARALYSIS" });
    });

    it("matches 'Always paralyzes' as a 100%-chance proc", () => {
      const r = classify(asMove("Custom", "Strikes with no mercy. Always paralyzes."));
      expect(r.archetype).toBe("chance-status-on-hit");
      expect(r.params).toMatchObject({ chance: 100, status: "PARALYSIS" });
    });

    it("matches 'Badly poisons the target' as a 100%-chance TOXIC proc", () => {
      const r = classify(asMove("Bad Egg", "Throws an egg filled with toxins. Badly poisons the target"));
      expect(r.archetype).toBe("chance-status-on-hit");
      expect(r.params).toEqual({ chance: 100, status: "TOXIC" });
    });
  });

  describe("type-conversion", () => {
    it("matches 'X or Y based on effectiveness'", () => {
      const r = classify(asMove("Scorched Earth", "Fire or Ground based on effectiveness. Has 10% burn chance."));
      expect(r.archetype).toBe("type-conversion");
      expect(r.params).toMatchObject({ mode: "best-effectiveness", types: ["FIRE", "GROUND"] });
      // Status-chance rider is surfaced for the wiring step.
      expect((r.params as { statusChance?: { chance: number; status: string } })?.statusChance).toEqual({
        chance: 10,
        status: "BURN",
      });
    });

    it("matches 'Uses elec. or fire based on effectiveness'", () => {
      const r = classify(asMove("Saber Slashes", "Hits twice. Uses elec. or fire based on effectiveness."));
      expect(r.archetype).toBe("type-conversion");
      expect((r.params as { types: string[] })?.types).toEqual(["ELECTRIC", "FIRE"]);
    });
  });

  describe("conditional-damage", () => {
    it("matches 'Double damage on Dragons' (when no flag-suffix steals the row)", () => {
      const r = classify(asMove("Custom", "Double damage on Dragons."));
      expect(r.archetype).toBe("conditional-damage");
      expect(r.params).toMatchObject({
        multiplier: 2,
        condition: { kind: "target-type", type: "DRAGON" },
      });
    });

    it("matches 'Deals 2x damage to sleeping foes'", () => {
      const r = classify(asMove("Dream Invasion", "Deals 2x damage to sleeping foes."));
      expect(r.archetype).toBe("conditional-damage");
      expect(r.params).toMatchObject({ multiplier: 2, condition: { kind: "target-asleep" } });
    });

    it("matches user-statused booster (Bravado)", () => {
      const r = classify(asMove("Bravado", "An attack that is boosted if user is burned, poisoned, or paralyzed."));
      expect(r.archetype).toBe("conditional-damage");
      expect((r.params as { condition: { kind: string; statuses: string[] } })?.condition.kind).toBe("self-statused");
      expect((r.params as { condition: { statuses: string[] } })?.condition.statuses).toEqual([
        "BURN",
        "POISON",
        "PARALYSIS",
      ]);
    });

    it("matches 'N% more damage if the foe is bleeding'", () => {
      const r = classify(asMove("Custom", "50% more damage if the foe is bleeding."));
      expect(r.archetype).toBe("conditional-damage");
      expect(r.params).toMatchObject({ multiplier: 1.5, condition: { kind: "target-bleeding" } });
    });
  });

  describe("recoil-or-drain", () => {
    it("matches '33% recoil damage'", () => {
      const r = classify(asMove("Star Crash", "Strikes the foe like a falling star. 33% recoil damage."));
      expect(r.archetype).toBe("recoil-or-drain");
      expect(r.params).toMatchObject({ mode: "recoil" });
      expect((r.params as { recoilPct: number })?.recoilPct).toBeCloseTo(0.33);
    });

    it("matches '50% recoil damage'", () => {
      const r = classify(asMove("Psycho Wave", "A hazardous energy ball hits the foe. 50% recoil damage."));
      expect(r.archetype).toBe("recoil-or-drain");
      expect((r.params as { recoilPct: number })?.recoilPct).toBe(0.5);
    });

    it("matches 'Heals N% of damage done' as drain", () => {
      // Soil Drain has no flag suffix; Leech Blade DOES (Keen Edge), so it
      // belongs to flag-tagged instead. Test the non-flag case explicitly.
      const r = classify(asMove("Soil Drain", "Foe's power is leeched into the ground. Heals 50% of damage done."));
      expect(r.archetype).toBe("recoil-or-drain");
      expect((r.params as { mode: string; drainPct: number })?.mode).toBe("drain");
      expect((r.params as { drainPct: number })?.drainPct).toBe(0.5);
    });
  });

  describe("classifier ordering", () => {
    it("flag-tagged-move wins over chance-status-on-hit (Strong Jaw is dominant)", () => {
      // Lovely Bite has BOTH '10% chance to infatuate' AND 'Strong Jaw boost'.
      // The flag suffix must take precedence — it carries the archetype.
      const r = classify(asMove("Lovely Bite", "Bites with love. 10% chance to infatuate the foe. Strong Jaw boost."));
      expect(r.archetype).toBe("flag-tagged-move");
      // But the status chance is still surfaced inside the flag payload.
      expect((r.params as { statusChance?: { chance: number; status: string } })?.statusChance).toEqual({
        chance: 10,
        status: "INFATUATION",
      });
    });

    it("chance-status-on-hit wins over conditional-damage when no flag is present", () => {
      const r = classify(asMove("Dream Invasion", "Deals 2x damage to sleeping foes. 10% chance for drowsy."));
      // chance-status-on-hit runs BEFORE conditional-damage because most ER
      // moves with both shapes are primarily status-procs that happen to
      // trigger on a damage modifier.
      expect(r.archetype).toBe("chance-status-on-hit");
    });
  });

  describe("bespoke fallback", () => {
    it("returns 'bespoke' for an ER move that matches no archetype", () => {
      const r = classify(asMove("Inverse Room", "Reverses the type chart for 5 turns."));
      expect(r.archetype).toBe("bespoke");
      expect(r.params).toBeNull();
      expect(r.paramsParseFailed).toBe(false);
    });

    it("returns 'bespoke' for the empty placeholder", () => {
      const r = classify({
        id: 0,
        name: "-",
        description: "",
        longDescription: "",
        flags: [],
        archetype: "unknown",
      });
      expect(r.archetype).toBe("bespoke");
    });
  });
});

describe("emitArchetypesBody", () => {
  it("produces a sorted, deterministic record literal", () => {
    const body = emitArchetypesBody([
      { erMoveId: 200, archetype: "flag-tagged-move", params: { flags: ["STRONG_JAW"] } },
      { erMoveId: 100, archetype: "bespoke", params: null },
    ]);
    // 100 comes before 200 (sorted ascending)
    expect(body.indexOf("100: {")).toBeLessThan(body.indexOf("200: {"));
    expect(body).toContain("erMoveId: 100");
    expect(body).toContain('archetype: "bespoke"');
    expect(body).toContain("params: null");
    expect(body).toContain('archetype: "flag-tagged-move"');
    expect(body).toContain("STRONG_JAW");
  });

  it("emits the full ErMoveArchetypeKind union including all 5 archetypes + bespoke", () => {
    const body = emitArchetypesBody([]);
    const expectedArchetypes = [
      "flag-tagged-move",
      "chance-status-on-hit",
      "type-conversion",
      "conditional-damage",
      "recoil-or-drain",
      "bespoke",
    ];
    for (const a of expectedArchetypes) {
      expect(body).toContain(`"${a}"`);
    }
  });
});

describe("parseErMoves", () => {
  it("extracts a JSON array from the auto-generated module shape", () => {
    const src = `
// banner
export interface ErMoveDraft {
  readonly id: number;
}
export const ER_MOVES: readonly ErMoveDraft[] = [
  { "id": 1, "name": "A", "description": "x", "longDescription": "x", "flags": [], "archetype": "vanilla" },
  { "id": 2, "name": "B", "description": "y", "longDescription": "y", "flags": [], "archetype": "unknown" }
] as const;
`;
    const out = parseErMoves(src);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(1);
    expect(out[1].archetype).toBe("unknown");
  });
});

const VENDOR_PATH = resolve(import.meta.dirname, "../../vendor/elite-redux/v2.65beta.json");
const MOVES_PATH = resolve(import.meta.dirname, "../../src/data/elite-redux/er-moves.ts");

describe.skipIf(!existsSync(MOVES_PATH) || !existsSync(VENDOR_PATH))("classify-moves — full dump", () => {
  it("classifies the entire er-moves.ts dataset without throwing", async () => {
    const text = await readFile(MOVES_PATH, "utf8");
    const all = parseErMoves(text);
    const unknowns = all.filter((m: { archetype: string }) => m.archetype === "unknown");
    expect(unknowns.length).toBeGreaterThan(100);
    let bespoke = 0;
    let classified = 0;
    for (const m of unknowns) {
      const r = classify(m);
      expect(typeof r.archetype).toBe("string");
      if (r.archetype === "bespoke") {
        bespoke++;
      } else {
        classified++;
      }
    }
    // Coverage floor: at least 50% non-bespoke per the C3 task spec.
    // (Moves have less archetypal description structure than abilities, so
    // the target is lower than C2's 60%.)
    expect(classified / (classified + bespoke)).toBeGreaterThanOrEqual(0.5);
  });
});
