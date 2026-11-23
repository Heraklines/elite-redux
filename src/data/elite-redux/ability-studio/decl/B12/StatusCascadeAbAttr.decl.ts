/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 1. "After my attack, if the target has a certain status, also change its stats" (Neurotoxin).
//
// Source: src/data/elite-redux/archetypes/status-cascade.ts, StatusCascadeAbAttr (extends PostAttackAbAttr). Dispatched after my
// attack lands on a target (`opponent`). Constructor: one options object `{ trigger, stats }`; `super(undefined, false)` keeps
// the parent's default attackCondition (a damaging move) but `canApply` never calls it, and hides the ability banner.
// Clauses, in the original order (Tier B):
//   1. `!opponent || opponent.isFainted()` -> false   GUARD, class method `guards`: there is a target and it is still standing
//   2. `opponent.status?.effect === trigger`          GATE (replaceable) = status.has { who: other, status: trigger }
// apply: skipped when `simulated`; one StatStageChangePhase per entry of `stats` (target = the opponent, selfTarget false).
// No random draw, no memory, so the stat changes repeat after every attack while the target keeps the status.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STATUS_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { StatusCascadeAbAttr } from "#data/elite-redux/archetypes/status-cascade";
import { StatusEffect } from "#enums/status-effect";
import { statChangesCodec } from "./b12-chunk1-codecs";

const IN_PAYLOAD = { ctorIndex: 0 } as const;

export default defineDecl(StatusCascadeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Change the target's stats after my attack if it has a status",
  summary: params =>
    `After my attack, if the target has ${params.trigger}, its stats change: ${params.stats}. Example: a poisoned target loses Attack, Sp. Atk and Speed, like Neurotoxin.`,
  synonyms: [
    "neurotoxin",
    "poison also lowers stats",
    "status cascade",
    "extra stat drop on a poisoned foe",
    "weaken a burned foe",
    "debuff a statused target",
  ],
  examples: [
    "Lower the target's Attack, Sp. Atk and Speed by one stage after I hit it while it is poisoned, like Neurotoxin",
    "Lower the target's Attack by one stage after I hit a burned target",
  ],
  params: [
    {
      id: "trigger",
      ...IN_PAYLOAD,
      ctorOption: "trigger",
      path: "trigger",
      control: "select",
      label: "The status the target must have",
      editable: true,
      default: "POISON",
      options: STATUS_OPTIONS,
      codec: enumCodec(StatusEffect, "status"),
    },
    {
      id: "stats",
      ...IN_PAYLOAD,
      ctorOption: "stats",
      path: "stats",
      control: "text",
      label: "Stat changes for the target, like 'Attack -1, Speed -1' (stages -6 to 6)",
      editable: true,
      gateIndependent: true,
      default: "Attack -1, Sp. Atk -1, Speed -1",
      codec: statChangesCodec,
    },
  ],
  // The status the gate looks for is the same setting as `trigger`: moving the setting moves the gate's status.
  gateParams: [{ param: "trigger", block: "status.has", field: "status" }],
  conditions: [
    // The gate is one atom: the target has the trigger status.
    { slot: "gate", ctx: "params", lib: "status.has", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The target must still be standing: a fainted target is left alone",
    "A stat that is already at its limit does not move further",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.stat-stage", params: ["stats"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The target has no status, then Poison (the trigger) and Toxic (a different status).
      name: "the target has the status, another status, or none",
      axes: { status: ["NONE", "POISON", "TOXIC"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, 1 attr: Neurotoxin (5451 attr 0, trigger Poison, Attack -1, Sp. Atk -1 and Speed -1 on the target). Fully bound: the gate is status.has { other, Poison }, with `trigger` listed in gateParams so a moved setting moves the gate. The target-standing check is a class guard (first clause). Oddities, not fixed: (a) the ability text says 'inflicting poison', but the class only looks at the target's status after the attack, so it fires after every attack on a target that is ALREADY poisoned, and again on every hit of a multi-hit move; (b) Toxic (badly poisoned) is a different status from Poison, so a badly poisoned target does not trigger it; (c) the class never calls the parent's 'damaging move' test, so a status move that reaches a poisoned target also triggers it if the engine dispatches the hook for it; (d) `super(undefined, false)` leaves the ability banner hidden while the stat changes show their own messages.",
});
