import { globalScene } from "#app/global-scene";
import { erBiomeRoutingActive } from "#data/elite-redux/er-biome-routing";
import { wavesSinceEnteredBiome } from "#data/elite-redux/er-biome-structure";
import { ER_COMPOSITE_PARTS } from "#data/elite-redux/er-composite-parts";
import { hasErGhostOverride } from "#data/elite-redux/er-ghost-teams";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  erRecordCoopLegendaryCatch,
  erRecordCoopWaveWon,
  erRecordSignatureStyleBossWin,
  evaluateTripleWaveWon,
} from "#data/elite-redux/er-social-achievement-tracker";
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
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { TrainerType } from "#enums/trainer-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { type Achv, achvs } from "#system/achv";

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
  /** The most recent player Earthquake/Surf in a double battle, for EVERYONE GET OUT. */
  lastSpreadMove?: { moveId: number; userId: number; turn: number };
  /** The turn the faint ledger below currently reflects (reset when a new turn faints). */
  faintLedgerTurn?: number;
  /** Player/enemy field mon ids that fainted on `faintLedgerTurn` (Mutually Assured Destruction). */
  playerFieldFaints?: Set<number>;
  enemyFieldFaints?: Set<number>;
  /** Realistic Flash: per-turn order tracking + whether the enemy ever moved before us. */
  flashTurn?: number;
  playerActedThisTurn?: boolean;
  playerEverActed?: boolean;
  flashFailed?: boolean;
  /** Triple Battle feats (#900): any player mon fainted this battle (Hold the Line). */
  playerFaintedThisBattle?: boolean;
  /** Triple Battle feats (#900): enemy id -> the turn it was KO'd (One-Turn Clear). */
  enemyKoTurns?: Map<number, number>;
  /** Triple Battle feats (#900): enemy id -> the player mon that KO'd it + its field slot (Center Stage). */
  enemyKoKillers?: Map<number, { userId: number; fieldIndex: number }>;
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
  // Patched in: obvious serpents the original curated list missed, plus the ER
  // Dunsparce evolutions. hasSpeciesIn() matches on root id, so the whole line
  // counts (a Gyarados resolves via its own id; Magikarp covers the pre-evo).
  SpeciesId.DUDUNSPARCE,
  SpeciesId.MAGIKARP,
  SpeciesId.GYARADOS,
  SpeciesId.TYNAMO,
  SpeciesId.EELEKTRIK,
  SpeciesId.EELEKTROSS,
  ErSpeciesId.DUDUDUNSPARCE,
  ErSpeciesId.DUDUNSPARCE_THREE_SEGMENT,
]);

/** Counter-class moves whose OHKO unlocks Super Armor. */
const SUPER_ARMOR_MOVES = new Set<number>([MoveId.COUNTER, MoveId.MIRROR_COAT, MoveId.COMEUPPANCE, MoveId.METAL_BURST]);

/** Self-immune spread moves that can wipe both foes + the ally (EVERYONE GET OUT). */
const BOARD_WIPE_MOVES = new Set<number>([MoveId.EARTHQUAKE, MoveId.SURF]);

/** Lucario (any form, incl. Mega) for End the Legend - matched on root species id. */
const LUCARIO_SPECIES = new Set<number>([SpeciesId.LUCARIO]);

/**
 * Every LIVE ability id that carries Rampage - the pure Rampage ability PLUS every
 * composite ability that bundles it (e.g. "Berserk + Rampage"). `hasAbility(RAMPAGE)`
 * alone misses the composites (they are a single distinct ability id), so for "End the
 * Legend" we precompute the full set once at load: walk ER_COMPOSITE_PARTS for any
 * composite whose parts include a Rampage draft id (directly or transitively), then map
 * those draft ids -> live ability ids via ER_ID_MAP. Computed once; just a Set lookup at use.
 */
const RAMPAGE_ABILITY_IDS: ReadonlySet<number> = (() => {
  // Draft ids that map to the live RAMPAGE ability.
  const rampageDrafts = new Set<number>();
  for (const [draft, live] of Object.entries(ER_ID_MAP.abilities)) {
    if (live === ErAbilityId.RAMPAGE) {
      rampageDrafts.add(Number(draft));
    }
  }
  // Fixpoint: a composite bears Rampage if any ER part is a Rampage-bearing draft.
  const bearingDrafts = new Set<number>(rampageDrafts);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of Object.values(ER_COMPOSITE_PARTS)) {
      if (bearingDrafts.has(entry.erAbilityId)) {
        continue;
      }
      if (entry.parts.some(part => part.kind === "er" && bearingDrafts.has(part.erAbilityId))) {
        bearingDrafts.add(entry.erAbilityId);
        changed = true;
      }
    }
  }
  // Map every bearing draft id -> its live ability id (plus pure Rampage itself).
  const liveIds = new Set<number>([ErAbilityId.RAMPAGE]);
  for (const draft of bearingDrafts) {
    const live = ER_ID_MAP.abilities[draft];
    if (typeof live === "number") {
      liveIds.add(live);
    }
  }
  return liveIds;
})();

