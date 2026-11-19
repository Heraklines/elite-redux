/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 4. Tier C package (the core effect only), event-effect on entry, no random draw, no constructor argument.
//
//   canApply   1. `currentBattle.getBattlerCount() <= 1` -> false   (feasibility: a single battle has no ally)
//              2. `ally = pokemon.getAlly()`; `!ally?.isActive(true)` -> false   (feasibility: the ally must be on the
//                 field and able to fight); then REMEMBERS the ally in `this.ally` (apply and the message read it)
//   apply      unless simulated: for each of the 7 stats with stages (Attack, Defense, Sp. Atk, Sp. Def, Speed, Accuracy,
//              Evasion) set MY stage to the ally's stage; then copy three kinds of crit boost the ally carries:
//              the Dragon Cheer tag (with its crit stage number), the Focus Energy tag, the Laser Focus tag
//   message    `getTriggerMessage` names me and the ally ("<me> copied <ally>'s stat changes")
//
// Both clauses of canApply are feasibility, not conditions: without an active ally `this.ally` stays unset and apply would
// read it. There is no rule in the class staff may swap. The WHEN stays a separate block and any extra IF can only be
// ANDed on top (Tier C). Why one piece: no library effect sets stat stages to another Pokemon's values or copies crit-boost
// tags, and the class keeps `this.ally` between canApply, apply and the message; the 7 stats and 3 tags are fixed in the
// code and not constructor arguments, so there is no number, stat or type staff could type.
import { PostSummonCopyAllyStatsAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostSummonCopyAllyStatsAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Copy my ally's stat changes when I enter (like Costar)",
  summary: () =>
    "When I enter a double battle, my stat boosts and drops and my crit boosts (Focus Energy, Dragon Cheer, Laser Focus) become my ally's. Example: an ally at +2 Attack gives me +2 Attack.",
  synonyms: [
    "costar",
    "copy ally boosts",
    "mirror partner stats",
    "copy stat changes",
    "share ally buffs",
    "clone ally stages",
  ],
  examples: ["Copy my ally's stat boosts and crit boost when I enter, like Costar"],
  params: [],
  noParamsReason:
    "The class takes no arguments: it always copies all seven stat stages and the three critical hit boosts of the first ally. The stats and the tags are fixed in the code, so there is no number, stat, type or status for staff to set.",
  conditions: [],
  guards: [],
  feasibility: [
    "It must be a battle with more than one Pokemon per side (a single battle has no ally)",
    "My ally must be on the field and able to fight, otherwise nothing happens and the ability does not show",
    "In a triple battle it copies only the first ally",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: false },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Package, justified above: Tier C, 1 attr of 1 ability, no closure: Costar (294 attr 0). Library gaps (requests/B03.md): `effect.copy-ally-stat-changes` (set my stages to my ally's and copy its crit boosts), the atom `party.ally-active` (`getAlly()?.isActive(true)`; `party.ally-exists` asks only `getAlly() !== undefined`, which also holds for a fainted or off-field ally) and `party.multi-battle` (`getBattlerCount() > 1`; `party.doubles` reads `battle.double`, which is false in a triple). The single-player L2 battle has no ally, so canApply is false there; the doubles behaviour is proven by test/tests/elite-redux/decomp/B03/chunk4.test.ts. Suspected game bugs, NOT fixed: (1) when the ally carries Dragon Cheer, `pokemon.getTag(CritBoostTag)` returns the FIRST crit-boost tag of the holder (`getTag` with a class matches subclasses), so if I already had Focus Energy the ally's crit stage number is written onto that Focus Energy tag instead of the Dragon Cheer tag; (2) the Dragon Cheer, Focus Energy and Laser Focus tags are only added, never removed, so a holder that has a boost the ally lacks keeps it (stat stages, on the other hand, are overwritten, including with 0).",
});
