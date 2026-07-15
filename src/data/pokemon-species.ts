import { determineEnemySpecies } from "#app/ai/ai-species-gen";
import type { AnySound } from "#app/battle-scene";
import type { GameMode } from "#app/game-mode";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { starterPassiveAbilities } from "#balance/passives";
import { pokemonEvolutions, pokemonPrevolutions } from "#balance/pokemon-evolutions";
import {
  pokemonFormLevelMoves,
  pokemonFormLevelMoves as pokemonSpeciesFormLevelMoves,
  pokemonSpeciesLevelMoves,
} from "#balance/pokemon-level-moves";
import { speciesStarterCosts } from "#balance/starters";
import type { GrowthRate } from "#data/exp";
import { Gender } from "#data/gender";
import { AbilityId } from "#enums/ability-id";
import { DexAttr } from "#enums/dex-attr";
import { EvoLevelThresholdKind } from "#enums/evo-level-threshold-kind";
import { PartyMemberStrength } from "#enums/party-member-strength";
import type { PokemonType } from "#enums/pokemon-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import type { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { loadPokemonVariantAssets } from "#sprites/pokemon-sprite";
import { hasExpSprite } from "#sprites/sprite-utils";
import type { Variant, VariantSet } from "#sprites/variant";
import { populateVariantColorCache, variantColorCache, variantData } from "#sprites/variant";
import type { Localizable } from "#types/locales";
import type { LevelMoves } from "#types/pokemon-level-moves";
import type { StarterMoveset } from "#types/save-data";
import type { EvolutionLevel, EvolutionLevelWithThreshold } from "#types/species-gen-types";
import { argbFromRgba, rgbaFromArgb } from "#utils/color-utils";
import { randSeedFloat, randSeedGauss } from "#utils/common";
import { getPokemonSpecies, getPokemonSpeciesForm } from "#utils/pokemon-utils";
import { toCamelCase, toPascalCase } from "#utils/strings";
import { QuantizerCelebi } from "@material/material-color-utilities";
import i18next from "i18next";

export enum Region {
  NORMAL,
  ALOLA,
  GALAR,
  HISUI,
  PALDEA,
}

// TODO: this is horrible and will need to be removed once a refactor/cleanup of forms is executed.
export const normalForm: SpeciesId[] = [
  SpeciesId.PIKACHU,
  SpeciesId.RAICHU,
  SpeciesId.EEVEE,
  SpeciesId.JOLTEON,
  SpeciesId.FLAREON,
  SpeciesId.VAPOREON,
  SpeciesId.ESPEON,
  SpeciesId.UMBREON,
  SpeciesId.LEAFEON,
  SpeciesId.GLACEON,
  SpeciesId.SYLVEON,
  SpeciesId.PICHU,
  SpeciesId.ROTOM,
  SpeciesId.DIALGA,
  SpeciesId.PALKIA,
  SpeciesId.KYUREM,
  SpeciesId.GENESECT,
  SpeciesId.FROAKIE,
  SpeciesId.FROGADIER,
  SpeciesId.GRENINJA,
  SpeciesId.ROCKRUFF,
  SpeciesId.NECROZMA,
  SpeciesId.MAGEARNA,
  SpeciesId.MARSHADOW,
  SpeciesId.CRAMORANT,
  SpeciesId.ZARUDE,
  SpeciesId.CALYREX,
];

export type PokemonSpeciesFilter = (species: PokemonSpecies) => boolean;

/**
 * Sprite-atlas keys currently being loaded by {@linkcode PokemonSpeciesForm.loadAssets}.
 * Rapid cycling in the starter-select / egg-hatch previews fires many overlapping
 * `loadAssets` calls (the serial queue AND the reconcile timer can each request
 * the same key). Issuing `loadPokemonAtlas` twice for an in-flight key corrupts
 * Phaser's shared loader — orphaned files sit "in flight" but never complete or
 * fail, so the loader never drains and EVERY subsequent sprite load starves
 * (the "preview stuck on the previous Pokémon" bug). This set dedupes: a second
 * request for an in-flight key skips the redundant `loadPokemonAtlas` and simply
 * polls for the texture to land (see the poll in `loadAssets`).
 */
const inFlightAtlasLoads = new Set<string>();

export abstract class PokemonSpeciesForm {
  public speciesId: SpeciesId;
  protected _formIndex: number;
  protected _generation: number;
  // TODO: Make these not accept UNKNOWN or STELLAR
  readonly type1: PokemonType;
  readonly type2: PokemonType | null;
  readonly height: number;
  readonly weight: number;
  readonly ability1: AbilityId;
  readonly ability2: AbilityId;
  readonly abilityHidden: AbilityId;
  readonly baseTotal: number;
  readonly baseStats: readonly number[];
  readonly catchRate: number;
  /** The base amount of friendship this species has when caught, as an integer from 0-255. */
  readonly baseFriendship: number;
  readonly baseExp: number;
  readonly genderDiffs: boolean;
  readonly isStarterSelectable: boolean;

  constructor(
    type1: PokemonType,
    type2: PokemonType | null,
    height: number,
    weight: number,
    ability1: AbilityId,
    ability2: AbilityId,
    abilityHidden: AbilityId,
    baseTotal: number,
    baseHp: number,
    baseAtk: number,
    baseDef: number,
    baseSpatk: number,
    baseSpdef: number,
    baseSpd: number,
    catchRate: number,
    baseFriendship: number,
    baseExp: number,
    genderDiffs: boolean,
    isStarterSelectable: boolean,
  ) {
    this.type1 = type1;
    this.type2 = type2;
    this.height = height;
    this.weight = weight;
    this.ability1 = ability1;
    this.ability2 = ability2 === AbilityId.NONE ? ability1 : ability2;
    this.abilityHidden = abilityHidden;
    this.baseTotal = baseTotal;
    this.baseStats = [baseHp, baseAtk, baseDef, baseSpatk, baseSpdef, baseSpd];
    this.catchRate = catchRate;
    this.baseFriendship = baseFriendship;
    this.baseExp = baseExp;
    this.genderDiffs = genderDiffs;
    this.isStarterSelectable = isStarterSelectable;
  }

  /**
   * Method to get the root species id of a Pokemon.
   * Magmortar.getRootSpeciesId(true) => Magmar
   * Magmortar.getRootSpeciesId(false) => Magby
   * @param forStarter boolean to get the nonbaby form of a starter
   * @returns The species
   */
  getRootSpeciesId(forStarter = false): SpeciesId {
    let ret = this.speciesId;
    while (Object.hasOwn(pokemonPrevolutions, ret) && (!forStarter || !Object.hasOwn(speciesStarterCosts, ret))) {
      ret = pokemonPrevolutions[ret];
    }
    return ret;
  }

  get generation(): number {
    return this._generation;
  }

  set generation(generation: number) {
    this._generation = generation;
  }

  get formIndex(): number {
    return this._formIndex;
  }

  set formIndex(formIndex: number) {
    this._formIndex = formIndex;
  }

  isOfType(type: number): boolean {
    return (
      this.type1 === type
      || (this.type2 !== null && this.type2 === type)
      || (this._extraTypes !== null && this._extraTypes.includes(type))
    );
  }

  /**
   * Method to get the total number of abilities a Pokemon species has.
   * @returns Number of abilities
   */
  getAbilityCount(): number {
    return this.abilityHidden === AbilityId.NONE ? 2 : 3;
  }

  /**
   * Method to get the ability of a Pokemon species.
   * @param abilityIndex Which ability to get (should only be 0-2)
   * @returns The id of the Ability
   */
  getAbility(abilityIndex: number): AbilityId {
    let ret: AbilityId;
    if (abilityIndex === 0) {
      ret = this.ability1;
    } else if (abilityIndex === 1) {
      ret = this.ability2;
    } else {
      ret = this.abilityHidden;
    }
    return ret;
  }