/** True if the target's ability is Rampage or any composite that bundles it. */
function targetHasRampage(target: Pokemon): boolean {
  for (const abilityId of RAMPAGE_ABILITY_IDS) {
    if (target.hasAbility(abilityId as AbilityId)) {
      return true;
    }
  }
  return false;
}

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
      playerFieldFaints: new Set<number>(),
      enemyFieldFaints: new Set<number>(),
      flashFailed: false,
      playerEverActed: false,
      playerFaintedThisBattle: false,
      enemyKoTurns: new Map<number, number>(),
      enemyKoKillers: new Map<number, { userId: number; fieldIndex: number }>(),
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

/** A mon is "mega" if its active form's key contains "mega" (mega / mega-x / mega-y). */
function isMegaForm(pokemon: Pokemon): boolean {
  const formKey = pokemon.species.forms[pokemon.formIndex]?.formKey;
  return !!formKey && formKey.includes("mega");
}

/** True when every member of the player party is currently in a Mega form (Full on Mega Power). */
function playerTeamAllMega(): boolean {
  const party = globalScene.getPlayerParty();
  return party.length > 0 && party.every(isMegaForm);
}

/**
 * Realistic Flash: track, per turn, whether one of YOUR Pokemon has acted yet. If an
 * enemy move resolves before you have acted this turn, the run "fails" the achievement.
 * Called for every move resolution (player + enemy).
 */
function recordFlashOrder(user: Pokemon): void {
  const state = battleState();
  const turn = globalScene.currentBattle.turn;
  if (state.flashTurn !== turn) {
    state.flashTurn = turn;
    state.playerActedThisTurn = false;
  }
  if (user.isPlayer()) {
    state.playerActedThisTurn = true;
    state.playerEverActed = true;
  } else if (!state.playerActedThisTurn) {
    state.flashFailed = true;
  }
}

/** Record a faint into the per-turn ledger (resets when a new turn produces a faint). */
function recordFaintForLedger(pokemon: Pokemon): void {
  const state = battleState();
  const turn = globalScene.currentBattle.turn;
  if (state.faintLedgerTurn !== turn) {
    state.faintLedgerTurn = turn;
    state.playerFieldFaints = new Set<number>();
    state.enemyFieldFaints = new Set<number>();
  }
  (pokemon.isPlayer() ? state.playerFieldFaints : state.enemyFieldFaints)!.add(pokemon.id);
  // #900 (Hold the Line): remember that a player mon fainted at any point this battle.
  if (pokemon.isPlayer()) {
    state.playerFaintedThisBattle = true;
  }
}

/**
 * EVERYONE GET OUT: a player Earthquake/Surf this turn knocked out both foes AND the
 * surviving user's ally. Checked on every faint (the last qualifying faint trips it).
 */
function checkEveryoneGetOut(): void {
  const state = battleState();
  const spread = state.lastSpreadMove;
  if (!spread || spread.turn !== globalScene.currentBattle.turn || !globalScene.currentBattle.double) {
    return;
  }
  const playerField = globalScene.getPlayerField();
  const user = playerField.find(pokemon => pokemon?.id === spread.userId);
  if (!user || user.isFainted()) {
    return;
  }
  const enemyField = globalScene.getEnemyField();
  const allyField = playerField.filter(pokemon => pokemon && pokemon.id !== user.id);
  const enemiesDown = enemyField.length > 0 && enemyField.every(pokemon => pokemon?.isFainted());
  const allyDown = allyField.length > 0 && allyField.every(pokemon => pokemon?.isFainted());
  if (enemiesDown && allyDown) {
    globalScene.validateAchv(achvs.EVERYONE_GET_OUT);
  }
}

/**
 * Mutually Assured Destruction: the deciding turn of a double battle knocked out both of
 * your field mons AND both of theirs. Checked at the win (the ledger holds the final turn).
 */
