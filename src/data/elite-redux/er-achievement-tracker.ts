import { globalScene } from "#app/global-scene";
import { hasErGhostOverride } from "#data/elite-redux/er-ghost-teams";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
import { HitCheckResult } from "#enums/hit-check-result";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { ErSpeciesId } from "#enums/er-species-id";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerType } from "#enums/trainer-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { achvs } from "#system/achv";

type HitCheckEntry = readonly [HitCheckResult, number];

interface ErAchievementBattleState {
  waveIndex: number;
  beamSpamUsed?: boolean;
  beamSpamInvalid?: boolean;
  weaveStreak?: number;
  switchedInPlayerIds?: Set<number>;
  turnOneChargedMoves?: Set<string>;
  damageSourceTurn?: number;
  damageSourcesByTarget?: Map<number, Set<string>>;
}

interface ErAchievementRunState {
  absolWarningWave?: number;
  absolWarningFailed?: boolean;
}

type BattleWithErAchievements = typeof globalScene.currentBattle & {
  erAchievementState?: ErAchievementBattleState;
};

type SceneWithErAchievements = typeof globalScene & {
  erAchievementRunState?: ErAchievementRunState;
};

const REDUX_DARUMAKA_LINE = new Set<number>([
  ErSpeciesId.DARUMAKA_REDUX,
  ErSpeciesId.DARMANITAN_REDUX,
  ErSpeciesId.DARMANITAN_REDUX_AURA,
  ErSpeciesId.DARMANITAN_REDUX_BOND,
  ErSpeciesId.DARMANITAN_REDUX_BLUNDER,
]);

const REDUX_SNORLAX_LINE = new Set<number>([
  ErSpeciesId.MUNCHLAX_REDUX,
  ErSpeciesId.SNORLAX_REDUX,
  ErSpeciesId.SNORLAX_REDUX_MEGA,
]);

const REDUX_INFERNAPE_LINE = new Set<number>([
  ErSpeciesId.INFERNAPE_REDUX,
  ErSpeciesId.INFERNAPE_REDUX_B,
  ErSpeciesId.INFERNAPE_REDUX_MEGA,
]);

const FOSSIL_SPECIES = new Set<number>([
  SpeciesId.OMANYTE,
  SpeciesId.OMASTAR,
  SpeciesId.KABUTO,
  SpeciesId.KABUTOPS,
  SpeciesId.AERODACTYL,
  SpeciesId.LILEEP,
  SpeciesId.CRADILY,
  SpeciesId.ANORITH,
  SpeciesId.ARMALDO,
  SpeciesId.CRANIDOS,
  SpeciesId.RAMPARDOS,
  SpeciesId.SHIELDON,
  SpeciesId.BASTIODON,
  SpeciesId.TIRTOUGA,
  SpeciesId.CARRACOSTA,
  SpeciesId.ARCHEN,
  SpeciesId.ARCHEOPS,
  SpeciesId.TYRUNT,
  SpeciesId.TYRANTRUM,
  SpeciesId.AMAURA,
  SpeciesId.AURORUS,
  SpeciesId.DRACOZOLT,
  SpeciesId.ARCTOZOLT,
  SpeciesId.DRACOVISH,
  SpeciesId.ARCTOVISH,
]);

const SNAKELIKE_SPECIES = new Set<number>([
  SpeciesId.EKANS,
  SpeciesId.ARBOK,
  SpeciesId.ONIX,
  SpeciesId.STEELIX,
  SpeciesId.DUNSPARCE,
  SpeciesId.SEVIPER,
  SpeciesId.MILOTIC,
  SpeciesId.SNIVY,
  SpeciesId.SERVINE,
  SpeciesId.SERPERIOR,
  SpeciesId.SILICOBRA,
  SpeciesId.SANDACONDA,
  SpeciesId.DRATINI,
  SpeciesId.DRAGONAIR,
  SpeciesId.RAYQUAZA,
  SpeciesId.ZYGARDE,
]);

