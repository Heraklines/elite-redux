/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Sediment Bloom (Tier C, package). "When I remove an entry hazard from my side, plant a Bloom on the foes' side that drains them and heals my side."
//
// Source: abilities/newcomer-signature-mechanics.ts, SedimentBloomMarkerAbAttr (extends AbAttr directly; apply is empty).
// The class is a MARKER that other code looks for by name; the constructor now takes drainDivisor (default 16).
//   notifyHazardRemovedBy(user)      called by GlamRockAbAttr.apply and by notifySignatureHazardRemoval (data/moves/move.ts:8326,
//                                    after Rapid Spin / Defog style removals): if the user carries the marker, add a
//                                    SEDIMENT_BLOOM arena tag on the FOES' side (source = user, permanent) and queue a message
//   processSedimentBlooms()          called by phases/turn-end-phase.ts:160 each turn end: for each side with a Bloom,
//                                    every active Pokemon on that side loses max(1, floor(maxHp / divisor)) HP (an
//                                    indirect hit credited to the planter), and the sum is healed to EACH Pokemon of
//                                    the planter's side. divisor = the planter's marker attr's drainDivisor, else 16.
// No RNG. The trigger ("a hazard on my side was removed by me") has no WHEN in the library: requested as R-B13-19.
import { SedimentBloomMarkerAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SedimentBloomMarkerAbAttr, {
  tier: "C",
  kind: "package",
  when: "while.active",
  label: "Plant a draining bloom when I remove a hazard",
  summary: params =>
    `When I remove an entry hazard from my side, a Bloom grows on the foes' side. At the end of each turn it drains 1/${params.drainDivisor} of each foe's max HP and heals my side by the total.`,
  synonyms: ["leech field", "hazard to drain", "bloom", "drain field", "seed the field", "sediment"],
  examples: ["After I clear a hazard, drain a sixteenth of the foes' HP every turn and heal my team"],
  params: [
    {
      id: "drainDivisor",
      ctorIndex: 0,
      path: "drainDivisor",
      control: "number",
      label: "Share of max HP drained each turn (1 / this number)",
      editable: true,
      gateIndependent: true,
      default: 16,
      min: 2,
      max: 64,
      step: 1,
      integer: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "It only works for hazards removed by me (my own end-of-turn hazard eating, or a hazard-clearing move I use)",
    "The drain and the healing run from the end-of-turn code of the field effect, not from this ability's own moment",
  ],
  effect: { id: "effect.package", params: ["drainDivisor"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  l2StaticReason:
    "The class is a marker found by name (notifyHazardRemovedBy) and never dispatched, and the WHEN used here is the always-on placeholder; B13/sediment-bloom.test.ts drives the plant and the turn-end drain.",
  probes: [{ name: "plain battle with no hazard and no bloom", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified: the mechanic is spread over three places (the marker, notifyHazardRemovedBy that plants a field effect, processSedimentBlooms that drains and heals at turn end) and has no moment of its own; splitting it would re-implement the field effect. Honest limits: (1) the trigger is not a library WHEN, so the declaration uses the always-on placeholder and the label says what really happens (R-B13-19 asks for 'When I remove an entry hazard from my side'); (2) the trigger has NO conditions of its own; (3) LIBRARY GAP, L0 will report it: the class extends AbAttr directly, so no WHEN dispatch key is an ancestor of it (while.active lists its flag classes explicitly); R-B13-19 asks the librarian to add the marker classes there. Edit made outside the class (same file): processSedimentBlooms now reads the planter's marker for the divisor (1/16 when the planter is gone or has no marker, which is the old constant). Users: Sediment Bloom (5976, attr 0). ODDITIES (not fixed): (1) the planter is found by the tag's source id; if the planter leaves the field its marker is no longer 'active' and the drain falls back to 1/16. (2) The heal goes to EVERY Pokemon on the planter's side for the FULL total (not split). (3) drained counts the HP actually lost, so a foe at 1 HP adds 1.",
});
