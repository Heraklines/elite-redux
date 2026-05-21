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
import { classify, emitArchetypesBody, parseErAbilities } from "./classify-abilities.mjs";

/**
 * Convenience: classify a synthetic ER ability draft. The classifier is pure
 * over `{ id, name, description, archetype }` shape so we don't need to load
 * the full data file for unit testing.
 */
function asAbility(name: string, description: string, id = 1) {
  return { id, name, description, archetype: "unknown" as const };
}

describe("classify-abilities — archetype regex matchers", () => {
  describe("type-damage-boost", () => {
    it("matches the canonical 'Boosts X-type moves by Nx, or Mx when below 1/3 HP' shape", () => {
      const r = classify(asAbility("Hellblaze", "Boosts Fire-type moves by 1.3x, or 1.8x when below 1/3 HP."));
      expect(r.archetype).toBe("type-damage-boost");
      expect(r.params).toMatchObject({
        type: "FIRE",
        multiplier: 1.3,
        lowHpMultiplier: 1.8,
      });
    });

    it("matches the simpler 'Boosts the power of X-type moves by Nx' shape", () => {
      const r = classify(asAbility("Electrocytes", "Boosts the power of Electric-type moves by 1.25x."));
      expect(r.archetype).toBe("type-damage-boost");
      expect(r.params).toEqual({ type: "ELECTRIC", multiplier: 1.25 });
    });

    it("captures the recoil rider when present", () => {
      const r = classify(asAbility("Doom Blast", "Dark-type moves deal 1.35x damage but have 10% recoil."));
      expect(r.archetype).toBe("type-damage-boost");
      expect(r.params).toMatchObject({ type: "DARK", multiplier: 1.35, recoilPct: 0.1 });
    });
  });

  describe("flag-damage-boost", () => {
    it("matches 'Boosts the power of slashing moves by Nx'", () => {
      const r = classify(asAbility("Keen Edge", "Boosts the power of slashing moves by 1.3x."));
      expect(r.archetype).toBe("flag-damage-boost");
      expect(r.params).toEqual({ flag: "SLICING_MOVE", multiplier: 1.3 });
    });

    it("matches the multi-word 'Mighty Horn' shape (horn + drill-based)", () => {
      const r = classify(asAbility("Mighty Horn", "Boosts the power of horn and drill-based by 1.3x."));
      expect(r.archetype).toBe("flag-damage-boost");
      expect(r.params).toMatchObject({ flag: "MIGHTY_HORN", multiplier: 1.3 });
    });
  });

  describe("entry-effect", () => {
    it("classifies 'Adds X type on entry' as add-self-type", () => {
      const r = classify(asAbility("Aquatic", "Adds Water type on entry."));
      expect(r.archetype).toBe("entry-effect");
      expect(r.params).toEqual({ effect: { kind: "add-self-type", type: "WATER" } });
    });

    it("classifies 'Casts X Terrain on entry. Lasts N turns.' as set-terrain", () => {
      const r = classify(asAbility("Electro Surge", "Casts Electric Terrain on entry. Lasts 8 turns."));
      expect(r.archetype).toBe("entry-effect");
      expect(r.params).toEqual({ effect: { kind: "set-terrain", terrain: "ELECTRIC", turns: 8 } });
    });

    it("classifies 'Spreads two layers of Spikes on switch-in' as set-hazard with layers=2", () => {
      const r = classify(asAbility("Watch Your Step", "Spreads two layers of Spikes on switch-in."));
      expect(r.archetype).toBe("entry-effect");
      expect(r.params).toEqual({ effect: { kind: "set-hazard", hazard: "SPIKES", layers: 2 } });
    });

    it("classifies '+N STAT on entry' as self-stat-boost", () => {
      const r = classify(asAbility("Headstrong", "+1 Spdef on entry."));
      expect(r.archetype).toBe("entry-effect");
      expect(r.params).toEqual({ effect: { kind: "self-stat-boost", stat: "SPDEF", stages: 1 } });
    });

    it("classifies 'Attacks with X on switch-in' as scripted-move", () => {
      const r = classify(asAbility("Jumpscare", "Attacks with Astonish on first switch-in."));
      expect(r.archetype).toBe("entry-effect");
      expect((r.params as { effect: { kind: string; move: string } })?.effect?.kind).toBe("scripted-move");
      expect((r.params as { effect: { move: string } })?.effect?.move).toBe("ASTONISH");
    });

    it("classifies generic 'On entry, X' as a misc entry-effect when no more-specific archetype matches", () => {
      const r = classify(asAbility("CuriusMedicn", "Resets its ally's stat changes on entry."));
      expect(r.archetype).toBe("entry-effect");
    });
  });

  describe("chance-status-on-hit", () => {
    it("matches 'N% chance to STATUS' patterns", () => {
      const r = classify(asAbility("Solenoglyphs", "Biting moves have a 50% chance to badly poison the target."));
      expect(r.archetype).toBe("chance-status-on-hit");
      expect(r.params).toMatchObject({ chance: 50, status: "TOXIC" });
    });

    it("matches 'Burns the foe on contact' (100% chance, on-contact-only)", () => {
      const r = classify(asAbility("Daybreak", "Burns the foe on contact. Also works on offense."));
      expect(r.archetype).toBe("chance-status-on-hit");
      expect(r.params).toMatchObject({ chance: 100, status: "BURN", onContactOnly: true });
    });
  });

  describe("crit-mod", () => {
    it("classifies 'immune to critical hits' as immune", () => {
      const r = classify(asAbility("Custom Armor", "Immune to critical hits."));
      expect(r.archetype).toBe("crit-mod");
      expect(r.params).toEqual({ mod: { kind: "immune" } });
    });

    it("classifies '+N crit rate for FLAG moves' as rate-bonus with flag", () => {
      const r = classify(asAbility("CritsX", "+1 crit rate for slashing moves."));
      expect(r.archetype).toBe("crit-mod");
      expect((r.params as { mod: { kind: string; bonus: number; flag?: string } })?.mod).toMatchObject({
        kind: "rate-bonus",
        bonus: 1,
        flag: "SLICING_MOVE",
      });
    });
  });

  describe("damage-reduction-generic", () => {
    it("matches 'Takes N% less damage from Super-effective moves'", () => {
      const r = classify(asAbility("Permafrost", "Takes 35% less damage from Super-effective moves."));
      expect(r.archetype).toBe("damage-reduction-generic");
      expect(r.params).toEqual({ filter: { kind: "super-effective" }, reduction: 0.35 });
    });

    it("matches 'Takes N% reduced damage' (flat)", () => {
      const r = classify(asAbility("Aura Armor", "Takes 35% reduced damage."));
      expect(r.archetype).toBe("damage-reduction-generic");
      expect(r.params).toEqual({ filter: { kind: "all" }, reduction: 0.35 });
    });

    it("matches 'Halves damage taken by Special moves'", () => {
      const r = classify(asAbility("Fire Scales", "Halves damage taken by Special moves. Does NOT double SpDef."));
      expect(r.archetype).toBe("damage-reduction-generic");
      expect(r.params).toEqual({ filter: { kind: "special" }, reduction: 0.5 });
    });

    it("matches 'Quarters contact damage taken'", () => {
      const r = classify(asAbility("Fluffiest", "Quarters contact damage taken. 4x weak to fire."));
      expect(r.archetype).toBe("damage-reduction-generic");
      expect(r.params).toEqual({ filter: { kind: "contact" }, reduction: 0.75 });
    });
  });

  describe("type-conversion", () => {
    it("matches 'Normal moves become X. X moves are empowered.'", () => {
      const r = classify(asAbility("Immolate", "Normal moves become Fire. Fire moves are empowered."));
      expect(r.archetype).toBe("type-conversion");
      expect(r.params).toMatchObject({ sourceType: "NORMAL", targetType: "FIRE" });
    });

    it("matches the truncated 'Normal moves becomes X' shape with default multiplier", () => {
      const r = classify(asAbility("Tectonize", "Normal moves becomes Ground. Might ignore hazards."));
      expect(r.archetype).toBe("type-conversion");
      expect((r.params as { sourceType: string; targetType: string })?.targetType).toBe("GROUND");
    });

    it("matches 'X-type moves become Y and get Nx boost'", () => {
      const r = classify(asAbility("Crystallize", "Rock-type moves become Ice and get a 1.1x boost."));
      expect(r.archetype).toBe("type-conversion");
      expect(r.params).toEqual({ sourceType: "ROCK", targetType: "ICE", multiplier: 1.1 });
    });
  });

  describe("priority-modifier", () => {
    it("matches 'X-type moves get +N priority at max HP'", () => {
      const r = classify(asAbility("Tidal Rush", "Water-type moves get +1 priority at max HP."));
      expect(r.archetype).toBe("priority-modifier");
      expect(r.params).toMatchObject({ priority: 1, filter: { type: "WATER" } });
    });
  });

  describe("composite-vanilla-mashup", () => {
    it("matches 'AbilityA + AbilityB.'", () => {
      const r = classify(asAbility("As One", "Unnerve + Chilling Neigh."));
      expect(r.archetype).toBe("composite-vanilla-mashup");
      expect((r.params as { parts: string[] })?.parts).toEqual(["Unnerve", "Chilling Neigh"]);
    });

    it("captures a free-text rider after the composite parts", () => {
      const r = classify(asAbility("King of the Jungle", "Infiltrator + deals 1.5x more damage to Grass-types."));
      expect(r.archetype).toBe("composite-vanilla-mashup");
      expect((r.params as { parts: string[] })?.parts).toContain("Infiltrator");
    });

    it("rejects 'Boosts STAT by N% + STAT by M%' descriptions (stat-trigger, not composite)", () => {
      const r = classify(asAbility("Violent Rush", "Boosts Speed by 50% + Attack by 20% on first turn."));
      expect(r.archetype).not.toBe("composite-vanilla-mashup");
    });
  });

  describe("lifesteal", () => {
    it("matches per-hit deal-heal", () => {
      const r = classify(asAbility("Energy Siphon", "Heals the user for 1/4 of the damage they deal."));
      expect(r.archetype).toBe("lifesteal");
      expect(r.params).toEqual({ trigger: "on-hit-deal", healFraction: 0.25 });
    });

    it("matches on-KO heal", () => {
      const r = classify(asAbility("Soul Eater", "Dealing a KO heals 1/4 of this Pokémon's max HP."));
      expect(r.archetype).toBe("lifesteal");
      expect(r.params).toMatchObject({ trigger: "on-ko", healFraction: 0.25 });
    });
  });

  describe("stat-trigger-on-event", () => {
    it("matches 'KOs raise STAT by one stage' on-ko shape", () => {
      const r = classify(asAbility("ChillngNeigh", "KOs raise Attack by one stage."));
      expect(r.archetype).toBe("stat-trigger-on-event");
      expect(r.params).toMatchObject({ trigger: "on-ko", stats: [{ stat: "ATK", stages: 1 }] });
    });
  });

  describe("multi-hit-override", () => {
    it("matches 'Punching moves hit twice. 2nd hit at 40%'", () => {
      const r = classify(asAbility("Raging Boxer", "Punching moves hit twice. 1st hit at 100% power, 2nd hit at 40%."));
      expect(r.archetype).toBe("multi-hit-override");
      expect(r.params).toMatchObject({ hits: 2, secondaryHitMultiplier: 0.4 });
    });
  });

  describe("proc-followup-attack", () => {
    it("matches 'Triggers N BP Move after using a TYPE-type move'", () => {
      const r = classify(asAbility("Volcano Rage", "Triggers 50 BP Eruption after using a Fire-type move."));
      expect(r.archetype).toBe("proc-followup-attack");
      expect(r.params).toMatchObject({ followup: "ERUPTION", followupBp: 50, trigger: { type: "FIRE" } });
    });

    it("matches 'After using a Ghost move, follow up with a 50BP Moongeist Beam.'", () => {
      const r = classify(asAbility("Lunar Wrath", "After using a Ghost move, follow up with a 50BP Moongeist Beam."));
      expect(r.archetype).toBe("proc-followup-attack");
      expect((r.params as { followup: string })?.followup).toMatch(/MOONGEIST/);
    });
  });

  describe("on-hit-counter-attack", () => {
    it("matches 'Counters contact with NBP Move'", () => {
      const r = classify(asAbility("Clap Trap", "Counters contact with 50BP Snap Trap."));
      expect(r.archetype).toBe("on-hit-counter-attack");
      expect(r.params).toMatchObject({ counterMove: "SNAP_TRAP", counterBp: 50, filter: { contact: true } });
    });
  });

  describe("conditional-damage", () => {
    it("matches 'Doubles damage if X is sleeping'", () => {
      const r = classify(
        asAbility("Dreamcatcher", "Doubles damage if an opponent is sleeping. Pursues sleeping foes."),
      );
      expect(r.archetype).toBe("conditional-damage");
      expect(r.params).toMatchObject({ multiplier: 2, condition: { kind: "target-asleep" } });
    });
  });

  describe("status-immunity", () => {
    it("matches 'Cannot be confused or intimidated'", () => {
      const r = classify(asAbility("Discipline", "Can switch while rampaging. Can't be confused or intimidated."));
      expect(r.archetype).toBe("status-immunity");
      expect((r.params as { tags?: string[] })?.tags).toContain("INTIMIDATE");
    });
  });

  describe("bespoke fallback", () => {
    it("returns 'bespoke' for an ER ability that matches no archetype", () => {
      const r = classify(asAbility("Soul Linker", "Enemies take all the damage they deal, same for this Pokémon."));
      expect(r.archetype).toBe("bespoke");
      expect(r.params).toBeNull();
      expect(r.paramsParseFailed).toBe(false);
    });

    it("returns 'bespoke' for the empty placeholder (id 0)", () => {
      const r = classify({ id: 0, name: "-------", description: "Empty ability slot.", archetype: "unknown" });
      expect(r.archetype).toBe("bespoke");
    });
  });
});

