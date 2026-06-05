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
  type ErPartyMemberRegistered,
  type ErTrainerRegistryEntry,
} from "#data/elite-redux/init-elite-redux-trainers";
import { erDifficultyToRosterTier, getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { type ErRosterTier, findErTrainersForType, selectErRoster } from "#data/elite-redux/er-trainer-overlay";
import { ER_ITEM_CONVERT_CHANCE, resolveErTrainerItem } from "#data/elite-redux/er-trainer-item-map";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { Nature } from "#enums/nature";
import { PlayerGender } from "#enums/player-gender";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { EnemyPokemon } from "#field/pokemon";
import type { Trainer } from "#field/trainer";
import { PokemonMove } from "#moves/pokemon-move";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/**
 * Cache of selected ER trainer per pokerogue Trainer instance. The cached
 * value is either an `ErTrainerRegistryEntry` (matched) or `null` (no
 * match — vanilla generation should run). Using a WeakMap so destroyed
 * Trainer instances don't keep the cache alive.
 */
let TRAINER_CACHE: WeakMap<Trainer, ErTrainerRegistryEntry | null> = new WeakMap();

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
 * Wave by which the strongest trainers of a type are reached. Maps a run's wave
 * depth onto a 0..1 fraction used to index the strength-ordered pool, so early
 * waves field the weakest (often-unevolved) teams and late waves the strongest.
 */
const ER_WAVE_PROGRESSION_SPAN = 180;

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
  // ACE difficulty = pure vanilla PokeRogue trainers (no ER roster override).
  // ELITE / HELL pull from the ER pool at the insane / hell tier.
  if (getErDifficulty() !== "ace") {
    const tier = erDifficultyToRosterTier();
    const all = findErTrainersForType(trainer.config.trainerType);
    // Prefer trainers that actually ship the chosen difficulty's roster, then
    // those not yet seen this run (a difficulty shouldn't repeat trainers).
    const tierMatched = all.filter(t => trainerHasTier(t, tier));
    const unusedTier = tierMatched.filter(t => !USED_ER_TRAINER_KEYS.has(t.stableKey));
    const unusedAll = all.filter(t => !USED_ER_TRAINER_KEYS.has(t.stableKey));
    // Never repeat a trainer while fresh ones remain (#225). Preference order:
    //   1. unseen + tier-appropriate (insane/hell roster)
    //   2. unseen of this type at all (avoids repeats even if its insane/hell
    //      roster pool is small — falls back to the party roster via selectErRoster)
    //   3. only once EVERY trainer of this type is used do we allow a repeat.
    const pool =
      unusedTier.length > 0
        ? unusedTier
        : unusedAll.length > 0
          ? unusedAll
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
      const frac = Math.min(1, Math.max(0, (wave - 1) / ER_WAVE_PROGRESSION_SPAN));
      const targetIdx = Math.round(frac * (ordered.length - 1));
      choice = ordered[targetIdx];
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
  const roster: readonly ErPartyMemberRegistered[] = selectErRoster(erTrainer, pickTierForWave(trainer));
  if (index >= roster.length) {
    return null;
  }
  return buildErEnemyFromMember(trainer, index, roster[index]);
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
  const species = getPokemonSpecies(member.speciesId);
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
const ER_RIVAL_STAGES = ["Route 103", "Rustboro", "Route 110", "Route 119", "Lilycove"] as const;

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

/**
 * Scale PokeRogue's 6 rival encounters onto ER's 5 stages so that the FINAL
 * PokeRogue rival (RIVAL_6, the ~Lv 195 endgame fight) always maps to ER's final
 * rival battle (Lilycove), and earlier encounters map proportionally back through
 * the progression. The actual mon levels come from the engine's wave curve — this
 * only chooses which ER stage's species/movesets to use.
 */
export function erRivalStageForEncounter(encounterIndex: number): (typeof ER_RIVAL_STAGES)[number] {
  const lastEncounter = 5; // RIVAL_6
  const lastStage = ER_RIVAL_STAGES.length - 1;
  const idx = Math.round((encounterIndex / lastEncounter) * lastStage);
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

/**
 * The ER rival registry entry for a given live rival Trainer, or `null` when the
 * ER rival shouldn't apply (Ace difficulty, or not a rival encounter). The rival
 * identity mirrors the on-screen rival's gender: the female variant (Ivy) → May,
 * otherwise (Finn) → Brendan, matching ER's "rival is your counterpart" framing.
 */
export function getErRivalEntry(trainer: Trainer): ErTrainerRegistryEntry | null {
  if (getErDifficulty() === "ace") {
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
  const rivalName = isFemaleRival ? "May" : "Brendan";
  const stage = erRivalStageForEncounter(encounterIndex);
  const starter = erRivalStarterVariant();
  return ER_TRAINER_BY_KEY.get(`${rivalName} ${stage} ${starter}`) ?? null;
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
  const roster = selectErRoster(entry, pickTierForWave(trainer));
  if (index >= roster.length) {
    return null;
  }
  return buildErEnemyFromMember(trainer, index, roster[index]);
}

/** True if this trainer is an ER-overridden rival (used to gate the rival hook). */
export function hasErRivalOverride(trainer: Trainer): boolean {
  return getErRivalEntry(trainer) !== null;
}

/**
 * After PokeRogue rolls its baseline trainer held items, apply the soft ER
 * conversion: with {@linkcode ER_ITEM_CONVERT_CHANCE} probability, if the ER
 * roster member held a translatable competitive item, give the mapped
 * PokeRogue held item. Balls / berries / consumables / unmapped items are left
 * to the baseline roll. (Recreated ER-only items and mega-stone force-evolves
 * are layered on separately.)
 */
export function applyErTrainerHeldItems(party: readonly EnemyPokemon[]): void {
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
      // gave it (we don't strip those).
      forceErMega(enemy);
      continue;
    }
    // Soft conversion: only sometimes override the baseline roll with the
    // ER-faithful item.
    if (enemy.randBattleSeedInt(100) >= ER_ITEM_CONVERT_CHANCE * 100) {
      continue;
    }
    const modifier = res.make().newModifier(enemy) as PokemonHeldItemModifier | null;
    if (modifier) {
      globalScene.addEnemyModifier(modifier, true, true);
    }
  }
}

/**
 * Force an ER trainer mon that held a Mega Stone into its Mega form (boss
 * treatment). Defensive: only changes form if the species actually has a Mega
 * form registered — otherwise no-op.
 */
function forceErMega(enemy: EnemyPokemon): void {
  const forms = enemy.species.forms ?? [];
  const megaIndex = forms.findIndex(f => /mega/i.test(f.formKey));
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
