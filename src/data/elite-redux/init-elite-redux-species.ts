// =============================================================================
// Elite Redux — Phase B Task B1a: install ER 3-passive triples on vanilla species.
//
// Reads the auto-generated ER drafts (`er-species.ts`) and, for each entry whose
// pokerogue species id is < VANILLA_ID_CUTOFF (i.e., maps to an existing
// vanilla `SpeciesId`), calls `setPassives()` on the corresponding
// `PokemonSpecies` instance with the ER ability ids mapped through
// `ER_ID_MAP.abilities`.
//
// This unlocks the 3-passive UI (A16's `getPassiveCount() > 1` gate) for the
// ~1025 vanilla pokerogue species that ER provides innates for. ER-custom
// species (pokerogue id ≥ VANILLA_ID_CUTOFF) are skipped here — B1b adds them
// as fresh `PokemonSpecies` instances.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { PokemonForm } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { PokemonType } from "#enums/pokemon-type";

/**
 * ER's `typeT` ordering differs from pokerogue's `PokemonType` enum. This map
 * resolves an ER type id (0..19) to the matching pokerogue `PokemonType`.
 *
 * ER order: Normal, Fighting, Fire, Ice, Electric, Bug, Flying, Steel, Grass,
 *           Ground, Poison, Dark, Water, Psychic, Rock, Dragon, Ghost, Fairy,
 *           Mystery, None.
 * Pokerogue order: Normal, Fighting, Flying, Poison, Ground, Rock, Bug, Ghost,
 *                  Steel, Fire, Water, Grass, Electric, Psychic, Ice, Dragon,
 *                  Dark, Fairy.
 *
 * Sentinel 18 (Mystery) and 19 (None) map to `null` to signal "no type" —
 * callers should treat that as the absence of a secondary type, NOT
 * `PokemonType.UNKNOWN` (which is gameplay-typeless rather than data-absent).
 */
const ER_TYPE_TO_POKEROGUE: readonly (PokemonType | null)[] = [
  PokemonType.NORMAL, // 0
  PokemonType.FIGHTING, // 1
  PokemonType.FIRE, // 2
  PokemonType.ICE, // 3
  PokemonType.ELECTRIC, // 4
  PokemonType.BUG, // 5
  PokemonType.FLYING, // 6
  PokemonType.STEEL, // 7
  PokemonType.GRASS, // 8
  PokemonType.GROUND, // 9
  PokemonType.POISON, // 10
  PokemonType.DARK, // 11
  PokemonType.WATER, // 12
  PokemonType.PSYCHIC, // 13
  PokemonType.ROCK, // 14
  PokemonType.DRAGON, // 15
  PokemonType.GHOST, // 16
  PokemonType.FAIRY, // 17
  null, // 18 Mystery
  null, // 19 None
];

function mapErType(erTypeId: number | null): PokemonType | null {
  if (erTypeId === null || erTypeId < 0 || erTypeId >= ER_TYPE_TO_POKEROGUE.length) {
    return null;
  }
  return ER_TYPE_TO_POKEROGUE[erTypeId];
}

/**
 * Numeric cutoff for "vanilla pokerogue" species ids. ER-custom species are
 * assigned fresh ids ≥ 10000 by the id-map builder (see `er-id-map.ts`).
 */
const VANILLA_ID_CUTOFF = 10000;

/** Aggregated result of a single `initEliteReduxSpecies()` run. */
export interface InitEliteReduxSpeciesResult {
  /** Number of vanilla species that received a 3-passive triple. */
  vanillaCount: number;
  /** Number of ER-custom species skipped (B1b's job). */
  customSkipped: number;
  /** Number of non-base FORMS (mega / primal / origin) that received ER passives. */
  formCount: number;
  /** Non-fatal issues encountered (missing mappings, missing species). */
  errors: string[];
}

