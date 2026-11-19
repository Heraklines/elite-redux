/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 4 / Tier C while-active flag, no setting, no closure (Pollinate, Steel Beetle).
//
// Class (ab-attrs.ts:4375): `constructor() { super(false) }` and `apply(_params) {}`. Never dispatched; a PRESENCE marker.
// Reader: Move.isTypeImmune (src/data/moves/move.ts:549), inside the type loop `case PokemonType.BUG:`: `if (this.hasFlag(MoveFlags.POWDER_MOVE)
// && target.hasAbilityWithAttr("BugPowderImmunityAbAttr")) return true`. The clause order is therefore: the target's type list contains
// Bug (the `case`), the move has the powder flag, the marker is present. The "I am Bug-type" clause lives in the reader (it runs once per
// type of the target, so it fires only while the target really has the Bug type); the marker itself holds no condition.
// No RNG, no `simulated` read.
import { BugPowderImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BugPowderImmunityAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Be immune to powder moves while Bug-type",
  summary: () =>
    "While I have this and I am Bug-type, powder moves (Spore, Sleep Powder, Stun Spore...) do nothing to me. A holder that is not Bug-type is still hit.",
  synonyms: ["pollinate", "steel beetle", "powder immunity", "spore immune", "overcoat", "no powder moves"],
  examples: ["Powder moves do not work on me if I am a Bug type, like Pollinate"],
  params: [],
  noParamsReason:
    "A pure presence flag: the game only checks that it exists when it asks whether a powder move can hit a Bug-type, so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: ["Only protects while I am Bug-type: the game checks my type before it asks"],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a Bug-type and a non-Bug holder against a powder move", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment (no trace event), so the shared twin only compares a generic battle with no powder move. b04-chunk4.test.ts proves it with real battles: a Bug-type holder and a non-Bug holder hit by Sleep Powder, original ability against its rebuilt shadow, plus a control without the flag.",
  status: "decomposed",
  notes:
    "Flag, presence only. Users (live dump, 2 attrs): Pollinate (id 5118, attr 2) and Steel Beetle (5404, attr 4, built on Pollinate). The 'Bug-type' half is in the reader, not a library atom; a future 'immune to a move flag' effect (requests/B04.md) plus `mon.has-type{holder, BUG}` could express it, but the reader would still have to ask the library, so it stays a flag. Not fixed, possible game bug: the hasAbilityWithAttr check is only reached when the target already is Bug-type, so a Steel Beetle holder (the archetype comment says its species is Ghost/Rock) never gets the immunity unless its typing changes; the class comment says 'while the holder is Bug-type', which matches the code, so this is by design.",
});
