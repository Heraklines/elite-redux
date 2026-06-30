import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { PLAYER_PARTY_MAX_SIZE, WEIGHT_INCREMENT_ON_SPAWN_MISS } from "#app/constants";
import { consumePendingDevEnemyParty, type DevEnemyMonSpec } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import Overrides from "#app/overrides";
import { handleTutorial, Tutorial } from "#app/tutorial";
import { initEncounterAnims, loadEncounterAnimAssets } from "#data/battle-anims";
import { fieldPositionForSlot } from "#data/battle-format";
import { getCharVariantFromDialogue } from "#data/dialogue";
import { captureCoopEnemies } from "#data/elite-redux/coop/coop-battle-engine";
import { buildCoopEnemy } from "#data/elite-redux/coop/coop-enemy-builder";
import {
  getCoopBattleStreamer,
  getCoopController,
  getCoopNetcodeMode,
  maybeBeginReplayRecording,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopSerializedEnemy } from "#data/elite-redux/coop/coop-transport";
import { erRecordAchievementShinyEncounter } from "#data/elite-redux/er-achievement-tracker";
import { erBiomeForcedTerrain, erBiomeForcedWeather } from "#data/elite-redux/er-biome-rules";
import { getErFinalBossSpecies, isErFinalBossSpecies } from "#data/elite-redux/er-final-boss";
import { consumeErCarriedWeather } from "#data/elite-redux/er-map-nodes";
import {
  erApplyCovenantHeal,
  erLookoutPreviewEnemy,
  erQuartermasterTick,
  erStormglassApplyChosenWeather,
  getStormglassWeather,
  hasErRelic,
} from "#data/elite-redux/er-relics";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { CASCOON_ANGELS_WRATH_MOVES } from "#data/elite-redux/init-elite-redux-movesets";
import { getNatureName } from "#data/nature";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { PlayerGender } from "#enums/player-gender";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import type { WeatherType } from "#enums/weather-type";
import { EncounterPhaseEvent } from "#events/battle-scene";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import {
  BoostBugSpawnModifier,
  IvScannerModifier,
  overrideHeldItems,
  overrideModifiers,
  TurnHeldItemTransferModifier,
} from "#modifiers/modifier";
import { regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { getEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { doTrainerExclamation } from "#mystery-encounters/encounter-phase-utils";
import { getGoldenBugNetSpecies } from "#mystery-encounters/encounter-pokemon-utils";
import { BattlePhase } from "#phases/battle-phase";
import { achvs } from "#system/achv";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

/**
 * Dev scenario builder (staging only): construct one staged enemy mon for slot
 * `e`. Mirrors the LLM director's wild-encounter override construction. Returns
 * null when the spec's species doesn't resolve (falls through to normal gen).
 */
function buildDevEnemy(spec: DevEnemyMonSpec, fallbackLevel: number, trainerBattle: boolean): EnemyPokemon | null {
  const species = getPokemonSpecies(spec.speciesId);
  if (!species) {
    return null;
  }
  const level = Math.max(1, Math.floor(spec.level ?? fallbackLevel));
  const enemy = globalScene.addEnemyPokemon(
    species,
    level,
    trainerBattle ? TrainerSlot.TRAINER : TrainerSlot.NONE,
    !!spec.isBoss,
  );
  if (spec.formIndex) {
    enemy.formIndex = spec.formIndex;
    enemy.calculateStats();
    enemy.generateName();
  }
  if (spec.moveIds && spec.moveIds.length > 0) {
    const moves = spec.moveIds.slice(0, 4).map(id => new PokemonMove(id));
    enemy.moveset = moves;
    enemy.summonData.moveset = moves.slice();
  }
  if (spec.abilitySlot !== undefined) {
    enemy.abilityIndex = Math.max(0, Math.min(2, spec.abilitySlot));
  }
  if (spec.shiny) {
    enemy.shiny = true;
  }
  return enemy;
}

/**
 * How long a co-op GUEST waits for the host's enemy party before falling back to
 * generating its own (#633, LIVE-D6). Generous: the host only knows its enemies
 * after a human clears its save-slot screen, which can take a while.
 */
const COOP_ENEMY_PARTY_WAIT_MS = 120_000;

export class EncounterPhase extends BattlePhase {
  // Union type is necessary as this is subclassed, and typescript will otherwise complain
  public readonly phaseName: "EncounterPhase" | "NextEncounterPhase" | "NewBiomeEncounterPhase" = "EncounterPhase";

  private readonly loaded: boolean;

  /** Co-op GUEST (#633): set when this client adopted the host's enemy party verbatim
   *  (incl. host-streamed held items), so {@linkcode runEncounter} skips its own enemy
   *  modifier generation - otherwise the held items would double / diverge. */
  private coopAdoptedEnemyParty = false;

  constructor(loaded = false) {
    super();

    this.loaded = loaded;
  }

  start() {
    super.start();

    // #record-replay (Phase 2): begin recording this co-op run's replay trace on the authoritative
    // host (idempotent; hard no-op off the live co-op host / when already recording / in single-player).
    // Placed here because seed + the merged party are both established by the first EncounterPhase.
    maybeBeginReplayRecording();

    // Co-op GUEST (#633, LIVE-D6): adopt the host's authoritative enemy party BEFORE
    // generating our own, so both clients fight byte-identical enemies (species
    // included). The host only knows its enemies after it clears its own save-slot
    // screen, so the guest waits (bounded; falls back to normal generation on
    // timeout, never hangs). Solo / host / loaded runs go straight to runEncounter()
    // synchronously below - byte-for-byte unchanged from before.
    if (this.shouldAdoptCoopEnemyParty()) {
      void this.runEncounterAfterCoopAdopt();
      return;
    }

    this.runEncounter();
  }

  /** Whether THIS client must wait for + adopt the host's enemy party (co-op GUEST only). */
  private shouldAdoptCoopEnemyParty(): boolean {
    if (this.loaded || !globalScene.gameMode.isCoop) {
      return false;
    }
    const controller = getCoopController();
    const streamer = getCoopBattleStreamer();
    if (controller == null || streamer == null || controller.role !== "guest") {
      return false;
    }
    const battle = globalScene.currentBattle;
    if (getCoopNetcodeMode() === "authoritative") {
      // Co-op AUTHORITATIVE netcode (#633, TRACK-2 Phase B): the GUEST is a pure renderer -
      // it NEVER rolls its own enemies for ANY battle type. It awaits + adopts the host's
      // authoritative party for wild AND trainer AND mystery-encounter battles (the host
      // serializes + streams the generated party regardless of type), pre-filling
      // battle.enemyParty so the encounter's own generation loop SKIPS (its `!enemyParty[e]`
      // guard). The trainer object / ME encounter the guest still builds locally for
      // RENDERING only - the MONS are the host's.
      return battle != null;
    }
    // LOCKSTEP netcode (#633): adopt only for WILD and TRAINER battles (the 778b192dd gate).
    // Wild parties roll a random species; trainer parties roll unseeded gender / double-
    // battle flags and an unseeded species-pool pick (the latent wave-4 trainer desync).
    // Ghost waves are BattleType.TRAINER, so they're covered here too. Mystery encounters
    // are excluded (handled elsewhere) by the guard.
    if (battle == null || battle.isBattleMysteryEncounter()) {
      return false;
    }
    return battle.battleType === BattleType.WILD || battle.battleType === BattleType.TRAINER;
  }

  /** Co-op guest: wait for + adopt the host's enemy party, then run the encounter. */
  private async runEncounterAfterCoopAdopt(): Promise<void> {
    await this.adoptCoopHostEnemyParty();
    this.runEncounter();
  }

  /**
   * Co-op GUEST (#633, LIVE-D6): pull the host's authoritative enemy party off the
   * stream and pre-populate `battle.enemyParty` from it, so {@linkcode runEncounter}'s
   * generation loop SKIPS rolling our own (its `!battle.enemyParty[e]` guard) and we
   * fight the host's exact mons. Fully guarded: a timeout / bad entry simply leaves
   * the slot empty so the guest generates normally (divergent but never broken).
   */
  private async adoptCoopHostEnemyParty(): Promise<void> {
    const streamer = getCoopBattleStreamer();
    const battle = globalScene.currentBattle;
    if (streamer == null || battle == null) {
      return;
    }
    let enemies: CoopSerializedEnemy[] | null = null;
    try {
      // #633/#698 handoff robustness: await the host's party for the FULL 120s ceiling
      // (the backstop), but re-request it on a short interval so a single LOST
      // `enemyPartySync` (or a host still loading its trainer assets) is recovered on
      // demand instead of silently hard-locking the guest for two minutes. A pre-await
      // or eventual arrival is still consumed via the existing wave-keyed buffer.
      enemies = await streamer.awaitEnemyPartyWithRetry(battle.waveIndex, wave => streamer.requestEnemyParty(wave), {
        timeoutMs: COOP_ENEMY_PARTY_WAIT_MS,
      });
    } catch {
      enemies = null;
    }
    if (enemies == null) {
      return;
    }
    const levels = battle.enemyLevels ?? [];
    // Trainer enemies belong in TrainerSlot.TRAINER; wild enemies in NONE.
    const trainerSlot = battle.battleType === BattleType.TRAINER ? TrainerSlot.TRAINER : TrainerSlot.NONE;
    for (const entry of enemies) {
      if (battle.enemyParty[entry.fieldIndex] != null) {
        continue;
      }
      try {
        const built = buildCoopEnemy(entry.data, levels[entry.fieldIndex] ?? 1, trainerSlot);
        if (built != null) {
          battle.enemyParty[entry.fieldIndex] = built;
          // We adopted at least one enemy verbatim (incl. its host-streamed held items),
          // so the generation loop must NOT roll its own modifiers for this party (#633):
          // that would double / diverge the held items. Suppressed in runEncounter.
          this.coopAdoptedEnemyParty = true;
        }
      } catch {
        /* one enemy failed to reconstruct; leave the slot for normal generation */
      }
    }
  }

  /**
   * Co-op HOST (#633, LIVE-D6): broadcast the just-generated enemy party so the guest
   * (which paused its own encounter to wait) adopts these exact mons. No-op for solo /
   * non-host. Best-effort + guarded - never blocks or breaks the host's encounter.
   */
  private broadcastCoopEnemyParty(): void {
    if (!globalScene.gameMode.isCoop) {
      return;
    }
    const controller = getCoopController();
    const streamer = getCoopBattleStreamer();
    if (controller == null || streamer == null || controller.role !== "host") {
      return;
    }
    try {
      streamer.sendEnemyParty(globalScene.currentBattle.waveIndex, captureCoopEnemies());
    } catch {
      /* a serialize/send failure must never break the host's encounter */
    }
  }

  private runEncounter() {
    globalScene.updateGameInfo();

    globalScene.initSession();

    globalScene.eventTarget.dispatchEvent(new EncounterPhaseEvent());

    // Failsafe if players somehow skip floor 200 in classic mode
    if (globalScene.gameMode.isClassic && globalScene.currentBattle.waveIndex > 200) {
      globalScene.phaseManager.unshiftNew("GameOverPhase");
    }

    const loadEnemyAssets: Promise<void>[] = [];

    const battle = globalScene.currentBattle;

    // Generate and Init Mystery Encounter
    if (battle.isBattleMysteryEncounter() && !battle.mysteryEncounter) {
      globalScene.executeWithSeedOffset(() => {
        const currentSessionEncounterType = battle.mysteryEncounterType;
        battle.mysteryEncounter = globalScene.getMysteryEncounter(currentSessionEncounterType);
      }, battle.waveIndex * 16);
    }
    const mysteryEncounter = battle.mysteryEncounter;
    if (mysteryEncounter) {
      // If ME has an onInit() function, call it
      // Usually used for calculating rand data before initializing anything visual
      // Also prepopulates any dialogue tokens from encounter/option requirements
      globalScene.executeWithSeedOffset(() => {
        if (mysteryEncounter.onInit) {
          mysteryEncounter.onInit();
        }
        mysteryEncounter.populateDialogueTokensFromRequirements();
      }, battle.waveIndex);

      // Add any special encounter animations to load
      if (mysteryEncounter.encounterAnimations && mysteryEncounter.encounterAnimations.length > 0) {
        loadEnemyAssets.push(
          initEncounterAnims(mysteryEncounter.encounterAnimations).then(() => loadEncounterAnimAssets(true)),
        );
      }

      // Add intro visuals for mystery encounter
      mysteryEncounter.initIntroVisuals();
      globalScene.field.add(mysteryEncounter.introVisuals!);
    }

    let totalBst = 0;

    // Dev scenario builder (staging only): a fully custom enemy party staged
    // for this wave. Consumed ONCE; null in production builds.
    const devEnemyParty = this.loaded ? null : consumePendingDevEnemyParty();

    // Multi-format (triple+): the enemy-gen loop below is bounded by enemyLevels.length, which
    // can come up short of the side's capacity (a small trainer party, or new-battle-phase
    // resizing it for a wild override) - that fielded fewer than 3 foes in-game ("3v1"). Pad
    // it to enemyCapacity here, AFTER all prior resizes, so the field always fills. Binary
    // (cap <= 2) is a no-op.
    const enemyCapacity = battle.arrangement.enemyCapacity;
    if (!this.loaded && battle.enemyLevels && battle.enemyLevels.length < enemyCapacity) {
      const fill = battle.enemyLevels.at(-1) ?? battle.enemyLevels[0] ?? 1;
      while (battle.enemyLevels.length < enemyCapacity) {
        battle.enemyLevels.push(fill);
      }
    }

    battle.enemyLevels?.every((level, e) => {
      if (battle.isBattleMysteryEncounter()) {
        // Skip enemy loading for MEs, those are loaded elsewhere
        return false;
      }
      // The LLM Director can pre-populate battle.enemyParty[e] via
      // NewBattlePhase.applyWildEncounterOverride for narrative-driven
      // wild encounters (a specific Pelipper, a feral Houndoom). When
      // that's the case, skip the standard generation so the LLM's
      // choices stick.
      if (devEnemyParty?.[e] && !this.loaded && !battle.enemyParty[e]) {
        const devEnemy = buildDevEnemy(devEnemyParty[e], level, battle.battleType === BattleType.TRAINER);
        if (devEnemy) {
          battle.enemyParty[e] = devEnemy;
        }
      }
      if (!this.loaded && !battle.enemyParty[e]) {
        if (battle.battleType === BattleType.TRAINER) {
          battle.enemyParty[e] = battle.trainer?.genPartyMember(e)!; // TODO:: is the bang correct here?
        } else {
          let enemySpecies = globalScene.randomSpecies(battle.waveIndex, level, true);
          // Elite Redux: on Elite/Hell the classic final boss (Eternatus) is
          // replaced by a two-phase Cascoon → Primal Cascoon encounter.
          if (battle.isClassicFinalBoss) {
            const erFinalBoss = getErFinalBossSpecies();
            if (erFinalBoss) {
              enemySpecies = erFinalBoss;
            }
          }
          // If player has golden bug net, rolls 10% chance to replace non-boss wave wild species from the golden bug net bug pool
          if (
            globalScene.findModifier(m => m instanceof BoostBugSpawnModifier)
            && !globalScene.gameMode.isBoss(battle.waveIndex)
            && globalScene.arena.biomeId !== BiomeId.END
            && randSeedInt(10) === 0
          ) {
            enemySpecies = getGoldenBugNetSpecies(level);
          }
          battle.enemyParty[e] = globalScene.addEnemyPokemon(
            enemySpecies,
            level,
            TrainerSlot.NONE,
            !!globalScene.getEncounterBossSegments(battle.waveIndex, level, enemySpecies),
          );
          if (globalScene.currentBattle.isClassicFinalBoss) {
            battle.enemyParty[e].ivs.fill(31);
          }
          globalScene
            .getPlayerParty()
            .slice(0, battle.arrangement.playerCapacity)
            .reverse()
            .forEach(playerPokemon => {
              applyAbAttrs("SyncEncounterNatureAbAttr", { pokemon: playerPokemon, target: battle.enemyParty[e] });
            });
        }
      }
      const enemyPokemon = globalScene.getEnemyParty()[e];
      if (e < battle.arrangement.enemyCapacity) {
        enemyPokemon.setX(-66 + enemyPokemon.getFieldPositionOffset()[0]);
        enemyPokemon.fieldSetup(true);
      }

      if (!this.loaded) {
        globalScene.gameData.setPokemonSeen(
          enemyPokemon,
          true,
          battle.battleType === BattleType.TRAINER
            || battle?.mysteryEncounter?.encounterMode === MysteryEncounterMode.TRAINER_BATTLE,
        );
      }

      if (battle.isClassicFinalBoss && isErFinalBossSpecies(enemyPokemon.species.speciesId)) {
        // Elite Redux final boss: set up phase-1 boss segments the same way
        // the vanilla Eternatus final boss does. On HELL the fight STARTS as
        // PRIMAL Cascoon (form 1) — stage 2 is its Black Shiny form (#349).
        if (getErDifficulty() === "hell") {
          enemyPokemon.formIndex = 1;
          enemyPokemon.updateScale();
        }
        enemyPokemon.setBoss();
        // ER (#380): the finale boss runs the FULL Angel's Wrath kit - all 7
        // transformed moves at once (boss-only extended moveset; the enemy AI
        // iterates the whole moveset, and the Battle Info moves page has a
        // compressed layout for >5 rows). Applies to BOTH stages.
        enemyPokemon.moveset = CASCOON_ANGELS_WRATH_MOVES.map(([, moveId]) => new PokemonMove(moveId));
      } else if (enemyPokemon.species.speciesId === SpeciesId.ETERNATUS) {
        if (battle.isClassicFinalBoss) {
          enemyPokemon.setBoss();
        } else if (!(battle.waveIndex % 1000)) {
          enemyPokemon.formIndex = 1;
          enemyPokemon.updateScale();
        }
      }

      totalBst += enemyPokemon.getSpeciesForm().baseTotal;

      loadEnemyAssets.push(enemyPokemon.loadAssets());

      const stats: string[] = [
        `HP: ${enemyPokemon.stats[0]} (${enemyPokemon.ivs[0]})`,
        ` Atk: ${enemyPokemon.stats[1]} (${enemyPokemon.ivs[1]})`,
        ` Def: ${enemyPokemon.stats[2]} (${enemyPokemon.ivs[2]})`,
        ` Spatk: ${enemyPokemon.stats[3]} (${enemyPokemon.ivs[3]})`,
        ` Spdef: ${enemyPokemon.stats[4]} (${enemyPokemon.ivs[4]})`,
        ` Spd: ${enemyPokemon.stats[5]} (${enemyPokemon.ivs[5]})`,
      ];
      const moveset: string[] = [];
      for (const move of enemyPokemon.getMoveset()) {
        // Defend against invalid move ids in the moveset (id-map drift).
        const resolved = move.getMove();
        moveset.push(resolved ? resolved.name : `?moveId=${move.moveId}`);
      }

      console.log(
        `Pokemon: ${getPokemonNameWithAffix(enemyPokemon)}`,
        `| Species ID: ${enemyPokemon.species.speciesId}`,
        `| Level: ${enemyPokemon.level}`,
        `| Nature: ${getNatureName(enemyPokemon.nature, true, true, true)}`,
      );
      console.log(`Stats (IVs): ${stats}`);
      console.log(
        `Ability: ${enemyPokemon.getAbility().name}`,
        `| Passive Ability${enemyPokemon.hasPassive() ? "" : " (inactive)"}: ${enemyPokemon.getPassiveAbility().name}`,
        `${enemyPokemon.isBoss() ? `| Boss Bars: ${enemyPokemon.bossSegments}` : ""}`,
      );
      console.log("Moveset:", moveset);
      return true;
    });

    // Co-op HOST (#633): the enemy party's IDENTITY is generated here, but its HELD ITEMS
    // are not attached until generateEnemyModifiers() runs in the loadEnemyAssets.then()
    // block below. So the broadcast (which must carry the host's held items so the guest
    // doesn't roll its own) is deferred to AFTER that generation - see below.

    if (globalScene.getPlayerParty().filter(p => p.isShiny()).length === PLAYER_PARTY_MAX_SIZE) {
      globalScene.validateAchv(achvs.SHINY_PARTY);
    }

    if (battle.battleType === BattleType.TRAINER) {
      loadEnemyAssets.push(battle.trainer?.loadAssets().then(() => battle.trainer?.initSprite())!); // TODO: is this bang correct?
    } else if (battle.isBattleMysteryEncounter()) {
      if (battle.mysteryEncounter?.introVisuals) {
        loadEnemyAssets.push(
          battle.mysteryEncounter.introVisuals
            .loadAssets()
            .then(() => battle.mysteryEncounter!.introVisuals!.initSprite()),
        );
      }
      if (battle.mysteryEncounter?.loadAssets && battle.mysteryEncounter.loadAssets.length > 0) {
        loadEnemyAssets.push(...battle.mysteryEncounter.loadAssets);
      }
      // Load Mystery Encounter Exclamation bubble and sfx
      loadEnemyAssets.push(
        new Promise<void>(resolve => {
          globalScene
            .loadSe("GEN8- Exclaim", "battle_anims", "GEN8- Exclaim.wav")
            .loadImage("encounter_exclaim", "mystery-encounters");
          globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
          if (!globalScene.load.isLoading()) {
            globalScene.load.start();
          }
        }),
      );
    } else {
      const overridedBossSegments = Overrides.ENEMY_HEALTH_SEGMENTS_OVERRIDE > 1;
      // for double battles, reduce the health segments for boss Pokemon unless there is an override
      if (!overridedBossSegments && battle.enemyParty.filter(p => p.isBoss()).length > 1) {
        for (const enemyPokemon of battle.enemyParty) {
          // If the enemy pokemon is a boss and wasn't populated from data source, then update the number of segments
          if (enemyPokemon.isBoss() && !enemyPokemon.isPopulatedFromDataSource) {
            enemyPokemon.setBoss(
              true,
              Math.ceil(enemyPokemon.bossSegments * (enemyPokemon.getSpeciesForm().baseTotal / totalBst)),
            );
            enemyPokemon.initBattleInfo();
          }
        }
      }
    }

    Promise.all(loadEnemyAssets).then(() => {
      battle.enemyParty.every((enemyPokemon, e) => {
        if (battle.isBattleMysteryEncounter()) {
          return false;
        }
        if (e < battle.arrangement.enemyCapacity) {
          if (battle.battleType === BattleType.WILD) {
            for (const pokemon of globalScene.getField()) {
              applyAbAttrs("PreSummonAbAttr", { pokemon });
            }
            globalScene.field.add(enemyPokemon);
            battle.seenEnemyPartyMemberIds.add(enemyPokemon.id);
            const playerPokemon = globalScene.getPlayerPokemon();
            if (playerPokemon?.isOnField()) {
              globalScene.field.moveBelow(enemyPokemon as Pokemon, playerPokemon);
            }
            enemyPokemon.tint(0, 0.5);
          } else if (battle.battleType === BattleType.TRAINER) {
            enemyPokemon.setVisible(false);
            globalScene.currentBattle.trainer?.tint(0, 0.5);
          }
          // Multi-format: position each on-field enemy by slot (LEFT/CENTER/RIGHT for 3).
          if (battle.arrangement.enemyCapacity > 1) {
            enemyPokemon.setFieldPosition(fieldPositionForSlot(e, battle.arrangement.enemyCapacity));
          }
        }
        return true;
      });

      // Co-op GUEST (#633): when we adopted the host's enemy party verbatim, its held items
      // were already reconstructed from the host's stream (buildCoopEnemy). Rolling our own
      // here would DOUBLE / diverge them (a fresh seeded modifier roll on top of the adopted
      // set), so skip the whole generation block. Solo / host / non-adopt runs are unchanged.
      if (!this.loaded && battle.battleType !== BattleType.MYSTERY_ENCOUNTER && !this.coopAdoptedEnemyParty) {
        // generate modifiers for MEs, overriding prior ones as applicable
        regenerateModifierPoolThresholds(
          globalScene.getEnemyField(),
          battle.battleType === BattleType.TRAINER ? ModifierPoolType.TRAINER : ModifierPoolType.WILD,
        );
        globalScene.generateEnemyModifiers();
        overrideModifiers(false);

        for (const enemy of globalScene.getEnemyField()) {
          overrideHeldItems(enemy, false);
        }
      }

      // Co-op HOST (#633): NOW that the enemy party's held items are attached (the sync
      // generateEnemyModifiers above), stream the full party - identity + held items - so
      // the waiting guest adopts these exact mons and SUPPRESSES its own modifier roll
      // (no double / divergent items). No-op for solo / guest / loaded.
      if (!this.loaded) {
        this.broadcastCoopEnemyParty();
      }

      if (battle.battleType === BattleType.TRAINER && globalScene.currentBattle.trainer) {
        globalScene.currentBattle.trainer.genAI(globalScene.getEnemyParty());
      }

      if (!battle.isBattleMysteryEncounter()) {
        // ER relics (#439): Lookout - queue a scout report of the lead enemy's
        // types before the fight (message-only, no-op unless the relic is held).
        erLookoutPreviewEnemy();
        // Quartermaster - on every 10th wave (skipped on a mid-wave reload so it
        // can't re-copy), the slot 5 mon copies one held item from slot 4 or 6.
        if (!this.loaded) {
          erQuartermasterTick();
          // Covenant of Rest - full team heal every 7th wave (skips the 10-wave
          // cadence so it never double-fires with the normal biome heal).
          erApplyCovenantHeal();
        }
      }

      globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
        if (this.loaded) {
          this.doEncounter();
          globalScene.resetSeed();
        } else {
          // Set weather and terrain before session gets saved
          this.trySetWeatherIfNewBiome();
          this.trySetTerrainIfNewBiome();
          // ER relics (#439/#130): Stormglass - force the player's chosen weather for
          // 5 turns at the start of EVERY battle. Runs AFTER the biome's ambient weather
          // so the chosen weather wins (mirrors #486's carried-weather override). On a
          // reload (this.loaded) the arena weather is restored from the save, so no
          // re-apply is needed. The FIRST time a held Stormglass has no chosen weather
          // yet, enqueue the one-time weather PICKER instead (it prompts, records the
          // pick via setStormglassWeather, then applies it - so the choice takes effect
          // this same battle). Path-independent: this single chokepoint fires no matter
          // how the relic was granted, so no per-grant-site prompt is needed.
          if (hasErRelic("stormglass") && getStormglassWeather() == null) {
            globalScene.phaseManager.unshiftNew("ErStormglassPickerPhase");
          } else {
            erStormglassApplyChosenWeather();
          }
          globalScene.gameData
            .saveAll(true, battle.waveIndex % 20 === 1 || (globalScene.lastSavePlayTime ?? 0) >= 1200)
            .then(success => {
              globalScene.disableMenu = false;
              if (!success) {
                return globalScene.reset(true);
              }
              this.doEncounter();
              globalScene.resetSeed();
            });
        }
      });
    });
  }

  private incrementMysteryEncounterChance(): void {
    const { battleType, waveIndex } = globalScene.currentBattle;
    if (
      globalScene.isMysteryEncounterValidForWave(battleType, waveIndex)
      && !globalScene.currentBattle.isBattleMysteryEncounter()
    ) {
      // Increment ME spawn chance if an ME could have spawned but did not
      // Only do this AFTER session has been saved to avoid duplicating increments
      globalScene.mysteryEncounterSaveData.encounterSpawnChance += WEIGHT_INCREMENT_ON_SPAWN_MISS;
    }
  }

  protected doEncounter(): void {
    globalScene.playBgm(undefined, true);
    globalScene.updateModifiers(false);
    globalScene.setFieldScale(1);

    for (const pokemon of globalScene.getPlayerParty()) {
      // Currently, a new wave is not considered a new battle if there is no arena reset
      // Therefore, we only reset wave data here
      if (pokemon) {
        pokemon.resetWaveData();
      }
    }

    const enemyField = globalScene.getEnemyField();
    globalScene.tweens.add({
      targets: [
        globalScene.arenaEnemy,
        globalScene.currentBattle.trainer,
        enemyField,
        globalScene.arenaPlayer,
        globalScene.trainer,
      ].flat(),
      x: (_target, _key, value, fieldIndex: number) => (fieldIndex < 2 + enemyField.length ? value + 300 : value - 300),
      duration: 2000,
      onComplete: () => {
        if (globalScene.currentBattle.isClassicFinalBoss) {
          this.displayFinalBossDialogue();
        } else {
          this.doEncounterCommon();
        }
      },
    });

    const encounterIntroVisuals = globalScene.currentBattle?.mysteryEncounter?.introVisuals;
    if (encounterIntroVisuals) {
      const enterFromRight = encounterIntroVisuals.enterFromRight;
      if (enterFromRight) {
        encounterIntroVisuals.x += 500;
      }
      globalScene.tweens.add({
        targets: encounterIntroVisuals,
        x: enterFromRight ? "-=200" : "+=300",
        duration: 2000,
      });
    }
  }

  getEncounterMessage(): string {
    const enemyField = globalScene.getEnemyField();

    if (globalScene.currentBattle.isClassicFinalBoss) {
      return i18next.t("battle:bossAppeared", {
        bossName: getPokemonNameWithAffix(enemyField[0]),
      });
    }

    if (globalScene.currentBattle.battleType === BattleType.TRAINER) {
      if (globalScene.currentBattle.double) {
        return i18next.t("battle:trainerAppearedDouble", {
          trainerName: globalScene.currentBattle.trainer?.getName(TrainerSlot.NONE, true),
        });
      }
      return i18next.t("battle:trainerAppeared", {
        trainerName: globalScene.currentBattle.trainer?.getName(TrainerSlot.NONE, true),
      });
    }

    return enemyField.length === 1
      ? i18next.t("battle:singleWildAppeared", {
          pokemonName: enemyField[0].getNameToRender(),
        })
      : i18next.t("battle:multiWildAppeared", {
          pokemonName1: enemyField[0].getNameToRender(),
          pokemonName2: enemyField[1].getNameToRender(),
        });
  }

  doEncounterCommon(showEncounterMessage = true) {
    this.incrementMysteryEncounterChance();

    const enemyField = globalScene.getEnemyField();

    if (globalScene.currentBattle.battleType === BattleType.WILD) {
      for (const enemyPokemon of enemyField) {
        enemyPokemon.untint(100, "Sine.easeOut");
        enemyPokemon.cry();
        enemyPokemon.showInfo();
        if (enemyPokemon.isShiny()) {
          globalScene.validateAchv(achvs.SEE_SHINY);
          erRecordAchievementShinyEncounter();
        }
      }
      globalScene.updateFieldScale();
      if (showEncounterMessage) {
        globalScene.ui.showText(this.getEncounterMessage(), null, () => this.end(), 1500);
      } else {
        this.end();
      }
    } else if (globalScene.currentBattle.battleType === BattleType.TRAINER) {
      const trainer = globalScene.currentBattle.trainer;
      trainer?.untint(100, "Sine.easeOut");
      trainer?.playAnim();

      const doSummon = () => {
        globalScene.currentBattle.started = true;
        globalScene.playBgm(undefined);
        globalScene.pbTray.showPbTray(globalScene.getPlayerParty());
        globalScene.pbTrayEnemy.showPbTray(globalScene.getEnemyParty());
        const doTrainerSummon = () => {
          this.hideEnemyTrainer();
          const availablePartyMembers = globalScene.getEnemyParty().filter(p => !p.isFainted()).length;
          globalScene.phaseManager.unshiftNew("SummonPhase", 0, false);
          if (globalScene.currentBattle.double && availablePartyMembers > 1) {
            globalScene.phaseManager.unshiftNew("SummonPhase", 1, false);
          }
          this.end();
        };
        if (showEncounterMessage) {
          globalScene.ui.showText(this.getEncounterMessage(), null, doTrainerSummon, 1500, true);
        } else {
          doTrainerSummon();
        }
      };

      const encounterMessages = trainer?.getEncounterMessages() ?? [];

      if (encounterMessages.length === 0) {
        doSummon();
      } else {
        let message = "";
        globalScene.executeWithSeedOffset(
          () => (message = randSeedItem(encounterMessages)),
          globalScene.currentBattle.waveIndex,
        );
        const showDialogueAndSummon = () => {
          globalScene.ui.showDialogue(message, trainer?.getName(TrainerSlot.NONE, true), null, () => {
            globalScene.charSprite.hide().then(() => globalScene.hideFieldOverlay(250).then(() => doSummon()));
          });
        };
        if (trainer?.config.hasCharSprite && !globalScene.ui.shouldSkipDialogue(message)) {
          globalScene
            .showFieldOverlay(500)
            .then(() =>
              globalScene.charSprite
                .showCharacter(trainer.getKey()!, getCharVariantFromDialogue(encounterMessages[0]))
                .then(() => showDialogueAndSummon()),
            ); // TODO: is this bang correct?
        } else {
          showDialogueAndSummon();
        }
      }
    } else if (globalScene.currentBattle.isBattleMysteryEncounter() && globalScene.currentBattle.mysteryEncounter) {
      const encounter = globalScene.currentBattle.mysteryEncounter;
      const introVisuals = encounter.introVisuals;
      introVisuals?.playAnim();

      if (encounter.onVisualsStart) {
        encounter.onVisualsStart();
      } else if (encounter.spriteConfigs && introVisuals) {
        // If the encounter doesn't have any special visual intro, show sparkle for shiny Pokemon
        introVisuals.playShinySparkles();
      }

      const doEncounter = () => {
        const doShowEncounterOptions = () => {
          globalScene.ui.clearText();
          globalScene.ui.getMessageHandler().hideNameText();

          globalScene.phaseManager.unshiftNew("MysteryEncounterPhase");
          this.end();
        };

        const introDialogue = encounter.dialogue.intro;
        if (showEncounterMessage && introDialogue) {
          const FIRST_DIALOGUE_PROMPT_DELAY = 750;
          let i = 0;
          const showNextDialogue = () => {
            const nextAction = i === introDialogue.length - 1 ? doShowEncounterOptions : showNextDialogue;
            const dialogue = introDialogue[i];
            const title = getEncounterText(dialogue?.speaker);
            const text = getEncounterText(dialogue.text)!;
            i++;
            if (title) {
              globalScene.ui.showDialogue(text, title, null, nextAction, 0, i === 1 ? FIRST_DIALOGUE_PROMPT_DELAY : 0);
            } else {
              globalScene.ui.showText(text, null, nextAction, i === 1 ? FIRST_DIALOGUE_PROMPT_DELAY : 0, true);
            }
          };

          if (introDialogue.length > 0) {
            showNextDialogue();
          }
        } else {
          doShowEncounterOptions();
        }
      };

      const encounterMessage = i18next.t("battle:mysteryEncounterAppeared");

      if (encounterMessage) {
        doTrainerExclamation();
        globalScene.ui.showDialogue(encounterMessage, "???", null, () => {
          globalScene.charSprite.hide().then(() => globalScene.hideFieldOverlay(250).then(() => doEncounter()));
        });
      } else {
        doEncounter();
      }
    }
  }

  end() {
    const enemyField = globalScene.getEnemyField();

    enemyField.forEach((enemyPokemon, e) => {
      if (enemyPokemon.isShiny(true)) {
        globalScene.phaseManager.unshiftNew("ShinySparklePhase", globalScene.currentBattle.arrangement.enemyOffset + e);
      }
      /** This sets Eternatus' held item to be untransferrable, preventing it from being stolen */
      if (
        enemyPokemon.species.speciesId === SpeciesId.ETERNATUS
        && (globalScene.gameMode.isBattleClassicFinalBoss(globalScene.currentBattle.waveIndex)
          || globalScene.gameMode.isEndlessMajorBoss(globalScene.currentBattle.waveIndex))
      ) {
        const enemyMBH = globalScene.findModifier(
          m => m instanceof TurnHeldItemTransferModifier,
          false,
        ) as TurnHeldItemTransferModifier;
        if (enemyMBH) {
          globalScene.removeModifier(enemyMBH, true);
          enemyMBH.setTransferrableFalse();
          globalScene.addEnemyModifier(enemyMBH);
        }
      }
    });

    if (![BattleType.TRAINER, BattleType.MYSTERY_ENCOUNTER].includes(globalScene.currentBattle.battleType)) {
      const ivScannerModifier = globalScene.findModifier(m => m instanceof IvScannerModifier);
      if (ivScannerModifier) {
        enemyField.map(p => globalScene.phaseManager.pushNew("ScanIvsPhase", p.getBattlerIndex()));
      }
    }

    if (!this.loaded) {
      const availablePartyMembers = globalScene.getPokemonAllowedInBattle();
      // Multi-format: the local player side's capacity drives how many leads summon /
      // get a switch prompt. Binary -> 1 (single) or 2 (double); triple -> 3.
      const playerCapacity = globalScene.currentBattle.arrangement.playerCapacity;
      const multiFormat = playerCapacity > 1;

      if (!availablePartyMembers[0].isOnField()) {
        globalScene.phaseManager.pushNew("SummonPhase", 0);
      }

      if (multiFormat) {
        if (availablePartyMembers.length > 1) {
          globalScene.phaseManager.pushNew("ToggleDoublePositionPhase", true);
          // Summon every additional on-field slot the side can hold (2nd, 3rd, ...).
          for (let i = 1; i < playerCapacity; i++) {
            if (availablePartyMembers.length > i && !availablePartyMembers[i].isOnField()) {
              globalScene.phaseManager.pushNew("SummonPhase", i);
            }
          }
        }
      } else {
        if (availablePartyMembers.length > 1 && availablePartyMembers[1].isOnField()) {
          globalScene.phaseManager.pushNew("ReturnPhase", 1);
        }
        globalScene.phaseManager.pushNew("ToggleDoublePositionPhase", false);
      }

      if (
        globalScene.currentBattle.battleType !== BattleType.TRAINER
        && (globalScene.currentBattle.waveIndex > 1 || !globalScene.gameMode.isDaily)
        && availablePartyMembers.length > playerCapacity
      ) {
        for (let i = 0; i < playerCapacity; i++) {
          globalScene.phaseManager.pushNew("CheckSwitchPhase", i, multiFormat);
        }
      }
    }
    handleTutorial(Tutorial.ACCESS_MENU).then(() => super.end());

    globalScene.phaseManager.pushNew("InitEncounterPhase");
  }

  protected displayFinalBossDialogue(): void {
    const { gameData, ui } = globalScene;
    const enemy = globalScene.getEnemyPokemon();

    ui.showText(
      this.getEncounterMessage(),
      null,
      () => {
        const localizationKey = "battleSpecDialogue:encounter";
        if (ui.shouldSkipDialogue(localizationKey)) {
          // Logging mirrors logging found in dialogue-ui-handler
          console.log(`Dialogue ${localizationKey} skipped`);
          this.doEncounterCommon(false);
        } else {
          const count = 5643853 + gameData.gameStats.classicSessionsPlayed;
          // The line below checks if an English ordinal is necessary or not based on whether an entry for encounterLocalizationKey exists in the language or not.
          const ordinalUsed =
            !i18next.exists(localizationKey, { fallbackLng: [] }) || i18next.resolvedLanguage === "en"
              ? i18next.t("battleSpecDialogue:key", {
                  count,
                  ordinal: true,
                })
              : "";
          const cycleCount = count.toLocaleString() + ordinalUsed;
          const cycleCountNoOrdinal = count.toLocaleString();
          const genderIndex = gameData.gender ?? PlayerGender.UNSET;
          const genderStr = PlayerGender[genderIndex].toLowerCase();
          const encounterDialogue = i18next.t(localizationKey, {
            context: genderStr,
            cycleCount,
            cycleCountNoOrdinal,
          });
          if (!gameData.getSeenDialogues()[localizationKey]) {
            gameData.saveSeenDialogue(localizationKey);
          }
          ui.showDialogue(encounterDialogue, enemy?.species.name, null, () => {
            this.doEncounterCommon(false);
          });
        }
      },
      1500,
      true,
    );
  }

  /**
   * Set biome weather if and only if this encounter is the start of a new biome.
   * @remarks
   * By using function overrides, this should happen if and only if this phase
   * is exactly a `NewBiomeEncounterPhase` or an `EncounterPhase` (to account for
   * Wave 1 of a Daily Run), but NOT `NextEncounterPhase` (which starts the next
   * wave in the same biome).
   */
  protected trySetWeatherIfNewBiome(): void {
    // ER biome identity (#439 §3): some biomes FORCE a baseline weather instead
    // of rolling the vanilla pool (e.g. Desert/Badlands sandstorm, Ice Cave snow,
    // Graveyard fog). No `user` -> permanent (turnsLeft 0), so it persists across
    // the biome's waves like any ambient biome weather.
    // ER (#486) The Storm: a weather the player chose to carry into THIS biome
    // overrides the biome's own ambient, applied once on entry. null = none.
    const carried = consumeErCarriedWeather();
    if (carried != null) {
      globalScene.arena.trySetWeather(carried as WeatherType);
      return;
    }
    const forced = erBiomeForcedWeather(globalScene.arena.biomeId);
    if (forced != null) {
      globalScene.arena.trySetWeather(forced);
      return;
    }
    globalScene.arena.setBiomeWeather();
  }

  /**
   * Set biome terrain if and only if this encounter is the start of a new biome.
   * @remarks
   * By using function overrides, this should happen if and only if this phase
   * is exactly a `NewBiomeEncounterPhase` or an `EncounterPhase` (to account for
   * Wave 1 of a Daily Run), but NOT `NextEncounterPhase` (which starts the next
   * wave in the same biome).
   */
  protected trySetTerrainIfNewBiome(): void {
    // ER biome identity (#439 §3): vanilla terrainPools are all empty, so biome
    // terrain only exists via this override (Power Plant electric, Grass/Jungle
    // grassy, Space psychic). turnsOverride 0 -> permanent, persists across waves.
    const forced = erBiomeForcedTerrain(globalScene.arena.biomeId);
    if (forced != null) {
      globalScene.arena.trySetTerrain(forced, false, undefined, 0);
      return;
    }
    globalScene.arena.setBiomeTerrain();
  }
}
