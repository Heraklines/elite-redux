/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — HAND-AUTHORABLE mega/primal FORM injection seam (newcomer patch).
//
// {@linkcode ER_MEGA_FORMS} + `injectAllErMegaForms()` are DATA-DRIVEN from the
// vendor dump: every mega/primal there is a real ER species record whose stats /
// types / abilities are looked up by id. The newcomer-patch fakemon megas/primals
// have NO vendor record — they are hand-authored. This seam is the hand-authored
// analogue: a small table of {@linkcode NewcomerFormDef}s, each of which
// `injectNewcomerForms()` turns into a real pokerogue `PokemonForm` on an existing
// species with:
//   - its own stats + N-type typing (types 3..N via the N-type static model's
//     `setExtraTypes`, so effectiveness/STAB/battle-info fold them in),
//   - its own ACTIVE ability triple + INNATE (passive) triple,
//   - a #287 sprite/icon redirect to `elite-redux/<slug>/…` (placeholder art
//     until the assets phase lands — the redirect makes the key resolvable now),
//   - a registered form-change EDGE in `pokemonFormChanges` triggered by its
//     mega stone / primal orb, so the reward pool offers the stone (Mega-Bracelet
//     gated, #207/#318/#359) and holding it transforms the base mon.
//
// Runs AFTER `injectAllErMegaForms()` (so a species' base form is already seeded
// when possible) and is IDEMPOTENT (a formKey already present is skipped). Forms
// store numeric ability ids, so it does NOT require the referenced abilities to
// be constructed yet (they are resolved at battle time from `allAbilities`).
// =============================================================================

import { installErFormSpriteRedirect } from "#data/elite-redux/er-form-sprite-redirect";
import { PokemonForm } from "#data/pokemon-species";
import { pokemonFormChanges, SpeciesFormChange } from "#data/pokemon-forms";
import { SpeciesFormChangeItemTrigger } from "#data/pokemon-forms/form-change-triggers";
import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import type { LevelMoves } from "#types/pokemon-level-moves";
import { AbilityId } from "#enums/ability-id";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { ER_SPORE_BED_ABILITY_ID } from "#data/elite-redux/abilities/spore-bed";
import { ER_MYCELIAL_NETWORK_ABILITY_ID } from "#data/elite-redux/abilities/mycelial-network";
import { ER_LAST_HOST_ABILITY_ID } from "#data/elite-redux/abilities/last-host";
import { ER_CLEANSING_LIGHT_ABILITY_ID } from "#data/elite-redux/abilities/cleansing-light";
import { ER_QUICKENING_GRACE_ABILITY_ID } from "#data/elite-redux/abilities/quickening-grace";
import { ER_DECOMPOSER_ABILITY_ID, ER_PURE_GOOD_ABILITY_ID } from "#data/elite-redux/abilities/composite-newcomers";

/** ER-custom / newcomer ability ids are real `allAbilities` keys; narrow the type. */
const ab = (id: number): AbilityId => id as AbilityId;

/** On the Prowl — ER draft 648 -> pokerogue ability id (via ER_ID_MAP). */
const ON_THE_PROWL = 5352;

/**
 * A hand-authored newcomer mega/primal form. Injected onto {@linkcode baseSpecies}
 * as a real `PokemonForm` with the stats/typing/kit below.
 */
export interface NewcomerFormDef {
  /** Existing pokerogue species the form is attached to. */
  readonly baseSpecies: SpeciesId;
  /** pokerogue form key (`mega` / `mega-x` / `mega-y` / `primal`). Must be free on the base. */
  readonly formKey: string;
  /** Display name of the injected form. */
  readonly formName: string;
  /** ER art slug: the form redirects to `elite-redux/<slug>/{front,back,icon}`. */
  readonly slug: string;
  /** Full static typing (1..6 entries). type1 = [0], type2 = [1] ?? null, extras = [2..]. */
  readonly types: readonly [PokemonType, ...PokemonType[]];
  /** Base stats [hp, atk, def, spatk, spdef, spd]. */
  readonly stats: readonly [number, number, number, number, number, number];
  /** ACTIVE ability triple (ability1, ability2, abilityHidden). */
  readonly actives: readonly [AbilityId, AbilityId, AbilityId];
  /** INNATE (passive) triple. */
  readonly innates: readonly [AbilityId, AbilityId, AbilityId];
  /** Mega stone / primal orb that triggers the form (a FormChangeItem enum value). */
  readonly item: FormChangeItem;
  /**
   * Extra level-1 learnset moves to append to the BASE species (learnsets are
   * per-species, not per-form). Applied AFTER `initEliteReduxMovesets` (which
   * rebuilds the whole table from the ER dump and would otherwise clobber them).
   */
  readonly learnMoves?: readonly MoveId[];
}

