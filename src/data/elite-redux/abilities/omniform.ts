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
  deleteOmniformOriginal,
  erOmniformConnectedForms,
  getOmniformOriginal,
  lookupOmniformTarget,
  type OmniformTarget,
  snapshotOmniformOriginal,
} from "#data/elite-redux/abilities/omniform-registry";
import {
  clearOmniformBattleMovesets,
  ensureOmniformFormMovesets,
  isErOmniformMon,
  loadOmniformBattleMoveset,
  snapshotOmniformBattleMoveset,
} from "#data/elite-redux/omniform-movesets";
import { Gender } from "#data/gender";
import type { PokemonSpeciesForm } from "#data/pokemon-species";
import type { AbilityId } from "#enums/ability-id";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { PokemonMove } from "#moves/pokemon-move";
import { type ErTransformSequence, playErTransformMorph } from "#sprites/er-form-transform-fx";
import type { AbAttrBaseParams } from "#types/ability-types";
import type { FightUiHandler } from "#ui/handlers/fight-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_OMNIFORM_ABILITY_ID = 5929;

/** Number of moves auto-derived from the target form's learnset (DEFAULT). */
export const OMNIFORM_DERIVED_MOVE_COUNT = 3;

/**
 * Omniform is driven by the pre-move seam below; its PostSummon apply does the ONE
 * summon-time job: warm every form this holder could transform into, so the target
 * atlas is already cached by the time a move is selected (see
 * {@linkcode erOmniformPreloadTargets}).
 */
export class OmniformAbAttr extends PostSummonAbAttr {
  constructor() {
    super(false);
  }

  override apply(params: AbAttrBaseParams): void {
    if (params.simulated) {
      return;
    }
    erOmniformPreloadTargets(params.pokemon);
  }
}

/**
 * Preload, in the background at summon time, the battle sprite atlas of EVERY form
 * this Omniform holder could transform into this battle. On staging the transform
 * target's atlas downloads from the CDN DURING the transform sequence, so the target
 * silhouette mask was never ready in time and the morph degraded (glow, no shape
 * change) - and the sprite popped in visibly late. Warming all reachable target
 * atlases up front (the whole Omniform family - for the partner eeveelutions that is
 * the base plus the 8 evolutions) means that by the time any move is selected the
 * target texture is already cached: the mask builds instantly and the FULL
 * source->target morph plays with no stretch.
 *
 * Fire-and-forget: it never blocks the summon (nothing is awaited), and each target's
 * load is independently guarded so one failure can't stop the rest. The mid-battle
 * moveset can change through transform chains, so it warms the ENTIRE connected family
 * (not just the current form's direct targets / the current moveset's types). The
 * stretch/hold + degrade machinery in the FX stays as the fallback for a genuine
 * cache miss.
 */
export function erOmniformPreloadTargets(holder: Pokemon): void {
  try {
    if (!hasOmniform(holder)) {
      return;
    }
    const sf = holder.getSpeciesForm();
    const family = erOmniformConnectedForms(sf.speciesId, sf.formIndex);
    const female = holder.getGender() === Gender.FEMALE;
    const shiny = holder.isShiny();
    const variant = holder.getVariant();
    for (const target of family) {
      // Skip the current form: it is already loaded (the holder is wearing it).
      if (target.speciesId === sf.speciesId && target.formIndex === sf.formIndex) {
        continue;
      }
      try {
        // startLoad=true kicks the shared loader in the background; spriteOnly=true
        // skips the cry audio (the morph only needs the sprite atlas + its pixels).
        void Promise.resolve(
          resolveSpeciesForm(target).loadAssets(female, target.formIndex, shiny, variant, true, false, true),
        ).catch((err: unknown) => console.error("ER Omniform target preload failed", target.speciesId, err));
      } catch (err: unknown) {
        console.error("ER Omniform target preload threw", target.speciesId, err);
      }
    }
  } catch (err: unknown) {
    console.error("ER Omniform preload failed", err);
  }
}

/**
 * Hold the move flow until the transform sequence has visually landed, so the mon
 * becomes the new form BEFORE the move animation plays (the maintainer-reported
 * ordering fix). Only the full "morph" path is gated: the fail-closed burst-only
 * path resolves immediately, so it adds no wait (unchanged behaviour). Unshifted
 * AFTER the "adapted/reverted" message so the flow reads: message -> transform
 * completes -> "used <move>!" + move animation. The wait phase is hard-bounded and
 * fails open, so it can never softlock (see `ErOmniformTransformWaitPhase`).
 */
