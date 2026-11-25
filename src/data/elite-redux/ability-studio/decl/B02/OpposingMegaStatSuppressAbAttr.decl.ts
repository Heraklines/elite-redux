/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 2. "Opposing Mega Pokemon have one stat reduced" (Eternal Flower, one attr per stat).
//
// Source: src/data/abilities/ab-attrs.ts OpposingMegaStatSuppressAbAttr extends FieldMultiplyStatAbAttr and has no
// constructor of its own (the three arguments are the parent's: stat, multiplier, canStack). Its canApply is:
//   1. `target === pokemon || target.isPlayer() === pokemon.isPlayer() || !target.isMega()` returns false
//      -> a CONDITION a staff member may want to change: "the Pokemon whose stat is read is an opposing Mega/Primal".
//   2. `super.canApply(params)`  -> the parent's feasibility (no stacking, no same-stat aura).
// Same dispatch as the parent (Pokemon.getEffectiveStat, `target` = the Pokemon whose stat is read).
//
// Why this is NOT a Tier B split: the clause 1 gate needs two things the library does not have yet, a "this Pokemon is a
// Mega or Primal (Pokemon.isMega(), which also counts the fun-mode pseudo mega and a fusion half)" atom (request
// B02-15), and an engine-parameter builder for the trigger in the shared harness (request B02-16): without the
// builder the shared L1 refuses every Tier B class ("add an engine-parameter builder"). The class stays untouched;
// when both exist the split is `gate` = clause 1 and `residual` = super.canApply, in this order.
import { OpposingMegaStatSuppressAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { Stat } from "#enums/stat";

export default defineDecl(OpposingMegaStatSuppressAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.foe-stat-value",
  label: "Change one stat of every opposing Mega Pokemon",
  summary: params =>
    `While I am on the field, ${params.stat} of every opposing Mega or Primal Pokemon is multiplied by ${params.multiplier}. Example: 0.8 = 20% lower.`,
  synonyms: ["eternal flower", "weaken mega", "lower mega stats", "anti mega", "mega suppression", "primal debuff"],
  examples: ["Lower Attack of every opposing Mega Pokemon by 20%, like Eternal Flower"],
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
      label: "Stat multiplier for opposing Megas (0.8 = 20% lower)",
      editable: true,
      default: 0.8,
    },
  ],
  fixedCtorArgs: { 2: false },
  conditions: [],
  guards: [],
  feasibility: [
    "Only Pokemon on the other side that are in a Mega or Primal form are affected (not me, not my allies, not ordinary forms)",
    "Only one aura of the same kind counts: once one has applied, the others are skipped",
    "A Pokemon that has an aura of the same stat itself is not affected",
  ],
  effect: { id: "effect.multiply-stat", params: ["stat", "multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared L2 scenarios never field a Mega or Primal Pokemon, so the original attr is never asked a question it can answer yes to. B02's own test (B02/chance-and-effects.test.ts) drives canApply and apply with stand-in Pokemon (a Mega form, an ordinary foe, the holder itself, an ally) against the original and the rebuild.",
  probes: [{ name: "the enemy hits the holder", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier A, nothing to bind. Only Eternal Flower uses it: five attrs (ATK, DEF, SPATK, SPDEF, SPD, all x0.8), attr 0 to 4 of ability 5678. The Mega test is a staff condition and stays inside the class until atom mon.is-mega (B02-15) and a harness builder (B02-16) exist; the label and summary say 'opposing Mega' so staff see it. An opposing Mega that carries one of Eternal Flower's own stats is not affected because the parent's every(...) test also counts these attrs (instanceof). Existing behaviour, recorded.",
});
