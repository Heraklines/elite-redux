/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 3. "My moves of one type get more power, and even more when my HP is low" (Electrocytes, Hellblaze, Aerilate's second half, Steelworker...).
//
// Source: src/data/elite-redux/archetypes/type-damage-boost.ts, TypeDamageBoostAbAttr (extends MovePowerBoostAbAttr).
// Constructor: one options object `{ type, multiplier, lowHpMultiplier?, lowHpThreshold? (default 1/3), weathers? }`; it throws for a multiplier that is
// not above 0. It hands the parent the closure `typeBoostApplies(user, move, type, weathers)` and showAbility off.
// Dispatched while a move's power is calculated (applyAbAttrs("MovePowerBoostAbAttr")). Clauses, in the original order (Tier B):
//   canApply 1  the move's type AFTER other abilities changed it (`user.getMoveType(move)`) is `type`   GATE (replaceable)
//   canApply 2  when `weathers` is set: the weather is not suppressed (Cloud Nine / Air Lock) and is one of them       GATE (same clause list)
//   apply       `power *= lowHpMultiplier` when it is set and `hp / maxHp <= lowHpThreshold` (precise ratio, exactly at the line counts),
//               otherwise `power *= multiplier`   EFFECT with an HP choice: written as two branches
// No random draw, no state, no `simulated` test (the result is only the power value).
//
// `weathers` is not editable: it decides the shape of the gate. No user sets it today.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { PokemonType } from "#enums/pokemon-type";
import { hpLineCodec, optionalMultiplierCodec, weatherListCodec } from "./b12-chunk3-codecs";

const IN_OPTIONS = { ctorIndex: 0 } as const;

export default defineDecl(TypeDamageBoostAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Make my moves of one type stronger",
  summary: params => {
    const base = `My ${params.type} moves get ${params.multiplier} times their power`;
    if (!Number(params.lowHpMultiplier)) {
      return `${base}. Example: Electric 1.25, like Electrocytes.`;
    }
    const line = Number(params.lowHpLine);
    const lineWords = Math.abs(line - 100 / 3) < 0.01 ? "one third" : `${Number(line.toFixed(2))}%`;
    return `${base}, and ${params.lowHpMultiplier} times while my HP is at or below ${lineWords} of my max HP. Example: Fire 1.3, then 1.8 at one third HP, like Hellblaze.`;
  },
  synonyms: [
    "type boost",
    "fire moves stronger",
    "electric moves stronger",
    "boost one type",
    "pixilate second half",
    "hellblaze",
    "electrocytes",
    "overgrow",
    "blaze",
    "torrent",
    "swarm",
  ],
  examples: [
    "Electric moves get 1.25 times their power, like Electrocytes",
    "Fire moves get 1.3 times their power, and 1.8 times when my HP is at or below one third, like Hellblaze",
  ],
  params: [
    {
      id: "type",
      ...IN_OPTIONS,
      ctorOption: "type",
      path: "type",
      control: "select",
      label: "Move type that gets stronger",
      editable: true,
      default: "FIRE",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "multiplier",
      ...IN_OPTIONS,
      ctorOption: "multiplier",
      path: "highHpMultiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier (1.3 = 30% stronger)",
      editable: true,
      // Only the effect reads it; the gate (the move type) never repeats it.
      gateIndependent: true,
      default: 1.3,
    },
    {
      id: "lowHpMultiplier",
      ...IN_OPTIONS,
      ctorOption: "lowHpMultiplier",
      path: "lowHpMultiplier",
      control: "number",
      min: 0,
      max: 4,
      step: 0.05,
      label: "Power multiplier while my HP is low (1.8 = 80% stronger, 0 = no extra boost)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: optionalMultiplierCodec,
    },
    {
      id: "lowHpLine",
      ...IN_OPTIONS,
      ctorOption: "lowHpThreshold",
      path: "lowHpThreshold",
      control: "number",
      min: 1,
      max: 99,
      step: 0.01,
      label: "HP line for the extra boost (% of max HP; 33.33 means one third)",
      editable: true,
      gateIndependent: true,
      default: 33.3333333333,
      codec: hpLineCodec,
    },
    {
      id: "weathers",
      ...IN_OPTIONS,
      ctorOption: "weathers",
      path: "weathers",
      control: "text",
      label: "Only in these weathers, like 'Rain, Heavy rain' (empty = any weather)",
      // It decides the shape of the gate, which staff change with the weather blocks.
      editable: false,
      default: "",
      codec: weatherListCodec,
    },
  ],
  // The type setting is the same value as the gate's type: moving the setting moves the compiled gate's type.
  gateParams: [{ param: "type", block: "move.type", field: "type" }],
  conditions: [
    // The gate: the move's type after other abilities changed it is `type` (move.type { effective: true }), and the weather test when set.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move's type is read after other abilities (such as a type-changing ability) have changed it",
    "Moves that deal fixed damage are not changed by a power boost",
  ],
  branches: [
    {
      label: "Normal boost",
      conditions: ["the move is the chosen type", "my HP is above the line, or no extra boost is set"],
      effect: { id: "effect.multiply-power", params: ["multiplier"] },
    },
    {
      label: "Extra boost while my HP is low",
      conditions: ["the move is the chosen type", "my HP is at or below the line"],
      effect: { id: "effect.multiply-power", params: ["lowHpMultiplier", "lowHpLine"] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      // One third of max HP is the line of every user; exactly at it, one above and one below reach both branches.
      name: "HP around one third",
      axes: { hp: ["max", "34%", "33%", "25%", 1] },
    },
  ],
  l2StaticReason:
    "The shared L2 reports calc.move-power as unreached (it is dispatched under VariableMovePowerAbAttr, see R-B12-19) although the twins are identical; B12's own test (B12/chunk3.test.ts) runs the class on the original and the rebuild for every move of the game at every HP around the line, and checks the HP choice.",
  status: "decomposed",
  notes:
    "Tier B, every gate bound to move.type { effective: true } (63 attrs). No user sets `weathers`, so the weather clause of the gate is never used today. With the low-HP swap x1.2 then x1.5 at one third HP or less: Short Circuit (5060 and 5948, Electric), Psychic Mind (5081, Psychic), Flock (5097, Flying), Fighter (5239, Fighting), Aerialist (5313 attr 2, Flying), Rockhard Will (5321, Rock), Reaper's Embarce (5726 attr 1, Dark), Foul Energy (5727, Dark). With x1.3 then x1.8: Hellblaze (5153, Fire), Riptide (5154, Water), Forest Rage (5155, Grass), Purgatory (5189, Ghost), Gladiator (5471, Fighting), We Will Rock You (5500, Rock), 3 > 1 (5717 attr 1, Water), Overwhelming Mind (5724, Psychic). Plain boosts without a low-HP swap: Ice x1.2 Refrigerate (174 attr 2); Fairy x1.2 Pixilate (182 attr 2 and 5954 attr 2) and Fae Heart (20007 attr 2); Flying x1.2 Aerilate (184 attr 2) and Fluttering Spirit (6019 attr 2); Flying x1.1 Aerilate (184 attr 3) and Fluttering Spirit (6019 attr 3); Flying x1.25 Imposing Wings (5391 attr 3) and Fey Flight (5544 attr 3); Steel x1.5 Steelworker (200 attr 3), Stainless Steel (5530 attr 2 and 6003 attr 2), Weighted Scales (5938 attr 3), Crude Steel (5995 attr 4), Solar Panel (6028 attr 6) and Warmonger (5584 attr 1); Steel x1.3 Atomic Punch (5385 attr 1); Electric x1.2 Galvanize (206 attr 2), Atomic Burst (5152 attr 3), Plasma Lamp (5197 attr 1), Thunder Gods Vessel (20005 attr 4) and Malicious Empathy (20006 attr 4); Electric x1.25 Electrocytes (5019); Electric x1.35 Electric Burst (5074 attr 0) and Two-Faced (5486 attr 4); Electric x1.5 Hydro Circuit (5159); Fire x1.2 Plasma Lamp (5197 attr 0); Fire x1.35 Infernal Rage (5168 attr 0); Fire x1.5 Combustion (5241); Dark x1.25 Nocturnal (5044); Dark x1.35 Doom Blast (5458 attr 0) and Two-Faced (5486 attr 5); Ice x1.3 Antarctic Bird (5016 attr 0); Ice x1.25 Deep Freeze (5465 attr 1); Ice x1.5 Devious Present (5642); Flying x1.3 Antarctic Bird (5016 attr 1); Water x1.3 Antarctic Bird (5016 attr 2); Water x1.25 Deep Freeze (5465 attr 0); Water x1.5 Aquatic Dweller (5416) and Atlantic Ruler (5536); Ground x1.2 Dune Terror (5167 attr 1); Rock x1.2 Stonecutter (5582); Rock x1.5 Warmonger (5584 attr 0); Fighting x1.5 Warmonger (5584 attr 2); Grass x1.2 Smoldering Wood (5733). Several of them carry an ability-level condition that the ability added itself (the 'Aerilate rule': the extra boost only for a holder that is not, or is, of the type): Refrigerate, Pixilate (both ids), Aerilate (both attrs), Steelworker, Galvanize, Atomic Burst, Stainless Steel (both ids), Weighted Scales, Crude Steel, Solar Panel, Fluttering Spirit (both attrs), Thunder Gods Vessel, Malicious Empathy and Fae Heart. That condition is not a constructor argument; the rebuild carries it over as the ability-level condition, so it is not part of this block's gate. The gate is the whole old canApply (the shared helper typeBoostApplies). The effect is written as two branches (the normal boost, and the extra boost at or below the HP line); the library effect multiply-power covers the number, and the HP choice is stated in the branch conditions (a precise-ratio comparison hp / maxHp <= line, request R-B12-23 for an exact-ratio atom). The HP line setting snaps to an exact 1/N so 33.33 percent is exactly one third. Oddities, not fixed: (a) the comment of lowHpMultiplier says 'strictly below' the line but the code uses 'at or below' (the ER dex says one third or lower, so the code is right and the comment is stale); (b) the multiplied power is not rounded; (c) the move's type is read AFTER other abilities changed it, so an ate-ability's converted move counts for this boost, which looks intended; (d) the ability banner is hidden.",
});