function battleState(): ErAchievementBattleState {
  const battle = globalScene.currentBattle as BattleWithErAchievements;
  if (!battle.erAchievementState || battle.erAchievementState.waveIndex !== battle.waveIndex) {
    battle.erAchievementState = {
      waveIndex: battle.waveIndex,
      weaveStreak: 0,
      switchedInPlayerIds: new Set<number>(),
      turnOneChargedMoves: new Set<string>(),
      damageSourcesByTarget: new Map<number, Set<string>>(),
      damageSourceTurn: battle.turn,
    };
  }
  return battle.erAchievementState;
}

function runState(): ErAchievementRunState {
  const scene = globalScene as SceneWithErAchievements;
  scene.erAchievementRunState ??= {};
  return scene.erAchievementRunState;
}

function speciesIds(pokemon: Pokemon): number[] {
  const ids = [
    pokemon.species.speciesId,
    pokemon.species.getRootSpeciesId(),
    pokemon.species.getRootSpeciesId(true),
    pokemon.fusionSpecies?.speciesId,
    pokemon.fusionSpecies?.getRootSpeciesId(),
    pokemon.fusionSpecies?.getRootSpeciesId(true),
  ];
  return ids.filter((id): id is number => id != null);
}

function hasSpeciesIn(pokemon: Pokemon, ids: ReadonlySet<number>): boolean {
  return speciesIds(pokemon).some(id => ids.has(id));
}

function hasActiveAbility(pokemon: Pokemon, abilityId: number): boolean {
  return pokemon.hasAbility(abilityId as AbilityId);
}

function isEnemyBehindScreen(target: Pokemon): boolean {
  const side = target.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
  return (
    !!globalScene.arena.getTagOnSide(ArenaTagType.REFLECT, side)
    || !!globalScene.arena.getTagOnSide(ArenaTagType.LIGHT_SCREEN, side)
    || !!globalScene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, side)
  );
}

function isBossOrGhostTrainerBattle(): boolean {
  const trainer = globalScene.currentBattle.trainer;
  return !!trainer && (trainer.config.isBoss || hasErGhostOverride(trainer));
}

function isPlayerPartySnakeOnly(): boolean {
  const usableParty = globalScene.getPlayerParty().filter(pokemon => !pokemon.isFainted());
  return usableParty.length > 0 && usableParty.every(pokemon => hasSpeciesIn(pokemon, SNAKELIKE_SPECIES));
}

function playerHasKantoNinetales(): boolean {
  return globalScene
    .getPlayerParty()
    .some(pokemon => pokemon.species.speciesId === SpeciesId.NINETALES && pokemon.formIndex === 0);
}

function battleParticipantHasAbility(abilityId: number): boolean {
  const participantIds = globalScene.currentBattle.playerParticipantIds;
  return globalScene
    .getPlayerParty()
    .some(pokemon => participantIds.has(pokemon.id) && hasActiveAbility(pokemon, abilityId));
}

function recordDamageSource(target: Pokemon, sourceKey: string): void {
  const state = battleState();
  if (state.damageSourceTurn !== globalScene.currentBattle.turn) {
    state.damageSourceTurn = globalScene.currentBattle.turn;
    state.damageSourcesByTarget = new Map<number, Set<string>>();
  }
  const sources = state.damageSourcesByTarget!.get(target.id) ?? new Set<string>();
  sources.add(sourceKey);
  state.damageSourcesByTarget!.set(target.id, sources);
  if (sources.size >= 4) {
    globalScene.validateAchv(achvs.CHAIN_REACTION);
  }
}

