/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 2 / while-active flag with one setting (copy of the IgnoreContact precedent plus one enum param). See ../PRECEDENTS.md.
//
// The class has no behaviour of its own (`apply` is empty and is never dispatched). The only reader is Move.doesFlagEffectApply
// (move.ts, case IGNORE_PROTECT):
//   `user.hasAbilityWithAttr("IgnoreProtectByFlagAbAttr")`, then `user.getAbilityAttrs("IgnoreProtectByFlagAbAttr").some(a => this.hasFlag(a.flag))`
// so a move goes through protection when it carries the flag stored in the attr (a plain `hasFlag`, not doesFlagEffectApply, so a
// flag injected by another ability does not count). It is asked AFTER the contact bypass (Unseen Fist) and BEFORE the first-turn
// bypass (Demolitionist); all three are separate classes and any one of them is enough.
// Constructor: `(flag: MoveFlags)`, `super(false)`; the flag is the only setting.
import { IgnoreProtectByFlagAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { MoveFlags } from "#enums/move-flags";

export default defineDecl(IgnoreProtectByFlagAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "My chosen kind of move goes through protection",
  summary: params =>
    `While I have this, my moves of the kind "${params.flag}" ignore protection moves such as Protect and hit anyway. Example: slicing moves break through Protect.`,
  synonyms: [
    "pinnacle blade",
    "puncture",
    "keen edge",
    "slicing moves ignore protect",
    "break through protect",
    "bypass protect",
    "ignore protection for a kind of move",
  ],
  examples: [
    "My slicing moves break through Protect, like Pinnacle Blade",
    "My punching moves ignore Protect and Detect",
  ],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      path: "flag",
      control: "select",
      label: "Kind of move that goes through protection",
      editable: true,
      default: "SLICING_MOVE",
      options: MOVE_FLAG_OPTIONS,
      codec: enumCodec(MoveFlags, "kind of move"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only moves that really carry that trait go through; a trait that another ability adds to a move does not count here",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a slicing and a non-slicing move against a protecting foe", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment, so the shared twin only compares whole battles. The engine site (Move.doesFlagEffectApply, IGNORE_PROTECT) is driven directly in test/tests/elite-redux/decomp/B07/flag-sites-2.test.ts for the original, the rebuilt attr and a control.",
  status: "decomposed",
  notes:
    "While-active flag with one param, Tier C. Read only by Move.doesFlagEffectApply (move.ts, IGNORE_PROTECT) through hasAbilityWithAttr + getAbilityAttrs. Users (live dump): Pinnacle Blade (5401, attr 1) and Puncture (5942, attr 2), both with flag 256 = SLICING_MOVE; showAbility false is fixed by `super(false)` and is not a constructor argument. No closure, so nothing to bind. Siblings that are separate classes: IgnoreProtectOnContactAbAttr (Unseen Fist, contact moves) and IgnoreProtectFirstTurnAbAttr (Demolitionist, first turn only). The engine uses `hasFlag`, so a flag injected into a move by another ability (isMoveFlagInjector) does not make it go through protection; recorded, not changed.",
});
