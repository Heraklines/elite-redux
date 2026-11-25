/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 4. "The first time I wake up in a battle, change my stats" (Rude Awakening: all five stats +1; its sleep immunity is another block).
//
// Source: src/data/elite-redux/archetypes/wake-stat-boost.ts, WakeStatBoostAbAttr (extends PostWakeUpAbAttr).
// Constructor: one options object `{ stats?, stages }`; `stats` defaults to the five core stats (Attack, Defense, Sp. Atk, Sp. Def, Speed); showAbility is off
// (PostWakeUpAbAttr's `super(false)`). Dispatched when sleep turns reach zero in MovePhase.checkSleep (applyAbAttrs("PostWakeUpAbAttr")). Clauses (Tier B):
//   canApply  `!pokemon.battleData.rudeAwakeningTriggered`: the once-per-battle charge is unspent        GATE (replaceable), the whole old canApply
//   apply 1   `simulated` -> nothing                                                                      respects the preview flag
//   apply 2   `rudeAwakeningTriggered = true` (spends the charge BEFORE queueing, so a re-entrant wake cannot fire twice)   EFFECT-side memory
//   apply 3   ONE StatStageChangePhase for the whole stat list at once, by `stages` (holder, selfTarget true)     EFFECT (stat change)
// No random draw. The flag lives on battleData (reset every encounter) and the matching sleep immunity of the same ability reads it too.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { WakeStatBoostAbAttr } from "#data/elite-redux/archetypes/wake-stat-boost";
import { CORE_STAT_LIST_WORDS, statListCodec } from "./b12-chunk4-codecs";

const IN_OPTIONS = { ctorIndex: 0 } as const;

export default defineDecl(WakeStatBoostAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.wake-up",
  label: "Change my stats the first time I wake up in a battle",
  summary: params =>
    `The first time I wake up from sleep in a battle, these stats change by ${params.stages} stage(s): ${params.stats}. Example: all five stats +1, like Rude Awakening.`,
  synonyms: [
    "wake up boost",
    "boost after sleep",
    "rude awakening",
    "omniboost on wake",
    "once per battle boost",
    "sleep talk reward",
    "wake up stat change",
  ],
  examples: [
    "The first time I wake up, raise all my stats by one stage, like Rude Awakening",
    "The first time I wake up, raise my Attack and Speed by two stages",
  ],
  params: [
    {
      id: "stats",
      ...IN_OPTIONS,
      ctorOption: "stats",
      path: "stats",
      control: "text",
      label: `Which stats change, like 'Attack, Speed' (any of ${CORE_STAT_LIST_WORDS.join(", ")})`,
      editable: true,
      // Only the effect reads it; the gate (the once-per-battle charge) never repeats it.
      gateIndependent: true,
      default: CORE_STAT_LIST_WORDS.join(", "),
      codec: statListCodec,
    },
    {
      id: "stages",
      ...IN_OPTIONS,
      ctorOption: "stages",
      path: "stages",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Number of stages (1 = one stage up, -1 = one stage down)",
      editable: true,
      gateIndependent: true,
      default: 1,
    },
  ],
  conditions: [
    // The gate: the once-per-battle charge is unspent (`!battleData.rudeAwakeningTriggered`). No library atom reads this flag yet (R-B12-33).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A stat that is already at its limit does not move further",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.stat-stage", params: ["stats", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "a natural wake-up with the charge unspent and spent", axes: {} }],
  l2StaticReason:
    "The shared L2 has no scenario that wakes the holder from sleep through MovePhase.checkSleep; B12's own test (B12/chunk4.test.ts) drives the original and a manual rebuild with the charge unspent and spent, and checks the flag and the queued stat phase.",
  status: "decomposed",
  notes:
    "Tier B, 1 attr: Rude Awakening (5440 attr 1; attr 0 is a sleep-immunity block gated by the same flag, see R-B12-12). The old canApply is the gate method now. The gate binding is a legacy-closure: the library once-per atom with scope 'battle' keeps its own WeakMap memory and does NOT read or write `battleData.rudeAwakeningTriggered`, so a library gate would let the class fire twice and would leave the sleep immunity half locked; the library needs an atom that reads this named battle flag (request R-B12-33). The effect is the library stat change; the flag write stays in the class (it also unlocks the sleep immunity of the same ability). Oddities, not fixed: (a) the charge is spent in apply BEFORE the phase is queued, on purpose, so a preview or a re-entrant wake cannot double fire; (b) the class does not check that the holder woke up naturally: it trusts the PostWakeUp dispatch from MovePhase.checkSleep; (c) all five stats go in ONE phase, so one message and one boost animation are used for the whole list; (d) accuracy and evasion are never part of 'all stats'; (e) the ability banner is hidden.",
});
