/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 / #542 - The Import Bazaar. An ISLAND-biome MARKET event. A bustling
// island bazaar trades in imported held items and supplies. REWORKED (#542): it
// now opens a REAL paid SHOP screen (ImportBazaarShopPhase, the full-screen 4x4
// browse-and-buy UI) like the Black Market / Exotic Trader - not a free pick-one
// reward screen. Browse the stalls and spend your money on what you actually need.
// =============================================================================

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import {
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";

const namespace = "mysteryEncounters/importBazaar";

export const ImportBazaarEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ER_IMPORT_BAZAAR,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    // A traveling gift-bearer running the import stall (Delibird).
    { species: SpeciesId.DELIBIRD, spriteKey: "", fileRoot: "", hasShadow: true, repeat: true, y: 5 },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    // Browse the imports - pick one from a curated held-item selection.
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withOptionPhase(async () => {
        // Open the real bazaar SHOP screen (ImportBazaarShopPhase: imported held
        // items + supplies at fair prices). Launched via the doEncounterRewards
        // hook so it runs as a real phase BEFORE the post-encounter continuation -
        // a full browse-and-buy market, not a free reward screen.
        //
        // Co-op (#832, audit P1#5): HOST-ONLY (the authoritative guest diverts into
        // CoopReplayMePhase and never runs this callback), intentionally - the guest opens
        // its OWN BiomeShopPhase watcher off the host's streamed stock (reroll 777) via the
        // #821 handoff routed through openGuestMeEmbeddedShop (coop-biome-shop.ts), keying off
        // the host ACTUALLY opening the shop. See exotic-trader-encounter.ts for the full note.
        globalScene.currentBattle.mysteryEncounter!.doEncounterRewards = () => {
          globalScene.phaseManager.unshiftNew("ImportBazaarShopPhase");
          return true;
        };
        await transitionMysteryEncounterIntroVisuals(true, true);
        leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
        return true;
      })
      .build(),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [{ text: `${namespace}:option.2.selected` }],
    },
    async () => {
      // Move on without buying - no cost.
      await transitionMysteryEncounterIntroVisuals(true, true);
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
