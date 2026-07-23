// =============================================================================
// Elite Redux — trainer-runtime hook.
//
// Connects the inert `er-trainer-overlay.ts` helper to pokerogue's live
// trainer-party generation. When a pokerogue `Trainer` is about to roll a
// party member (in `Trainer.genPartyMember(index)`), this hook checks the
// ER registry for a trainer whose `trainerType` matches the encountered
// trainer's class. If a match exists, the hook constructs an
// `EnemyPokemon` directly from the ER roster — species, moves, IVs/EVs,
// nature, ability slot — and returns it; otherwise it returns `null` and
// vanilla pokerogue generation continues unchanged.
//
// Why hook `genPartyMember` rather than re-architecting the trainer path?
// Pokerogue's party generation is mode-specific (classic vs daily vs
// challenge) but every mode funnels through `genPartyMember`. Hooking
// here is the minimum-surface-area integration: same call site, same
// signature, same return type. The hook is OPT-IN — it only activates
// when an ER trainer matches.
//
// Trainer selection strategy (matching ER stableKey to a live Trainer):
//   1. Match by `config.trainerType`. Each ER trainer carries a mapped
//      pokerogue `TrainerType` (the trainer class — Hiker, Ace Trainer,
//      Lass, etc.). Multiple ER trainers share a class; the first match
//      is used (deterministic / seeded selection is a future enhancement).
//   2. Trainer is memoized per `Trainer` instance via a WeakMap, so all
//      `genPartyMember(0..n)` calls within one battle resolve to the
//      same ER roster. Without memoization, a multi-member ER party
//      could rotate between different ER trainers per slot.
//
// Tier selection is currently fixed at "party" (Easy). Difficulty-gated
// tier selection (insane / hell) is a follow-up that requires a project-
// wide difficulty flag.
//
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  ER_TRAINER_BY_KEY,
  ER_TRAINER_REGISTRY,
  type ErPartyMemberRegistered,
  type ErTrainerRegistryEntry,
} from "#data/elite-redux/init-elite-redux-trainers";
import { erRivalWaveOrdinal, erRivalWaveSequence } from "#data/elite-redux/er-battle-frequency";
import { ER_FACTORY_SETS } from "#data/elite-redux/er-factory-sets";
import { erBalanceMap, erBalanceNum, erBalancePairs } from "#data/elite-redux/er-balance-tuning";
import { isErCustomTrainerBstBypassActive } from "#data/elite-redux/er-custom-trainer-bst-flag";
import { modifierTypes } from "#data/data-lists";
import { getErBiomeItemFlavor } from "#data/elite-redux/er-biome-item-flavor";
import { erBiomeRoutingActive } from "#data/elite-redux/er-biome-routing";
import { erNotorietyBstBonus } from "#data/elite-redux/er-biome-notoriety";
import {
  erFactoryExcludedDraftIds,
  erFactoryOverriddenDraftIds,
  erFactorySetOverrideEntries,
  erTunedFactoryTeamPct,
} from "#data/elite-redux/er-trainer-tuning";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { erBattleFormDumpToBaseSpeciesId } from "#data/elite-redux/init-elite-redux-er-custom-form-changes";
import { ER_MEGA_FORMS } from "#data/elite-redux/er-mega-forms";
import { ER_MEGA_STONE_NAME_BY_ITEM } from "#data/elite-redux/er-mega-stone-item-ids";
import { grantErResistBerries, maybeAssignErResistBerry } from "#data/elite-redux/er-resist-berries";
import { grantErWardStone, maybeAssignErWardStone } from "#data/elite-redux/er-ward-stones";
import { erDifficultyToRosterTier, getErDifficulty, isErVanillaDifficulty } from "#data/elite-redux/er-run-difficulty";
import { type ErRosterTier, selectErRoster } from "#data/elite-redux/er-trainer-overlay";
import { resolveErTrainerItem } from "#data/elite-redux/er-trainer-item-map";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { BaseStatModifier, type PokemonHeldItemModifier } from "#modifiers/modifier";
import { BaseStatBoosterModifierType } from "#modifiers/modifier-type";
import { PERMANENT_STATS } from "#enums/stat";
import type { Nature } from "#enums/nature";
import { PlayerGender } from "#enums/player-gender";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";

/**
 * Deterministic FNV-1a hash → uint32. Drives the wave-appropriate trainer pick's
 * variety from the RUN SEED (+ wave + type) WITHOUT touching the live battle RNG.
 * This keeps selection reproducible (same encounter → same pick, so party
 * generation stays stable) while making different runs field different trainers.
 */
function hashErSelectionSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
import { TrainerVariant } from "#enums/trainer-variant";
import type { PokemonSpecies, PokemonSpeciesForm } from "#data/pokemon-species";
import type { EnemyPokemon } from "#field/pokemon";
import type { Trainer } from "#field/trainer";
import { PokemonMove } from "#moves/pokemon-move";
import { randSeedShuffle } from "#utils/common";
import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/**
 * Cache of selected ER trainer per pokerogue Trainer instance. The cached
 * value is either an `ErTrainerRegistryEntry` (matched) or `null` (no
 * match — vanilla generation should run). Using a WeakMap so destroyed
 * Trainer instances don't keep the cache alive.
 */
let TRAINER_CACHE: WeakMap<Trainer, ErTrainerRegistryEntry | null> = new WeakMap();

/**
 * Per-Trainer cache of the shuffled roster ordering. ER rosters are usually
 * LARGER than the wave's party size, so without this the engine always takes
 * `roster[0..size-1]` — the same Pokémon every run. We instead pick a random
 * subset by shuffling the roster index order once and reading `order[index]`.
 *
 * The shuffle is seeded by the wave seed (with a fixed offset), so it is:
 *   - stable WITHIN a battle — every `genPartyMember(0..size-1)` call and any
 *     save/load reload of the same wave reproduce the same team, and
 *   - varied ACROSS runs/encounters — a different wave seed reshuffles.
 * Keyed by the live Trainer instance + tier (a WeakMap, so it GCs with the
 * trainer). Recomputed if the tier changes (defensive; tier is wave-fixed).
 */
let ROSTER_ORDER_CACHE: WeakMap<Trainer, { tier: ErRosterTier; order: readonly number[] }> = new WeakMap();

/** Fixed seed offset for the roster shuffle — distinct from the per-member index offsets (0..n). */
const ER_ROSTER_SHUFFLE_SEED_OFFSET = 0x5e1ec7;

/**
 * Return a stable, wave-seeded permutation of `[0..rosterLength-1]` for this
 * trainer + tier (see {@link ROSTER_ORDER_CACHE}). The engine then maps each
 * requested party slot through it, so a larger ER roster rotates which members
 * appear instead of always fielding the first N.
 */
export function getRosterOrder(trainer: Trainer, rosterLength: number, tier: ErRosterTier): readonly number[] {
  const cached = ROSTER_ORDER_CACHE.get(trainer);
  if (cached && cached.tier === tier && cached.order.length === rosterLength) {
    return cached.order;
  }
  const indices = Array.from({ length: rosterLength }, (_, i) => i);
  let order: number[] = indices;
  globalScene.executeWithSeedOffset(
    () => {
      order = randSeedShuffle(indices);
    },
    ER_ROSTER_SHUFFLE_SEED_OFFSET,
    globalScene.waveSeed,
  );
  ROSTER_ORDER_CACHE.set(trainer, { tier, order });
  return order;
}

/**
 * The ER held-item id the roster member carried, stashed per generated enemy so
 * `applyErTrainerHeldItems` (run after PokeRogue's baseline item roll) can apply
 * the soft ER → PokeRogue item conversion.
 */
const ER_ITEM_BY_POKEMON = new WeakMap<EnemyPokemon, number>();

/**
 * Inspect the live Trainer and decide which ER roster (if any) drives
 * its party. Side-effect: caches the choice on the Trainer instance so
 * downstream calls for the same trainer return the same registry entry.
 *
 * Returns `null` when no ER trainer matches — caller should let vanilla
 * generation proceed.
 */
/**
 * ER trainer stableKeys already used this run, so a difficulty's pool doesn't
 * repeat the same ER trainer. Run-scoped; reset at run start via
 * {@link resetErRunTrainerTracking} (called from starter-select on launch).
 */
const USED_ER_TRAINER_KEYS = new Set<string>();

/** Reset the per-run "already encountered" ER trainer set (new run start). */
export function resetErRunTrainerTracking(): void {
  USED_ER_TRAINER_KEYS.clear();
}

/**
 * Snapshot the per-run used-trainer set for saving with the session. Without
 * this the set lived only in memory, so reloading/resuming a run wiped it and
 * the difficulty's pool started over — re-fielding the same (weakest-first)
 * trainers you'd already fought. Persisting it keeps the no-repeat guarantee
 * across save/load.
 */
export function getErUsedTrainerKeys(): string[] {
  return [...USED_ER_TRAINER_KEYS];
}

/**
 * Restore the used-trainer set from saved session data (called on load instead
 * of {@link resetErRunTrainerTracking}, so a continued run keeps its history).
 */
export function restoreErRunTrainerTracking(keys: readonly string[] | undefined): void {
  USED_ER_TRAINER_KEYS.clear();
  for (const k of keys ?? []) {
    USED_ER_TRAINER_KEYS.add(k);
  }
}

