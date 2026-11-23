/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 2 / calc-modifier, Tier B. Read from the source (archetypes/consume-on-first-defend.ts) and from the one live user
// (Drakelp Head, 5690, attr 0). The class extends ReceivedMoveDamageMultiplierAbAttr with a damaging-move closure and a
// multiplier. After review round 3 the multiplier is a constructor argument (default 0.5, what Drakelp Head uses) and the
// one-time shield is no longer a hidden residual. canApply is now only the replaceable gate, in the original order:
//
//   gate     1. the move is not a status move (the parent's closure)                         -> atom move.damaging
//            2. the first-hit shield is not spent yet                                        -> atom time.once-per-unused (wave, key
//               "firstDefendConsumed": it only READS the memory)
//   apply    damage = toDmgValue(damage * multiplier), by the parent; this half never SETS the memory
//
// The memory is the key "firstDefendConsumed" in waveData.entryEffectsFired, the per-wave Set that every ER once-per-wave rule
// and the library atoms time.once-per and time.once-per-unused already read (before: a plain field waveData.firstDefendConsumed
// with the same lifetime; moving it is a pure change of storage). The other half of the same ability
// (FirstDefendAttackerAtkDropAbAttr) spends it. No random draw.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { FirstDefendDamageReductionAbAttr } from "#data/elite-redux/archetypes/consume-on-first-defend";

export default defineDecl(FirstDefendDamageReductionAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Take less damage from the first damaging hit of a battle",
  summary: params =>
    `The first damaging hit I take in a battle does ${params.multiplier} times its damage (0.5 = half). Later hits are not changed. It reads the same one-time shield that the Attack drop spends.`,
  synonyms: [
    "drakelp head",
    "first hit shield",
    "weaken the first move",
    "one time damage cut",
    "opening guard",
    "half damage once",
  ],
  examples: ["Take half damage from the first attack of the battle only"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "damageMultiplier",
      control: "number",
      min: 0,
      max: 4,
      step: 0.05,
      label: "Damage multiplier (0.5 = half)",
      editable: true,
      gateIndependent: true,
      default: 0.5,
    },
  ],
  conditions: [
    // The gate is [move.damaging, time.once-per-unused wave "firstDefendConsumed"] (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-damage-taken", params: ["multiplier"] },
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
    "Tier B, review round 3: the multiplier is a constructor argument (default 0.5) and an editable param, the one-time shield is the library memory (key firstDefendConsumed in waveData.entryEffectsFired) read by the atom time.once-per-unused, so nothing hides in a residual any more. One user, Drakelp Head (5690, attr 0), gate [move.damaging, time.once-per-unused]. SHARED MEMORY: this half only reads it; it is spent by FirstDefendAttackerAtkDropAbAttr.apply (when not simulated), so the two halves must be used together (this half alone would reduce every hit forever). `affectsFixedDamage` stays false (the parent's default) and is not exposed. No random draw. The memory moved from the plain field waveData.firstDefendConsumed to the key in entryEffectsFired (same lifetime, reset every wave, per Pokemon, never saved); the AI snapshot (combat-engine-adapter) now sees it as an entry-fired token. ODDITY, read from the code and NOT confirmed in a live battle, NOT FIXED: the halves are independent dispatches (PreDefend, then PostDefend). This half never spends the shield, so the earlier worry that the damage half already used the shield was wrong. If the first damaging hit knocks the holder out, the ability of a fainted holder does not run for the PostDefend dispatch (pokemon.ts canApplyAbilitySource has a `!holder.isFainted()` branch), so the Attack drop is skipped and the shield stays unspent; that only matters if the holder is revived in the same wave. A quick battle check (knock the holder out with its first hit, revive it, hit it again) is still a good merge-captain step.",
});
