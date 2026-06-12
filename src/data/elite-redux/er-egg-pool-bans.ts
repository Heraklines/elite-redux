/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - egg-pool/starter declutter ban list (#407).
//
// These ER-imported alternate-form species are removed from the egg-hatch pool
// AND from starter select, because they are either:
//   - battle-only forms that must never hatch (Busted Mimikyu, Gulping/Gorging
//     Cramorant, Sunshine Cherrim, weather Castforms, Zygarde Complete,
//     Xerneas Active), or
//   - duplicates of forms already reachable in vanilla pokerogue, as forms of
//     one species (Unown letters, Pikachu caps, Furfrou trims, Rotom
//     appliances, Paldean Tauros breeds, ...) or via vanilla form-change items
//     (Arceus plates, Silvally memories, Reveal Glass Therians, Ogerpon masks,
//     Genesect drives, Reins of Unity Calyrex riders, Gracidea Shaymin, DNA
//     splicer Kyurems), or
//   - pure cosmetics that bring nothing new (Deerling seasons, Flabebe colors,
//     Shellos East, Spiky-eared Pichu, ...).
// Unown Revelation is removed too (maintainer call): vanilla Unown carries the
// schooling ability, so the mechanic stays reachable on the one true Unown.
// Kept on purpose: Ash-Greninja + Clemont-Chesnaught + Serena-Delphox (the
// Kalos fusion trio) and the Grotom family.
//
// SAVE SAFETY (maintainer: "make sure you dont break saves"):
//   - The species themselves stay REGISTERED in allSpecies - existing runs,
//     parties, ghost teams, pending eggs and dex entries keep resolving.
//   - Nothing is deleted from save data. Removal only touches the RUNTIME
//     speciesEggTiers / speciesStarterCosts tables (rebuilt every boot).
//   - Player progress on a removed form is COMPRESSED onto its still-reachable
//     vanilla base on save load (see migrateErRemovedFormUnlocks): shiny /
//     variant / seen / caught dex bits and the ER black-shiny flag are OR-ed
//     onto the base species and its root (idempotent), and candies are added
//     over once (guarded by an erBanMigrated flag on the source entry).
//     A red-shiny Unown letter therefore becomes a red-shiny vanilla Unown.
// =============================================================================

import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { allSpecies } from "#data/data-lists";
import type { EggTier } from "#enums/egg-type";
import { SpeciesId } from "#enums/species-id";
import type { GameData } from "#system/game-data";

const VANILLA_ID_CUTOFF = 10000;

/** [removed ER custom display name, vanilla species that absorbs its unlocks]. */
export const ER_REMOVED_EGG_FORMS: ReadonlyArray<readonly [string, SpeciesId]> = [
  ["Arceus Bug", SpeciesId.ARCEUS],
  ["Arceus Dark", SpeciesId.ARCEUS],
  ["Arceus Dragon", SpeciesId.ARCEUS],
  ["Arceus Electric", SpeciesId.ARCEUS],
  ["Arceus Fairy", SpeciesId.ARCEUS],
  ["Arceus Fighting", SpeciesId.ARCEUS],
  ["Arceus Fire", SpeciesId.ARCEUS],
  ["Arceus Flying", SpeciesId.ARCEUS],
  ["Arceus Ghost", SpeciesId.ARCEUS],
  ["Arceus Grass", SpeciesId.ARCEUS],
  ["Arceus Ground", SpeciesId.ARCEUS],
  ["Arceus Ice", SpeciesId.ARCEUS],
  ["Arceus Poison", SpeciesId.ARCEUS],
  ["Arceus Psychic", SpeciesId.ARCEUS],
  ["Arceus Rock", SpeciesId.ARCEUS],
  ["Arceus Steel", SpeciesId.ARCEUS],
  ["Arceus Water", SpeciesId.ARCEUS],
  ["Basculin Blue", SpeciesId.BASCULIN],
  ["Basculin White", SpeciesId.BASCULIN],
  ["Burmy Sandy", SpeciesId.BURMY],
  ["Burmy Trash", SpeciesId.BURMY],
  ["Calyrex Ice Rider", SpeciesId.CALYREX],
  ["Calyrex Shadow Rider", SpeciesId.CALYREX],
  ["Castform Foggy", SpeciesId.CASTFORM],
  ["Castform Rainy", SpeciesId.CASTFORM],
  ["Castform Sandy", SpeciesId.CASTFORM],
  ["Castform Snowy", SpeciesId.CASTFORM],
  ["Castform Sunny", SpeciesId.CASTFORM],
  ["Cherrim Sunshine", SpeciesId.CHERRIM],
  ["Cramorant Gorging", SpeciesId.CRAMORANT],
  ["Cramorant Gulping", SpeciesId.CRAMORANT],
  ["Deerling Autumn", SpeciesId.DEERLING],
  ["Deerling Summer", SpeciesId.DEERLING],
  ["Deerling Winter", SpeciesId.DEERLING],
  ["Deoxys Attack", SpeciesId.DEOXYS],
  ["Deoxys Defense", SpeciesId.DEOXYS],
  ["Deoxys Speed", SpeciesId.DEOXYS],
  ["Eevee Partner", SpeciesId.EEVEE],
  ["Enamorus Therian", SpeciesId.ENAMORUS],
  ["Flabebe Blue", SpeciesId.FLABEBE],
  ["Flabebe Orange", SpeciesId.FLABEBE],
  ["Flabebe White", SpeciesId.FLABEBE],
  ["Flabebe Yellow", SpeciesId.FLABEBE],
  ["Floette Eternal Flower", SpeciesId.FLOETTE],
  ["Furfrou Dandy", SpeciesId.FURFROU],
  ["Furfrou Debutante", SpeciesId.FURFROU],
  ["Furfrou Diamond", SpeciesId.FURFROU],
  ["Furfrou Heart", SpeciesId.FURFROU],
  ["Furfrou Kabuki", SpeciesId.FURFROU],
  ["Furfrou La Reine", SpeciesId.FURFROU],
  ["Furfrou Matron", SpeciesId.FURFROU],
  ["Furfrou Pharaoh", SpeciesId.FURFROU],
  ["Furfrou Star", SpeciesId.FURFROU],
  ["Genesect Burn Drive", SpeciesId.GENESECT],
  ["Genesect Chill Drive", SpeciesId.GENESECT],
  ["Genesect Douse Drive", SpeciesId.GENESECT],
  ["Genesect Shock Drive", SpeciesId.GENESECT],
  ["Gimmighoul Roaming", SpeciesId.GIMMIGHOUL],
  ["Indeedee Female", SpeciesId.INDEEDEE],
  ["Keldeo Resolute", SpeciesId.KELDEO],
  ["Kyurem Black", SpeciesId.KYUREM],
  ["Kyurem White", SpeciesId.KYUREM],
  ["Landorus Therian", SpeciesId.LANDORUS],
  ["Magearna Original", SpeciesId.MAGEARNA],
  ["Meowth Partner", SpeciesId.MEOWTH],
  ["Mimikyu Apex Busted", SpeciesId.MIMIKYU],
  ["Mimikyu Busted", SpeciesId.MIMIKYU],
  ["Ogerpon Cornerstone", SpeciesId.OGERPON],
  ["Ogerpon Hearthflame", SpeciesId.OGERPON],
  ["Ogerpon Wellspring Mask", SpeciesId.OGERPON],
  ["Oricorio Pau", SpeciesId.ORICORIO],
  ["Oricorio Pom Pom", SpeciesId.ORICORIO],
  ["Oricorio Sensu", SpeciesId.ORICORIO],
  ["Pichu Spiky", SpeciesId.PICHU],
  ["Pikachu Alola", SpeciesId.PIKACHU],
  ["Pikachu Belle", SpeciesId.PIKACHU],
  ["Pikachu Cosplay", SpeciesId.PIKACHU],
  ["Pikachu Hoenn", SpeciesId.PIKACHU],
  ["Pikachu Kalos", SpeciesId.PIKACHU],
  ["Pikachu Kanto", SpeciesId.PIKACHU],
  ["Pikachu Libre", SpeciesId.PIKACHU],
  ["Pikachu Partner", SpeciesId.PIKACHU],
  ["Pikachu Partner Cap", SpeciesId.PIKACHU],
  ["Pikachu Ph D", SpeciesId.PIKACHU],
  ["Pikachu Pop Star", SpeciesId.PIKACHU],
  ["Pikachu Rock Star", SpeciesId.PIKACHU],
  ["Pikachu Sinnoh", SpeciesId.PIKACHU],
  ["Pikachu Unova", SpeciesId.PIKACHU],
  ["Pikachu World", SpeciesId.PIKACHU],
  ["Pumpkaboo Large", SpeciesId.PUMPKABOO],
  ["Pumpkaboo Small", SpeciesId.PUMPKABOO],
  ["Pumpkaboo Super", SpeciesId.PUMPKABOO],
  ["Rockruff Own Tempo", SpeciesId.ROCKRUFF],
  ["Rotom Fan", SpeciesId.ROTOM],
  ["Rotom Frost", SpeciesId.ROTOM],
  ["Rotom Heat", SpeciesId.ROTOM],
  ["Rotom Mow", SpeciesId.ROTOM],
  ["Rotom Wash", SpeciesId.ROTOM],
  ["Shaymin Sky", SpeciesId.SHAYMIN],
  ["Shellos East", SpeciesId.SHELLOS],
  ["Silvally Bug", SpeciesId.SILVALLY],
  ["Silvally Dark", SpeciesId.SILVALLY],
  ["Silvally Dragon", SpeciesId.SILVALLY],
  ["Silvally Electric", SpeciesId.SILVALLY],
  ["Silvally Fairy", SpeciesId.SILVALLY],
  ["Silvally Fighting", SpeciesId.SILVALLY],
  ["Silvally Fire", SpeciesId.SILVALLY],
  ["Silvally Flying", SpeciesId.SILVALLY],
  ["Silvally Ghost", SpeciesId.SILVALLY],
  ["Silvally Grass", SpeciesId.SILVALLY],
  ["Silvally Ground", SpeciesId.SILVALLY],
  ["Silvally Ice", SpeciesId.SILVALLY],
  ["Silvally Poison", SpeciesId.SILVALLY],
  ["Silvally Psychic", SpeciesId.SILVALLY],
  ["Silvally Rock", SpeciesId.SILVALLY],
  ["Silvally Steel", SpeciesId.SILVALLY],
  ["Silvally Water", SpeciesId.SILVALLY],
  ["Sinistea Antique", SpeciesId.SINISTEA],
  ["Tatsugiri Curly", SpeciesId.TATSUGIRI],
  ["Tatsugiri Droopy", SpeciesId.TATSUGIRI],
  ["Tatsugiri Stretchy", SpeciesId.TATSUGIRI],
  ["Tauros Paldean Aqua Breed", SpeciesId.PALDEA_TAUROS],
  ["Tauros Paldean Blaze Breed", SpeciesId.PALDEA_TAUROS],
  ["Tauros Paldean Combat Breed", SpeciesId.PALDEA_TAUROS],
  ["Thundurus Therian", SpeciesId.THUNDURUS],
  ["Tornadus Therian", SpeciesId.TORNADUS],
  ["Unown B", SpeciesId.UNOWN],
  ["Unown C", SpeciesId.UNOWN],
  ["Unown D", SpeciesId.UNOWN],
  ["Unown E", SpeciesId.UNOWN],
  ["Unown Emark", SpeciesId.UNOWN],
  ["Unown F", SpeciesId.UNOWN],
  ["Unown G", SpeciesId.UNOWN],
  ["Unown H", SpeciesId.UNOWN],
  ["Unown I", SpeciesId.UNOWN],
  ["Unown J", SpeciesId.UNOWN],
  ["Unown K", SpeciesId.UNOWN],
  ["Unown L", SpeciesId.UNOWN],
  ["Unown M", SpeciesId.UNOWN],
  ["Unown N", SpeciesId.UNOWN],
  ["Unown O", SpeciesId.UNOWN],
  ["Unown P", SpeciesId.UNOWN],
  ["Unown Q", SpeciesId.UNOWN],
  ["Unown Qmark", SpeciesId.UNOWN],
  ["Unown R", SpeciesId.UNOWN],
  ["Unown Revelation", SpeciesId.UNOWN],
  ["Unown S", SpeciesId.UNOWN],
  ["Unown T", SpeciesId.UNOWN],
  ["Unown U", SpeciesId.UNOWN],
  ["Unown V", SpeciesId.UNOWN],
  ["Unown W", SpeciesId.UNOWN],
  ["Unown X", SpeciesId.UNOWN],
  ["Unown Y", SpeciesId.UNOWN],
  ["Unown Z", SpeciesId.UNOWN],
  ["Ursaluna Bloodmoon", SpeciesId.BLOODMOON_URSALUNA],
  ["Xerneas Active", SpeciesId.XERNEAS],
  ["Zarude Dada", SpeciesId.ZARUDE],
  ["Zygarde 10", SpeciesId.ZYGARDE],
  ["Zygarde 10 Power Construct", SpeciesId.ZYGARDE],
  ["Zygarde 50 Power Construct", SpeciesId.ZYGARDE],
  ["Zygarde Complete", SpeciesId.ZYGARDE]
];

let removedIdTargets: ReadonlyMap<number, SpeciesId> | null = null;

/** Resolve the banned display names to live ER species ids (id >= 10000). */
export function getErRemovedFormIdTargets(): ReadonlyMap<number, SpeciesId> {
  if (removedIdTargets === null) {
    const byName = new Map<string, number>();
    for (const sp of allSpecies) {
      if (sp.speciesId >= VANILLA_ID_CUTOFF) {
        byName.set(sp.name, sp.speciesId);
      }
    }
    const map = new Map<number, SpeciesId>();
    for (const [name, target] of ER_REMOVED_EGG_FORMS) {
      const id = byName.get(name);
      if (id !== undefined) {
        map.set(id, target);
      }
    }
    removedIdTargets = map;
  }
  return removedIdTargets;
}

/**
 * Drop every banned form from the runtime egg-hatch + starter tables.
 * Called at the end of initEliteReduxEggTiers, every boot.
 */
export function applyErEggPoolBans(): number {
  const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
  const costs = speciesStarterCosts as Record<number, number | undefined>;
  let removed = 0;
  for (const id of getErRemovedFormIdTargets().keys()) {
    if (tiers[id] !== undefined || costs[id] !== undefined) {
      removed++;
    }
    delete tiers[id];
    delete costs[id];
  }
  return removed;
}

/**
 * Compress a removed form's player progress onto its vanilla base so nothing
 * is lost (red-shiny Unown letter -> red-shiny vanilla Unown). Runs on every
 * system-data load, AFTER dexData/starterData are applied. Purely additive:
 *   - dex caught/seen/nature bits and best IVs are OR-ed / maxed onto the
 *     vanilla target AND its root species (idempotent, safe to re-run).
 *   - starter candies/friendship move over ONCE (the source starter entry is
 *     flagged erBanMigrated; the flag round-trips through the save).
 *   - the ER black-shiny unlock flag carries over.
 * The source entries are never deleted - saves stay byte-compatible.
 */
export function migrateErRemovedFormUnlocks(gameData: GameData): void {
  try {
    for (const [removedId, targetId] of getErRemovedFormIdTargets()) {
      const source = gameData.dexData[removedId];
      if (!source || (!source.caughtAttr && !source.seenAttr)) {
        continue;
      }
      const rootId = rootOf(targetId);
      for (const destId of new Set([targetId, rootId])) {
        const dest = gameData.dexData[destId];
        if (!dest) {
          continue;
        }
        dest.caughtAttr |= source.caughtAttr;
        dest.seenAttr |= source.seenAttr;
        dest.natureAttr |= source.natureAttr;
        if (Array.isArray(source.ivs) && Array.isArray(dest.ivs)) {
          for (let i = 0; i < dest.ivs.length; i++) {
            dest.ivs[i] = Math.max(dest.ivs[i] ?? 0, source.ivs[i] ?? 0);
          }
        }
      }
      const sourceStarter = gameData.starterData[removedId] as
        | ((typeof gameData.starterData)[number] & { erBanMigrated?: boolean })
        | undefined;
      const destStarter = gameData.starterData[rootId];
      if (sourceStarter && destStarter) {
        if (sourceStarter.erBlackShiny) {
          destStarter.erBlackShiny = true;
        }
        if (!sourceStarter.erBanMigrated) {
          destStarter.candyCount += sourceStarter.candyCount ?? 0;
          destStarter.friendship = Math.max(destStarter.friendship ?? 0, sourceStarter.friendship ?? 0);
          sourceStarter.erBanMigrated = true;
        }
      }
    }
  } catch (err) {
    // Migration must NEVER break a save load.
    console.error("[er-egg-pool-bans] unlock migration failed:", err);
  }
}

function rootOf(speciesId: SpeciesId): SpeciesId {
  let cur = speciesId as number;
  let guard = 0;
  while (pokemonPrevolutions[cur as SpeciesId] !== undefined && guard++ < 10) {
    cur = pokemonPrevolutions[cur as SpeciesId] as unknown as number;
  }
  return cur as SpeciesId;
}
