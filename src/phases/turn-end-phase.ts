import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { captureCoopCheckpoint, captureCoopChecksum } from "#data/elite-redux/coop/coop-battle-engine";
import { getCoopBattleStreamer, getCoopController } from "#data/elite-redux/coop/coop-runtime";
import { endCoopRecording } from "#data/elite-redux/coop/coop-turn-recorder";
import { getErBiomeRule } from "#data/elite-redux/er-biome-rules";
import { erApplyFieldMedic } from "#data/elite-redux/er-relics";
import { TerrainType } from "#data/terrain";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { HitResult } from "#enums/hit-result";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";
import { TurnEndEvent } from "#events/battle-scene";
import type { Pokemon } from "#field/pokemon";
import {
  EnemyStatusEffectHealChanceModifier,
  EnemyTurnHealModifier,
  TurnHealModifier,
  TurnHeldItemTransferModifier,
  TurnStatusEffectModifier,
} from "#modifiers/modifier";
import { FieldPhase } from "#phases/field-phase";
import { BooleanHolder, toDmgValue } from "#utils/common";
import i18next from "i18next";

export class TurnEndPhase extends FieldPhase {
  public readonly phaseName = "TurnEndPhase";
  public upcomingInterlude = false;

  start() {
    super.start();

    globalScene.currentBattle.incrementTurn();
    globalScene.eventTarget.dispatchEvent(new TurnEndEvent(globalScene.currentBattle.turn));
    globalScene.phaseManager.dynamicQueueManager.clearLastTurnOrder();

    globalScene.phaseManager.hideAbilityBar();

    const handlePokemon = (pokemon: Pokemon) => {
      if (!pokemon.switchOutStatus) {
        pokemon.lapseTags(BattlerTagLapseType.TURN_END);

        globalScene.applyModifiers(TurnHealModifier, pokemon.isPlayer(), pokemon);

        if (globalScene.arena.terrain?.terrainType === TerrainType.GRASSY && pokemon.isGrounded()) {
          globalScene.phaseManager.unshiftNew(
            "PokemonHealPhase",
            pokemon.getBattlerIndex(),
            Math.max(pokemon.getMaxHp() >> 4, 1),
            i18next.t("battle:turnEndHpRestore", {
              pokemonName: getPokemonNameWithAffix(pokemon),
            }),
            true,
          );
        }

        // ER Toxic Terrain — grounded non-Poison Pokémon take 1/16 max HP each
        // turn (Magic Guard / Block-non-direct-damage abilities exempt them).
        if (
          globalScene.arena.terrain?.terrainType === TerrainType.TOXIC
          && pokemon.isGrounded()
          && !pokemon.getTypes(true, true).some(t => globalScene.arena.terrain?.isTypeDamageImmune(t))
        ) {
          const cancelled = new BooleanHolder(false);
          applyAbAttrs("BlockNonDirectDamageAbAttr", { pokemon, cancelled });
          if (!cancelled.value) {
            // ER custom terrain — English-only (shared locales submodule).
            globalScene.phaseManager.queueMessage(`${getPokemonNameWithAffix(pokemon)} is hurt by the toxic terrain!`);
            pokemon.damageAndUpdate(toDmgValue(pokemon.getMaxHp() / 16), {
              result: HitResult.INDIRECT,
              ignoreSegments: true,
            });
          }
        }

        // ER biome identity (#439 §3 Group E): Swamp attrition - grounded
        // non-Poison/Steel mons take 1/16 max HP each turn end from the bog
        // (Magic-Guard-class abilities exempt them, like other indirect damage).
        if (
          getErBiomeRule(globalScene.arena.biomeId)?.bogChip
          && pokemon.isGrounded()
          && !pokemon.isOfType(PokemonType.POISON)
          && !pokemon.isOfType(PokemonType.STEEL)
        ) {
          const cancelled = new BooleanHolder(false);
          applyAbAttrs("BlockNonDirectDamageAbAttr", { pokemon, cancelled });
          if (!cancelled.value) {
            // ER custom biome rule - English-only (shared locales submodule).
            globalScene.phaseManager.queueMessage(`${getPokemonNameWithAffix(pokemon)} is sapped by the bog!`);
            pokemon.damageAndUpdate(toDmgValue(pokemon.getMaxHp() / 16), {
              result: HitResult.INDIRECT,
              ignoreSegments: true,
            });
          }
        }

        if (!pokemon.isPlayer()) {
          globalScene.applyModifiers(EnemyTurnHealModifier, false, pokemon);
          globalScene.applyModifier(EnemyStatusEffectHealChanceModifier, false, pokemon);
        }

        applyAbAttrs("PostTurnAbAttr", { pokemon });
      }

      globalScene.applyModifiers(TurnStatusEffectModifier, pokemon.isPlayer(), pokemon);
      globalScene.applyModifiers(TurnHeldItemTransferModifier, pokemon.isPlayer(), pokemon);

      pokemon.tempSummonData.turnCount++;
      pokemon.tempSummonData.waveTurnCount++;
    };

    if (!this.upcomingInterlude) {
      this.executeForAll(handlePokemon);

      // ER relic (#439): Field Medic - once per turn, every 3 turns, the benched
      // player mons in party slots 2 and 3 recover 1/12 max HP (no-op unless the
      // relic is held). Runs once here, NOT per active mon, to avoid double-heal.
      erApplyFieldMedic();

      globalScene.arena.lapseTags();
    }

    if (globalScene.arena.weather && !globalScene.arena.weather.lapse()) {
      globalScene.arena.trySetWeather(WeatherType.NONE);
      globalScene.arena.triggerWeatherBasedFormChangesToNormal();
    }

    if (globalScene.arena.terrain && !globalScene.arena.terrain.lapse()) {
      globalScene.arena.trySetTerrain(TerrainType.NONE);
    }

    this.emitCoopTurn();

    this.end();
  }

  /**
   * Co-op HOST (#633, TRACK-2 Phase B): the host is the sole engine; at the settled
   * post-turn boundary it STREAMS this turn's ordered narration events (recorded since
   * TurnStart) + the authoritative checkpoint + the full-state checksum. The guest's
   * CoopReplayTurnPhase awaits + renders them. Emitted with the turn number STAMPED at
   * TurnStart (incrementTurn() already ran above, so `currentBattle.turn` is now N+1) so
   * the host's emit-turn matches the guest's await-turn exactly. Hard no-op for solo /
   * non-host; the recording is closed either way so it never leaks into the next turn.
   */
  private emitCoopTurn(): void {
    const recording = endCoopRecording();
    if (!globalScene.gameMode.isCoop) {
      return;
    }
    const controller = getCoopController();
    const streamer = getCoopBattleStreamer();
    if (controller == null || streamer == null || controller.role !== "host" || recording.turn < 0) {
      return;
    }
    try {
      const checkpoint = captureCoopCheckpoint();
      if (checkpoint != null) {
        streamer.emitTurn(recording.turn, recording.events, checkpoint, captureCoopChecksum());
      }
    } catch {
      /* a stream/capture failure must never break the host's turn */
    }
  }
}
