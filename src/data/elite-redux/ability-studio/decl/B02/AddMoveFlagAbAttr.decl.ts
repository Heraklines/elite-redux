/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 3. "Some of my moves also count as having extra properties" (Brawling Wyvern: Dragon moves count as punching).
//
// Source: src/data/abilities/ab-attrs.ts AddMoveFlagAbAttr (extends AbAttr). It is a passive marker: `canApply` is
// always false, `apply` is empty, nothing is ever dispatched. The engine reads it through the static helper
// `AddMoveFlagAbAttr.userGrantsFlag(user, move, flag)` (init-abilities.ts:740 Iron Fist family, :2213 Sharpness): it scans
// the user's active ability attrs, skips a suppressed user, and says yes when `grantedFlags.includes(flag) && filter(user, move)`.
// Constructor: ({ filter, flags }) as one options object. Refactor of this chunk (behaviour identical, spec 3.1): a second,
// optional argument `condition` in the `(user, target, move)` shape replaces `options.filter`; the class keeps `filter`
// (calls the condition with a null target). Without it the options object cannot carry a library condition.
// Clauses: the filter is the only condition (ctor:1 -> field `condition`); the granted flags are a typed list setting.
// No random draw, no state. Tier A.
import { AddMoveFlagAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { MoveFlags } from "#enums/move-flags";

export default defineDecl(AddMoveFlagAbAttr, {
  tier: "A",
  kind: "while-active",
  when: "while.active",
  label: "Give my moves an extra move property",
  summary: params =>
    `My moves that pass the condition also count as these move properties: ${params.flags}. Abilities that boost that property (such as punching moves) then boost them too.`,
  synonyms: [
    "count as punching",
    "count as kicking",
    "make moves punch",
    "iron fist boost",
    "extra move property",
    "move family",
    "count as sound",
    "add a flag",
  ],
  examples: [
    "Make my Dragon moves count as punching moves, like Brawling Wyvern",
    "Make my Normal moves count as sound moves, like Reverberate",
  ],
  params: [
    {
      id: "flags",
      ctorIndex: 0,
      ctorOption: "flags",
      path: "grantedFlags",
      control: "text",
      label: "Move properties to add (comma separated list)",
      editable: true,
      default: "PUNCHING_MOVE",
      options: [...MOVE_FLAG_OPTIONS],
      codec: enumListCodec(MoveFlags, "move property"),
    },
  ],
  conditions: [{ slot: "ctor:1", ctx: "attack", path: "condition", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "Only works while my ability is active (a suppressed Pokemon grants nothing)",
    "Only abilities that look for the property notice it; it never changes the move itself",
  ],
  effect: { id: "effect.package", params: ["flags"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "A passive marker has no dispatch moment (no trace event); the twin only compares the whole battle (template while-active-flags). The marker is read through userGrantsFlag, which B02/power-boost.test.ts drives directly for the original and the rebuilt attr of every user.",
  probes: [{ name: "a move that the filter accepts and one that it rejects", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 7 attrs (Brawling Wyvern, Junshi Sanda x2, Gunman, Reverberate, Mixed Martial Arts, Kyokushin). The class is not in the AbilityAttrs registry and is never dispatched; the engine scans it with instanceof. The WHEN `while.active` does not list this class in its flagKeys yet: request B02-19 (library). The effect has no library block (grant a move property), effect.package with the list as typed setting: request B02-20. Filters: `user.getMoveType(move) === DRAGON / NORMAL` (move.type, effective), `move.hasFlag(PUNCHING)` / `move.hasFlag(KICKING)` (move.flag; the engine only injects the dance and sound properties, so for these two flags doesFlagEffectApply equals hasFlag), `move.category === STATUS`. Suspected game bug (not fixed): userGrantsFlag is only asked about PUNCHING_MOVE (init-abilities.ts:740) and SLICING_MOVE (:2213), so what Reverberate (sound), Gunman (pulse) and the kicking part of Junshi Sanda, Mixed Martial Arts and Kyokushin grant is read by nothing; only the punching grants have an effect today. Oddity (not a bug): Junshi Sanda has two of these (punching moves also count as kicking, kicking moves also count as punching); there is no endless loop because both filters read the printed move flag, not the granted one. Only the two consumers in init-abilities.ts (Iron Fist family, Sharpness) call userGrantsFlag, so granting any other property (sound, pulse) has no effect today unless another ability asks for it.",
});
