/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — battle FORM injection for ER-CUSTOM base species.
//
// pokerogue's runtime form-change system only swaps the `formIndex` on the
// SAME species — it cannot swap to a different species id. ER, however, models
// several in-battle alternate forms as SEPARATE dump species (the same pattern
// as SPECIES_UNOWN_REVELATION, handled by init-elite-redux-unown-school.ts):
//
//   - SPECIES_WISPYWASPY_HIVEMIND (ER id 2262 → pkrg 10638) is the Hivemind
//     form of SPECIES_WISPYWASPY (ER id 1093 → pkrg 10065). Locust Swarm
//     (ability 884, an innate on base Wispywaspy) is an HP-threshold form
//     change: "Changes into Hivemind form until 1/4 HP or less." Its AbAttr
//     (HpThresholdFormChangeAbAttr, wired in archetype-dispatcher case 884)
//     fires `triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger)`
//     and no-ops unless the "hivemind" FORM exists on base Wispywaspy AND the
//     `<base> -> hivemind` (transform) + `hivemind -> ""` (revert) edges exist.
//
//   - SPECIES_DARMANITAN_REDUX_BLUNDER (ER id 2635 → pkrg 10818) is the
//     "Blunder" Battle-Bond form of SPECIES_DARMANITAN_REDUX_BOND (ER id 2630
//     → pkrg 10813). Species 10813 carries Battle Bond as an innate (ER innate
//     id 210 = AbilityId.BATTLE_BOND, installed as a passive by
//     init-elite-redux-custom-species.ts). The generic Battle Bond wiring in
//     init-abilities.ts (getBattleBondTargetFormIndex / hasBattleBondFormChange)
//     reads `pokemonFormChanges` for a SpeciesFormChangeAbilityTrigger whose
//     `preFormKey` matches the holder's current form key, and on a KO
//     (PostVictoryFormChangeAbAttr) fires the change. So Bond → Blunder needs
//     the "blunder" FORM injected on 10813 plus a `"" -> blunder` edge with a
//     SpeciesFormChangeAbilityTrigger. The model chosen: the BASE form of 10813
//     IS the "Bond" state (it already has Battle Bond + the Bond stat line);
//     the KO promotes it to the injected "blunder" form (the heavier stat line
//     from SPECIES_DARMANITAN_REDUX_BLUNDER). There is no revert edge — Battle
//     Bond (like vanilla Greninja → Ash-Greninja) is a one-way KO transform.
//
// Both base species are ER customs (id ≥ 10000) constructed with `forms: []`
// (see init-elite-redux-custom-species.ts). pokerogue requires formIndex 0 to
// be the base form (formKey ""), so for each entry we first seed a "Normal"
// base form mirroring the base species (mirroring the private `seedNormalBaseForm`
// in init-elite-redux-species.ts used for ER-custom mega injection), then inject
// the alternate form at index 1, then register the form-change edges.
//
// This module is the ER-custom analogue of init-elite-redux-unown-school.ts
// (which injects onto the VANILLA Unown). It is purely DATA wiring — it does
// NOT touch ability behavior (the AbAttrs for 884 / Battle Bond are already
// correct in archetype-dispatcher.ts / init-abilities.ts).
// =============================================================================