function checkMutualDestruction(): void {
  const state = battleState();
  if (!globalScene.currentBattle.double) {
    return;
  }
  if ((state.playerFieldFaints?.size ?? 0) >= 2 && (state.enemyFieldFaints?.size ?? 0) >= 2) {
    globalScene.validateAchv(achvs.MUTUALLY_ASSURED_DESTRUCTION);
  }
}

/** Realistic Flash: at the win, award if you fought and no enemy ever moved before you. */
function checkFlash(): void {
  const state = battleState();
  if (state.playerEverActed && !state.flashFailed) {
    globalScene.validateAchv(achvs.REALISTIC_FLASH_IS_BORING);
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
  // Realistic Flash: record turn move-order for both sides before branching.
  recordFlashOrder(user);
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
    // EVERYONE GET OUT: arm a board-wipe check when a player fires Earthquake/Surf in a
    // double (it hits both foes + the ally). The faint hooks confirm the wipe.
    if (BOARD_WIPE_MOVES.has(move.id) && globalScene.currentBattle.double) {
      state.lastSpreadMove = { moveId: move.id, userId: user.id, turn: globalScene.currentBattle.turn };
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

  // #900 Center Stage: attribute an enemy KO to the player mon + field slot that dealt
  // the lethal DIRECT hit. Indirect (hazard/status) KOs aren't "personal", so they are
  // not attributed to a mon here (the faint turn itself is recorded in the faint hook).
  if (target.isFainted() && useMode !== MoveUseMode.INDIRECT) {
    battleState().enemyKoKillers?.set(target.id, { userId: user.id, fieldIndex: user.getFieldIndex() });
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
  // Super Armor: OHKO with a counter-class move (Counter / Mirror Coat / Comeuppance / Metal Burst).
  if (koFromFull && SUPER_ARMOR_MOVES.has(move.id)) {
    globalScene.validateAchv(achvs.SUPER_ARMOR);
  }
  // End the Legend: a player Lucario (any form, incl. Mega) defeats a Rampage-ability mon
  // (counts composites that bundle Rampage, e.g. "Berserk + Rampage").
  if (target.isFainted() && hasSpeciesIn(user, LUCARIO_SPECIES) && targetHasRampage(target)) {
    globalScene.validateAchv(achvs.END_THE_LEGEND);
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
  recordFaintForLedger(fainted);
  checkEveryoneGetOut();
  // #900 One-Turn Clear: note the turn each foe went down (direct + indirect).
  battleState().enemyKoTurns?.set(fainted.id, globalScene.currentBattle.turn);

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

export function erRecordAchievementPlayerFaint(fainted: Pokemon): void {
  recordFaintForLedger(fainted);
  checkEveryoneGetOut();

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

/**
 * #900 Triple Battle feats, resolved at the win. A win on a triple-format wave bumps
 * the persistent triple-win tally and unlocks the tally / faint / ghost / difficulty /
 * center-sweep / one-turn feats. The KO maps are populated by the move-damage + faint
 * hooks during the battle. No-op on any non-triple wave.
 */
function checkTripleWaveFeats(): void {
  const battle = globalScene.currentBattle;
  if (battle.arrangement.format.id !== "triple") {
    return;
  }
  const state = battleState();
  const stats = globalScene.gameData.gameStats;
  stats.tripleBattleWins = (stats.tripleBattleWins ?? 0) + 1;

  // One-Turn Clear: three (or more) foes down, all on the same turn.
  const turns = [...(state.enemyKoTurns?.values() ?? [])];
  const oneTurnClear = turns.length >= 3 && turns.every(t => t === turns[0]);

  // Center Stage: three foes personally KO'd by the SAME player mon from the center slot (index 1).
  const killers = [...(state.enemyKoKillers?.values() ?? [])];
  const centerMonSweptAll =
    killers.length >= 3 && killers.every(k => k.userId === killers[0].userId && k.fieldIndex === 1);

  const trainer = battle.trainer;
  const ghostTrainer = !!trainer && hasErGhostOverride(trainer);

  const ids = evaluateTripleWaveWon({
    isTriple: true,
    tripleWins: stats.tripleBattleWins ?? 0,
    playerFainted: !!state.playerFaintedThisBattle,
    ghostTrainer,
    difficultyHell: getErDifficulty() === "hell",
    centerMonSweptAll,
    oneTurnClear,
  });
  for (const id of ids) {
    const achv = (achvs as Record<string, Achv>)[id];
    if (achv) {
      globalScene.validateAchv(achv);
    }
  }
}

export function erRecordAchievementWaveWon(): void {
  // Mutually Assured Destruction + Realistic Flash both resolve at the win.
  checkMutualDestruction();
  checkFlash();

  // #900: Triple Battle feats, co-op wave milestones, and Signature Style all resolve
  // at the win. Each is an independent, guarded observer (co-op + signature run on both
  // clients via their own VictoryPhase; the triple check is a no-op off a triple wave).
  checkTripleWaveFeats();
  erRecordCoopWaveWon();
  erRecordSignatureStyleBossWin();

  // Squatter: deliberately linger in one biome for >= 20 waves (only meaningful in
  // ER biome-routing runs, where the per-biome wave counter resets on each entry).
  if (erBiomeRoutingActive() && wavesSinceEnteredBiome(globalScene.currentBattle.waveIndex) >= 20) {
    globalScene.validateAchv(achvs.SQUATTER);
  }

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
  // #900 Shared Triumph: a legendary caught in a co-op run (fires on both clients).
  erRecordCoopLegendaryCatch(pokemon);
  if (pokemon.species.speciesId === SpeciesId.ABSOL) {
    const state = runState();
    state.absolWarningWave = globalScene.currentBattle.waveIndex;
    state.absolWarningFailed = false;
  }
  // Dreamcatcher: catch a (wild) Cresselia. Catches only happen in wild encounters.
  if (pokemon.species.speciesId === SpeciesId.CRESSELIA) {
    globalScene.validateAchv(achvs.DREAMCATCHER);
  }
  // Incompatible Hardware: also covers a wild-caught Porygon-Z (the usual path is evolution).
  if (pokemon.species.speciesId === SpeciesId.PORYGON_Z) {
    globalScene.validateAchv(achvs.INCOMPATIBLE_HARDWARE);
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
  // battle.turn is 1-based during play (already incremented when MoveChargePhase runs),
  // so the old `=== 0` gate could never pass - SORRY_FOR_THE_WAIT was unobtainable.
  if (!instantCharge && user.isPlayer() && globalScene.currentBattle.turn === 1) {
    battleState().turnOneChargedMoves?.add(`${user.id}:${moveId}`);
  }
}

export function erRecordAchievementFormChange(pokemon: Pokemon, formKey: string): void {
  if (formKey.includes("mega") && hasSpeciesIn(pokemon, REDUX_INFERNAPE_LINE)) {
    globalScene.validateAchv(achvs.GEAR_5);
  }
  // Full on Mega Power: after a Mega change, check the WHOLE party is now Mega.
  if (formKey.includes("mega") && playerTeamAllMega()) {
    globalScene.validateAchv(achvs.FULL_ON_MEGA_POWER);
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
  // PK STARSTORM: teach Draco Meteor to a Psychic-type Pokemon.
  if (moveId === MoveId.DRACO_METEOR && pokemon.getTypes().includes(PokemonType.PSYCHIC)) {
    globalScene.validateAchv(achvs.PK_STARSTORM);
  }
}

/** Original Dragon Spirit: a DNA Splicers fusion of Reshiram + Zekrom (in either order). */
export function erRecordAchievementFusion(speciesA: number, speciesB: number): void {
  const pair = new Set<number>([speciesA, speciesB]);
  if (pair.has(SpeciesId.RESHIRAM) && pair.has(SpeciesId.ZEKROM)) {
    globalScene.validateAchv(achvs.ORIGINAL_DRAGON_SPIRIT);
  }
}

/** Incompatible Hardware: obtaining a Porygon-Z (the usual path is an evolution). */
export function erRecordAchievementEvolution(pokemon: Pokemon): void {
  if (pokemon.species.speciesId === SpeciesId.PORYGON_Z) {
    globalScene.validateAchv(achvs.INCOMPATIBLE_HARDWARE);
  }
}

/** Compleat Nightmare: a Pokemon falls asleep while you have a Darkrai on your team. */
export function erRecordAchievementStatusSet(_pokemon: Pokemon, effect: StatusEffect): void {
  if (
    effect === StatusEffect.SLEEP
    && globalScene.getPlayerParty().some(member => member.species.speciesId === SpeciesId.DARKRAI)
  ) {
    globalScene.validateAchv(achvs.COMPLEAT_NIGHTMARE);
  }
}

/** Poke Him On!: release a Pikachu. */
export function erRecordAchievementRelease(speciesId: number): void {
  if (speciesId === SpeciesId.PIKACHU) {
    globalScene.validateAchv(achvs.POKE_HIM_ON);
  }
}