/**
 * Wave by which the strongest trainers of a type are reached. Maps a run's wave
 * depth onto a 0..1 fraction used to index the strength-ordered pool, so early
 * waves field the weakest (often-unevolved) teams and late waves the strongest.
 *
 * ER (#346): per-difficulty — Elite ramps team strength SLOWER than Hell, so
 * its top-end teams only show up in the final stretch of a 200-wave run, while
 * Hell reaches full strength by ~wave 180 as before.
 */
function erWaveProgressionSpan(): number {
  const span = erBalanceMap("er.trainer.waveProgressionSpan");
  return getErDifficulty() === "elite" ? span.elite : span.hell;
}

/** Cache of a trainer's team base-stat-total per tier (stableKey:tier → BST sum). */
const TEAM_STRENGTH_CACHE = new Map<string, number>();

/**
 * Difficulty proxy for wave-appropriate trainer selection (#225): the summed
 * base-stat-total of the trainer's roster at `tier`. Unevolved/early teams score
 * low, so sorting a pool by this puts the "early-game" trainers first. Cached
 * since the roster is static per trainer+tier.
 *
 * Exported for unit testing.
 */
export function teamStrength(t: ErTrainerRegistryEntry, tier: ErRosterTier): number {
  const cacheKey = `${t.stableKey}:${tier}`;
  const cached = TEAM_STRENGTH_CACHE.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  let total = 0;
  for (const member of selectErRoster(t, tier)) {
    total += getPokemonSpecies(member.speciesId)?.getBaseStatTotal() ?? 0;
  }
  TEAM_STRENGTH_CACHE.set(cacheKey, total);
  return total;
}

// PokeRogue trainer-type ids that ER's MARQUEE trainers are registered under
// (er-id-map: ROM Leader->200, Elite Four->300, Champion/Monotype->350, Johto
// Champ->352, Magma Leader->102, Aqua Leader->104). The game's wave schedule
// never spawns these types directly, so without routing, ER's 43 gym leaders,
// 16 Elite Four, 25 champions and the evil-team leaders would never appear AS
// bosses. At a boss trainer wave we pull from this pool so the hand-built ER
// gym/E4/champion teams show up in their proper role (wave-scaled by strength).
const ER_BOSS_TRAINER_TYPES: ReadonlySet<number> = new Set([200, 300, 350, 352, 102, 104]);
// PokeRogue rival trainer types (RIVAL..RIVAL_6). Rivals are handled on their own
// path and must NOT be replaced by a gym leader at a rival wave.
const ER_RIVAL_TRAINER_TYPES: ReadonlySet<number> = new Set([375, 376, 377, 378, 379, 380]);

const ER_RIVAL_KEY_PATTERN =
  /^(?:May|Brendan) (?:(?:Route 103|Rustboro|Route 110|Route 119|Lilycove) (?:Treecko|Mudkip|Torchic)|(?:Treecko|Mudkip|Torchic) Meteor Falls)$/;

function isErSpecialTrainer(t: ErTrainerRegistryEntry): boolean {
  return ER_BOSS_TRAINER_TYPES.has(t.trainerType) || ER_RIVAL_KEY_PATTERN.test(t.stableKey);
}

/** True if the trainer ships a roster for the given difficulty tier. */
function trainerHasTier(t: ErTrainerRegistryEntry, tier: ErRosterTier): boolean {
  if (tier === "hell") {
    return (t.hellParty?.length ?? 0) > 0 || (t.insaneParty?.length ?? 0) > 0;
  }
  if (tier === "insane") {
    return (t.insaneParty?.length ?? 0) > 0;
  }
  return true; // "party" roster is always present for a registered trainer
}

export function getErTrainerForTrainer(trainer: Trainer): ErTrainerRegistryEntry | null {
  const cached = TRAINER_CACHE.get(trainer);
  if (cached !== undefined) {
    return cached;
  }
  let choice: ErTrainerRegistryEntry | null = null;
  // YOUNGSTER / ACE = pure vanilla PokeRogue trainers (no ER roster override).
  // ELITE / HELL pull from the ER pool at the insane / hell tier.
  if (!isErVanillaDifficulty()) {
    const tier = erDifficultyToRosterTier();
    // Boss trainer waves (gym leader / Elite Four / Champion / evil-team leader,
    // or any boss-marked / every-10th wave) pull from ER's marquee trainer pool
    // so those hand-built teams actually appear in their boss role — the wave
    // schedule never spawns their trainer types directly. Rivals are exempt
    // (their own path) and Ace is already excluded above.
    const waveIdx = globalScene.currentBattle?.waveIndex ?? 0;
    const isRival = ER_RIVAL_TRAINER_TYPES.has(trainer.config.trainerType);
    const isBossWave = !isRival && (trainer.config.isBoss || waveIdx % 10 === 0);
    const all = isBossWave
      ? ER_TRAINER_REGISTRY.filter(t => ER_BOSS_TRAINER_TYPES.has(t.trainerType))
      : ER_TRAINER_REGISTRY.filter(t => !isErSpecialTrainer(t));
    // Prefer trainers that actually ship the chosen difficulty's roster, then
    // those not yet seen this run (a difficulty shouldn't repeat trainers).
    const tierMatched = all.filter(t => trainerHasTier(t, tier));
    const unusedTier = tierMatched.filter(t => !USED_ER_TRAINER_KEYS.has(t.stableKey));
    const unusedAll = all.filter(t => !USED_ER_TRAINER_KEYS.has(t.stableKey));
    // GLOBAL unused pool (any trainer-type) with the chosen tier. The per-type
    // pools are small, and a run hammers a few common types (Youngster/Lass/…),
    // so type-only no-repeat exhausts those ~handful of rosters fast and then
    // repeats — the audit showed only ~19-20 DISTINCT ER rosters per 200-wave
    // run despite 428 tier-eligible trainers. Falling back to the global unused
    // pool before allowing ANY repeat lets a run field dozens of distinct
    // trainers (variety), only repeating once the entire tier pool is spent.
    // Regular (non-boss) waves rotate from the WHOLE tier pool (all types), not
    // the tiny per-type pool. The per-type pools are 1-2 trainers for common
    // early types (Youngster/Lass/…), so the run-seed selection window had
    // nothing to rotate — two different runs landed on the SAME team at the same
    // wave (#261 was only fixed WITHIN a run; across runs it still repeated).
    // Drawing from the global unused-this-run tier pool gives the run-seed
    // hundreds of candidates to pick from, so each run fields a genuinely
    // different cast. The strength-window below keeps the pick wave-appropriate.
    // Boss waves keep their thematic boss-type pool so gym leaders / E4 / the
    // champion stay themselves.
    // ER (#346): on ELITE, regular waves draw from the FULL unused pool — all
    // 895 trainers — not just the ~429 that ship an "insane" roster. Trainers
    // without an insane roster fall back to their (weaker) base party via
    // selectErRoster, so the strength ordering below naturally schedules them
    // into the early/mid game. This both uses the whole trainer cast and slows
    // the felt difficulty ramp. Hell keeps the tier-first preference (its pool
    // should stay brutal); bosses keep their thematic marquee pool.
    const eliteFullPool = getErDifficulty() === "elite";
    const pool = isBossWave
      ? unusedTier.length > 0
        ? unusedTier
        : unusedAll.length > 0
          ? unusedAll
          : tierMatched.length > 0
            ? tierMatched
            : all
      : eliteFullPool
        ? unusedAll.length > 0
          ? unusedAll
          : all
        : unusedTier.length > 0
          ? unusedTier
          : tierMatched.length > 0
            ? tierMatched
            : all;
    if (pool.length > 0) {
      // Prefer trainers whose roster can field the ENTIRE encounter on its own,
      // so we never mix ER mons with vanilla-generated ones: PokeRogue calls
      // genPartyMember(0..size-1) and applyErRosterOverride falls back to vanilla
      // for indices past the ER roster. Early (2-3 mon) encounters thus pull 2-3
      // from a small ER team; a 6-mon battle pulls a full 6-mon ER team (#225).
      // Falls back to the full pool if none are large enough.
      // Optional-chained: getErTrainerForTrainer is also reachable from lighter
      // contexts (e.g. hasErRosterOverride checks, tests) where the Trainer has
      // no party template yet — skip the size preference there.
      const partySize = trainer.getPartyTemplate?.()?.size ?? 0;
      const bigEnough = partySize > 0 ? pool.filter(t => selectErRoster(t, tier).length >= partySize) : [];
      const usablePool = bigEnough.length > 0 ? bigEnough : pool;
      // Wave-appropriate, story-ordered pick (#225): sort the *unused* pool by
      // team strength (weakest → strongest) and index into it by how deep the run
      // is. Because early waves consume the weakest-unused trainers first, by the
      // late game (wave ≈ ER_WAVE_PROGRESSION_SPAN) only the strongest remain — so
      // E4 / champion-tier teams naturally show up at the end, not at wave 5.
      const ordered = usablePool.slice().sort((a, b) => teamStrength(a, tier) - teamStrength(b, tier));
      const wave = globalScene.currentBattle?.waveIndex ?? 1;
      const frac = Math.min(1, Math.max(0, (wave - 1) / erWaveProgressionSpan()));
      const targetIdx = Math.round(frac * (ordered.length - 1));
      // Pick from a window around the wave-appropriate strength, varied by the
      // RUN SEED (+ wave + type) via a pure hash — NOT the live RNG (which would
      // desync reproducible party generation). Same encounter in the same run →
      // identical pick (generation-stable); different runs → different trainers,
      // so each run is genuinely new instead of the same weakest-first sequence.
      // Window is capped (~25 trainers) so that even when `ordered` is the big
      // global tier pool, the pick stays STRENGTH-tight to the wave (no wave-5
      // difficulty spikes from a 40%-of-the-pool window) while still being wide
      // enough for the run-seed to rotate the cast across runs. Small per-type /
      // boss pools are unaffected (0.4*len is already < the cap there).
      const radius = Math.max(2, Math.min(Math.floor(ordered.length * 0.4), 12));
      const lo = Math.max(0, targetIdx - radius);
      const hi = Math.min(ordered.length - 1, targetIdx + radius);
      const span = hi - lo + 1;
      const trainerSourceKey = isBossWave ? trainer.config.trainerType : "regular";
      const variety = hashErSelectionSeed(`${globalScene.seed}:${wave}:${trainerSourceKey}`);
      choice = ordered[lo + (variety % span)];
      USED_ER_TRAINER_KEYS.add(choice.stableKey);
    }
  }
  TRAINER_CACHE.set(trainer, choice);
  return choice;
}

