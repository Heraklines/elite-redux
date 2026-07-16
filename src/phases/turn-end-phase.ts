import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { fieldPositionForSlot } from "#data/battle-format";
import { isCoopRecording } from "#data/elite-redux/coop/coop-turn-recorder";
import { getErBiomeRule } from "#data/elite-redux/er-biome-rules";
import { erApplyFieldMedic } from "#data/elite-redux/er-relics";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
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

    // Install the immutable commit sentinel before any TurnEnd work can unshift a child phase.
    // Every delayed mutation queued below (and every grandchild it queues) will therefore run
    // in front of the sentinel, while the sentinel remains in front of the pre-existing
    // Faint/Victory/next-turn tail.
    if (isCoopRecording()) {
      globalScene.phaseManager.queueCoopTurnCommitPhase();
    }

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
        // Poison Heal (ER 2.65 dex: "Also prevents damage from Toxic terrain.")
        // is likewise immune to the chip.
        if (
          globalScene.arena.terrain?.terrainType === TerrainType.TOXIC
          && pokemon.isGrounded()
          && !pokemon.hasAbility(AbilityId.POISON_HEAL)
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

        // ER Lake (#439 §3): calm waters - the player's active mons recover a
        // small fraction of max HP each turn end (e.g. 1/16). Player side only,
        // skips full-HP / fainted mons. Gated on the biome rule.
        const perTurnHeal = getErBiomeRule(globalScene.arena.biomeId)?.perTurnHealFraction;
        if (perTurnHeal && pokemon.isPlayer() && !pokemon.isFullHp() && pokemon.hp > 0) {
          globalScene.phaseManager.unshiftNew(
            "PokemonHealPhase",
            pokemon.getBattlerIndex(),
            Math.max(Math.floor(pokemon.getMaxHp() * perTurnHeal), 1),
            i18next.t("battle:turnEndHpRestore", {
              pokemonName: getPokemonNameWithAffix(pokemon),
            }),
            true,
          );
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

    // ER Stench (1): Toxic Terrain turns do NOT decrease while a Stench holder is
    // on the field (the terrain can still be removed/displaced by another setter).
    // Freeze the lapse for TOXIC terrain in that case; everything else lapses.
    const activeTerrain = globalScene.arena.terrain;
    if (activeTerrain) {
      const stenchFreezesToxic =
        activeTerrain.terrainType === TerrainType.TOXIC
        && globalScene.getField(true).some(p => p?.hasAbility(AbilityId.STENCH));
      if (!stenchFreezesToxic && !activeTerrain.lapse()) {
        globalScene.arena.trySetTerrain(TerrainType.NONE);
      }
    }

    this.erAutoShiftNonAdjacentSurvivors();

    this.end();
  }

  /**
   * Triple+ end-of-turn rule: when a side has exactly TWO active mons left and they are
   * NON-adjacent (the two wings, with a fainted centre), they close ranks toward the centre so
   * they become adjacent again - the mainline "both shift to the centre" behaviour. This is a
   * pure REPOSITION (swap the party entries + move the sprite); it triggers no switch side-
   * effects. Binary battles never reach this (a side has no non-adjacent pair), so singles and
   * doubles are unaffected.
   */
  private erAutoShiftNonAdjacentSurvivors(): void {
    const arrangement = globalScene.currentBattle?.arrangement;
    if (!arrangement) {
      return;
    }
    for (const isPlayer of [true, false]) {
      const capacity = isPlayer ? arrangement.playerCapacity : arrangement.enemyCapacity;
      if (capacity < 3) {
        continue;
      }
      const party = isPlayer ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
      const active = party
        .slice(0, capacity)
        .map((p, i) => ({ p, i }))
        .filter(x => x.p?.isActive(true));
      if (active.length !== 2) {
        continue;
      }
      // Do not transpose field slots while a legal reserve can still refill the vacancy.
      // FaintPhase queues the replacement against the FAINTED slot's fieldIndex, but that
      // SwitchSummonPhase runs after TurnEnd. Moving a wing survivor into the empty centre
      // here changes which Pokemon that queued fieldIndex resolves to: the replacement then
      // benches the healthy survivor and leaves the fainted mon in the wing (the live 3v2
      // report, most visible when another foe voluntarily switched in the same turn).
      // Only close ranks when the side will genuinely remain at two battlers.
      if (party.slice(capacity).some(p => p?.isAllowedInBattle())) {
        continue;
      }
      const [lo, hi] = active; // lo.i < hi.i
      if (
        arrangement.isAdjacent(arrangement.locate(lo.p.getBattlerIndex()), arrangement.locate(hi.p.getBattlerIndex()))
      ) {
        continue; // already adjacent - nothing to do
      }
      // Non-adjacent wings (slots 0 and 2). Slide the higher survivor into the empty centre slot
      // (between them) so the pair is adjacent again; the fainted centre mon takes the vacated slot.
      const centre = lo.i + 1;
      [party[centre], party[hi.i]] = [party[hi.i], party[centre]];
      void hi.p.setFieldPosition(fieldPositionForSlot(centre, capacity), 500);
    }
  }
}
