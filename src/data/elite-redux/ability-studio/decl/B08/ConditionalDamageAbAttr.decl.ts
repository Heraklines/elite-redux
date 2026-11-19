/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 2 / calc-modifier, Tier B. Read from the source (archetypes/conditional-damage.ts) and from the 6 live users.
// The class extends MovePowerBoostAbAttr and hands the parent ONE closure,
//   (pokemon, target, move) => target !== null && ConditionalDamageAbAttr.evaluateCondition(opts.condition, pokemon, target),
// so the parent's canApply is that closure and apply multiplies power.value. canApply is now `guards && gate`:
//
//   guards   1. there is a target Pokemon (target !== null)
//   gate     2. evaluateCondition(condition, holder, target): ONE situation, chosen by the user's `condition` option
//   (no residual, no random draw, nothing else in canApply)
//
// The situation is a discriminated union of eight kinds; the four that live users set are in SITUATIONS below. Each one has a
// library form that calls the same engine reads (bindings.ts). A situation that no live user sets (target low HP, own low HP,
// confused, any status) is rebuilt from the library atoms (hp.at-most, status.has, status.confused, ...), so it is not a param.
// The multiplier is read only by apply, so it is editable without touching the gate.
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { ConditionalDamageAbAttr, type DamageCondition } from "#data/elite-redux/archetypes/conditional-damage";
import { BattlerTagType } from "#enums/battler-tag-type";

/** What staff pick, and the condition object the class wants for it. */
const SITUATIONS: readonly (readonly [name: string, condition: DamageCondition])[] = [
  ["A Pokemon on the field is asleep", { kind: "any-active-asleep" }],
  ["The target has a lowered stat", { kind: "target-has-lowered-stat" }],
  [
    "The target is confused or enraged",
    { kind: "target-has-any-tag", tags: [BattlerTagType.CONFUSED, BattlerTagType.ER_ENRAGE] },
  ],
  ["The target is bleeding", { kind: "target-has-tag", tag: BattlerTagType.ER_BLEED }],
];

const situationCodec: ParamCodec = {
  toCtor: value => {
    const entry = SITUATIONS.find(([name]) => name === String(value));
    if (entry === undefined) {
      throw new Error(`"${String(value)}" is not a known situation`);
    }
    return { ...entry[1] };
  },
  fromInstance: raw => SITUATIONS.find(([, candidate]) => JSON.stringify(candidate) === JSON.stringify(raw))?.[0],
};

export default defineDecl(ConditionalDamageAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost my attack power while a situation is true",
  summary: params => {
    const situation = String(params.situation);
    return `The power of my moves is multiplied by ${params.multiplier} when this is true: ${situation.charAt(0).toLowerCase()}${situation.slice(1)}. Example: 2 means double power.`;
  },
  synonyms: [
    "dreamcatcher",
    "cosmic daze",
    "blood stigma",
    "pretty princess",
    "hit sleeping foes harder",
    "hit bleeding foes harder",
    "situational power boost",
    "more damage against weakened foes",
  ],
  examples: [
    "Double my move power against bleeding targets",
    "1.5 times my move power against a target with a lowered stat",
  ],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      ctorOption: "multiplier",
      path: "damageMultiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier (2 = double, 0.5 = half)",
      editable: true,
      gateIndependent: true,
      default: 2,
    },
    {
      id: "situation",
      ctorIndex: 0,
      ctorOption: "condition",
      path: "damageCondition",
      control: "select",
      label: "Situation that turns the boost on",
      // The situation IS the gate (each user's binding spells it out with library atoms), so changing it here would not
      // change the compiled rule; staff change the IF block instead.
      editable: false,
      default: SITUATIONS[0][0],
      options: SITUATIONS.map(([name]) => name),
      codec: situationCodec,
    },
  ],
  conditions: [
    // The gate is one library tree per user (bindings.ts), for example [not mon.switching-out other, field.anyone-asleep].
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["There must be a target Pokemon"],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The situations read the target's stat stages, tags and status, and who is asleep: the foe's move only decides which hit is evaluated.
      name: "a damaging move and a status move",
      axes: { foeMove: ["TACKLE", "GROWL"] },
    },
  ],
  l2StaticReason:
    "The shared L2 harness cannot show the move-power hook evaluated (decomp-l2-reach.json lists calc.move-power as unreached: the engine reads the power attrs inside the damage formula in a way the trace hook does not record). The B08 test (test/tests/elite-redux/decomp/B08/gate-split-chunk2.test.ts) compares the frozen original canApply, the refactored canApply and the rebuilt library gate for every live user over who is asleep, who is switching, the target's lasting effects and stat stages (900 states per user), and checks that apply multiplies the power by the same number in both.",
  status: "decomposed",
  notes:
    "Tier B split by hand: canApply = guards (the target exists) && gate (the parent's closure, which is evaluateCondition). The parent's own closure is still built by the constructor and is the class's original gate (gate() calls super.canApply). Users (6, all bound): Dreamcatcher (5043) and Dreamscape (5560, attr 2) any-active-asleep, library form all[ not(mon.switching-out other), field.anyone-asleep ] (the class returns false when the target is mid-switch, then looks for a SLEEP status on any active Pokemon or the holder's own Comatose); Pretty Princess (5150) target-has-lowered-stat, library form stage.compare on the target, stat ANY, below 0 (the class reads BATTLE_STATS, which is all seven stats with stages including Accuracy and Evasion, the same set as stat ANY); Cosmic Daze (5263) and Cosmic Dust (5640, attr 1) target-has-any-tag CONFUSED or ER_ENRAGE, library form any[ tag.has other CONFUSED, tag.has other ER_ENRAGE ]; Blood Stigma (5378, attr 1) target-has-tag ER_BLEED. The four unused situations (target at most half HP, holder at most half HP, target confused, target statused) are reachable with the library atoms. SUSPECTED ODDITY, NOT FIXED: the HP situations compare the float ratio (getHpRatio) to 0.5, which is not the integer rounding of hp.at-most; nobody uses them, so nothing to bind. The ability-level `condition`/closure name is 'condition' on the parent; this class stores its own data in damageCondition and damageMultiplier. showAbility is false (passed by the class).",
});