/**
 * Pokerogue form keys (e.g. `"mega"`, `"mega-x"`, `"primal"`) map to ER
 * species-name suffixes. ER ships e.g. `SPECIES_VENUSAUR_MEGA_REDUX` and
 * `SPECIES_CHARIZARD_MEGA_X_REDUX` as separate species records (id ≥ 10000),
 * with their innates representing the mega/primal-form's passive triple.
 *
 * The mapping derives the candidate ER name from the base species' const
 * (`SPECIES_VENUSAUR`) + the form's pokerogue key (`mega` → `MEGA`) + the
 * `_REDUX` suffix ER uses for its custom species names.
 */
function deriveErFormSpeciesConst(baseConst: string, formKey: string): readonly string[] {
  const upperFormKey = formKey.toUpperCase().replace(/-/g, "_");
  // ER ships mega forms under TWO naming conventions:
  //   1. `SPECIES_X_MEGA_REDUX` — NEW megas Redux added (43 forms — e.g.
  //      `ALAKAZAM_MEGA_REDUX`, `MACHAMP_MEGA_REDUX`).
  //   2. `SPECIES_X_MEGA` — canonical-name megas Redux rebalanced (227 forms —
  //      e.g. `VENUSAUR_MEGA`, `CHARIZARD_MEGA_X`).
  // Try the REDUX-suffixed variant FIRST so newly-added Redux-only megas
  // override the canonical name when both exist. If only the canonical
  // exists, fall through to it.
  return [`${baseConst}_${upperFormKey}_REDUX`, `${baseConst}_${upperFormKey}`];
}

/**
 * Install ER's 3-innate passive triples onto the existing vanilla pokerogue
 * species. Idempotent: safe to call multiple times — the second call overwrites
 * the first with the same data.
 *
 * Defensive: if `allSpecies` is empty (e.g., the species table hasn't been
 * initialized yet by `initSpecies()`), the function returns immediately with
 * a warning. Callers are responsible for ordering — wire this AFTER
 * `initSpecies()` in `initializeGame()`.
 */
