// =============================================================================
// Elite Redux — Phase B Task B3: vanilla rebalance pass.
//
// ER ships its own balance pass on the vanilla pokerogue moves + abilities —
// different `power`, `pp`, `accuracy`, `priority`, `chance` (effectChance) on
// moves and reworked descriptions on abilities.
//
// For every ER entry whose pokerogue id resolves to < VANILLA_ID_CUTOFF (i.e.
// it shadows a real pokerogue move/ability — see `er-id-map.ts`), we PATCH
// the live `Move`/`Ability` instance in `allMoves` / `allAbilities` to match
// ER's numeric stats.
//
// This is a runtime patch step (like B1a's `_passives` overwrite). We do NOT
// modify pokerogue's source data files (`src/data/moves/move.ts`,
// `src/data/abilities/init-abilities.ts`) — that would create a huge diff and
// fight every future upstream merge. Instead we let pokerogue construct the
// baseline values normally, then mutate the mutable public fields.
//
// Mutability boundary (verified by reading the upstream classes):
//   - `Move`:    `power`, `accuracy`, `pp`, `priority`, `chance` are all
//                declared `public` non-readonly (move.ts:160-166). Safe to
//                assign directly. We do NOT patch `name`/`effect` here —
//                pokerogue derives those from i18next at construction time,
//                and ER's display strings live in the upcoming ER locale pack
//                (Phase C). Patching here would diverge from the i18n source.
//   - `Ability`: `description` is a `get` accessor backed by i18next
//                (ability.ts:69-74). No setter exists. We cannot rewrite the
//                vanilla ability descriptions at runtime without overriding
//                the getter per-instance (which would break i18n switching).
//                For now we SKIP ability description patching — see TODO.
//
// Order constraint: must run AFTER `initMoves()` / `initAbilities()` (so the
// baseline values are in place) and AFTER `initEliteReduxCustomAbilities()` /
// `initEliteReduxCustomMoves()` (so we know whether a given id is custom).
// Vanilla customs are skipped — their values come from the ER draft directly
// in B2.
// =============================================================================

import { allAbilities, allMoves } from "#data/data-lists";
import { ER_ABILITIES } from "#data/elite-redux/er-abilities";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";

/**
 * Numeric cutoff for "vanilla pokerogue" ids — anything ≥ this is an ER
 * custom (registered by B2). Mirrors the cutoffs in
 * `init-elite-redux-custom-{moves,abilities}.ts`.
 */
const VANILLA_ID_CUTOFF = 5000;

/** Aggregated result of a single `initEliteReduxVanillaRebalance()` run. */
export interface VanillaRebalanceResult {
  /** Count of vanilla moves whose stat fields were updated. */
  moveDeltas: number;
  /** Count of individual move field assignments performed (a single move may bump 2+ fields). */
  moveFieldWrites: number;
  /** Count of vanilla abilities whose description was patched (currently always 0 — see file header). */
  abilityDeltas: number;
  /**
   * Count of vanilla move/ability ids the ER id-map points to that don't exist
   * in pokerogue's runtime tables. These are NOT bugs — they're pre-existing
   * id-map drift from `scripts/elite-redux/builders/id-map.mjs`'s parser not
   * stripping block comments in `move-id.ts` (e.g. the commented-out G_MAX
   * block at lines 1705-1737 inflates the parser's id counter by 32). The
   * patcher cannot fix the live state for these — pokerogue simply does not
   * construct a Move for those slots.
   *
   * TODO(infra): fix id-map.mjs's `loadEnumValues` to strip block comments
   *              before regex-matching, which will eliminate this drift.
   */
  moveMissing: number;
  abilityMissing: number;
  /** Non-fatal real errors (currently unused — kept for API stability). */
  moveErrors: string[];
  abilityErrors: string[];
}

/**
 * Apply ER's stat rebalances to vanilla pokerogue moves and abilities.
 *
 * Idempotent: a second invocation observes the already-patched state and
 * reports `moveDeltas: 0`.
 *
 * @returns A summary of how many moves/abilities were touched and any
 *          non-fatal errors encountered.
 */
