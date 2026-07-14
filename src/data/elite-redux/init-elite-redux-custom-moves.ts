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

import { globalScene } from "#app/global-scene";
import { ChargeAnim } from "#data/battle-anims";
import { allMoves } from "#data/data-lists";
import { erArmSwitchInBoost } from "#data/elite-redux/empower-switch-in";
import { ER_FLAG_NAMES_LIST } from "#data/elite-redux/er-flag-mapping";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVE_ARCHETYPES, type ErMoveArchetypeKind } from "#data/elite-redux/er-move-archetypes";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { dispatchMoveArchetype, PitfallTrapAndAlwaysHitAttr } from "#data/elite-redux/move-archetype-dispatcher";
import {
  AddArenaTrapTagAttr,
  AddBattlerTagAttr,
  AddTypeAttr,
  AttackMove,
  AttackReducePpMoveAttr,
  ChargingAttackMove,
  ClearTerrainAttr,
  ClearWeatherAttr,
  ConfuseAttr,
  CritOnlyAttr,
  crashDamageFunc,
  DelayedAttackAttr,
  EatBerryAttr,
  ErDrenchAttr,
  ErSuperEffectiveVsTypeAttr,
  FallDownAttr,
  ForceLastAttr,
  ForceSwitchOutAttr,
  HighCritAttr,
  IgnoreOpponentStatStagesAttr,
  LeechSeedAttr,
  MissEffectAttr,
  type Move,
  type MoveAttr,
  MovePowerMultiplierAttr,
  MultiHitAttr,
  MultiHitPowerIncrementAttr,
  PhotonGeyserCategoryAttr,
  PsychoShiftEffectAttr,
  RemoveArenaTrapAttr,
  RemoveScreensAttr,
  SelfStatusMove,
  SemiInvulnerableAttr,
  SpDefDefAttr,
  StatStageChangeAttr,
  StatusEffectAttr,
  StatusMove,
  TerrainChangeAttr,
} from "#data/moves/move";
import { consecutiveUseRestriction } from "#data/moves/move-condition";
import { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { MultiHitType } from "#enums/multi-hit-type";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import i18next from "i18next";

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
 * Ghastly Echo (dex 848) self-switch rider. A plain {@linkcode
 * ForceSwitchOutAttr} that, when its self-switch actually fires, ARMS the
 * per-side "empower the switch-in" latch so the replacement Pokemon gets a
 * one-turn +50% move-power tag on send-out (see `empower-switch-in.ts` and
 * {@linkcode BattlerTagType.ER_EMPOWERED_SWITCH_IN}). Subclassing keeps this
 * behaviour on 848 ONLY — Take Flight (976) stays on the plain attr.
 */
class ErGhastlyEchoSwitchAttr extends ForceSwitchOutAttr {
  constructor() {
    // selfSwitch=true — Ghastly Echo switches its OWN user out (matches the old
    // `move.attr(ForceSwitchOutAttr, true)` wiring).
    super(true);
  }

  override apply(user: Pokemon, target: Pokemon, move: Move, args: any[]): boolean {
    const switched = super.apply(user, target, move, args);
    // Only arm when the forced self-switch is actually queued (super returns
    // true) — an aborted switch (no eligible bench mon) leaves no dangling flag.
    if (switched) {
      erArmSwitchInBoost(user.isPlayer());
    }
    return switched;
  }
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
/** Index of "Makes Contact" in the ER flag-name list — a move is contact iff its flag array includes it. */
const ER_CONTACT_FLAG_INDEX = ER_FLAG_NAMES_LIST.indexOf("Makes Contact");

function mapSplit(erSplit: number): MoveCategory {
  switch (erSplit) {
    case 0:
      return MoveCategory.PHYSICAL;
    case 1:
      return MoveCategory.SPECIAL;
    case 2:
      return MoveCategory.STATUS;
    // Split 3 = USE_HIGHEST_OFFENSE: base the move on SPECIAL, then attach a
    // PhotonGeyserCategoryAttr (see buildCustomMove) that flips it to PHYSICAL
    // when the user's Atk exceeds its Sp.Atk — i.e. the move strikes off the
    // higher offensive stat (Black Magic #801, Spectral Serenade #963, Banished
    // Power #990). Splits 4-6 (HITS_DEF/USE_HIGHEST_DAMAGE/HITS_SPDEF) still
    // collapse to PHYSICAL — see TODO above.
    case 3:
      return MoveCategory.SPECIAL;
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
    // Community report (Shadow Hammer): some ER descriptions omit the recoil
    // even though the move mechanically has it. If the move carries a
    // RecoilAttr and the text never mentions recoil, append the dex wording.
    const recoil = this.attrs.find(a => a.constructor.name === "RecoilAttr") as unknown as
      | { damageRatio?: number }
      | undefined;
    if (recoil && !/recoil/i.test(this.effect)) {
      const pct = Math.round((recoil.damageRatio ?? 0.33) * 100);
      this.effect = `${this.effect.replace(/\s+$/, "")} ${pct}% recoil damage.`;
    }
  }

  /** Stash the draft name/description keyed by pokerogue move id before construction. */
  static registerDraft(id: number, name: string, description: string, longDescription: string): void {
    ErCustomAttackMove._draftTexts.set(id, { name, description, longDescription });
  }
}

/**
 * Thin `ChargingAttackMove` subclass for ER-custom two-turn moves (Toxic Plunge
 * etc. — "dives/charges turn 1, strikes turn 2"). Same `localize()` override as
 * {@link ErCustomAttackMove} (vanilla reads `MoveId[this.id]`, undefined for
 * custom ids). The charge text + semi-invulnerable tag are applied by the
 * builder; the on-hit effects (e.g. the 20% poison) come from the archetype
 * dispatcher as usual.
 */
class ErCustomChargingAttackMove extends ChargingAttackMove {
  private static readonly _draftTexts = new Map<number, ErMoveText>();

  override localize(): void {
    const draft = ErCustomChargingAttackMove._draftTexts.get(this.id);
    this.name = draft?.name ?? "Unknown";
    this.effect = bestErMoveDescription(draft);
  }

  static registerDraft(id: number, name: string, description: string, longDescription: string): void {
    ErCustomChargingAttackMove._draftTexts.set(id, { name, description, longDescription });
  }
}

/**
 * ER-custom attack moves that are TWO-TURN charge moves (charge turn 1, strike
 * turn 2). The classifier wired their on-hit riders (status chance etc.) but not
 * the charge — so they hit instantly like a normal jab. Keyed by ER move id;
 * each entry supplies the charge flavour text and (optionally) the semi-
 * invulnerable tag to hide in during the charge turn, mirroring the vanilla
 * Dive / Dig / Fly clones.
 */
const ER_CHARGING_MOVES: Readonly<Record<number, { chargeTextKey: string; semiInvulnerable?: BattlerTagType }>> = {
  // 988 Toxic Plunge — "Dives into a pool of poison then strikes the next turn."
  // Dive clone: hide underwater during the charge, strike (+20% poison) turn 2.
  988: { chargeTextKey: "moveTriggers:hidUnderwater", semiInvulnerable: BattlerTagType.UNDERWATER },
  // 972 Ready or Not — "Hides on the first turn, scares the foe on the second."
  // Two-turn charge: hide from view (HIDDEN, semi-invulnerable) turn 1, strike
  // (+30% flinch, from move.chance) turn 2.
  972: { chargeTextKey: "moveTriggers:hidFromView", semiInvulnerable: BattlerTagType.HIDDEN },
};

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
    flags?: readonly number[];
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
  } else if (ER_CHARGING_MOVES[draft.id]) {
    // Two-turn charge move (charge turn 1, strike turn 2). Built as a charging
    // move so it actually charges instead of jabbing instantly; on-hit riders
    // (poison etc.) are layered by the archetype dispatcher below.
    const chargeCfg = ER_CHARGING_MOVES[draft.id];
    ErCustomChargingAttackMove.registerDraft(pokerogueId, draft.name, draft.description, draft.longDescription);
    const chargingMove = new ErCustomChargingAttackMove(
      pokerogueId as MoveId,
      type,
      category,
      draft.power > 0 ? draft.power : 0,
      accuracy,
      pp,
      chance,
      draft.priority,
      9,
    ).chargeText(i18next.t(chargeCfg.chargeTextKey, { pokemonName: "{USER}" }));
    if (chargeCfg.semiInvulnerable !== undefined) {
      chargingMove.chargeAttr(SemiInvulnerableAttr, chargeCfg.semiInvulnerable);
    }
    move = chargingMove;
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

  // ER target table → pokerogue MoveTarget (#366). Every custom move used to
  // keep the single-target class default, so spread moves (Outburst, the
  // *-Storm quartet, Mortal Spin…), hazards (Caltrops) and field moves
  // (Inverse Room) hit/affected ONE mon. Applied BEFORE the archetype/bespoke
  // wiring so any per-id override there still wins.
  applyErMoveTarget(move, (draft as { target?: number }).target ?? 0, category);

  // USE_HIGHEST_OFFENSE (ER split 3): the move is built SPECIAL (see mapSplit),
  // and PhotonGeyserCategoryAttr flips it to PHYSICAL at damage time when the
  // user's effective Atk > Sp.Atk — so it always strikes off the higher
  // offensive stat (Black Magic #801 on a Gengar deals off Sp.Atk; on a physical
  // attacker it flips to Atk).
  if (draft.split === 3 && category !== MoveCategory.STATUS) {
    move.addAttr(new PhotonGeyserCategoryAttr());
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

  // Layer on per-move secondary effects the auto-classifier under-wired. The
  // archetype rows reliably capture boost-type flags + a single status chance,
  // but miss high-crit, stat riders, multi-hit, leech-seed, conditional damage,
  // self-switch, and "cannot miss" — those are added here by ER move id (the
  // move analog of the ability composite-append). Additive: keeps the
  // archetype's flags. All stat/status/tag riders gate on Move.chance.
  applyErMoveBespokeRiders(move, draft.id);

  // CONTACT FIX: the Move constructor flags EVERY physical move as MAKES_CONTACT
  // by default, and vanilla non-contact physical moves clear it with
  // `.makesContact(false)`. ER custom moves never did — so all 132 custom
  // physical moves (beams, blasts, throws like Primal Beam) were wrongly contact,
  // triggering contact abilities (Static, Rough Skin) and taking contact damage
  // reduction (Fluffy → "did only 25%"). ER's flag data is authoritative: a move
  // makes contact iff its flag list includes "Makes Contact". Force the flag to
  // match so non-contact customs stop behaving like contact moves.
  move.makesContact(Array.isArray(draft.flags) && draft.flags.includes(ER_CONTACT_FLAG_INDEX));

  return move;
}

/**
 * Map ER's target-table index onto a pokerogue {@linkcode MoveTarget} (#366).
 * ER targets (er-move-tables ER_TARGET_NAMES):
 *   0 SELECTED / 5 DEPENDS  → keep the class default (single target);
 *   1 BOTH                  → all adjacent foes;
 *   2 USER                  → handled by the self-status split in the builder;
 *   3 RANDOM                → a random foe;
 *   4 FOES_AND_ALLY         → every OTHER mon on the field (Self-Destruct
 *                             spread — user report: Outburst hit one mon);
 *   6 ALL_BATTLERS          → field effects → both sides; damaging → ALL;
 *   7 OPPONENTS_FIELD       → the enemy side (entry hazards);
 *   8 ALLY / 9 USER_OR_ALLY → ally targets.
 */
function applyErMoveTarget(move: Move, erTarget: number, category: MoveCategory): void {
  switch (erTarget) {
    case 1:
      move.target(MoveTarget.ALL_NEAR_ENEMIES);
      break;
    case 3:
      move.target(MoveTarget.RANDOM_NEAR_ENEMY);
      break;
    case 4:
      move.target(MoveTarget.ALL_NEAR_OTHERS);
      break;
    case 6:
      move.target(category === MoveCategory.STATUS ? MoveTarget.BOTH_SIDES : MoveTarget.ALL);
      break;
    case 7:
      move.target(MoveTarget.ENEMY_SIDE);
      break;
    case 8:
      move.target(MoveTarget.NEAR_ALLY);
      break;
    case 9:
      move.target(MoveTarget.USER_OR_NEAR_ALLY);
      break;
    default:
      break;
  }
}

/**
 * Augment an ER-custom move with secondary effects the archetype classifier
 * missed (audited against each move's in-game description). Keyed by ER move id.
 * Chance-based riders inherit the move's `chance` (set from `effectChance`).
 */
/**
 * Swap the archetype's auto-added generic {@linkcode BattlerTagType.ER_DRENCHED}
 * applier (an `AddBattlerTagAttr` gated on the move's `chance` field, which the
 * systemic effectChance -1 bug leaves at "guaranteed") for a fixed-chance
 * {@linkcode ErDrenchAttr}. Every other archetype-wired attr is left intact.
 */
function replaceDrenchAttr(move: Move, drenchAttr: ErDrenchAttr): void {
  move.attrs = move.attrs.filter(a => !(a instanceof AddBattlerTagAttr && a.tagType === BattlerTagType.ER_DRENCHED));
  move.attrs.push(drenchAttr);
}

function applyErMoveBespokeRiders(move: Move, erId: number): void {
  switch (erId) {
    // (The genie-Storm quartet's ER field riders live in the VANILLA patch
    // layer — those ER moves map to vanilla MoveIds and never reach here.)
    // ---- High critical-hit ratio ----
    case 772: // Pixie Slash
    case 773: // Seismic Blade
    case 799: // Venom Bolt — "+1 crit" (20% poison from its chance-status row)
    case 803: // Blazing Arrow — +1 crit stage (dex "+1 crit chance"); 20% burn from its chance-status row
    case 804: // Rocket Shot — "+1 crit rate" (Mega Launcher from its flag row)
    case 995: // Berserker Horn
      move.attr(HighCritAttr);
      break;
    // ---- Secondary-effect chance corrections (ER data ships effectChance 0/wrong;
    // the archetype/classifier chance is not applied, so the secondary attr — added
    // by the dispatcher/archetype above — fires at the wrong rate. Set Move.chance
    // to the authoritative dex value here; the rider runs AFTER wiring so it wins. ----
    case 1014: // Spread Bomb — dex 30% burn (ER effectChance ships 20)
      move.chance = 30;
      break;
    case 1015: // Ball Toss — dex 20% flinch (ER effectChance ships 0 -> was guaranteed)
      move.chance = 20;
      break;
    case 1017: // Shot Put — dex 30% Speed drop (ER effectChance ships 0 -> was guaranteed)
      move.chance = 30;
      break;
    case 1021: // Pocket Sand — dex "10% acc drop, +1 priority". ER data ships
      // priority 0 and effectChance 0 (so the dispatcher's ACC drop was unconditional).
      // Force +1 priority and gate the ACC drop at 10%.
      move.priority = 1;
      move.chance = 10;
      break;
    // (Saber Slashes / 1019's 20% flinch chance lives in its multi-hit case below.)
    // ---- Drench-chance corrections (DRENCH now resolves to ER_DRENCHED; the
    // archetype auto-added a generic applier gated on the buggy move.chance -1
    // = guaranteed. Swap it for a fixed-chance ErDrenchAttr so the dex rate wins).
    // (Rapid River's drench lives in its multi-hit case below.) ----
    case 1004: // Waterlog — "Makes the target move last. 20% drench chance, 50% in rain."
      // ForceLastAttr = the guaranteed this-turn Quash ("makes the target move last");
      // ErDrenchAttr(20, 50) = the lasting 2-turn Drenched, rain-boosted to 50%.
      replaceDrenchAttr(move, new ErDrenchAttr(20, 50));
      move.attr(ForceLastAttr);
      break;
    case 1005: // Incite — "Adds the Dark type to the target and enrages them."
      // Guaranteed (chance -1) so the enrage isn't gated by a shipped effectChance
      // of 0. AddTypeAttr adds Dark to the target; ER_ENRAGE is the recoil status.
      move.chance = -1;
      move.attr(AddTypeAttr, PokemonType.DARK);
      move.attr(AddBattlerTagAttr, BattlerTagType.ER_ENRAGE, false);
      break;
    // ---- Depletion Beam — cut 3 PP from the foe's last move (ER effect 357, unwired).
    // Mega Launcher / PULSE boost already applied via its flag-tagged archetype row. ----
    case 993:
      move.attr(AttackReducePpMoveAttr, 3);
      break;
    case 994: // One-Inch Punch — high crit + never misses
      move.attr(HighCritAttr);
      move.accuracy = -1;
      break;
    case 813: // Homing Fletch — +1 crit (high crit) + cannot miss
      move.attr(HighCritAttr);
      move.accuracy = -1;
      break;
    case 779: // Supersonic Shot — always crits
      move.attr(CritOnlyAttr);
      break;
    case 842: // Rider Kick — "ignores the foe's ability. Can't miss." (Striker flag from archetype.)
      move.ignoresAbilities();
      move.accuracy = -1;
      break;
    case 797: // Diamond Arrow — "Cuts through foe's stat changes." (Archer flag from archetype.)
      move.attr(IgnoreOpponentStatStagesAttr);
      break;
    // ---- Cannot miss (perfect accuracy) ----
    case 792: // Asteroid Shot
    case 996: // Oni Fist
      move.accuracy = -1;
      break;
    // ---- Self stat raise (chance-gated by Move.chance) ----
    case 765: // Jagged Fangs — 10% raise user Atk
      move.attr(StatStageChangeAttr, [Stat.ATK], 1, true);
      break;
    case 783: // Lightning Strike — 20% raise user Speed
    case 981: // Zap Jive — 50% raise user Speed
    case 982: // Hex Trot — 50% raise user Speed
      move.attr(StatStageChangeAttr, [Stat.SPD], 1, true);
      break;
    case 980: // Esper Waltz — 50% raise user SpAtk
      move.attr(StatStageChangeAttr, [Stat.SPATK], 1, true);
      break;
    // ---- Self stat drop (always, Move.chance 100) ----
    case 941: // Molten Strike — lowers user Speed
    case 973: // Giant Gale — lowers user Speed
      move.attr(StatStageChangeAttr, [Stat.SPD], -1, true);
      break;
    // ---- Foe stat drop (chance-gated) ----
    case 771: // Pixie Beam — chance to lower the USER's SpAtk (Overheat-style;
      // ABBR: "drop user SpAtk"). Self-target.
      move.attr(StatStageChangeAttr, [Stat.SPATK], -1, true);
      break;
    case 812: // Phantom Glove — 30% lower foe Speed
    case 819: // Torrent Fist — 20% lower foe Speed
      move.attr(StatStageChangeAttr, [Stat.SPD], -1);
      break;
    case 943: // Earthsplitter — 50% lower foe Def
    case 987: // Icicle Impale — 30% lower foe Def
    case 997: // Insect Impact — 30% lower foe Def
      move.attr(StatStageChangeAttr, [Stat.DEF], -1);
      break;
    case 1031: // Rumble Kick — 20% lower foe Atk (ER effectChance ships 30)
      move.chance = 20;
      move.attr(StatStageChangeAttr, [Stat.ATK], -1);
      break;
    // ---- Status / tag chances (gated by Move.chance) ----
    // NOTE: 776/777 frostbite is supplied by their flag-tagged statusChance row
    // (now that resolveStatusName maps FROSTBITE) — do NOT re-add it here.
    case 759: // Smite — Smack Down effect (grounds the target; +paralyze via row)
      move.attr(FallDownAttr);
      break;
    case 927: // Femur Breaker — always paralyzes
      move.attr(StatusEffectAttr, StatusEffect.PARALYSIS);
      break;
    case 928: // Squeaky Hammer — 20% infatuate
      move.attr(AddBattlerTagAttr, BattlerTagType.INFATUATED, false, false, 0, 0);
      break;
    case 944: // Beetle Bash — 30% confuse
      move.attr(ConfuseAttr);
      break;
    // ---- Leech Seed chance ----
    case 786: // Fertile Fangs — 10% Leech Seed
    case 791: // Bramble Blast — 30% Leech Seed
      move.attr(LeechSeedAttr);
      break;
    // ---- Multi-hit (2–5) ----
    case 790: // Fairy Spheres — 2–5 hits AND hits the target's Special Defense
      // (split 6 = HITS_SPDEF; a physical-category move damaging vs SpDef, the
      // move-side mirror of Psyshock).
      move.attr(MultiHitAttr);
      move.attr(SpDefDefAttr);
      break;
    case 845: // Blazing Bone (fiery bone ×2–5; +1 priority is move data)
    case 947: // Toxic Needles (already has poison status)
    case 952: // Relentless Clobber
    case 953: // Popping Mayhem (already has burn status)
    case 1001: // Five-Star Fury
    case 1018: // Block Dropper (2–5 "blocks"; row flipped off the bogus flinch)
      move.attr(MultiHitAttr);
      break;
    case 828: // Wyrm Wind — special Scale Shot: 2–5 hits, then raises user
      // Speed +1 and lowers user SpDef -1. Like vanilla Scale Shot, the self
      // stat changes fire ONCE after the full multi-hit sequence
      // (lastHitOnly), not once per strike.
      move.attr(MultiHitAttr);
      move.attr(StatStageChangeAttr, [Stat.SPD], 1, true, { lastHitOnly: true });
      move.attr(StatStageChangeAttr, [Stat.SPDEF], -1, true, { lastHitOnly: true });
      break;
    case 1013: // Chiller — 3 snowballs; 10% frostbite handled by chance-status row
      move.attr(MultiHitAttr, MultiHitType.THREE);
      break;
    case 832: // Boiling Flame — Fire move that "deals increased damage in rain".
      // Fire is naturally HALVED in rain (0.5×), so a ×3 power multiplier nets a
      // 1.5× hit in rain (mirroring Water's rain boost) instead of being weakened.
      move.attr(MovePowerMultiplierAttr, () => {
        const w = globalScene.arena.weather;
        const inRain =
          !!w
          && !w.isEffectSuppressed()
          && (w.weatherType === WeatherType.RAIN || w.weatherType === WeatherType.HEAVY_RAIN);
        return inRain ? 3 : 1;
      });
      break;
    // ---- Multi-hit (3, escalating power) ----
    case 826: // Whirling Strikes
      move.attr(MultiHitAttr, MultiHitType.THREE);
      move.attr(MultiHitPowerIncrementAttr, 3);
      break;
    // ---- Conditional 2× damage by target status ----
    case 768: // Plasma Pulse — 2× vs statused foe
      move.attr(MovePowerMultiplierAttr, (_u, t) => (t?.status && t.status.effect !== StatusEffect.NONE ? 2 : 1));
      break;
    case 784: // Volt Bolt — 2× vs paralyzed
      move.attr(MovePowerMultiplierAttr, (_u, t) => (t?.status?.effect === StatusEffect.PARALYSIS ? 2 : 1));
      break;
    case 960: // Dream Invasion — 2× vs sleeping
      move.attr(MovePowerMultiplierAttr, (_u, t) => (t?.status?.effect === StatusEffect.SLEEP ? 2 : 1));
      break;
    // ---- Self-switch after damage ----
    case 848: // Ghastly Echo (rom): "Deals damage and switches. Switch-in gets
      // 50% boost for 1 turn. Sound-based." Damage + force-switch + SOUND_BASED
      // are wired here. The "switch-in gets +50% move power for 1 turn" half is
      // the ErGhastlyEchoSwitchAttr rider: its self-switch arms a per-side latch
      // (empower-switch-in.ts) that SummonPhase.onEnd consumes, tagging the
      // incoming replacement with the one-turn +50% ER_EMPOWERED_SWITCH_IN
      // battler tag (read in Move.getPower). Take Flight (976) keeps the plain
      // ForceSwitchOutAttr — only 848 empowers its switch-in.
      move.attr(ErGhastlyEchoSwitchAttr);
      move.soundBased();
      break;
    case 976: // Take Flight
      move.attr(ForceSwitchOutAttr, true);
      break;
    case 807: // Draco Missile - "Hits both foes on the field." The ER target
      // field is 0 (single target) because the dex entry is half-finished (its
      // short description literally reads "Not done yet."), but the authoritative
      // longDescription says it hits both foes, so make it a both-foes spread move.
      move.target(MoveTarget.ALL_NEAR_ENEMIES);
      break;
    // ---- Double damage / super-effective vs a specific defender type ----
    // ER's "double damage on X" / "super-effective vs X" — a ×2 power multiplier
    // when the target is of that type (matches the stated damage outcome).
    case 756: // Excalibur — high crit + 2× vs Dragon
      move.attr(HighCritAttr);
      move.attr(MovePowerMultiplierAttr, (_u, t) => (t?.isOfType(PokemonType.DRAGON) ? 2 : 1));
      break;
    case 796: // Clay Dart — super-effective vs Flying. Clay Dart is GROUND-type
      // (ER type 9), which is normally IMMUNE to Flying (0×) — same problem as
      // Aura Force, so use the immunity-safe type-chart override (forces the
      // Flying component to 2×) instead of a power multiplier on a 0× hit.
      move.attr(ErSuperEffectiveVsTypeAttr, PokemonType.FLYING);
      break;
    case 800: // Fumigation Bomb — super-effective vs Bug (#374: chart
      // override, not a silent power multiplier — shows the SE message and
      // stacks correctly on dual types).
      move.attr(ErSuperEffectiveVsTypeAttr, PokemonType.BUG);
      break;
    case 806: // Aura Force — super-effective vs Ghost (Fighting is normally
      // immune to Ghost; a power multiplier on a 0× hit stays 0, so use a
      // type-chart override that substitutes Ghost's contribution with 2× —
      // this both lets the move HIT Ghosts and makes it super-effective.
      move.attr(ErSuperEffectiveVsTypeAttr, PokemonType.GHOST);
      break;
    case 933: // Crackle Slam — super-effective vs Steel (#374: chart override).
      move.attr(ErSuperEffectiveVsTypeAttr, PokemonType.STEEL);
      break;
    case 1002: // Tsunami Hammer — super-effective vs WATER + can't be used
      // twice. #374: was wired to the wrong type (Poison, from the stale long
      // description) AND as a power multiplier — a Water move into a Water
      // target stayed resisted. The in-game description and the tester report
      // agree on Water; the chart override makes the matchup truly 2x.
      move.attr(ErSuperEffectiveVsTypeAttr, PokemonType.WATER);
      move.restriction(consecutiveUseRestriction);
      break;
    // ---- Ignore the target's stat-stage changes (Chip Away-style) ----
    case 755: // Deathroll — also ignores target's stat changes (has ConfuseAttr)
      move.attr(IgnoreOpponentStatStagesAttr);
      break;
    // ---- Accuracy drop on the foe ----
    case 1011: // Prism Blast — RELIABLY reduces foe accuracy (dex), plus a 10% confuse
      // (its chance-status row, gated by Move.chance=10). The accuracy drop must not
      // share that 10% gate, so force it to 100% via effectChanceOverride.
      move.attr(StatStageChangeAttr, [Stat.ACC], -1, false, { effectChanceOverride: 100 });
      break;
    // ---- Bleed / fear riders (ER tags), gated by Move.chance ----
    case 956: // Rip and Tear — lowers foe Speed + can't be used twice
      // (50% bleed comes from its chance-status BLEED row).
      move.attr(StatStageChangeAttr, [Stat.SPD], -1);
      move.restriction(consecutiveUseRestriction);
      break;
    case 958: // Terror Charge — 50% fear + 2× on the turn it switches in
      // (50% bleed comes from its chance-status BLEED row).
      move.attr(AddBattlerTagAttr, BattlerTagType.ER_FEAR, false, false, 2, 2);
      move.attr(MovePowerMultiplierAttr, u => (u?.tempSummonData?.waveTurnCount === 1 ? 2 : 1));
      break;
    // ---- Trap + make the target always-hittable ----
    case 937: // Pitfall — ONE 30% roll trapping the foe AND making attacks always
      // hit it (both effects share the single roll). Was two independent
      // AddBattlerTagAttr rolls (P(both) ~= 9%, often only one landed).
      move.attr(PitfallTrapAndAlwaysHitAttr);
      break;
    // Eerie Fog (950): the EERIE_FOG weather (wired in move-archetype-dispatcher)
    // drains positive boosts each turn from non-Ghost/Psychic mons, honoring the
    // Ghost/Psychic immunity. The old immediate ResetStatsAttr(false) rider full-
    // reset only the single target and ignored that immunity, so it is removed —
    // the weather's per-turn decay is the faithful mechanic.
    // ---- Break the target's screens (Light Screen / Reflect / Aurora Veil) ----
    case 762: // Iron Fangs
      move.attr(RemoveScreensAttr, (_user, target) => (target.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY));
      break;
    // ---- Sets Stealth Rock on the foe's field ----
    case 787: // Scatter Blast — scatters Stealth Rocks onto the foe's side
      move.attr(AddArenaTrapTagAttr, ArenaTagType.STEALTH_ROCK);
      break;
    case 798: // Diamond Blade — "10% chance of Stealth Rocks" (Keen Edge boost is
      // the SLICING flag from the archetype row; move.chance = 10 gates the hazard).
      move.attr(AddArenaTrapTagAttr, ArenaTagType.STEALTH_ROCK);
      break;
    // ---- Sets Sticky Web on the foe's field + high crit ----
    case 805: // Web Shot — "Sets up Sticky Web. +1 crit chance." (Archer boost is
      // the ARROW flag from the archetype row; the hazard + crit were unwired.)
      move.attr(HighCritAttr);
      move.attr(AddArenaTrapTagAttr, ArenaTagType.STICKY_WEB);
      break;
    // ---- Crash damage on miss (High Jump Kick-style) ----
    case 780: // Zephyr Rush — hurts the user on miss
      move.attr(MissEffectAttr, crashDamageFunc);
      break;
    // ---- "Can't be used twice in a row" (consecutive-use restriction) ----
    case 859: // Hacksaw
    case 893: // Blue Moon (crimson)
    case 963: // Spectral Serenade (every-other turn)
    case 964: // Merculight (may fail if used in succession)
    case 1000: // Blue Moon (azure)
      move.restriction(consecutiveUseRestriction);
      break;
    // ---- Field manipulation ----
    case 896: // Smashin' Realities — removes weather AND terrain (any active)
      move.attr(ClearTerrainAttr);
      for (const w of [
        WeatherType.SUNNY,
        WeatherType.RAIN,
        WeatherType.SANDSTORM,
        WeatherType.HAIL,
        WeatherType.SNOW,
        WeatherType.FOG,
        WeatherType.HEAVY_RAIN,
        WeatherType.HARSH_SUN,
        WeatherType.STRONG_WINDS,
      ]) {
        move.attr(ClearWeatherAttr, w);
      }
      break;
    case 930: // Smashing Pumpkins — sets Grassy Terrain
      move.attr(TerrainChangeAttr, TerrainType.GRASSY);
      break;
    case 934: // Squall Hammer — clears hazards from both sides
      move.attr(RemoveArenaTrapAttr, () => ArenaTagSide.BOTH);
      break;
    // ---- Force the foe to switch out ----
    case 926: // Wild Swing — forces the target to switch (-6 priority is move data)
      move.attr(ForceSwitchOutAttr);
      break;
    // ---- Break the target's screens ----
    case 936: // Battering Ram — breaks barriers (Light Screen/Reflect/Aurora Veil)
      move.attr(RemoveScreensAttr, (_user, target) => (target.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY));
      break;
    // ---- Transfer the user's status to the target, curing the user (Psycho Shift) ----
    case 938: // Viral Strike
      move.attr(PsychoShiftEffectAttr);
      break;
    // ---- Drowsiness (Yawn-style sleep-next-turn) ----
    case 940: // Bonk — 50% chance to drowse
      move.attr(AddBattlerTagAttr, BattlerTagType.DROWSY, false, false, 1, 1);
      break;
    // ---- Delayed attack (Future Sight-style) ----
    case 942: // Mirage Slam — predicts a delayed hit
      move.attr(DelayedAttackAttr, ChargeAnim.FUTURE_SIGHT_CHARGING, "moveTriggers:foresawAnAttack");
      break;
    // ---- Multi-hit (2 fixed) ----
    case 946: // Rapid River — "A surge of water that hits twice. 10% drench chance."
      move.attr(MultiHitAttr, MultiHitType.TWO);
      // Drench (ER_DRENCHED) at a fixed 10%; swap out the archetype's generic
      // move.chance-gated applier so the dex rate wins over the -1 bug.
      replaceDrenchAttr(move, new ErDrenchAttr(10));
      break;
    case 1019: // Saber Slashes (Iron Saber) — "Hits twice. Uses elec. or fire based
      // on effectiveness." The Electric/Fire best-effectiveness type pick + flinch
      // come from the type-conversion archetype dispatch; only the 2nd hit was
      // missing, so it struck once. Add the fixed 2-hit here.
      move.attr(MultiHitAttr, MultiHitType.TWO);
      // dex "20% flinch" (ER effectChance ships 0 -> was guaranteed without this).
      move.chance = 20;
      break;
    // ---- Conditional 1.5× vs a bleeding target ----
    case 959: // Terror Locks — 50% more damage if the foe is bleeding (+30% bleed via row)
      move.attr(MovePowerMultiplierAttr, (_u, t) => (t?.getTag(BattlerTagType.ER_BLEED) ? 1.5 : 1));
      break;
    // ---- Ignore the target's stat-stage boosts (Sacred Sword / Chip Away) ----
    case 968: // Astral Hand — "Strikes with a projected fist. Ignores stat boosts."
    case 992: // Fire Glaive — "Strikes with a white hot horn, ignoring stat changes."
      move.attr(IgnoreOpponentStatStagesAttr);
      break;
    // ---- 30% chance to inflict bleeding (effectChance gates via move.chance) ----
    case 986: // Dragon Jab — "30% chance to inflict bleeding."
      move.attr(AddBattlerTagAttr, BattlerTagType.ER_BLEED, false, false, 4, 6);
      break;
    // ---- +1 crit chance + 50% bleed (effectChance gates via move.chance) ----
    case 816: // Devious Shot — "+1 crit chance. 50% bleed chance." The
      // flag-tagged-move archetype (ARROW + statusChance:{50,BLEED}) ALREADY wires
      // the 50% ER_BLEED, so ONLY the +1 crit is added here — a second bleed attr
      // would roll independently and inflate the proc to ~75%.
      move.attr(HighCritAttr);
      break;
    case 809: // Jagged Horns — "10% flinch chance. 10% bleed chance." The
      // flag-tagged archetype wires the 10% flinch (move.chance) + HORN_BASED;
      // add the SEPARATE, independently-rolled 10% ER_BLEED (4-6 turns like the
      // other bleed moves) that the archetype's single statusChance slot dropped.
      move.attr(AddBattlerTagAttr, BattlerTagType.ER_BLEED, false, false, 4, 6);
      break;
    // ---- Damaging move that also makes the user eat one of its own berries ----
    case 830: // Berry Smash — "Deals damage. User eats their berry." The classifier
      // only tagged it HAMMER_BASED (applied via the flag-tagged-move dispatch) and
      // missed the berry-eat clause, so it never consumed a berry. EatBerryAttr
      // already picks a RANDOM held berry when the user holds several (the user's
      // multi-berry case), mirroring Concoction (id 1022) / Stuff Cheeks.
      move.attr(EatBerryAttr, true);
      break;
  }
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
