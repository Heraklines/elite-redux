/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 4 / Tier C while-active flag, no setting, no closure (Discipline).
//
// Class (ab-attrs.ts:4408): `constructor() { super(false) }` and `apply(_params) {}`. Never dispatched; a PRESENCE marker.
// Reader: CommandPhase.tryExecuteQueuedMove (src/phases/command-phase.ts:326), before the queued move is executed:
// `if (playerPokemon.getTag(BattlerTagType.FRENZY) && playerPokemon.hasAbilityWithAttr("SwitchWhileRampagingAbAttr")) return false;`
// i.e. the queue is NOT auto-executed, so the command menu opens and the player can switch (or pick another command). Clause order:
// the holder is locked by the Frenzy tag (Thrash, Outrage, Petal Dance), then the marker is present. Two-turn charging moves are not
// affected (only the Frenzy tag counts). Only the player's own Pokemon open a menu, so the flag has no effect on enemies.
// No RNG, no `simulated` read.
import { SwitchWhileRampagingAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SwitchWhileRampagingAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Switch out while rampaging (Outrage, Thrash)",
  summary: () =>
    "While I have this, being locked into a rampage move no longer forces me to repeat it: the command menu opens and I can switch out. Example: use Outrage, then swap out next turn.",
  synonyms: [
    "discipline",
    "free rampage",
    "switch during outrage",
    "cancel thrash",
    "no rampage lock",
    "escape outrage",
  ],
  examples: ["I can switch out in the middle of Outrage or Thrash, like Discipline"],
  params: [],
  noParamsReason:
    "A pure presence flag: the game only checks that it exists when it decides whether to repeat the locked move automatically, so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only matters while I am locked into a rampage move like Thrash or Outrage; two-turn charging moves are not affected",
    "Only the player's own Pokemon open a command menu, so it has no effect for enemy trainers",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the holder is locked into a rampage move", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the shared twin only compares a generic battle with no rampage move. b04-chunk4.test.ts proves it with real battles: the holder uses Thrash and the next turn's queue is checked with and without the flag, original ability against its rebuilt shadow.",
  status: "decomposed",
  notes:
    "Flag, presence only. User (live dump, 1 attr): Discipline (id 5125, attr 0, before the Intimidate and confusion immunities, which are other classes). Read by CommandPhase.tryExecuteQueuedMove only.",
});