export function initEliteReduxVanillaRebalance(): VanillaRebalanceResult {
  const result: VanillaRebalanceResult = {
    moveDeltas: 0,
    moveFieldWrites: 0,
    abilityDeltas: 0,
    moveMissing: 0,
    abilityMissing: 0,
    moveErrors: [],
    abilityErrors: [],
  };

  // Index allMoves / allAbilities by id for O(1) lookup. allMoves and
  // allAbilities are arrays; we don't assume the index equals the id.
  const moveById = new Map<number, (typeof allMoves)[number]>();
  for (const move of allMoves) {
    moveById.set(move.id, move);
  }
  const abilityById = new Map<number, (typeof allAbilities)[number]>();
  // allAbilities is sparse — ER custom abilities are assigned to positions
  // ≥5000 by id. Iterate via Object.values to skip the gap (undefined entries).
  for (const ability of allAbilities) {
    if (!ability) {
      continue;
    }
    abilityById.set(ability.id, ability);
  }

  // === MOVES ===
  for (const draft of ER_MOVES) {
    const pokerogueId = ER_ID_MAP.moves[draft.id];
    if (pokerogueId === undefined) {
      // ER entry has no id-map row — usually means the move couldn't be
      // resolved during the build. Skip silently; the build script emits the
      // diagnostic.
      continue;
    }
    if (pokerogueId >= VANILLA_ID_CUTOFF) {
      // ER-custom — already constructed with the right values in B2.
      continue;
    }
    if (draft.archetype !== "vanilla") {
      // Defensive: only rebalance entries the build flagged as vanilla.
      // (An entry with a < 5000 id but archetype "unknown" would be a bug.)
      continue;
    }

    const move = moveById.get(pokerogueId);
    if (!move) {
      // Known pre-existing id-map drift — see VanillaRebalanceResult.moveMissing
      // for the root cause. Silently bookkeep; the patcher can't construct a
      // missing Move (that's the responsibility of pokerogue's initMoves).
      result.moveMissing++;
      continue;
    }

    // Patch each numeric field independently. We accept the cast through
    // a narrow shape — Move declares these fields `public` non-readonly, so
    // the write is safe at runtime even though TS sees `Move` as the
    // declared type. (See header for why we do this here rather than at
    // construction time.)
    let movedirty = false;
    const target = move as {
      power: number;
      accuracy: number;
      pp: number;
      priority: number;
      chance: number;
    };

    // power: skip when ER ships 0 (placeholder / status moves where ER's 0 is
    // semantically "no power", not "patch to 0").
    if (draft.power > 0 && target.power !== draft.power) {
      target.power = draft.power;
      result.moveFieldWrites++;
      movedirty = true;
    }
    // accuracy: ER's 0 means "always hits" (status); pokerogue stores -1 for
    // that. Don't blindly overwrite a -1 with 0 — only patch when ER has a
    // positive accuracy value that differs.
    if (draft.accuracy > 0 && target.accuracy !== draft.accuracy) {
      target.accuracy = draft.accuracy;
      result.moveFieldWrites++;
      movedirty = true;
    }
    // pp: must be positive on pokerogue side too. ER ships pp 0 for placeholder
    // entries — we don't want to zero out a real move.
    if (draft.pp > 0 && target.pp !== draft.pp) {
      target.pp = draft.pp;
      result.moveFieldWrites++;
      movedirty = true;
    }
    // priority: signed; 0 is a legitimate value, so we compare directly.
    if (target.priority !== draft.priority) {
      target.priority = draft.priority;
      result.moveFieldWrites++;
      movedirty = true;
    }
    // chance / effectChance: pokerogue uses -1 for "no secondary effect",
    // ER uses 0 (or absent). Only patch when ER specifies a positive value.
    if (draft.effectChance > 0 && target.chance !== draft.effectChance) {
      target.chance = draft.effectChance;
      result.moveFieldWrites++;
      movedirty = true;
    }

    if (movedirty) {
      result.moveDeltas++;
    }
  }

  // === ABILITIES ===
  // Ability.description is a getter that reads from i18next. There is no
  // mutable description field on the Ability class (see ability.ts:69-74).
  // We could override the getter per-instance via Object.defineProperty
  // (the B2 custom-abilities path does that for ER-custom abilities), but
  // doing that to VANILLA abilities would:
  //   - Decouple them from i18next, breaking locale switching for those
  //     ability descriptions.
  //   - Diverge from the upcoming ER locale pack (Phase C) which is where
  //     this content properly belongs.
  //
  // For now we record the count of would-be-deltas (i.e. ER ships a
  // description different from pokerogue's stub) but emit 0 actual writes.
  // TODO(Phase C): once the ER locale pack is wired, ability descriptions
  // will come through i18next naturally and this loop becomes unnecessary.
  for (const draft of ER_ABILITIES) {
    const pokerogueId = ER_ID_MAP.abilities[draft.id];
    if (pokerogueId === undefined) {
      continue;
    }
    if (pokerogueId >= VANILLA_ID_CUTOFF) {
      continue;
    }
    if (draft.archetype !== "vanilla") {
      continue;
    }

    const ability = abilityById.get(pokerogueId);
    if (!ability) {
      // Same id-map-drift handling as moves above.
      result.abilityMissing++;
    }
    // Intentionally no field write — see comment block above. Counter
    // remains at 0 by design; the field exists in the result type to keep
    // the API stable when the Phase C locale pack lands.
  }

  return result;
}
