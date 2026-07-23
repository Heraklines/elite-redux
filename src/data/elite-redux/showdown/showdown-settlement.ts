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
import { grantErShinyLabSavedLookToSave } from "#data/elite-redux/er-shiny-lab-effects";
import { DexAttr } from "#enums/dex-attr";
import type { DexData, DexEntry } from "#types/dex-data";
import type { StarterData, StarterDataEntry } from "#types/save-data";

/**
 * A settlement mutation off the wire. Structurally mirrors the worker's
 * `SettlementMutation` (`workers/er-save-api/src/showdown-escrow.ts`) — the client
 * cannot import worker code, so the shape is re-declared. `grantCandy` is accepted
 * for completeness but the escrow server only ever emits remove/grantUnlock;
 * `grantCandy`/`grantShinyLabLook` are emitted by the TOURNAMENT reward path
 * (er-telemetry pushes them into the same settlement store).
 */
export type ShowdownSettlementMutation =
  | { kind: "removeUnlock"; speciesId: number; shiny: boolean; variant: number; erBlackShiny: boolean; cost: number }
  | { kind: "grantUnlock"; speciesId: number; shiny: boolean; variant: number; erBlackShiny: boolean; cost: number }
  | { kind: "grantCandy"; speciesId: number; candy: number }
  | { kind: "grantShinyLabLook"; speciesId: number; savedLook: number[] };

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
  /**
   * I2: the persisted applied-settlement ledger (showdown_settlements row ids already applied),
   * capped FIFO. `syncShowdownPendingSettlements` skips ids in it, so a re-fetch after an ack that
   * never landed can't double-apply. Persisted in the system save (back-compat optional there).
   */
  showdownAppliedSettlements: number[];
  /** Push the system save (dex/starter unlocks) to local + cloud. Optional so the stub can omit it. */
  saveSystem?(forceSync?: boolean): Promise<boolean>;
}

/** Cap on the persisted applied-settlement ledger (FIFO — the newest 200 ids are kept). */
export const SHOWDOWN_LEDGER_CAP = 200;

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

/** The unambiguous shiny-TIER bits (v1/v2). DEFAULT_VARIANT is the shared base-form bit, not counted. */
const SHINY_TIER_BITS = DexAttr.VARIANT_2 | DexAttr.VARIANT_3;

/** True when this dex entry already owns the shiny variant the stake describes. */
function ownsShinyVariant(entry: DexEntry, variant: number): boolean {
  if (!(entry.caughtAttr & DexAttr.SHINY)) {
    return false;
  }
  const bit = shinyVariantBit(variant);
  // variant 0 shiny is owned iff SHINY is set (its variant bit is the always-present base bit).
  return bit === 0n ? true : (entry.caughtAttr & bit) !== 0n;
}

/** Clear the species-global SHINY flag ONLY when no shiny-tier variant bit (v1/v2) remains (C1). */
function clearShinyIfNoVariantRemains(entry: DexEntry): void {
  if ((entry.caughtAttr & SHINY_TIER_BITS) === 0n) {
    entry.caughtAttr &= ~DexAttr.SHINY;
  }
}

