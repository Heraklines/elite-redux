/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 2 / event-effect, Tier B. Read from the source (archetypes/consume-on-first-defend.ts) and from the one live user
// (Drakelp Head, 5690, attr 1). The class extends PostDefendStatStageChangeAbAttr with a damaging-move closure. After review
// round 3 the stat, the number of stages and who is changed are constructor arguments (defaults: Attack, -1, the attacker, what
// Drakelp Head uses), and the one-time shield is no longer a hidden residual. canApply is now only the replaceable gate:
//
//   gate     1. the move is not a status move (the parent's closure)                         -> atom move.damaging
//            2. the first-hit shield is not spent yet                                        -> atom time.once-per (wave, key
//               "firstDefendConsumed"; the write waits for the effect)
//   apply    the parent changes the stat stage of the attacker (skipped when simulated), then the shield is spent
//
// The shield is the key "firstDefendConsumed" in waveData.entryEffectsFired (per wave, per Pokemon), read by the damage half
// (FirstDefendDamageReductionAbAttr) and spent here. No random draw.
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { FirstDefendAttackerAtkDropAbAttr } from "#data/elite-redux/archetypes/consume-on-first-defend";
import { Stat } from "#enums/stat";

/** The stats a stage can change, in the words a player uses. */
const STAT_WORDS: readonly (readonly [name: string, stat: Stat])[] = [
  ["Attack", Stat.ATK],
  ["Defense", Stat.DEF],
  ["Sp. Atk", Stat.SPATK],
  ["Sp. Def", Stat.SPDEF],
  ["Speed", Stat.SPD],
  ["Accuracy", Stat.ACC],
  ["Evasion", Stat.EVA],
];

const statCodec: ParamCodec = {
  toCtor: value => {
    const entry = STAT_WORDS.find(([name]) => name === value);
    if (entry === undefined) {
      throw new Error(`"${String(value)}" is not a stat that can change`);
    }
    return entry[1];
  },
  fromInstance: raw => STAT_WORDS.find(([, stat]) => stat === raw)?.[0],
};

const WHO_ATTACKER = "The attacker";
const WHO_ME = "Me";

/** The class keeps a yes/no `selfTarget`; staff pick who is changed in words. */
const whoCodec: ParamCodec = {
  toCtor: value => value === WHO_ME,
  fromInstance: raw => (typeof raw === "boolean" ? (raw ? WHO_ME : WHO_ATTACKER) : undefined),
};

export default defineDecl(FirstDefendAttackerAtkDropAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Change a stat on the first damaging hit I take in a battle",
  summary: params =>
    `After the first damaging hit I take in a battle, ${params.target === "Me" ? "my" : "the attacker's"} ${params.stat} changes by ${params.stages} stages and the one-time shield is used up. Later hits do nothing.`,
  synonyms: [
    "drakelp head",
    "weaken the attacker once",
    "first hit attack drop",
    "one time intimidate",
    "lower attacker attack",
    "retaliate with an attack drop",
  ],
  examples: ["Drop the Attack of the first Pokemon that hits me, once per battle"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "stat",
      control: "select",
      label: "Which stat changes",
      editable: true,
      gateIndependent: true,
      default: "Attack",
      options: STAT_WORDS.map(([name]) => name),
      codec: statCodec,
    },
    {
      id: "stages",
      ctorIndex: 1,
      path: "stages",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Number of stages (negative = lower, positive = raise)",
      editable: true,
      gateIndependent: true,
      default: -1,
    },
    {
      id: "target",
      ctorIndex: 2,
      path: "selfTarget",
      control: "select",
      label: "Who it changes",
      editable: true,
      gateIndependent: true,
      default: WHO_ATTACKER,
      options: [WHO_ATTACKER, WHO_ME],
      codec: whoCodec,
    },
  ],
  conditions: [
    // The gate is [move.damaging, time.once-per wave "firstDefendConsumed"] (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["The stat must be able to change by that many stages (not already at its limit, not blocked)"],
  effect: { id: "effect.stat-stage", params: ["target", "stat", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // A damaging move and a status move: only the first can set off the drop.
      name: "a damaging move and a status move",
      axes: { foeMove: ["TACKLE", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, review round 3: the stat, the number of stages and who is changed (selfTarget) are constructor arguments and editable params (defaults Attack, -1, the attacker: Drakelp Head), and the one-time shield is the library memory (key firstDefendConsumed in waveData.entryEffectsFired) read and spent through the atom time.once-per, so nothing hides in a residual any more. One user, Drakelp Head (5690, attr 1), gate [move.damaging, time.once-per]. SHARED MEMORY: this class SETS the memory in apply (not when simulated, after the parent's stat change) and the damage half (FirstDefendDamageReductionAbAttr) reads it; the two halves are used together. Dispatch order inside one strike is the reason it works: the damage half is read first (PreDefend), this half after the damage (PostDefend) and spends the shield, so a later strike sees it spent. The stat change itself is the parent's apply (the stat stage change phase, which checks the usual stage limits and blocking abilities); `simulated` is respected by both the parent and the memory write. The other two parent options (allOthers, opponentsOnly) are not exposed: the class never sets them. ODDITY, read from the code and NOT confirmed in a live battle, NOT FIXED: if the first damaging hit knocks the holder out, the ability of a fainted holder does not run for the PostDefend dispatch (pokemon.ts canApplyAbilitySource has a `!holder.isFainted()` branch), so the drop is skipped and the shield stays unspent (the damage half never spends it, so nothing is lost unless the holder is revived in the same wave).",
});
