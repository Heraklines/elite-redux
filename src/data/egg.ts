import type { BattleScene } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import {
  BOOSTED_RARE_EGGMOVE_RATES,
  EGG_PITY_EPIC_THRESHOLD,
  EGG_PITY_LEGENDARY_THRESHOLD,
  EGG_PITY_RARE_THRESHOLD,
  GACHA_DEFAULT_SHINY_RATE,
  GACHA_LEGENDARY_UP_THRESHOLD_OFFSET,
  GACHA_SHINY_UP_SHINY_RATE,
  HATCH_WAVES_COMMON_EGG,
  HATCH_WAVES_EPIC_EGG,
  HATCH_WAVES_LEGENDARY_EGG,
  HATCH_WAVES_MANAPHY_EGG,
  HATCH_WAVES_RARE_EGG,
  RARE_EGGMOVE_RATES,
  SAME_SPECIES_EGG_SHINY_RATE,
  SHINY_EPIC_CHANCE,
  SHINY_VARIANT_CHANCE,
} from "#balance/rates";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { coopGateAccountWrite } from "#data/elite-redux/coop/coop-account-gate";
import { erBalanceArr, erBalanceMap, erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import { maybeUpgradeToErBlackShiny } from "#data/elite-redux/er-black-shinies";
import { getErEggWeightDivisor } from "#data/elite-redux/init-elite-redux-egg-tiers";
import type { PokemonSpecies } from "#data/pokemon-species";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { SpeciesId } from "#enums/species-id";
import { VariantTier } from "#enums/variant-tier";
import type { PlayerPokemon } from "#field/pokemon";
import { getIvsFromId, randInt, randomString, randSeedInt } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

export const EGG_SEED = 1073741824;

/**
 * CO-OP (lockstep) determinism (#633): per-wave monotonic counter so multiple eggs
 * created in the SAME wave get DISTINCT-but-deterministic seeds. Both clients run the
 * full engine in step and create the same eggs in the same order within a wave, so this
 * counter advances identically on both. Keyed to the current shared `waveSeed`; resets
 * when the wave (and therefore the seed) changes. Untouched in solo / authoritative.
 */
let coopEggSeqWaveSeed: string | undefined;
let coopEggSeqCounter = 0;

/**
 * The next deterministic per-egg offset for the current wave, derived purely from shared
 * state (the wave seed gates the reset; the counter is the in-wave egg index). Identical
 * on both lockstep clients. Co-op only - never called on the solo / authoritative path.
 */
function nextCoopEggSeqOffset(): number {
  const waveSeed = globalScene.waveSeed;
  if (coopEggSeqWaveSeed !== waveSeed) {
    coopEggSeqWaveSeed = waveSeed;
    coopEggSeqCounter = 0;
  }
  return coopEggSeqCounter++;
}

/**
 * ER Redux Up gacha (#409): per-species weight multiplier applied to ER customs
 * (speciesId >= 10000) when rolling species for an egg pulled from the Redux Up
 * machine. With ~100+ customs spread across the tiers this makes the large
 * majority of Redux Up pulls hatch ER content while vanilla stays possible.
 */
export const ER_REDUX_GACHA_WEIGHT_MULTIPLIER = 10;

/** Maximum number of unhatched eggs the player can hold at once. */
export const MAX_EGG_COUNT = 10_000;

/** Egg options to override egg properties */
export interface IEggOptions {
  /** ID. Used to check if egg type will be manaphy (`id % 204 === 0`) */
  id?: number;
  /** Timestamp when this egg got created */
  timestamp?: number;
  /**
   * Defines if the egg got pulled from a gacha or not. If true, egg pity and pull statistics will be applied.
   * Egg will be automaticly added to the game data.
   */
  pulled?: boolean;
  /**
   * Defines where the egg comes from. Applies specific modifiers.
   * Will also define the text displayed in the egg list.
   */
  sourceType?: EggSourceType;
  /** Legacy field, kept for backwards-compatibility */
  scene?: BattleScene;
  /**
   * Sets the tier of the egg. Only species of this tier can be hatched from this egg.
   * Tier will be overriden if species `eggOption` is set.
   */
  tier?: EggTier;
  /** Sets how many waves it will take till this egg hatches. */
  hatchWaves?: number;
  /** Sets the exact species that will hatch from this egg. */
  species?: SpeciesId;
  /** Defines if the hatched pokemon will be a shiny. */
  isShiny?: boolean;
  /** Defines the variant of the pokemon that will hatch from this egg. If no `variantTier` is given the normal variant rates will apply. */
  variantTier?: VariantTier;
  /** Defines which egg move will be unlocked. `3` = rare egg move. */
  eggMoveIndex?: number;
  /**
   * Defines if the egg will hatch with the hidden ability of this species.
   * If no hidden ability exist, a random one will get choosen.
   */
  overrideHiddenAbility?: boolean;
  /** Can customize the message displayed for where the egg was obtained */
  eggDescriptor?: string;
}

export class Egg {
  ////
  // #region Private properties
  ////

  private _id: number;
  private _tier: EggTier;
  private _sourceType: EggSourceType | undefined;
  private _hatchWaves: number;
  private _timestamp: number;

  private _species: SpeciesId;
  private _isShiny: boolean;
  private _variantTier: VariantTier;
  private _eggMoveIndex: number;

  private _overrideHiddenAbility: boolean;

  private eggDescriptor?: string | undefined;

  ////
  // #endregion
  ////

  ////
  // #region Public facing properties
  ////
  get id(): number {
    return this._id;
  }

  get tier(): EggTier {
    return this._tier;
  }

  // TODO: This is exposed solely inside egg data, remove
  get sourceType(): EggSourceType | undefined {
    return this._sourceType;
  }

  // TODO: Just make the property public atp
  get hatchWaves(): number {
    return this._hatchWaves;
  }

  set hatchWaves(value: number) {
    this._hatchWaves = value;
  }

  get timestamp(): number {
    return this._timestamp;
  }

  // TODO: This is exposed solely inside egg data, remove
  get species(): SpeciesId {
    return this._species;
  }

  // TODO: This is exposed solely inside egg data, remove
  get isShiny(): boolean {
    return this._isShiny;
  }

  // TODO: This is exposed solely inside egg data, remove
  get variantTier(): VariantTier {
    return this._variantTier;
  }

  get eggMoveIndex(): number {
    return this._eggMoveIndex;
  }

  // TODO: This is exposed solely inside egg data, remove
  get overrideHiddenAbility(): boolean {
    return this._overrideHiddenAbility;
  }

  ////
  // #endregion
  ////

  constructor(eggOptions?: IEggOptions) {
    // CO-OP (lockstep) determinism (#633): in solo, the egg id (randInt) and the property
    // seed (randomString) are UNSEEDED (Math.random), so the two clients would generate
    // DIFFERENT eggs (species/shiny/variant/id) on the shared trainer-win path -> gameData
    // divergence. In co-op we derive BOTH from the SHARED wave seed so both clients produce
    // byte-identical eggs. Solo / authoritative are byte-for-byte unchanged.
    const isCoop = globalScene.gameMode.isCoop;
    const coopSeqOffset = isCoop ? nextCoopEggSeqOffset() : 0;

    const generateEggProperties = (eggOptions?: IEggOptions) => {
      //if (eggOptions.tier && eggOptions.species) throw Error("Error egg can't have species and tier as option. only choose one of them.")

      this._sourceType = eggOptions?.sourceType!; // TODO: is this bang correct?
      // Ensure _sourceType is defined before invoking rollEggTier(), as it is referenced
      this._tier = eggOptions?.tier ?? Overrides.EGG_TIER_OVERRIDE ?? this.rollEggTier();
      // If egg was pulled, check if egg pity needs to override the egg tier
      if (eggOptions?.pulled) {
        // Needs this._tier and this._sourceType to work
        this.checkForPityTierOverrides();
      }

      // In co-op the property block runs under the deterministic wave-seed override below, so
      // a SEEDED id draw (randSeedInt) is identical on both clients; solo keeps the original
      // unseeded randInt so its id space is byte-for-byte unchanged. Both span the same range
      // [EGG_SEED * tier, EGG_SEED * tier + EGG_SEED): randInt(range, min) and
      // randSeedInt(range, min) share the (range, min) convention.
      this._id =
        eggOptions?.id
        ?? (isCoop ? randSeedInt(EGG_SEED, EGG_SEED * this._tier) : randInt(EGG_SEED, EGG_SEED * this._tier));

      this._sourceType = eggOptions?.sourceType ?? undefined;
      this._hatchWaves = eggOptions?.hatchWaves ?? this.getEggTierDefaultHatchWaves();
      this._timestamp = eggOptions?.timestamp ?? Date.now();

      // First roll shiny and variant so we can filter if species with an variant exist
      this._isShiny = eggOptions?.isShiny ?? (Overrides.EGG_SHINY_OVERRIDE || this.rollShiny());
      this._variantTier = eggOptions?.variantTier ?? Overrides.EGG_VARIANT_OVERRIDE ?? this.rollVariant();
      this._species = eggOptions?.species ?? this.rollSpecies()!; // TODO: Is this bang correct?

      this._overrideHiddenAbility = eggOptions?.overrideHiddenAbility ?? false;

      // Override egg tier and hatchwaves if species was given
      if (eggOptions?.species) {
        this._tier = this.getEggTier();
        this._hatchWaves = eggOptions.hatchWaves ?? this.getEggTierDefaultHatchWaves();
      }
      // If species has no variant, set variantTier to common. This needs to
      // be done because species with no variants get filtered at rollSpecies but if the
      // species is set via options or the legendary gacha pokemon gets choosen the check never happens
      if (this._species && !getPokemonSpecies(this._species).hasVariants()) {
        this._variantTier = VariantTier.STANDARD;
      }
      // Needs this._tier so it needs to be generated afer the tier override if bought from same species
      this._eggMoveIndex = eggOptions?.eggMoveIndex ?? this.rollEggMoveIndex();
      if (eggOptions?.pulled) {
        this.increasePullStatistic();
        this.addEggToGameData();
      }
    };

    // CO-OP: derive the property seed deterministically from the SHARED wave seed + the
    // per-wave egg sequence offset (a seeded randomString drawn under the wave seed), so both
    // clients seed the property block identically. SOLO / AUTHORITATIVE keep the unseeded
    // Math.random seed (byte-for-byte unchanged).
    let seedOverride = randomString(24);
    if (isCoop) {
      globalScene.executeWithSeedOffset(
        () => {
          seedOverride = randomString(24, true);
        },
        coopSeqOffset,
        globalScene.waveSeed,
      );
    }
    globalScene.executeWithSeedOffset(
      () => {
        generateEggProperties(eggOptions);
      },
      0,
      seedOverride,
    );

    this.eggDescriptor = eggOptions?.eggDescriptor;
  }

  ////
  // #region Public methods
  ////

  public isManaphyEgg(): boolean {
    return (
      this._species === SpeciesId.PHIONE
      || this._species === SpeciesId.MANAPHY
      || (this._tier === EggTier.COMMON && !(this._id % 204) && !this._species)
    );
  }

  public getKey(): string {
    if (this.isManaphyEgg()) {
      return "manaphy";
    }
    return this._tier.toString();
  }

  // Generates a PlayerPokemon from an egg
  public generatePlayerPokemon(): PlayerPokemon {
    let ret: PlayerPokemon;

    const generatePlayerPokemonHelper = () => {
      // Legacy egg wants to hatch. Generate missing properties
      if (!this._species) {
        this._isShiny = this.rollShiny();
        this._species = this.rollSpecies()!; // TODO: is this bang correct?
      }

      let pokemonSpecies = getPokemonSpecies(this._species);
      // Special condition to have Phione eggs also have a chance of generating Manaphy
      if (this._species === SpeciesId.PHIONE && this._sourceType === EggSourceType.SAME_SPECIES_EGG) {
        pokemonSpecies = getPokemonSpecies(
          randSeedInt(erBalanceNum("vanilla.eggs.manaphyRate")) ? SpeciesId.PHIONE : SpeciesId.MANAPHY,
        );
      }
      // ER safety net: eggs must always hatch a BASE form. Stale eggs created
      // before the egg pool excluded evolved ER customs may have stored an
      // evolved species (e.g. Infernape Redux); traverse to its root so it
      // hatches the proper base form (which has valid abilities/passives).
      const rootSpeciesId = pokemonSpecies.getRootSpeciesId();
      if (rootSpeciesId !== pokemonSpecies.speciesId) {
        pokemonSpecies = getPokemonSpecies(rootSpeciesId);
        this._species = rootSpeciesId;
      }

      // Sets the hidden ability if a hidden ability exists and
      // the override is set or the egg hits the chance
      let abilityIndex: number | undefined;
      // Editor-tunable HA odds (vanilla.eggs.haRate).
      const haRates = erBalanceMap("vanilla.eggs.haRate");
      const sameSpeciesEggHACheck =
        this._sourceType === EggSourceType.SAME_SPECIES_EGG && !randSeedInt(haRates.sameSpecies);
      const gachaEggHACheck = !(this._sourceType === EggSourceType.SAME_SPECIES_EGG) && !randSeedInt(haRates.gacha);
      if (pokemonSpecies.abilityHidden && (this._overrideHiddenAbility || sameSpeciesEggHACheck || gachaEggHACheck)) {
        abilityIndex = 2;
      }

      // This function has way to many optional parameters
      ret = globalScene.addPlayerPokemon(pokemonSpecies, 1, abilityIndex, undefined, undefined, false);
      ret.shiny = this._isShiny;
      ret.variant = this._variantTier;
      // ER Black Shinies (#349): an EPIC egg hatch rolls the 1/50 t4 upgrade
      // (this is the "hatch 1k-10k eggs" acquisition path).
      maybeUpgradeToErBlackShiny(ret);

      const secondaryIvs = getIvsFromId(randSeedInt(4294967295));

      for (let s = 0; s < ret.ivs.length; s++) {
        ret.ivs[s] = Math.max(ret.ivs[s], secondaryIvs[s]);
      }
    };

    ret = ret!; // Tell TS compiler it's defined now
    globalScene.executeWithSeedOffset(
      () => {
        generatePlayerPokemonHelper();
      },
      this._id,
      EGG_SEED.toString(),
    );

    return ret;
  }

  // Doesn't need to be called if the egg got pulled by a gacha machiene
  public addEggToGameData(): void {
    if (!coopGateAccountWrite(globalScene.gameMode?.isCoop === true, `addEgg id=${this.id}`)) {
      return;
    }
    globalScene.gameData.eggs.push(this);
  }

  /** Idempotent materialization for replayable authoritative account grants. */
  public addEggToGameDataOnce(): void {
    if (globalScene.gameData.eggs.some(egg => egg.id === this.id && egg.timestamp === this.timestamp)) {
      return;
    }
    this.addEggToGameData();
  }

  public getEggDescriptor(): string {
    if (this.isManaphyEgg()) {
      return i18next.t("egg:manaphyTier");
    }
    switch (this.tier) {
      case EggTier.RARE:
        return i18next.t("egg:greatTier");
      case EggTier.EPIC:
        return i18next.t("egg:ultraTier");
      case EggTier.LEGENDARY:
        return i18next.t("egg:masterTier");
      default:
        return i18next.t("egg:defaultTier");
    }
  }

  public getEggHatchWavesMessage(): string {
    // ER (#378): always append the CONCRETE remaining wave count - the vague
    // flavor text alone ("doesn't seem close to hatching") tells the player
    // nothing actionable.
    const remaining = i18next.t("egg:hatchWavesRemaining", { count: this.hatchWaves });
    if (this.hatchWaves <= 5) {
      return i18next.t("egg:hatchWavesMessageSoon") + remaining;
    }
    if (this.hatchWaves <= 15) {
      return i18next.t("egg:hatchWavesMessageClose") + remaining;
    }
    if (this.hatchWaves <= 50) {
      return i18next.t("egg:hatchWavesMessageNotClose") + remaining;
    }
    return i18next.t("egg:hatchWavesMessageLongTime") + remaining;
  }

  public getEggTypeDescriptor(): string {
    switch (this.sourceType) {
      case EggSourceType.SAME_SPECIES_EGG:
        return (
          this.eggDescriptor
          ?? i18next.t("egg:sameSpeciesEgg", {
            species: getPokemonSpecies(this._species).getName(),
          })
        );
      case EggSourceType.GACHA_LEGENDARY:
        return (
          this.eggDescriptor
          ?? `${i18next.t("egg:gachaTypeLegendary")} (${getPokemonSpecies(getLegendaryGachaSpeciesForTimestamp(this.timestamp)).getName()})`
        );
      case EggSourceType.GACHA_SHINY:
        return this.eggDescriptor ?? i18next.t("egg:gachaTypeShiny");
      case EggSourceType.GACHA_MOVE:
        return this.eggDescriptor ?? i18next.t("egg:gachaTypeMove");
      case EggSourceType.GACHA_REDUX:
        return this.eggDescriptor ?? i18next.t("egg:gachaTypeRedux", { defaultValue: "Redux Rate Up" });
      case EggSourceType.EVENT:
        return this.eggDescriptor ?? i18next.t("egg:eventType");
      default:
        console.warn("getEggTypeDescriptor case not defined. Returning default empty string");
        return "";
    }
  }

  ////
  // #endregion
  ////

  ////
  // #region Private methods
  ////

  /**
   * Rolls which egg move slot the egg will have.
   * 1/x chance for rare, (x-1)/3 chance for each common move.
   * x is determined by Egg Tier. Boosted rates used for eggs obtained through Move Up Gacha and Candy.
   * @returns the slot for the egg move
   */
  private rollEggMoveIndex() {
    const tierNum = this.isManaphyEgg() ? 2 : this.tier;
    let baseChance: number;
    // Editor-tunable (vanilla.eggs.rareEggMoveRates / boostedRareEggMoveRates).
    if (this._sourceType === EggSourceType.SAME_SPECIES_EGG || this._sourceType === EggSourceType.GACHA_MOVE) {
      baseChance = erBalanceArr("vanilla.eggs.boostedRareEggMoveRates")[tierNum] ?? BOOSTED_RARE_EGGMOVE_RATES[tierNum];
    } else {
      baseChance = erBalanceArr("vanilla.eggs.rareEggMoveRates")[tierNum] ?? RARE_EGGMOVE_RATES[tierNum];
    }

    return randSeedInt(baseChance) ? randSeedInt(3) : 3;
  }

  private getEggTierDefaultHatchWaves(eggTier?: EggTier): number {
    // Editor-tunable (vanilla.eggs.hatchWaves).
    const hatchWaves = erBalanceMap("vanilla.eggs.hatchWaves");
    if (this._species === SpeciesId.PHIONE || this._species === SpeciesId.MANAPHY) {
      return hatchWaves.manaphy ?? HATCH_WAVES_MANAPHY_EGG;
    }

    switch (eggTier ?? this._tier) {
      case EggTier.COMMON:
        return hatchWaves.common ?? HATCH_WAVES_COMMON_EGG;
      case EggTier.RARE:
        return hatchWaves.rare ?? HATCH_WAVES_RARE_EGG;
      case EggTier.EPIC:
        return hatchWaves.epic ?? HATCH_WAVES_EPIC_EGG;
    }
    return hatchWaves.legendary ?? HATCH_WAVES_LEGENDARY_EGG;
  }

  private rollEggTier(): EggTier {
    const tierValueOffset =
      this._sourceType === EggSourceType.GACHA_LEGENDARY ? GACHA_LEGENDARY_UP_THRESHOLD_OFFSET : 0;
    // Editor-tunable thresholds [common, rare, epic] (vanilla.eggs.gachaThresholds),
    // validated to be descending so the tier logic can never invert.
    const [commonThreshold, rareThreshold, epicThreshold] = erBalanceArr("vanilla.eggs.gachaThresholds");
    const tierValue = randInt(256);
    return tierValue >= commonThreshold + tierValueOffset
      ? EggTier.COMMON
      : tierValue >= rareThreshold + tierValueOffset
        ? EggTier.RARE
        : tierValue >= epicThreshold + tierValueOffset
          ? EggTier.EPIC
          : EggTier.LEGENDARY;
  }

  private rollSpecies(): SpeciesId | null {
    if (!globalScene) {
      return null;
    }
    /**
     * Manaphy eggs have a 1/8 chance of being Manaphy and 7/8 chance of being Phione
     * Legendary eggs pulled from the legendary gacha have a 50% of being converted into
     * the species that was the legendary focus at the time
     */
    if (this.isManaphyEgg()) {
      /**
       * Adding a technicality to make unit tests easier: By making this check pass
       * when Utils.randSeedInt(8) = 1, and by making the generatePlayerPokemon() species
       * check pass when Utils.randSeedInt(8) = 0, we can tell them apart during tests.
       */
      const rand = randSeedInt(erBalanceNum("vanilla.eggs.manaphyRate")) !== 1;
      return rand ? SpeciesId.PHIONE : SpeciesId.MANAPHY;
    }
    if (this.tier === EggTier.LEGENDARY && this._sourceType === EggSourceType.GACHA_LEGENDARY && !randSeedInt(2)) {
      return getLegendaryGachaSpeciesForTimestamp(this.timestamp);
    }

    let minStarterValue: number;
    let maxStarterValue: number;

    switch (this.tier) {
      case EggTier.RARE:
        minStarterValue = 4;
        maxStarterValue = 5;
        break;
      case EggTier.EPIC:
        minStarterValue = 6;
        maxStarterValue = 7;
        break;
      case EggTier.LEGENDARY:
        minStarterValue = 8;
        maxStarterValue = 9;
        break;
      default:
        minStarterValue = 1;
        maxStarterValue = 3;
        break;
    }

    const ignoredSpecies = [SpeciesId.PHIONE, SpeciesId.MANAPHY, SpeciesId.ETERNATUS];

    let speciesPool = Object.keys(speciesEggTiers)
      .filter(s => speciesEggTiers[s] === this.tier)
      .map(s => Number.parseInt(s) as SpeciesId)
      .filter(
        s =>
          !Object.hasOwn(pokemonPrevolutions, s)
          && ignoredSpecies.indexOf(s) === -1 // Defense in depth: never let a dangling egg-tier id (one that does not // resolve to a registered species) reach the variant filter / weight // loop below, where it would deref undefined and freeze the hatch.
          && !!getPokemonSpecies(s),
      );

    // If this is the 10th egg without unlocking something new, attempt to force it.
    // CO-OP (lockstep) determinism (#633): this narrowing reads PER-ACCOUNT
    // unlockPity/dexData/eggs, so it would shrink/reorder the species pool differently on
    // the two clients and make the SAME shared seeded `rand` resolve to a DIFFERENT species
    // -> gameData divergence on the trainer-win egg path. In co-op we skip the narrowing so
    // both clients roll over the IDENTICAL full shared-tier pool. The per-account pity
    // MUTATION below is untouched (it only biases FUTURE rolls, never this egg's species).
    // Solo is byte-for-byte unchanged. Cost: co-op loses the rare 10th-egg "force a new
    // unlock" nudge - an acceptable trade for a non-desyncing run.
    if (!globalScene.gameMode.isCoop && globalScene.gameData.unlockPity[this.tier] >= 9) {
      const lockedPool = speciesPool.filter(
        s => !globalScene.gameData.dexData[s].caughtAttr && !globalScene.gameData.eggs.some(e => e.species === s),
      );
      if (lockedPool.length > 0) {
        // Skip this if everything is unlocked
        speciesPool = lockedPool;
      }
    }

    // If egg variant is set to RARE or EPIC, filter species pool to only include ones with variants.
    if (this.variantTier && (this.variantTier === VariantTier.RARE || this.variantTier === VariantTier.EPIC)) {
      speciesPool = speciesPool.filter(s => getPokemonSpecies(s).hasVariants());
    }

    /**
     * Pokemon that are cheaper in their tier get a weight boost.
     * 1 cost mons get 2x
     * 2 cost mons get 1.5x
     * 4, 6, 8 cost mons get 1.75x
     * 3, 5, 7, 9 cost mons get 1x
     * Alolan, Galarian, Hisui, and Paldean mons get 0.5x
     *
     * The total weight is also being calculated EACH time there is an egg hatch instead of being generated once
     * and being the same each time
     */
    let totalWeight = 0;
    const speciesWeights = new Array<number>(speciesPool.length);
    for (const [idx, speciesId] of speciesPool.entries()) {
      // Accounts for species that have starter costs outside of the normal range for their EggTier
      const speciesCostClamped = Phaser.Math.Clamp(speciesStarterCosts[speciesId], minStarterValue, maxStarterValue);
      let weight = Math.floor(
        (((maxStarterValue - speciesCostClamped) / (maxStarterValue - minStarterValue + 1)) * 1.5 + 1) * 100,
      );
      // ER: Unown is a 1-cost mon, so the cheap-mon weight boost made it dominate
      // egg pulls (and it has 28 letter-forms on top). Knock its weight down to
      // ~1/10 so it's a rare novelty pull rather than the default hatch.
      if (speciesId === SpeciesId.UNOWN) {
        weight = Math.max(1, Math.floor(weight * 0.1));
      }
      // ER: multi-form families (Arceus's type plates, Silvally, Ogerpon masks,
      // Therian forms, …) ship as many separate egg-pool species, so without
      // this they'd collectively appear N× and swamp the pool. Divide each
      // form's weight by its family size so the whole family totals ≈ one mon.
      weight = Math.max(1, Math.floor(weight / getErEggWeightDivisor(speciesId)));
      // ER Redux Up gacha (#409): eggs pulled from the 4th machine heavily
      // favor ER customs (id >= 10000) within the rolled tier.
      if (this._sourceType === EggSourceType.GACHA_REDUX && speciesId >= 10000) {
        weight *= ER_REDUX_GACHA_WEIGHT_MULTIPLIER;
      }
      speciesWeights[idx] = totalWeight + weight;
      totalWeight += weight;
    }

    let species: SpeciesId;

    const rand = randSeedInt(totalWeight);
    for (let s = 0; s < speciesWeights.length; s++) {
      if (rand < speciesWeights[s]) {
        species = speciesPool[s];
        break;
      }
    }
    species = species!; // tell TS compiled it's defined now!

    if (
      globalScene.gameData.dexData[species].caughtAttr
      || globalScene.gameData.eggs.some(e => e.species === species)
    ) {
      globalScene.gameData.unlockPity[this.tier] = Math.min(globalScene.gameData.unlockPity[this.tier] + 1, 10);
    } else {
      globalScene.gameData.unlockPity[this.tier] = 0;
    }

    return species;
  }

  /**
   * Rolls whether the egg is shiny or not.
   * @returns `true` if the egg is shiny
   */
  private rollShiny(): boolean {
    // Editor-tunable per-source odds (vanilla.eggs.shinyRate).
    const shinyRates = erBalanceMap("vanilla.eggs.shinyRate");
    let shinyChance = shinyRates.gachaDefault ?? GACHA_DEFAULT_SHINY_RATE;
    switch (this._sourceType) {
      case EggSourceType.GACHA_SHINY:
        shinyChance = shinyRates.gachaShinyUp ?? GACHA_SHINY_UP_SHINY_RATE;
        break;
      case EggSourceType.SAME_SPECIES_EGG:
        shinyChance = shinyRates.sameSpecies ?? SAME_SPECIES_EGG_SHINY_RATE;
        break;
      default:
        break;
    }

    return !randSeedInt(shinyChance);
  }

  // Uses the same logic as pokemon.generateVariant(). I would like to only have this logic in one
  // place but I don't want to touch the pokemon class.
  // TODO: Remove this or replace the one in the Pokemon class.
  private rollVariant(): VariantTier {
    if (!this.isShiny) {
      return VariantTier.STANDARD;
    }

    const rand = randSeedInt(10);
    if (rand >= SHINY_VARIANT_CHANCE) {
      return VariantTier.STANDARD; // 6/10
    }
    if (rand >= SHINY_EPIC_CHANCE) {
      return VariantTier.RARE; // 3/10
    }
    return VariantTier.EPIC; // 1/10
  }

  private checkForPityTierOverrides(): void {
    const tierValueOffset =
      this._sourceType === EggSourceType.GACHA_LEGENDARY ? GACHA_LEGENDARY_UP_THRESHOLD_OFFSET : 0;
    globalScene.gameData.eggPity[EggTier.RARE] += 1;
    globalScene.gameData.eggPity[EggTier.EPIC] += 1;
    globalScene.gameData.eggPity[EggTier.LEGENDARY] += 1 + tierValueOffset;
    // These numbers are roughly the 80% mark. That is, 80% of the time you'll get an egg before this gets triggered.
    // Editor-tunable pity thresholds (vanilla.eggs.pity).
    const pity = erBalanceMap("vanilla.eggs.pity");
    if (
      globalScene.gameData.eggPity[EggTier.LEGENDARY] >= (pity.legendary ?? EGG_PITY_LEGENDARY_THRESHOLD)
      && this._tier === EggTier.COMMON
    ) {
      this._tier = EggTier.LEGENDARY;
    } else if (
      globalScene.gameData.eggPity[EggTier.EPIC] >= (pity.epic ?? EGG_PITY_EPIC_THRESHOLD)
      && this._tier === EggTier.COMMON
    ) {
      this._tier = EggTier.EPIC;
    } else if (
      globalScene.gameData.eggPity[EggTier.RARE] >= (pity.rare ?? EGG_PITY_RARE_THRESHOLD)
      && this._tier === EggTier.COMMON
    ) {
      this._tier = EggTier.RARE;
    }
    globalScene.gameData.eggPity[this._tier] = 0;
  }

  private increasePullStatistic(): void {
    globalScene.gameData.gameStats.eggsPulled++;
    if (this.isManaphyEgg()) {
      globalScene.gameData.gameStats.manaphyEggsPulled++;
      this._hatchWaves = this.getEggTierDefaultHatchWaves(EggTier.EPIC);
      return;
    }
    switch (this.tier) {
      case EggTier.RARE:
        globalScene.gameData.gameStats.rareEggsPulled++;
        break;
      case EggTier.EPIC:
        globalScene.gameData.gameStats.epicEggsPulled++;
        break;
      case EggTier.LEGENDARY:
        globalScene.gameData.gameStats.legendaryEggsPulled++;
        break;
    }
  }

  private getEggTier(): EggTier {
    return speciesEggTiers[this.species] ?? EggTier.COMMON;
  }

  ////
  // #endregion
  ////
}

export function getValidLegendaryGachaSpecies(): SpeciesId[] {
  return Object.entries(speciesEggTiers)
    .filter(s => s[1] === EggTier.LEGENDARY)
    .map(s => Number.parseInt(s[0]))
    .filter(s => s !== SpeciesId.ETERNATUS);
}

export function getLegendaryGachaSpeciesForTimestamp(timestamp: number): SpeciesId {
  const legendarySpecies = getValidLegendaryGachaSpecies();

  let ret: SpeciesId;

  // 86400000 is the number of miliseconds in one day
  const timeDate = new Date(timestamp);
  const dayTimestamp = timeDate.getTime(); // Timestamp of current week
  const offset = Math.floor(Math.floor(dayTimestamp / 86400000) / legendarySpecies.length); // Cycle number
  const index = Math.floor(dayTimestamp / 86400000) % legendarySpecies.length; // Index within cycle

  globalScene.executeWithSeedOffset(
    () => {
      ret = Phaser.Math.RND.shuffle(legendarySpecies)[index];
    },
    offset,
    EGG_SEED.toString(),
  );
  ret = ret!; // tell TS compiler it's

  return ret;
}

/**
 * Check for a given species EggTier Value
 * @param pokemonSpecies - Species for wich we will check the egg tier it belongs to
 * @returns The egg tier of a given pokemon species
 */
export function getEggTierForSpecies(pokemonSpecies: PokemonSpecies): EggTier {
  return speciesEggTiers[pokemonSpecies.getRootSpeciesId()];
}
