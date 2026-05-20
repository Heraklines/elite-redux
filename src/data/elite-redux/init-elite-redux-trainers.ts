// =============================================================================
// Elite Redux — Phase B Task B4: register the 895 ER trainers in a dedicated
// in-memory registry.
//
// Pokerogue keys trainers off a numeric `TrainerType` enum (vanilla range
// ~0-380, ER customs ≥ 1000 per `er-id-map.ts`). Each `TrainerType` slot maps
// to exactly one `TrainerConfig` in `trainerConfigs`, and the configs are
// pool-based (random species drawn at battle time from `setSpeciesPools`).
//
// ER trainers are fundamentally different: every encounter ships a FIXED
// roster — exact species, EVs/IVs, moves, items, ability slot, nature. There
// are 895 of them but they share only ~64 trainer-class types. Cramming them
// into pokerogue's `trainerConfigs` would lose the fixed-roster identity
// because multiple trainers would collide on a single `TrainerType` key.
//
// SOLUTION (B4 scope): keep the ER trainers in a SEPARATE registry keyed by
// `stableKey` (the trainer name from the v2.65 dump). The pokerogue battle
// layer pulls from this registry when an ER encounter fires — that wiring is
// deferred to Phase B7 / Phase C. B4 just makes the data available in a
// usable shape: `ER_TRAINER_REGISTRY` (array, insertion-ordered) and
// `ER_TRAINER_BY_KEY` (lookup map).
//
// Each registry entry resolves the ER ids on its party members through
// `ER_ID_MAP` (species, moves) so consumers downstream don't need to
// re-translate. Items don't yet have an id-map entry — the registry stores
// the raw ER item id, to be mapped in a later phase.
//
// Tiered parties: ER ships `party` (Easy), `insaneParty` (mid), `hellParty`
// (hardest). All three are normalized identically. The choice of which tier
// to use at battle time is the encounter generator's responsibility — the
// registry exposes all three.
//
// Order constraint: must run AFTER `initEliteReduxCustomSpecies()` (so the
// custom species ids exist in `allSpecies`) and AFTER
// `initEliteReduxCustomMoves()` (so the custom move ids exist in `allMoves`).
// We don't directly look up species/moves here (we only translate ids), but
// keeping the order consistent means any downstream consumer can assume the
// translated ids are resolvable.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_TRAINER_CLASS_NAMES } from "#data/elite-redux/er-trainer-tables";
import type { ErPartyMember, ErTrainerDraft } from "#data/elite-redux/er-trainers";
import { ER_TRAINERS } from "#data/elite-redux/er-trainers";

/**
 * Default level applied to every registered ER party member. ER's v2.65 dump
 * does NOT carry a per-member `level` field — levels in the upstream engine
 * are resolved from the encounter's map/area and the active difficulty
 * curve, neither of which Phase B has wired up yet.
 *
 * 50 is a sensible placeholder: it's a common Smogon/competitive level and
 * keeps the test surface predictable. Phase B7/C will replace this with a
 * proper level lookup (likely keyed off `draft.map` and the tier choice).
 */
const ER_DEFAULT_LEVEL = 50;

/**
 * Cutoff for "vanilla pokerogue" `TrainerType` enum values. ER-custom trainer
 * classes (e.g. Pkmn Trainer 2, Sis And Bro) get fresh ids ≥ 1000 from the
 * id-map builder. Mirrors the value in
 * `scripts/elite-redux/builders/id-map.mjs`.
 */
const VANILLA_TRAINER_TYPE_CUTOFF = 1000;

/**
 * One fully-resolved party member ready for the battle layer. All ER ids
 * (species, moves) have been translated through `ER_ID_MAP`. The `itemId` is
 * still the raw ER index — see file header.
 */
export interface ErPartyMemberRegistered {
  /** Pokerogue species id (vanilla < 10000, ER-custom ≥ 10000). */
  readonly speciesId: number;
  /** Encounter level — placeholder; see `ER_DEFAULT_LEVEL`. */
  readonly level: number;
  /** Index into `PokemonSpecies.abilities[0..2]` (active ability pick). 0 / 1 / 2. */
  readonly abilitySlot: 0 | 1 | 2;
  /** [HP, ATK, DEF, SPD, SPATK, SPDEF] — gen3 layout, 0-31 per stat. */
  readonly ivs: readonly [number, number, number, number, number, number];
  /** [HP, ATK, DEF, SPD, SPATK, SPDEF] — gen3 layout, 0-252 per stat. */
  readonly evs: readonly [number, number, number, number, number, number];
  /** Raw ER item id (NOT yet mapped — no item id-map exists in B4). */
  readonly itemId: number;
  /** Gen3 nature index (0-24). */
  readonly nature: number;
  /** Pokerogue move ids (vanilla < 5000, ER-custom ≥ 5000). */
  readonly moves: readonly number[];
  /** Hidden Power type (gen3 index 0-15). */
  readonly hpType: number;
}

