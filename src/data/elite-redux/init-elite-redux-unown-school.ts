/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Unown "School" (Revelation) form change.
//
// ER gives Unown a Wishiwashi-style School mechanic via the "Revelation"
// ability (ER ability id 885 -> ErAbilityId.REVELATION = pokerogue id 5586):
//
//   "Changes into Revelation form until 1/4 HP or less."
//
// Mechanically identical to Wishiwashi's Schooling, EXCEPT there is no level
// gate: while the holder is above 25% HP it Schools (end of turn / on summon /
// on battle init) into its buffed Revelation form; at 25% HP or below it
// reverts to its base (letter) form. This mirrors the vanilla SCHOOLING wiring
// in `init-abilities.ts` (PostBattleInit + PostSummon + PostTurn form-change
// attrs driven by an HP predicate).
//
// Why this module exists
// ----------------------
// Three things were broken / missing for Unown's School:
//
//   1. Base Unown (SpeciesId.UNOWN = 201) had NO "revelation" form. Its 28
//      forms are the alphabet letters (A..Z, !, ?). ER models Revelation as a
//      separate dump species (SPECIES_UNOWN_REVELATION = pokerogue 10456), but
//      pokerogue's runtime form-change system only swaps the `formIndex` on the
//      SAME species — it cannot swap to a different species id. So the school
//      target must exist as a FORM on Unown. We inject one here (mirroring how
//      megas are injected as forms on their base species).
//
//   2. `pokemonFormChanges[UNOWN]` had NO entries, so even a correctly-wired
//      ability had nothing to trigger. We register Wishiwashi-style ability
//      -trigger form changes here: `<each letter> -> "revelation"` (School up)
//      and `"revelation" -> ""` (revert).
//
//   3. The Revelation ability's attached AbAttr (from the archetype dispatcher)
//      was an `HpThresholdFormChangeAbAttr` — a PostDefend attr that (a) cannot
//      fire at end of turn, (b) transformed in the WRONG direction (only when
//      HP dropped below the threshold, never the reverse), (c) never reverted,
//      and (d) targeted a "revelation" form that didn't exist. We replace it on
//      the already-built ability instance with the SCHOOLING-style trio of
//      form-change attrs. (Mutating an init-built ability's `attrs` list is the
//      same pattern `refreshEliteReduxComposites` uses.)
//
// Note on the revert: pokerogue's `Pokemon.changeForm` resolves the target
// `formKey` to a form index via `findIndex(formKey)`, falling back to index 0.
// Reverting therefore returns Unown to its base form (letter "A" / index 0),
// matching how Wishiwashi reverts to its single solo form. The exact pre-school
// letter is not preserved (it is purely cosmetic once Schooled).
// =============================================================================

import type { AbAttr } from "#abilities/ab-attrs";
import {
  PostBattleInitFormChangeAbAttr,
  PostFaintFormChangeAbAttr,
  PostSummonFormChangeAbAttr,
  PostTurnFormChangeAbAttr,
} from "#abilities/ab-attrs";
import { allAbilities } from "#data/data-lists";
import { HpThresholdFormChangeAbAttr } from "#data/elite-redux/archetypes/hp-threshold-form-change";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { SpeciesFormChangeAbilityTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges, SpeciesFormChange } from "#data/pokemon-forms";
import type { PokemonForm, PokemonSpecies } from "#data/pokemon-species";
import { PokemonForm as PokemonFormCtor } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** Form key for the injected Revelation (School) form on base Unown. */
const REVELATION_FORM_KEY = "revelation";
/** ER species-const for the Revelation form's stat/type/ability source data. */
const REVELATION_SPECIES_CONST = "SPECIES_UNOWN_REVELATION";
/** HP fraction at/below which Unown reverts out of Revelation form. */
const REVERT_HP_RATIO = 0.25;
/**
 * ER-custom sprite slug for the Revelation form's art (lives at
 * `images/pokemon/elite-redux/unown_revelation/…`). The injected form sits on
 * VANILLA Unown (species 201), whose sprite scheme would otherwise resolve to a
 * non-existent `201-revelation` — so we redirect the revelation form's sprite /
 * icon to this ER-custom slug (mirroring ErCustomSpecies' path scheme).
 */
const REVELATION_SPRITE_SLUG = "unown_revelation";
/**
 * The Revelation form's own ER abilities (main pool) — distinct from base
 * Unown's. ER ids → mapped to pokerogue AbilityIds at injection time.
 * (107 Anticipation / 592 Minion Control / 156 Magic Bounce, per the ER dump.)
 */
