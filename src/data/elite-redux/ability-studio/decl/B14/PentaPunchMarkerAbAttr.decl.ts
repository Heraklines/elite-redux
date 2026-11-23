/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14. A presence marker (engine-query), like the FloatAbAttr precedent.
//
// Dispatching the class does nothing (empty `apply`, inherited `canApply` true). The only reader is
// `Pokemon.getMaxMoveCount()` (src/field/pokemon.ts, around line 2661), which checks
// `getAllActiveAbilityAttrs().some(attr => attr.constructor.name === "PentaPunchMarkerAbAttr")` and then allows
// `4 + max(permanentBonusSlots, 1)` moves. The check is by class NAME, so the class name must never change.
//
// WHEN: see AstralProjectStarMarkerAbAttr. The honest trigger is while.active; `event.on-entry` is the only one the
// L0 ancestor check accepts today (the class extends PostSummonAbAttr). Requested in requests/B14.md.
import { PentaPunchMarkerAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PentaPunchMarkerAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "event.on-entry",
  label: "Let me know a fifth move",
  summary: () =>
    "While I have this, I can know five moves instead of four. Example: a Pokemon that is full at four moves can learn a fifth.",
  synonyms: ["fifth move", "extra move slot", "5th move", "five moves", "more moves", "move slot", "penta punch"],
  examples: ["Give this Pokemon a fifth move slot"],
  params: [],
  noParamsReason:
    "A presence marker read by the game when it counts move slots: the number of extra slots is fixed at one and there is nothing to tune.",
  conditions: [],
  guards: [],
  feasibility: [
    "The extra slot is not stacked with the fifth-slot reward: the game gives the larger of the two, so having both still means five moves",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "enter the field", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query marker. Users (1): Penta-Punch (6015) attr 0. Its other attrs (PentaPunchFuryPowerAbAttr at 1, a ChangeMovePriorityAbAttr at 2, a CritStageBonusAbAttr at 3) belong to B17 and the ab-attrs batches. The only reader is Pokemon.getMaxMoveCount (`4 + Math.max(bonusMoveSlots, marker ? 1 : 0)`), a query by class name; the Five-Star Fury move itself is configured by the other attrs, not by this marker. The dispatch at entry is a no-op. TRIGGER REQUEST: while.active; see requests/B14.md.",
});
