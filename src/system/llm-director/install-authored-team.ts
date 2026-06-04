import type { Battle } from "#app/battle";
import { globalScene } from "#app/global-scene";
import type { AuthoredPokemon } from "#data/llm-director/beat-schema";
import { BattleType } from "#enums/battle-type";
import { TrainerSlot } from "#enums/trainer-slot";
import type { EnemyPokemon } from "#field/pokemon";
import type { PersistentModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import type { EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import { authoredTeamToEnemyConfigs, isMapTeamFailure, type MapTeamResult } from "#system/llm-director/authored-team";
import { resolveHeldItemKey } from "#system/llm-director/held-item-resolver";

/**
 * Install an LLM-authored trainer team onto the upcoming battle. Called from
 * `NewBattlePhase` after `globalScene.newBattle()` has built the trainer for
 * the wave but BEFORE `EncounterPhase` runs `genPartyMember` for each slot.
 *
 * Side effects (all mutate the live battle/trainer):
 * 1. Replaces `trainer.config.partyMemberFuncs` so each slot returns the
 *    authored EnemyPokemon (with moveset, ability, shiny, nickname, boss
 *    flag already applied).
 * 2. Resizes the trainer's party template to match the team length so
 *    `getPartyTemplate().size` lines up with `enemyLevels.length`.
 * 3. Rewrites `battle.enemyLevels` from the authored levels.
 * 4. Replaces `trainer.config.genModifiersFunc` so the trainer's normal
 *    "rare candy + leftovers" modifier roll is replaced by the LLM's chosen
 *    held items, attached to the correct enemy in party order.
 *
 * Returns `null` on success or an error string on failure (caller logs and
 * leaves the vanilla flow untouched).
 */
export function installAuthoredTeam(battle: Battle, team: AuthoredPokemon[]): string | null {
  if (battle.battleType !== BattleType.TRAINER) {
    return "not-trainer-battle";
  }
  const trainer = battle.trainer;
  if (!trainer) {
    return "no-trainer";
  }
  const result: MapTeamResult = authoredTeamToEnemyConfigs(team, resolveHeldItemKey);
  if (isMapTeamFailure(result)) {
    return result.reason;
  }
  const configs = result.configs;
  const baseLevels = battle.enemyLevels ?? [];
  // Per-index level: prefer authored level, fall back to baseline curve.
  const finalLevels = configs.map((cfg, i) => cfg.level ?? baseLevels[i] ?? baseLevels[0] ?? 5);

  // Resize the trainer's party template so genPartyMember stops at our team length.
  const template = trainer.getPartyTemplate();
  // `template` is mutated by other paths too (see Trainer.getPartyLevels which
  // sets size=2 for doubles); we follow that pattern instead of cloning.
  template.size = configs.length;

  battle.enemyLevels = finalLevels;

  // Stash for genModifiers; we resolve to PersistentModifier[] at gen time
  // because newModifier needs a real EnemyPokemon (which doesn't exist yet
  // when this function runs).
  const heldByIndex = configs.map(c => c.modifierConfigs ?? []);

  trainer.config.partyMemberFuncs = {};
  configs.forEach((cfg, idx) => {
    trainer.config.partyMemberFuncs[idx] = (level, _strength) => {
      const useLevel = cfg.level ?? level;
      const isBoss = cfg.isBoss === true;
      const enemy: EnemyPokemon = globalScene.addEnemyPokemon(cfg.species, useLevel, TrainerSlot.TRAINER, isBoss);
      applyAuthoredFieldsToEnemy(enemy, cfg, isBoss);
      return enemy;
    };
  });

  // Override genModifiersFunc so the trainer's modifier roll yields exactly
  // the held items the LLM authored. Without this, generateEnemyModifiers
  // ignores cfg.modifierConfigs (it only honors them when called explicitly
  // with the heldModifiersConfigs argument, which EncounterPhase doesn't do
  // for non-ME trainer waves).
  trainer.config.genModifiersFunc = (party: readonly EnemyPokemon[]): PersistentModifier[] => {
    const out: PersistentModifier[] = [];
    party.forEach((enemy, i) => {
      const configs = heldByIndex[i] ?? [];
      for (const mt of configs) {
        let modifier: PokemonHeldItemModifier;
        if (mt.modifier instanceof PokemonHeldItemModifierType) {
          modifier = mt.modifier.newModifier(enemy);
        } else {
          modifier = mt.modifier as PokemonHeldItemModifier;
          modifier.pokemonId = enemy.id;
        }
        modifier.stackCount = mt.stackCount ?? 1;
        modifier.isTransferable = mt.isTransferable ?? modifier.isTransferable;
        out.push(modifier);
      }
    });
    return out;
  };

  return null;
}

function applyAuthoredFieldsToEnemy(enemy: EnemyPokemon, cfg: EnemyPokemonConfig, isBoss: boolean): void {
  if (cfg.abilityIndex != null) {
    enemy.abilityIndex = cfg.abilityIndex;
  }
  if (cfg.shiny) {
    enemy.shiny = true;
    enemy.initShinySparkle();
  }
  if (cfg.nickname) {
    // Pokemon.nickname is base64-encoded UTF-8 (matches mystery-encounter pattern).
    enemy.nickname = btoa(unescape(encodeURIComponent(cfg.nickname)));
  }
  if (isBoss) {
    const segments = globalScene.getEncounterBossSegments(
      globalScene.currentBattle.waveIndex,
      enemy.level,
      enemy.species,
      true,
    );
    enemy.setBoss(true, segments);
  }
  if (cfg.moveSet && cfg.moveSet.length > 0) {
    const moves = cfg.moveSet.map(m => new PokemonMove(m));
    enemy.moveset = moves;
    enemy.summonData.moveset = moves;
  }
  enemy.generateName();
}