/**
 * Pick the ER roster tier for the current trainer. The player's chosen run
 * difficulty (Ace / Elite / Hell — see `er-run-difficulty`) sets the BASE tier;
 * boss waves bump it up one notch so a major encounter is always at least as
 * hard as the picked floor (Ace boss → insane, Elite boss → hell, Hell → hell).
 */
export function pickTierForWave(trainer: Trainer): ErRosterTier {
  const base = erDifficultyToRosterTier();
  const wave = globalScene.currentBattle?.waveIndex ?? 1;
  const isBoss = trainer.config.isBoss || wave % 10 === 0;
  if (!isBoss) {
    return base;
  }
  // Boss bump applies to ACE only (party → insane). Elite and Hell keep their own
  // tier on bosses — previously Elite bosses bumped to "hell", which collapsed the
  // Elite and Hell rosters onto the same pool. Keeping Elite at "insane" and Hell
  // at "hell" keeps the two difficulties distinct (#225).
  if (base === "party") {
    return "insane";
  }
  return base;
}

/**
 * Reset the ER-trainer cache for a Trainer. Used by tests that re-use
 * the same Trainer object across test cases and want a fresh match.
 */
export function resetErTrainerCacheFor(trainer: Trainer): void {
  TRAINER_CACHE.delete(trainer);
}

/**
 * Drop the entire trainer cache. Used by tests at module boundaries —
 * the WeakMap will naturally clean up when Trainers are GC'd, but tests
 * sometimes need to force a fresh lookup for the SAME object.
 */
export function clearErTrainerCacheForTests(): void {
  // WeakMap has no clear() — recreate by reassigning the module-level
  // map. We do this defensively for testing scenarios only.
  TRAINER_CACHE = new WeakMap();
  ROSTER_ORDER_CACHE = new WeakMap();
}

/**
 * Build a single ER-overridden EnemyPokemon for `index` from the matched
 * ER trainer. Returns `null` if no ER trainer matches or the requested
 * index is out of the ER roster's bounds (caller should fall through to
 * vanilla generation in that case).
 *
 * The returned EnemyPokemon has:
 *   - species set from the ER roster member's speciesId
 *   - abilityIndex set from the ER `abilitySlot`
 *   - moveset populated from the ER roster's moves
 *   - ivs / nature set from the ER roster
 *   - level taken from `battle.enemyLevels[index]` (so wave-scaling still
 *     applies — ER's per-member level field is a placeholder).
 *
 * EVs are NOT applied: pokerogue's `EnemyPokemon` doesn't expose a public
 * EV channel (trainer mons use a separate boost mechanism). The hook
 * stops at the in-engine fields it can mutate safely.
 */
export function applyErRosterOverride(trainer: Trainer, index: number): EnemyPokemon | null {
  const erTrainer = getErTrainerForTrainer(trainer);
  if (erTrainer === null) {
    return null;
  }
  // Tier scales with the wave (easy early → full insane/hell roster at bosses).
  const tier = pickTierForWave(trainer);
  const roster: readonly ErPartyMemberRegistered[] = selectErRoster(erTrainer, tier);
  if (index >= roster.length) {
    return null;
  }
  // Rotate which roster members appear: map the requested slot through a stable,
  // wave-seeded shuffle so a roster bigger than the party size fields a random
  // subset that varies across runs (instead of always the first N members).
  const order = getRosterOrder(trainer, roster.length, tier);
  const memberIndex = order[index] ?? index;
  return buildErEnemyFromMember(trainer, index, roster[memberIndex]);
}

/**
 * Construct a single ER-overridden {@linkcode EnemyPokemon} for `index` from one
 * ER roster member — species / ability slot / moveset / IVs / nature, with the
 * level taken from the engine's wave-scaled `enemyLevels[index]` (so PokeRogue's
 * curve, which runs past Lv 100, still applies). Returns `null` if the member's
 * species can't be resolved (id-map drift). Shared by the generic trainer
 * override and the ER rival override.
 */
function buildErEnemyFromMember(
  trainer: Trainer,
  index: number,
  member: ErPartyMemberRegistered,
): EnemyPokemon | null {
  // ER battle-FORM dump species (e.g. Wispywaspy Hivemind) are not real standalone
  // battlers - they have no usable learnset, so a trainer fielding one spawns a mon
  // with no moves that only Struggles. Spawn the BASE species instead; it has a
  // real moveset + the form-change innate (Locust Swarm) that schools it into the
  // alternate form (the "hivemind" form is injected on the base).
  const spawnSpeciesId = erBattleFormDumpToBaseSpeciesId(member.speciesId) ?? member.speciesId;
  const species = getPokemonSpecies(spawnSpeciesId);
  if (!species) {
    return null;
  }
  const battle = globalScene.currentBattle;
  const level = battle.enemyLevels?.[index] ?? member.level;
  const trainerSlot = !trainer.isDouble() || !(index % 2) ? TrainerSlot.TRAINER : TrainerSlot.TRAINER_PARTNER;
  const enemy: EnemyPokemon = globalScene.addEnemyPokemon(species, level, trainerSlot);
  enemy.abilityIndex = member.abilitySlot;
  enemy.ivs = [member.ivs[0], member.ivs[1], member.ivs[2], member.ivs[3], member.ivs[4], member.ivs[5]];
  enemy.nature = member.nature as Nature;
  if (member.moves.length > 0) {
    const moves = member.moves.map(id => new PokemonMove(id));
    enemy.moveset = moves;
    enemy.summonData.moveset = moves;
  }
  // Stash the ER held-item id; the soft conversion runs after PokeRogue's
  // baseline trainer item roll (see applyErTrainerHeldItems).
  ER_ITEM_BY_POKEMON.set(enemy, member.itemId);
  enemy.generateName();
  return enemy;
}

// =============================================================================
// ER rival (May / Brendan) — mirror the Hoenn rival battles onto PokeRogue's
// rival encounters (RIVAL, RIVAL_2 … RIVAL_6). Elite/Hell only (Ace = vanilla).
// =============================================================================

/** ER rival stages, weakest → strongest (used to scale onto PokeRogue's rivals). */
const ER_RIVAL_STAGES = ["Route 103", "Rustboro", "Route 110", "Route 119", "Lilycove", "Meteor Falls"] as const;

/** The three starter-dependent rival team variants. */
const ER_RIVAL_STARTERS = ["Treecko", "Mudkip", "Torchic"] as const;

/** Map a PokeRogue rival TrainerType to its 0-based encounter index (RIVAL = 0 … RIVAL_6 = 5). */
function rivalEncounterIndex(trainerType: TrainerType): number | null {
  switch (trainerType) {
    case TrainerType.RIVAL:
      return 0;
    case TrainerType.RIVAL_2:
      return 1;
    case TrainerType.RIVAL_3:
      return 2;
    case TrainerType.RIVAL_4:
      return 3;
    case TrainerType.RIVAL_5:
      return 4;
    case TrainerType.RIVAL_6:
      return 5;
    default:
      return null;
  }
}

export function erRivalStageForEncounter(encounterIndex: number): (typeof ER_RIVAL_STAGES)[number] {
  const lastStage = ER_RIVAL_STAGES.length - 1;
  const idx = encounterIndex;
  return ER_RIVAL_STAGES[Math.min(Math.max(idx, 0), lastStage)];
}

/**
 * Pick the rival's starter-variant team for the run. ER's rival chooses the
 * starter type-advantaged against yours; PokeRogue players rarely run a Hoenn
 * starter, so we instead pick one of the three variants pseudo-randomly but
 * STABLY per run — derived from the run seed so it stays consistent across save
 * reloads (no extra persistence needed) and is the same for every rival battle
 * in the run.
 */
