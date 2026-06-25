/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Redux-form dex registration redirect (#410).
//
// Redux variants exist TWICE in this port:
//   - in battle/runs as a regional-style FORM on the vanilla species
//     (formKey "redux" on SPEAROW, PANSEAR, DRILBUR, ...), and
//   - in the collection as their own RDX custom species (id >= 10000,
//     "Spearow Redux", ...) - the entries eggs hatch and the RDX tab lists.
//
// Catching a redux-form mon used to stamp the VANILLA species' dex entry, so
// the gen 1 slot showed up "caught" as Redux (with vanilla candy/cost) while
// the real RDX entry stayed empty until an egg filled it - the live "Spearow
// Redux replaced gen 1 Spearow's location" report. The RDX custom species is
// the canonical collection home:
//   - NEW catches/hatches of a vanilla mon wearing the redux form register the
//     matching RDX custom species instead (see GameData.setPokemonCaught).
//   - On save load, ALREADY-hijacked vanilla entries are migrated: the redux
//     unlock (shiny/variant/gender bits) is copied onto the RDX counterpart
//     (and its line root), then the redux form bit is removed from the vanilla
//     entry. If redux was the ONLY caught form, the vanilla entry reverts to
//     uncaught and its candies move to the RDX root - nothing is lost, the
//     gen slot just shows vanilla again.
//
// SAVE SAFETY: the migration is exception-guarded, idempotent (keyed on the
// redux form bit, which it removes after copying) and never deletes entries -
// it only moves the one wrongly-placed unlock to where it belongs.
// =============================================================================

import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { allSpecies } from "#data/data-lists";
import { enSpeciesName } from "#data/elite-redux/er-canonical-names";
import { DexAttr } from "#enums/dex-attr";
import type { SpeciesId } from "#enums/species-id";
import type { GameData } from "#system/game-data";

const VANILLA_ID_CUTOFF = 10000;
/** Bits below DEFAULT_FORM: gender + shiny + variant. */
const NON_FORM_BITS = 127n;
const ER_REDUX_FORM_KEY = "redux";

/** Lazily-built map: vanilla speciesId (with a bridged redux form) -> [reduxFormIndex, RDX counterpart id]. */
let reduxCounterparts: ReadonlyMap<number, readonly [number, number]> | null = null;

function buildReduxCounterparts(): Map<number, readonly [number, number]> {
  const customByName = new Map<string, number>();
  for (const sp of allSpecies) {
    if (sp.speciesId >= VANILLA_ID_CUTOFF) {
      // #633: locale-INVARIANT (forced-English) key so co-op clients in any
      // language build the same redux-counterpart map (sp is a live PokemonSpecies).
      customByName.set(enSpeciesName(sp).toLowerCase(), sp.speciesId);
    }
  }
  const map = new Map<number, readonly [number, number]>();
  for (const sp of allSpecies) {
    if (sp.speciesId >= VANILLA_ID_CUTOFF || !sp.forms?.length) {
      continue;
    }
    const reduxFormIndex = sp.forms.findIndex(f => f.formKey === ER_REDUX_FORM_KEY);
    if (reduxFormIndex < 0) {
      continue;
    }
    const counterpartId = customByName.get(`${enSpeciesName(sp).toLowerCase()} redux`);
    if (counterpartId !== undefined) {
      map.set(sp.speciesId, [reduxFormIndex, counterpartId]);
    }
  }
  return map;
}

/**
 * The RDX custom species that owns a vanilla mon's redux-form collection entry,
 * or `undefined` when the species/form has no registered counterpart (then the
 * legacy vanilla registration stands - better than dropping the unlock).
 */
export function getErReduxCounterpartId(speciesId: number, formKey: string): SpeciesId | undefined {
  if (speciesId >= VANILLA_ID_CUTOFF || formKey !== ER_REDUX_FORM_KEY) {
    return;
  }
  if (reduxCounterparts === null) {
    reduxCounterparts = buildReduxCounterparts();
  }
  return reduxCounterparts.get(speciesId)?.[1] as SpeciesId | undefined;
}

function rootOf(speciesId: number): number {
  let cur = speciesId;
  let guard = 0;
  while (pokemonPrevolutions[cur as SpeciesId] !== undefined && guard++ < 10) {
    cur = pokemonPrevolutions[cur as SpeciesId] as unknown as number;
  }
  return cur;
}

/**
 * Move already-hijacked redux unlocks from vanilla dex entries to their RDX
 * counterparts. Runs on every system-data load (idempotent), after
 * `migrateErRemovedFormUnlocks`.
 */
export function migrateErReduxDexHijack(gameData: GameData): void {
  try {
    if (reduxCounterparts === null) {
      reduxCounterparts = buildReduxCounterparts();
    }
    for (const [vanillaId, [reduxFormIndex, counterpartId]] of reduxCounterparts) {
      const source = gameData.dexData[vanillaId];
      const reduxFormBit = DexAttr.DEFAULT_FORM << BigInt(reduxFormIndex);
      if (!source || !(source.caughtAttr & reduxFormBit)) {
        continue;
      }
      // Copy the unlock onto the counterpart and every stage down to its root
      // (so the RDX starter slot unlocks even when an evolved stage was caught).
      const movedBits = (source.caughtAttr & NON_FORM_BITS) | DexAttr.DEFAULT_FORM;
      let dest = counterpartId as number;
      let guard = 0;
      while (guard++ < 10) {
        const destEntry = gameData.dexData[dest];
        if (destEntry) {
          destEntry.caughtAttr |= movedBits;
          destEntry.seenAttr |= movedBits;
          destEntry.natureAttr |= source.natureAttr;
        }
        const prev = pokemonPrevolutions[dest as SpeciesId];
        if (prev === undefined) {
          break;
        }
        dest = prev as unknown as number;
      }
      // Remove the redux form bit from the vanilla entry.
      source.caughtAttr &= ~reduxFormBit;
      source.seenAttr &= ~reduxFormBit;
      // Redux was the ONLY caught form: the vanilla slot reverts to uncaught
      // and (for line roots) its candies/black-shiny move to the RDX root.
      const FORM_BITS = ~NON_FORM_BITS;
      if ((source.caughtAttr & FORM_BITS) === 0n) {
        source.caughtAttr = 0n;
        if (rootOf(vanillaId) === vanillaId) {
          const sourceStarter = gameData.starterData[vanillaId];
          const destStarter = gameData.starterData[rootOf(counterpartId)];
          if (sourceStarter && destStarter) {
            destStarter.candyCount += sourceStarter.candyCount ?? 0;
            sourceStarter.candyCount = 0;
            destStarter.abilityAttr |= sourceStarter.abilityAttr ?? 0;
            if (sourceStarter.erBlackShiny) {
              destStarter.erBlackShiny = true;
              sourceStarter.erBlackShiny = false;
            }
          }
        }
      }
    }
  } catch (err) {
    // Migration must NEVER break a save load.
    console.error("[er-redux-dex-redirect] hijack migration failed:", err);
  }
}
