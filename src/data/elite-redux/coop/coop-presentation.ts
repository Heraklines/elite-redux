/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { isShowdownGuestFlipGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import {
  getActuallyFieldedCoopPokemon,
  settleCoopFieldPresentation,
} from "#data/elite-redux/coop/coop-field-presentation";
import { getCoopController, getCoopNetcodeMode, getCoopSessionKind } from "#data/elite-redux/coop/coop-runtime";
import type { CoopAuthoritativeBattleStateV1, CoopAuthoritativeFieldSeat } from "#data/elite-redux/coop/coop-transport";
import { swapAuthoritativeState } from "#data/elite-redux/showdown/showdown-side-swap";
import type { Pokemon } from "#field/pokemon";

/**
 * Destination-scoped projection verifier. Production scenes deliberately have no adapter and therefore
 * execute the real atlas/sprite/info-bar proof below. The in-process two-engine harness registers its
 * semantic oracle against only the headless destination scene, avoiding a process-global Vitest spy that
 * could miss an already-bound ESM import or leak into another client.
 */
export type CoopAuthoritativeProjectionAdapter = (
  scene: BattleScene,
  state: CoopAuthoritativeBattleStateV1,
) => boolean | Promise<boolean>;

const projectionAdapters = new WeakMap<BattleScene, CoopAuthoritativeProjectionAdapter>();

/** Install one explicit projection verifier for exactly one scene; returns an ownership-safe disposer. */
export function installCoopAuthoritativeProjectionAdapter(
  scene: BattleScene,
  adapter: CoopAuthoritativeProjectionAdapter,
): () => void {
  const previous = projectionAdapters.get(scene);
  projectionAdapters.set(scene, adapter);
  return () => {
    if (projectionAdapters.get(scene) !== adapter) {
      return;
    }
    if (previous == null) {
      projectionAdapters.delete(scene);
    } else {
      projectionAdapters.set(scene, previous);
    }
  };
}

function isAuthoritativeGuest(): boolean {
  return (
    getCoopController()?.role === "guest" && getCoopNetcodeMode() === "authoritative" && getCoopSessionKind() === "coop"
  );
}

/** Clear the player throw sprite when the gated guest enters its next encounter. */
export function clearCoopAuthoritativeGuestPlayerTrainer(): boolean {
  if (!isAuthoritativeGuest()) {
    return false;
  }
  const repaired = globalScene.trainer.visible;
  globalScene.trainer.setVisible(false);
  if (repaired) {
    coopLog("renderer", "cleared unmatched authoritative-guest player trainer");
  }
  return repaired;
}

/** Reassert trainer-chrome postconditions without touching Pokemon or field membership. */
export function ensureCoopAuthoritativeCommandPresentation(): void {
  if (!isAuthoritativeGuest()) {
    return;
  }

  // Player throw sprite: SummonPhase normally completes its exit tween.
  clearCoopAuthoritativeGuestPlayerTrainer();

  // Enemy trainer container: EncounterPhase.hideEnemyTrainer normally completes this
  // fade while the summon messages/animations run. Hide the container as well as snapping
  // alpha so its still-running tween cannot make it cover the command screen again. The
  // normal showEnemyTrainer path explicitly restores visibility before any later switch.
  const enemyTrainer = globalScene.currentBattle?.trainer;
  const repairedEnemyTrainer = enemyTrainer != null && (enemyTrainer.visible || enemyTrainer.alpha > 0);
  enemyTrainer?.setAlpha(0).setVisible(false);

  if (repairedEnemyTrainer) {
    coopLog("renderer", "command presentation postcondition hid stale enemy trainer");
  }
}

function projectionSlot(seat: CoopAuthoritativeFieldSeat): number {
  if (seat.side === "player") {
    return seat.bi;
  }
  return Math.max(0, seat.bi - (globalScene.currentBattle?.arrangement?.enemyOffset ?? 1));
}

function resolveProjectionSeats(
  state: CoopAuthoritativeBattleStateV1,
): { player: { pokemon: Pokemon; slot: number }[]; enemy: { pokemon: Pokemon; slot: number }[] } | null {
  const result: { player: { pokemon: Pokemon; slot: number }[]; enemy: { pokemon: Pokemon; slot: number }[] } = {
    player: [],
    enemy: [],
  };
  for (const seat of state.field) {
    const party = seat.side === "player" ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
    const pokemon = party.find(candidate => candidate.id === seat.pokemonId);
    if (pokemon == null) {
      return null;
    }
    const data = (seat.side === "player" ? state.playerParty : state.enemyParty).find(
      candidate => candidate.id === seat.pokemonId,
    );
    const projectedHp = typeof data?.hp === "number" ? data.hp : pokemon.hp;
    if (seat.presented && projectedHp > 0) {
      result[seat.side].push({ pokemon, slot: projectionSlot(seat) });
    }
  }
  return result;
}

function projectionNodesReady(pokemon: Pokemon): boolean {
  const sprite = pokemon.getSprite();
  const info = pokemon.getBattleInfo();
  if (
    !pokemon.isOnField()
    || !pokemon.visible
    || pokemon.alpha <= 0
    || sprite == null
    || !sprite.visible
    || sprite.alpha <= 0
    || info == null
    || !info.visible
    || info.alpha <= 0
  ) {
    return false;
  }
  // Production Phaser exposes both caches.  A headless structural harness may omit them; when present,
  // require the real atlas + animation rather than accepting the synchronous substitute placeholder.
  const key = pokemon.getBattleSpriteKey();
  const textures = globalScene.textures as { exists?: (value: string) => boolean } | undefined;
  const anims = globalScene.anims as { exists?: (value: string) => boolean } | undefined;
  const projectedSprite = sprite as unknown as {
    texture?: { key?: string };
    anims?: { currentAnim?: { key?: string } };
  };
  const currentAnimationKey = projectedSprite.anims?.currentAnim?.key;
  const currentTextureKey = projectedSprite.texture?.key;
  const productionCachesAvailable = textures?.exists != null || anims?.exists != null;
  const exactLiveKey =
    !productionCachesAvailable
    || (currentAnimationKey == null
      ? currentTextureKey == null || currentTextureKey === key
      : currentAnimationKey === key);
  return (
    exactLiveKey && (textures?.exists == null || textures.exists(key)) && (anims?.exists == null || anims.exists(key))
  );
}

/**
 * Await and verify the complete renderer projection for one already-checksum-converged authority state.
 * This is presentation-only: all material state was committed before entry.  The promise resolves false
 * when a required seat, atlas, sprite, or battle-info bar cannot be produced; callers then enter the
 * shared bounded terminal instead of ACKing a visually unusable continuation.
 */
export async function settleCoopAuthoritativeProjection(state: CoopAuthoritativeBattleStateV1): Promise<boolean> {
  const scene = globalScene;
  const adapter = projectionAdapters.get(scene);
  if (adapter != null) {
    try {
      const result = adapter(scene, state);
      // The headless two-client oracle is deliberately synchronous: yielding here would let its
      // process-global scene pointer move to the peer between observation and verdict, a scheduling
      // artifact that cannot occur across real browser processes. Real asynchronous adapters retain
      // the destination-owned post-await fence below.
      if (typeof result === "boolean") {
        return result && globalScene === scene;
      }
      const ready = await result;
      // A verifier is destination-owned just like the real asset wait: a scene swap while it was pending
      // invalidates the result instead of ACKing a continuation from another client context.
      return ready === true && globalScene === scene;
    } catch {
      return false;
    }
  }
  // Mechanical apply reflects host coordinates for a Showdown guest. Presentation must inspect the same
  // local orientation or it would look for each team in the opposite party and falsely terminal a valid turn.
  const localState = isShowdownGuestFlipGated() ? swapAuthoritativeState(state) : state;
  const seats = resolveProjectionSeats(localState);
  if (seats == null) {
    return false;
  }
  const wanted = [...seats.player, ...seats.enemy];
  const loads = await Promise.allSettled(wanted.map(({ pokemon }) => pokemon.loadAssets(false)));
  if (loads.some(result => result.status === "rejected") || globalScene !== scene) {
    return false;
  }
  const arrangement = globalScene.currentBattle?.arrangement;
  settleCoopFieldPresentation({
    side: "player",
    seats: seats.player,
    capacity: arrangement?.playerCapacity ?? 1,
    boundary: "turn-finalize",
    desired: "visible",
    hideStale: true,
  });
  settleCoopFieldPresentation({
    side: "enemy",
    seats: seats.enemy,
    capacity: arrangement?.enemyCapacity ?? 1,
    boundary: "turn-finalize",
    desired: "visible",
    hideStale: true,
  });
  const playerIds = new Set(seats.player.map(seat => seat.pokemon.id));
  const enemyIds = new Set(seats.enemy.map(seat => seat.pokemon.id));
  const actualPlayerIds = new Set(getActuallyFieldedCoopPokemon("player").map(pokemon => pokemon.id));
  const actualEnemyIds = new Set(getActuallyFieldedCoopPokemon("enemy").map(pokemon => pokemon.id));
  return (
    playerIds.size === actualPlayerIds.size
    && enemyIds.size === actualEnemyIds.size
    && [...playerIds].every(id => actualPlayerIds.has(id))
    && [...enemyIds].every(id => actualEnemyIds.has(id))
    && wanted.every(({ pokemon }) => projectionNodesReady(pokemon))
  );
}