export function initEliteReduxSpecies(): InitEliteReduxSpeciesResult {
  const result: InitEliteReduxSpeciesResult = {
    vanillaCount: 0,
    customSkipped: 0,
    formCount: 0,
    errors: [],
  };

  if (allSpecies.length === 0) {
    console.warn("[ER B1a] initEliteReduxSpecies(): allSpecies is empty — skipping");
    return result;
  }

  // Build a O(1) speciesId → PokemonSpecies lookup once.
  const byId = new Map<number, (typeof allSpecies)[number]>();
  for (const species of allSpecies) {
    byId.set(species.speciesId, species);
  }

  // Build a O(1) ER speciesConst → draft lookup for the form-mapping pass.
  // (ER ships mega/primal forms as separate species records keyed by name.)
  const erDraftByConst = new Map<string, (typeof ER_SPECIES)[number]>();
  for (const draft of ER_SPECIES) {
    erDraftByConst.set(draft.speciesConst, draft);
  }

  for (const draft of ER_SPECIES) {
    const pokerogueId = ER_ID_MAP.species[draft.id];
    if (pokerogueId === undefined) {
      result.errors.push(`No pokerogue id mapping for ER species ${draft.id} (${draft.speciesConst})`);
      continue;
    }

    if (pokerogueId >= VANILLA_ID_CUTOFF) {
      // ER-custom species — added by B1b, not here.
      result.customSkipped++;
      continue;
    }

    const species = byId.get(pokerogueId);
    if (!species) {
      result.errors.push(`Pokerogue species ${pokerogueId} (ER ${draft.speciesConst}) not found in allSpecies`);
      continue;
    }

    const passives: readonly [AbilityId, AbilityId, AbilityId] = [
      mapAbilityId(draft.innates[0]),
      mapAbilityId(draft.innates[1]),
      mapAbilityId(draft.innates[2]),
    ];

    species.setPassives(passives);

    // ER base stats — vanilla pokerogue keeps gen-X canon, but ER rebalances
    // many species (e.g. Meganium SpA 83→93 BST 525→535). Without applying
    // these, every species in the port runs with pokerogue's stat line, not
    // ER's, leading to silently-wrong damage calculations in battle.
    species.setBaseStats(draft.baseStats);

    // ER type changes — many species are re-typed (e.g. Meganium becomes
    // Grass/Fairy instead of pure Grass). type1 is required; type2 is
    // optional (null = single type).
    const type1 = mapErType(draft.types[0]);
    const type2 = mapErType(draft.types[1]);
    if (type1 !== null) {
      species.setTypes(type1, type2);
    }

    // ER `abis[]` is the active-ability TRIPLE the player picks one from
    // (mapped to pokerogue's ability1 / ability2 / abilityHidden). Without
    // this, vanilla species silently use pokerogue's actives — e.g.
    // Bulbasaur shows Overgrow when ER actually offers Chloroplast / Pastel
    // Veil / Chlorophyll.
    const actives: readonly [AbilityId, AbilityId, AbilityId] = [
      mapAbilityId(draft.abilities[0]),
      mapAbilityId(draft.abilities[1]),
      mapAbilityId(draft.abilities[2]),
    ];
    if (actives[0] !== AbilityId.NONE) {
      // Only apply when the ER source actually has a primary active — defensive
      // against species whose `abis` is all zeros (none in current data, but
      // future ROM revisions may add such rows).
      species.setActiveAbilities(actives);
    }

    result.vanillaCount++;

    // Also install ER innates on each non-base FORM of this species (mega,
    // mega-x, mega-y, primal, origin). ER ships those forms as separate
    // species records (e.g. SPECIES_VENUSAUR_MEGA_REDUX) — we look each up
    // by name and copy its innates onto the pokerogue PokemonForm instance.
    // This fixes the "mega-form-passives" gap documented in the fusion +
    // transform audit (post-Phase-B).
    for (const form of species.forms) {
      if (!form.formKey) {
        continue;
      }
      const candidates = deriveErFormSpeciesConst(draft.speciesConst, form.formKey);
      let formDraft: (typeof ER_SPECIES)[number] | undefined;
      for (const candidate of candidates) {
        formDraft = erDraftByConst.get(candidate);
        if (formDraft) {
          break;
        }
      }
      if (!formDraft) {
        // No ER counterpart for this form — silently skip. Acceptable: many
        // pokerogue forms (regional variants, alolan/galarian, etc.) don't
        // exist in ER's mega-centric custom set.
        continue;
      }
      const formPassives: readonly [AbilityId, AbilityId, AbilityId] = [
        mapAbilityId(formDraft.innates[0]),
        mapAbilityId(formDraft.innates[1]),
        mapAbilityId(formDraft.innates[2]),
      ];
      form.setPassives(formPassives);

      // Mega forms have their own stat lines and type assignments in ER
      // (Mega Venusaur is Grass/Poison with different stats than the base).
      form.setBaseStats(formDraft.baseStats);
      const formType1 = mapErType(formDraft.types[0]);
      const formType2 = mapErType(formDraft.types[1]);
      if (formType1 !== null) {
        form.setTypes(formType1, formType2);
      }

      // Same active-ability override as the base species. Mega forms in ER
      // (e.g. SPECIES_VENUSAUR_MEGA_REDUX) carry their own `abis[]` triple
      // — without this they keep the base form's actives.
      const formActives: readonly [AbilityId, AbilityId, AbilityId] = [
        mapAbilityId(formDraft.abilities[0]),
        mapAbilityId(formDraft.abilities[1]),
        mapAbilityId(formDraft.abilities[2]),
      ];
      if (formActives[0] !== AbilityId.NONE) {
        form.setActiveAbilities(formActives);
      }

      result.formCount++;
    }

    // ER introduces NEW megas for species that have no vanilla mega (e.g.
    // Meganium Mega, Typhlosion Mega, Feraligatr Mega — none exist in mainline
    // games). For each such ER mega variant whose pokerogue base species has
    // no matching form key, inject a fresh PokemonForm onto species.forms so
    // the dex's form-cycle button can switch to it.
    injectMissingErMegaForms(species, draft, erDraftByConst, result);
  }

  return result;
}