import { installErFormSpriteRedirect } from "#data/elite-redux/er-form-sprite-redirect";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { getErSpriteSlug } from "#data/elite-redux/init-elite-redux-custom-species";
import { SpeciesFormChangeAbilityTrigger, SpeciesFormChangeManualTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges, SpeciesFormChange } from "#data/pokemon-forms";
import type { PokemonForm as PokemonFormType, PokemonSpecies } from "#data/pokemon-species";
import { PokemonForm } from "#data/pokemon-species";
import { PokemonType } from "#enums/pokemon-type";
import type { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/**
 * ER `typeT` id -> pokerogue `PokemonType`. Mirrors the (module-private) tables
 * in init-elite-redux-species.ts and init-elite-redux-unown-school.ts. ER
 * sentinels 18 (Mystery) / 19 (None) -> `null`.
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
  null, // 18 Mystery
  null, // 19 None
  PokemonType.STELLAR, // 20 Stellar (Terapagos) - keep in sync with init-elite-redux-species (#9)
];

function mapErType(erTypeId: number | null): PokemonType | null {
  if (erTypeId === null || erTypeId < 0 || erTypeId >= ER_TYPE_TO_POKEROGUE.length) {
    return null;
  }
  return ER_TYPE_TO_POKEROGUE[erTypeId];
}

/** How the injected form's `<base> -> form` (and optional revert) edges fire. */
type FormChangeTriggerKind = "manual" | "ability";

/** One ER-custom battle-form injection spec. */
interface ErCustomFormSpec {
  /** ER species id of the BASE mon the form is injected onto (e.g. Wispywaspy 1093). */
  readonly baseErId: number;
  /** ER species id of the SOURCE dump species the form's stats/types come from. */
  readonly sourceErId: number;
  /** Form key for the injected alternate form ("hivemind", "blunder", …). */
  readonly formKey: string;
  /** Display name for the injected form. */
  readonly formName: string;
  /**
   * Trigger kind for the form-change edges:
   *   - "manual"  → SpeciesFormChangeManualTrigger (HP-threshold archetypes call
   *     `triggerPokemonFormChange(.., SpeciesFormChangeManualTrigger)`); a revert
   *     edge (`form -> ""`) is also registered so the holder reverts above the
   *     threshold (Wishiwashi-style bidirectional School).
   *   - "ability" → SpeciesFormChangeAbilityTrigger (Battle Bond reads this via
   *     PostVictoryFormChangeAbAttr); ONE-WAY (no revert edge), like Greninja.
   */
  readonly trigger: FormChangeTriggerKind;
}

/**
 * The ER-custom battle forms wired by this module. See file header for the
 * model behind each entry.
 */
const ER_CUSTOM_FORM_SPECS: readonly ErCustomFormSpec[] = [
  {
    // Locust Swarm (884): base Wispywaspy ⇄ Hivemind, bidirectional at ≤1/4 HP.
    baseErId: 1093, // SPECIES_WISPYWASPY → pkrg 10065
    sourceErId: 2262, // SPECIES_WISPYWASPY_HIVEMIND → pkrg 10638
    formKey: "hivemind",
    formName: "Hivemind",
    trigger: "manual",
  },
  {
    // Battle Bond: Darmanitan Redux Bond → Blunder on a KO, one-way.
    baseErId: 2630, // SPECIES_DARMANITAN_REDUX_BOND → pkrg 10813
    sourceErId: 2635, // SPECIES_DARMANITAN_REDUX_BLUNDER → pkrg 10818
    formKey: "blunder",
    formName: "Blunder",
    trigger: "ability",
  },
  {
    // Disguise (Mimikyu Apex): Apex ⇄ Apex Busted on a blocked hit. Mimikyu's
    // Disguise innate (ER 209 → vanilla DISGUISE) is `FormBlockDamageAbAttr(0)`,
    // which only blocks if `canBreakForm` finds a SpeciesFormChangeAbilityTrigger
    // edge to break into (the guard that otherwise made these custom Mimikyu
    // forms invincible - see ab-attrs FormBlockDamageAbAttr.canBreakForm). Base
    // Mimikyu has that edge; the Apex/Rayquaza tiers (separate ER species, not
    // forms) did NOT, so their Disguise silently did nothing. Inject the busted
    // counterpart as form index 1 + the ability edge - identical stats/abilities,
    // so the swap is purely the broken-disguise sprite. One-way like Battle Bond;
    // vanilla DISGUISE's PostBattleInitFormChangeAbAttr(()=>0) re-disguises each
    // battle, so no revert edge is needed.
    baseErId: 2638, // SPECIES_MIMIKYU_APEX → pkrg 10821
    sourceErId: 2639, // SPECIES_MIMIKYU_APEX_BUSTED → pkrg 10822
    formKey: "busted",
    formName: "Busted",
    trigger: "ability",
  },
  {
    // Disguise (Mimikyu Rayquaza, the stoneless-mega tier): Rayquaza ⇄ Primal on
    // a blocked hit. Same model as the Apex tier above; the mega tier's Disguise
    // is ER 693 (Disguise + curse the attacker), which also routes through
    // FormBlockDamageAbAttr's break path. Rayquaza's busted counterpart is Primal.
    baseErId: 2584, // SPECIES_MIMIKYU_RAYQUAZA → pkrg 10767
    sourceErId: 1855, // SPECIES_MIMIKYU_PRIMAL (Rayquaza Busted) → pkrg 10447
    formKey: "busted",
    formName: "Busted",
    trigger: "ability",
  },
];

/** Per-spec outcome detail (surfaced for diagnostics / tests). */
export interface ErCustomFormChangeDetail {
  readonly baseSpeciesId: number;
  readonly formKey: string;
  /** Whether the base form (index 0) was seeded this run. */
  baseFormSeeded: boolean;
  /** Whether the alternate form was injected this run (false on idempotent re-run). */
  formInjected: boolean;
  /** Number of form-change edges registered this run. */
  formChangesRegistered: number;
}

/** Aggregated result of {@linkcode initEliteReduxErCustomFormChanges}. */
export interface InitEliteReduxErCustomFormChangesResult {
  /** Number of alternate forms injected this run. */
  formsInjected: number;
  /** Total form-change edges registered this run. */
  formChangesRegistered: number;
  /** Per-spec detail. */
  details: ErCustomFormChangeDetail[];
  /** Non-fatal issues (missing species data, unmapped types, …). */
  errors: string[];
}

/**
 * Inject ER-custom battle forms + their form-change edges. Idempotent: a re-run
 * reuses an already-seeded base form / already-injected alternate form and
 * skips already-registered edges.
 *
 * Order constraint: must run AFTER `initEliteReduxCustomSpecies()` (the base
 * species exist in `allSpecies`) and AFTER `injectAllErMegaForms()` (so a base
 * form seeded for a mega is reused rather than double-seeded). It only DEPENDS
 * on the form/species DATA, not on the abilities being built, so its ordering
 * relative to ability init is unconstrained.
 */
export function initEliteReduxErCustomFormChanges(): InitEliteReduxErCustomFormChangesResult {
  const result: InitEliteReduxErCustomFormChangesResult = {
    formsInjected: 0,
    formChangesRegistered: 0,
    details: [],
    errors: [],
  };

  for (const spec of ER_CUSTOM_FORM_SPECS) {
    const basePkrgId = ER_ID_MAP.species[spec.baseErId];
    if (basePkrgId === undefined) {
      result.errors.push(`ER base id ${spec.baseErId} (${spec.formKey}) has no pokerogue mapping`);
      continue;
    }
    const base = getPokemonSpecies(basePkrgId as SpeciesId);
    if (!base) {
      result.errors.push(`base species ${basePkrgId} (${spec.formKey}) not found in allSpecies`);
      continue;
    }

    const detail: ErCustomFormChangeDetail = {
      baseSpeciesId: basePkrgId,
      formKey: spec.formKey,
      baseFormSeeded: false,
      formInjected: false,
      formChangesRegistered: 0,
    };

    // 1) Ensure formIndex 0 is the base form (formKey "").
    if (base.forms.length === 0) {
      seedBaseForm(base);
      detail.baseFormSeeded = true;
    }

    // 2) Inject the alternate form (if not already present).
    const injection = injectAlternateForm(base, spec, result);
    if (injection.formIndex < 0) {
      result.details.push(detail);
      continue; // injection failed (and logged) — nothing to wire
    }
    detail.formInjected = injection.injected;

    // 3) Register the form-change edges.
    detail.formChangesRegistered = registerEdges(basePkrgId, spec, result);

    result.details.push(detail);
  }

  return result;
}

/**
 * Seed a "Normal" base form (formKey "") at index 0 onto an ER-custom species
 * whose forms array is empty. Mirrors the (module-private) `seedNormalBaseForm`
 * in init-elite-redux-species.ts so the two stay consistent.
 */
function seedBaseForm(species: PokemonSpecies): void {
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
    false, // genderDiffs
    null, // formSpriteKey
    true, // isStarterSelectable (base form)
    false, // isUnobtainable
  );
  baseForm.setPassives(species.getPassiveAbilities());
  const baseMut = baseForm as unknown as { speciesId: number; formIndex: number; generation: number };
  baseMut.speciesId = species.speciesId;
  baseMut.formIndex = 0;
  baseMut.generation = species.generation;
  (species.forms as PokemonFormType[]).push(baseForm);

  // Seeding a base form makes `getSpeciesForm(0)` return THIS plain PokemonForm
  // instead of the ErCustomSpecies (which carries the slug-based sprite/icon
  // overrides). Redirect the base form back to the base species' ER slug so it
  // doesn't 404 on the vanilla `{speciesId}` scheme.
  const baseSlug = getErSpriteSlug(species.speciesId);
  if (baseSlug) {
    installErFormSpriteRedirect(baseForm, baseSlug);
  }
}

