/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 2 / calc-modifier, Tier B. Read from the source (archetypes/consume-on-first-defend.ts) and from the one live user
// (Drakelp Head, 5690, attr 0). The class extends ReceivedMoveDamageMultiplierAbAttr with a fixed closure and a fixed multiplier:
//   super((_target, _user, move) => move.category !== MoveCategory.STATUS, 0.5)
// and adds a one-shot: canApply = `super.canApply(params) && !holder.waveData.firstDefendConsumed`. It is now
// `gate && residual`, in the original order:
//
//   gate     1. the move is not a status move (the parent's closure)
//   residual 2. the first-hit shield is not spent yet (waveData.firstDefendConsumed is false)         (feasibility, a memory)
//   apply    damage = toDmgValue(damage * 0.5), by the parent; this half never SETS the flag
//
// The flag is set by the other half of the same ability (FirstDefendAttackerAtkDropAbAttr, after the first damaging hit
// resolves), so the two classes share one memory on `waveData`. It is a plain field, not the `entryEffectsFired` set that the
// library atom time.once-per reads, so the shield stays in the class as a residual (a request is in requests/B08.md).
// The constructor takes no argument: the multiplier and the closure are fixed, so there is nothing to expose as a param.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { FirstDefendDamageReductionAbAttr } from "#data/elite-redux/archetypes/consume-on-first-defend";

export default defineDecl(FirstDefendDamageReductionAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Halve the first damaging hit I take in a battle",
  summary: () =>
    "The first damaging hit I take in a battle does half damage. Later hits are not reduced. It uses the same one-time shield as the Attack drop.",
  synonyms: [
    "drakelp head",
    "first hit shield",
    "weaken the first move",
    "one time damage cut",
    "opening guard",
    "half damage once",
  ],
  examples: ["Take half damage from the first attack of the battle only"],
  params: [],
  noParamsReason:
    "The class has no constructor argument: it always halves (x0.5) the first damaging hit, so the amount cannot be set. Staff who want another number or a different trigger combine the library blocks instead (damage taken multiplier plus a once-per-battle condition).",
  conditions: [
    // The gate is the parent's closure: [move.damaging] (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The first-hit shield must not be used up yet (it is used up by the first damaging hit, by the Attack drop half of the same ability)",
  ],
  effect: { id: "effect.multiply-damage-taken", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // A damaging move and a status move: only the first can be reduced.
      name: "a damaging move and a status move",
      axes: { foeMove: ["TACKLE", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand: canApply = gate (move is not a status move) && residual (shield unspent). One user, Drakelp Head (5690, attr 0), gate bound to move.damaging. SHARED STATE: the one-shot lives in pokemon.waveData.firstDefendConsumed (reset every wave, per Pokemon), written only by FirstDefendAttackerAtkDropAbAttr.apply (when not simulated). The two halves must be used together; this half alone would reduce every hit forever. The multiplier 0.5 is fixed in the class (no constructor argument) and `affectsFixedDamage` stays false, which is the parent's default; both are therefore not exposed. No random draw. `simulated`: canApply reads the flag, never writes it. Possible oddity, NOT VERIFIED and NOT FIXED: both halves are independent dispatches, so a hit after which the Attack drop does not run (for example one that knocks the holder out) may still have been reduced.",
});
