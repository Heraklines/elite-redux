/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 4. PARKED until the librarian adds this class to the `flagKeys` of the WHEN `while.active` (request R-B14-4.1, same shape
// as R-B14-3.1 and R-B12-13); then rename this file to CranisphereSkullBashAbAttr.decl.ts. The registry only collects `*.decl.ts`.
//
// "The first Skull Bash I use after entering the battle skips its charging turn."
//
// Source: bernerd-roster-mechanics.ts `export class CranisphereSkullBashAbAttr extends AbAttr {}`: an empty class, a presence marker.
// Nothing dispatches it. One reader, by class NAME: MoveChargePhase (phases/move-charge-phase.ts, about line 116):
//   if (!instantCharge.value                                  nothing else already skipped the charge
//       && move.id === MoveId.SKULL_BASH                      the move is Skull Bash
//       && !user.tempSummonData.erCranisphereSkullBashUsed    not yet used since I entered (tempSummonData is new on every send-out)
//       && user.getAllActiveAbilityAttrs().some(attr => attr.constructor.name === "CranisphereSkullBashAbAttr"))
//     { tempSummonData.erCranisphereSkullBashUsed = true; instantCharge.value = true; }
// No constructor, no closure, no random draw. The class name must never change. All of the rule (the move, the once-per-entry memory,
// the skipped charge) is engine code; the class only says "I have it".
import { CranisphereSkullBashAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(CranisphereSkullBashAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Skip the charge turn of my first Skull Bash after entering",
  summary: () =>
    "While I have this, the first time I use Skull Bash after entering the battle it hits at once, with no charging turn. After I switch out and back in, it works again.",
  synonyms: [
    "cranisphere",
    "skull bash",
    "no charge turn",
    "instant skull bash",
    "skip charging",
    "two-turn move",
    "charge move",
  ],
  examples: ["My first Skull Bash after switching in has no charging turn"],
  params: [],
  noParamsReason:
    "A presence marker read by the move-charging code: the move (Skull Bash), the once-per-entry rule and the skipped charge are all code in that engine step, so the class holds nothing to tune (R-B14-4.2 asks for the engine to read them from the class).",
  conditions: [],
  guards: [],
  feasibility: [
    "Only for Skull Bash (the move is fixed in the engine step)",
    "Only the first use after I enter: switching out and back in makes it work again",
    "Does nothing when another effect already skipped the charging turn",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "entry", simulated: "respects" },
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the twin only compares the whole battle: the holder uses Skull Bash in the default battle and the battles must match. test/tests/elite-redux/decomp/B14/chunk4.test.ts drives the real charging phase with and without the marker.",
  probes: [{ name: "the holder uses Skull Bash", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query, Tier C. Users (1): Cranisphere (6096) attr 1 (attr 0 is a BoneMoveTypeChartAbAttr of another batch). The conditions the owner would want as blocks (the move is Skull Bash, I have not used it since entering) live inside MoveChargePhase, not in the class, so they cannot be separate IF blocks without an engine edit: R-B14-4.2. Oddities, not fixed: (1) the memory is a loose field written onto tempSummonData by name (`erCranisphereSkullBashUsed`), so it is lost with the summon data and is not shared with any library memory.",
});