  /**
   * Method to get the passive ability of a Pokemon species
   * @param formIndex The form index to use, defaults to form for this species instance
   * @returns The id of the ability
   */
  getPassiveAbility(formIndex = this.formIndex): AbilityId {
    // TODO: This logic is quite convoluted; besides, forms should not need to have their own `getPassiveAbility` functions
    // ER 3-passive: when a `_passives` triple has been installed (Phase B init
    // for vanilla rebalance + custom species), its slot-0 entry IS the legacy
    // single passive. Consult it first so ER-custom species (id >= 10000) —
    // which have no `starterPassiveAbilities` entry and no prevolution chain to
    // walk — resolve correctly instead of falling through to the RUN_AWAY
    // fallback (the "No passive ability found for <id>, using run away" log).
    // We read `_passives` directly rather than via `getPassiveAbilities()` to
    // avoid mutual recursion (that method falls back to `getPassiveAbility()`).
    // Mirror the form-aware resolution used by `getPassiveAbilities()` so a
    // form's own passive triple wins over the base species'.
    const formsArr = (this as unknown as { forms?: readonly PokemonSpeciesForm[] }).forms;
    if (formsArr && formIndex >= 0 && formIndex < formsArr.length) {
      const form = formsArr[formIndex];
      if (form && form !== (this as unknown as PokemonSpeciesForm) && form._passives) {
        return form._passives[0];
      }
    }
    if (this._passives) {
      return this._passives[0];
    }
    let starterSpeciesId = this.speciesId;
    while (
      !(starterSpeciesId in starterPassiveAbilities)
      || !(formIndex in starterPassiveAbilities[starterSpeciesId])
    ) {
      if (Object.hasOwn(pokemonPrevolutions, starterSpeciesId)) {
        starterSpeciesId = pokemonPrevolutions[starterSpeciesId];
      } else {
        // If we've reached the base species and still haven't found a matching ability, use form 0 if possible.
        // ER-custom species (id >= 10000) won't have an entry in starterPassiveAbilities — guard the index.
        if (starterSpeciesId in starterPassiveAbilities && 0 in starterPassiveAbilities[starterSpeciesId]) {
          return starterPassiveAbilities[starterSpeciesId][0];
        }
        console.log("No passive ability found for %s, using run away", this.speciesId);
        return AbilityId.RUN_AWAY;
      }
    }
    return starterPassiveAbilities[starterSpeciesId][formIndex];
  }

  /** ER 3-passive override. Null when not set (legacy behavior — defer to
   *  the original starterPassiveAbilities lookup via getPassiveAbility()).
   *  Populated by Phase B's species init from the er-species.ts draft. */
  protected _passives: readonly [AbilityId, AbilityId, AbilityId] | null = null;

  /**
   * Return all 3 ER-style passive abilities for this species form.
   *
   * - If `setPassives()` has been called (Phase B init path), returns those.
   * - Otherwise falls back to the legacy single-passive lookup: slot 1 =
   *   the result of `getPassiveAbility()`, slots 2/3 = `AbilityId.NONE`.
   *
   * @param formIndex - The form index to resolve passives against. Defaults
   *                    to this instance's `formIndex`.
   */
  getPassiveAbilities(formIndex = this.formIndex): readonly [AbilityId, AbilityId, AbilityId] {
    // Form-aware lookup: when called on a PokemonSpecies with a formIndex
    // pointing to a real form, delegate to that form's _passives. Without
    // this, every form would return the BASE species's passive triple —
    // e.g. Mega Meganium would show Overgrow/Sun's Bounty/Aroma Veil
    // (base) instead of Forest Rage/Flower Necklace/Aroma Veil (Mega form).
    //
    // `this.forms` only exists on PokemonSpecies (not PokemonForm); the
    // duck-type check keeps the base PokemonSpeciesForm method form-agnostic.
    const formsArr = (this as unknown as { forms?: readonly PokemonSpeciesForm[] }).forms;
    if (formsArr && formIndex >= 0 && formIndex < formsArr.length) {
      const form = formsArr[formIndex];
      if (form && form !== (this as unknown as PokemonSpeciesForm) && form._passives) {
        return form._passives;
      }
    }
    if (this._passives) {
      return this._passives;
    }
    return [this.getPassiveAbility(formIndex), AbilityId.NONE, AbilityId.NONE];
  }

  /**
   * Override the 3-passive set for this species. Called by Phase B's
   * `init-elite-redux-species.ts` to install ER's `inns[]` triple.
   * @param passives - Triple of AbilityIds. Use AbilityId.NONE for empty slots.
   */
  setPassives(passives: readonly [AbilityId, AbilityId, AbilityId]): void {
    this._passives = passives;
  }

  /** Count of non-NONE passive slots (0-3). */
  getPassiveCount(formIndex = this.formIndex): number {
    return this.getPassiveAbilities(formIndex).filter(a => a !== AbilityId.NONE).length;
  }

  /**
   * Override the base stat array for this species form. Called by Phase B's
   * `init-elite-redux-species.ts` to install ER's `baseStats` over
   * pokerogue's vanilla values. Recomputes `baseTotal` from the new stats.
   *
   * Without this, vanilla species in the port use pokerogue's stat lines
   * (e.g. Meganium SpA 83 BST 525) even though ER may have rebalanced them
   * (Meganium SpA 93 BST 535).
   *
   * @param stats - 6-tuple in HP/Atk/Def/SpA/SpD/Spd order.
   */
  setBaseStats(stats: readonly [number, number, number, number, number, number]): void {
    const mut = this as unknown as {
      baseStats: readonly number[];
      baseTotal: number;
    };
    mut.baseStats = [stats[0], stats[1], stats[2], stats[3], stats[4], stats[5]];
    mut.baseTotal = stats[0] + stats[1] + stats[2] + stats[3] + stats[4] + stats[5];
  }

  /**
   * Override the type assignment (type1 / type2) for this species form. ER
   * frequently retypes vanilla species (e.g. Meganium becomes Grass/Fairy
   * instead of pure Grass). Pass `null` for `type2` to assign a single type.
   *
   * @param type1 - Primary type (required).
   * @param type2 - Secondary type, or `null` for single-type.
   */
  setTypes(type1: PokemonType, type2: PokemonType | null): void {
    const mut = this as unknown as { type1: PokemonType; type2: PokemonType | null };
    mut.type1 = type1;
    mut.type2 = type2;
  }

  /**
   * ER N-type static model (newcomer-patch fakemon forms). Additional STATIC
   * types beyond `type1`/`type2` for species/forms that are natively 3+ types
   * (Mega Parasect = Bug/Grass/Ghost, Primal Regigigas = six types, ...). Kept
   * as an additive array so `type1`/`type2` stay 100% backward-compatible: every
   * consumer that reads only the first two types keeps working, and consumers
   * that want the FULL static typing call {@linkcode getExtraTypes} (or, on a
   * live Pokemon, {@linkcode Pokemon.getTypes} which folds these in). Null =
   * legacy 2-type species (the overwhelming majority). This deliberately mirrors
   * the additive `_passives` triple model above. */
  protected _extraTypes: readonly PokemonType[] | null = null;

  /**
   * Install the STATIC extra-type set (types 3..N) for this species form. Pass
   * an empty array or omit to clear it. Duplicates of `type1`/`type2` and
   * repeated entries are dropped so `getExtraTypes()` never double-counts.
   *
   * @param extraTypes - The additional static types (beyond type1/type2).
   */
  setExtraTypes(extraTypes: readonly PokemonType[]): void {
    const seen = new Set<PokemonType>([this.type1]);
    if (this.type2 !== null) {
      seen.add(this.type2);
    }
    const cleaned: PokemonType[] = [];
    for (const t of extraTypes) {
      if (!seen.has(t)) {
        seen.add(t);
        cleaned.push(t);
      }
    }
    this._extraTypes = cleaned.length > 0 ? cleaned : null;
  }

  /** The STATIC extra types (types 3..N) for this form, or `[]` when 2-type. */
  getExtraTypes(): readonly PokemonType[] {
    return this._extraTypes ?? [];
  }