const REVELATION_ABILITY_ER_IDS = [107, 592, 156] as const;
/**
 * The Revelation form's own INNATES (3-passive triple), distinct from base
 * Unown's — set per-form so the abilities screen shows them while base letters
 * keep their own. (885 Revelation / 147 Wonder Skin / 776 Unown Power, per the
 * ER dump. 885 = the schooling ability itself, so the school/revert/faint logic
 * keeps firing on the schooled form.)
 */
const REVELATION_INNATE_ER_IDS = [885, 147, 776] as const;

function mapErAbilityId(erId: number): AbilityId {
  return (ER_ID_MAP.abilities[erId] ?? AbilityId.NONE) as AbilityId;
}

/**
 * ER `typeT` id -> pokerogue `PokemonType`. Mirrors the table in
 * `init-elite-redux-species.ts` (whose copy is module-private). Sentinels 18
 * (Mystery) / 19 (None) -> `null`.
 */
const ER_TYPE_TO_POKEROGUE: readonly (PokemonType | null)[] = [
  PokemonType.NORMAL,
  PokemonType.FIGHTING,
  PokemonType.FIRE,
  PokemonType.ICE,
  PokemonType.ELECTRIC,
  PokemonType.BUG,
  PokemonType.FLYING,
  PokemonType.STEEL,
  PokemonType.GRASS,
  PokemonType.GROUND,
  PokemonType.POISON,
  PokemonType.DARK,
  PokemonType.WATER,
  PokemonType.PSYCHIC,
  PokemonType.ROCK,
  PokemonType.DRAGON,
  PokemonType.GHOST,
  PokemonType.FAIRY,
  null,
  null,
];

function mapErType(erTypeId: number | null): PokemonType | null {
  if (erTypeId === null || erTypeId < 0 || erTypeId >= ER_TYPE_TO_POKEROGUE.length) {
    return null;
  }
  return ER_TYPE_TO_POKEROGUE[erTypeId];
}

/** Per-call summary of {@linkcode initEliteReduxUnownSchool}. */
export interface InitEliteReduxUnownSchoolResult {
  /** Whether the "revelation" form was injected this run (false on idempotent re-run). */
  formInjected: boolean;
  /** Number of `<letter> -> "revelation"` + `"revelation" -> ""` form changes registered this run. */
  formChangesRegistered: number;
  /** Whether the Revelation ability's attrs were rewired this run. */
  abilityRewired: boolean;
  /** Non-fatal issues (missing species data, missing ability, etc.). */
  errors: string[];
}

/**
 * Wire Unown's School (Revelation) mechanic. Idempotent: a re-run skips the
 * form injection / form-change registration / ability rewire if already done.
 *
 * Order constraint: must run AFTER `initEliteReduxSpecies()` (base Unown's 28
 * letter forms exist) and AFTER `initEliteReduxCustomAbilities()` (the
 * Revelation ability instance exists in `allAbilities[5586]` with its
 * dispatcher-attached attrs that this function corrects).
 */
export function initEliteReduxUnownSchool(): InitEliteReduxUnownSchoolResult {
  const result: InitEliteReduxUnownSchoolResult = {
    formInjected: false,
    formChangesRegistered: 0,
    abilityRewired: false,
    errors: [],
  };

  const unown = getPokemonSpecies(SpeciesId.UNOWN);
  if (!unown) {
    result.errors.push("base Unown species not found in allSpecies");
    return result;
  }

  const revelationIndex = injectRevelationForm(unown, result);
  if (revelationIndex < 0) {
    // Injection failed (and logged) — without the form there is nothing to wire.
    return result;
  }

  registerFormChanges(unown, result);
  rewireRevelationAbility(revelationIndex, result);

  return result;
}

/**
 * Inject the "revelation" form onto base Unown, populated from the
 * SPECIES_UNOWN_REVELATION ER draft. Returns the form index of the
 * (existing or newly-injected) revelation form, or -1 on failure.
 */