export function erRecordAchievementMoveResolution(
  user: Pokemon,
  move: Move,
  targets: Pokemon[],
  hitChecks: readonly HitCheckEntry[],
  useMode: MoveUseMode,
  firstHit: boolean,
): void {
  if (!firstHit) {
    return;
  }

  const state = battleState();
  if (user.isPlayer()) {
    if (move.id === MoveId.QUASH && globalScene.arena.hasTag(ArenaTagType.TRICK_ROOM)) {
      globalScene.validateAchv(achvs.HOLLOW_WICKER_BASKET);
    }
    if (globalScene.currentBattle.battleType === BattleType.TRAINER && isBossOrGhostTrainerBattle()) {
      state.beamSpamUsed = true;
      if (!move.hasFlag(MoveFlags.PULSE_MOVE)) {
        state.beamSpamInvalid = true;
      }
    }
    return;
  }

  if (move.category === MoveCategory.STATUS) {
    return;
  }

  const playerTargetIndexes = targets
    .map((target, index) => ({ target, index }))
    .filter(entry => entry.target.isPlayer());
  if (playerTargetIndexes.length === 0) {
    return;
  }

  const allPlayerTargetsMissed = playerTargetIndexes.every(({ index }) => hitChecks[index]?.[0] === HitCheckResult.MISS);
  if (allPlayerTargetsMissed) {
    state.weaveStreak = (state.weaveStreak ?? 0) + 1;
    if (state.weaveStreak >= 3) {
      globalScene.validateAchv(achvs.WEAVE_NATION_CERTIFIED);
    }
  } else {
    state.weaveStreak = 0;
  }

  const protectedPlayerTarget = playerTargetIndexes.some(
    ({ index }) => hitChecks[index]?.[0] === HitCheckResult.PROTECTED,
  );
  if (protectedPlayerTarget && move.hasAttr("FlinchAttr") && move.chance >= 100) {
    globalScene.validateAchv(achvs.HOLD_IT);
  }
}

export function erRecordAchievementMoveDamage(
  user: Pokemon,
  target: Pokemon,
  move: Move,
  useMode: MoveUseMode,
  damage: number,
  isCritical: boolean,
  targetHpBefore: number,
): void {
  if (damage <= 0) {
    return;
  }

  recordDamageSource(target, useMode === MoveUseMode.INDIRECT ? `auto:${user.id}:${move.id}` : `move:${user.id}`);

  const koFromFull = targetHpBefore === target.getMaxHp() && damage >= targetHpBefore;
  if (!user.isPlayer() || !target.isEnemy()) {
    return;
  }

  if (target.isFainted() && useMode === MoveUseMode.INDIRECT) {
    globalScene.validateAchv(achvs.AUTO_COUNTER);
  }
  if (target.isFainted() && move.id === MoveId.METEOR_MASH && hasSpeciesIn(target, FOSSIL_SPECIES)) {
    globalScene.validateAchv(achvs.JURASSIC_END);
  }
  if (target.isFainted() && user.turnData.hitCount === 5 && user.turnData.hitsLeft === 1) {
    globalScene.validateAchv(achvs.CCC_COMBO);
  }
  if (koFromFull && isEnemyBehindScreen(target)) {
    globalScene.validateAchv(achvs.SHIELD_BREAK);
  }
  if (koFromFull && isCritical && hasActiveAbility(user, AbilityId.SNIPER)) {
    globalScene.validateAchv(achvs.CRIT_MATTERED);
  }
  if (target.isBoss() && target.isFainted() && battleState().turnOneChargedMoves?.has(`${user.id}:${move.id}`)) {
    globalScene.validateAchv(achvs.SORRY_FOR_THE_WAIT);
  }
}

export function erRecordAchievementDamageAndUpdate(
  target: Pokemon,
  damage: number,
  source: Pokemon | undefined,
  result: string,
): void {
  if (damage <= 0) {
    return;
  }
  if (source && result !== "indirect") {
    return;
  }
  const sourceKey = source ? `source:${source.id}:${result}` : `field:${result}`;
  recordDamageSource(target, sourceKey);
}