  /** Whether this form carries a STATIC third-or-later type. */
  hasExtraTypes(): boolean {
    return this._extraTypes !== null && this._extraTypes.length > 0;
  }

  /**
   * Override the active ability triple (ability1 / ability2 / abilityHidden)
   * for this species. Called by Phase B's `init-elite-redux-species.ts` to
   * install ER's `abis[]` triple over pokerogue's vanilla active abilities.
   *
   * Without this override, vanilla species end up showing pokerogue's active
   * abilities (e.g. Bulbasaur = Overgrow) instead of ER's (Bulbasaur =
   * Chloroplast / Pastel Veil / Chlorophyll).
   *
   * @param abilities - Triple of AbilityIds (ability1, ability2, abilityHidden).
   *   Use AbilityId.NONE for empty slots — they will be normalized like the
   *   constructor's NONE-fallback (ability2/Hidden NONE → ability1).
   */
  setActiveAbilities(abilities: readonly [AbilityId, AbilityId, AbilityId]): void {
    // ability1/2/Hidden are declared `readonly` for compile-time safety, but
    // the Phase B init path is the explicit single writer at runtime. Cast
    // through a mutable view rather than via `as any` to preserve typing.
    const mut = this as unknown as {
      ability1: AbilityId;
      ability2: AbilityId;
      abilityHidden: AbilityId;
    };
    mut.ability1 = abilities[0];
    // Mirror the constructor's NONE normalization so downstream code that
    // assumes a non-NONE ability2 keeps working.
    mut.ability2 = abilities[1] === AbilityId.NONE ? abilities[0] : abilities[1];
    mut.abilityHidden = abilities[2];
  }

  getLevelMoves(): LevelMoves {
    if (
      Object.hasOwn(pokemonSpeciesFormLevelMoves, this.speciesId)
      && Object.hasOwn(pokemonSpeciesFormLevelMoves[this.speciesId], this.formIndex)
    ) {
      return pokemonSpeciesFormLevelMoves[this.speciesId][this.formIndex].slice(0);
    }
    // ER customs may be missing from pokemonSpeciesLevelMoves if all their
    // ER moves were dropped during init — guard against undefined.
    return (pokemonSpeciesLevelMoves[this.speciesId] ?? []).slice(0);
  }

  getRegion(): Region {
    return Math.floor(this.speciesId / 2000) as Region;
  }

  // TODO: this is primarily used for preventing certain pokemon from generating on trainers, rename?
  public isCatchable(): boolean {
    const blockedSpecies = [
      SpeciesId.MEW,
      SpeciesId.CELEBI,
      SpeciesId.JIRACHI,
      SpeciesId.DEOXYS,
      SpeciesId.PHIONE,
      SpeciesId.MANAPHY,
      SpeciesId.ARCEUS,
      SpeciesId.VICTINI,
      SpeciesId.MELTAN,
      SpeciesId.MELMETAL,
      SpeciesId.ETERNATUS,
      SpeciesId.GREAT_TUSK,
      SpeciesId.SCREAM_TAIL,
      SpeciesId.BRUTE_BONNET,
      SpeciesId.FLUTTER_MANE,
      SpeciesId.SLITHER_WING,
      SpeciesId.SANDY_SHOCKS,
      SpeciesId.IRON_TREADS,
      SpeciesId.IRON_BUNDLE,
      SpeciesId.IRON_HANDS,
      SpeciesId.IRON_JUGULIS,
      SpeciesId.IRON_MOTH,
      SpeciesId.IRON_THORNS,
      SpeciesId.ROARING_MOON,
      SpeciesId.IRON_VALIANT,
      SpeciesId.WALKING_WAKE,
      SpeciesId.IRON_LEAVES,
      SpeciesId.GOUGING_FIRE,
      SpeciesId.RAGING_BOLT,
      SpeciesId.IRON_BOULDER,
      SpeciesId.IRON_CROWN,
      SpeciesId.PECHARUNT,
    ];
    return !blockedSpecies.includes(this.speciesId);
  }

  isRegional(): boolean {
    return this.getRegion() > Region.NORMAL;
  }

  isTrainerForbidden(): boolean {
    return [SpeciesId.ETERNAL_FLOETTE, SpeciesId.BLOODMOON_URSALUNA].includes(this.speciesId);
  }

  isRareRegional(): boolean {
    switch (this.getRegion()) {
      case Region.HISUI:
        return true;
    }

    return false;
  }

  /**
   * Gets the BST for the species
   * @returns The species' BST.
   */
  getBaseStatTotal(): number {
    return this.baseStats.reduce((i, n) => n + i);
  }

  /**
   * Gets the species' base stat amount for the given stat.
   * @param stat  The desired stat.
   * @returns The species' base stat amount.
   */
  getBaseStat(stat: Stat): number {
    return this.baseStats[stat];
  }

  getBaseExp(): number {
    let ret = this.baseExp;
    switch (this.getFormSpriteKey()) {
      case SpeciesFormKey.MEGA:
      case SpeciesFormKey.MEGA_X:
      case SpeciesFormKey.MEGA_Y:
      case SpeciesFormKey.PRIMAL:
      case SpeciesFormKey.GIGANTAMAX:
      case SpeciesFormKey.ETERNAMAX:
        ret *= 1.5;
        break;
    }
    return ret;
  }

  getSpriteAtlasPath(female: boolean, formIndex?: number, shiny?: boolean, variant?: number, back?: boolean): string {
    const spriteId = this.getSpriteId(female, formIndex, shiny, variant, back).replace(/_{2}/g, "/");
    return `${/_[1-3]$/.test(spriteId) ? "variant/" : ""}${spriteId}`;
  }

  getBaseSpriteKey(female: boolean, formIndex?: number): string {
    if (formIndex === undefined || this instanceof PokemonForm) {
      formIndex = this.formIndex;
    }

    const formSpriteKey = this.getFormSpriteKey(formIndex);
    const showGenderDiffs =
      this.genderDiffs
      && female
      && ![SpeciesFormKey.MEGA, SpeciesFormKey.GIGANTAMAX].includes(formSpriteKey as SpeciesFormKey);

    let spriteKey = `${showGenderDiffs ? "female__" : ""}${this.speciesId}${formSpriteKey ? `-${formSpriteKey}` : ""}`;

    const replacement = timedEventManager.getEventPokemonSpriteReplacement(this.speciesId, formIndex);
    if (replacement) {
      const replacementFormSpriteKey = getPokemonSpecies(replacement.speciesId).forms[
        replacement.formIndex
      ]?.getFormSpriteKey(replacement.formIndex);

      const replacementShowGenderDiffs =
        getPokemonSpecies(replacement.speciesId).genderDiffs
        && female
        && ![SpeciesFormKey.MEGA, SpeciesFormKey.GIGANTAMAX].includes(replacementFormSpriteKey as SpeciesFormKey);

      spriteKey = `${replacementShowGenderDiffs ? "female__" : ""}${replacement.speciesId}${replacementFormSpriteKey ? `-${replacementFormSpriteKey}` : ""}`;
    }

    return spriteKey;
  }

  /** Compute the sprite ID of the pokemon form. */
  getSpriteId(female: boolean, formIndex?: number, shiny?: boolean, variant = 0, back = false): string {
    const baseSpriteKey = this.getBaseSpriteKey(female, formIndex);

    let config = variantData;
    `${back ? "back__" : ""}${baseSpriteKey}`.split("__").map(p => (config ? (config = config[p]) : null));
    const variantSet = config as VariantSet;

    return `${back ? "back__" : ""}${shiny && (!variantSet || (!variant && !variantSet[variant || 0])) ? "shiny__" : ""}${baseSpriteKey}${shiny && variantSet && variantSet[variant] === 2 ? `_${variant + 1}` : ""}`;
  }