function injectRevelationForm(unown: PokemonSpecies, result: InitEliteReduxUnownSchoolResult): number {
  const existing = unown.forms.findIndex(f => f.formKey === REVELATION_FORM_KEY);
  if (existing >= 0) {
    return existing;
  }

  const draft = ER_SPECIES.find(s => s.speciesConst === REVELATION_SPECIES_CONST);
  if (!draft) {
    result.errors.push(`ER draft ${REVELATION_SPECIES_CONST} not found`);
    return -1;
  }

  const type1 = mapErType(draft.types[0]);
  if (type1 === null) {
    result.errors.push(`Revelation primary type ${draft.types[0]} unmapped`);
    return -1;
  }
  const type2 = mapErType(draft.types[1]);
  const [hp, atk, def, spatk, spdef, spd] = draft.baseStats;
  const baseTotal = hp + atk + def + spatk + spdef + spd;

  // Stats / types / abilities all come from the ER Revelation draft so the
  // schooled form shows its OWN ability pool (Anticipation / Minion Control /
  // Magic Bounce), not base Unown's. All three map to real abilities, so any
  // carried-over abilityIndex (0/1/2) stays valid across the swap.
  const ability1 = mapErAbilityId(REVELATION_ABILITY_ER_IDS[0]);
  const ability2 = mapErAbilityId(REVELATION_ABILITY_ER_IDS[1]);
  const abilityHidden = mapErAbilityId(REVELATION_ABILITY_ER_IDS[2]);
  const form = new PokemonFormCtor(
    "Revelation",
    REVELATION_FORM_KEY,
    type1,
    type2,
    unown.height,
    unown.weight,
    ability1,
    ability2,
    abilityHidden,
    baseTotal,
    hp,
    atk,
    def,
    spatk,
    spdef,
    spd,
    unown.catchRate,
    unown.baseFriendship,
    unown.baseExp,
    false, // genderDiffs
    null, // formSpriteKey — derived from formKey
    false, // isStarterSelectable
    true, // isUnobtainable — School form, only reachable via the ability
  );

  // PokemonForm-private fields (speciesId, formIndex, generation) are normally
  // assigned by the PokemonSpecies constructor's forms loop. We push after
  // construction, so set them here (mirrors the mega-form injection path).
  const formMut = form as unknown as { speciesId: number; formIndex: number; generation: number };
  formMut.speciesId = unown.speciesId;
  formMut.formIndex = unown.forms.length;
  formMut.generation = unown.generation;

  // Per-form innates: getPassiveAbilities(formIndex) returns the FORM's own
  // _passives when set (see pokemon-species.ts), so the schooled form shows its
  // own innate triple — base Unown letters keep theirs.
  form.setPassives([
    mapErAbilityId(REVELATION_INNATE_ER_IDS[0]),
    mapErAbilityId(REVELATION_INNATE_ER_IDS[1]),
    mapErAbilityId(REVELATION_INNATE_ER_IDS[2]),
  ]);

  (unown.forms as PokemonForm[]).push(form);
  installRevelationSpriteRedirect(unown, formMut.formIndex);
  result.formInjected = true;
  return formMut.formIndex;
}

/**
 * Redirect the Revelation form's sprite + icon to the ER-custom `unown_revelation`
 * art (the form lives on vanilla Unown, whose scheme would resolve to a
 * non-existent `201-revelation`). Mirrors ErCustomSpecies' path scheme, but
 * STRICTLY gated to `formIndex === revelationIndex` — base Unown letter forms are
 * never touched, so this cannot regress them. Idempotent.
 */
function installRevelationSpriteRedirect(unown: PokemonSpecies, revelationIndex: number): void {
  const sp = unown as unknown as {
    getSpriteAtlasPath(female: boolean, formIndex?: number, shiny?: boolean, variant?: number, back?: boolean): string;
    getSpriteId(female: boolean, formIndex?: number, shiny?: boolean, variant?: number, back?: boolean): string;
    getIconAtlasKey(formIndex?: number, shiny?: boolean, variant?: number): string;
    getIconId(female: boolean, formIndex?: number, shiny?: boolean, variant?: number): string;
    __erRevelationSpriteRedirect?: boolean;
  };
  if (sp.__erRevelationSpriteRedirect) {
    return;
  }
  sp.__erRevelationSpriteRedirect = true;

  const slug = REVELATION_SPRITE_SLUG;
  const origAtlasPath = sp.getSpriteAtlasPath.bind(sp);
  const origSpriteId = sp.getSpriteId.bind(sp);
  const origIconAtlasKey = sp.getIconAtlasKey.bind(sp);
  const origIconId = sp.getIconId.bind(sp);

  sp.getSpriteAtlasPath = (female, formIndex, shiny, variant, back) => {
    if (formIndex !== revelationIndex) {
      return origAtlasPath(female, formIndex, shiny, variant, back);
    }
    let filename: string;
    if (shiny) {
      const tier = variant ?? 0;
      const suffix = tier === 0 ? "" : `-${tier + 1}`;
      filename = back ? `shiny-back${suffix}` : `shiny${suffix}`;
    } else {
      filename = back ? "back" : "front";
    }
    return `elite-redux/${slug}/${filename}`;
  };
  sp.getSpriteId = (female, formIndex, shiny, variant, back) => {
    if (formIndex !== revelationIndex) {
      return origSpriteId(female, formIndex, shiny, variant, back);
    }
    const suffix = shiny ? (variant ? `_shiny${variant + 1}` : "_shiny") : "";
    const backPrefix = back ? "back__" : "";
    return `${backPrefix}er__${slug}${suffix}`;
  };
  sp.getIconAtlasKey = (formIndex, shiny, variant) => {
    if (formIndex !== revelationIndex) {
      return origIconAtlasKey(formIndex, shiny, variant);
    }
    return `er_icon__${slug}`;
  };
  sp.getIconId = (female, formIndex, shiny, variant) => {
    if (formIndex !== revelationIndex) {
      return origIconId(female, formIndex, shiny, variant);
    }
    return "0001.png";
  };
}

