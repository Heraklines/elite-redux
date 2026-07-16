/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Type-nativization project (Pass A) new ability ids.
//
// The type-nativization sweep removes the "add a type on entry" abilities from
// their holders (the type is granted natively instead, via the N-type
// `setExtraTypes` model) and replaces the vacated slot with a per-mon ability.
// Several of those replacements are brand-new abilities built for this project.
//
// They continue the manual ER-custom id range after the newcomer-patch
// composites (which end at 5954 — see composite-newcomers.ts). Ids 5955-5967:
//
//   Composites (registered in MANUAL_COMPOSITE_PARTS, composite-newcomers.ts):
//     5955 Waterborne     = Hydrate + Adaptability
//     5956 Dragonfruit    = Draconize + Rough Skin
//     5957 Komodo         = Draconize + Envenom
//     5958 Voltron        = Steely Spirit + Battle Armor
//     5959 Grievous Spear = Grim Jab + Savage Spear
//     5960 Spectacle      = Levitate + Illuminate
//     5961 Ominous Shroud = Shadow Shield + Foggy Eye
//     5962 Free Climb     = Unburden + Hyper Aggressive
//
//   Bespokes (wired from existing attr primitives in
//   init-elite-redux-custom-abilities.ts `buildCustomAbility`):
//     5963 Savage Spear   — Horn moves hit twice (1st 100%, 2nd 40%).
//     5964 Grim Jab       — Normal-type Drill moves become Ghost, 1.2x power.
//     5965 Alluring Skull — draws in + is immune to Ghost moves and raises the
//                           holder's higher attacking stat by 1 (Lightning-Rod
//                           for Ghost).
//     5966 Formless Fist  — Punching moves hit twice (1st 100%, 2nd 40%) and use
//                           the holder's higher attacking stat.
//     5967 Prickly Armor  — Sharp Edge (1/6 HP to attackers on contact) + takes
//                           10% less damage from attacks.
// =============================================================================

// --- Composite ability ids (see MANUAL_COMPOSITE_PARTS) ---------------------
export const ER_WATERBORNE_ABILITY_ID = 5955;
export const ER_DRAGONFRUIT_ABILITY_ID = 5956;
export const ER_KOMODO_NATIVIZE_ABILITY_ID = 5957;
export const ER_VOLTRON_ABILITY_ID = 5958;
export const ER_GRIEVOUS_SPEAR_ABILITY_ID = 5959;
export const ER_SPECTACLE_ABILITY_ID = 5960;
export const ER_OMINOUS_SHROUD_ABILITY_ID = 5961;
export const ER_FREE_CLIMB_ABILITY_ID = 5962;

// --- Bespoke ability ids (wired in buildCustomAbility) ----------------------
export const ER_SAVAGE_SPEAR_ABILITY_ID = 5963;
export const ER_GRIM_JAB_ABILITY_ID = 5964;
export const ER_ALLURING_SKULL_ABILITY_ID = 5965;
export const ER_FORMLESS_FIST_ABILITY_ID = 5966;
export const ER_PRICKLY_ARMOR_ABILITY_ID = 5967;

/** The per-hit power multiplier applied to the extra strike of the twice-hit
 * abilities (Savage Spear, Formless Fist): 1st strike 100%, 2nd strike 40%. */
export const TWICE_HIT_SECOND_STRIKE_MULTIPLIER = 0.4;

/** Grim Jab's power boost on converted Drill moves. */
export const GRIM_JAB_POWER_MULTIPLIER = 1.2;

/** Prickly Armor's flat damage reduction (takes 10% less from attacks). */
export const PRICKLY_ARMOR_DAMAGE_REDUCTION = 0.1;

/** Prickly Armor's contact-punish divisor: attackers take 1/6 max HP (Sharp Edge). */
export const PRICKLY_ARMOR_CONTACT_DIVISOR = 6;