  getSpriteKey(female: boolean, formIndex?: number, shiny?: boolean, variant?: number, back?: boolean): string {
    return `pkmn__${this.getSpriteId(female, formIndex, shiny, variant, back)}`;
  }

  abstract getFormSpriteKey(formIndex?: number): string;

  /**
   * Variant Data key/index is either species id or species id followed by -formkey
   * @param formIndex optional form index for pokemon with different forms
   * @returns species id if no additional forms, index with formkey if a pokemon with a form
   */
  getVariantDataIndex(formIndex?: number): string | number {
    let formkey: string | null = null;
    let variantDataIndex: number | string = this.speciesId;
    const species = getPokemonSpecies(this.speciesId);
    if (species.forms.length > 0 && formIndex !== undefined) {
      formkey = species.forms[formIndex]?.getFormSpriteKey(formIndex);
      if (formkey) {
        variantDataIndex = `${this.speciesId}-${formkey}`;
      }
    }

    const replacement = timedEventManager.getEventPokemonSpriteReplacement(this.speciesId, formIndex);
    if (replacement) {
      formkey = species.forms[replacement.formIndex]?.getFormSpriteKey(replacement.formIndex);
      if (formkey) {
        variantDataIndex = `${replacement.speciesId}-${formkey}`;
      } else {
        variantDataIndex = replacement.speciesId;
      }
    }

    return variantDataIndex;
  }

  /**
   * Elite Redux: if THIS is a species whose form at `formIndex` carries an ER
   * sprite/icon redirect (installErFormSpriteRedirect tags the form instance
   * with `__erFormSpriteRedirect`), return that form so icon resolution can
   * defer to it. Species-level icon calls — the party/box/Pokédex/starter/
   * egg-hatch grids all pass an explicit `formIndex` — otherwise build the
   * vanilla `"<id>-<formKey>"` packed-atlas frame (e.g. `"69-redux"`), which
   * does not exist for injected redux forms and falls back to the wrong icon
   * (Bellsprout redux → default, Bounsweet redux → Melmetal). The battle-field
   * path already defers to the form instance, so it was unaffected.
   */
  private getErRedirectedForm(formIndex?: number): PokemonSpeciesForm | undefined {
    const forms = (this as unknown as { forms?: PokemonSpeciesForm[] }).forms;
    if (!Array.isArray(forms) || forms.length === 0) {
      return;
    }
    const form = forms[formIndex ?? this.formIndex];
    if (form && form !== this && (form as unknown as { __erFormSpriteRedirect?: boolean }).__erFormSpriteRedirect) {
      return form;
    }
    return;
  }

  getIconAtlasKey(formIndex?: number, shiny?: boolean, variant?: number): string {
    const erForm = this.getErRedirectedForm(formIndex);
    if (erForm) {
      return erForm.getIconAtlasKey(formIndex, shiny, variant);
    }
    const variantDataIndex = this.getVariantDataIndex(formIndex);
    const isVariant =
      shiny && variantData[variantDataIndex] && variant !== undefined && variantData[variantDataIndex][variant];

    const replacementSpecies = timedEventManager.getEventPokemonSpriteReplacement(this.speciesId, formIndex);
    const generation = replacementSpecies
      ? getPokemonSpeciesForm(replacementSpecies.speciesId, replacementSpecies.formIndex).generation
      : this.generation;
    return `pokemon_icons_${generation}${isVariant ? "v" : ""}`;
  }

  getIconId(female: boolean, formIndex?: number, shiny?: boolean, variant?: number): string {
    const erForm = this.getErRedirectedForm(formIndex);
    if (erForm) {
      return erForm.getIconId(female, formIndex, shiny, variant);
    }
    if (formIndex === undefined) {
      formIndex = this.formIndex;
    }

    const variantDataIndex = this.getVariantDataIndex(formIndex);
    const replacement = timedEventManager.getEventPokemonSpriteReplacement(this.speciesId, formIndex);

    let ret = this.speciesId.toString();

    if (replacement) {
      ret = replacement.speciesId.toString();
    }

    const isVariant =
      shiny && variantData[variantDataIndex] && variant !== undefined && variantData[variantDataIndex][variant];

    if (shiny && !isVariant) {
      ret += "s";
    }

    switch (this.speciesId) {
      case SpeciesId.DODUO:
      case SpeciesId.DODRIO:
      case SpeciesId.MEGANIUM:
      case SpeciesId.TORCHIC:
      case SpeciesId.COMBUSKEN:
      case SpeciesId.BLAZIKEN:
      case SpeciesId.HIPPOPOTAS:
      case SpeciesId.HIPPOWDON:
      case SpeciesId.UNFEZANT:
      case SpeciesId.FRILLISH:
      case SpeciesId.JELLICENT:
      case SpeciesId.PYROAR:
        ret += female ? "-f" : "";
        break;
    }

    let formSpriteKey = this.getFormSpriteKey(formIndex);
    if (replacement) {
      formSpriteKey = getPokemonSpeciesForm(replacement.speciesId, replacement.formIndex).getFormSpriteKey(
        replacement.formIndex,
      );
    }
    if (formSpriteKey) {
      switch (this.speciesId) {
        case SpeciesId.DUDUNSPARCE:
          break;
        case SpeciesId.ZACIAN:
        // biome-ignore lint/suspicious/noFallthroughSwitchClause: Intentionally falls through
        case SpeciesId.ZAMAZENTA:
          if (formSpriteKey.startsWith("behemoth")) {
            formSpriteKey = "crowned";
          }
        default:
          ret += `-${formSpriteKey}`;
          break;
      }
    }

    if (isVariant) {
      ret += `_${variant + 1}`;
    }

    return ret;
  }

  getCryKey(formIndex?: number): string {
    let speciesId = this.speciesId;

    const override = timedEventManager.getEventPokemonSpriteReplacement(this.speciesId, formIndex);
    if (override) {
      speciesId = override.speciesId;
      formIndex = override.formIndex;
    }

    if (speciesId > 2000) {
      switch (speciesId) {
        case SpeciesId.GALAR_SLOWPOKE:
          break;
        case SpeciesId.ETERNAL_FLOETTE:
          break;
        case SpeciesId.BLOODMOON_URSALUNA:
          break;
        default:
          speciesId %= 2000;
          break;
      }
    }
    let ret = speciesId.toString();
    const forms = getPokemonSpecies(speciesId).forms;
    if (forms.length > 0) {
      if (formIndex !== undefined && formIndex >= forms.length) {
        console.warn(
          `Attempted accessing form with index ${formIndex} of species ${getPokemonSpecies(speciesId).getName()} with only ${forms.length || 0} forms`,
        );
        formIndex = Math.min(formIndex, forms.length - 1);
      }
      const formKey = forms[formIndex || 0].formKey;
      switch (formKey) {
        case SpeciesFormKey.MEGA:
        case SpeciesFormKey.MEGA_X:
        case SpeciesFormKey.MEGA_Y:
        case SpeciesFormKey.PRIMAL:
        case SpeciesFormKey.GIGANTAMAX:
        case SpeciesFormKey.GIGANTAMAX_SINGLE:
        case SpeciesFormKey.GIGANTAMAX_RAPID:
        case SpeciesFormKey.ETERNAMAX:
        case "white":
        case "black":
        case "therian":
        case "sky":
        case "gorging":
        case "gulping":
        case "lowkey":
        case "no-ice":
        case "hangry":
        case "crowned":
        case "rapid-strike":
        case "four":
        case "droopy":
        case "stretchy":
        case "hero":
        case "roaming":
        case "complete":
        case "10-complete":
        case "10":
        case "10-pc":
        case "super":
        case "unbound":
        case "pau":
        case "pompom":
        case "sensu":
        case "dusk":
        case "midnight":
        case "school":
        case "dawn-wings":
        case "dusk-mane":
        case "ultra":
          ret += `-${formKey}`;
          break;
      }
      switch (this.speciesId) {
        case SpeciesId.INDEEDEE:
        case SpeciesId.OINKOLOGNE:
          if (formKey === "female") {
            ret += `-${formKey}`;
          }
          break;
        case SpeciesId.CALYREX:
          if (formKey === "ice" || formKey === "shadow") {
            ret += `-${formKey}`;
          }
          break;
      }
    }
    return `cry/${ret}`;
  }