function erRivalStarterVariant(): (typeof ER_RIVAL_STARTERS)[number] {
  const seed = globalScene.seed ?? "";
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return ER_RIVAL_STARTERS[Math.abs(hash) % ER_RIVAL_STARTERS.length];
}

type ErRivalName = "May" | "Brendan";
type ErRivalStarter = (typeof ER_RIVAL_STARTERS)[number];
type ErRivalStage = (typeof ER_RIVAL_STAGES)[number];

function erRivalKey(rivalName: ErRivalName, stage: ErRivalStage, starter: ErRivalStarter): string {
  return stage === "Meteor Falls" ? `${rivalName} ${starter} Meteor Falls` : `${rivalName} ${stage} ${starter}`;
}

function erRivalPartySizeForType(trainerType: TrainerType): number {
  switch (trainerType) {
    case TrainerType.RIVAL:
      return 2;
    case TrainerType.RIVAL_2:
      return 3;
    case TrainerType.RIVAL_3:
      return 4;
    case TrainerType.RIVAL_4:
      return 5;
    case TrainerType.RIVAL_5:
    case TrainerType.RIVAL_6:
      return 6;
    default:
      return 0;
  }
}

/**
 * ER (#340): the rival stage LADDER, weakest → strongest, used to map an
 * encounter's position in the run's rival sequence directly onto a stage.
 * Meteor Falls is deliberately excluded — it's ER's special 3-mon ace trio and
 * can't field the 6-mon endgame battles; the finale's legendary ace is handled
 * separately (see {@linkcode applyErRivalOverride}'s Mega Rayquaza slot).
 */
const ER_RIVAL_LADDER = ER_RIVAL_STAGES.filter(stage => stage !== "Meteor Falls");

/**
 * Pick the ER rival team for this encounter by PROGRESSION, not by walking a
 * candidate list (#340): the old walker consumed candidates starter-major, so
 * on Hell — 10 rival battles for 6 stages — the FINAL battle (wave 195) got a
 * leftover early/mid-game team: unevolved mons and no ace. Now the encounter's
 * position in the run's rival sequence maps onto the stage ladder (first
 * battle → Route 103, final battle → Lilycove), back-to-back battles on the
 * same stage rotate the May/Brendan + starter variants, and a stage whose
 * roster is smaller than the required party size bumps up to the next stage.
 */
function selectErRivalEntry(
  rivalName: ErRivalName,
  starter: ErRivalStarter,
  trainerType: TrainerType,
  tier: ErRosterTier,
): ErTrainerRegistryEntry | null {
  const wave = globalScene.currentBattle?.waveIndex ?? 0;
  const sequence = erRivalWaveSequence();
  let pos = sequence.findIndex(([candidateWave, type]) => candidateWave === wave && type === trainerType);
  let len = sequence.length;
  if (pos < 0) {
    const ordinal = erRivalWaveOrdinal(wave, trainerType) ?? rivalEncounterIndex(trainerType);
    if (ordinal === null) {
      return null;
    }
    pos = ordinal;
    len = 6;
  }
  const stageFor = (p: number): number =>
    Math.round((len > 1 ? p / (len - 1) : 1) * (ER_RIVAL_LADDER.length - 1));
  const stageIdx = stageFor(pos);
  // How many earlier battles in the sequence landed on the same stage — used
  // to rotate the name/starter variant so repeats field a different team.
  let repeat = 0;
  for (let i = 0; i < pos; i++) {
    if (stageFor(i) === stageIdx) {
      repeat++;
    }
  }
  const partySize = erRivalPartySizeForType(trainerType);
  const names: ErRivalName[] = [rivalName, rivalName === "May" ? "Brendan" : "May"];
  const starters = [starter, ...ER_RIVAL_STARTERS.filter(s => s !== starter)];
  for (let s = stageIdx; s < ER_RIVAL_LADDER.length; s++) {
    const candidates: ErTrainerRegistryEntry[] = [];
    for (const candidateStarter of starters) {
      for (const name of names) {
        const entry = ER_TRAINER_BY_KEY.get(erRivalKey(name, ER_RIVAL_LADDER[s], candidateStarter));
        if (entry && selectErRoster(entry, tier).length >= partySize) {
          candidates.push(entry);
        }
      }
    }
    if (candidates.length > 0) {
      return candidates[repeat % candidates.length];
    }
    repeat = 0; // a bumped-up stage starts its own rotation
  }
  return null; // nothing fits → vanilla rival generation
}

/**
 * The ER rival registry entry for a given live rival Trainer, or `null` when the
 * ER rival shouldn't apply (Ace difficulty, or not a rival encounter). The rival
 * identity mirrors the on-screen rival's gender: the female variant (Ivy) → May,
 * otherwise (Finn) → Brendan, matching ER's "rival is your counterpart" framing.
 */
export function getErRivalEntry(trainer: Trainer): ErTrainerRegistryEntry | null {
  if (isErVanillaDifficulty()) {
    return null;
  }
  const encounterIndex = rivalEncounterIndex(trainer.config.trainerType);
  if (encounterIndex === null) {
    return null;
  }
  // Mirror the on-screen rival's gender: PokeRogue shows the female rival (Ivy)
  // as the FEMALE trainer variant, otherwise the male rival (Finn). ER's
  // counterparts are May (female) and Brendan (male). Fall back to the Emerald
  // rule (rival is the player's opposite gender) if the variant is unset.
  const isFemaleRival =
    trainer.variant === TrainerVariant.FEMALE
    || (trainer.variant !== TrainerVariant.DOUBLE && globalScene.gameData.gender === PlayerGender.MALE);
  const rivalName: ErRivalName = isFemaleRival ? "May" : "Brendan";
  const starter = erRivalStarterVariant();
  return selectErRivalEntry(rivalName, starter, trainer.config.trainerType, pickTierForWave(trainer));
}

/**
 * Build an ER-rival-overridden EnemyPokemon for `index`, or `null` to fall
 * through to PokeRogue's generated rival. Mirrors {@linkcode applyErRosterOverride}
 * but keyed off the ER rival progression instead of the trainer-class registry.
 * Must be consulted BEFORE the rival's `partyMemberFuncs` in `genPartyMember`,
 * since the rival defines its whole team via those funcs.
 */
export function applyErRivalOverride(trainer: Trainer, index: number): EnemyPokemon | null {
  const entry = getErRivalEntry(trainer);
  if (entry === null) {
    return null;
  }
  // ER (#340): the FINAL rival battle mirrors vanilla's finale — the last slot
  // is ALWAYS Mega Rayquaza. The ER rosters top out at the Lilycove team and
  // never carry the legendary ace themselves, so without this the wave-195
  // fight lost its signature Mega Rayquaza.
  if (
    trainer.config.trainerType === TrainerType.RIVAL_6
    && index === erRivalPartySizeForType(TrainerType.RIVAL_6) - 1
  ) {
    return buildErRivalMegaRayquaza(trainer, index);
  }
  const roster = selectErRoster(entry, pickTierForWave(trainer));
  if (index >= roster.length) {
    return null;
  }
  const built = buildErEnemyFromMember(trainer, index, roster[index]);
  if (built) {
    erEvolveRivalToLevel(trainer, built, index);
  }
  return built;
}

/**
 * ER (#612): evolve a rival roster member UP to the species its WAVE-SCALED LEVEL
 * would have reached. The rival's STAGE (and so its roster species) is mapped from
 * the encounter's position in the run's rival sequence, but its LEVEL is mapped from
 * the wave - so on Hell, where extra early rivals push the early stages onto already
 * mid-game waves, the Route-110 roster's Growlithe spawned at a wave-55 level (a
 * high-level UNEVOLVED mon). Run each member through the same
 * {@linkcode PokemonSpecies.getTrainerSpeciesForLevel} the vanilla trainer path uses,
 * so the rival evolves exactly as a normal trainer's mon of that species would at the
 * level/wave (Growlithe -> Arcanine). The curated, already-evolved late rosters
 * (Route 119 / Lilycove) return the same species and are left untouched. The universal
 * BST cap (enforceErEliteBstCurve) still runs afterwards and devolves the result if
 * the evolved form overshoots the wave ceiling.
 */
function erEvolveRivalToLevel(trainer: Trainer, enemy: EnemyPokemon, index: number): void {
  const template = trainer.getPartyTemplate?.();
  if (!template) {
    return;
  }
  const evolvedId = enemy.species.getTrainerSpeciesForLevel(
    enemy.level,
    true,
    template.getStrength(index),
    template.evoLevelThresholdKind,
  );
  if (evolvedId === enemy.species.speciesId) {
    return; // already the level-appropriate stage
  }
  const evolved = getPokemonSpecies(evolvedId);
  if (!evolved) {
    return;
  }
  enemy.species = evolved;
  enemy.formIndex = 0;
  const abilityCount = enemy.getSpeciesForm().getAbilityCount();
  if (enemy.abilityIndex >= abilityCount) {
    enemy.abilityIndex = abilityCount - 1;
  }
  // The early-stage roster's moveset would be weak on the evolved species, so give it
  // a level-appropriate moveset. Only species that ACTUALLY evolved reach here (the
  // already-correct late rosters returned above with their curated movesets intact).
  enemy.generateAndPopulateMoveset();
  enemy.calculateStats();
  enemy.generateName();
  // ER (#434): the species changed after EncounterPhase loaded the sprite - rebind it.
  void enemy.loadAssets(false);
}