/**
 * The newcomer form table. Kits/stats/typings are verbatim from
 * `docs/fakemon-newcomer-patch.md`.
 *
 * NOTE: only formKey-collision-FREE forms are wired here. Two doc megas collide
 * with an EXISTING ER mega on the same species+formKey and need a maintainer
 * decision (replace vs. new key) before wiring:
 *   - Mega Skarmory Y  (Skarmory already has an ER `mega-y` = ER 1889),
 *   - Mega Dragonite Z (Dragonite already has `mega` + `mega-y`; no `mega-z` key).
 * They are intentionally omitted here (documented in the patch report).
 */
export const ER_NEWCOMER_FORMS: readonly NewcomerFormDef[] = [
  // #4 Mega Xerneas — Fairy. Active Limber; innates Quickening Grace (5913),
  // Cleansing Light (5912), Pure Good (5935). Stone Xerneasite.
  {
    baseSpecies: SpeciesId.XERNEAS,
    formKey: "mega",
    formName: "Mega",
    slug: "mega_xerneas",
    types: [PokemonType.FAIRY],
    stats: [126, 151, 125, 151, 128, 99],
    actives: [AbilityId.LIMBER, AbilityId.LIMBER, AbilityId.LIMBER],
    innates: [
      ab(ER_QUICKENING_GRACE_ABILITY_ID),
      ab(ER_CLEANSING_LIGHT_ABILITY_ID),
      ab(ER_PURE_GOOD_ABILITY_ID),
    ],
    item: FormChangeItem.XERNEASITE,
  },
  // #10 Mega Parasect — Bug/Grass/Ghost (N-type). Active Spore Bed (5902) /
  // Shadow Tag / On the Prowl (5352); innates Decomposer (5945),
  // Mycelial Network (5905), Last Host (5906). Stone Parasectite. Also gains
  // Leaf Blade (learnset addition in pokemon-level-moves.ts).
  {
    baseSpecies: SpeciesId.PARASECT,
    formKey: "mega",
    formName: "Mega",
    slug: "mega_parasect",
    types: [PokemonType.BUG, PokemonType.GRASS, PokemonType.GHOST],
    stats: [80, 120, 145, 80, 170, 20],
    actives: [ab(ER_SPORE_BED_ABILITY_ID), AbilityId.SHADOW_TAG, ab(ON_THE_PROWL)],
    innates: [ab(ER_DECOMPOSER_ABILITY_ID), ab(ER_MYCELIAL_NETWORK_ABILITY_ID), ab(ER_LAST_HOST_ABILITY_ID)],
    item: FormChangeItem.PARASECTITE,
    learnMoves: [MoveId.LEAF_BLADE],
  },
];

/**
 * Append every wired form's `learnMoves` to its base species' level-up moveset
 * (as level-1 entries, deduped). Called from init AFTER `initEliteReduxMovesets`,
 * which rebuilds the level-move table from the ER dump and would clobber a
 * pre-applied addition. Idempotent.
 */
export function applyNewcomerLearnsetAdditions(): number {
  const table = pokemonSpeciesLevelMoves as Record<number, LevelMoves>;
  let added = 0;
  for (const def of ER_NEWCOMER_FORMS) {
    if (!def.learnMoves || def.learnMoves.length === 0) {
      continue;
    }
    const moves = (table[def.baseSpecies] ??= []);
    for (const moveId of def.learnMoves) {
      if (!moves.some(([, m]) => m === moveId)) {
        moves.push([1, moveId]);
        added++;
      }
    }
  }
  return added;
}

/** Outcome summary of a single {@linkcode injectNewcomerForms} run. */
export interface InjectNewcomerFormsResult {
  /** Forms newly injected this run. */
  injected: number;
  /** Forms skipped because their formKey already existed on the base (idempotent re-run). */
  skippedExisting: number;
  /** Form-change edges registered in pokemonFormChanges. */
  edgesRegistered: number;
  /** Non-fatal issues (unknown base species, etc.). */
  errors: string[];
}