  validateStarterMoveset(moveset: StarterMoveset, eggMoves: number): boolean {
    const rootSpeciesId = this.getRootSpeciesId();
    for (const moveId of moveset) {
      if (Object.hasOwn(speciesEggMoves, rootSpeciesId)) {
        const eggMoveIndex = speciesEggMoves[rootSpeciesId].indexOf(moveId);
        if (eggMoveIndex > -1 && eggMoves & (1 << eggMoveIndex)) {
          continue;
        }
      }
      if (
        Object.hasOwn(pokemonFormLevelMoves, this.speciesId)
        && Object.hasOwn(pokemonFormLevelMoves[this.speciesId], this.formIndex)
      ) {
        if (!pokemonFormLevelMoves[this.speciesId][this.formIndex].find(lm => lm[0] <= 5 && lm[1] === moveId)) {
          return false;
        }
      } else if (!(pokemonSpeciesLevelMoves[this.speciesId] ?? []).find(lm => lm[0] <= 5 && lm[1] === moveId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Load the variant colors for the species into the variant color cache
   *
   * @param spriteKey - The sprite key to use
   * @param female - Whether to load female instead of male
   * @param back - Whether the back sprite is being loaded
   *
   */
  async loadVariantColors(
    spriteKey: string,
    female: boolean,
    variant: Variant,
    back = false,
    formIndex?: number,
    scene = globalScene,
  ): Promise<void> {
    let baseSpriteKey = this.getBaseSpriteKey(female, formIndex);
    if (back) {
      baseSpriteKey = "back__" + baseSpriteKey;
    }

    if (Object.hasOwn(variantColorCache, baseSpriteKey)) {
      // Variant colors have already been loaded
      return;
    }

    const variantInfo = variantData[this.getVariantDataIndex(formIndex)];
    // Do nothing if there is no variant information or the variant does not have color replacements
    if (!variantInfo || variantInfo[variant] !== 1) {
      return;
    }

    await populateVariantColorCache(
      "pkmn__" + baseSpriteKey,
      scene.experimentalSprites && hasExpSprite(spriteKey),
      baseSpriteKey.replace("__", "/"),
    );
  }

  async loadAssets(
    female: boolean,
    formIndex?: number,
    shiny = false,
    variant?: Variant,
    startLoad = false,
    back = false,
    /**
     * ER: when true, only the sprite atlas is queued — the cry audio is skipped.
     * Used by preview screens (starter-select / egg-hatch) during rapid cycling,
     * where 40+ queued .m4a cries (and their Web-Audio decodes) saturate the
     * shared loader and make sprite atlases wait seconds behind them.
     */
    spriteOnly = false,
  ): Promise<void> {
    // Asset loads belong to the scene that initiated them. In the two-engine harness (and during real
    // navigation), process-global `globalScene` can point at a different scene before loader callbacks or
    // the safety poll fire. Following that later scene leaks timers/listeners across clients and can read
    // a torn-down texture manager. Pin every async continuation in this method to its initiating scene.
    const scene = globalScene;
    const spriteKey = this.getSpriteKey(female, formIndex, shiny, variant, back);
    const atlasPath = this.getSpriteAtlasPath(female, formIndex, shiny, variant, back);

    const buildAnim = (): void => {
      const originalWarn = console.warn;
      // Ignore warnings for missing frames, because there will be a lot.
      console.warn = () => {};
      const frameNames = scene.anims.generateFrameNames(spriteKey, {
        zeroPad: 4,
        suffix: ".png",
        start: 1,
        end: 400,
      });
      console.warn = originalWarn;
      if (scene.anims.exists(spriteKey)) {
        scene.anims.get(spriteKey).frameRate = 10;
      } else {
        scene.anims.create({
          key: spriteKey,
          frames: frameNames,
          frameRate: 10,
          repeat: -1,
        });
      }
    };

    const finalize = async (): Promise<void> => {
      if (!scene.textures.exists(spriteKey)) {
        return;
      }
      buildAnim();
      if (variant != null) {
        const spritePath = atlasPath.replace("variant/", "").replace(/_[1-3]$/, "");
        await loadPokemonVariantAssets(spriteKey, spritePath, variant, scene);
      }
    };

    if (scene.textures.exists(spriteKey)) {
      await finalize();
      return;
    }

    // Dedupe overlapping loads of the same atlas. Issuing `loadPokemonAtlas`
    // again for a key already in flight corrupts Phaser's shared loader (files
    // get orphaned "in flight" and never complete, wedging ALL sprite loads).
    // A duplicate request instead skips straight to the poll below and settles
    // when the in-flight load's texture lands.
    const alreadyInFlight = inFlightAtlasLoads.has(spriteKey);
    if (!alreadyInFlight) {
      inFlightAtlasLoads.add(spriteKey);
      scene.loadPokemonAtlas(spriteKey, atlasPath);
    }
    if (!alreadyInFlight && !spriteOnly) {
      scene.load.audio(this.getCryKey(formIndex), `audio/${this.getCryKey(formIndex)}.m4a`);
    }
    if (!alreadyInFlight && variant != null && !spriteOnly) {
      // Skipped in preview mode: this CPU-heavy variant-colour processing is
      // awaited BEFORE the atlas listener is attached, so a slow run delays the
      // atlas/anim and the sprite can't appear for seconds. In preview the tint
      // self-corrects once the colours land via the variant assets in finalize.
      await this.loadVariantColors(spriteKey, female, variant, back, formIndex, scene);
    }

    return new Promise<void>(resolve => {
      let settled = false;
      let safetyTimer: Phaser.Time.TimerEvent | null = null;
      const cleanup = (): void => {
        scene.load.off(`filecomplete-atlasjson-${spriteKey}`, onFileComplete);
        scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onLoadError);
        safetyTimer?.remove();
        safetyTimer = null;
        // Release the dedupe slot so a future (post-failure) retry can re-issue
        // the atlas load. By the time we cleanup the texture is either present
        // (future calls early-return) or genuinely failed (a retry is wanted).
        inFlightAtlasLoads.delete(spriteKey);
      };
      const settle = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        finalize()
          .catch(() => {})
          .then(() => resolve());
      };
      const onFileComplete = (key: string): void => {
        if (key === spriteKey) {
          settle();
        }
      };
      // Settle on ANY load error for this atlas. The previous guard also required
      // `multiFile?.type === "atlasjson"`, which a missing/404 atlas (e.g. an ER
      // custom with no shiny sprite) can fail to satisfy — leaving this promise
      // (and the serial starter-sprite queue + the reconcile timer that awaits
      // it) hung forever, freezing the preview on the previous Pokémon. The
      // sub-file key for an atlas load is the sprite key, so a bare key check is
      // both sufficient and robust.
      const onLoadError = (file: Phaser.Loader.File): void => {
        if (file.key === spriteKey) {
          settle();
        }
      };

      scene.load.on(`filecomplete-atlasjson-${spriteKey}`, onFileComplete);
      scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onLoadError);

      // Authoritative completion detector: POLL for the texture rather than
      // relying solely on the `filecomplete-atlasjson` event. When the shared
      // Phaser loader is already mid-run (the common case during rapid cycling),
      // the atlas can finish between `loadPokemonAtlas` and our listener attach,
      // so the event is missed and the promise (plus the serial starter-sprite
      // queue + reconcile that await it) would hang — leaving the preview frozen
      // on the previous Pokémon. Polling settles reliably whenever the texture
      // actually lands (settle→finalize still builds the animation), and a
      // backstop UNBLOCKS the awaiter even if the load was silently dropped.
      let polls = 0;
      safetyTimer = scene.time.addEvent({
        delay: 100,
        loop: true,
        callback: () => {
          if (settled) {
            return;
          }
          if (scene.textures.exists(spriteKey)) {
            settle(); // texture landed (possibly via a missed event) — finalize + resolve
          } else if (++polls >= 100) {
            // ~10s with no texture: a genuine hang (very rare — the dev server
            // serves atlases in well under 2s even under load, per measurement).
            // We deliberately do NOT abort the request here: aborting an in-flight
            // Image element doesn't reliably cancel the underlying browser request
            // (so it "leaks" anyway), and abandoning a merely-slow request at a
            // short timeout is what caused requests to pile up and exhaust the
            // connection pool. Concurrency is bounded by the caller instead, so
            // requests complete and free their connections; here we only unblock
            // the awaiter so a truly-stuck promise can't wedge the queue forever.
            cleanup();
            resolve();
          }
        },
      });

      if (startLoad) {
        if (!scene.load.isLoading()) {
          scene.load.start();
        }
        // Race guard: when the loader was ALREADY running, `loadPokemonAtlas`
        // appends to it and the atlas can finish before this listener is
        // attached (there's an awaited step above) — the `filecomplete` event
        // is then missed and this promise would hang forever, stalling the
        // serial starter-sprite queue (the "sprite stuck during rapid cycling"
        // bug). If the texture is already present, settle now; otherwise the
        // normal filecomplete listener will settle when it lands (no premature
        // timeout — settling before the texture exists would skip buildAnim and
        // leave the sprite permanently animation-less for slow loads).
        if (scene.textures.exists(spriteKey)) {
          settle();
        }
      } else {
        // The caller owns starting the loader. Keep the per-file listener
        // installed so the animation is built when the atlas eventually lands.
        resolve();
      }
    });
  }

  cry(soundConfig?: Phaser.Types.Sound.SoundConfig, ignorePlay?: boolean): AnySound | null {
    const cryKey = this.getCryKey(this.formIndex);
    let cry: AnySound | null = globalScene.sound.get(cryKey) as AnySound;
    if (cry?.pendingRemove) {
      cry = null;
    }
    cry = globalScene.playSound(cry ?? cryKey, soundConfig);
    if (cry && ignorePlay) {
      cry.stop();
    }
    return cry;
  }

  generateCandyColors(): number[][] {
    const sourceTexture = globalScene.textures.get(this.getSpriteKey(false));

    const sourceFrame = sourceTexture.frames[sourceTexture.firstFrame];
    const sourceImage = sourceTexture.getSourceImage() as HTMLImageElement;

    const canvas = document.createElement("canvas");

    const spriteColors: number[][] = [];

    const context = canvas.getContext("2d");
    const frame = sourceFrame;
    canvas.width = frame.width;
    canvas.height = frame.height;
    context?.drawImage(sourceImage, frame.cutX, frame.cutY, frame.width, frame.height, 0, 0, frame.width, frame.height);
    const imageData = context?.getImageData(frame.cutX, frame.cutY, frame.width, frame.height);
    const pixelData = imageData?.data;
    const pixelColors: number[] = [];

    if (pixelData?.length !== undefined) {
      for (let i = 0; i < pixelData.length; i += 4) {
        if (pixelData[i + 3]) {
          const pixel = pixelData.slice(i, i + 4);
          const [r, g, b, a] = pixel;
          if (!spriteColors.find(c => c[0] === r && c[1] === g && c[2] === b)) {
            spriteColors.push([r, g, b, a]);
          }
        }
      }

      for (let i = 0; i < pixelData.length; i += 4) {
        const total = pixelData.slice(i, i + 3).reduce((total: number, value: number) => total + value, 0);
        if (!total) {
          continue;
        }
        pixelColors.push(
          argbFromRgba({
            r: pixelData[i],
            g: pixelData[i + 1],
            b: pixelData[i + 2],
            a: pixelData[i + 3],
          }),
        );
      }
    }

    let paletteColors: Map<number, number> = new Map();

    const originalRandom = Math.random;
    Math.random = randSeedFloat;

    globalScene.executeWithSeedOffset(
      () => {
        paletteColors = QuantizerCelebi.quantize(pixelColors, 2);
      },
      0,
      "This result should not vary",
    );

    Math.random = originalRandom;

    return Array.from(paletteColors.keys()).map(c => Object.values(rgbaFromArgb(c)) as number[]);
  }
}

export class PokemonSpecies extends PokemonSpeciesForm implements Localizable {
  public name: string;
  readonly subLegendary: boolean;
  readonly legendary: boolean;
  readonly mythical: boolean;
  public category: string;
  readonly growthRate: GrowthRate;
  /** The chance (as a decimal) for this Species to be male, or `null` for genderless species */
  readonly malePercent: number | null;
  readonly genderDiffs: boolean;
  readonly canChangeForm: boolean;
  readonly forms: PokemonForm[];