/** Build the final rival's ace: Mega Rayquaza (#340), vanilla-finale parity. */
function buildErRivalMegaRayquaza(trainer: Trainer, index: number): EnemyPokemon | null {
  const enemy = buildErEnemyFromMember(trainer, index, {
    speciesId: SpeciesId.RAYQUAZA,
    level: 70,
    abilitySlot: 0,
    ivs: [31, 31, 31, 31, 31, 31],
    evs: [0, 0, 0, 0, 0, 0],
    itemId: 0,
    nature: 0,
    moves: [],
    hpType: 0,
  });
  if (enemy) {
    const megaIdx = (enemy.species.forms ?? []).findIndex(f => f.formKey === SpeciesFormKey.MEGA);
    if (megaIdx > 0) {
      enemy.formIndex = megaIdx;
      const abilityCount = enemy.getSpeciesForm().getAbilityCount();
      if (enemy.abilityIndex >= abilityCount) {
        enemy.abilityIndex = abilityCount - 1;
      }
      enemy.calculateStats();
      enemy.generateName();
    }
  }
  return enemy;
}

/** True if this trainer is an ER-overridden rival (used to gate the rival hook). */
export function hasErRivalOverride(trainer: Trainer): boolean {
  return getErRivalEntry(trainer) !== null;
}

/**
 * After PokeRogue rolls its baseline trainer held items, apply the soft ER
 * conversion: with `er.items.convertChance` probability, if the ER
 * roster member held a translatable competitive item, give the mapped
 * PokeRogue held item. Balls / berries / consumables / unmapped items are left
 * to the baseline roll. (Recreated ER-only items and mega-stone force-evolves
 * are layered on separately.)
 */
/**
 * Per-mon biome item flavor: on top of the vanilla roll, a wild/trainer mon in
 * a themed biome may also carry ONE item from that biome's pool (Fire Gem in
 * the Volcano, Cell Battery at the Power Plant, etc.). Additive + stochastic.
 */
function assignErBiomeItemFlavor(enemy: EnemyPokemon): void {
  const flavor = getErBiomeItemFlavor(globalScene.arena.biomeId);
  if (!flavor || flavor.pool.length === 0 || enemy.randBattleSeedInt(100) >= flavor.chance) {
    return;
  }
  const key = flavor.pool[enemy.randBattleSeedInt(flavor.pool.length)];
  const factory = (
    modifierTypes as Record<string, (() => { newModifier(p: EnemyPokemon): PokemonHeldItemModifier | null }) | undefined>
  )[key];
  if (!factory) {
    return;
  }
  const modifier = factory().newModifier(enemy);
  if (modifier) {
    globalScene.addEnemyModifier(modifier, true, true);
  }
}

export function applyErTrainerHeldItems(party: readonly EnemyPokemon[]): void {
  // Ace / Elite: revert any mon that is ALREADY a mega before the wave gate.
  // forceErMega gates the held-stone path, but some ER rosters field a mega
  // DIRECTLY as the species (e.g. rival aces "Blaziken Mega" / "Sceptile Mega"),
  // which would otherwise show a mega at wave < 50. Hell is exempt.
  for (const enemy of party) {
    revertEarlyMega(enemy);
    // ER (#419): apply the receiving difficulty's BST curve after every trainer
    // roster/form override (including cross-player ghosts).
    enforceErEliteBstCurve(enemy);
    // ER (#357): per-mon resist-berry roll (5% Ace / 10% Elite / 20% Hell) — a
    // trainer mon may hold ONE berry matching one of its weaknesses. These are
    // trainer-only drops; stealing them is how players obtain them.
    maybeAssignErResistBerry(enemy);
    // ER (#358): per-mon Ward Stone roll (Hell 100+ / Elite 150+; bosses get
    // the higher tiers; Primal Cascoon always carries a full Prime stone).
    maybeAssignErWardStone(enemy);
    // ER: per-biome enemy item flavor (gems/seeds/reactive themed to the biome),
    // wild + trainer alike, on top of the vanilla roll.
    assignErBiomeItemFlavor(enemy);
  }
  for (const enemy of party) {
    const itemId = ER_ITEM_BY_POKEMON.get(enemy);
    if (itemId === undefined) {
      continue;
    }
    const res = resolveErTrainerItem(itemId);
    if (!res) {
      continue; // balls / berries / consumables / unmapped — baseline roll stands
    }
    if (res.kind === "mega") {
      // Mega stone → force the holder's Mega form (always — it's a boss mon).
      // The fitting held items are whatever PokeRogue's baseline roll already
      // gave it (we don't strip those). Pass the stone id so we can pick the
      // EXACT target form (Mega-X vs Mega-Y vs Primal vs Origin).
      forceErMega(enemy, itemId);
      continue;
    }
    // Soft conversion: only sometimes override the baseline roll with the
    // ER-faithful item.
    if (enemy.randBattleSeedInt(100) >= erBalanceNum("er.items.convertChance") * 100) {
      continue;
    }
    const modifier = res.make().newModifier(enemy) as PokemonHeldItemModifier | null;
    if (modifier) {
      globalScene.addEnemyModifier(modifier, true, true);
    }
  }
  // ER (anti-stack): every trainer's apex mon mirrors the player's vitamin
  // investment. Runs before the Hell boss buff so a promoted boss bar already
  // reflects the vitamin-boosted stats.
  applyErTrainerVitaminCatchup(party);
  // ER (#135): Hell post-wave-100 trainer difficulty buff. Layered LAST so the
  // BST scan sees each mon's FINAL battle form (after the early-mega revert and
  // any forceErMega above).
  applyErHellTrainerBossBuff(party);
}

/**
 * Per-mon guard so the vitamin mirror applies ONCE - addEnemyModifier MERGES
 * same-stat stacks, so a second modifier-pipeline pass (mystery encounters /
 * co-op re-run) would otherwise keep stacking more vitamins onto the same mon.
 */
const ER_VITAMINS_APPLIED = new WeakSet<EnemyPokemon>();

/**
 * ER (anti-vitamin-stacking): in every enemy TRAINER battle, the team's single
 * HIGHEST-BST mon is given N base-stat boosters (vitamins) randomly distributed
 * across its six stats, where N is the MOST vitamins the player has piled onto any
 * ONE of their own mons. This kills the "dump every vitamin on one lead" strategy:
 * the more you stack on a single mon, the stronger every enemy ace becomes. N is
 * read from the player's live held vitamins, so it is a no-op early (you have none)
 * and scales with the run. Each stat is capped at the enemy's IV for that stat (the
 * normal per-stat vitamin ceiling); overflow spills to other stats. Trainer-only,
 * never throws.
 */
export function applyErTrainerVitaminCatchup(party: readonly EnemyPokemon[]): void {
  try {
    if (!globalScene.currentBattle?.trainer || party.length === 0) {
      return;
    }
    // N = the most vitamins (summed stack counts) on a SINGLE player mon.
    const perMon = new Map<number, number>();
    for (const m of globalScene.findModifiers(mod => mod instanceof BaseStatModifier, true)) {
      const v = m as BaseStatModifier;
      perMon.set(v.pokemonId, (perMon.get(v.pokemonId) ?? 0) + v.getStackCount());
    }
    const n = perMon.size > 0 ? Math.max(...perMon.values()) : 0;
    if (n <= 0) {
      return;
    }
    // Team apex by active-form BST (first max on ties), same notion as the Hell buff.
    let boss = party[0];
    let bestBst = boss.getSpeciesForm().baseTotal;
    for (let i = 1; i < party.length; i++) {
      const bst = party[i].getSpeciesForm().baseTotal;
      if (bst > bestBst) {
        bestBst = bst;
        boss = party[i];
      }
    }
    if (ER_VITAMINS_APPLIED.has(boss)) {
      return;
    }
    // Randomly distribute N across the six stats, each capped at the mon's IV for
    // that stat (the per-stat vitamin ceiling); overflow spills to the other stats.
    const want = [0, 0, 0, 0, 0, 0];
    let remaining = n;
    for (let guard = 0; remaining > 0 && guard < n * 12; guard++) {
      const s = boss.randBattleSeedInt(6);
      if (want[s] < boss.ivs[s]) {
        want[s]++;
        remaining--;
      } else if (PERMANENT_STATS.every(stat => want[stat] >= boss.ivs[stat])) {
        break; // every stat is already at its IV cap
      }
    }
    for (const stat of PERMANENT_STATS) {
      if (want[stat] <= 0) {
        continue;
      }
      // Keep the registry id on this hand-built generated type. ModifierData (save/load and co-op wire
      // replication) reconstructs a modifier by type id before it uses the class/args; an unkeyed vitamin
      // therefore works on the host but is impossible for a renderer or resumed session to rebuild.
      const vitaminType = new BaseStatBoosterModifierType(stat);
      vitaminType.withIdFromFunc(modifierTypes.BASE_STAT_BOOSTER);
      const mod = vitaminType.newModifier(boss) as PokemonHeldItemModifier | null;
      if (mod) {
        mod.stackCount = want[stat];
        globalScene.addEnemyModifier(mod, true, true);
      }
    }
    ER_VITAMINS_APPLIED.add(boss);
    boss.calculateStats(); // make the +10%/stack base-stat boost actually land
  } catch {
    // The vitamin mirror must never break trainer generation.
  }
}

