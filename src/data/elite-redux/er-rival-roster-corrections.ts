/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER rival roster corrections (#340).
//
// The v2.65beta nextdex export ships STALE parties for the late rival stages:
// Route 119 / Lilycove carry a contest-gimmick team (Smeargle, Pop-Star /
// Rock-Star Pikachu, …) and Meteor Falls decodes to Pikachu Pop Star + Hisuian
// Sliggoo — none of which match the actual game. Worse, several of those
// species ids aren't in ER_ID_MAP at all, so the registered rosters silently
// shrank (the final rival fielded 4-mon leftovers padded with whatever).
//
// These are the REAL parties, extracted from the ER v2.65.3b decomp
// (vendor/elite-redux/source/src/data/trainer_parties.h, sParty_May*/Brendan*).
// All species are vanilla, so they're listed directly as pokerogue SpeciesId.
// Members get neutral defaults (perfect IVs, no fixed moves → level-up
// moveset), which is how the engine treats sparse ER rosters elsewhere.
//
// Applied at registry build time (init-elite-redux-trainers) to the DEFAULT
// party tier; these trainers ship no insane/hell tier upstream.
// =============================================================================

import { SpeciesId } from "#enums/species-id";

export const ER_RIVAL_ROSTER_CORRECTIONS: ReadonlyMap<string, readonly SpeciesId[]> = new Map([
  // ---- May (player picked Treecko → May runs the Torchic line) ----
  [
    "May Route 119 Treecko",
    [
      SpeciesId.SWELLOW,
      SpeciesId.STARMIE,
      SpeciesId.TSAREENA,
      SpeciesId.MIMIKYU,
      SpeciesId.VIKAVOLT,
      SpeciesId.BLAZIKEN,
    ],
  ],
  [
    "May Lilycove Treecko",
    [
      SpeciesId.VIKAVOLT,
      SpeciesId.SWELLOW,
      SpeciesId.STARMIE,
      SpeciesId.TSAREENA,
      SpeciesId.MIMIKYU,
      SpeciesId.BLAZIKEN,
    ],
  ],
  ["May Treecko Meteor Falls", [SpeciesId.BLAZIKEN, SpeciesId.STARMIE, SpeciesId.MIMIKYU]],
  // ---- May (player picked Mudkip → May runs the Treecko line) ----
  [
    "May Route 119 Mudkip",
    [
      SpeciesId.SWELLOW,
      SpeciesId.STARMIE,
      SpeciesId.RAPIDASH,
      SpeciesId.MIMIKYU,
      SpeciesId.VIKAVOLT,
      SpeciesId.SCEPTILE,
    ],
  ],
  [
    "May Lilycove Mudkip",
    [
      SpeciesId.VIKAVOLT,
      SpeciesId.SWELLOW,
      SpeciesId.STARMIE,
      SpeciesId.RAPIDASH,
      SpeciesId.MIMIKYU,
      SpeciesId.SCEPTILE,
    ],
  ],
  ["May Mudkip Meteor Falls", [SpeciesId.SCEPTILE, SpeciesId.RAPIDASH, SpeciesId.MIMIKYU]],
  // ---- May (player picked Torchic → May runs the Mudkip line) ----
  [
    "May Route 119 Torchic",
    [
      SpeciesId.SWELLOW,
      SpeciesId.RAPIDASH,
      SpeciesId.TSAREENA,
      SpeciesId.MIMIKYU,
      SpeciesId.VIKAVOLT,
      SpeciesId.SWAMPERT,
    ],
  ],
  [
    "May Lilycove Torchic",
    [
      SpeciesId.VIKAVOLT,
      SpeciesId.SWELLOW,
      SpeciesId.RAPIDASH,
      SpeciesId.TSAREENA,
      SpeciesId.MIMIKYU,
      SpeciesId.SWAMPERT,
    ],
  ],
  ["May Torchic Meteor Falls", [SpeciesId.MIMIKYU, SpeciesId.SWAMPERT, SpeciesId.RAPIDASH]],
  // ---- Brendan (player picked Treecko) ----
  [
    "Brendan Route 119 Treecko",
    [
      SpeciesId.ARAQUANID,
      SpeciesId.SWELLOW,
      SpeciesId.BRELOOM,
      SpeciesId.MIMIKYU,
      SpeciesId.VIKAVOLT,
      SpeciesId.BLAZIKEN,
    ],
  ],
  [
    "Brendan Lilycove Treecko",
    [
      SpeciesId.ARAQUANID,
      SpeciesId.SWELLOW,
      SpeciesId.BRELOOM,
      SpeciesId.MIMIKYU,
      SpeciesId.VIKAVOLT,
      SpeciesId.BLAZIKEN,
    ],
  ],
  ["Brendan Treecko Meteor Falls", [SpeciesId.BLAZIKEN, SpeciesId.ARAQUANID, SpeciesId.MIMIKYU]],
  // ---- Brendan (player picked Mudkip) ----
  [
    "Brendan Route 119 Mudkip",
    [
      SpeciesId.ARAQUANID,
      SpeciesId.SWELLOW,
      SpeciesId.ARCANINE,
      SpeciesId.MIMIKYU,
      SpeciesId.VIKAVOLT,
      SpeciesId.SCEPTILE,
    ],
  ],
  [
    "Brendan Lilycove Mudkip",
    [
      SpeciesId.ARAQUANID,
      SpeciesId.SWELLOW,
      SpeciesId.ARCANINE,
      SpeciesId.MIMIKYU,
      SpeciesId.VIKAVOLT,
      SpeciesId.SCEPTILE,
    ],
  ],
  ["Brendan Mudkip Meteor Falls", [SpeciesId.SCEPTILE, SpeciesId.ARCANINE, SpeciesId.MIMIKYU]],
  // ---- Brendan (player picked Torchic) ----
  [
    "Brendan Route 119 Torchic",
    [
      SpeciesId.SWELLOW,
      SpeciesId.ARCANINE,
      SpeciesId.BRELOOM,
      SpeciesId.MIMIKYU,
      SpeciesId.VIKAVOLT,
      SpeciesId.SWAMPERT,
    ],
  ],
  [
    "Brendan Lilycove Torchic",
    [
      SpeciesId.VIKAVOLT,
      SpeciesId.SWELLOW,
      SpeciesId.ARCANINE,
      SpeciesId.BRELOOM,
      SpeciesId.MIMIKYU,
      SpeciesId.SWAMPERT,
    ],
  ],
  ["Brendan Torchic Meteor Falls", [SpeciesId.SWAMPERT, SpeciesId.ARCANINE, SpeciesId.MIMIKYU]],
]);