/**
 * Inject the alternate form (Hivemind / Blunder) onto the base species,
 * populated from the source ER draft's stats/types. Returns the form index of
 * the (existing or newly-injected) form (-1 on failure) and whether THIS call
 * injected a new form (false on idempotent re-run).
 */
function injectAlternateForm(
  base: PokemonSpecies,
  spec: ErCustomFormSpec,
  result: InitEliteReduxErCustomFormChangesResult,
): { formIndex: number; injected: boolean } {
  const existing = base.forms.findIndex(f => f.formKey === spec.formKey);
  if (existing >= 0) {
    return { formIndex: existing, injected: false };
  }

  const draft = ER_SPECIES.find(s => s.id === spec.sourceErId);
  if (!draft) {
    result.errors.push(`ER source draft id ${spec.sourceErId} (${spec.formKey}) not found in ER_SPECIES`);
    return { formIndex: -1, injected: false };
  }

  const type1 = mapErType(draft.types[0]);
  if (type1 === null) {
    result.errors.push(`${spec.formKey} primary type ${draft.types[0]} unmapped`);
    return { formIndex: -1, injected: false };
  }
  const type2 = mapErType(draft.types[1]);
  const [hp, atk, def, spatk, spdef, spd] = draft.baseStats;
  const baseTotal = hp + atk + def + spatk + spdef + spd;

  // The alternate form keeps the base mon's ability slots so an already-summoned
  // holder keeps a valid abilityIndex across the swap (matching the Revelation
  // precedent). Stats / types come from the ER source draft.
  const form = new PokemonForm(
    spec.formName,
    spec.formKey,
    type1,
    type2,
    base.height,
    base.weight,
    base.ability1,
    base.ability2,
    base.abilityHidden,
    baseTotal,
    hp,
    atk,
    def,
    spatk,
    spdef,
    spd,
    base.catchRate,
    base.baseFriendship,
    base.baseExp,
    false, // genderDiffs
    null, // formSpriteKey — derived from formKey
    false, // isStarterSelectable
    true, // isUnobtainable — battle-only form, only reachable via the ability
  );
  // Carry the base mon's passive (innate) triple onto the form so the ER
  // 3-passive system keeps firing (e.g. Locust Swarm stays active in Hivemind).
  form.setPassives(base.getPassiveAbilities());

  const formMut = form as unknown as { speciesId: number; formIndex: number; generation: number };
  formMut.speciesId = base.speciesId;
  formMut.formIndex = base.forms.length;
  formMut.generation = base.generation;

  (base.forms as PokemonFormType[]).push(form);

  // Redirect the injected form's sprite/icon to the SOURCE ER-custom species'
  // art (e.g. "wispywaspy_hivemind", "darmanitan_redux_blunder"). The form
  // lives on the base custom species, so without this it resolves to the
  // base's `{speciesId}-{formKey}` scheme (e.g. `10065-hivemind`) and 404s.
  const sourcePkrgId = ER_ID_MAP.species[spec.sourceErId];
  const sourceSlug = sourcePkrgId === undefined ? undefined : getErSpriteSlug(sourcePkrgId);
  if (sourceSlug) {
    installErFormSpriteRedirect(form, sourceSlug);
  }

  result.formsInjected++;
  return { formIndex: formMut.formIndex, injected: true };
}