/** Seed a "Normal" base form (formKey "") at index 0 so the mega lands at index >= 1. */
function seedBaseForm(species: ReturnType<typeof getPokemonSpecies>): void {
  const baseForm = new PokemonForm(
    "Normal",
    "",
    species.type1,
    species.type2,
    species.height,
    species.weight,
    species.ability1,
    species.ability2,
    species.abilityHidden,
    species.baseTotal,
    species.baseStats[0],
    species.baseStats[1],
    species.baseStats[2],
    species.baseStats[3],
    species.baseStats[4],
    species.baseStats[5],
    species.catchRate,
    species.baseFriendship,
    species.baseExp,
    false,
    null,
    true,
    false,
  );
  baseForm.setPassives(species.getPassiveAbilities());
  baseForm.setExtraTypes(species.getExtraTypes());
  const baseMut = baseForm as unknown as { speciesId: number; formIndex: number; generation: number };
  baseMut.speciesId = species.speciesId;
  baseMut.formIndex = 0;
  baseMut.generation = species.generation;
  (species.forms as unknown as PokemonForm[]).push(baseForm);
}

/** Register the mega stone / primal orb form-change edge so the reward pool offers it. */
function registerFormChangeEdge(def: NewcomerFormDef, result: InjectNewcomerFormsResult): void {
  if (!pokemonFormChanges[def.baseSpecies]) {
    pokemonFormChanges[def.baseSpecies] = [];
  }
  const list = pokemonFormChanges[def.baseSpecies] as SpeciesFormChange[];
  const alreadyHasEdge = list.some(fc => fc.preFormKey === "" && fc.formKey === def.formKey);
  if (alreadyHasEdge) {
    return;
  }
  list.push(new SpeciesFormChange(def.baseSpecies, "", def.formKey, new SpeciesFormChangeItemTrigger(def.item)));
  result.edgesRegistered++;
}

/**
 * Inject every {@linkcode ER_NEWCOMER_FORMS} entry as a real form on its base
 * species, with N-type typing, active + innate kits, sprite redirect, and a
 * stone/orb-triggered form-change edge. Idempotent.
 */
export function injectNewcomerForms(): InjectNewcomerFormsResult {
  const result: InjectNewcomerFormsResult = { injected: 0, skippedExisting: 0, edgesRegistered: 0, errors: [] };
  for (const def of ER_NEWCOMER_FORMS) {
    const species = getPokemonSpecies(def.baseSpecies);
    if (!species) {
      result.errors.push(`newcomer form ${def.formName}: base species ${def.baseSpecies} not found`);
      continue;
    }
    // Always register the stone edge (reachability/dex), even if the form was
    // already injected on a prior run.
    registerFormChangeEdge(def, result);
    if (species.forms.some(f => f.formKey === def.formKey)) {
      result.skippedExisting++;
      continue;
    }
    if (species.forms.length === 0) {
      seedBaseForm(species);
    }
    const type1 = def.types[0];
    const type2 = def.types.length > 1 ? def.types[1] : null;
    const [hp, atk, def_, spatk, spdef, spd] = def.stats;
    const form = new PokemonForm(
      def.formName,
      def.formKey,
      type1,
      type2,
      species.height,
      species.weight,
      def.actives[0],
      def.actives[1],
      def.actives[2],
      hp + atk + def_ + spatk + spdef + spd,
      hp,
      atk,
      def_,
      spatk,
      spdef,
      spd,
      species.catchRate,
      species.baseFriendship,
      species.baseExp,
      false, // genderDiffs
      null, // formSpriteKey — redirected to the ER slug below
      false, // isStarterSelectable — battle/evolution-only form
      false, // isUnobtainable
    );
    form.setPassives([def.innates[0], def.innates[1], def.innates[2]]);
    // N-type static model: fold types 3..N in (no-op for 1/2-type forms).
    if (def.types.length > 2) {
      form.setExtraTypes(def.types.slice(2));
    }
    const formMut = form as unknown as { speciesId: number; formIndex: number; generation: number };
    formMut.speciesId = species.speciesId;
    formMut.formIndex = species.forms.length;
    formMut.generation = species.generation;
    (species.forms as unknown as PokemonForm[]).push(form);

    // #287 sprite/icon redirect to the ER slug (placeholder until art lands).
    installErFormSpriteRedirect(form, def.slug);

    result.injected++;
  }
  return result;
}