function applyRemoveUnlock(gameData: SettlementGameData, mut: ShowdownSettlementMutation & { kind: "removeUnlock" }) {
  const rootId = gameData.getRootStarterSpeciesId(mut.speciesId);
  const entry = gameData.dexData[rootId];
  if (!entry) {
    return;
  }
  const starter = gameData.starterData[rootId];

  if (mut.erBlackShiny) {
    // C2 (pool-restricted model): losing the BLACK shiny. The regular variant-3 is NOT separately
    // stakeable while black is owned (see buildShowdownStakePool), and the save model can't
    // distinguish "owns black" from "owns black + regular v3" (they share the VARIANT_3 bit + the
    // erBlackShiny flag), so losing black clears the flag + its backing VARIANT_3 bit, then clears
    // the species-global SHINY only when no other shiny-tier variant survives.
    if (starter) {
      starter.erBlackShiny = false;
    }
    entry.caughtAttr &= ~DexAttr.VARIANT_3;
    clearShinyIfNoVariantRemains(entry);
  } else if (mut.shiny) {
    // C1: losing a REGULAR shiny variant. Clear ONLY this variant's dedicated bit; clear the
    // species-global SHINY only when no OTHER shiny-tier variant bit remains. DEFAULT_VARIANT (v0)
    // has no dedicated bit (it doubles as the base-form bit — the shared-bit exception), so a v0
    // remove clears SHINY iff no higher variant survives, and is otherwise a no-op on the bits.
    const bit = shinyVariantBit(mut.variant);
    // Defensive (M2/C2 pool restrictions make this unreachable in practice): a regular v3 remove
    // while the line STILL owns the black leaves VARIANT_3 alone (the black needs it) — flag-only
    // bookkeeping, so the black survives.
    if (bit === DexAttr.VARIANT_3 && starter?.erBlackShiny) {
      return;
    }
    if (bit !== 0n) {
      entry.caughtAttr &= ~bit;
    }
    clearShinyIfNoVariantRemains(entry);
  } else {
    // Non-shiny species stake (pool: only offered when the line owns NO shiny variant — see M2 in
    // buildShowdownStakePool — so clearing the whole line can never orphan a shiny). Clear caughtAttr
    // + zero the shared candy bucket (mirrors the er-redux-dex-redirect transfer idiom's reset).
    entry.caughtAttr = 0n;
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
  // I1: a black-shiny grant's already-owned check keys on the erBlackShiny FLAG (not the VARIANT_3
  // bit, which a regular v3 owner also sets) — so a winner who owns regular v3 but not the black is
  // NOT "already owned" and is granted the black, never candy.
  let alreadyOwned: boolean;
  if (mut.erBlackShiny) {
    alreadyOwned = gameData.starterData[rootId]?.erBlackShiny === true;
  } else if (mut.shiny) {
    alreadyOwned = ownsShinyVariant(entry, mut.variant);
  } else {
    alreadyOwned = entry.caughtAttr !== 0n;
  }
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
 * Apply a batch of settlement mutations to `gameData`, appending `appliedIds` to the persisted
 * ledger (I2, capped FIFO) INSIDE the same account-write allowlist scope as the apply. Does NOT
 * push the save — the caller (`syncShowdownPendingSettlements`) controls the save→ack ordering
 * (I3). Returns the count applied.
 */
export function applySettlementMutations(
  mutations: ShowdownSettlementMutation[],
  gameData: SettlementGameData,
  appliedIds: number[] = [],
): number {
  if (!Array.isArray(mutations) || mutations.length === 0) {
    return 0;
  }
  return coopAllowAccountWrite("showdown-settlement", () => {
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
        case "grantShinyLabLook": {
          // Grant a shiny-lab effect/look on the awarded species: marks the effect owned on that
          // mon (evolution-line root) and auto-equips it if the mon has no current look. Idempotent
          // (already-owned effects are skipped by grantErShinyLabSavedLookToSave).
          const rootId = gameData.getRootStarterSpeciesId(mut.speciesId);
          const entry = gameData.getStarterDataEntry(rootId);
          entry.erShinyLab ??= {};
          grantErShinyLabSavedLookToSave(entry.erShinyLab, mut.savedLook, {
            equipIfEmpty: true,
            claimCompletionRewards: true,
          });
          n++;
          break;
        }
      }
    }
    // I2: record the applied row ids in the ledger (deduped, newest-200 FIFO) in the SAME batch,
    // so a subsequent re-fetch (after an ack that never landed) skips them instead of re-mutating.
    if (n > 0 && appliedIds.length > 0) {
      const existing = Array.isArray(gameData.showdownAppliedSettlements) ? gameData.showdownAppliedSettlements : [];
      const merged = [...existing];
      for (const id of appliedIds) {
        if (!merged.includes(id)) {
          merged.push(id);
        }
      }
      gameData.showdownAppliedSettlements = merged.slice(-SHOWDOWN_LEDGER_CAP);
    }
    return n;
  });
}