  constructor(
    id: SpeciesId,
    generation: number,
    subLegendary: boolean,
    legendary: boolean,
    mythical: boolean,
    category: string,
    type1: PokemonType,
    type2: PokemonType | null,
    height: number,
    weight: number,
    ability1: AbilityId,
    ability2: AbilityId,
    abilityHidden: AbilityId,
    baseTotal: number,
    baseHp: number,
    baseAtk: number,
    baseDef: number,
    baseSpatk: number,
    baseSpdef: number,
    baseSpd: number,
    catchRate: number,
    baseFriendship: number,
    baseExp: number,
    growthRate: GrowthRate,
    malePercent: number | null,
    genderDiffs: boolean,
    canChangeForm?: boolean,
    ...forms: PokemonForm[]
  ) {
    super(
      type1,
      type2,
      height,
      weight,
      ability1,
      ability2,
      abilityHidden,
      baseTotal,
      baseHp,
      baseAtk,
      baseDef,
      baseSpatk,
      baseSpdef,
      baseSpd,
      catchRate,
      baseFriendship,
      baseExp,
      genderDiffs,
      false,
    );
    this.speciesId = id;
    this.formIndex = 0;
    this.generation = generation;
    this.subLegendary = subLegendary;
    this.legendary = legendary;
    this.mythical = mythical;
    this.category = category;
    this.growthRate = growthRate;
    this.malePercent = malePercent;
    this.genderDiffs = genderDiffs;
    this.canChangeForm = !!canChangeForm;
    this.forms = forms;

    this.localize();

    forms.forEach((form, f) => {
      form.speciesId = id;
      form.formIndex = f;
      form.generation = generation;
    });
  }

  getName(formIndex?: number): string {
    if (formIndex !== undefined && this.forms.length > 0) {
      const form = this.forms[formIndex];
      let key: string | undefined;
      switch (form.formKey) {
        case SpeciesFormKey.MEGA:
        case SpeciesFormKey.PRIMAL:
        case SpeciesFormKey.ETERNAMAX:
        case SpeciesFormKey.MEGA_X:
        case SpeciesFormKey.MEGA_Y:
          key = form.formKey;
          break;
        default:
          if (form.formKey.indexOf(SpeciesFormKey.GIGANTAMAX) > -1) {
            key = "gigantamax";
          }
      }

      if (key) {
        return i18next.t(`battlePokemonForm:${toCamelCase(key)}`, { pokemonName: this.name });
      }
    }
    return this.name;
  }

  /**
   * Pick and return a random {@linkcode Gender} for a {@linkcode Pokemon}.
   * @returns A randomly rolled gender based on this Species' {@linkcode malePercent}.
   */
  generateGender(): Gender {
    if (this.malePercent == null) {
      return Gender.GENDERLESS;
    }

    if (randSeedFloat() * 100 <= this.malePercent) {
      return Gender.MALE;
    }
    return Gender.FEMALE;
  }

