/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 instance bindings (spec 2.1), keyed by (abilityId, attrIndex, slot).
//
// Seven of the eight classes of chunk 1 have no constructor closure and no Tier B gate, so they need no binding: every
// user is fully described by its declaration (and, for PreLeaveFieldClearWeatherAbAttr, by the `weather` setting that
// is read back from the live instance). The one closure of the chunk is Zero to Hero's form picker.
import { bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";
import { AbilityId } from "#enums/ability-id";

// PreSwitchOutFormChangeAbAttr, Zero to Hero (attr 3): `pokemon => (pokemon.isFainted() ? pokemon.formIndex : 1)`.
// The closure returns a form NUMBER that canApply compares with `pokemon.formIndex`; it is not a yes/no, so no library
// atom (and no `ctor:0` boolean slot) can stand for it. Needs `mon.fainted`, `mon.form-index` and a Tier B gate split
// (requests/B04.md).
bindLegacyClosure(
  AbilityId.ZERO_TO_HERO,
  3,
  "The closure returns a form number (fainted: stay in the current form, otherwise form 1), not a yes/no; the library has no 'is fainted' or 'form number' atom and canApply is not yet split into a gate (requests/B04.md).",
  "ctor:0",
);