export function erRecordAchievementEnemyFaint(fainted: Pokemon): void {
  const indirect = fainted.turnData.attacksReceived.length === 0;
  if (!indirect) {
    return;
  }

  if (globalScene.getPlayerField().some(pokemon => pokemon?.isActive(true) && hasSpeciesIn(pokemon, REDUX_DARUMAKA_LINE))) {
    globalScene.validateAchv(achvs.GOOD_CHIP);
  }

  const switchedIn = battleState().switchedInPlayerIds;
  if (switchedIn && globalScene.getPlayerField().some(pokemon => pokemon?.isActive(true) && switchedIn.has(pokemon.id))) {
    globalScene.validateAchv(achvs.I_JUST_GOT_HERE);
  }
}

export function erRecordAchievementPlayerFaint(): void {
  const state = runState();
  if (state.absolWarningWave != null && globalScene.currentBattle.waveIndex > state.absolWarningWave) {
    state.absolWarningFailed = true;
  }
}

export function erRecordAchievementTrainerVictory(): void {
  if (battleState().beamSpamUsed && !battleState().beamSpamInvalid && isBossOrGhostTrainerBattle()) {
    globalScene.validateAchv(achvs.BEAM_SPAM);
  }
  if (battleParticipantHasAbility(ErAbilityId.PREDATOR)) {
    globalScene.validateAchv(achvs.BACK_IN_BLOOD);
  }

  const trainerType = globalScene.currentBattle.trainer?.config.trainerType;
  if (trainerType === TrainerType.SKYLA && isPlayerPartySnakeOnly()) {
    globalScene.validateAchv(achvs.SNAKES_ON_A_PLANE);
  }
  if (
    playerHasKantoNinetales()
    && (trainerType === TrainerType.JANINE || trainerType === TrainerType.KOGA || trainerType === TrainerType.ATTICUS)
  ) {
    globalScene.validateAchv(achvs.BELIEVE_IT);
  }
}

export function erRecordAchievementWaveWon(): void {
  const state = runState();
  if (
    state.absolWarningWave != null
    && globalScene.currentBattle.waveIndex > state.absolWarningWave
    && !state.absolWarningFailed
  ) {
    globalScene.validateAchv(achvs.HEEDING_THE_WARNING);
    delete state.absolWarningWave;
    delete state.absolWarningFailed;
  }
}

export function erRecordAchievementCatch(pokemon: Pokemon): void {
  if (pokemon.species.speciesId === SpeciesId.ABSOL) {
    const state = runState();
    state.absolWarningWave = globalScene.currentBattle.waveIndex;
    state.absolWarningFailed = false;
  }
}

export function erRecordAchievementShinyEncounter(): void {
  globalScene.validateAchv(achvs.YO);
}

export function erRecordAchievementSwitchIn(pokemon: Pokemon): void {
  if (pokemon.isPlayer()) {
    battleState().switchedInPlayerIds?.add(pokemon.id);
  }
}

export function erRecordAchievementChargeMove(user: Pokemon, moveId: MoveId, instantCharge: boolean): void {
  if (!instantCharge && user.isPlayer() && globalScene.currentBattle.turn === 0) {
    battleState().turnOneChargedMoves?.add(`${user.id}:${moveId}`);
  }
}

export function erRecordAchievementFormChange(pokemon: Pokemon, formKey: string): void {
  if (formKey.includes("mega") && hasSpeciesIn(pokemon, REDUX_INFERNAPE_LINE)) {
    globalScene.validateAchv(achvs.GEAR_5);
  }
}

export function erRecordAchievementStatStage(pokemon: Pokemon, stat: Stat): void {
  if (pokemon.isPlayer() && stat === Stat.DEF && pokemon.getStatStage(stat) >= 6 && hasSpeciesIn(pokemon, REDUX_SNORLAX_LINE)) {
    globalScene.validateAchv(achvs.METAL_SLIME);
  }
}

export function erRecordAchievementLearnMove(pokemon: Pokemon, moveId: MoveId): void {
  if (pokemon.species.speciesId === SpeciesId.PALKIA && moveId === MoveId.HYPER_BEAM) {
    globalScene.validateAchv(achvs.MEGAFLARE);
  }
}
