// =============================================================================
// Elite Redux — Phase B Task B2 / Phase D Task D4:
//   - B2: register ER-custom moves in `allMoves`.
//   - D4: wire archetype-classified moves' `MoveFlags` bits + `MoveAttr`
//     instances onto each registered move via the move-archetype dispatcher.
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
// Behavior note (Phase D4): archetype-classified moves get:
//   - flag-tagged-move (100): MoveFlag bits OR'd into the Move's flag bitmask,
//     plus an optional status-chance side effect when present.
//   - chance-status-on-hit (20): StatusEffectAttr or AddBattlerTagAttr.
//   - recoil-or-drain (7): RecoilAttr (mode=recoil) or HitHealAttr (mode=drain),
//     plus RECKLESS_MOVE / TRIAGE_MOVE flags.
//   - type-conversion (2): a custom BestEffectivenessTypeAttr (subclass of
//     VariableMoveTypeAttr) that picks the most effective type at apply-time.
//   - conditional-damage (1): MovePowerMultiplierAttr with a closure over the
//     user's status state (ER's Facade analog).
//   - bespoke (58): no wiring; placeholder behavior preserved.
//
// i18n note: pokerogue's `Move.localize()` derives an `i18nKey` from
// `MoveId[this.id]`. For custom ids (≥ 5000) that reverse-lookup returns
// `undefined`, which would throw inside `toCamelCase`. We override
// `localize()` in subclasses to read the draft name/description verbatim
// from a pre-stashed map.
//
// Flag mutability note: pokerogue's `Move.flags` field is private with a
// private `setFlag()` helper — no public surface exists for OR'ing arbitrary
// bits post-construction. The subclasses here expose a public
// `applyErArchetype(flags, attrs)` method that uses a runtime cast to OR
// directly into the field; this is a deliberate ER-glue escape hatch (the
// `private` modifier is a TS compile-time check only — at runtime the field
// is a regular property).
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVE_ARCHETYPES, type ErMoveArchetypeKind } from "#data/elite-redux/er-move-archetypes";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { dispatchMoveArchetype } from "#data/elite-redux/move-archetype-dispatcher";
import { AttackMove, type Move, type MoveAttr, SelfStatusMove, StatusMove } from "#data/moves/move";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
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
  /**
   * Per-archetype count of how many moves got at least one MoveAttr OR flag
   * bit wired via the dispatcher this run. Only counts NEW additions
   * (idempotent re-run sees zero). Bespoke/missing-shape rows don't appear
   * in this map.
   */
  attrsWiredByArchetype: Record<string, number>;
  /**
   * Per-archetype count of how many rows the dispatcher skipped this run
   * (because the params shape didn't have a wired translation). Surfaces
   * coverage gaps without failing the build.
   */
  dispatchSkipsByArchetype: Record<string, number>;
  /**
   * Total number of MoveAttr instances attached this run across every move.
   * A single move with N attrs contributes N.
   */
  totalAttrsAttached: number;
  /**
   * Total number of MoveFlag bits OR'd this run across every move. Counts
   * each row's bitmask population — i.e. a move that received two flag bits
   * contributes 2.
   */
  totalFlagBitsApplied: number;
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
 * Bit-or a `MoveFlags` mask onto a Move instance via runtime cast. The
 * `flags` field on `Move` is declared `private` (TS compile-time only), so
 * a typed cast suffices to access it at runtime without altering core.
 *
 * Also forwards a list of pre-built `MoveAttr` instances through the public
 * `Move.addAttr(...)` API so any per-attr `MoveCondition` chains are
 * registered correctly.
 *
 * Idempotent: re-applying the same bits is a no-op (bitmask OR is idempotent).
 *
 * @param move - The Move to mutate
 * @param flagBits - The bitmask of `MoveFlags` to OR onto `move.flags`
 * @param attrs - Pre-built MoveAttr instances to attach
 */
function applyErArchetypeToMove(move: Move, flagBits: number, attrs: readonly MoveAttr[]): void {
  if (flagBits !== 0) {
    // `private` is a TypeScript compile-time check; at runtime `flags` is a
    // regular property on the Move instance.
    (move as unknown as { flags: number }).flags |= flagBits;
  }
  for (const attr of attrs) {
    move.addAttr(attr);
  }
}

interface ErMoveText {
  readonly name: string;
  readonly description: string;
  readonly longDescription: string;
}

/** Placeholder descriptions the ER ROM left on not-yet-finalised moves. */
const ER_PLACEHOLDER_DESC = /^\s*$|not done yet|not implemented|^\s*deals damage\.?\s*$/i;

/**
 * The in-game move description: the short `description` unless it's a ROM
 * placeholder ("Not done yet."), in which case fall back to the detailed
 * `longDescription` (which carries the real effect text), and only if THAT is
 * also a placeholder fall back to the raw description.
 */
function bestErMoveDescription(t?: ErMoveText): string {
  if (!t) {
    return "";
  }
  if (ER_PLACEHOLDER_DESC.test(t.description) && t.longDescription && !ER_PLACEHOLDER_DESC.test(t.longDescription)) {
    return t.longDescription;
  }
  return t.description;
}

