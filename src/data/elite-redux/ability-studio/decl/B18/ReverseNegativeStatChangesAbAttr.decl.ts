/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 3, Tier B package (effect only). "While the game checks whether a stat drop can land on me, IF it is a drop
// AND it comes from another Pokemon, DO block it and give me the same stat, raised by the same number of stages."
//
// Source: ability-upgrades/attrs/requested-combat-riders.ts over PreStatStageChangeAbAttr (the base class has no constructor
// arguments; showAbility is the default true).
//   canApply, in the ORIGINAL clause order (now guards && gate && residual, every clause a pure read):
//     guard     !cancelled.value                 nobody has blocked the drop yet. Without it, a second blocker would also
//                                                queue a boost, so it is a safety rule (no registered guard id yet, request R-B18-24)
//     gate      stages < 0                       the change is a drop                -> condition (library atom stage.just-changed, lowered)
//     residual  source !== null                  the drop has a source               -> condition WITHOUT a library atom yet
//                                                (request R-B18-25), so it stays in the class and is shown as "also requires"
//   apply     cancelled.value = true (also when simulated), then, unless simulated,
//             phaseManager.unshiftNew("StatStageChangePhase", holder, selfTarget true, [stat], |stages|).
// WHY THE EFFECT STAYS ONE PIECE: it is two effects (block the drop, raise the same stat) whose stat and size are not settings
// but the very stat and number of stages of the change that was blocked. The library blocks (effect.negate, effect.stat-stage)
// take fixed settings, so the pair cannot be rebuilt from them until effect.stat-stage can copy "the stat and size of the change"
// (request R-B18-26). There is nothing for staff to set: no stat, no number, no type.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ReverseNegativeStatChangesAbAttr } from "#data/elite-redux/ability-upgrades/attrs/requested-combat-riders";

export default defineDecl(ReverseNegativeStatChangesAbAttr, {
  tier: "B",
  kind: "package",
  when: "cancel.stat-drop",
  label: "Turn a stat drop into a boost of the same size",
  summary: () =>
    "When another Pokemon would lower one of my stats, the drop is blocked and I get the same stat raised by the same number of stages. Example: -2 Attack becomes +2 Attack.",
  synonyms: [
    "reverse stat drops",
    "stat drops become boosts",
    "contrary for others",
    "flip stat changes",
    "change of heart",
    "turn debuffs into buffs",
  ],
  examples: [
    "When a foe lowers my Speed by 1, raise my Speed by 1 instead, like Change of Heart",
    "Intimidate makes me stronger instead of weaker",
  ],
  params: [],
  noParamsReason:
    "The stat and the number of stages always copy the stat drop that was blocked, so there is no number, type, stat or status for staff to set.",
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "Nothing happens when another effect already blocked the drop",
    "Only drops that have a source count (a change that comes from a Pokemon or an effect)",
    "The boost is not queued while the game is only previewing",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "Nothing in the game dispatches PreStatStageChangeAbAttr (StatStageChangePhase only dispatches ProtectStat, ConditionalUserFieldProtectStat, ReflectStatStageChange, SelfStatDropImmunity), so a battle can never evaluate this class; its answers are proven by calling canApply and apply directly (B18/chunk3.test.ts) and by the L1 gate differential.",
  probes: [{ name: "a drop from a foe, a drop from nobody, a boost and an already blocked drop", axes: {} }],
  status: "decomposed",
  notes:
    "Package for the effect only, justified in the header (request R-B18-26); the trigger (cancel.stat-drop) and the drop test (stage.just-changed lowered, the gate) are separate blocks. User (1 attr): Change of Heart (5234 attr 1). Class change (pure move of the old canApply into guards / gate / residual, same order). OPEN REQUEST R-B18-25: `source !== null` has no atom, so it stays in the residual; when the atom exists it moves into the gate. SUSPECTED GAME BUG, NOT FIXED: no code dispatches PreStatStageChangeAbAttr (grep over src finds only the type and the phase's other keys; decomp-l2-reach.json already lists cancel.stat-drop as never evaluated), so Change of Heart's reversal never happens in a real battle; ReflectStatStageChangeAbAttr works because it has its own dispatch call. Second oddity: the parameter type says `source` is OMITTED (undefined) for self-inflicted drops, but the test is `source !== null`, which is true for undefined, so if the class were ever dispatched it would also reverse a drop the holder caused itself. Third: the boost goes out with selfTarget true and the ability pop-up shows (showAbility true), apply sets `cancelled` even for simulated calls.",
});