/**
 * Form-key suffixes ER ships on a base species' const. Order matters — more
 * specific suffixes MUST come before more general ones (e.g. "_MEGA_X" before
 * "_MEGA") so the longest match wins. `null` formKey is intentionally never
 * produced — only non-base forms.
 *
 * Covers all 5 ER form families that appear on base species (from suffix
 * audit of v2.65 dump): split megas (X/Y), single mega, primal, origin, and
 * the regional variants (Alolan / Galarian / Hisuian / Paldean / Hisuian-Mega
 * combos). Total ~250 forms across all suffixes.
 */
const ER_FORM_SUFFIXES: readonly { suffix: string; formKey: string; formName: string }[] = [
  // Split megas (must precede plain _MEGA)
  { suffix: "_MEGA_X", formKey: "mega-x", formName: "Mega X" },
  { suffix: "_MEGA_Y", formKey: "mega-y", formName: "Mega Y" },
  // Regional + mega combos (must precede plain regional suffixes)
  { suffix: "_HISUIAN_MEGA", formKey: "hisui-mega", formName: "Hisuian Mega" },
  { suffix: "_MEGA_GALARIAN", formKey: "galar-mega", formName: "Galarian Mega" },
  // Special-form megas
  { suffix: "_PRIMAL", formKey: "primal", formName: "Primal" },
  { suffix: "_ORIGIN", formKey: "origin", formName: "Origin" },
  // Plain mega
  { suffix: "_MEGA", formKey: "mega", formName: "Mega" },
  // Regional variants
  { suffix: "_ALOLAN", formKey: "alola", formName: "Alolan" },
  { suffix: "_GALARIAN", formKey: "galar", formName: "Galarian" },
  { suffix: "_HISUIAN", formKey: "hisui", formName: "Hisuian" },
  { suffix: "_PALDEAN", formKey: "paldea", formName: "Paldean" },
  // Forme variants (Castform / Deoxys / Rotom / Lycanroc-style)
  { suffix: "_SUNNY", formKey: "sunny", formName: "Sunny" },
  { suffix: "_RAINY", formKey: "rainy", formName: "Rainy" },
  { suffix: "_SNOWY", formKey: "snowy", formName: "Snowy" },
  { suffix: "_ATTACK", formKey: "attack", formName: "Attack" },
  { suffix: "_DEFENSE", formKey: "defense", formName: "Defense" },
  { suffix: "_SPEED", formKey: "speed", formName: "Speed" },
  { suffix: "_HEAT", formKey: "heat", formName: "Heat" },
];

/**
 * Look for ER `${baseConst}${suffix}` variants of this species. If the base
 * pokerogue species already has a form with the matching `formKey`, the
 * existing form loop above already patched it — skip. Otherwise construct a
 * new PokemonForm with the ER variant's stats / types / abilities / passives
 * and push it onto `species.forms` so the dex form-cycle picks it up.
 */
