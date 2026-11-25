/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 2, part 1 of 2 of Decay (Tier A, event-effect with two ordered effects). "When I enter the battle, I mark myself as
// carrying Decay and poison myself."
//
// Source: fakemon-pitch-mechanics.ts, DecayEntryAbAttr (PostSummonAbAttr; `activateOnGain` is true, set by the parent).
//   canApply  the parent's (always true): no condition.
//   apply     !simulated, then in this order:
//             1. holder.addTag(ER_DECAY_POISON, 0, MoveId.NONE, holder.id)          the Decay marker (lasts until I leave the field)
//             2. if holder.status?.effect !== POISON: holder.trySetStatus(POISON, holder)
// Clause 2's `if` is effect-side feasibility, not a staff condition: trySetStatus itself refuses when I already have ANY status
// (canSetStatus), so the only thing the explicit test adds is skipping the call for a holder that is already poisoned. It stays in the class.
// No random draw, no constructor argument. The marker is read by Decay's second half (DecayRestoreAbAttr) at the end of every turn.
import { DecayEntryAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(DecayEntryAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Poison myself and remember it when I enter",
  summary: () =>
    "When I enter the battle, I become poisoned and get the Decay marker, so the poison can be put back every turn if it is ever cured.",
  synonyms: [
    "decay",
    "start poisoned",
    "poison myself on entry",
    "self poison",
    "zombie",
    "poison heal setup",
    "toxic start",
  ],
  examples: [
    "Every time I come in I am poisoned and remember it, so poison comes back at the end of each turn, like Decay",
  ],
  params: [],
  noParamsReason:
    "The effect is fixed: it puts one specific marker (Decay) on myself and poisons me (ordinary poison, never badly poisoned). Neither has a number, stat or type to tune; the status is the Decay marker's whole point.",
  conditions: [],
  guards: [],
  feasibility: [
    "I only get poisoned if I do not already have a status and nothing stops it (the same checks as any poisoning)",
    "Nothing happens while the game only previews the entry",
  ],
  branches: [
    {
      label: "Mark myself as carrying Decay",
      conditions: [],
      effect: { id: "effect.apply-tag", params: [] },
    },
    {
      label: "Poison myself unless I already am",
      conditions: ["I am not already poisoned"],
      effect: { id: "effect.inflict-status", params: [] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "entry as the first Pokemon of the battle", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, fully decomposed into trigger (on entry) and two ordered effects (the marker first, then the poison), written as two branches that BOTH happen in this order (they are not alternatives). No IF exists in the class: the `status !== POISON` test before the poisoning is feasibility (trySetStatus refuses any second status by itself), so no condition block is needed. The effect blocks effect.apply-tag (planned, R-B16-7) and effect.inflict-status (implemented) are only named; the class stays the single source of behaviour, and the library inflict-status must call trySetStatus(POISON, holder) with the holder as the source. User: Decay (6051, attr 0; attr 1 is DecayRestoreAbAttr, attr 2 BlockStatusDamageAbAttr, another batch). Oddity, not fixed: Toxic is not Poison, so a holder that is already badly poisoned keeps Toxic and still gets the marker; the end-of-turn half then sees `status !== POISON` and tries to poison it, which fails while it is statused.",
});
