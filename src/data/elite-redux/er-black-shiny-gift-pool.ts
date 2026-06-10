/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Black Shiny ability pool (#349) — DRAFT, NOT WIRED INTO GAMEPLAY.
//
// Result of the full 1033-ability audit (docs/design/black-shiny-gift-pool.md):
// ER ability ids that are broadly useful on almost any Pokémon, eligible to be
// rolled as a Black Shiny's 3 spawn abilities and offered in its switchable
// 5th "gift" slot (whose active pick is shared with on-field allies).
//
// ⚠️ PENDING MAINTAINER APPROVAL — the maintainer curates this list together
// with us before anything ships. Edit freely; keep the doc in sync.
// =============================================================================

/** Core pool: include unless the maintainer cuts them. ER ability ids. */
export const ER_BLACK_SHINY_POOL_CORE: readonly number[] = [
  // --- generic offense ---
  37, // Huge Power — doubles Atk
  74, // Pure Power — doubles SpAtk (clones: 301 Cryptic Power, 323 Majestic Bird)
  55, // Hustle
  91, // Adaptability
  287, // Mystic Power — all moves gain STAB
  494, // Arcane Force — all moves STAB + SE +10%
  110, // Tinted Lens
  233, // Neuroforce
  125, // Sheer Force
  148, // Analytic
  198, // Stakeout
  88, // Download
  424, // Equinox — weaker attack stat matches the higher
  86, // Simple
  153, // Moxie (KO clones: 264, 265, 533, 771, 858)
  454, // Adrenaline Rush — +1 Spe per KO
  220, // Soul-Heart
  224, // Beast Boost
  569, // Supreme Overlord (lighter clone: 888 Soul Harvest)
  201, // Berserk
  292, // Avenger
  640, // Rhythmic
  896, // Spyware
  // --- generic defense ---
  4, // Battle Armor (clones: 75, 753, 709)
  5, // Sturdy
  169, // Fur Coat — halves physical
  246, // Ice Scales — halves special (clones: 571, 870)
  296, // Lead Coat — the maintainer's calibration example
  539, // Chrome Coat — special Lead Coat
  393, // Arctic Fur — −35% both
  1021, // Aura Armor — −35% all
  705, // Terastal Treasure — −40% all, −20% Spe
  111, // Filter — −35% SE (clones: 116, 232, 317, 582, 712)
  318, // Primal Armor — −50% SE
  136, // Multiscale (clones: 231, 955)
  607, // Tera Shell
  98, // Magic Guard (clone: 326 Impenetrable)
  156, // Magic Bounce
  763, // Conjurer Of Deceit — Magic Guard + Magic Bounce
  109, // Unaware
  29, // Clear Body (clone: 230)
  240, // Mirror Armor
  634, // Last Stand
  192, // Stamina
  488, // Tipping Point
  519, // Fortitude
  83, // Anger Point
  427, // Cheating Death (lighter clone: 583 Gallantry)
  773, // Soothsayer
  671, // Bad Omen
  597, // Olé!
  1000, // Survivor Bias
  724, // Lucky Halo
  24, // Rough Skin (clones: 160, stronger: 574)
  214, // Queenly Majesty (clones: 219, 567)
  // --- sustain ---
  144, // Regenerator
  30, // Natural Cure (composite: 483)
  307, // Self Sufficient (composite: 415)
  991, // Resilience
  748, // Energy Siphon (lighter: 875)
  737, // Life Steal
  331, // Soul Eater (clones: 345, 363, 364)
  61, // Shed Skin
  // --- speed / tempo / entry ---
  3, // Speed Boost
  234, // Intrepid Sword
  235, // Dauntless Shield
  803, // Headstrong
  330, // Majestic Moth — +1 highest stat on entry
  22, // Intimidate
  329, // Scare
  632, // Terrify
  598, // Malicious
  677, // Petrify
  46, // Pressure
  53, // Pickup (ER) — hazard removal on entry
  350, // Violent Rush
  573, // Rapid Response
  557, // Readied Action
  435, // Ambush
  648, // On the Prowl
  370, // Opportunist
  259, // Quick Draw
  864, // Chuckster
  690, // Restraining Order
  1030, // Sleek Scales
  // --- accuracy / crit ---
  14, // Compound Eyes (lighter: 35, 51)
  99, // No Guard
  105, // Super Luck
  97, // Sniper (stronger: 806)
  340, // Fatal Precision (variants: 794, 921)
  828, // Overzealous — SE moves +1 priority
  815, // Overrule
  814, // Strategic Pause
  32, // Serene Grace
  104, // Mold Breaker
  // --- ally support (gift-slot stars) ---
  132, // Friend Guard
  217, // Battery
  249, // Power Spot
  672, // Mosh Pit
  990, // Polarity — party highest stat +30%
  162, // Victory Star
  140, // Telepathy
  131, // Healer (composite: 783 Caretaker)
  685, // Hospitality
  485, // Soothing Aroma
  165, // Aroma Veil
  175, // Sweet Veil
  595, // Noise Cancel
  562, // Costar
  // --- CC / utility ---
  576, // Good As Gold
  12, // Oblivious
  20, // Own Tempo
  39, // Inner Focus
  553, // Guard Dog
  242, // Stalwart
  547, // Purifying Salt
  855, // Hyper Cleanse
  19, // Shield Dust
  142, // Overcoat
  838, // Guardian Coat
  151, // Infiltrator
  128, // Defiant
  172, // Competitive
  605, // Contempt
  916, // Narcissist
  555, // Egoist
  556, // Subdue
  127, // Unnerve
];

/**
 * Borderline candidates — conditional, double-edged or synergy-dependent.
 * The maintainer promotes/demotes these (see the doc for the full reasoning).
 */
export const ER_BLACK_SHINY_POOL_BORDERLINE: readonly number[] = [
  126, // Contrary
  637, // Battle Aura
  577, // Sharing Is Caring
  62, // Guts
  63, // Marvel Scale
  95, // Quick Feet
  90, // Poison Heal
  196, // Merciless
  92, // Skill Link
  101, // Technician
  158, // Prankster
  205, // Triage
  288, // Perfectionist
  203, // Long Reach
  2, // Drizzle
  70, // Drought
  45, // Sand Stream
  117, // Snow Warning
  226, // Electro Surge
  227, // Psychic Surge
  228, // Misty Surge
  229, // Grassy Surge
  608, // Toxic Chain
  720, // Stun Shock
  691, // Assassin's Tools
  139, // Harvest
  247, // Ripen
  251, // Screen Cleaner
  402, // Toxic Debris
  405, // Loose Rocks
  532, // Permanence
  546, // Salt Circle
];
