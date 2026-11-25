/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 2. "While I am on the field, one stat of every other Pokemon is multiplied" (the Ruin abilities).
//
// Source: src/data/abilities/ab-attrs.ts FieldMultiplyStatAbAttr. Dispatched from Pokemon.getEffectiveStat
// (src/field/pokemon.ts, `for (const pokemon of globalScene.getField(true)) applyAbAttrs("FieldMultiplyStatAbAttr",
// { pokemon, stat, statVal, target: this, hasApplied, simulated })`, stopping after the first one that applied).
// So the attr's holder (`pokemon`) is the Ruin owner and `target` is the Pokemon whose stat is being read.
// canApply: `canStack || (!hasApplied.value && this.stat === stat && target.getAbilityAttrs("FieldMultiplyStatAbAttr")
// .every(attr => attr.stat !== stat))`. Three clauses, none a closure:
//   - `this.stat === stat`        the stat param itself (not a condition: it is what the block IS about)
//   - `!hasApplied.value`         feasibility: the Ruin abilities never stack, the first one that applies wins
//   - the `every(...)` test       feasibility: a Pokemon that carries a Ruin of the SAME stat (the holder itself, or
//                                 an ally with the same Ruin) is not weakened by it
// apply: `statVal.value *= multiplier; hasApplied.value = true`. No random draw, no state in the attr.
// `canStack` (constructor argument 2) is fixed to false: with canStack true the first clause short-circuits and the
// attr would multiply EVERY stat, whatever its own stat is (see notes). No ability uses it.
import { FieldMultiplyStatAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { Stat } from "#enums/stat";

export default defineDecl(FieldMultiplyStatAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.foe-stat-value",
  label: "Change one stat of every other Pokemon on the field",
  summary: params =>
    `While I am on the field, every other Pokemon's ${params.stat} is multiplied by ${params.multiplier}. It does not stack with another aura of the same stat. Example: 0.75 = 25% lower.`,
  synonyms: [
    "sword of ruin",
    "vessel of ruin",
    "tablets of ruin",
    "beads of ruin",
    "ruin aura",
    "lower everyone's stat",
    "field stat drop",
    "aura",
  ],
  examples: ["Lower the Defense of every other Pokemon by 25%, like Sword of Ruin"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "stat",
      control: "select",
      label: "Which stat",
      editable: true,
      default: "ATK",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "multiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Stat multiplier for the others (0.75 = 25% lower)",
      editable: true,
      default: 0.75,
    },
  ],
  fixedCtorArgs: { 2: false },
  conditions: [],
  guards: [],
  feasibility: [
    "Only one aura of the same kind counts: once one has applied, the others are skipped",
    "A Pokemon that has an aura of the same stat itself (me, or an ally with the same one) is not affected",
  ],
  effect: { id: "effect.multiply-stat", params: ["stat", "multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the enemy hits the holder", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier A, nothing to bind. Six attrs, four Ruin signatures: Tablets (ATK 0.75, 286), Sword (DEF 0.75, 285, Sword of Damnation attr 1, Sword's Nature), Vessel (SPATK 0.75, 284), Beads (SPDEF 0.75, 287). The effect is the library's multiply-a-stat block read at the 'a foe's stat' trigger (same frame value, statValue). SUSPECTED BUG, not fixed: with `canStack` true the first clause short-circuits `this.stat === stat`, so the attr would multiply every stat; the TODO in the class says canStack is useless, and no ability sets it, so it is a fixed argument here. The class is an `instanceof` match for OpposingMegaStatSuppressAbAttr (its subclass), so the `every(attr => attr.stat !== stat)` test also counts Eternal Flower's attrs. getEffectiveStat stops the loop after the first holder that applied (`fieldApplied`). The `simulated` flag is passed through by the dispatch and only decides whether the ability flashes.",
});