/**
 * Earliest wave the HELL post-100 trainer buff applies (#135 Tier 1). Mirrors
 * the Ward Stone Hell spawn gate (wave 100+) so the boss buff and the stones
 * that ride it switch on together.
 */
const ER_HELL_TRAINER_BUFF_FROM_WAVE = 100;

/**
 * TODO (#135 Tier 2 — BLOCKED on the maintainer's start wave): from wave
 * {@linkcode ER_HELL_TRAINER_TIER2_FROM_WAVE} every Hell trainer fields TWO mons
 * with 2 boss bars AND the highest-BST mon with 3 bars, all carrying PRIME
 * (unstealable) Ward Stones + resist berries. Do NOT implement until the start
 * wave is confirmed — this constant is only the placeholder threshold so the
 * gate is wired and obvious. (-1 disables the tier entirely.)
 */
const ER_HELL_TRAINER_TIER2_FROM_WAVE = -1;
void ER_HELL_TRAINER_TIER2_FROM_WAVE;

/**
 * ER (#135 Tier 1): on HELL after wave 100, the trainer's HIGHEST-BST mon is
 * promoted to a 2-bar boss carrying a GUARANTEED (stealable) Greater Ward Stone
 * and GUARANTEED resist berries matching each of its type weaknesses. The buff
 * is trainer-only and applies to the single apex mon (ties -> lowest party
 * index). Idempotent and roll-free, so a re-run of the modifier pipeline (MEs /
 * co-op) re-selects the same mon and no-ops. Never throws.
 */
function applyErHellTrainerBossBuff(party: readonly EnemyPokemon[]): void {
  try {
    if (getErDifficulty() !== "hell") {
      return;
    }
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    if (wave <= ER_HELL_TRAINER_BUFF_FROM_WAVE || !globalScene.currentBattle?.trainer) {
      return;
    }
    if (party.length === 0) {
      return;
    }
    // The team's apex by ACTIVE-form BST (the same notion the encounter phase
    // uses for its BST sum / segment scaling). Strict `>` keeps the FIRST max on
    // a tie.
    let boss = party[0];
    let bestBst = boss.getSpeciesForm().baseTotal;
    for (let i = 1; i < party.length; i++) {
      const bst = party[i].getSpeciesForm().baseTotal;
      if (bst > bestBst) {
        bestBst = bst;
        boss = party[i];
      }
    }
    // Force the 2-health-bar boss. Guard re-entry: a second setBoss() mid-fight
    // would reset bossSegmentIndex, so only promote a mon that isn't a boss yet.
    if (!boss.isBoss()) {
      boss.setBoss(true, 2);
      // Re-render its Battle Info so the HP bar shows the 2 segments + boss chrome
      // (idempotent: reuses the existing battleInfo built at asset-load).
      boss.initBattleInfo();
    }
    // GUARANTEED Greater Ward Stone (regular/stealable tier; Prime stays Tier 2)
    // + every weakness-matching resist berry. Both are idempotent no-ops if the
    // mon already carries them.
    grantErWardStone(boss, "greater");
    grantErResistBerries(boss);
  } catch {
    // The difficulty buff must never break trainer generation.
  }
}

/**
 * Earliest wave an ER trainer mon may Mega-evolve in **Ace / Elite**. Megas are
 * an end-game power spike and shouldn't show up early in those modes. **Hell is
 * intentionally exempt** — early megas are part of its difficulty.
 */
const ER_MEGA_MIN_WAVE_NON_HELL = () => erBalanceNum("er.trainer.megaMinWaveNonHell");

/**
 * Lazily-built map: pokerogue species id of a DIRECT mega species → its base
 * species id. ER rosters occasionally field a mega as the species itself (rival
 * aces, boss teams), so reverting it for the Ace/Elite early-game gate means
 * swapping the species, not just a form index. Derived from {@linkcode ER_MEGA_FORMS}.
 */
let ER_MEGA_SPECIES_TO_BASE: Map<number, number> | null = null;
function megaSpeciesToBase(): Map<number, number> {
  if (ER_MEGA_SPECIES_TO_BASE !== null) {
    return ER_MEGA_SPECIES_TO_BASE;
  }
  const map = new Map<number, number>();
  for (const entry of ER_MEGA_FORMS) {
    const megaPk = ER_ID_MAP.species[entry.targetErId];
    const basePk = ER_ID_MAP.species[entry.baseErId];
    if (megaPk !== undefined && basePk !== undefined && megaPk !== basePk) {
      map.set(megaPk, basePk);
    }
  }
  ER_MEGA_SPECIES_TO_BASE = map;
  return map;
}

/**
 * ER (#419): per-wave TRAINER BST ceilings for ELITE, derived from the wild
 * curve in docs/er-bst-curve-report.md. Boss waves (every 10th / boss-marked)
 * get +{@linkcode ER_ELITE_BST_BOSS_HEADROOM} so gym leaders stay bossy
 * without fielding box legendaries at wave 20. No cap past wave 100.
 * Legend-likes (legendary/sub-legendary/mythical) are banned before wave
 * {@linkcode ER_ELITE_LEGEND_FROM_WAVE} regardless of BST.
 */
// Ladder/headroom/legend-gate values live in the balance-knob registry
// (er-balance-knobs.ts: er.elite.bstCaps / bstBossHeadroom / legendFromWave) so
// the team editor can tune them; the shipped defaults match #419.
const ER_ELITE_LEGEND_FROM_WAVE = () => erBalanceNum("er.elite.legendFromWave");

function erEliteBstCapFor(wave: number, isBossWave: boolean, isHell: boolean): number | null {
  // Hell runs a steeper ladder than Elite (er.hell.bstCaps); Ace/Youngster and
  // Elite share the Elite ladder. Both are editor-managed (er-balance-tuning.json),
  // validated ascending in both columns — invalid overrides fall back to default.
  const ladderKey = isHell ? "er.hell.bstCaps" : "er.elite.bstCaps";
  for (const [maxWave, cap] of erBalancePairs(ladderKey)) {
    if (wave <= maxWave) {
      return cap + (isBossWave ? erBalanceNum("er.elite.bstBossHeadroom") : 0);
    }
  }
  return null;
}

/**
 * ER (#419): slow the ELITE early/mid-game trainer ramp. When a trainer mon
 * violates the wave's BST ceiling (or is a legend-like before wave 80):
 *   1. DEVOLVE it stage by stage until it fits;
 *   2. if no prevolution fits (legendaries, heavy single-stagers), SWAP it for
 *      a wave-appropriate factory-pool species under the cap (seeded pick).
 * Runs for every difficulty: Ace/Youngster/Elite share the Elite ladder, Hell
 * uses its own steeper {@linkcode er.hell.bstCaps} ladder (and keeps its early
 * legendaries - no pre-wave legend ban).
 */
/**
 * While true, the universal BST power gate is bypassed - used by the ER Colosseum
 * gauntlet (#439) so its curated boss / gym / champion / ghost teams fight at
 * full strength instead of being devolved to the wave ceiling. Set true only
 * around Colosseum battle construction, cleared immediately after.
 */
let erColosseumBattleActive = false;

/** Toggle the BST-cap bypass for ER Colosseum gauntlet battles (#439). */
export function setErColosseumBattleActive(active: boolean): void {
  erColosseumBattleActive = active;
}

