/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 settlement APPLICATION (Task D2). The escrow server (D1) records the
// match outcome and stores per-uid MUTATION records; it can NEVER edit a save (opaque
// blobs). Honest clients FETCH those mutations (GET /showdown/pending, or the settle
// response of POST /showdown/result) and apply them HERE, then re-upload the system save.
//
// Every write runs inside `coopAllowAccountWrite("showdown-settlement", ...)` — the #807
// default-deny account-write gate. Settlement bit-surgery does not itself pass through the
// caught-registration chokepoint, but any nested unlock/candy write must be allowlisted, and
// wrapping the whole batch keeps the "no account write outside an allowlisted scope" invariant
// honest and future-proof.
//
// SERVER CAN'T READ SAVES → CLIENT DECIDES CANDY CONVERSION. The server always emits a
// `grantUnlock` for the winner; the CLIENT converts it to candy when the unlock is already
// owned (it alone can read the save). The candy amount is a documented cost-scaled formula.
// =============================================================================

import { coopAllowAccountWrite } from "#data/elite-redux/coop/coop-account-gate";
import { DexAttr } from "#enums/dex-attr";
import type { DexData, DexEntry } from "#types/dex-data";
import type { StarterData, StarterDataEntry } from "#types/save-data";

/**
 * A settlement mutation off the wire. Structurally mirrors the worker's
 * `SettlementMutation` (`workers/er-save-api/src/showdown-escrow.ts`) — the client
 * cannot import worker code, so the shape is re-declared. `grantCandy` is accepted
 * for completeness but the server currently only ever emits remove/grantUnlock.
 */
export type ShowdownSettlementMutation =
  | { kind: "removeUnlock"; speciesId: number; shiny: boolean; variant: number; erBlackShiny: boolean; cost: number }
  | { kind: "grantUnlock"; speciesId: number; shiny: boolean; variant: number; erBlackShiny: boolean; cost: number }
  | { kind: "grantCandy"; speciesId: number; candy: number };

/**
 * The structural subset of `GameData` settlement touches. The real `GameData`
 * satisfies it; tests pass a light stub with real `dexData`/`starterData` shapes.
 */
export interface SettlementGameData {
  dexData: DexData;
  starterData: StarterData;
  getRootStarterSpeciesId(speciesId: number): number;
  getStarterDataEntry(speciesId: number): StarterDataEntry;
  addStarterCandy(speciesId: number, count: number): boolean;
  /** Push the system save (dex/starter unlocks) to local + cloud. Optional so the stub can omit it. */
  saveSystem?(forceSync?: boolean): Promise<boolean>;
}

/** The higher shiny-tier dex bit for a stake variant (0 = base variant — never a shiny-only bit). */
function shinyVariantBit(variant: number): bigint {
  if (variant === 2) {
    return DexAttr.VARIANT_3;
  }
  if (variant === 1) {
    return DexAttr.VARIANT_2;
  }
  // variant 0 maps to DEFAULT_VARIANT, which is ALSO the base-form variant bit and must
  // never be cleared on its own — the shiny-ness of a variant-0 stake is the SHINY bit alone.
  return 0n;
}

/**
 * Candy awarded when the winner ALREADY owns the granted unlock (client-side
 * conversion). DOCUMENTED cost-scaled formula (a stake's rough collection value):
 *   - ER black shiny:  100 candy (top tier)
 *   - shiny:           40 + variant*20  → 40 / 60 / 80 (v0 / v1 / v2)
 *   - non-shiny line:  max(10, cost*8)  → cost 1 ⇒ 10 … cost 9 ⇒ 72
 * Tuned so a shiny is worth clearly more than a mid-cost line and a black shiny tops all.
 */
export function settlementCandyAmount(stake: {
  shiny: boolean;
  variant: number;
  erBlackShiny: boolean;
  cost: number;
}): number {
  if (stake.erBlackShiny) {
    return 100;
  }
  if (stake.shiny) {
    return 40 + stake.variant * 20;
  }
  return Math.max(10, stake.cost * 8);
}

/** The base "species caught" attribute bundle (a freshly-caught default form, non-shiny). */
const BASE_CAUGHT_ATTR =
  DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.FEMALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;

