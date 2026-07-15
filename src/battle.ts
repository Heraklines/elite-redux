import type { GameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import {
  type BattleArrangement,
  type BattleFormat,
  createArrangement,
  legacyFormat,
  SINGLE_FORMAT,
} from "#data/battle-format";
import { erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import { erNotorietyOverLevel } from "#data/elite-redux/er-biome-notoriety";
import { erBiomeRoutingActive } from "#data/elite-redux/er-biome-routing";
import { getErBiomeRule } from "#data/elite-redux/er-biome-rules";
import { erGauntletActive, erGauntletWaveKind } from "#data/elite-redux/er-mystery-gauntlet";
import { applyErHellEnemyLevelScaling } from "#data/elite-redux/er-run-difficulty";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
import type { BattlerIndex } from "#enums/battler-index";
import { BiomeId } from "#enums/biome-id";
import type { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import type { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { PokeballType } from "#enums/pokeball";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { EnemyPokemon, PlayerPokemon, Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { MoneyMultiplierModifier, type PokemonHeldItemModifier } from "#modifiers/modifier";
import type { CustomModifierSettings } from "#modifiers/modifier-type";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MusicPreference } from "#system/settings";
import { trainerConfigs } from "#trainers/trainer-config";
import type { NewBattleResolvedProps } from "#types/new-battle-props";
import type { TurnMove } from "#types/turn-move";
import {
  isBetween,
  NumberHolder,
  randomString,
  randSeedFloat,
  randSeedInt,
  randSeedItem,
  shiftCharCodes,
} from "#utils/common";
import { randSeedUniqueItem } from "#utils/random";
import i18next from "i18next";

export interface TurnCommand {
  command: Command;
  cursor?: number | undefined;
  move?: TurnMove;
  targets?: BattlerIndex[];
  skip?: boolean;
  args?: any[];
}

export interface FaintLogEntry {
  pokemon: Pokemon;
  turn: number;
}

interface TurnCommands {
  [key: number]: TurnCommand | null;
}

export class Battle {
  protected gameMode: GameMode;
  public waveIndex: number;
  public battleType: BattleType;
  public trainer: Trainer | null;
  public enemyLevels: number[] | undefined;
  public enemyParty: EnemyPokemon[] = [];
  public seenEnemyPartyMemberIds: Set<number> = new Set<number>();
  /**
   * The battle FORMAT (sides x capacity + adjacency). Source of truth for "how many
   * per side"; the legacy `double` boolean is a derived view. Defaults to single until
   * the constructor/{@linkcode setFormat} runs. See {@linkcode "#data/battle-format"}.
   */
  private _format: BattleFormat = SINGLE_FORMAT;
  private _arrangement: BattleArrangement = createArrangement(SINGLE_FORMAT);
  public started = false;
  public enemySwitchCounter = 0;
  public turn = 0;
  public preTurnCommands: TurnCommands;
  public turnCommands: TurnCommands;
  public playerParticipantIds: Set<number> = new Set<number>();
  public battleScore = 0;
  public postBattleLoot: PokemonHeldItemModifier[] = [];
  public escapeAttempts = 0;
  /**
   * A tracker of the last {@linkcode MoveId} successfully used this battle.
   */
  public lastMove: MoveId = MoveId.NONE;
  public battleSeed: string = randomString(16, true);
  private battleSeedState: string | null = null;
  public moneyScattered = 0;
  // TODO: These trackers are only used for Sticky Web + Mirror Armor edge cases
  // and are abhorrently janky.
  /** Primarily for double battles, keeps track of last enemy and player pokemon that triggered its ability or used a move */
  public lastEnemyInvolved: number;
  public lastPlayerInvolved: number;
  public lastUsedPokeball: PokeballType | null = null;
  /**
   * Saves the number of times a Pokemon on the enemy's side has fainted during this battle.
   * This is saved here since we encounter a new enemy every wave.
   * {@linkcode globalScene.arena.playerFaints} is the corresponding faint counter for the player and needs to be save across waves (reset every arena encounter).
   */
  public enemyFaints = 0;
  public playerFaintsHistory: FaintLogEntry[] = [];
  public enemyFaintsHistory: FaintLogEntry[] = [];

  public mysteryEncounterType?: MysteryEncounterType | undefined;
  /** If the current battle is a Mystery Encounter, this will always be defined */
  public mysteryEncounter?: MysteryEncounter | undefined;

  /**
   * Tracker for whether the last run attempt failed.
   * @defaultValue `false`
   */
  public failedRunAway = false;

  constructor(
    gameMode: GameMode,
    { waveIndex, battleType, trainer, mysteryEncounterType, double = false, format }: NewBattleResolvedProps,
  ) {
    this.gameMode = gameMode;
    this.waveIndex = waveIndex;
    this.battleType = battleType;
    this.trainer = trainer ?? null;
    this.mysteryEncounterType = mysteryEncounterType;
    // Multi-format: the resolver may hand us an explicit format (e.g. triple); otherwise
    // fall back to the legacy single/double derived from `double`. Binary is unchanged.
    this.setFormat(format ?? legacyFormat(double));
    // The classic finale's first stage is structurally a single boss. Its phase-two transition
    // deliberately calls setDouble(true) after the shield breaks. Co-op normally resolves every
    // battle as double; carrying that format into wave 200 generated two unrelated bosses and the
    // finale's survive-at-1HP machinery made both immortal. Normalize only the finale's stage one.
    if (this.isClassicFinalBoss) {
      this.setDouble(false);
    }

    // A Battle owns a valid command substrate for its entire lifetime. Normal play refreshes these maps in
    // incrementTurn(), and authoritative encounter adoption refreshes them after a format commit, but retained
    // transitions (notably a Mystery Encounter handing directly into renderer input) can expose the newly
    // constructed Battle before either hook. CommandPhase must never be able to dereference an undefined map.
    const commandSlots = this._arrangement.activeIndices();
    this.turnCommands = Object.fromEntries(commandSlots.map(index => [index, null]));
    this.preTurnCommands = Object.fromEntries(commandSlots.map(index => [index, null]));

    this.enemyLevels =
      battleType === BattleType.TRAINER
        ? trainer?.getPartyLevels(this.waveIndex)
        : // TODO: Remove array.fill.map
          new Array(this._arrangement.enemyCapacity).fill(null).map(() => this.getLevelForWave());
    // Multi-format (triple+): the enemy field must be fillable to the side's capacity. A
    // trainer whose party template is smaller than the format width (or any path that sized
    // enemyLevels short) would otherwise field fewer than enemyCapacity foes - the in-game
    // "3v1". Pad up to capacity. Only fires for >2-wide formats; binary is untouched (single
    // enemyLevels=1==cap1, double=2==cap2, larger trainer parties already exceed it).
    if (this.enemyLevels && this.enemyLevels.length < this._arrangement.enemyCapacity) {
      const fill = this.enemyLevels.at(-1) ?? this.getLevelForWave();
      while (this.enemyLevels.length < this._arrangement.enemyCapacity) {
        this.enemyLevels.push(fill);
      }
    }
    // ER HELL ONLY: rescale every enemy toward the player's highest party level,
    // eased in by wave (top-2 < w20, top-1 < w40, top after). No-op off Hell.
    this.enemyLevels = applyErHellEnemyLevelScaling(this.enemyLevels, this.waveIndex);
    // ER biome identity (#439 §3): Jungle overgrowth - WILD mons spawn a few
    // levels higher. Wild-only; trainer levels are set by their party template.
    if (battleType === BattleType.WILD && this.enemyLevels) {
      const wildLevelBonus = getErBiomeRule(globalScene.arena.biomeId)?.wildLevelBonus;
      if (wildLevelBonus) {
        this.enemyLevels = this.enemyLevels.map(level => level + wildLevelBonus);
      }
    }
    // ER (#504): biome NOTORIETY lets enemies/trainers exceed the normal level cap
    // the longer the player over-stays a biome (additive, to a fixed ceiling). The
    // GLOBAL level cap getLevelForWave() is untouched - this only adds an over-cap
    // bump LOCAL to the over-stayed biome, so leaving it resumes the global curve
    // exactly. Gated to the World Map run; no-op in the finale-safety zone.
    if (this.enemyLevels && erBiomeRoutingActive()) {
      const overLevel = erNotorietyOverLevel(this.waveIndex);
      if (overLevel > 0) {
        this.enemyLevels = this.enemyLevels.map(level => level + overLevel);
      }
    }
  }

  public get isClassicFinalBoss(): boolean {
    return this.gameMode.isClassic && this.gameMode.isWaveFinal(this.waveIndex);
  }

  /** The battle's multi-format descriptor (sides x capacity + adjacency). */
  public get format(): BattleFormat {
    return this._format;
  }

  /** The runtime arrangement: flat-index <-> {side,position} + adjacency/ally queries. */
  public get arrangement(): BattleArrangement {
    return this._arrangement;
  }

  /**
   * Legacy view: whether the local player side fields exactly two mons. Kept so the many
   * existing `double` reads stay correct for single/double. NOTE: a TRIPLE is NOT a `double`
   * (capacity 3) - multi-mon checks that should also fire for triples must migrate to
   * {@linkcode getBattlerCount} `> 1` instead of reading `double`.
   */
  public get double(): boolean {
    return this._arrangement.playerCapacity === 2;
  }

  /**
   * Legacy write API: `battle.double = x` still works, delegating to {@linkcode setDouble} so any
   * remaining single/double assignment site stays byte-identical. New code should call setFormat /
   * setDouble directly; this exists only to keep the historic mutable-field contract intact.
   */
  public set double(value: boolean) {
    this.setDouble(value);
  }

  /** Set the battle format and rebuild the arrangement. The single mutation point for "how many per side". */
  public setFormat(format: BattleFormat): void {
    this._format = format;
    this._arrangement = createArrangement(format);
  }

  /** Legacy helper: set single/double by boolean (rebuilds the arrangement). */
  public setDouble(double: boolean): void {
    this.setFormat(legacyFormat(double));
  }

  public getLevelForWave(): number {
    const levelWaveIndex = this.gameMode.getWaveForDifficulty(this.waveIndex);
    // Editor-tunable curve (vanilla.level.waveSlope / quadDivisor / bossMult).
    const baseLevel =
      1
      + levelWaveIndex / erBalanceNum("vanilla.level.waveSlope")
      + Math.pow(levelWaveIndex / erBalanceNum("vanilla.level.quadDivisor"), 2);
    const bossMultiplier = erBalanceNum("vanilla.level.bossMult");

    if (this.gameMode.isBoss(this.waveIndex) || (erGauntletActive() && erGauntletWaveKind(this.waveIndex) === "boss")) {
      const ret = Math.floor(baseLevel * bossMultiplier);
      if (this.isClassicFinalBoss || !(this.waveIndex % 250)) {
        return Math.ceil(ret / 25) * 25;
      }
      let levelOffset = 0;
      if (!this.gameMode.isWaveFinal(this.waveIndex)) {
        levelOffset = Math.round(Phaser.Math.RND.realInRange(-1, 1) * Math.floor(levelWaveIndex / 10));
      }
      return ret + levelOffset;
    }

    let levelOffset = 0;

    const deviation = 10 / levelWaveIndex;
    levelOffset = Math.abs(this.randSeedGaussForLevel(deviation));

    return Math.max(Math.round(baseLevel + levelOffset), 1);
  }

  randSeedGaussForLevel(value: number): number {
    let rand = 0;
    for (let i = value; i > 0; i--) {
      rand += randSeedFloat();
    }
    return rand / value;
  }

  getBattlerCount(): number {
    return this._arrangement.playerCapacity;
  }

  incrementTurn(): void {
    this.turn++;
    // Multi-format: key the command maps off the arrangement's occupiable flat indices
    // (binary -> the same 0..3 slots; triple -> 0..5) instead of the fixed BattlerIndex enum.
    const slots = this._arrangement.activeIndices();
    this.turnCommands = Object.fromEntries(slots.map(bt => [bt, null]));
    this.preTurnCommands = Object.fromEntries(slots.map(bt => [bt, null]));
    this.battleSeedState = null;
  }

  addParticipant(playerPokemon: PlayerPokemon): void {
    this.playerParticipantIds.add(playerPokemon.id);
  }

  removeFaintedParticipant(playerPokemon: PlayerPokemon): void {
    this.playerParticipantIds.delete(playerPokemon.id);
  }

  addPostBattleLoot(enemyPokemon: EnemyPokemon): void {
    this.postBattleLoot.push(
      ...globalScene
        .findModifiers(
          m => m.is("PokemonHeldItemModifier") && m.pokemonId === enemyPokemon.id && m.isTransferable,
          false,
        )
        .map(i => {
          const ret = i as PokemonHeldItemModifier;
          //@ts-expect-error - this is awful to fix/change
          ret.pokemonId = null;
          return ret;
        }),
    );
  }

  pickUpScatteredMoney(): void {
    const moneyAmount = new NumberHolder(globalScene.currentBattle.moneyScattered);
    globalScene.applyModifiers(MoneyMultiplierModifier, true, moneyAmount);

    if (globalScene.arena.getTag(ArenaTagType.HAPPY_HOUR)) {
      moneyAmount.value *= 2;
    }

    globalScene.addMoney(moneyAmount.value);

    const userLocale = navigator.language || "en-US";
    const formattedMoneyAmount = moneyAmount.value.toLocaleString(userLocale);
    const message = i18next.t("battle:moneyPickedUp", {
      moneyAmount: formattedMoneyAmount,
    });
    globalScene.phaseManager.queueMessage(message, undefined, true);

    globalScene.currentBattle.moneyScattered = 0;
  }

  addBattleScore(): void {
    let partyMemberTurnMultiplier = globalScene.getEnemyParty().length / 2 + 0.5;
    if (this.double) {
      partyMemberTurnMultiplier /= 1.5;
    }
    for (const p of globalScene.getEnemyParty()) {
      if (p.isBoss()) {
        partyMemberTurnMultiplier *= p.bossSegments / 1.5 / globalScene.getEnemyParty().length;
      }
    }
    const turnMultiplier = Phaser.Tweens.Builders.GetEaseFunction("Sine.easeIn")(
      1 - Math.min(this.turn - 2, 10 * partyMemberTurnMultiplier) / (10 * partyMemberTurnMultiplier),
    );
    const finalBattleScore = Math.ceil(this.battleScore * turnMultiplier);
    globalScene.score += finalBattleScore;
    console.log(
      `Battle Score: ${finalBattleScore} (${this.turn - 1} Turns x${Math.floor(turnMultiplier * 100) / 100})`,
    );
    console.log(`Total Score: ${globalScene.score}`);
    globalScene.updateScoreText();
  }

  getBgmOverride(): string | null {
    if (this.isBattleMysteryEncounter() && this.mysteryEncounter?.encounterMode === MysteryEncounterMode.DEFAULT) {
      // Music is overridden for MEs during ME onInit()
      // Should not use any BGM overrides before swapping from DEFAULT mode
      return null;
    }
    if (
      this.battleType === BattleType.TRAINER
      || this.mysteryEncounter?.encounterMode === MysteryEncounterMode.TRAINER_BATTLE
    ) {
      if (!this.started && this.trainer?.config.encounterBgm && this.trainer.getEncounterMessages().length > 0) {
        return `encounter_${this.trainer.getEncounterBgm()}`;
      }
      if (globalScene.musicPreference === MusicPreference.GENFIVE) {
        return this.trainer?.getBattleBgm() ?? null;
      }
      return this.trainer?.getMixedBattleBgm() ?? null;
    }
    if (this.gameMode.isClassic) {
      if (isBetween(this.waveIndex, 191, 194)) {
        return "end";
      }
      if (isBetween(this.waveIndex, 196, 199)) {
        return "end_summit";
      }
    }
    const wildOpponents = globalScene.getEnemyParty();
    for (const pokemon of wildOpponents) {
      if (this.isClassicFinalBoss) {
        if (pokemon.species.getFormSpriteKey(pokemon.formIndex) === SpeciesFormKey.ETERNAMAX) {
          return "battle_final";
        }
        return "battle_final_encounter";
      }
      if (
        pokemon.species.legendary
        || pokemon.species.subLegendary
        || pokemon.species.mythical
        || (pokemon.species.category.startsWith("Paradox") && globalScene.arena.biomeId !== BiomeId.END)
      ) {
        if (globalScene.musicPreference === MusicPreference.GENFIVE) {
          switch (pokemon.species.speciesId) {
            case SpeciesId.ARTICUNO:
            case SpeciesId.ZAPDOS:
            case SpeciesId.MOLTRES:
            case SpeciesId.MEWTWO:
            case SpeciesId.MEW:
              return "battle_legendary_mew";
            case SpeciesId.REGIROCK:
            case SpeciesId.REGICE:
            case SpeciesId.REGISTEEL:
            case SpeciesId.REGIGIGAS:
            case SpeciesId.REGIDRAGO:
            case SpeciesId.REGIELEKI:
              return "battle_legendary_regis_g5";
            case SpeciesId.KYUREM:
              return "battle_legendary_kyurem";
            default:
              if (pokemon.species.legendary) {
                return "battle_legendary_res_zek";
              }
              return "battle_legendary_unova";
          }
        }
        if (globalScene.musicPreference === MusicPreference.ALLGENS) {
          switch (pokemon.species.speciesId) {
            case SpeciesId.ARTICUNO:
            case SpeciesId.ZAPDOS:
            case SpeciesId.MOLTRES:
            case SpeciesId.MEWTWO:
            case SpeciesId.MEW:
              return "battle_legendary_kanto";
            case SpeciesId.RAIKOU:
              return "battle_legendary_raikou";
            case SpeciesId.ENTEI:
              return "battle_legendary_entei";
            case SpeciesId.SUICUNE:
              return "battle_legendary_suicune";
            case SpeciesId.LUGIA:
              return "battle_legendary_lugia";
            case SpeciesId.HO_OH:
              return "battle_legendary_ho_oh";
            case SpeciesId.REGIROCK:
            case SpeciesId.REGICE:
            case SpeciesId.REGISTEEL:
            case SpeciesId.REGIGIGAS:
            case SpeciesId.REGIDRAGO:
            case SpeciesId.REGIELEKI:
              return "battle_legendary_regis_g6";
            case SpeciesId.GROUDON:
            case SpeciesId.KYOGRE:
              if (pokemon.getFormKey() === SpeciesFormKey.PRIMAL) {
                return "battle_legendary_gro_kyo";
              }
              return "battle_legendary_rayquaza";
            case SpeciesId.RAYQUAZA:
              return "battle_legendary_rayquaza";
            case SpeciesId.DEOXYS:
              return "battle_legendary_deoxys";
            case SpeciesId.UXIE:
            case SpeciesId.MESPRIT:
            case SpeciesId.AZELF:
              return "battle_legendary_lake_trio";
            case SpeciesId.HEATRAN:
            case SpeciesId.CRESSELIA:
            case SpeciesId.DARKRAI:
            case SpeciesId.SHAYMIN:
              return "battle_legendary_sinnoh";
            case SpeciesId.DIALGA:
            case SpeciesId.PALKIA:
              if (pokemon.getFormKey() === SpeciesFormKey.ORIGIN) {
                return "battle_legendary_origin_forme";
              }
              return "battle_legendary_dia_pal";
            case SpeciesId.GIRATINA:
              return "battle_legendary_giratina";
            case SpeciesId.ARCEUS:
              return "battle_legendary_arceus";
            case SpeciesId.COBALION:
            case SpeciesId.TERRAKION:
            case SpeciesId.VIRIZION:
            case SpeciesId.KELDEO:
            case SpeciesId.TORNADUS:
            case SpeciesId.LANDORUS:
            case SpeciesId.THUNDURUS:
            case SpeciesId.MELOETTA:
            case SpeciesId.GENESECT:
              return "battle_legendary_unova";
            case SpeciesId.KYUREM:
              return "battle_legendary_kyurem";
            case SpeciesId.XERNEAS:
            case SpeciesId.YVELTAL:
            case SpeciesId.ZYGARDE:
              return "battle_legendary_xern_yvel";
            case SpeciesId.TAPU_KOKO:
            case SpeciesId.TAPU_LELE:
            case SpeciesId.TAPU_BULU:
            case SpeciesId.TAPU_FINI:
              return "battle_legendary_tapu";
            case SpeciesId.COSMOG:
            case SpeciesId.COSMOEM:
            case SpeciesId.SOLGALEO:
            case SpeciesId.LUNALA:
              return "battle_legendary_sol_lun";
            case SpeciesId.NECROZMA:
              switch (pokemon.getFormKey()) {
                case "dusk-mane":
                case "dawn-wings":
                  return "battle_legendary_dusk_dawn";
                case "ultra":
                  return "battle_legendary_ultra_nec";
                default:
                  return "battle_legendary_sol_lun";
              }
            case SpeciesId.NIHILEGO:
            case SpeciesId.PHEROMOSA:
            case SpeciesId.BUZZWOLE:
            case SpeciesId.XURKITREE:
            case SpeciesId.CELESTEELA:
            case SpeciesId.KARTANA:
            case SpeciesId.GUZZLORD:
            case SpeciesId.POIPOLE:
            case SpeciesId.NAGANADEL:
            case SpeciesId.STAKATAKA:
            case SpeciesId.BLACEPHALON:
              return "battle_legendary_ub";
            case SpeciesId.ZACIAN:
            case SpeciesId.ZAMAZENTA:
              return "battle_legendary_zac_zam";
            case SpeciesId.ETERNATUS:
              if (pokemon.getFormKey() === "eternamax") {
                return "battle_legendary_eternatus_p2";
              }
              return "battle_legendary_eternatus_p1";
            case SpeciesId.GLASTRIER:
            case SpeciesId.SPECTRIER:
              return "battle_legendary_glas_spec";
            case SpeciesId.CALYREX:
              if (pokemon.getFormKey() === "ice" || pokemon.getFormKey() === "shadow") {
                return "battle_legendary_riders";
              }
              return "battle_legendary_calyrex";
            case SpeciesId.GALAR_ARTICUNO:
            case SpeciesId.GALAR_ZAPDOS:
            case SpeciesId.GALAR_MOLTRES:
              return "battle_legendary_birds_galar";
            case SpeciesId.WO_CHIEN:
            case SpeciesId.CHIEN_PAO:
            case SpeciesId.TING_LU:
            case SpeciesId.CHI_YU:
              return "battle_legendary_ruinous";
            case SpeciesId.GREAT_TUSK:
            case SpeciesId.SCREAM_TAIL:
            case SpeciesId.BRUTE_BONNET:
            case SpeciesId.FLUTTER_MANE:
            case SpeciesId.SLITHER_WING:
            case SpeciesId.SANDY_SHOCKS:
            case SpeciesId.IRON_TREADS:
            case SpeciesId.IRON_BUNDLE:
            case SpeciesId.IRON_HANDS:
            case SpeciesId.IRON_JUGULIS:
            case SpeciesId.IRON_MOTH:
            case SpeciesId.IRON_THORNS:
            case SpeciesId.ROARING_MOON:
            case SpeciesId.IRON_VALIANT:
            case SpeciesId.WALKING_WAKE:
            case SpeciesId.IRON_LEAVES:
            case SpeciesId.GOUGING_FIRE:
            case SpeciesId.RAGING_BOLT:
            case SpeciesId.IRON_BOULDER:
            case SpeciesId.IRON_CROWN:
            case SpeciesId.KORAIDON:
            case SpeciesId.MIRAIDON:
              return "battle_legendary_kor_mir";
            case SpeciesId.OKIDOGI:
            case SpeciesId.MUNKIDORI:
            case SpeciesId.FEZANDIPITI:
              return "battle_legendary_loyal_three";
            case SpeciesId.OGERPON:
              return "battle_legendary_ogerpon";
            case SpeciesId.TERAPAGOS:
              return "battle_legendary_terapagos";
            case SpeciesId.PECHARUNT:
              return "battle_legendary_pecharunt";
            default:
              if (pokemon.species.legendary) {
                return "battle_legendary_res_zek";
              }
              return "battle_legendary_unova";
          }
        }
      }
    }

    if (globalScene.gameMode.isClassic && this.waveIndex <= 4) {
      return "battle_wild";
    }

    return null;
  }

  /**
   * Generates a random number using the current battle's seed. Calls {@linkcode randSeedInt}
   * @param range How large of a range of random numbers to choose from. If {@linkcode range} <= 1, returns {@linkcode min}
   * @param min The minimum integer to pick, default `0`
   * @returns A random integer between {@linkcode min} and ({@linkcode min} + {@linkcode range} - 1)
   */
  randSeedInt(range: number, min = 0): number {
    if (range <= 1) {
      return min;
    }
    const tempSeedOverride = globalScene.rngSeedOverride;
    const state = Phaser.Math.RND.state();
    if (this.battleSeedState) {
      Phaser.Math.RND.state(this.battleSeedState);
    } else {
      Phaser.Math.RND.sow([shiftCharCodes(this.battleSeed, this.turn << 6)]);
      console.log("Battle Seed:", this.battleSeed);
    }
    globalScene.rngSeedOverride = this.battleSeed;
    const ret = randSeedInt(range, min);
    this.battleSeedState = Phaser.Math.RND.state();
    Phaser.Math.RND.state(state);
    globalScene.rngSeedOverride = tempSeedOverride;
    return ret;
  }

  /**
   * Returns if the battle is of type {@linkcode BattleType.MYSTERY_ENCOUNTER}
   */
  isBattleMysteryEncounter(): boolean {
    return this.battleType === BattleType.MYSTERY_ENCOUNTER;
  }
}

export class FixedBattle extends Battle {
  constructor(waveIndex: number, config: FixedBattleConfig) {
    super(globalScene.gameMode, {
      waveIndex,
      battleType: config.battleType,
      trainer: config.battleType === BattleType.TRAINER ? config.getTrainer() : undefined,
      double: config.double,
    });
    if (config.getEnemyParty) {
      this.enemyParty = config.getEnemyParty();
    }
  }
}

type GetTrainerFunc = () => Trainer;
type GetEnemyPartyFunc = () => EnemyPokemon[];

export class FixedBattleConfig {
  // TODO: All fixed battles are currently trainer battles
  public battleType: Exclude<BattleType, BattleType.CLEAR>;
  public double: boolean;
  public getTrainer: GetTrainerFunc;
  public getEnemyParty: GetEnemyPartyFunc;
  public seedOffsetWaveIndex: number;
  public customModifierRewardSettings?: CustomModifierSettings;

  setBattleType(battleType: Exclude<BattleType, BattleType.CLEAR>): FixedBattleConfig {
    this.battleType = battleType;
    return this;
  }

  setDouble(double: boolean): FixedBattleConfig {
    this.double = double;
    return this;
  }

  setGetTrainerFunc(getTrainerFunc: GetTrainerFunc): FixedBattleConfig {
    this.getTrainer = getTrainerFunc;
    return this;
  }

  setGetEnemyPartyFunc(getEnemyPartyFunc: GetEnemyPartyFunc): FixedBattleConfig {
    this.getEnemyParty = getEnemyPartyFunc;
    return this;
  }

  setSeedOffsetWave(seedOffsetWaveIndex: number): FixedBattleConfig {
    this.seedOffsetWaveIndex = seedOffsetWaveIndex;
    return this;
  }

  setCustomModifierRewards(customModifierRewardSettings: CustomModifierSettings) {
    this.customModifierRewardSettings = customModifierRewardSettings;
    return this;
  }
}
/**
 * Helper function to generate a random trainer for evil team trainers and the elite 4/champion
 * @param trainerPool - The TrainerType or list of TrainerTypes that can possibly be generated
 * @param randomGender - (default `false`); Whether or not to randomly (50%) generate a female trainer (for use with evil team grunts)
 * @param seedOffset - (default `0`); A seed offset indicating the invocation count of the function to attempt to choose a random, but unique, trainer from the pool
 * @returns A function to generate a random trainer
 */
export function getRandomTrainerFunc(
  trainerPool: readonly (TrainerType | readonly TrainerType[])[],
  randomGender = false,
  seedOffset = 0,
): GetTrainerFunc {
  return () => {
    /** The chosen entry in the pool */
    let choice = randSeedItem(trainerPool);

    if (typeof choice !== "number") {
      choice = seedOffset === 0 ? randSeedItem(choice) : randSeedUniqueItem(choice, seedOffset);
    }

    let trainerGender = TrainerVariant.DEFAULT;
    if (randomGender) {
      // Co-op (#633): seed the gender roll. This closure runs inside `executeWithSeedOffset`
      // (battle-scene.resolveFixedBattle), so the unseeded `randInt(2)` was the divergence
      // point that gave the two clients different evil-grunt genders. `randSeedInt` reads the
      // shared seed, matching the surrounding `randSeedItem` picks and keeping clients aligned.
      trainerGender = randSeedInt(2) === 0 ? TrainerVariant.FEMALE : TrainerVariant.DEFAULT;
    }

    /* 1/3 chance for evil team grunts to be double battles */
    const evilTeamGrunts = [
      TrainerType.ROCKET_GRUNT,
      TrainerType.MAGMA_GRUNT,
      TrainerType.AQUA_GRUNT,
      TrainerType.GALACTIC_GRUNT,
      TrainerType.PLASMA_GRUNT,
      TrainerType.FLARE_GRUNT,
      TrainerType.AETHER_GRUNT,
      TrainerType.SKULL_GRUNT,
      TrainerType.MACRO_GRUNT,
      TrainerType.STAR_GRUNT,
    ];
    const isEvilTeamGrunt = evilTeamGrunts.includes(choice);

    if (trainerConfigs[choice].hasDouble && isEvilTeamGrunt) {
      // Co-op (#633): seed the double-battle roll for the same reason as the gender roll
      // above - the unseeded `randInt(3)` made one client field a double evil-grunt battle
      // and the other a single, desyncing the whole wave. `randSeedInt` keeps it deterministic.
      return new Trainer(choice, randSeedInt(3) === 0 ? TrainerVariant.DOUBLE : trainerGender);
    }

    return new Trainer(choice, trainerGender);
  };
}