/**
 * Thin `AttackMove` subclass for ER-custom attack moves. Overrides
 * `localize()` to read the draft's display name/description from a static
 * registry — the vanilla implementation looks up `MoveId[this.id]` which is
 * `undefined` for ids ≥ VANILLA_ID_CUTOFF.
 */
class ErCustomAttackMove extends AttackMove {
  /** Fallback display name/description from the ER draft (set pre-construction). */
  private static readonly _draftTexts = new Map<number, ErMoveText>();

  override localize(): void {
    const draft = ErCustomAttackMove._draftTexts.get(this.id);
    this.name = draft?.name ?? "Unknown";
    this.effect = bestErMoveDescription(draft);
  }

  /** Stash the draft name/description keyed by pokerogue move id before construction. */
  static registerDraft(id: number, name: string, description: string, longDescription: string): void {
    ErCustomAttackMove._draftTexts.set(id, { name, description, longDescription });
  }
}

/** Thin `StatusMove` subclass — see {@link ErCustomAttackMove} for the override rationale. */
class ErCustomStatusMove extends StatusMove {
  private static readonly _draftTexts = new Map<number, ErMoveText>();

  override localize(): void {
    const draft = ErCustomStatusMove._draftTexts.get(this.id);
    this.name = draft?.name ?? "Unknown";
    this.effect = bestErMoveDescription(draft);
  }

  static registerDraft(id: number, name: string, description: string, longDescription: string): void {
    ErCustomStatusMove._draftTexts.set(id, { name, description, longDescription });
  }
}

/** Thin `SelfStatusMove` subclass — see {@link ErCustomAttackMove} for the override rationale. */
class ErCustomSelfStatusMove extends SelfStatusMove {
  private static readonly _draftTexts = new Map<number, ErMoveText>();

  override localize(): void {
    const draft = ErCustomSelfStatusMove._draftTexts.get(this.id);
    this.name = draft?.name ?? "Unknown";
    this.effect = bestErMoveDescription(draft);
  }

  static registerDraft(id: number, name: string, description: string, longDescription: string): void {
    ErCustomSelfStatusMove._draftTexts.set(id, { name, description, longDescription });
  }
}

/** Count the number of set bits in a (non-negative integer) bitmask. */
function popcount(mask: number): number {
  // The ER MoveFlags enum has < 32 bits, so a simple Brian-Kernighan loop is fine.
  let count = 0;
  let m = mask;
  while (m > 0) {
    m &= m - 1;
    count++;
  }
  return count;
}

/**
 * Construct `Move` instances for the ER-custom moves and push them onto
 * `allMoves`. Idempotent: a re-run skips moves that are already present
 * (by id match).
 *
 * Order constraint: must run AFTER `initMoves()` (so the vanilla baseline
 * is in place) and AFTER `initAbilities()` (some `MoveAttr` flag checks read
 * ability state). Typically called from `init/init.ts:initializeGame()`
 * right after `initEliteReduxCustomAbilities()`.
 */
