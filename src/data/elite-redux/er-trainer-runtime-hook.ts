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
  type ErPartyMemberRegistered,
  type ErTrainerRegistryEntry,
} from "#data/elite-redux/init-elite-redux-trainers";
import { type ErRosterTier, findErTrainersForType, selectErRoster } from "#data/elite-redux/er-trainer-overlay";
import { ER_ITEM_CONVERT_CHANCE, resolveErTrainerItem } from "#data/elite-redux/er-trainer-item-map";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { Nature } from "#enums/nature";
import { TrainerSlot } from "#enums/trainer-slot";
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
export function getErTrainerForTrainer(trainer: Trainer): ErTrainerRegistryEntry | null {
  const cached = TRAINER_CACHE.get(trainer);
  if (cached !== undefined) {
    return cached;
  }
  const trainerType = trainer.config.trainerType;
  const candidates = findErTrainersForType(trainerType);
  // Seed the pick off the wave index so EVERY ER trainer of a class is reachable
  // across a run (rotating through them), not just the first. Deterministic per
  // wave; cached per Trainer instance so all party members agree.
  let choice: ErTrainerRegistryEntry | null = null;
  if (candidates.length > 0) {
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    choice = candidates[wave % candidates.length];
  }
  TRAINER_CACHE.set(trainer, choice);
  return choice;
}

/**
 * Pick the ER roster tier for the current wave so team size + difficulty scale
 * with PokeRogue's curve: easy rosters early, the full (insane/hell) rosters at
 * boss-tier waves. Boss waves are every 10th wave (PokeRogue's classic cadence)
 * or any trainer flagged as a boss/major encounter.
 */
export function pickTierForWave(trainer: Trainer): ErRosterTier {
  const wave = globalScene.currentBattle?.waveIndex ?? 1;
  const isBoss = trainer.config.isBoss || wave % 10 === 0;
  if (isBoss || wave >= 100) {
    return "hell";
  }
  if (wave >= 40) {
    return "insane";
  }
  return "party";
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
  const member = roster[index];
  const species = getPokemonSpecies(member.speciesId);
  if (!species) {
    return null;
  }
  const battle = globalScene.currentBattle;
  const level = battle.enemyLevels?.[index] ?? member.level;
  const trainerSlot
    = !trainer.isDouble() || !(index % 2) ? TrainerSlot.TRAINER : TrainerSlot.TRAINER_PARTNER;
  const enemy: EnemyPokemon = globalScene.addEnemyPokemon(species, level, trainerSlot);
  enemy.abilityIndex = member.abilitySlot;
  enemy.ivs = [
    member.ivs[0],
    member.ivs[1],
    member.ivs[2],
    member.ivs[3],
    member.ivs[4],
    member.ivs[5],
  ];
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