describe("emitArchetypesBody", () => {
  it("produces a sorted, deterministic record literal", () => {
    const body = emitArchetypesBody([
      { erAbilityId: 200, archetype: "type-damage-boost", params: { type: "FIRE", multiplier: 1.2 } },
      { erAbilityId: 100, archetype: "bespoke", params: null },
    ]);
    // 100 comes before 200 (sorted ascending)
    expect(body.indexOf("100: {")).toBeLessThan(body.indexOf("200: {"));
    expect(body).toContain("erAbilityId: 100");
    expect(body).toContain('archetype: "bespoke"');
    expect(body).toContain("params: null");
    expect(body).toContain('archetype: "type-damage-boost"');
    expect(body).toContain('"type":"FIRE"');
  });

  it("emits the full ErArchetypeKind union including all 23 archetypes + bespoke", () => {
    const body = emitArchetypesBody([]);
    const expectedArchetypes = [
      "type-damage-boost",
      "flag-damage-boost",
      "priority-modifier",
      "entry-effect",
      "chance-status-on-hit",
      "crit-mod",
      "damage-reduction-generic",
      "passive-recovery",
      "lifesteal",
      "stat-trigger-on-event",
      "type-conversion",
      "type-resist-or-absorb",
      "type-effectiveness-override",
      "composite-vanilla-mashup",
      "weather-or-terrain-interaction",
      "multi-hit-override",
      "accuracy-mod",
      "proc-followup-attack",
      "on-hit-counter-attack",
      "status-immunity",
      "conditional-damage",
      "form-change",
      "move-replacement",
      "bespoke",
    ];
    for (const a of expectedArchetypes) {
      expect(body).toContain(`"${a}"`);
    }
  });
});