export function enforceErEliteBstCurve(enemy: EnemyPokemon): void {
  try {
    // ER (#441): THE universal power gate. This used to be Elite-only and
    // trainer-only; it now runs for EVERY difficulty, invoked from the
    // EnemyPokemon CONSTRUCTOR, so every spawn path - wild, trainer, mystery
    // encounter, scripted - passes through one chokepoint. Species of any origin
    // (vanilla or ER custom) are allowed as long as their BST fits the wave's
    // ceiling; violators devolve or swap. Hell uses its OWN steeper ladder
    // (er.hell.bstCaps) so early Hell is survivable but still harder than Elite;
    // it keeps its early legendaries (no pre-wave legend ban). Fail-closed: an
    // unknown/future difficulty value falls through to the Elite ladder, gated.
    const isHell = getErDifficulty() === "hell";
    // Daily runs are shared-seed curated content (set bosses incl. wave-50
    // legendaries) - gating them would silently rewrite everyone's daily.
    // The ER Colosseum gauntlet (#439) is likewise curated content (real boss /
    // gym / champion / ghost teams meant to fight at FULL power), so its battles
    // bypass the BST cap while the flag is set.
    //
    // MYSTERY-ENCOUNTER battles set their enemies intentionally (#439 biome
    // events): the Still Waters mirror clones the player's own party (which can
    // legitimately exceed the cap), the delve guardians (#494) are MEANT to climb
    // past the wave cap with depth, and catch-bosses are hand-built. Never let the
    // wave-ladder cap rewrite an encounter's chosen species.
    // Showdown 1v1 (C3): the opponent's team is a hand-built, exchanged, level-100 team meant
    // to be fielded EXACTLY as built - the wave-1 BST ladder would swap/devolve it. Exempt it
    // like the other curated-content paths (daily / colosseum / ME). Showdown-only -> no other
    // mode's curve is touched.
    // Staff-authored custom trainers (er-custom-trainers.json) are curated
    // content fielded EXACTLY as authored - the wave-ladder cap must never
    // devolve/swap their mons (maintainer directive: staff intent wins).
    // Cross-player ghosts are intentionally NOT exempt. Their selection window
    // cannot prevent an early saved legendary/mega from overshooting the receiving
    // player's curve, so every fielded ghost member must pass this same gate.
    if (
      globalScene.gameMode?.isDaily ||
      globalScene.gameMode?.isShowdown ||
      erColosseumBattleActive ||
      isErCustomTrainerBstBypassActive() ||
      (globalScene.currentBattle?.isBattleMysteryEncounter?.() ?? false)
    ) {
      return;
    }
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    const isBossWave = wave % 10 === 0 || (globalScene.currentBattle?.trainer?.config.isBoss ?? false);
    const baseCap = erEliteBstCapFor(wave, isBossWave, isHell);
    if (baseCap === null) {
      return;
    }
    // ER (#504): biome NOTORIETY raises the BST ceiling LOCALLY by up to +100 the
    // longer the player over-stays a biome. Purely additive and gated to the World
    // Map run - leaving the biome drops overstay to 0 and the cap snaps back to
    // baseCap, so the global curve resumes exactly. No persistent state touched.
    const cap = baseCap + (erBiomeRoutingActive() ? erNotorietyBstBonus(wave) : 0);
    // Hell keeps its early legendary spikes (BST cap still trims most of them);
    // only the vanilla-facing ladders ban legend-likes before the legend wave.
    const legendBanned = !isHell && wave < ER_ELITE_LEGEND_FROM_WAVE();
    const isLegendLike = (sp: PokemonSpecies): boolean => sp.legendary || sp.subLegendary || sp.mythical;
    const defaultForm = (sp: PokemonSpecies): PokemonSpeciesForm => sp.forms?.[0] ?? sp;
    const violatesSpecies = (sp: PokemonSpecies): boolean =>
      defaultForm(sp).getBaseStatTotal() > cap || (legendBanned && isLegendLike(sp));

    // Measure the form that will actually be fielded. Checking only `enemy.species`
    // misses stored mega/alternate forms because their base species may fit the cap.
    const originalSpecies = enemy.species;
    const originalFormIndex = enemy.formIndex;
    const originalBst = enemy.getSpeciesForm(true).getBaseStatTotal();
    if (originalBst <= cap && !(legendBanned && isLegendLike(originalSpecies))) {
      return;
    }

    // A direct ER mega is represented as its own species. Prefer its mapped base
    // before walking the normal prevolution chain or falling back to a factory pick.
    let current = originalSpecies;
    const directMegaBaseId = megaSpeciesToBase().get(current.speciesId);
    if (directMegaBaseId !== undefined) {
      current = getPokemonSpecies(directMegaBaseId) ?? current;
    }

    // 1. Devolve stage by stage while the default form still violates.
    for (let g = 0; g < 3; g++) {
      if (!violatesSpecies(current)) {
        break;
      }
      const prevId = pokemonPrevolutions[current.speciesId];
      if (prevId === undefined) {
        break;
      }
      const prev = getPokemonSpecies(prevId);
      if (!prev) {
        break;
      }
      current = prev;
    }
    // 2. Still violating (legendary / heavy single-stager): swap for a
    //    wave-appropriate factory-pool pick under the cap, closest to it.
    if (violatesSpecies(current)) {
      const pool = resolvedFactorySets().filter(s => {
        const sp = getPokemonSpecies(s.speciesId);
        return sp && !violatesSpecies(sp);
      });
      if (pool.length === 0) {
        return; // nothing safe to swap to - leave it rather than break generation
      }
      const windowStart = Math.max(0, pool.length - 40);
      const idx = windowStart + (hashErSelectionSeed(`${globalScene.seed}:bstcap:${wave}:${enemy.id}`) % (pool.length - windowStart));
      current = getPokemonSpecies(pool[idx].speciesId);
    }
    const formChanged = current === originalSpecies && originalFormIndex !== 0;
    if (current === originalSpecies && !formChanged) {
      return;
    }
    const targetBst = defaultForm(current).getBaseStatTotal();
    const originalLabel =
      originalFormIndex > 0 ? `${originalSpecies.name} form ${originalFormIndex}` : originalSpecies.name;
    console.log(
      `ER #419: BST cap (${cap} @ w${wave}) - replacing ${originalLabel} (${originalBst}) with ${current.name} (${targetBst})`,
    );
    enemy.species = current;
    enemy.formIndex = 0;
    const abilityCount = enemy.getSpeciesForm().getAbilityCount();
    if (enemy.abilityIndex >= abilityCount) {
      enemy.abilityIndex = abilityCount - 1;
    }
    enemy.generateAndPopulateMoveset();
    enemy.calculateStats();
    enemy.generateName();
    // ER (#434): the species changed AFTER EncounterPhase already loaded the
    // enemy's sprite assets - without an explicit reload the battle keeps the
    // OLD species' texture bound (live report: Iron Voca's sprite under a
    // 'Swadloon' nameplate). Fire-and-forget is fine: the trainer intro
    // dialogue + slide-in leave ample frames for the fetch before summon.
    void enemy.loadAssets(false);
  } catch {
    // Curve enforcement must never break enemy generation.
  }
}

/**
 * Ace / Elite early-game gate (Hell exempt): if this enemy is already a mega —
 * either because its SPECIES is a mega (direct roster mega) or because it
 * spawned at a mega/primal/origin FORM index — revert it to its base before the
 * {@linkcode ER_MEGA_MIN_WAVE_NON_HELL} threshold so megas never appear early.
 */
function revertEarlyMega(enemy: EnemyPokemon): void {
  if (getErDifficulty() === "hell") {
    return;
  }
  if ((globalScene.currentBattle?.waveIndex ?? 0) >= ER_MEGA_MIN_WAVE_NON_HELL()) {
    return;
  }
  // (a) The species itself is a mega → swap to the base species.
  const baseId = megaSpeciesToBase().get(enemy.species.speciesId);
  if (baseId !== undefined) {
    const base = getPokemonSpecies(baseId);
    if (base) {
      enemy.species = base;
      enemy.formIndex = 0;
      const abilityCount = enemy.getSpeciesForm().getAbilityCount();
      if (enemy.abilityIndex >= abilityCount) {
        enemy.abilityIndex = abilityCount - 1;
      }
      enemy.calculateStats();
      enemy.generateName();
      // ER (#434): see enforceErEliteBstCurve - rebind the sprite to the
      // base species after the late swap.
      void enemy.loadAssets(false);
      return;
    }
  }
  // (b) Base species but spawned at a mega/primal/origin form → reset to base form.
  const forms = enemy.species.forms ?? [];
  const formKey = forms[enemy.formIndex]?.formKey ?? "";
  if (enemy.formIndex > 0 && /mega|primal|origin/i.test(formKey)) {
    enemy.formIndex = 0;
    enemy.calculateStats();
    enemy.generateName();
    // ER (#434): the form changed after asset load - rebind to the base form.
    void enemy.loadAssets(false);
  }
}

/**
 * The mega/primal/origin target form key a given ER stone evolves into. ER stone
 * enum names carry the same suffix convention as the species consts
 * (`_X` → Mega-X, `_Y` → Mega-Y, the legendary orbs → Origin), so we can pick the
 * EXACT target form instead of blindly grabbing the first `/mega/` form (which
 * would mis-evolve Charizard-Y when it held Charizardite-X, and entirely miss
 * Primal/Origin forms). Returns `null` for an unknown stone → caller falls back
 * to a broad search.
 */
function erStoneTargetFormKey(itemId: number): SpeciesFormKey | null {
  const name = ER_MEGA_STONE_NAME_BY_ITEM.get(itemId);
  if (name === undefined) {
    return null;
  }
  if (/_X(_|$)/.test(name)) {
    return SpeciesFormKey.MEGA_X;
  }
  if (/_Y(_|$)/.test(name)) {
    return SpeciesFormKey.MEGA_Y;
  }
  if (/PRIMAL/.test(name)) {
    return SpeciesFormKey.PRIMAL;
  }
  if (/(ADAMANT|LUSTROUS|GRISEOUS|GALACTIC)_ORB/.test(name)) {
    return SpeciesFormKey.ORIGIN;
  }
  return SpeciesFormKey.MEGA;
}

/**
 * Pick the form index this mon should mega/primal-evolve into. Prefers the form
 * key implied by the held stone (Mega-X vs Mega-Y vs Primal vs Origin); if the
 * species has no exactly-matching form, falls back to the first
 * mega/primal/origin form it does have (so a stone whose suffix doesn't line up
 * with the species' registered form key still evolves rather than no-op'ing).
 */
function pickErMegaFormIndex(enemy: EnemyPokemon, itemId: number): number {
  const forms = enemy.species.forms ?? [];
  const desired = erStoneTargetFormKey(itemId);
  if (desired !== null) {
    const exact = forms.findIndex(f => f.formKey === desired);
    if (exact > 0) {
      return exact;
    }
  }
  // Broad fallback: any non-base mega/primal/origin form.
  return forms.findIndex(f => /mega|primal|origin/i.test(f.formKey));
}

