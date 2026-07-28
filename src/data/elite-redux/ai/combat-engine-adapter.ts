/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { MAX_TERAS_PER_ARENA } from "#app/constants";
import { allMoves } from "#data/data-lists";
import {
  ER_COMBAT_CONTRACT_VERSION,
  type ErCombatCandidate,
  type ErCombatMonObservation,
  type ErCombatMoveObservation,
  type ErCombatObservation,
  type ErCombatTargetRef,
  withCanonicalCombatCandidateId,
} from "#data/elite-redux/ai/combat-contract";
import { getTypeDamageMultiplier } from "#data/type";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { Stat } from "#enums/stat";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { getMoveTargets } from "#moves/move-utils";
import { canTerastallize } from "#utils/pokemon-utils";

export interface ErCombatEarlierChoice {
  kind: ErCombatCandidate["kind"];
  id: string;
  partyIndex?: number;
  tera?: boolean;
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function snapshotMove(move: ReturnType<Pokemon["getMoveset"]>[number], slot: number): ErCombatMoveObservation {
  const data = move.getMove();
  return {
    slot,
    moveId: move.moveId,
    type: data.type,
    category: data.category,
    power: data.power,
    accuracy: data.accuracy,
    priority: data.priority,
    ppUsed: move.ppUsed,
    maxPp: move.getMovePp(),
  };
}

function snapshotMon(
  mon: Pokemon,
  knowledge: ErCombatMonObservation["knowledge"],
  partyIndex: number | null,
  activeSlot: number | null,
): ErCombatMonObservation {
  return {
    entityId: mon.id,
    knowledge,
    partyIndex,
    activeSlot,
    species: mon.species.speciesId,
    form: mon.formIndex,
    level: mon.level,
    types: safe(() => [...mon.getTypes()], []),
    hp: mon.hp,
    maxHp: safe(() => mon.getMaxHp(), 0),
    status: safe(() => mon.status?.effect ?? null, null),
    statStages: safe(() => [...mon.getStatStages()], []),
    stats: safe(
      () => ([Stat.HP, Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const).map(stat => mon.getStat(stat)),
      [],
    ),
    ability: safe<number>(() => mon.getAbility(true).id, -1),
    innates: safe(() => mon.getPassiveAbilities().map(ability => (ability == null ? null : ability.id)), []),
    heldItems: knowledge === "self" ? safe(() => mon.getHeldItems().map(item => item.type.id), []) : null,
    moves: safe(() => mon.getMoveset().map(snapshotMove), []),
    fainted: mon.isFainted(),
  };
}

export function snapshotErCombatObservation(scene: BattleScene): ErCombatObservation {
  const playerParty = scene.getPlayerParty();
  const playerField = scene.getPlayerField();
  const enemyField = scene.getEnemyField();
  return {
    version: ER_COMBAT_CONTRACT_VERSION,
    perspective: "self",
    wave: scene.currentBattle.waveIndex,
    turn: scene.currentBattle.turn,
    biome: scene.arena.biomeId,
    battleType: scene.currentBattle.battleType,
    format: scene.currentBattle.getBattlerCount(),
    weather: scene.arena.weather?.weatherType ?? null,
    terrain: scene.arena.terrain?.terrainType ?? null,
    selfParty: playerParty.map((mon, partyIndex) => {
      const activeSlot = playerField.findIndex(active => active?.id === mon.id);
      return snapshotMon(mon, "self", partyIndex, activeSlot >= 0 ? activeSlot : null);
    }),
    opponentActive: enemyField.map((mon, activeSlot) => snapshotMon(mon, "battle-info", null, activeSlot)),
    opponentRosterSize: scene.getEnemyParty().length,
    playerTerasUsed: scene.arena.playerTerasUsed,
  };
}

function targetRef(scene: BattleScene, battlerIndex: number): ErCombatTargetRef | null {
  const self = scene.getPlayerField().findIndex(mon => mon?.getBattlerIndex() === battlerIndex);
  if (self >= 0) {
    return { side: "self", entityId: scene.getPlayerField()[self].id, activeSlot: self };
  }
  const opponent = scene.getEnemyField().findIndex(mon => mon?.getBattlerIndex() === battlerIndex);
  return opponent < 0 ? null : { side: "opponent", entityId: scene.getEnemyField()[opponent].id, activeSlot: opponent };
}

function moveTargetSets(
  scene: BattleScene,
  actor: PlayerPokemon,
  moveId: MoveId,
): {
  targetMode: "resolved" | "random";
  sets: ErCombatTargetRef[][];
} {
  const move = allMoves[moveId];
  if (move.moveTarget === MoveTarget.RANDOM_NEAR_ENEMY) {
    // Calling getMoveTargets here would consume battle RNG and make observation change gameplay.
    return { targetMode: "random", sets: [[]] };
  }
  const targets = getMoveTargets(actor, moveId);
  const rawSets = targets.multiple ? [targets.targets] : targets.targets.map(target => [target]);
  return {
    targetMode: "resolved",
    sets: (rawSets.length > 0 ? rawSets : [[]]).map(set =>
      set.map(target => targetRef(scene, target)).filter((target): target is ErCombatTargetRef => target != null),
    ),
  };
}

function baseTypeMultiplier(scene: BattleScene, moveId: MoveId, targets: readonly ErCombatTargetRef[]): number {
  const moveType = allMoves[moveId].type;
  const targetMons =
    targets.length > 0
      ? targets
          .map(target =>
            (target.side === "self" ? scene.getPlayerField() : scene.getEnemyField()).find(
              mon => mon.id === target.entityId,
            ),
          )
          .filter((mon): mon is NonNullable<typeof mon> => mon != null)
      : scene.getEnemyField().filter(mon => mon.isActive(true));
  if (targetMons.length === 0) {
    return 1;
  }
  return (
    targetMons.reduce(
      (sum, target) =>
        sum + target.getTypes().reduce((multiplier, type) => multiplier * getTypeDamageMultiplier(moveType, type), 1),
      0,
    ) / targetMons.length
  );
}

function appendMoveCandidates(
  scene: BattleScene,
  actor: PlayerPokemon,
  actorSlot: number,
  canTera: boolean,
  candidates: ErCombatCandidate[],
): void {
  const usableMoves = actor
    .getMoveset()
    .map((move, moveSlot) => ({ move, moveSlot }))
    .filter(({ move }) => move.isUsable(actor, false, true)[0]);
  const moveRows =
    usableMoves.length > 0
      ? usableMoves
      : [{ move: { moveId: MoveId.STRUGGLE } as (typeof usableMoves)[number]["move"], moveSlot: -1 }];
  for (const { move, moveSlot } of moveRows) {
    const { targetMode, sets } = moveTargetSets(scene, actor, move.moveId);
    for (const targets of sets) {
      const shared = {
        kind: "move" as const,
        actorSlot,
        moveSlot,
        moveId: move.moveId,
        targetMode,
        targets,
        baseTypeMultiplier: baseTypeMultiplier(scene, move.moveId, targets),
        currentStab: actor.getTypes().includes(allMoves[move.moveId].type),
      };
      candidates.push(withCanonicalCombatCandidateId({ ...shared, tera: false }));
      if (canTera && moveSlot >= 0) {
        candidates.push(withCanonicalCombatCandidateId({ ...shared, tera: true }));
      }
    }
  }
}

function appendSwitchCandidates(
  scene: BattleScene,
  actor: PlayerPokemon,
  actorSlot: number,
  earlier: readonly ErCombatEarlierChoice[],
  candidates: ErCombatCandidate[],
): void {
  const reservedPartySlots = new Set(
    earlier
      .filter(choice => choice.kind === "switch")
      .map(choice => choice.partyIndex)
      .filter(Number.isInteger),
  );
  const canNormalSwitch = !actor.isTrapped([], true);
  const canBaton = !!scene.findModifier(
    modifier => modifier.is("SwitchEffectTransferModifier") && modifier.pokemonId === actor.id,
  );
  for (const [partyIndex, pokemon] of scene.getPlayerParty().entries()) {
    if (
      pokemon.id === actor.id
      || pokemon.isActive(true)
      || !pokemon.isAllowedInBattle()
      || reservedPartySlots.has(partyIndex)
    ) {
      continue;
    }
    if (canNormalSwitch) {
      candidates.push(withCanonicalCombatCandidateId({ kind: "switch", actorSlot, partyIndex, transfer: "normal" }));
    }
    if (canBaton) {
      candidates.push(withCanonicalCombatCandidateId({ kind: "switch", actorSlot, partyIndex, transfer: "baton" }));
    }
  }
}

function appendShiftCandidates(scene: BattleScene, actorSlot: number, candidates: ErCombatCandidate[]): void {
  if (scene.currentBattle.getBattlerCount() < 3) {
    return;
  }
  scene.getPlayerField().forEach((ally, targetActorSlot) => {
    if (targetActorSlot !== actorSlot && ally?.isActive(true)) {
      candidates.push(withCanonicalCombatCandidateId({ kind: "shift", actorSlot, targetActorSlot }));
    }
  });
}

/**
 * Enumerate the engine-legal COMBAT command candidates for one player field slot.
 * Balls and run are a separate future action domain and are intentionally not implied by this API.
 */
export function enumerateErCombatCandidates(
  scene: BattleScene,
  actorSlot: number,
  earlier: readonly ErCombatEarlierChoice[] = [],
): ErCombatCandidate[] {
  if (scene.gameMode.isCoop) {
    throw new Error("the v1 offline combat contract does not capture co-op decisions");
  }
  const actor = scene.getPlayerField()[actorSlot];
  if (!actor?.isActive(true) || actor.isFainted()) {
    return [];
  }
  const candidates: ErCombatCandidate[] = [];
  const teraAlreadyPlanned = earlier.some(choice => choice.kind === "move" && choice.tera === true);
  const canTera = canTerastallize(actor) && scene.arena.playerTerasUsed + +teraAlreadyPlanned < MAX_TERAS_PER_ARENA;
  appendMoveCandidates(scene, actor, actorSlot, canTera, candidates);
  appendSwitchCandidates(scene, actor, actorSlot, earlier, candidates);
  appendShiftCandidates(scene, actorSlot, candidates);
  return candidates;
}