/**
 * Register the `<base> -> form` (transform) edge — plus, for "manual" specs, a
 * `form -> ""` (revert) edge — on the base species in `pokemonFormChanges`.
 * Idempotent. Returns the number of edges registered this run.
 */
function registerEdges(
  baseSpeciesId: number,
  spec: ErCustomFormSpec,
  result: InitEliteReduxErCustomFormChangesResult,
): number {
  if (!pokemonFormChanges[baseSpeciesId]) {
    (pokemonFormChanges as Record<number, SpeciesFormChange[]>)[baseSpeciesId] = [];
  }
  const changes = pokemonFormChanges[baseSpeciesId] as SpeciesFormChange[];
  const makeTrigger = () =>
    spec.trigger === "ability" ? new SpeciesFormChangeAbilityTrigger() : new SpeciesFormChangeManualTrigger();

  let registered = 0;

  // Transform edge: base ("") -> form.
  const hasTransform = changes.some(c => c.preFormKey === "" && c.formKey === spec.formKey);
  if (!hasTransform) {
    changes.push(new SpeciesFormChange(baseSpeciesId as SpeciesId, "", spec.formKey, makeTrigger(), true));
    registered++;
  }

  // Revert edge (manual / HP-threshold forms only — Battle Bond is one-way).
  if (spec.trigger === "manual") {
    const hasRevert = changes.some(c => c.preFormKey === spec.formKey && c.formKey === "");
    if (!hasRevert) {
      changes.push(new SpeciesFormChange(baseSpeciesId as SpeciesId, spec.formKey, "", makeTrigger(), true));
      registered++;
    }
  }

  result.formChangesRegistered += registered;
  return registered;
}