  /**
   * Find the name of species with proper attachments for regionals and separate starter forms (Floette, Ursaluna)
   * @returns a string with the region name or other form name attached
   */
  getExpandedSpeciesName(): string {
    if (this.speciesId < 2000) {
      return this.name; // Other special cases could be put here too
    }
    // Everything beyond this point essentially follows the pattern of FORMNAME_SPECIES
    return i18next.t(`pokemonForm:appendForm.${toCamelCase(SpeciesId[this.speciesId].split("_")[0])}`, {
      pokemonName: this.name,
    });
  }

  /**
   * Find the form name for species with just one form (regional variants, Floette, Ursaluna)
   * @param formIndex The form index to check (defaults to 0)
   * @param append Whether to append the species name to the end (defaults to false)
   * @returns the pokemon-form locale key for the single form name ("Alolan Form", "Eternal Flower" etc)
   */
  getFormNameToDisplay(formIndex = 0, append = false): string {
    const formKey = this.forms[formIndex]?.formKey ?? "";
    const formText = toPascalCase(formKey);
    // ER customs (id >= 10000) aren't in the SpeciesId enum, so SpeciesId[id]
    // is undefined and toCamelCase(undefined) crashes (.trim of undefined),
    // softlocking the Pokédex Evolutions menu on any Redux line. Fall back to
    // the display name.
    const speciesName = toCamelCase(SpeciesId[this.speciesId] ?? this.name);
    let ret = "";

    const region = this.getRegion();
    if (this.speciesId === SpeciesId.ARCEUS) {
      ret = i18next.t(`pokemonInfo:type.${toCamelCase(formText)}`);
    } else if (
      [
        SpeciesFormKey.MEGA,
        SpeciesFormKey.MEGA_X,
        SpeciesFormKey.MEGA_Y,
        SpeciesFormKey.PRIMAL,
        SpeciesFormKey.GIGANTAMAX,
        SpeciesFormKey.GIGANTAMAX_RAPID,
        SpeciesFormKey.GIGANTAMAX_SINGLE,
        SpeciesFormKey.ETERNAMAX,
      ].includes(formKey as SpeciesFormKey)
    ) {
      return append
        ? i18next.t(`battlePokemonForm:${toCamelCase(formKey)}`, { pokemonName: this.name })
        : i18next.t(`pokemonForm:battleForm.${toCamelCase(formKey)}`);
    } else if (
      region === Region.NORMAL
      || (this.speciesId === SpeciesId.GALAR_DARMANITAN && formIndex > 0)
      || this.speciesId === SpeciesId.PALDEA_TAUROS
    ) {
      // More special cases can be added here
      const i18key = `pokemonForm:${speciesName}${formText}`;
      if (i18next.exists(i18key)) {
        ret = i18next.t(i18key);
      } else {
        const rootSpeciesName = toCamelCase(SpeciesId[this.getRootSpeciesId()] ?? this.name);
        const i18RootKey = `pokemonForm:${rootSpeciesName}${formText}`;
        ret = i18next.exists(i18RootKey) ? i18next.t(i18RootKey) : formText;
      }
    } else if (append) {
      // Everything beyond this has an expanded name
      return this.getExpandedSpeciesName();
    } else if (this.speciesId === SpeciesId.ETERNAL_FLOETTE) {
      // Not a real form, so the key is made up
      return i18next.t("pokemonForm:floetteEternalFlower");
    } else if (this.speciesId === SpeciesId.BLOODMOON_URSALUNA) {
      // Not a real form, so the key is made up
      return i18next.t("pokemonForm:ursalunaBloodmoon");
    } else {
      // Only regional forms should be left at this point
      return i18next.t(`pokemonForm:regionalForm.${toCamelCase(Region[region])}`);
    }
    return append
      ? i18next.t("pokemonForm:appendForm.generic", {
          pokemonName: this.name,
          formName: ret,
        })
      : ret;
  }

  localize(): void {
    this.name = i18next.t(`pokemon:${toCamelCase(SpeciesId[this.speciesId])}`);
    this.category = i18next.t(`pokemonCategory:${toCamelCase(SpeciesId[this.speciesId])}Category`);
  }

  getWildSpeciesForLevel(level: number, allowEvolving: boolean, isBoss: boolean, gameMode: GameMode): SpeciesId {
    return this.getSpeciesForLevel(
      level,
      allowEvolving,
      false,
      (isBoss ? PartyMemberStrength.WEAKER : PartyMemberStrength.AVERAGE) + (gameMode?.isEndless ? 1 : 0),
      isBoss ? EvoLevelThresholdKind.NORMAL : EvoLevelThresholdKind.WILD,
    );
  }

  /**
   * Determine which species of Pokémon to use for a given level in a trainer battle.
   *
   * @see {@linkcode getSpeciesForLevel}
   */
  getTrainerSpeciesForLevel(
    level: number,
    allowEvolving = false,
    strength: PartyMemberStrength = PartyMemberStrength.WEAKER,
    encounterKind: EvoLevelThresholdKind = EvoLevelThresholdKind.NORMAL,
  ): SpeciesId {
    return this.getSpeciesForLevel(level, allowEvolving, true, strength, encounterKind);
  }

  /**
   * Determine which species of Pokémon to use for a given level
   * @see {@linkcode determineEnemySpecies}
   */
  getSpeciesForLevel(
    level: number,
    allowEvolving = false,
    forTrainer = false,
    strength: PartyMemberStrength = PartyMemberStrength.WEAKER,
    encounterKind: EvoLevelThresholdKind = EvoLevelThresholdKind.NORMAL,
  ): SpeciesId {
    return determineEnemySpecies(this, level, allowEvolving, forTrainer, strength, encounterKind);
  }

  getEvolutionLevels(): EvolutionLevel[] {
    const evolutionLevels: EvolutionLevel[] = [];

    //console.log(Species[this.speciesId], pokemonEvolutions[this.speciesId])

    if (Object.hasOwn(pokemonEvolutions, this.speciesId)) {
      for (const e of pokemonEvolutions[this.speciesId]) {
        const speciesId = e.speciesId;
        const level = e.level;
        evolutionLevels.push([speciesId, level]);
        //console.log(Species[speciesId], getPokemonSpecies(speciesId), getPokemonSpecies(speciesId).getEvolutionLevels());
        const nextEvolutionLevels = getPokemonSpecies(speciesId).getEvolutionLevels();
        for (const npl of nextEvolutionLevels) {
          evolutionLevels.push(npl);
        }
      }
    }

    return evolutionLevels;
  }

  /**
   * Get all prevolution levels for this species
   *
   * @remarks
   * `withThresholds` is used to return the evolution level thresholds for the species, to be used
   * when generating
   *
   * @param withThresholds - Whether to include evolution level thresholds in the returned data; default `false`
   */
  getPrevolutionLevels(withThresholds: true): EvolutionLevelWithThreshold[];
  getPrevolutionLevels(withThresholds: false): EvolutionLevel[];
  getPrevolutionLevels(
    withThresholds?: boolean,
  ): typeof withThresholds extends false ? EvolutionLevel[] : EvolutionLevelWithThreshold[];
  getPrevolutionLevels(withThresholds = false): EvolutionLevelWithThreshold[] | EvolutionLevel[] {
    const prevolutionLevels: (EvolutionLevel | EvolutionLevelWithThreshold)[] = [];

    const allEvolvingPokemon = Object.keys(pokemonEvolutions);
    for (const p of allEvolvingPokemon) {
      const speciesId = Number.parseInt(p) as SpeciesId;
      for (const e of pokemonEvolutions[p]) {
        if (
          e.speciesId === this.speciesId
          && (this.forms.length === 0 || !e.evoFormKey || e.evoFormKey === this.forms[this.formIndex].formKey)
          && prevolutionLevels.every(pe => pe[0] !== speciesId)
        ) {
          const level = e.level;
          if (withThresholds && e.evoLevelThreshold) {
            prevolutionLevels.push([speciesId, level, e.evoLevelThreshold]);
          } else {
            prevolutionLevels.push([speciesId, level]);
          }
          const subPrevolutionLevels = getPokemonSpecies(speciesId).getPrevolutionLevels(withThresholds);
          for (const spl of subPrevolutionLevels) {
            prevolutionLevels.push(spl);
          }
        }
      }
    }

    return prevolutionLevels;
  }