function injectMissingErMegaForms(
  species: (typeof allSpecies)[number],
  draft: (typeof ER_SPECIES)[number],
  erDraftByConst: Map<string, (typeof ER_SPECIES)[number]>,
  result: InitEliteReduxSpeciesResult,
): void {
  // Pokerogue convention: when a species has multiple forms, formIndex 0 is
  // ALWAYS the "Normal" base form (formKey = ""). Adding a Mega without a
  // base-form predecessor leaves the dex defaulting to formIndex 0 = Mega,
  // which crashes downstream renders (sprite lookup, evolutions menu).
  //
  // Strategy: detect whether THIS species will receive any new ER form
  // injections. If yes AND species.forms is currently empty, seed a "Normal"
  // base form first so the new injected forms land at index >= 1.
  const willInject = ER_FORM_SUFFIXES.some(
    ({ suffix, formKey }) =>
      erDraftByConst.has(`${draft.speciesConst}${suffix}`) && !species.forms.some(f => f.formKey === formKey),
  );
  if (willInject && species.forms.length === 0) {
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
      null, // formSpriteKey — null = use base species sprite key
      true, // isStarterSelectable — the base form should remain selectable
      false, // isUnobtainable
    );
    // Mirror the base species's 3-passive triple so PokemonForm-level
    // lookups don't fall back to legacy single-passive.
    const basePassives = species.getPassiveAbilities();
    baseForm.setPassives(basePassives);
    const baseMut = baseForm as unknown as { speciesId: number; formIndex: number; generation: number };
    baseMut.speciesId = species.speciesId;
    baseMut.formIndex = 0;
    baseMut.generation = species.generation;
    (species.forms as unknown as PokemonForm[]).push(baseForm);
  }

  for (const { suffix, formKey, formName } of ER_FORM_SUFFIXES) {
    const erConst = `${draft.speciesConst}${suffix}`;
    const formDraft = erDraftByConst.get(erConst);
    if (!formDraft) {
      continue;
    }
    // Already present as a form? Existing-form loop handled it.
    if (species.forms.some(f => f.formKey === formKey)) {
      continue;
    }

    const formType1 = mapErType(formDraft.types[0]);
    if (formType1 === null) {
      continue;
    }
    const formType2 = mapErType(formDraft.types[1]);
    const ab1 = mapAbilityId(formDraft.abilities[0]);
    const ab2 = mapAbilityId(formDraft.abilities[1]);
    const abH = mapAbilityId(formDraft.abilities[2]);
    const [hp, atk, def, spatk, spdef, spd] = formDraft.baseStats;
    const baseTotal = hp + atk + def + spatk + spdef + spd;
    const form = new PokemonForm(
      formName,
      formKey,
      formType1,
      formType2,
      species.height, // height — reuse base; ER source dump doesn't ship per-form hw
      species.weight,
      ab1,
      ab2,
      abH,
      baseTotal,
      hp,
      atk,
      def,
      spatk,
      spdef,
      spd,
      species.catchRate,
      species.baseFriendship,
      species.baseExp,
      false, // genderDiffs
      null, // formSpriteKey — pokerogue derives from formKey
      false, // isStarterSelectable
      false, // isUnobtainable
    );
    // Wire the 3-passive override (PokemonForm extends PokemonSpeciesForm so
    // setPassives is available). Stats / types are already set via constructor;
    // setActiveAbilities is redundant but harmless if called.
    form.setPassives([
      mapAbilityId(formDraft.innates[0]),
      mapAbilityId(formDraft.innates[1]),
      mapAbilityId(formDraft.innates[2]),
    ]);
    // PokemonForm-private fields (speciesId, formIndex, generation) are
    // assigned by the PokemonSpecies constructor's `forms.forEach` block —
    // since we're pushing after construction, we set them here.
    const formMut = form as unknown as { speciesId: number; formIndex: number; generation: number };
    formMut.speciesId = species.speciesId;
    formMut.formIndex = species.forms.length;
    formMut.generation = species.generation;

    (species.forms as unknown as PokemonForm[]).push(form);
    result.formCount++;
  }
}

/**
 * Resolve an ER ability id to a pokerogue `AbilityId`. Returns `AbilityId.NONE`
 * for empty slots (ER stores `0` for "no innate") and for unmapped ids
 * (defensive — shouldn't happen if `er-id-map.ts` is complete).
 */
function mapAbilityId(erAbilityId: number): AbilityId {
  if (erAbilityId === 0) {
    return AbilityId.NONE;
  }
  const mapped = ER_ID_MAP.abilities[erAbilityId];
  if (mapped === undefined) {
    return AbilityId.NONE;
  }
  return mapped as AbilityId;
}