function erOmniformHoldForTransform(sequence: ErTransformSequence): void {
  if (sequence.mode !== "morph") {
    return;
  }
  globalScene.phaseManager.unshiftNew("ErOmniformTransformWaitPhase", sequence.whenSettled);
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
  const original = getOmniformOriginal(holder);
  if (!original) {
    return;
  }
  deleteOmniformOriginal(holder);
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
  const original = getOmniformOriginal(holder);
  if (!original) {
    return;
  }
  // Preserve the OUTGOING (current) form's live PP before swapping away from it.
  snapshotOmniformBattleMoveset(
    holder,
    { speciesId: holder.getSpeciesForm().speciesId, formIndex: holder.formIndex },
    holder.getMoveset(),
  );

  deleteOmniformOriginal(holder);
  // Capture the display name BEFORE the species swap, or the message reads
  // "Partner Eevee reverted to Partner Eevee".
  const preRevertName = getPokemonNameWithAffix(holder);
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
  // Full transform SEQUENCE (fill -> shape morph -> reveal + burst). The sprite +
  // info swap runs INSIDE `onSwap`, awaited under the glow, so the reveal drains
  // onto the already-swapped base-form sprite (the late-swap fix). The move flow is
  // then HELD (bounded, fail-open) until the sequence lands, so the revert plays out
  // BEFORE the move animation; the fail-closed burst-only path adds no wait.
  const revertSeq = playErTransformMorph(holder, holder.getSpeciesForm().type1, {
    onSwap: async () => {
      await holder.loadAssets(false);
      await holder.updateInfo();
    },
  });
  globalScene.phaseManager.queueMessage(`${preRevertName} reverted to ${original.species.getName()}!`);
  erOmniformHoldForTransform(revertSeq);
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

  const target = lookupOmniformTarget(user, moveType);
  if (!target) {
    return;
  }

  // SAME-FORM NO-OP: the mapped target IS the holder's current species+form (e.g.
  // Jolteon using an Electric move maps Jolteon -> Jolteon). It is already that
  // form, so there is nothing to adapt: no message, no FX, no moveset re-derive,
  // no wait phase, and no snapshot bookkeeping - the move just plays. Returning
  // here BEFORE `snapshotOmniformOriginal` / the per-form PP snapshot leaves all
  // chain-transform bookkeeping untouched.
  const currentForm = user.getSpeciesForm();
  if (target.speciesId === currentForm.speciesId && target.formIndex === currentForm.formIndex) {
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

  // Snapshot the pre-battle identity (once per battle) so revert is exact even
  // after a chain of transforms.
  snapshotOmniformOriginal(user);

  // Mega-style form change: swap the holder's species/form so `calculateStats`
  // (which reads `getSpeciesForm(true)` — ignoring summon-data overrides) picks
  // up the TARGET form's base stats, exactly like a mega changing `formIndex`.
  // The new species also drives typing / sprite / name. Reverts on leaveField.
  // Capture the display name BEFORE the swap for the "adapted into" message.
  const preTransformName = getPokemonNameWithAffix(user);
  user.species = targetSpecies;
  user.formIndex = target.formIndex;
  // Pin Omniform so it persists across the transform and can chain again.
  user.summonData.ability = ER_OMNIFORM_ABILITY_ID as AbilityId;
  // Drop any prior wholesale type override so the new form's typing applies.
  user.summonData.types = [];
  user.calculateStats();
  user.generateName();

  // Build the post-transform live moveset. Both paths keep the move currently being
  // used in its ORIGINAL slot (mid-cast, documented contract) and fill the OTHER slots
  // from the target form's moves. The only difference is the SOURCE of those moves:
  //   - per-evolution mon: the TARGET evolution's OWN stored moveset (PP preserved per
  //     form within the battle via the battle cache);
  //   - legacy / harness-forced mapping: a seeded derive from the target's learnset.
  const currentMoveset = user.getMoveset();
  const usedIndex = currentMoveset.findIndex(m => m?.moveId === move.id);
  const fillMoves: PokemonMove[] = perEvolution
    ? loadOmniformBattleMoveset(user, target)
    : deriveMoveset(speciesForm, user.level, move.id).map(id => new PokemonMove(id));
  let cursor = 0;
  const newMoveset = currentMoveset.map((slot, index) => {
    if (index === usedIndex) {
      return slot ?? new PokemonMove(move.id);
    }
    // Skip any copy of the used move so it is never duplicated across slots.
    while (cursor < fillMoves.length && fillMoves[cursor].moveId === move.id) {
      cursor++;
    }
    return cursor < fillMoves.length ? fillMoves[cursor++] : (slot ?? new PokemonMove(move.id));
  });
  // If the used move was not in the moveset (a cast/called move), still keep it by
  // prepending, capped at the max move count.
  if (usedIndex < 0) {
    newMoveset.unshift(new PokemonMove(move.id));
    newMoveset.length = Math.min(newMoveset.length, user.getMaxMoveCount());
  }
  user.summonData.moveset = newMoveset;

  // If the fight menu is currently on screen for this holder, its cached move list
  // is now stale (old names/types/PP/detail). Force a rebuild from the swapped
  // moveset. `refreshMoves` self-guards on the menu being active, so a normal
  // mid-move transform (menu already closed) leaves it a no-op.
  (globalScene.ui?.handlers?.[UiMode.FIGHT] as FightUiHandler | undefined)?.refreshMoves();

  // Partner-evolution transform SEQUENCE: fill (TARGET primary-type light) ->
  // SDF shape morph (source form -> target form) -> reveal + per-type burst. This
  // path IS the partner/Omniform predicate (only registered mappings reach here),
  // so OTHER form changes keep their existing presentation. The real sprite + info
  // swap runs INSIDE `onSwap`, awaited UNDER the glow so the reveal drains onto the
  // already-swapped target sprite (the late-swap fix). Purely visual + fail-closed
  // (never throws; degrades to the burst-only reveal).
  const seq = playErTransformMorph(user, speciesForm.type1, {
    onSwap: async () => {
      await user.loadAssets(false);
      await user.updateInfo();
    },
  });
  globalScene.phaseManager.queueMessage(
    `${preTransformName} adapted into ${getPokemonSpecies(target.speciesId).getName()}!`,
  );
  // HOLD the move flow (bounded, fail-open) until the sequence visually lands, so
  // the transform completes BEFORE the move animation plays as the new form. The
  // fail-closed burst-only path resolves immediately and adds no wait.
  erOmniformHoldForTransform(seq);
}