export function initEliteReduxCustomMoves(): InitEliteReduxCustomMovesResult {
  const result: InitEliteReduxCustomMovesResult = {
    customsAdded: 0,
    customsAlreadyPresent: 0,
    errors: [],
    attrsWiredByArchetype: {},
    dispatchSkipsByArchetype: {},
    totalAttrsAttached: 0,
    totalFlagBitsApplied: 0,
  };

  // Build a O(1) id → bool lookup for idempotency. `allMoves` is sparse after a
  // prior run (custom moves are id-indexed ≥5000); for…of yields `undefined`
  // for the holes between the vanilla and custom id ranges.
  const existingIds = new Set<number>();
  for (const move of allMoves) {
    if (move === undefined) {
      continue;
    }
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
      const move = buildCustomMove(draft, pokerogueId, result);
      // Index-assign by id (NOT push). `allMoves` is read via `allMoves[id]` in
      // ~130 places (getMoveset, Mimic/Sketch/Copycat, etc.); a push would land
      // the custom move at index ~900 (next free slot), so `allMoves[5065]`
      // would be undefined → the move gets filtered out of every Pokémon's
      // moveset and crashes loadAssets. Mirrors initEliteReduxCustomAbilities,
      // which assigns `allAbilities[id]` for the same reason. This makes the
      // array sparse (holes between the vanilla and custom id ranges); every
      // `for…of`/spread/`.map` over `allMoves` guards against the holes.
      (allMoves as Move[])[pokerogueId] = move;
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
 * now — TODO(Phase D): derive from ER archetype taxonomy.
 *
 * Phase D4: when the ER move's archetype row in `ER_MOVE_ARCHETYPES` is
 * non-bespoke and the dispatcher produces flag bits and/or MoveAttr
 * instances, those are applied to the Move post-construction via
 * `applyErArchetypeToMove`. `bespoke` and shapes the dispatcher can't yet
 * translate produce no wire-up (placeholder behavior unchanged from B2).
 *
 * `AttackMove` may auto-add `HealStatusEffectAttr` for FIRE-type moves
 * (intentional vanilla behavior, kept verbatim).
 *
 * @param draft - ER move draft from `er-moves.ts`
 * @param pokerogueId - pokerogue move id (≥ VANILLA_ID_CUTOFF) from `ER_ID_MAP.moves`
 * @param result - aggregate result object — mutated to record per-archetype wired/skip counts
 */
/**
 * Convert an ER move display name to its `MoveId` enum-key form (uppercase,
 * non-alphanumerics collapsed to `_`). Mirrors `abilityNameToEnumKey` so the
 * reverse-mapping installed for custom moves matches the vanilla key style
 * (e.g. "Spine Breaker" → "SPINE_BREAKER").
 */
function moveNameToEnumKey(moveName: string): string {
  return moveName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildCustomMove(
  draft: {
    id: number;
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
  result: InitEliteReduxCustomMovesResult,
): Move {
  // Runtime reverse-mapping injection (mirrors initEliteReduxCustomAbilities):
  // install `MoveId[5140] = "SPINE_BREAKER"` so external `enumValueToKey(MoveId,
  // id)` callers (move history, battle log, UI, test override helpers) can name
  // the custom move. The per-instance `name` getter is overridden separately via
  // `registerDraft`, so this only feeds the enum-key reverse-lookup paths.
  // Idempotent; the forward mapping is intentionally NOT installed.
  (MoveId as unknown as Record<number, string>)[pokerogueId] = moveNameToEnumKey(draft.name);

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

  let move: Move;
  if (category === MoveCategory.STATUS) {
    // ER doesn't distinguish self-status from foe-status in the `split`
    // field — defer to the `target` field. ER target 2 = USER per
    // ER_TARGET_NAMES in er-move-tables.ts.
    // For now we use SelfStatusMove for target=2 (USER), StatusMove otherwise.
    // This is a coarse mapping — Phase C will refine via MoveTarget.
    const isSelfStatus = (draft as { target?: number }).target === 2;
    if (isSelfStatus) {
      ErCustomSelfStatusMove.registerDraft(pokerogueId, draft.name, draft.description, draft.longDescription);
      move = new ErCustomSelfStatusMove(
        pokerogueId as MoveId,
        type,
        accuracy,
        pp,
        chance,
        draft.priority,
        9, // generation — TODO(Phase D): derive from archetype
      );
    } else {
      ErCustomStatusMove.registerDraft(pokerogueId, draft.name, draft.description, draft.longDescription);
      move = new ErCustomStatusMove(pokerogueId as MoveId, type, accuracy, pp, chance, draft.priority, 9);
    }
  } else {
    // AttackMove (PHYSICAL/SPECIAL/etc.). Default target is NEAR_OTHER (set
    // by AttackMove). Per-move MoveTarget refinement is Phase C.
    ErCustomAttackMove.registerDraft(pokerogueId, draft.name, draft.description, draft.longDescription);
    move = new ErCustomAttackMove(
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

  // Phase D4: wire archetype-classified flags + attrs via the dispatcher. We
  // look up the archetype row by the ER-side id (not the pokerogue id) since
  // the classifier keys on ER's source numbering. The ER-side id is also
  // forwarded so the dispatcher can route `bespoke` rows through per-id
  // hand-written wiring.
  const archetypeRow = ER_MOVE_ARCHETYPES[draft.id];
  if (archetypeRow !== undefined) {
    wireArchetypeToMove(move, archetypeRow.archetype, archetypeRow.params, draft.id, result);
  }

  return move;
}

/**
 * Dispatch the archetype row through the move dispatcher and apply the
 * produced flags + attrs to the Move. Records per-archetype wired/skip
 * counts in `result` for diagnostics.
 *
 * Any throw from the dispatcher (e.g. an attr constructor's invariant check)
 * is caught here and recorded in `result.errors`, then the move proceeds
 * without those wire-ups — better to register the move as a placeholder
 * than to fail the whole init pass.
 */
function wireArchetypeToMove(
  move: Move,
  archetype: ErMoveArchetypeKind,
  params: Record<string, unknown> | null,
  erMoveId: number,
  result: InitEliteReduxCustomMovesResult,
): void {
  let dispatched: ReturnType<typeof dispatchMoveArchetype>;
  try {
    dispatched = dispatchMoveArchetype(archetype, params, erMoveId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Move archetype ${archetype} dispatch threw for move id ${move.id}: ${msg}`);
    return;
  }
  const hasFlags = dispatched.flags !== 0;
  const hasAttrs = dispatched.attrs.length > 0;
  if (!hasFlags && !hasAttrs) {
    // Skipped — either bespoke (expected) or shape-mismatch (logged).
    if (dispatched.skipReason !== null) {
      result.dispatchSkipsByArchetype[archetype] = (result.dispatchSkipsByArchetype[archetype] ?? 0) + 1;
    }
    return;
  }
  applyErArchetypeToMove(move, dispatched.flags, dispatched.attrs);
  result.attrsWiredByArchetype[archetype] = (result.attrsWiredByArchetype[archetype] ?? 0) + 1;
  result.totalAttrsAttached += dispatched.attrs.length;
  result.totalFlagBitsApplied += popcount(dispatched.flags);
}