/** One ER trainer with all ID translations applied. */
export interface ErTrainerRegistryEntry {
  /** Unique trainer name (e.g. "May Route 103 Treecko", "Rick"). */
  readonly stableKey: string;
  /** ER's own index into the v2.65 dump (unstable across SHA bumps — prefer `stableKey`). */
  readonly id: number;
  /** Pokerogue `TrainerType` numeric value (vanilla < 1000, ER-custom ≥ 1000). */
  readonly trainerType: number;
  /** Human-readable trainer class name (e.g. "Hiker", "Team Aqua"). */
  readonly trainerClassName: string;
  /** True if the encounter is a double battle. */
  readonly isDouble: boolean;
  /** ER's `map` index (decoded by `ER_MAP_NAMES`). */
  readonly map: number;
  /** Default-difficulty party (always present). */
  readonly party: readonly ErPartyMemberRegistered[];
  /** Mid-difficulty party (~half of ER trainers have one). */
  readonly insaneParty: readonly ErPartyMemberRegistered[] | null;
  /** Hardest-difficulty party (~half of ER trainers have one). */
  readonly hellParty: readonly ErPartyMemberRegistered[] | null;
}

/**
 * Result of one `initEliteReduxTrainers()` run. Mirrors the shape of the
 * earlier B-phase initializers.
 */
export interface InitEliteReduxTrainersResult {
  /** Number of trainers newly inserted into the registry on this call. */
  trainersRegistered: number;
  /** Number of trainers skipped because they were already present (idempotent re-run). */
  trainersSkipped: number;
  /**
   * Number of trainers dropped because at least one party member referenced
   * an ER species id that isn't in `ER_ID_MAP.species` (and isn't in the
   * species dump at all). This is pre-existing ER-data drift — the v2.65
   * trainer dump references gen3 species constants like 1175, 1187, 1437
   * etc. that were never carried into the species dump. There is nothing the
   * registry can do here: a trainer with an unknown species cannot be safely
   * battled, so we drop the whole entry.
   *
   * TODO(infra): triage the missing-species set with the ER source dumps and
   *              extend `er-species.ts` / `er-id-map.ts` upstream to cover
   *              the gap. Until then, ~370 trainers (~40%) are unbattleable.
   */
  trainersDroppedMissingSpecies: number;
  /** Non-fatal real issues — e.g. trainerClass id-map failures (vs species drift). */
  errors: string[];
}

/**
 * In-memory registry of all ER trainers. Populated by
 * `initEliteReduxTrainers()`. Insertion-ordered to match the ER dump order.
 * Consumers should treat this as read-only after initialization completes.
 */
export const ER_TRAINER_REGISTRY: ErTrainerRegistryEntry[] = [];

/**
 * O(1) lookup by trainer name. Both the array and this map are mutated in
 * lock-step by the initializer.
 */
export const ER_TRAINER_BY_KEY: Map<string, ErTrainerRegistryEntry> = new Map();

/**
 * Build the ER trainer registry. Idempotent — a second call skips trainers
 * whose `stableKey` is already present.
 *
 * Each `ErTrainerDraft` is normalized: ER species and move ids are
 * translated through `ER_ID_MAP`, the trainer class id through
 * `ER_ID_MAP.trainerClasses`. Defaults applied:
 *   - level: `ER_DEFAULT_LEVEL` (50) — ER doesn't ship per-member levels
 *   - itemId: raw ER index (no item map yet)
 *
 * Failures (e.g. an ER species id with no id-map entry) are collected into
 * `result.errors` and the offending trainer is SKIPPED. The registry never
 * contains partially-resolved entries.
 *
 * @returns A summary of trainers registered, skipped, and any errors.
 */
