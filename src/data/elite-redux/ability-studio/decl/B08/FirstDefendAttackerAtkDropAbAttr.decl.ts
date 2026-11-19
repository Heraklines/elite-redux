/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 2 / event-effect, Tier B. Read from the source (archetypes/consume-on-first-defend.ts) and from the one live user
// (Drakelp Head, 5690, attr 1). The class extends PostDefendStatStageChangeAbAttr with a fixed closure, stat, stage and target:
//   super((_target, _user, move) => move.category !== MoveCategory.STATUS, Stat.ATK, -1, false)   (selfTarget false: the ATTACKER)
// and adds a one-shot: canApply = `super.canApply(params) && !holder.waveData.firstDefendConsumed`, apply = `super.apply(params)`
// then (when not simulated) `holder.waveData.firstDefendConsumed = true`. canApply is now `gate && residual`, in the original order:
//
//   gate     1. the move is not a status move (the parent's closure)
//   residual 2. the first-hit shield is not spent yet (waveData.firstDefendConsumed is false)         (feasibility, a memory)
//   apply    the parent lowers the attacker's Attack by one stage (skipped when simulated), then the shield is spent
//
// The flag is shared with FirstDefendDamageReductionAbAttr (the other half of the same ability). No random draw.
// The constructor takes no argument: the closure, the stat, the number of stages and the target are fixed.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { FirstDefendAttackerAtkDropAbAttr } from "#data/elite-redux/archetypes/consume-on-first-defend";

export default defineDecl(FirstDefendAttackerAtkDropAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Lower the attacker's Attack on the first damaging hit I take",
  summary: () =>
    "After the first damaging hit I take in a battle, the attacker's Attack drops by 1 stage and the one-time shield is used up. Later hits do nothing.",
  synonyms: [
    "drakelp head",
    "weaken the attacker once",
    "first hit attack drop",
    "one time intimidate",
    "lower attacker attack",
    "retaliate with an attack drop",
  ],
  examples: ["Drop the Attack of the first Pokemon that hits me, once per battle"],
  params: [],
  noParamsReason:
    "The class has no constructor argument: it always lowers the attacker's Attack by exactly one stage once per battle, so the stat and the amount cannot be set. Staff who want another stat or amount combine the library blocks instead (change a stat stage plus a once-per-battle condition).",
  conditions: [
    // The gate is the parent's closure: [move.damaging] (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The first-hit shield must not be used up yet",
    "The attacker's Attack must be able to go down by one stage (not already at -6, not blocked)",
  ],
  effect: { id: "effect.stat-stage", params: [] },
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
    "Tier B split by hand: canApply = gate (move is not a status move) && residual (shield unspent). One user, Drakelp Head (5690, attr 1), gate bound to move.damaging. SHARED STATE: pokemon.waveData.firstDefendConsumed (reset every wave, per Pokemon) is SET by this class's apply (not when simulated) and read by the damage half (FirstDefendDamageReductionAbAttr); the two halves are used together. Dispatch order inside one strike is the reason it works: the damage half is read first (PreDefend), this half after the damage (PostDefend) and sets the flag, so a later strike sees it spent. The Attack drop itself is the parent's apply (the stat stage change phase, which checks the usual stage limits and blocking abilities); `simulated` is respected by both the parent and the flag write. Possible oddity, NOT VERIFIED and NOT FIXED: if the first damaging hit knocks the holder out, the Attack drop may not run while the damage half already used the shield.",
});
