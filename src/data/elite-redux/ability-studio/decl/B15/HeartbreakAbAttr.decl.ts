/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 2. Package (Tier C). "When I enter I link to my nearest living ally; when that ally faints I gain +1 Speed and +1 in my higher attack, and lose 1 Defense and 1 Sp. Def."
//
// Source: src/data/elite-redux/abilities/heartbreak.ts, class HeartbreakAbAttr (extends PostSummonAbAttr; constructor passes showAbility false, activateOnGain true).
// No canApply of its own (PostSummonAbAttr answers true), so there is no condition, guard or gate in the class. apply: unless simulated, formLink(holder) (link.ts):
//   keeps an existing live link; else candidates = holder.getAdjacentAllies() that are active and not already linked; none -> nothing;
//   ONE candidate -> it; several (triples) -> candidates[globalScene.randBattleSeedInt(candidates.length)] (the only random draw, apply side, never when simulated);
//   the two Pokemon are linked in the module WeakMap.
// The FAINT half is NOT in this class: FaintPhase.doFaint calls erHeartbreakOnAllyFaint(fainted) (faint-phase.ts), which reads the link RAW, finds the holder's active
// HeartbreakAbAttr by constructor name (the holder must be active, not the fainted one itself), breaks the link, then queues two StatStageChangePhases for the holder:
// +boostStages to Speed and to the higher of Attack / Sp. Atk (by raw stat, Attack on a tie), then -dropStages to Defense and Sp. Def (so Clear Body, Contrary and Mist apply).
// Constructor change (behaviour-neutral): boostStages and dropStages (both default 1) are constructor arguments; erHeartbreakOnAllyFaint reads them from the holder's live attr.
import { HeartbreakAbAttr } from "#data/elite-redux/abilities/heartbreak";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(HeartbreakAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Link to my nearest ally and rage when it faints",
  summary: params =>
    `When I enter I link to my nearest living ally. When that ally faints I gain ${params.boostStages} stages in Speed and my higher attacking stat and lose ${params.dropStages} stages in Defense and Sp. Def. No ally, no effect.`,
  synonyms: [
    "heartbreak",
    "link to ally",
    "grief rage",
    "boost when my ally faints",
    "avenge my partner",
    "doubles revenge",
  ],
  examples: [
    "If my doubles partner faints I get +1 Speed and attack but lose some bulk",
    "Soul link that powers me up when it breaks",
  ],
  params: [
    {
      id: "boostStages",
      ctorIndex: 0,
      path: "boostStages",
      control: "number",
      min: 1,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages gained in Speed and my higher attacking stat (1 = one stage)",
      editable: true,
      default: 1,
    },
    {
      id: "dropStages",
      ctorIndex: 1,
      path: "dropStages",
      control: "number",
      min: 1,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages lost in Defense and Sp. Def (1 = one stage lower)",
      editable: true,
      default: 1,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Needs an adjacent living ally on the field; in singles it does nothing",
    "In triples with two possible allies one is picked with a seeded roll",
    "The stat changes go through the normal stat phases, so Clear Body, Mist and Contrary still apply",
    "The faint half and the link are built into the game's faint handling and are not part of this block",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.package", params: ["boostStages", "dropStages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "apply: formLink picks one of several adjacent allies with one seeded draw (triples only, never when simulated)",
    ],
    state: "battle",
    simulated: "respects",
  },
  probes: [{ name: "enter next to an ally", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified. 1 attr in 1 ability: Heartbreak (5920 attr 0). The entry trigger is a separate swappable WHEN and the class has no condition. The effect is a soul link plus a faint reaction: the library has no 'link two Pokemon' effect (state in link.ts, broken when either leaves) and no moment 'when my linked ally faints' (the reaction is driven from FaintPhase, found by constructor name), see request R-B15-13. Both stage amounts are typed params; the 'higher attacking stat' pick (raw getStat, Attack wins a tie) is fixed in the engine function. Suspected oddities, NOT fixed: (1) the pick compares RAW stats (getStat) while the comparable Berserk archetype compares getEffectiveStat, so stat stages are ignored here; (2) the link is read raw at faint time without the both-on-field gate, so a holder that already left the field cannot react (hasHeartbreak requires isActive), which is intended; (3) formLink skips allies that are already linked, so two Heartbreak holders in a triple battle can leave one unlinked.",
});
