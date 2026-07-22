/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Newcomer BATCH 2 bespoke + placeholder abilities.
//
// Two shapes live here (both continue the manual 5900-range numbering, above the
// batch-1 newcomer band which ends at 5974 in composite-newcomers.ts):
//
//   1. Spirit Punch (5975) — a FULLY-SPEC'd bespoke: "an Iron Fist version of
//      Mystic Blades". Mystic Blades (er505) makes SLICING moves become SPECIAL
//      and deal 30% more damage; Spirit Punch applies that exact mechanic to
//      PUNCHING moves (the Iron Fist scope). Its attrs are attached in
//      `buildCustomAbility` (init-elite-redux-custom-abilities.ts) via the same
//      `FlagDamageBoostAbAttr` + `MoveCategoryOverrideAbAttr` pair Mystic Blades
//      uses, scoped to `MoveFlags.PUNCHING_MOVE`.
//
//   2. PARKED placeholders (5976-5989) — the 14 batch-2 ability NAMES the
//      designer listed that have NO definition anywhere (not in the ER 2.65 dump,
//      not spec'd inline, no near-match). Per the standing rule "implement nothing
//      invented", each is registered as a NAMED, battle-INERT ability (no attrs,
//      no dispatch) so the mon carries the correctly-named slot and renders on
//      every surface, but does nothing until the designer defines it. This mirrors
//      the batch-1 "Shattered Psyche (PARKED)" precedent. Every one is listed in
//      the FLAGS FOR DESIGNER section of the build report.
//
// NB: these are DELIBERATELY inert, not "nearest existing ability" substitutes —
// an inert slot with the RIGHT NAME is less misleading in-game than an unrelated
// working ability, and it is trivially replaced once the real mechanic lands
// (swap the placeholder's registration for a real draft/attr wire, same id).
// =============================================================================

/** Spirit Punch — bespoke (Iron Fist scope of Mystic Blades). */
export const ER_SPIRIT_PUNCH_ABILITY_ID = 5975;

// PARKED placeholders (no design yet — see report FLAGS section).
export const ER_METEOR_MASS_ABILITY_ID = 5976; // Metagross Battle Bond innate
export const ER_BOOT_HILL_ABILITY_ID = 5977; // Dustnoir/Drawclops active
export const ER_VAPOR_BODY_ABILITY_ID = 5978; // Nimbeon innate
export const ER_ECLIPSE_WING_ABILITY_ID = 5979; // Yveltal Mega Z innate
export const ER_GLAM_ROCK_ABILITY_ID = 5980; // Twinkletuff active
export const ER_SEDIMENT_BLOOM_ABILITY_ID = 5981; // Twinkletuff innate
export const ER_SKYHOOK_ABILITY_ID = 5982; // Ryuveon innate
export const ER_INVERSE_ROOM_ABILITY_ID = 5983; // Egoelk active
export const ER_REDUCTION_ABILITY_ID = 5984; // Forbiddron active
export const ER_CRACK_THE_VESSEL_ABILITY_ID = 5985; // Forbiddron innate
export const ER_SETLIST_ABILITY_ID = 5986; // Idolfin innate
export const ER_ANNEAL_ABILITY_ID = 5987; // Titaneon innate
export const ER_LIVING_CHROME_ABILITY_ID = 5988; // Titaneon innate
export const ER_RING_GENERAL_ABILITY_ID = 5989; // Webbed Bruiser innate

/** A parked placeholder's registration draft (name + inert description). */
export interface Batch2PlaceholderDef {
  readonly id: number;
  readonly name: string;
  readonly description: string;
}

/**
 * The 14 parked placeholders. `description` is deliberately explicit so testers
 * and the maintainer see the slot is pending — NOT a real effect.
 */
export const ER_BATCH2_PLACEHOLDER_ABILITIES: readonly Batch2PlaceholderDef[] = [
  { id: ER_METEOR_MASS_ABILITY_ID, name: "Meteor Mass", description: "Signature ability (definition pending)." },
  { id: ER_BOOT_HILL_ABILITY_ID, name: "Boot Hill", description: "Signature ability (definition pending)." },
  { id: ER_VAPOR_BODY_ABILITY_ID, name: "Vapor Body", description: "Signature ability (definition pending)." },
  { id: ER_ECLIPSE_WING_ABILITY_ID, name: "Eclipse Wing", description: "Signature ability (definition pending)." },
  { id: ER_GLAM_ROCK_ABILITY_ID, name: "Glam Rock", description: "Signature ability (definition pending)." },
  { id: ER_SEDIMENT_BLOOM_ABILITY_ID, name: "Sediment Bloom", description: "Signature ability (definition pending)." },
  { id: ER_SKYHOOK_ABILITY_ID, name: "Skyhook", description: "Signature ability (definition pending)." },
  { id: ER_INVERSE_ROOM_ABILITY_ID, name: "Inverse Room", description: "Signature ability (definition pending)." },
  { id: ER_REDUCTION_ABILITY_ID, name: "Reduction", description: "Signature ability (definition pending)." },
  {
    id: ER_CRACK_THE_VESSEL_ABILITY_ID,
    name: "Crack the Vessel",
    description: "Signature ability (definition pending).",
  },
  { id: ER_SETLIST_ABILITY_ID, name: "Setlist", description: "Signature ability (definition pending)." },
  { id: ER_ANNEAL_ABILITY_ID, name: "Anneal", description: "Signature ability (definition pending)." },
  { id: ER_LIVING_CHROME_ABILITY_ID, name: "Living Chrome", description: "Signature ability (definition pending)." },
  { id: ER_RING_GENERAL_ABILITY_ID, name: "Ring General", description: "Signature ability (definition pending)." },
];

/** Spirit Punch's registration draft (attrs attached in buildCustomAbility). */
export const ER_SPIRIT_PUNCH_DRAFT = {
  id: ER_SPIRIT_PUNCH_ABILITY_ID,
  name: "Spirit Punch",
  description: "This Pokemon's punching moves become Special and deal 30% more damage.",
};