/**
 * Register the Wishiwashi-style ability-trigger form changes on base Unown:
 * one `<letter> -> "revelation"` per non-revelation form (School up), plus a
 * single `"revelation" -> ""` (revert). All quiet, all keyed on
 * {@linkcode SpeciesFormChangeAbilityTrigger} — identical in shape to the
 * vanilla Wishiwashi entries in `pokemon-forms.ts`.
 */
function registerFormChanges(unown: PokemonSpecies, result: InitEliteReduxUnownSchoolResult): void {
  if (!pokemonFormChanges[SpeciesId.UNOWN]) {
    (pokemonFormChanges as Record<number, SpeciesFormChange[]>)[SpeciesId.UNOWN] = [];
  }
  const changes = pokemonFormChanges[SpeciesId.UNOWN] as SpeciesFormChange[];

  // School up: from every base (letter) form into "revelation".
  for (const f of unown.forms) {
    if (f.formKey === REVELATION_FORM_KEY) {
      continue;
    }
    const already = changes.some(c => c.preFormKey === f.formKey && c.formKey === REVELATION_FORM_KEY);
    if (already) {
      continue;
    }
    changes.push(
      new SpeciesFormChange(
        SpeciesId.UNOWN,
        f.formKey,
        REVELATION_FORM_KEY,
        new SpeciesFormChangeAbilityTrigger(),
        true,
      ),
    );
    result.formChangesRegistered++;
  }

  // Revert: from "revelation" back to the base form (resolves to index 0).
  const hasRevert = changes.some(c => c.preFormKey === REVELATION_FORM_KEY && c.formKey === "");
  if (!hasRevert) {
    changes.push(
      new SpeciesFormChange(SpeciesId.UNOWN, REVELATION_FORM_KEY, "", new SpeciesFormChangeAbilityTrigger(), true),
    );
    result.formChangesRegistered++;
  }
}

/**
 * Replace the Revelation ability's broken HP-threshold form-change attr with
 * the SCHOOLING-style trio (PostBattleInit + PostSummon + PostTurn). The
 * `formFunc` returns the revelation form index while above the revert
 * threshold, and a base (non-revelation) index at/below it — letting
 * `triggerPokemonFormChange` pick the matching School-up / revert edge.
 */
function rewireRevelationAbility(revelationIndex: number, result: InitEliteReduxUnownSchoolResult): void {
  const ability = allAbilities[ErAbilityId.REVELATION];
  if (!ability) {
    result.errors.push(`Revelation ability (${ErAbilityId.REVELATION}) not found in allAbilities`);
    return;
  }

  const attrs = (ability as unknown as { attrs: AbAttr[] }).attrs;

  // Above the revert threshold -> School into Revelation; at/below -> base form.
  // When already in the correct state the index equals the current formIndex,
  // so the form-change attrs no-op (their canApply requires target != current).
  const formFunc = (p: Pokemon): number => {
    if (p.getHpRatio() > REVERT_HP_RATIO) {
      return revelationIndex;
    }
    // Reverting: any non-revelation index triggers the "revelation" -> "" edge.
    // 0 is the base form; if somehow already on a base letter this equals the
    // current index and no change fires.
    return p.formIndex === revelationIndex ? 0 : p.formIndex;
  };

  // Idempotency: only rewire if a SCHOOLING-style attr isn't already present.
  const alreadyWired = attrs.some(a => a instanceof PostTurnFormChangeAbAttr);
  if (alreadyWired) {
    return;
  }

  // Drop the broken HP-threshold form-change attr(s) from the dispatcher.
  for (let i = attrs.length - 1; i >= 0; i--) {
    if (attrs[i] instanceof HpThresholdFormChangeAbAttr) {
      attrs.splice(i, 1);
    }
  }

  attrs.push(new PostBattleInitFormChangeAbAttr(formFunc));
  attrs.push(new PostSummonFormChangeAbAttr(formFunc));
  attrs.push(new PostTurnFormChangeAbAttr(formFunc));
  // Revert out of Revelation on faint so a fainted Unown does not persist in the
  // School form (its stored/party form returns to a normal letter). On faint the
  // HP ratio is 0, so `formFunc` takes its revert branch automatically.
  attrs.push(new PostFaintFormChangeAbAttr(formFunc));
  result.abilityRewired = true;
}
