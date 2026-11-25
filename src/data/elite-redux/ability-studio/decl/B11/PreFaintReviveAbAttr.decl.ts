/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 2 / calc-modifier (Tier B: the HP rule is the gate inside canApply).
//
// Read by hand from archetypes/pre-faint-revive.ts and PreDefendFullHpEndureAbAttr in ab-attrs.ts. The engine asks for it while it
// calculates the damage of a hit on the holder (Pokemon.apply: `applyAbAttrs("PreDefendFullHpEndureAbAttr", ...)`, after
// ModifiedDamageAttr and before the one-hit-KO and mood damage steps), so the WHEN is "while the game calculates damage I take"
// (calc.damage-taken lists that key as an alsoDispatchKey). Constructor: ONE options object `{ gate?, usage? }`, no closure.
//   canApply is now `gate && residual`, in the ORIGINAL clause order:
//     1. gate, CONDITION: `matchesGate(pokemon.getHpRatio(true), pokemon.isFullHp())`
//        full-hp: `isFullHp()`;  hp-threshold: `hp / maxHp >= threshold` (the precise float ratio)
//     2. residual, feasibility: `pokemon.getMaxHp() <= 1` -> false      (a 1 HP Pokemon cannot be left at 1 HP)
//     3. residual, feasibility: `damage.value < pokemon.hp` -> false    (only a hit that would knock the holder out is survived)
//     4. residual, the usage policy (`matchesUsage`): per-hit: no STURDY marker on the holder;
//        first-n-hits: `battleData.hitCount < n` (hits received so far, the current one not yet counted)
//   apply: not when simulated. `pokemon.addTag(STURDY, 1)`. The marker is what Pokemon.damageAndUpdate reads to leave 1 HP
//   (`hp > 1 && getTag(STURDY) -> surviveDamage`). No random draw.
//
// Only clause 1 is a rule staff would change ("only at full HP", "at least half HP", "at any HP"), so it is the gate and every shipped
// user is bound to a library atom. Clauses 2 to 4 are the effect's own preconditions and stay in the class (a lethal hit, more than
// 1 max HP, and "how often"). "How often" is a typed setting (`firstHitsOnly`) rather than an IF block: the library has no atom for
// "I have been hit fewer than N times this battle" (request R-B11-C2-01), and the per-turn form is the effect's own marker.
//
// The effect is one piece: the library has no block for "survive a knock-out hit with 1 HP left" (request R-B11-C2-02). effect.cap-damage
// is a share of MAX HP and is not implemented, while this effect leaves exactly 1 HP whatever the damage. It has no number, type, stat or
// status to set (the marker is fixed), so the only settings are the two that choose WHEN it may work.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PreFaintReviveAbAttr } from "#data/elite-redux/archetypes/pre-faint-revive";
import { reviveHpGateCodec, reviveUsageCodec } from "./b11-chunk2-codecs";

export default defineDecl(PreFaintReviveAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Survive a knockout with 1 HP left, at an HP level you set",
  summary: params =>
    `A hit that would knock me out leaves me on 1 HP instead. ${
      Number(params.firstHitsOnly) === 0
        ? "It can work again every turn."
        : `It only works for the first ${params.firstHitsOnly} hit(s) I take in the battle.`
    }`,
  synonyms: [
    "sturdy",
    "endure",
    "survive a lethal hit",
    "cannot be one shot",
    "hang on with 1 HP",
    "focus sash",
    "lucky halo",
    "survive one hit",
  ],
  examples: [
    "Survive the first knock-out hit of the battle with 1 HP left, like Lucky Halo",
    "Survive a knock-out hit when I am at full HP, like Sturdy",
  ],
  params: [
    {
      id: "hpNeeded",
      ctorIndex: 0,
      ctorOption: "gate",
      path: "hpGate",
      control: "number",
      min: 0,
      max: 100,
      step: 1,
      integer: true,
      label: "HP needed to survive (% of max HP; 100 = only at full HP, 0 = any HP)",
      // The HP rule is the condition block (the gate), and staff change THAT. This setting only records what the shipped rule
      // was built with, because the class keeps it for its own introspection.
      editable: false,
      default: 100,
      codec: reviveHpGateCodec,
    },
    {
      id: "firstHitsOnly",
      ctorIndex: 0,
      ctorOption: "usage",
      path: "usage",
      control: "number",
      min: 0,
      max: 10,
      step: 1,
      integer: true,
      label: "Only the first N hits of the battle can be survived (0 = works again every turn)",
      editable: true,
      // Read by the residual (the usage policy), never by the HP gate, so a binding never repeats it.
      gateIndependent: true,
      default: 0,
      codec: reviveUsageCodec,
    },
  ],
  conditions: [
    // The HP rule. Shipped users: full HP (hp.full) or "at least X% HP" (hp.at-least); Lucky Halo's threshold of 0 is always true.
    { slot: "gate", ctx: "params", lib: "hp.at-least", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must be one that would knock me out (its damage is at least my current HP)",
    "I need more than 1 max HP, otherwise there is nothing to leave",
    "In 'every turn' mode I must not already carry the one-turn survival marker; in 'first N hits' mode I must have taken fewer than N hits in this battle so far",
    "Never in a preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The HP rule's boundaries. 1 HP is left out of the battle twin on purpose (the foe's Tackle would end the run);
      // the L1 grid already tries it.
      name: "HP at max, one below max and around half, with a hit that would knock me out",
      axes: { hp: ["max", "max-1", "50%", "50%+1", "50%-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Only user: Lucky Halo (5426, attr 1), built with `{ gate: hp-threshold 0, usage: first-n-hits 1 }`: its gate is always true (a threshold of 0 passes at every HP, `{ all: [] }`) and its usage is the first hit of the battle. The class keeps the HP rule in a private field that was called `gate`; it is now `hpGate` because the Tier B split needs a METHOD called `gate` (no behaviour change, `getGate()` is unchanged). The 4 clauses of the old canApply keep their order: gate, then max HP, then lethal, then usage. Subclass: LingeringMuskEndureAbAttr (abilities/bernerd-roster-mechanics.ts, Lingering Musk) extends this class and inherits the new gate/residual, so its own declaration (another batch) must bind a gate too. Shared state: the STURDY marker lives on the Pokemon and `battleData.hitCount` on its battle data, nothing is kept in the attr. Oddity, NOT fixed: `hitCount` counts EVERY hit that did damage to the holder (incremented in move-effect-phase.ts after the damage step, `target.battleData.hitCount++`), so in 'first N hits' mode a first hit that does not knock the holder out uses up the proc: Lucky Halo only saves a Pokemon whose very first hit of the battle is lethal, which is probably not what the ability text means ('endures a single KO'). Also: the count lives in the battle data, so it covers the whole battle across switches, as the class comment says. Also: the class never reads `simulated` in canApply (a preview can pass it), only `apply` skips the marker.",
});
