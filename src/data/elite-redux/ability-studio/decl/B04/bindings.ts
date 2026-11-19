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

// ---- Chunk 3: the Grass-type closures of Flower Veil (id 166) and Jungle's Guard (id 5194) -------------------------------
// Three closures per ability, all built on `target.isOfType(PokemonType.GRASS, true, true)`. The third argument
// (returnOriginalTypesIfStellar = true) means a Stellar Tera Pokemon still counts with its ORIGINAL types, which the library
// atom `mon.has-type` (it calls `isOfType(type)`, third argument false) does not do, so it is not the same predicate. The
// status closure also needs `!!source && target.id !== source.id`: no atom reads the Pokemon that caused the status (the
// frame's `other` is the target). Both are requested in requests/B04.md.
// Jungle's Guard is an Elite Redux id (src/enums/er-ability-id.ts: JUNGLE_S_GUARD), which AbilityId does not list.
const JUNGLES_GUARD = 5194;
const GRASS_TYPE_REASON =
  "The closure is `target.isOfType(GRASS, true, true)`: the library type atom calls isOfType without the third argument, so a Stellar Tera Pokemon would stop counting as Grass; an atom that keeps the original types is requested in requests/B04.md.";
const GRASS_AND_SOURCE_REASON =
  "The closure is `!!source && target.id !== source.id && target.isOfType(GRASS, true, true)`: it needs a type atom that keeps the original types of a Stellar Tera Pokemon and an atom for 'another Pokemon caused the status' (the frame has no slot for the source); both are requested in requests/B04.md.";

// ConditionalUserFieldStatusEffectImmunityAbAttr (attr 0): `(target, source) => ...`
bindLegacyClosure(AbilityId.FLOWER_VEIL, 0, GRASS_AND_SOURCE_REASON, "ctor:0");
bindLegacyClosure(JUNGLES_GUARD, 0, GRASS_AND_SOURCE_REASON, "ctor:0");
// ConditionalUserFieldBattlerTagImmunityAbAttr (attr 1): `target => target.isOfType(GRASS, true, true)`
bindLegacyClosure(AbilityId.FLOWER_VEIL, 1, GRASS_TYPE_REASON, "ctor:0");
bindLegacyClosure(JUNGLES_GUARD, 1, GRASS_TYPE_REASON, "ctor:0");
// ConditionalUserFieldProtectStatAbAttr (attr 2): `target => target.isOfType(GRASS, true, true)`
bindLegacyClosure(AbilityId.FLOWER_VEIL, 2, GRASS_TYPE_REASON, "ctor:0");
bindLegacyClosure(JUNGLES_GUARD, 2, GRASS_TYPE_REASON, "ctor:0");
