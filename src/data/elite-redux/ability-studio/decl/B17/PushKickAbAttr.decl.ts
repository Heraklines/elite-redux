/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 3 / Push Kick. Read by hand: bernerd-roster-mechanics.ts `PushKickAbAttr` and `PUSH_KICK_TURN`, its base class
// StatDebuffOnFlagAttackAbAttr (abilities/stat-debuff-on-flag-attack.ts, owned by another batch, which also declares it), the
// grandparent PostAttackAbAttr (ab-attrs.ts, attackCondition = constructor argument 0, default `move.category !== STATUS`) and the
// dispatch `applyAbAttrs("PostAttackAbAttr", ...)` in move-effect-phase.ts (applyOnTargetEffects: once per hit, per target).
//
// canApply, clause by clause, in the order they run (the split is `canApply = gate`; no guards, no residual):
//   1. condition  I have not used this effect on this turn out: `PUSH_KICK_TURN.get(holder) !== holder.tempSummonData.waveTurnCount`
//                 (private WeakMap of the class; apply writes the turn number)                    -> `gate`, NO ATOM (request R25)
//   2. condition  the move deals damage: PostAttackAbAttr's attackCondition, `move.category !== STATUS`
//                                                                                                  -> `gate`, atom move.damaging
//   3. condition  the hit landed: `hitResult < HitResult.NO_EFFECT` = Effective, Super effective, Not very effective, One-hit KO
//                 (the same set as request R12)                                                     -> `gate`, NO ATOM (request R12)
//   4. condition  it is the first strike of my move: `turnData.hitCount === turnData.hitsLeft`        -> `gate`, NO ATOM (request R24)
//   5. condition  the move has the configured property: `move.doesFlagEffectApply({ flag, user: holder, target: foe })`
//                                                                                                  -> `gate`, atom move.flag
//   6. random     `chance >= 100` for this class, so no draw happens (the base class draws only below 100).
// apply: unless simulated, write the turn number into PUSH_KICK_TURN, then queue a StatStageChangePhase on the foe I hit
// (stat and stages from the settings). No random draw.
import { PushKickAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MOVE_FLAG_OPTIONS, STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { MoveFlags } from "#enums/move-flags";
import { Stat } from "#enums/stat";

export default defineDecl(PushKickAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Change a stat of the foe once per turn after my move hits",
  summary: params =>
    `After one of my damaging moves with the "${params.flag}" property lands, the foe's ${params.stat} changes by ${params.stages} stage(s), once per turn out. Example: -1 Defense after a kick.`,
  synonyms: [
    "push kick",
    "lower defense",
    "defense drop",
    "kick debuff",
    "armor break",
    "denting blows",
    "chainsaw",
    "once per turn",
  ],
  examples: [
    "Lower the foe's Defense by 1 stage after my first kicking move each turn",
    "Drop the target's Defense after a hit with a kick",
  ],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      path: "flag",
      control: "select",
      label: "Kind of move that triggers it",
      editable: true,
      default: "KICKING_MOVE",
      options: MOVE_FLAG_OPTIONS,
      codec: enumCodec(MoveFlags, "move property"),
    },
    {
      id: "stat",
      ctorIndex: 1,
      path: "stat",
      control: "select",
      label: "Which stat of the foe changes",
      editable: true,
      gateIndependent: true,
      default: "DEF",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "stages",
      ctorIndex: 2,
      path: "stages",
      control: "number",
      label: "Number of stages (-1 lowers by one, +1 raises by one; 0 is not allowed)",
      editable: true,
      gateIndependent: true,
      default: -1,
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      // Zero would mean "change nothing", which the game refuses; the editor reports it in plain words instead of failing.
      codec: {
        toCtor: value => {
          if (Number(value) === 0) {
            throw new Error(
              "The number of stages cannot be 0. Pick -1 or lower to lower the stat, or +1 or higher to raise it.",
            );
          }
          return Number(value);
        },
        fromInstance: raw => (typeof raw === "number" ? raw : undefined),
      },
    },
  ],
  // The move-property condition of the gate repeats the `flag` param as a literal once a library binding exists.
  gateParams: [{ param: "flag", block: "move.flag", field: "flag" }],
  conditions: [
    // The gate: all[<once per turn out (R25)>, move.damaging, <hit landed (R12)>, <first strike (R24)>, move.flag { flag }], in that
    // order. Three of the five have no atom yet, so the whole gate is legacy-closure-pending-request (bindings.ts).
    {
      slot: "gate",
      ctx: "params",
      lib: "move.damaging and move.flag, plus requests R25 (once per turn out), R12 (the hit landed) and R24 (first strike of my move)",
      removable: true,
      editable: true,
    },
  ],
  guards: [],
  feasibility: [
    "The stat change is never queued for a preview (a simulated hit), but the turn marker is still written",
    "The stat cannot go beyond -6 or +6; the stat change itself stops there",
  ],
  effect: { id: "effect.stat-stage", params: ["stat", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [
    {
      // The grid has no landed/blocked hit result axis and no multi-hit axis; those clauses are proved by hand in
      // test/.../B17/chunk3.test.ts. The foe HP axis shows the clauses do not depend on the target's health.
      name: "hit on a healthy and a half-health foe",
      axes: { foeHp: ["max", "50%"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, no package: the effect is the library's effect.stat-stage on the foe (the class queues a StatStageChangePhase for the target; stages -1 on Defense for the shipped ability). The three literals of the old constructor (Kicking move, Defense, -1) are now constructor arguments with those defaults, so Push Kick is unchanged and the settings are typed. The gate is legacy-closure-pending-request: clause 1 reads the class's private PUSH_KICK_TURN memory (the library's once-per 'turn' scope marks a different value, wave:turn, so it is NOT the same rule; request R25), clause 3 is request R12 and clause 4 is request R24. The inherited clauses 2 to 5 live in the base class StatDebuffOnFlagAttackAbAttr (another batch), which is why the whole base canApply stays inside this gate. Users: Push Kick (6088, attr 0) only. Suspected game bug, NOT fixed: the once-per-turn memory stores the holder's turn-out counter (tempSummonData.waveTurnCount), which restarts at 1 when the holder switches out and back in, so a Push Kick used on turn 1, then switch out and back in, finds 1 again and is refused once on the next turn. A second suspected bug, NOT fixed: apply writes the once-per-turn marker BEFORE it checks `simulated`, so a preview call already uses the turn up (the declaration therefore records simulated: ignores for the marker, while the stat change itself respects it; chunk3.test.ts shows both). The ability text says 'the first Kick move used each turn' but the rule fires on a kick that HITS (a missed or fully resisted first kick does not use the turn up).",
});
