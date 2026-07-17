/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Omniform` (Batch 4, item 2).
//
// A GENERAL "adaptive evolution" ability driven by a CONFIGURABLE registry that
// maps (holder species/form) -> { moveType -> target species/form }. When the
// holder selects and successfully begins using a damaging OR status move of type
// T, and its CURRENT form has a mapping for T, the holder form-changes
// mega-style into the mapped target BEFORE the move resolves:
//   - Stats are recomputed from the target form's base stats (via the
//     Transform-style `summonData.speciesForm` override + `calculateStats()`),
//     so speed order is re-evaluated mid-turn exactly like a mega evolution (the
//     MovePhase priority queue re-sorts by live `getEffectiveStat(SPD)` on its
//     next pop).
//   - ALL of the holder's moves EXCEPT the move currently being used are
//     replaced by the target form's moveset. DEFAULT (until a curation UI
//     exists): a seeded, level-appropriate 3-move set auto-derived from the
//     target's learnset (documented). The used move keeps its slot.
//   - Omniform is PINNED across the transform (`summonData.ability`), so it
//     persists and can CHAIN freely: a later mapped-type move transforms again
//     with no lock.
//
// Battle-scoped: because the form + moveset live entirely on `summonData`, they
// revert to the pre-battle state on switch-out / wave end / battle end via
// `resetSummonData()` (the mega-revert precedent) with no extra teardown.
//
// PRODUCTION: no real mapping is registered here — the partner-eeveelution forms
// land with the mon batch, and normal eeveelutions must be unaffected. Mappings
// are registered ONLY by callers (the test harness) via
// `registerOmniformMapping`.
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import {
  clearOmniformBattleMovesets,
  ensureOmniformFormMovesets,
  isErOmniformMon,
  loadOmniformBattleMoveset,
  snapshotOmniformBattleMoveset,
} from "#data/elite-redux/omniform-movesets";
import type { PokemonSpecies, PokemonSpeciesForm } from "#data/pokemon-species";
import type { AbilityId } from "#enums/ability-id";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import type { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { PokemonMove } from "#moves/pokemon-move";
import { playErTransformFx } from "#sprites/er-form-transform-fx";
import type { AbAttrBaseParams } from "#types/ability-types";
import type { FightUiHandler } from "#ui/handlers/fight-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_OMNIFORM_ABILITY_ID = 5929;

/** Number of moves auto-derived from the target form's learnset (DEFAULT). */
export const OMNIFORM_DERIVED_MOVE_COUNT = 3;

/** A resolved transform target: a species and (optional) form index. */
export interface OmniformTarget {
  speciesId: SpeciesId;
  formIndex: number;
}

/** Registry key for a (species, form) pair. */
function identityKey(speciesId: number, formIndex: number): string {
  return `${speciesId}:${formIndex}`;
}

/**
 * The configurable registry: (holder species/form) -> (moveType -> target).
 * Empty in production; populated by the test harness. Exposed only through the
 * register/clear helpers so callers can't hold a mutable reference.
 */
const OMNIFORM_REGISTRY = new Map<string, Map<PokemonType, OmniformTarget>>();

/**
 * Register a mapping: a holder in form `(fromSpeciesId, fromFormIndex)` using a
 * move of type `moveType` transforms into `(toSpeciesId, toFormIndex)`.
 */
export function registerOmniformMapping(
  fromSpeciesId: SpeciesId,
  fromFormIndex: number,
  moveType: PokemonType,
  toSpeciesId: SpeciesId,
  toFormIndex = 0,
): void {
  const key = identityKey(fromSpeciesId, fromFormIndex);
  let byType = OMNIFORM_REGISTRY.get(key);
  if (!byType) {
    byType = new Map();
    OMNIFORM_REGISTRY.set(key, byType);
  }
  byType.set(moveType, { speciesId: toSpeciesId, formIndex: toFormIndex });
}

/** Remove every registered mapping (test isolation). */
export function clearOmniformRegistry(): void {
  OMNIFORM_REGISTRY.clear();
}

/** The mapped target for `pokemon`'s CURRENT form and `moveType`, or `undefined`. */
function lookupTarget(pokemon: Pokemon, moveType: PokemonType): OmniformTarget | undefined {
  const sf = pokemon.getSpeciesForm();
  return OMNIFORM_REGISTRY.get(identityKey(sf.speciesId, sf.formIndex))?.get(moveType);
}

/** Whether `(speciesId, formIndex)` is a registered Omniform HOLDER (has at least one mapping). */
export function erOmniformIsHolderIdentity(speciesId: number, formIndex: number): boolean {
  return OMNIFORM_REGISTRY.has(identityKey(speciesId, formIndex));
}

/**
 * The ORDERED set of forms in `(speciesId, formIndex)`'s Omniform "family": the base
 * identity itself, followed by the transitive closure of every form reachable through
 * its type mappings (deduped, discovery order). For a non-holder identity the result is
 * just `[{speciesId, formIndex}]` (length 1). This is the generic "all evolutions of a
 * multi-form / Omniform mon" list every per-evolution moveset consumer iterates.
 */
export function erOmniformFamilyForms(speciesId: number, formIndex: number): OmniformTarget[] {
  const seen = new Set<string>();
  const out: OmniformTarget[] = [];
  const queue: OmniformTarget[] = [{ speciesId: speciesId as SpeciesId, formIndex }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const key = identityKey(cur.speciesId, cur.formIndex);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(cur);
    const byType = OMNIFORM_REGISTRY.get(key);
    if (byType) {
      for (const target of byType.values()) {
        if (!seen.has(identityKey(target.speciesId, target.formIndex))) {
          queue.push({ speciesId: target.speciesId, formIndex: target.formIndex });
        }
      }
    }
  }
  return out;
}

/** Pure marker: Omniform is driven by the pre-move seam below. */
export class OmniformAbAttr extends PostSummonAbAttr {
  constructor() {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}
}

/** Whether `pokemon` carries an unsuppressed, active Omniform. */
function hasOmniform(pokemon: Pokemon): boolean {
  return (
    pokemon.isActive(true) && pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "OmniformAbAttr")
  );
}

/** Resolve the target's `PokemonSpeciesForm` (a specific form, or the species itself). */
function resolveSpeciesForm(target: OmniformTarget): PokemonSpeciesForm {
  const species = getPokemonSpecies(target.speciesId);
  const forms = species.forms;
  if (forms && forms.length > target.formIndex && target.formIndex >= 0) {
    return forms[target.formIndex];
  }
  return species;
}

/** The holder's pre-transform identity, snapshotted on its FIRST transform in a battle. */
interface OmniformOriginal {
  wave: number;
  species: PokemonSpecies;
  formIndex: number;
}

const OMNIFORM_ORIGINAL = new WeakMap<Pokemon, OmniformOriginal>();

/**
 * Snapshot the holder's pre-battle species/form on its FIRST transform and NOT
 * again until the entry is cleared on `leaveField` (switch-out / faint / wave end).
 *
 * The snapshot MUST be captured once per BATTLE, not once per wave: a chained
 * transform (Eevee -> Jolteon -> Umbreon) whose links land on different wave
 * indices would, under a per-wave guard, re-snapshot the INTERMEDIATE form
 * (Jolteon) as the "original" and revert there instead of all the way back to
 * Eevee. Guarding purely on presence captures the true pre-battle identity once
 * and preserves it across the whole chain; `erOmniformRevertOnLeaveField` deletes
 * the entry when the holder leaves the field, so the next battle re-snapshots
 * from the reverted base.
 */
function snapshotOriginal(user: Pokemon): void {
  if (!OMNIFORM_ORIGINAL.has(user)) {
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    OMNIFORM_ORIGINAL.set(user, { wave, species: user.species, formIndex: user.formIndex });
  }
}

/**
 * The holder's PRE-TRANSFORM (source) species, or `undefined` if it has not
 * Omniform-transformed this battle. Used by the innate-unlock gate so a
 * transformed holder reads its innate candy-unlock state from the SOURCE species
 * (e.g. Partner Eevee) instead of the transform TARGET species (a partner
 * eeveelution, id 70012+), which the player never candy-unlocked. This carries the
 * source's unlocked-innate set to every mid-battle form it adapts into (maintainer
 * directive), and — because the snapshot is captured once per BATTLE and cleared on
 * `leaveField` — it survives a chain (Eevee -> Jolteon -> Umbreon) and reverts
 * exactly on switch-out / wave end.
 */
export function erOmniformOriginalSpecies(holder: Pokemon): PokemonSpecies | undefined {
  return OMNIFORM_ORIGINAL.get(holder)?.species;
}

/**
 * The holder's PRE-TRANSFORM (source) identity — species id + form index — or
 * `undefined` if it has not Omniform-transformed this battle. The per-evolution
 * moveset model reads this to anchor a transformed holder's persistent "base" form
 * (e.g. Partner Eevee) instead of the transient transform target it is wearing.
 */
export function erOmniformOriginalIdentity(holder: Pokemon): { speciesId: SpeciesId; formIndex: number } | undefined {
  const original = OMNIFORM_ORIGINAL.get(holder);
  return original ? { speciesId: original.species.speciesId, formIndex: original.formIndex } : undefined;
}

/**
 * Revert an Omniform holder to its pre-battle species/form + stats. Driven from
 * `Pokemon.leaveField` (switch-out / faint / wave end — the mega-revert
 * precedent). `summonData` (the pinned ability + swapped moveset) is already
 * cleared by `resetSummonData` in `leaveField`; this restores the species-level
 * state that lives outside summon data.
 */
export function erOmniformRevertOnLeaveField(holder: Pokemon): void {
  // Battle-scoped per-form PP cache: cleared unconditionally on leaveField so the
  // next send-out starts every evolution's moveset from its stored resting PP.
  clearOmniformBattleMovesets(holder);
  const original = OMNIFORM_ORIGINAL.get(holder);
  if (!original) {
    return;
  }
  OMNIFORM_ORIGINAL.delete(holder);
  holder.species = original.species;
  holder.formIndex = original.formIndex;
  holder.calculateStats();
  holder.generateName();
}

/**
 * MID-BATTLE revert to the BASE evolution form (the Normal-type status-move rule).
 * Unlike {@linkcode erOmniformRevertOnLeaveField} (which runs after `resetSummonData`
 * has already cleared summon data on switch-out), this runs while the holder stays on
 * the field: it restores the pre-transform species/form, swaps the live moveset back
 * to the base form's own moveset (PP preserved for the battle), keeps Omniform pinned,
 * and fires the same transform VFX. A no-op when the holder has not transformed
 * (already on base) — a Normal status move then simply keeps it on base.
 */
export function erOmniformRevertToBase(holder: Pokemon): void {
  const original = OMNIFORM_ORIGINAL.get(holder);
  if (!original) {
    return;
  }
  // Preserve the OUTGOING (current) form's live PP before swapping away from it.
  snapshotOmniformBattleMoveset(
    holder,
    { speciesId: holder.getSpeciesForm().speciesId, formIndex: holder.formIndex },
    holder.getMoveset(),
  );

  OMNIFORM_ORIGINAL.delete(holder);
  const base = { speciesId: original.species.speciesId, formIndex: original.formIndex };
  holder.species = original.species;
  holder.formIndex = original.formIndex;
  // Keep Omniform pinned so the base form can transform again this battle.
  holder.summonData.ability = ER_OMNIFORM_ABILITY_ID as AbilityId;
  holder.summonData.types = [];
  holder.calculateStats();
  holder.generateName();

  // Restore the base form's own live moveset (battle-cached PP if it was active earlier).
  holder.summonData.moveset = loadOmniformBattleMoveset(holder, base);

  (globalScene.ui?.handlers?.[UiMode.FIGHT] as FightUiHandler | undefined)?.refreshMoves();
  playErTransformFx(holder, holder.getSpeciesForm().type1);
  void holder.loadAssets(false).then(() => holder.updateInfo());
  globalScene.phaseManager.queueMessage(
    `${getPokemonNameWithAffix(holder)} reverted to ${original.species.getName()}!`,
  );
}

/**
 * A seeded, level-appropriate move set (up to `OMNIFORM_DERIVED_MOVE_COUNT`)
 * from `speciesForm`'s learnset, preferring the most recently learned moves the
 * holder's level qualifies for and excluding `excludeMoveId`.
 */
function deriveMoveset(speciesForm: PokemonSpeciesForm, level: number, excludeMoveId: number): number[] {
  const levelMoves = speciesForm.getLevelMoves();
  // Eligible = learnable at or below the holder's level, distinct, not the used move.
  const eligible: number[] = [];
  const seen = new Set<number>([excludeMoveId]);
  // Iterate high-level first so a level-appropriate mon gets its strongest kit.
  for (let i = levelMoves.length - 1; i >= 0; i--) {
    const [moveLevel, moveId] = levelMoves[i];
    if (moveLevel > level || seen.has(moveId)) {
      continue;
    }
    seen.add(moveId);
    eligible.push(moveId);
  }
  // Seeded shuffle of the eligible pool, then take the first N.
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = globalScene.randBattleSeedInt(i + 1);
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  return eligible.slice(0, OMNIFORM_DERIVED_MOVE_COUNT);
}

/**
 * Pre-move seam (driven from `MovePhase.start`, non-follow-up only): if the
 * holder carries Omniform and its current form maps `move`'s type to a target,
 * transform into that target before the move resolves.
 */
export function erOmniformOnMoveStart(user: Pokemon, move: Move): void {
  if (!hasOmniform(user)) {
    return;
  }
  const moveType = user.getMoveType(move);

  // NORMAL-type STATUS move => revert to the BASE evolution form (dex rule). Keyed on
  // the move's INHERENT (base) type so a genuinely Normal status move (Growl, Tail
  // Whip, ...) always reverts, even on a holder whose ability would -ate it to another
  // type. Same transform pathway (so the VFX hook fires); a no-op when already on base.
  if (move.category === MoveCategory.STATUS && move.type === PokemonType.NORMAL) {
    erOmniformRevertToBase(user);
    return;
  }

  const target = lookupTarget(user, moveType);
  if (!target) {
    return;
  }
  const speciesForm = resolveSpeciesForm(target);
  const targetSpecies = getPokemonSpecies(target.speciesId);

  // For a real per-evolution Omniform mon (Partner Eevee), each evolution carries
  // its OWN stored moveset. Ensure the store exists on first transform, and snapshot
  // the OUTGOING form's live PP so returning to it later this battle keeps that PP.
  const perEvolution = isErOmniformMon(user);
  const fromForm = { speciesId: user.getSpeciesForm().speciesId, formIndex: user.formIndex };
  if (perEvolution) {
    ensureOmniformFormMovesets(user);
    snapshotOmniformBattleMoveset(user, fromForm, user.getMoveset());
  }

  // Snapshot the pre-battle identity (once per wave) so revert is exact even
  // after a chain of transforms.
  snapshotOriginal(user);

  // Mega-style form change: swap the holder's species/form so `calculateStats`
  // (which reads `getSpeciesForm(true)` — ignoring summon-data overrides) picks
  // up the TARGET form's base stats, exactly like a mega changing `formIndex`.
  // The new species also drives typing / sprite / name. Reverts on leaveField.
  user.species = targetSpecies;
  user.formIndex = target.formIndex;
  // Pin Omniform so it persists across the transform and can chain again.
  user.summonData.ability = ER_OMNIFORM_ABILITY_ID as AbilityId;
  // Drop any prior wholesale type override so the new form's typing applies.
  user.summonData.types = [];
  user.calculateStats();
  user.generateName();

  if (perEvolution) {
    // Swap the live moveset to the TARGET evolution's OWN stored moveset (PP
    // preserved per form within the battle via the battle cache).
    user.summonData.moveset = loadOmniformBattleMoveset(user, target);
  } else {
    // Legacy / harness-forced mapping (no per-evolution store): the documented
    // seeded-derive default, keeping the used move in its original slot.
    const currentMoveset = user.getMoveset();
    const usedIndex = currentMoveset.findIndex(m => m?.moveId === move.id);
    const derived = deriveMoveset(speciesForm, user.level, move.id);
    let derivedCursor = 0;
    const newMoveset = currentMoveset.map((slot, index) => {
      if (index === usedIndex) {
        return slot ?? new PokemonMove(move.id);
      }
      if (derivedCursor < derived.length) {
        return new PokemonMove(derived[derivedCursor++]);
      }
      return slot ?? new PokemonMove(move.id);
    });
    // If the used move was not in the moveset (a cast/called move), still keep it
    // by prepending, capped at the max move count.
    if (usedIndex < 0) {
      newMoveset.unshift(new PokemonMove(move.id));
      newMoveset.length = Math.min(newMoveset.length, user.getMaxMoveCount());
    }
    user.summonData.moveset = newMoveset;
  }

  // If the fight menu is currently on screen for this holder, its cached move list
  // is now stale (old names/types/PP/detail). Force a rebuild from the swapped
  // moveset. `refreshMoves` self-guards on the menu being active, so a normal
  // mid-move transform (menu already closed) leaves it a no-op.
  (globalScene.ui?.handlers?.[UiMode.FIGHT] as FightUiHandler | undefined)?.refreshMoves();

  // Partner-evolution transform VFX: a brief burst tinted by the TARGET form's
  // primary type + type-themed particles. This path IS the partner/Omniform
  // predicate (only registered mappings reach here), so OTHER form changes keep
  // their existing presentation. Purely visual + fail-closed (never throws).
  playErTransformFx(user, speciesForm.type1);

  void user.loadAssets(false).then(() => user.updateInfo());
  globalScene.phaseManager.queueMessage(
    `${getPokemonNameWithAffix(user)} adapted into ${getPokemonSpecies(target.speciesId).getName()}!`,
  );
}