  // This could definitely be written better and more accurate to the getSpeciesForLevel logic, but it is only for generating movesets for evolved Pokemon
  getSimulatedEvolutionChain(
    currentLevel: number,
    forTrainer = false,
    isBoss = false,
    player = false,
  ): EvolutionLevel[] {
    const ret: EvolutionLevel[] = [];
    if (Object.hasOwn(pokemonPrevolutions, this.speciesId)) {
      const prevolutionLevels = this.getPrevolutionLevels().reverse();
      const levelDiff = player ? 0 : forTrainer || isBoss ? (forTrainer && isBoss ? 2.5 : 5) : 10;
      ret.push([prevolutionLevels[0][0], 1]);
      for (let l = 1; l < prevolutionLevels.length; l++) {
        const evolution = pokemonEvolutions[prevolutionLevels[l - 1][0]].find(
          e => e.speciesId === prevolutionLevels[l][0],
        );
        ret.push([
          prevolutionLevels[l][0],
          Math.min(
            Math.max(
              evolution?.level!
                + Math.round(
                  randSeedGauss(0.5, 1 + levelDiff * 0.2)
                    * Math.max(evolution?.evoLevelThreshold?.[EvoLevelThresholdKind.WILD] ?? 0, 0.5)
                    * 5,
                )
                - 1,
              2,
              evolution?.level!,
            ),
            currentLevel - 1,
          ),
        ]); // TODO: are those bangs correct?
      }
      const lastPrevolutionLevel = ret[prevolutionLevels.length - 1][1];
      const evolution = pokemonEvolutions[prevolutionLevels.at(-1)![0]].find(e => e.speciesId === this.speciesId);
      ret.push([
        this.speciesId,
        Math.min(
          Math.max(
            lastPrevolutionLevel
              + Math.round(
                randSeedGauss(0.5, 1 + levelDiff * 0.2)
                  * Math.max(evolution?.evoLevelThreshold?.[EvoLevelThresholdKind.WILD] ?? 0, 0.5)
                  * 5,
              ),
            lastPrevolutionLevel + 1,
            evolution?.level!,
          ),
          currentLevel,
        ),
      ]); // TODO: are those bangs correct?
    } else {
      ret.push([this.speciesId, 1]);
    }

    return ret;
  }

  getCompatibleFusionSpeciesFilter(): PokemonSpeciesFilter {
    const hasEvolution = Object.hasOwn(pokemonEvolutions, this.speciesId);
    const hasPrevolution = Object.hasOwn(pokemonPrevolutions, this.speciesId);
    const subLegendary = this.subLegendary;
    const legendary = this.legendary;
    const mythical = this.mythical;
    return species => {
      return (
        (subLegendary
          || legendary
          || mythical
          || (Object.hasOwn(pokemonEvolutions, species.speciesId) === hasEvolution
            && Object.hasOwn(pokemonPrevolutions, species.speciesId) === hasPrevolution))
        && species.subLegendary === subLegendary
        && species.legendary === legendary
        && species.mythical === mythical
        && (this.isTrainerForbidden() || !species.isTrainerForbidden())
        && species.speciesId !== SpeciesId.DITTO
      );
    };
  }

  hasVariants() {
    let variantDataIndex: string | number = this.speciesId;
    if (this.forms.length > 0) {
      const formKey = this.forms[this.formIndex]?.formKey;
      if (formKey) {
        variantDataIndex = `${variantDataIndex}-${formKey}`;
      }
    }
    // ER-custom species (id ≥ 10000) render their shiny tiers from dedicated
    // sprite files (`_shiny` / `_shiny2` / `_shiny3`, via the ER species'
    // getSpriteId override) rather than the vanilla `variantData` colour-swap
    // registry — so they're absent from `variantData` and were wrongly pinned
    // to the STANDARD tier, never able to roll the higher RARE/EPIC shiny tiers
    // from eggs (an artificial block, not rarity). Mark them variant-capable so
    // the egg roll isn't forced to STANDARD; their own variant sprites then
    // render, and the colour-swap path simply no-ops (its callers guard on
    // `variantData[index]`).
    return (
      Object.hasOwn(variantData, variantDataIndex)
      || Object.hasOwn(variantData, this.speciesId)
      || this.speciesId >= 10000
    );
  }

  getFormSpriteKey(formIndex?: number) {
    if (this.forms.length > 0 && formIndex !== undefined && formIndex >= this.forms.length) {
      console.warn(
        `Attempted accessing form with index ${formIndex} of species ${this.getName()} with only ${this.forms.length || 0} forms`,
      );
      formIndex = Math.min(formIndex, this.forms.length - 1);
    }
    return this.forms?.length > 0 ? this.forms[formIndex || 0].getFormSpriteKey() : "";
  }

  /**
   * Generates a {@linkcode BigInt} corresponding to the maximum unlocks possible for this species,
   * taking into account if the species has a male/female gender, and which variants are implemented.
   * @returns The maximum unlocks for the species as a `BigInt`; can be compared with {@linkcode DexEntry.caughtAttr}.
   */
  getFullUnlocksData(): bigint {
    let caughtAttr = 0n;
    caughtAttr += DexAttr.NON_SHINY;
    caughtAttr += DexAttr.SHINY;
    if (this.malePercent !== null) {
      if (this.malePercent > 0) {
        caughtAttr += DexAttr.MALE;
      }
      if (this.malePercent < 100) {
        caughtAttr += DexAttr.FEMALE;
      }
    }
    caughtAttr += DexAttr.DEFAULT_VARIANT;
    if (this.hasVariants()) {
      caughtAttr += DexAttr.VARIANT_2;
      caughtAttr += DexAttr.VARIANT_3;
    }

    // Summing successive bigints for each obtainable form
    caughtAttr +=
      this?.forms?.length > 1
        ? this.forms
            .map((f, index) => (f.isUnobtainable ? 0n : 128n * 2n ** BigInt(index)))
            .reduce((acc, val) => acc + val, 0n)
        : DexAttr.DEFAULT_FORM;

    return caughtAttr;
  }
}

export class PokemonForm extends PokemonSpeciesForm {
  public formName: string;
  public formKey: string;
  public formSpriteKey: string | null;
  public isUnobtainable: boolean;

  // This is a collection of form keys that have in-run form changes, but should still be separately selectable from the start screen
  private starterSelectableKeys: string[] = [
    "10",
    "50",
    "10-pc",
    "50-pc",
    "red",
    "orange",
    "yellow",
    "green",
    "blue",
    "indigo",
    "violet",
  ];

  constructor(
    formName: string,
    formKey: string,
    type1: PokemonType,
    type2: PokemonType | null,
    height: number,
    weight: number,
    ability1: AbilityId,
    ability2: AbilityId,
    abilityHidden: AbilityId,
    baseTotal: number,
    baseHp: number,
    baseAtk: number,
    baseDef: number,
    baseSpatk: number,
    baseSpdef: number,
    baseSpd: number,
    catchRate: number,
    baseFriendship: number,
    baseExp: number,
    genderDiffs = false,
    formSpriteKey: string | null = null,
    isStarterSelectable = false,
    isUnobtainable = false,
  ) {
    super(
      type1,
      type2,
      height,
      weight,
      ability1,
      ability2,
      abilityHidden,
      baseTotal,
      baseHp,
      baseAtk,
      baseDef,
      baseSpatk,
      baseSpdef,
      baseSpd,
      catchRate,
      baseFriendship,
      baseExp,
      genderDiffs,
      isStarterSelectable || !formKey,
    );
    this.formName = formName;
    this.formKey = formKey;
    this.formSpriteKey = formSpriteKey;
    this.isUnobtainable = isUnobtainable;
  }

  getFormSpriteKey(_formIndex?: number) {
    return this.formSpriteKey === null ? this.formKey : this.formSpriteKey;
  }
}
