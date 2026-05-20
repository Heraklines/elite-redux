// =============================================================================
// Elite Redux — Phase B Task B2: register ER-custom moves in `allMoves`.
//
// Reads `er-moves.ts` and, for every entry whose pokerogue id resolves to
// ≥ VANILLA_ID_CUTOFF (the ER-custom range — see `er-id-map.ts`), constructs
// a fresh `Move` instance (via a thin subclass of `AttackMove`/`StatusMove`/
// `SelfStatusMove`) and pushes it onto `allMoves`.
//
// Vanilla moves (id < VANILLA_ID_CUTOFF) are NOT touched here — that's B3's
// vanilla-rebalance task. ER moves whose const happens to match a vanilla
// MoveId (e.g. `MOVE_POUND`) simply get the vanilla id and skip.
//
// Behavior note: Phase B registers placeholder moves only — they own id,
// name, effect (description), type/category/power/accuracy/pp/priority, but
// they ship with NO `MoveAttr`s attached beyond the framework defaults
// (AttackMove auto-adds HealStatusEffectAttr for FIRE-type moves, which is
// fine; no other auto-attrs). Phase C will wire actual per-move behavior.
//
// i18n note: pokerogue's `Move.localize()` derives an `i18nKey` from
// `MoveId[this.id]`. For custom ids (≥ 5000) that reverse-lookup returns
// `undefined`, which would throw inside `toCamelCase`. We override
// `localize()` in subclasses to read the draft name/description verbatim
// from a pre-stashed map.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { AttackMove, type Move, SelfStatusMove, StatusMove } from "#data/moves/move";
import { MoveCategory } from "#enums/move-category";
import type { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";

/**
 * Numeric cutoff for "vanilla pokerogue" move ids. ER-custom moves are
 * assigned fresh ids ≥ 5000 by the id-map builder (see `er-id-map.ts`).
 * Mirrors the value in `scripts/elite-redux/builders/id-map.mjs` and
 * `er-move-id-enum.mjs`.
 */
const VANILLA_ID_CUTOFF = 5000;

/** Aggregated result of a single `initEliteReduxCustomMoves()` run. */
export interface InitEliteReduxCustomMovesResult {
  /** Number of ER-custom moves newly constructed and pushed onto allMoves. */
  customsAdded: number;
  /** Number of ER-custom moves skipped because an entry already existed (idempotent re-run). */
  customsAlreadyPresent: number;
  /** Non-fatal issues — e.g. constructor failures with a usable error message. */
  errors: string[];
}

/**
 * Map ER's numeric type id (decoded by `ER_TYPE_NAMES` in `er-move-tables.ts`)
 * to pokerogue's `PokemonType` enum. Returns `PokemonType.NORMAL` as a safe
 * fallback for ER's "Mystery"/"None" sentinels (18/19) — for STATUS moves,
 * type is largely cosmetic; for damaging moves we shouldn't see these.
 */
function mapType(erTypeId: number): PokemonType {
  switch (erTypeId) {
    case 0:
      return PokemonType.NORMAL;
    case 1:
      return PokemonType.FIGHTING;
    case 2:
      return PokemonType.FIRE;
    case 3:
      return PokemonType.ICE;
    case 4:
      return PokemonType.ELECTRIC;
    case 5:
      return PokemonType.BUG;
    case 6:
      return PokemonType.FLYING;
    case 7:
      return PokemonType.STEEL;
    case 8:
      return PokemonType.GRASS;
    case 9:
      return PokemonType.GROUND;
    case 10:
      return PokemonType.POISON;
    case 11:
      return PokemonType.DARK;
    case 12:
      return PokemonType.WATER;
    case 13:
      return PokemonType.PSYCHIC;
    case 14:
      return PokemonType.ROCK;
    case 15:
      return PokemonType.DRAGON;
    case 16:
      return PokemonType.GHOST;
    case 17:
      return PokemonType.FAIRY;
    case 20:
      return PokemonType.STELLAR;
    // 18 Mystery, 19 None — fall through.
    default:
      return PokemonType.NORMAL;
  }
}

/**
 * Map ER's `split` enum index to pokerogue's `MoveCategory`. ER has 7
 * splits (vs. pokerogue's 3): the 4 ER-only splits (USE_HIGHEST_OFFENSE,
 * HITS_DEF, USE_HIGHEST_DAMAGE, HITS_SPDEF) collapse to PHYSICAL for now.
 *
 * TODO(Phase C): model the ER-only splits with custom `MoveAttr` subclasses
 * (e.g. Foul Play already uses opponent's atk; HITS_DEF inverts the
 * defender's stat the same way Body Press does).
 */
function mapSplit(erSplit: number): MoveCategory {
  switch (erSplit) {
    case 0:
      return MoveCategory.PHYSICAL;
    case 1:
      return MoveCategory.SPECIAL;
    case 2:
      return MoveCategory.STATUS;
    // ER-only splits 3-6 — see TODO above.
    default:
      return MoveCategory.PHYSICAL;
  }
}

/**
 * Thin `AttackMove` subclass for ER-custom attack moves. Overrides
 * `localize()` to read the draft's display name/description from a static
 * registry — the vanilla implementation looks up `MoveId[this.id]` which is
 * `undefined` for ids ≥ VANILLA_ID_CUTOFF.
 */
class ErCustomAttackMove extends AttackMove {
  /** Fallback display name/description from the ER draft (set pre-construction). */
  private static readonly _draftTexts = new Map<number, { name: string; description: string }>();

  override localize(): void {
    const draft = ErCustomAttackMove._draftTexts.get(this.id);
    this.name = draft?.name ?? "Unknown";
    this.effect = draft?.description ?? "";
  }

  /** Stash the draft name/description keyed by pokerogue move id before construction. */
  static registerDraft(id: number, name: string, description: string): void {
    ErCustomAttackMove._draftTexts.set(id, { name, description });
  }
}

/** Thin `StatusMove` subclass — see {@link ErCustomAttackMove} for the override rationale. */
class ErCustomStatusMove extends StatusMove {
  private static readonly _draftTexts = new Map<number, { name: string; description: string }>();

  override localize(): void {
    const draft = ErCustomStatusMove._draftTexts.get(this.id);
    this.name = draft?.name ?? "Unknown";
    this.effect = draft?.description ?? "";
  }

  static registerDraft(id: number, name: string, description: string): void {
    ErCustomStatusMove._draftTexts.set(id, { name, description });
  }
}

/** Thin `SelfStatusMove` subclass — see {@link ErCustomAttackMove} for the override rationale. */
class ErCustomSelfStatusMove extends SelfStatusMove {
  private static readonly _draftTexts = new Map<number, { name: string; description: string }>();

  override localize(): void {
    const draft = ErCustomSelfStatusMove._draftTexts.get(this.id);
    this.name = draft?.name ?? "Unknown";
    this.effect = draft?.description ?? "";
  }

  static registerDraft(id: number, name: string, description: string): void {
    ErCustomSelfStatusMove._draftTexts.set(id, { name, description });
  }
}

/**
 * Construct `Move` instances for the ER-custom moves and push them onto
 * `allMoves`. Idempotent: a re-run skips moves that are already present
 * (by id match).
 *
 * Order constraint: must run AFTER `initMoves()` (so the vanilla baseline
 * is in place) and AFTER `initAbilities()` (some `MoveAttr` flag checks read
 * ability state, though customs currently ship no attrs). Typically called
 * from `init/init.ts:initializeGame()` right after `initEliteReduxCustomAbilities()`.
 */
export function initEliteReduxCustomMoves(): InitEliteReduxCustomMovesResult {
  const result: InitEliteReduxCustomMovesResult = {
    customsAdded: 0,
    customsAlreadyPresent: 0,
    errors: [],
  };

  // Build a O(1) id → bool lookup for idempotency.
  const existingIds = new Set<number>();
  for (const move of allMoves) {
    existingIds.add(move.id);
  }

  for (const draft of ER_MOVES) {
    const pokerogueId = ER_ID_MAP.moves[draft.id];
    if (pokerogueId === undefined) {
      continue;
    }
    if (pokerogueId < VANILLA_ID_CUTOFF) {
      // Vanilla — already in allMoves from initMoves().
      continue;
    }
    if (existingIds.has(pokerogueId)) {
      result.customsAlreadyPresent++;
      continue;
    }

    try {
      const move = buildCustomMove(draft, pokerogueId);
      (allMoves as Move[]).push(move);
      existingIds.add(pokerogueId);
      result.customsAdded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to construct move "${draft.name}" (er id ${draft.id} → ${pokerogueId}): ${msg}`);
    }
  }

  return result;
}

/**
 * Construct a single ER-custom `Move` from its draft. Selects between
 * `ErCustomAttackMove`, `ErCustomStatusMove`, and `ErCustomSelfStatusMove`
 * based on the ER `split` field and target. Generation is fixed at 9 for
 * now — TODO(Phase C): derive from ER archetype taxonomy.
 *
 * No `MoveAttr`s are attached at this stage (placeholder move — Phase C
 * wires behavior). `AttackMove` may auto-add `HealStatusEffectAttr` for
 * FIRE-type moves (intentional vanilla behavior, kept verbatim).
 *
 * @param draft - ER move draft from `er-moves.ts`
 * @param pokerogueId - pokerogue move id (≥ VANILLA_ID_CUTOFF) from `ER_ID_MAP.moves`
 */
function buildCustomMove(
  draft: {
    name: string;
    description: string;
    types: readonly number[];
    power: number;
    accuracy: number;
    pp: number;
    priority: number;
    split: number;
    effectChance: number;
  },
  pokerogueId: number,
): Move {
  const type = mapType(draft.types[0] ?? 0);
  const category = mapSplit(draft.split);
  // ER ships -1/0 for "no effect chance"; pokerogue's StatusMove/AttackMove
  // accept `chance: number` (matched in initMoves with -1 for unconditional).
  const chance = draft.effectChance > 0 ? draft.effectChance : -1;
  // ER's `accuracy` of 0 indicates "always hits" for STATUS moves; pokerogue
  // uses -1 for that semantics. AttackMoves with accuracy 0 are nonsensical
  // — coerce to 100 as a defensive default.
  const accuracy = draft.accuracy > 0 ? draft.accuracy : category === MoveCategory.STATUS ? -1 : 100;
  // ER ships pp 0 for placeholder/junk entries; pokerogue treats <= 0 as
  // "infinite" in some places — coerce to 5 as a safe minimum.
  const pp = draft.pp > 0 ? draft.pp : 5;

  if (category === MoveCategory.STATUS) {
    // ER doesn't distinguish self-status from foe-status in the `split`
    // field — defer to the `target` field. ER target 2 = USER per
    // ER_TARGET_NAMES in er-move-tables.ts.
    // For now we use SelfStatusMove for target=2 (USER), StatusMove otherwise.
    // This is a coarse mapping — Phase C will refine via MoveTarget.
    const isSelfStatus = (draft as { target?: number }).target === 2;
    if (isSelfStatus) {
      ErCustomSelfStatusMove.registerDraft(pokerogueId, draft.name, draft.description);
      return new ErCustomSelfStatusMove(
        pokerogueId as MoveId,
        type,
        accuracy,
        pp,
        chance,
        draft.priority,
        9, // generation — TODO(Phase C): derive from archetype
      );
    }
    ErCustomStatusMove.registerDraft(pokerogueId, draft.name, draft.description);
    return new ErCustomStatusMove(pokerogueId as MoveId, type, accuracy, pp, chance, draft.priority, 9);
  }

  // AttackMove (PHYSICAL/SPECIAL/etc.). Default target is NEAR_OTHER (set
  // by AttackMove). Per-move MoveTarget refinement is Phase C.
  ErCustomAttackMove.registerDraft(pokerogueId, draft.name, draft.description);
  return new ErCustomAttackMove(
    pokerogueId as MoveId,
    type,
    category,
    draft.power > 0 ? draft.power : 0,
    accuracy,
    pp,
    chance,
    draft.priority,
    9,
  );
}