/**
 * Force an ER trainer mon that held a Mega Stone into its Mega/Primal/Origin form
 * (boss treatment). Defensive: only changes form if the species actually has a
 * matching form registered — otherwise no-op. In Ace/Elite this is gated to
 * {@linkcode ER_MEGA_MIN_WAVE_NON_HELL}+ so megas don't appear in the early
 * game; Hell is left untouched.
 */
function forceErMega(enemy: EnemyPokemon, itemId: number): void {
  if (getErDifficulty() !== "hell") {
    const waveIndex = globalScene.currentBattle?.waveIndex ?? 0;
    if (waveIndex < ER_MEGA_MIN_WAVE_NON_HELL()) {
      return;
    }
  }
  const megaIndex = pickErMegaFormIndex(enemy, itemId);
  if (megaIndex <= 0 || enemy.formIndex === megaIndex) {
    return;
  }
  enemy.formIndex = megaIndex;
  // Keep the ability slot in range for the new form.
  const abilityCount = enemy.getSpeciesForm().getAbilityCount();
  if (enemy.abilityIndex >= abilityCount) {
    enemy.abilityIndex = abilityCount - 1;
  }
  enemy.calculateStats();
  enemy.generateName();
}

/**
 * True if the given trainer has any matching ER roster. Cheaper than
 * `applyErRosterOverride` for callers that just want to gate behavior
 * (e.g. "is this an ER battle?").
 */
export function hasErRosterOverride(trainer: Trainer): boolean {
  return getErTrainerForTrainer(trainer) !== null;
}

// =============================================================================
// ER Battle-Factory sets (#347) — sporadic competitive teams on Elite/Hell.
//
// The maintainer-provided factory_sets dump (1932 Battle-Factory-style sets,
// species + 4 moves + ability slot) seasons the Elite/Hell trainer pool: a
// small seeded fraction of REGULAR trainer waves fields a team assembled from
// wave/BST-appropriate factory sets instead of an ER trainer roster, so the
// repetitive per-class pools get genuine variety. Ace is untouched (#345).
// Held items come from PokeRogue's baseline trainer item roll (the dump's item
// column uses an undecodable newer-ROM id space — see the builder script).
// =============================================================================

/** % of eligible (Elite/Hell, regular, non-rival) trainer waves that field a factory team.
 * Exported as the DEFAULT the editor tooling shows next to any er-trainer-tuning.json override. */
export const ER_FACTORY_TEAM_CHANCE_PCT = 15;

interface ErFactorySetResolved {
  readonly speciesId: number;
  readonly moves: readonly number[];
  readonly abilitySlot: 0 | 1 | 2;
  readonly bst: number;
}

/** Factory sets with ids resolved through ER_ID_MAP, sorted weakest → strongest. */
let FACTORY_POOL: ErFactorySetResolved[] | null = null;

/** Test hook: drop the memoized factory pool (e.g. after changing the tuning table). */
export function resetErFactoryPoolForTesting(): void {
  FACTORY_POOL = null;
}

/** Exported for unit testing. */
export function resolvedFactorySets(): readonly ErFactorySetResolved[] {
  if (FACTORY_POOL !== null) {
    return FACTORY_POOL;
  }
  const out: ErFactorySetResolved[] = [];
  const excluded = erFactoryExcludedDraftIds();
  const overridden = erFactoryOverriddenDraftIds();
  for (const [erSpecies, erMoves, abilitySlot] of ER_FACTORY_SETS) {
    if (excluded.has(erSpecies)) {
      continue; // editor-managed set-membership exclusion (er-trainer-tuning.json)
    }
    if (overridden.has(erSpecies)) {
      continue; // editor-managed set REPLACEMENT — the override entries below win
    }
    const speciesId = ER_ID_MAP.species[erSpecies];
    if (speciesId === undefined) {
      continue; // cosmetic/unmapped form — same drop rule as trainer rosters
    }
    const bst = getPokemonSpecies(speciesId)?.getBaseStatTotal() ?? 0;
    if (bst <= 0) {
      continue;
    }
    const moves: number[] = [];
    for (const m of erMoves) {
      const mapped = ER_ID_MAP.moves[m];
      if (mapped !== undefined) {
        moves.push(mapped);
      }
    }
    out.push({ speciesId, moves, abilitySlot, bst });
  }
  // Editor-managed replacement sets (er-trainer-tuning.json sets.factorySetOverrides);
  // also how the team gives factory sets to species with none shipped.
  for (const entry of erFactorySetOverrideEntries()) {
    if (entry.speciesId === undefined || entry.moves.length === 0) {
      continue;
    }
    const bst = getPokemonSpecies(entry.speciesId)?.getBaseStatTotal() ?? 0;
    if (bst <= 0) {
      continue;
    }
    out.push({ speciesId: entry.speciesId, moves: entry.moves, abilitySlot: entry.abilitySlot, bst });
  }
  out.sort((a, b) => a.bst - b.bst);
  FACTORY_POOL = out;
  return out;
}

let FACTORY_BY_TRAINER: WeakMap<Trainer, ErFactorySetResolved[] | null> = new WeakMap();

/**
 * The factory team this trainer fields, or `null` (most trainers). Decided once
 * per Trainer from the RUN SEED + wave (same pure-hash scheme as the ER trainer
 * pick, so party generation stays reproducible), gated to Elite/Hell regular
 * waves. Team members are picked from a BST window around the wave-appropriate
 * strength, distinct species, varied by seed.
 */
export function getErFactoryTeamForTrainer(trainer: Trainer): readonly ErFactorySetResolved[] | null {
  const cached = FACTORY_BY_TRAINER.get(trainer);
  if (cached !== undefined) {
    return cached;
  }
  let team: ErFactorySetResolved[] | null = null;
  const difficulty = getErDifficulty();
  const wave = globalScene.currentBattle?.waveIndex ?? 0;
  const isRival = ER_RIVAL_TRAINER_TYPES.has(trainer.config.trainerType);
  const isBossWave = trainer.config.isBoss || wave % 10 === 0;
  if (!isErVanillaDifficulty(difficulty) && !isRival && !isBossWave) {
    // Editor-managed per-difficulty override first (er-trainer-tuning.json).
    const chancePct = erTunedFactoryTeamPct(difficulty) ?? ER_FACTORY_TEAM_CHANCE_PCT;
    const roll = hashErSelectionSeed(`${globalScene.seed}:factory:${wave}`) % 100;
    const pool = roll < chancePct ? resolvedFactorySets() : [];
    if (pool.length > 0) {
      const size = Math.max(1, trainer.getPartyTemplate?.()?.size ?? 1);
      const frac = Math.min(1, Math.max(0, (wave - 1) / erWaveProgressionSpan()));
      const targetIdx = Math.round(frac * (pool.length - 1));
      const radius = Math.max(size * 8, 60);
      const lo = Math.max(0, targetIdx - radius);
      const hi = Math.min(pool.length - 1, targetIdx + radius);
      const picked: ErFactorySetResolved[] = [];
      const seenSpecies = new Set<number>();
      for (let salt = 0; picked.length < size && salt < 200; salt++) {
        const idx = lo + (hashErSelectionSeed(`${globalScene.seed}:factory:${wave}:${salt}`) % (hi - lo + 1));
        const cand = pool[idx];
        if (seenSpecies.has(cand.speciesId)) {
          continue;
        }
        seenSpecies.add(cand.speciesId);
        picked.push(cand);
      }
      if (picked.length > 0) {
        team = picked;
      }
    }
  }
  FACTORY_BY_TRAINER.set(trainer, team);
  return team;
}

/** True if this trainer fields a factory team (#347). */
export function hasErFactoryOverride(trainer: Trainer): boolean {
  return getErFactoryTeamForTrainer(trainer) !== null;
}

/**
 * Build the factory-team EnemyPokemon for `index`, or `null` when this trainer
 * has no factory team / the index is past it. Mirrors the ER roster path:
 * wave-scaled level, fixed moves/ability, baseline item roll untouched. The
 * nature is hash-derived per slot for variety (the dump ships no natures).
 */
export function applyErFactoryOverride(trainer: Trainer, index: number): EnemyPokemon | null {
  const team = getErFactoryTeamForTrainer(trainer);
  if (!team || index >= team.length) {
    return null;
  }
  const set = team[index];
  const wave = globalScene.currentBattle?.waveIndex ?? 0;
  const nature = hashErSelectionSeed(`${globalScene.seed}:factory-nature:${wave}:${index}`) % 25;
  return buildErEnemyFromMember(trainer, index, {
    speciesId: set.speciesId,
    level: 50,
    abilitySlot: set.abilitySlot,
    ivs: [31, 31, 31, 31, 31, 31],
    evs: [0, 0, 0, 0, 0, 0],
    itemId: 0,
    nature,
    moves: set.moves,
    hpType: 0,
  });
}

/** Reset the factory caches (tests). */
export function clearErFactoryCacheForTests(): void {
  FACTORY_BY_TRAINER = new WeakMap();
}