export function initEliteReduxTrainers(): InitEliteReduxTrainersResult {
  const result: InitEliteReduxTrainersResult = {
    trainersRegistered: 0,
    trainersSkipped: 0,
    trainersDroppedMissingSpecies: 0,
    errors: [],
  };

  for (const draft of ER_TRAINERS) {
    if (ER_TRAINER_BY_KEY.has(draft.stableKey)) {
      result.trainersSkipped++;
      continue;
    }
    try {
      const entry = buildRegistryEntry(draft);
      ER_TRAINER_REGISTRY.push(entry);
      ER_TRAINER_BY_KEY.set(entry.stableKey, entry);
      result.trainersRegistered++;
    } catch (err) {
      if (err instanceof MissingSpeciesError) {
        // ER-data drift — counted separately, not flagged as an error.
        result.trainersDroppedMissingSpecies++;
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Trainer ${draft.stableKey} (er id ${draft.id}): ${msg}`);
    }
  }

  return result;
}

/**
 * Sentinel thrown when a party member references an ER species id that has
 * no `ER_ID_MAP.species` entry. Used internally to distinguish data drift
 * (silent skip) from real errors (logged + reported).
 */
class MissingSpeciesError extends Error {
  constructor(speciesId: number) {
    super(`No id-map entry for species ${speciesId}`);
    this.name = "MissingSpeciesError";
  }
}

/**
 * Translate one `ErTrainerDraft` into a fully-resolved registry entry.
 * Throws on unrecoverable id-map failures (which propagate to the caller's
 * error list).
 */
function buildRegistryEntry(draft: ErTrainerDraft): ErTrainerRegistryEntry {
  const trainerType = ER_ID_MAP.trainerClasses[draft.trainerClass];
  if (trainerType === undefined) {
    throw new Error(`No id-map entry for trainerClass ${draft.trainerClass}`);
  }

  const trainerClassName = ER_TRAINER_CLASS_NAMES[draft.trainerClass] ?? "Unknown";

  return {
    stableKey: draft.stableKey,
    id: draft.id,
    trainerType,
    trainerClassName,
    isDouble: draft.isDouble,
    map: draft.map,
    party: draft.party.map(resolvePartyMember),
    insaneParty: draft.insaneParty ? draft.insaneParty.map(resolvePartyMember) : null,
    hellParty: draft.hellParty ? draft.hellParty.map(resolvePartyMember) : null,
  };
}

/**
 * Resolve a single party member's ER ids to pokerogue ids. The species id
 * must resolve; moves with no map entry are filtered out (this can happen
 * for `move 0` "----" sentinels in incomplete movesets).
 */
function resolvePartyMember(member: ErPartyMember): ErPartyMemberRegistered {
  const speciesId = ER_ID_MAP.species[member.species];
  if (speciesId === undefined) {
    throw new MissingSpeciesError(member.species);
  }

  const mappedMoves: number[] = [];
  for (const move of member.moves) {
    const mapped = ER_ID_MAP.moves[move];
    if (mapped !== undefined) {
      mappedMoves.push(mapped);
    }
    // Skip silently: move 0 ("----") and any rare drift are dropped — the
    // battle layer expects 1-4 moves and tolerates short movesets.
  }

  // The ER dump uses ability slot 0/1/2 verbatim. Clamp defensively in case
  // a future dump ships out-of-range values.
  const rawSlot = member.abilitySlot;
  const abilitySlot: 0 | 1 | 2 = rawSlot === 1 ? 1 : rawSlot === 2 ? 2 : 0;

  return {
    speciesId,
    level: ER_DEFAULT_LEVEL,
    abilitySlot,
    ivs: [member.ivs[0], member.ivs[1], member.ivs[2], member.ivs[3], member.ivs[4], member.ivs[5]] as const,
    evs: [member.evs[0], member.evs[1], member.evs[2], member.evs[3], member.evs[4], member.evs[5]] as const,
    itemId: member.item,
    nature: member.nature,
    moves: mappedMoves,
    hpType: member.hpType,
  };
}

/**
 * Re-export the vanilla/custom TrainerType cutoff so consumers (and tests)
 * can branch on whether a trainer's pokerogue id is a vanilla type or an
 * ER-fresh slot. Not used internally — exported for downstream wiring.
 */
export const ER_TRAINER_TYPE_CUTOFF: number = VANILLA_TRAINER_TYPE_CUTOFF;