describe("parseErAbilities", () => {
  it("extracts a JSON array from the auto-generated module shape", () => {
    const src = `
// banner
export interface ErAbilityDraft {
  readonly id: number;
}
export const ER_ABILITIES: readonly ErAbilityDraft[] = [
  { "id": 1, "name": "A", "description": "x", "archetype": "vanilla" },
  { "id": 2, "name": "B", "description": "y", "archetype": "unknown" }
] as const;
`;
    const out = parseErAbilities(src);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(1);
    expect(out[1].archetype).toBe("unknown");
  });
});

const VENDOR_PATH = resolve(import.meta.dirname, "../../vendor/elite-redux/v2.65beta.json");
const ABILITIES_PATH = resolve(import.meta.dirname, "../../src/data/elite-redux/er-abilities.ts");

describe.skipIf(!existsSync(ABILITIES_PATH) || !existsSync(VENDOR_PATH))("classify-abilities — full dump", () => {
  it("classifies the entire er-abilities.ts dataset without throwing", async () => {
    const text = await readFile(ABILITIES_PATH, "utf8");
    const all = parseErAbilities(text);
    const unknowns = all.filter((a: { archetype: string }) => a.archetype === "unknown");
    expect(unknowns.length).toBeGreaterThan(500);
    let bespoke = 0;
    let classified = 0;
    for (const a of unknowns) {
      const r = classify(a);
      expect(typeof r.archetype).toBe("string");
      if (r.archetype === "bespoke") {
        bespoke++;
      } else {
        classified++;
      }
    }
    // Coverage floor: at least 60% non-bespoke (matches the C2 task spec).
    expect(classified / (classified + bespoke)).toBeGreaterThanOrEqual(0.6);
  });
});