/** True when this dex entry already owns the shiny variant the stake describes. */
function ownsShinyVariant(entry: DexEntry, variant: number): boolean {
  if (!(entry.caughtAttr & DexAttr.SHINY)) {
    return false;
  }
  const bit = shinyVariantBit(variant);
  // variant 0 shiny is owned iff SHINY is set (its variant bit is the always-present base bit).
  return bit === 0n ? true : (entry.caughtAttr & bit) !== 0n;
}

function applyRemoveUnlock(gameData: SettlementGameData, mut: ShowdownSettlementMutation & { kind: "removeUnlock" }) {
  const rootId = gameData.getRootStarterSpeciesId(mut.speciesId);
  const entry = gameData.dexData[rootId];
  if (!entry) {
    return;
  }
  if (mut.shiny || mut.erBlackShiny) {
    // Shiny stake: strip the SHINY flag + this variant's higher bit. NEVER clears
    // DEFAULT_VARIANT / the base caught bits, so the underlying species stays unlocked.
    let mask = DexAttr.SHINY | shinyVariantBit(mut.variant);
    if (mut.erBlackShiny) {
      mask |= DexAttr.VARIANT_3;
    }
    entry.caughtAttr &= ~mask;
    if (mut.erBlackShiny) {
      const starter = gameData.starterData[rootId];
      if (starter) {
        starter.erBlackShiny = false;
      }
    }
  } else {
    // Species stake: the whole line unlock is forfeited — clear caughtAttr + zero the
    // shared candy bucket (mirrors the er-redux-dex-redirect transfer idiom's reset).
    entry.caughtAttr = 0n;
    const starter = gameData.starterData[rootId];
    if (starter) {
      starter.candyCount = 0;
    }
  }
}

function applyGrantUnlock(gameData: SettlementGameData, mut: ShowdownSettlementMutation & { kind: "grantUnlock" }) {
  const rootId = gameData.getRootStarterSpeciesId(mut.speciesId);
  const entry = gameData.dexData[rootId];
  if (!entry) {
    return;
  }
  const alreadyOwned = mut.shiny || mut.erBlackShiny ? ownsShinyVariant(entry, mut.variant) : entry.caughtAttr !== 0n;
  if (alreadyOwned) {
    // Already owned → candy conversion (the client decides this; the server can't read saves).
    gameData.addStarterCandy(rootId, settlementCandyAmount(mut));
    return;
  }
  // Seed the starter entry if this line has none yet, then OR the unlock bits in.
  gameData.getStarterDataEntry(rootId);
  let bits = BASE_CAUGHT_ATTR; // seed the base species so a shiny grant also unlocks the line
  if (mut.shiny || mut.erBlackShiny) {
    bits |= DexAttr.SHINY | shinyVariantBit(mut.variant);
  }
  if (mut.erBlackShiny) {
    bits |= DexAttr.VARIANT_3;
    const starter = gameData.starterData[rootId];
    if (starter) {
      starter.erBlackShiny = true;
    }
  }
  entry.caughtAttr |= bits;
  entry.seenAttr |= bits;
}

/**
 * Apply a batch of settlement mutations to `gameData` and push the system save.
 * Wrapped in the account-write allowlist scope; returns the count applied.
 */
export function applySettlementMutations(
  mutations: ShowdownSettlementMutation[],
  gameData: SettlementGameData,
): number {
  if (!Array.isArray(mutations) || mutations.length === 0) {
    return 0;
  }
  const applied = coopAllowAccountWrite("showdown-settlement", () => {
    let n = 0;
    for (const mut of mutations) {
      switch (mut.kind) {
        case "removeUnlock":
          applyRemoveUnlock(gameData, mut);
          n++;
          break;
        case "grantUnlock":
          applyGrantUnlock(gameData, mut);
          n++;
          break;
        case "grantCandy":
          gameData.addStarterCandy(gameData.getRootStarterSpeciesId(mut.speciesId), mut.candy);
          n++;
          break;
      }
    }
    return n;
  });
  if (applied > 0) {
    // Persist the changed unlocks (local + cloud). Fire-and-forget: a failed push is
    // re-attempted on the next save; settlement is idempotent server-side (acked rows).
    void gameData.saveSystem?.(true);
  }
  return applied;
}
