/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { getActuallyFieldedCoopPokemon } from "#data/elite-redux/coop/coop-field-presentation";
// biome-ignore lint/performance/noNamespaceImport: Vitest must spy on the live ESM export used by replay phases.
import * as coopPresentation from "#data/elite-redux/coop/coop-presentation";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import type { Pokemon } from "#field/pokemon";
import { vi } from "vitest";

interface SemanticProjection {
  readonly player: Pokemon[];
  readonly enemy: Pokemon[];
}

function resolvePresentedPokemon(state: CoopAuthoritativeBattleStateV1): SemanticProjection | null {
  const projection: { player: Pokemon[]; enemy: Pokemon[] } = { player: [], enemy: [] };
  for (const seat of state.field) {
    const party = seat.side === "player" ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
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

function hasExactFieldMembership(projection: SemanticProjection): boolean {
  const expectedPlayer = new Set(projection.player.map(pokemon => pokemon.id));
  const expectedEnemy = new Set(projection.enemy.map(pokemon => pokemon.id));
  const actualPlayer = new Set(getActuallyFieldedCoopPokemon("player").map(pokemon => pokemon.id));
  const actualEnemy = new Set(getActuallyFieldedCoopPokemon("enemy").map(pokemon => pokemon.id));
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
export function installHeadlessCoopSemanticProjectionOracle(): void {
  const semanticProjection = async (state: CoopAuthoritativeBattleStateV1): Promise<boolean> => {
    const projection = resolvePresentedPokemon(state);
    return (
      projection != null
      && hasExactFieldMembership(projection)
      && [...projection.player, ...projection.enemy].every(hasReadySemanticNodes)
    );
  };

  const installed = coopPresentation.settleCoopAuthoritativeProjection;
  if (vi.isMockFunction(installed)) {
    installed.mockImplementation(semanticProjection);
  } else {
    vi.spyOn(coopPresentation, "settleCoopAuthoritativeProjection").mockImplementation(semanticProjection);
  }
}
