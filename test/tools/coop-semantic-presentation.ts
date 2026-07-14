/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { isShowdownGuestFlipGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import { installCoopAuthoritativeProjectionAdapter } from "#data/elite-redux/coop/coop-presentation";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { swapAuthoritativeState } from "#data/elite-redux/showdown/showdown-side-swap";
import { Pokemon } from "#field/pokemon";

interface SemanticProjection {
  readonly player: Pokemon[];
  readonly enemy: Pokemon[];
}

function resolvePresentedPokemon(scene: BattleScene, state: CoopAuthoritativeBattleStateV1): SemanticProjection | null {
  const projection: { player: Pokemon[]; enemy: Pokemon[] } = { player: [], enemy: [] };
  for (const seat of state.field) {
    const party = seat.side === "player" ? scene.getPlayerParty() : scene.getEnemyParty();
    const pokemon = party.find(candidate => candidate.id === seat.pokemonId);
    if (pokemon == null) {
      return null;
    }
    const serializedParty = seat.side === "player" ? state.playerParty : state.enemyParty;
    const serialized = serializedParty.find(candidate => candidate.id === seat.pokemonId);
    // build-only type fix, superseded by campaign v2 on merge
    const serializedHp = typeof serialized?.hp === "number" ? serialized.hp : pokemon.hp;
    if (seat.presented && serializedHp > 0) {
      projection[seat.side].push(pokemon);
    }
  }
  return projection;
}

function hasExactFieldMembership(scene: BattleScene, projection: SemanticProjection): boolean {
  const expectedPlayer = new Set(projection.player.map(pokemon => pokemon.id));
  const expectedEnemy = new Set(projection.enemy.map(pokemon => pokemon.id));
  const field = scene.field.getAll().filter((candidate): candidate is Pokemon => candidate instanceof Pokemon);
  const actualPlayer = new Set(field.filter(pokemon => pokemon.isPlayer()).map(pokemon => pokemon.id));
  const actualEnemy = new Set(field.filter(pokemon => pokemon.isEnemy()).map(pokemon => pokemon.id));
  return (
    expectedPlayer.size === actualPlayer.size
    && expectedEnemy.size === actualEnemy.size
    && [...expectedPlayer].every(id => actualPlayer.has(id))
    && [...expectedEnemy].every(id => actualEnemy.has(id))
  );
}

function hasReadySemanticNodes(pokemon: Pokemon): boolean {
  const info = pokemon.getBattleInfo();
  return pokemon.isOnField() && pokemon.visible && pokemon.alpha > 0 && info?.visible === true && info.alpha > 0;
}

/**
 * Install the semantic projection oracle used by headless engine tests. Material application still runs
 * the production field presenter before this check; the oracle never repairs or settles state itself.
 * It verifies stable-id membership, field presence, visibility, and battle-info readiness while leaving
 * atlas, animation, and pixel evidence exclusively to the built-client browser lane.
 */
export function installHeadlessCoopSemanticProjectionOracle(scene: BattleScene = globalScene): () => void {
  const semanticProjection = async (
    destination: BattleScene,
    state: CoopAuthoritativeBattleStateV1,
  ): Promise<boolean> => {
    if (destination !== scene || globalScene !== scene) {
      return false;
    }
    // Authority state is host-oriented on the wire. The Showdown guest's renderer and parties are in
    // local orientation, so semantic readiness must inspect the same side-swapped state as production.
    const localState = isShowdownGuestFlipGated() ? swapAuthoritativeState(state) : state;
    const projection = resolvePresentedPokemon(scene, localState);
    return (
      projection != null
      && hasExactFieldMembership(scene, projection)
      && [...projection.player, ...projection.enemy].every(hasReadySemanticNodes)
    );
  };
  return installCoopAuthoritativeProjectionAdapter(scene, semanticProjection);
}
