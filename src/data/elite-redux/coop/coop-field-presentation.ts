/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { fieldPositionForSlot } from "#data/battle-format";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { FieldPosition } from "#enums/field-position";
import { EnemyPokemon, Pokemon } from "#field/pokemon";
import type { PokeballTray } from "#ui/containers/pokeball-tray";
import { EnemyBattleInfo } from "#ui/enemy-battle-info";

export type CoopPresentationBoundary =
  | "launch-ready"
  | "encounter-summon"
  | "me-battle-summon"
  | "replacement-applied"
  | "turn-finalize"
  | "resync-stable"
  | "wave-start-pre-intro";

export interface CoopPresentationSeat {
  readonly pokemon: Pokemon;
  readonly slot: number;
}

export interface CoopFieldPresentationRequest {
  readonly side: "player" | "enemy";
  readonly seats: readonly CoopPresentationSeat[];
  readonly capacity: number;
  readonly boundary: CoopPresentationBoundary;
  readonly desired: "visible" | "hidden";
  /** Hide actual field-container members on this side that are absent from `seats`. */
  readonly hideStale?: boolean;
  readonly trainerDisposition?: "unchanged" | "hide-player" | "hide-enemy" | "hide-both";
}

function compactTargets(...targets: (object | null | undefined)[]): object[] {
  return targets.filter((target): target is object => target != null);
}

function isActuallyInFieldContainer(pokemon: Pokemon): boolean {
  return globalScene.field.getIndex(pokemon) >= 0;
}

/** Pokemon objects that are ACTUALLY members of the Phaser field container. */
export function getActuallyFieldedCoopPokemon(side?: "player" | "enemy"): Pokemon[] {
  // Read the container itself, not the logical party-front slices. An interrupted switch can leave a
  // predecessor in `field` after party reconciliation has already replaced/dropped it; a party-only scan
  // cannot see that orphan and therefore cannot clear its sprite or info panel.
  return globalScene.field
    .getAll()
    .filter(
      (candidate): candidate is Pokemon =>
        candidate instanceof Pokemon
        && (side === undefined || (side === "player" ? candidate.isPlayer() : candidate.isEnemy())),
    );
}

function completeTweensOf(target: object | object[]): void {
  try {
    // Advance through the remaining finite tween so Phaser applies its final values and callback. Calling
    // Tween.complete() alone only dispatches completion; it does not write the target's final properties.
    // Info panels need the actual final x/mask state or a half-finished show/hide leaves them off-screen.
    for (const tween of [...globalScene.tweens.getTweensOf(target)]) {
      if (tween.paused) {
        tween.resume();
      }
      tween.forward(Math.max(1, tween.totalDuration));
    }
  } catch {
    /* a torn-down/headless tween manager must not block the absolute visual settle */
  }
}

/** Stop presentation motion without executing tween completion callbacks. */
function killTweensOf(target: object | object[]): void {
  try {
    globalScene.tweens.killTweensOf(target);
  } catch {
    /* a torn-down/headless tween manager must not block the absolute visual settle */
  }
}

function killPresentationTweens(pokemon: Pokemon): void {
  try {
    globalScene.tweens.killTweensOf(compactTargets(pokemon, pokemon.getSprite(), pokemon.getTintSprite()));
  } catch {
    /* a torn-down/headless tween manager must not block the absolute visual settle */
  }
  // Info show/hide tweens have safe presentation-only completion callbacks and need their final x/mask
  // values. Pokemon-body tweens are killed instead because their callbacks can perform faint/leave work.
  completeTweensOf(compactTargets(pokemon.getBattleInfo(), pokemon.getBattleInfo()?.expMaskRect));
}

function hidePokemonPresentation(pokemon: Pokemon): void {
  killPresentationTweens(pokemon);
  try {
    const info = pokemon.getBattleInfo();
    info?.setVisible(false);
  } catch {
    /* headless battle-info stub */
  }
  const sprite = pokemon.getSprite();
  sprite?.setVisible(false);
  const tintSprite = pokemon.getTintSprite();
  tintSprite?.setVisible(false);
  pokemon.setVisible(false);
  pokemon.setAlpha(0);
  if (isActuallyInFieldContainer(pokemon)) {
    globalScene.field.remove(pokemon, false);
  }
}

/** Settle one trainer at its hidden, next-entrance-ready presentation state. */
export function settleCoopTrainerPresentation(which: "player" | "enemy"): void {
  if (which === "player") {
    const trainer = globalScene.trainer;
    // ShowTrainerPhase owns a tween whose completion callback ends the gameplay phase. A renderer repair
    // must never execute that callback: it can advance the queue while an authority frame is applying.
    killTweensOf(trainer);
    // ShowTrainerPhase restores `visible`, but not alpha. Keep the persistent player trainer ready for
    // its next entrance while container visibility provides the absolute hidden postcondition.
    trainer.setVisible(false).setAlpha(1);
    return;
  }

  const trainer = globalScene.currentBattle?.trainer;
  if (trainer == null) {
    return;
  }
  completeTweensOf([trainer, ...trainer.getSprites(), ...trainer.getTintSprites()]);
  // A trainer caught fully shown with no active hide tween still needs the normal hidden (+16,-16)
  // staging position so the next BattlePhase.showEnemyTrainer relative tween returns to the same base.
  if (trainer.alpha > 0) {
    trainer.x += 16;
    trainer.y -= 16;
  }
  // BattlePhase.showEnemyTrainer expects this container to remain present/visible and restores alpha via
  // its entrance tween. Set the hidden stable value directly but keep the main sprites ready for a later
  // switch-in; making those children invisible here caused the next trainer reveal to stay blank.
  trainer.setVisible(true).setAlpha(0);
  for (const sprite of trainer.getSprites()) {
    sprite.setVisible(true).setAlpha(1).clearTint();
  }
  for (const tintSprite of trainer.getTintSprites()) {
    tintSprite.setVisible(false).setAlpha(1).clearTint();
  }
}

function positionAtAuthoritativeSlot(pokemon: Pokemon, slot: number, capacity: number, side: "player" | "enemy"): void {
  const liveAlly = getActuallyFieldedCoopPokemon(side).find(mon => mon !== pokemon);
  if (liveAlly == null) {
    // Convert the object's current coordinates back to its platform base before applying the desired
    // slot offset. This avoids setFieldPosition's same-position early return stranding a reconstructed
    // object at its constructor coordinates.
    const oldOffset = pokemon.getFieldPositionOffset();
    pokemon.setPosition(pokemon.x - oldOffset[0], pokemon.y - oldOffset[1]);
    pokemon.fieldPosition = FieldPosition.CENTER;
  } else {
    const allyOffset = liveAlly.getFieldPositionOffset();
    pokemon.fieldPosition = FieldPosition.CENTER;
    pokemon.setPosition(liveAlly.x - allyOffset[0], liveAlly.y - allyOffset[1]);
  }
  void pokemon.setFieldPosition(fieldPositionForSlot(slot, capacity), 0);
}

function settleInfoImmediately(pokemon: Pokemon): void {
  try {
    pokemon.showInfo();
    const info = pokemon.getBattleInfo();
    completeTweensOf(compactTargets(info, info?.expMaskRect));
    info?.setVisible(true);
    void pokemon.updateInfo(true);
  } catch {
    /* headless battle-info stub */
  }
}

/**
 * Authoritative checkpoint reconstruction can create a Pokemon before any summon phase has called `init()`.
 * Such an object may already be in the logical/Phaser field container while still having no sprite or battle
 * info children.  Presentation recovery must materialize those children itself; merely toggling the container
 * leaves the exact live symptom this adapter exists to repair (the mon and its UI bar are both absent).
 */
export function ensureCoopPokemonPresentationNodes(pokemon: Pokemon): boolean {
  if (pokemon.getSprite() != null && pokemon.getBattleInfo() != null) {
    return false;
  }
  pokemon.init();
  return true;
}

function coopPokemonPresentationNodesReady(pokemon: Pokemon): boolean {
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

  // In production, the placeholder created by Pokemon.init() is visible but is not the requested battler.
  // Require both real caches and the live animation/texture key when Phaser exposes those inspectors.
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

function showPokemonPresentation(pokemon: Pokemon, slot: number, capacity: number, side: "player" | "enemy"): boolean {
  if (pokemon.isFainted()) {
    hidePokemonPresentation(pokemon);
    return false;
  }
  const newlyInitialized = ensureCoopPokemonPresentationNodes(pokemon);
  killPresentationTweens(pokemon);
  const newlySeated = !isActuallyInFieldContainer(pokemon);
  if (newlySeated) {
    globalScene.add.existing(pokemon);
    globalScene.field.add(pokemon);
  }
  // `isOnField()` also checks this transition flag. A renderer can retain it after a blocked/interrupted
  // ReturnPhase even though authority states that this exact object occupies the active seat. Clear only
  // that structural flag; fieldSetup would also mutate summon state/forms and is deliberately forbidden.
  pokemon.switchOutStatus = false;
  positionAtAuthoritativeSlot(pokemon, slot, capacity, side);
  if (side === "enemy") {
    const player = getActuallyFieldedCoopPokemon("player")[0];
    if (player != null) {
      globalScene.field.moveBelow(pokemon, player);
    }
    globalScene.currentBattle?.seenEnemyPartyMemberIds.add(pokemon.id);
  }
  pokemon.setVisible(true);
  pokemon.setAlpha(1);
  pokemon.setScale(pokemon.getSpriteScale());
  try {
    pokemon.disableMask();
  } catch {
    /* a half-torn presentation mask is best-effort */
  }
  const sprite = pokemon.getSprite();
  sprite?.setVisible(true);
  sprite?.setAlpha(1);
  sprite?.clearTint();
  const tintSprite = pokemon.getTintSprite();
  tintSprite?.setVisible(false);
  tintSprite?.setAlpha(1);
  tintSprite?.clearTint();
  settleInfoImmediately(pokemon);
  try {
    pokemon.playAnim();
  } catch {
    /* assets may still be completing in a headless runner */
  }
  if (pokemon instanceof EnemyPokemon) {
    try {
      const info = pokemon.getBattleInfo();
      if (info instanceof EnemyBattleInfo) {
        info.updateBossSegments(pokemon);
      }
    } catch {
      /* headless */
    }
  }
  if (newlyInitialized || newlySeated) {
    // `init()` creates the safe substitute placeholders synchronously. Load the real atlas without blocking
    // checkpoint application, and never use a summon/fieldSetup phase as an asset-loading side channel.
    void pokemon.loadAssets(false).catch(error => {
      coopWarn("resync", `presentation asset load failed pokemon=${pokemon.id} side=${side} slot=${slot}`, error);
    });
  }
  return newlySeated;
}

function settleFieldScaleImmediately(): void {
  const actuallyFielded = getActuallyFieldedCoopPokemon();
  if (actuallyFielded.length === 0) {
    return;
  }
  try {
    const highestSpriteScale = actuallyFielded.reduce(
      (highest, pokemon) => Math.max(highest, pokemon.getSpriteScale()),
      0,
    );
    if (!(highestSpriteScale > 0)) {
      return;
    }
    const fieldScale = Math.floor(Math.pow(1 / highestSpriteScale, 0.7) * 40) / 40;
    // `setFieldScale(..., true)` still creates a zero-duration tween. Completing every tween targeting the
    // shared field container can execute unrelated callbacks. Apply the same final transform directly.
    const scale = fieldScale * 6;
    const defaultWidth = globalScene.arenaBg.width * 6;
    const defaultHeight = 132 * 6;
    const scaledWidth = globalScene.arenaBg.width * scale;
    const scaledHeight = 132 * scale;
    killTweensOf(globalScene.field);
    globalScene.field.setScale(scale).setPosition((defaultWidth - scaledWidth) / 2, defaultHeight - scaledHeight);
  } catch {
    /* a torn-down/headless field container must not block the remaining presentation settle */
  }
}

/**
 * Settle one explicit authoritative field-presentation boundary. This adapter is intentionally visual only:
 * it never calls fieldSetup/resetSummonData/updateModifiers, applies abilities/tags/forms, or consumes RNG.
 */
export function settleCoopFieldPresentation(request: CoopFieldPresentationRequest): number {
  const wanted = new Set(request.seats.map(seat => seat.pokemon.id));
  if (request.hideStale) {
    for (const stale of getActuallyFieldedCoopPokemon(request.side)) {
      if (!wanted.has(stale.id)) {
        hidePokemonPresentation(stale);
      }
    }
  }

  let changed = 0;
  for (const seat of request.seats) {
    if (request.desired === "visible") {
      changed += showPokemonPresentation(seat.pokemon, seat.slot, request.capacity, request.side) ? 1 : 0;
    } else {
      const wasOnField = isActuallyInFieldContainer(seat.pokemon);
      hidePokemonPresentation(seat.pokemon);
      changed += wasOnField ? 1 : 0;
    }
  }

  if (request.trainerDisposition === "hide-player" || request.trainerDisposition === "hide-both") {
    settleCoopTrainerPresentation("player");
  }
  if (request.trainerDisposition === "hide-enemy" || request.trainerDisposition === "hide-both") {
    settleCoopTrainerPresentation("enemy");
  }
  settleFieldScaleImmediately();
  coopLog(
    "resync",
    `presentation settle boundary=${request.boundary} side=${request.side} desired=${request.desired} `
      + `ids=[${request.seats.map(seat => seat.pokemon.id).join(",")}] changed=${changed} `
      + `phase=${globalScene.phaseManager.getCurrentPhase()?.phaseName ?? "none"}`,
  );
  return changed;
}

/**
 * Materialize one immutable field boundary and do not resolve until every requested visible seat has its
 * real atlas, animation, sprite, and battle-info surface. Callers use this promise as the launch/transition
 * continuation gate; a synchronous placeholder is deliberately insufficient.
 */
export async function settleCoopFieldPresentationReady(
  request: CoopFieldPresentationRequest,
  remainsCurrent: () => boolean = () => true,
): Promise<number> {
  const scene = globalScene;
  const battle = scene.currentBattle;
  const seats = request.seats.map(seat => ({ pokemon: seat.pokemon, pokemonId: seat.pokemon.id, slot: seat.slot }));
  const immutableRequest: CoopFieldPresentationRequest = {
    ...request,
    seats: seats.map(({ pokemon, slot }) => ({ pokemon, slot })),
  };
  const lifetimeIsLive = (): boolean => {
    if (globalScene !== scene || scene.currentBattle !== battle || !remainsCurrent()) {
      return false;
    }
    const party = request.side === "player" ? scene.getPlayerParty() : scene.getEnemyParty();
    return seats.every(
      ({ pokemon, pokemonId }) => pokemon.id === pokemonId && party.some(candidate => candidate === pokemon),
    );
  };

  if (!lifetimeIsLive()) {
    throw new Error(`Co-op ${request.boundary} presentation lifetime was stale before asset materialization`);
  }

  if (request.desired === "visible") {
    const visibleSeats = seats.filter(({ pokemon }) => !pokemon.isFainted());
    for (const { pokemon } of visibleSeats) {
      ensureCoopPokemonPresentationNodes(pokemon);
    }
    const loads = await Promise.allSettled(visibleSeats.map(({ pokemon }) => pokemon.loadAssets(false)));
    if (loads.some(result => result.status === "rejected")) {
      throw new Error(`Co-op ${request.boundary} presentation could not load every requested battler atlas`);
    }
    if (!lifetimeIsLive()) {
      throw new Error(`Co-op ${request.boundary} presentation assets arrived after boundary replacement`);
    }
  }

  const changed = settleCoopFieldPresentation(immutableRequest);
  if (!lifetimeIsLive()) {
    throw new Error(`Co-op ${request.boundary} presentation was superseded while projecting assets`);
  }
  if (
    request.desired === "visible"
    && seats.some(({ pokemon }) => !pokemon.isFainted() && !coopPokemonPresentationNodesReady(pokemon))
  ) {
    throw new Error(`Co-op ${request.boundary} presentation exposed an incomplete battler surface`);
  }
  return changed;
}

function settlePokeballTrayHidden(tray: PokeballTray): boolean {
  const repaired = tray.shown || tray.visible;
  if (tray.shown) {
    // The normal SummonPhase waits for these intro tweens. The authoritative guest skips that phase, so
    // stop its entrance motion and let the canonical hide path finish its child-coordinate reset offscreen.
    killTweensOf(compactTargets(tray, ...tray.getAll()));
    tray.hide().catch(error => coopWarn("renderer", "pokeball tray cleanup failed", error));
  }
  // `hide()` deliberately takes 850ms before hiding the container. This boundary opens Command next, so
  // establish the absolute postcondition now while the harmless offscreen coordinate cleanup completes.
  tray.setVisible(false);
  return repaired;
}

/** Clear both trainer-intro party trays at the exact renderer boundary that replaces SummonPhase. */
export function settleCoopTrainerIntroTrays(): boolean {
  const repairedPlayer = settlePokeballTrayHidden(globalScene.pbTray);
  const repairedEnemy = settlePokeballTrayHidden(globalScene.pbTrayEnemy);
  if (repairedPlayer || repairedEnemy) {
    coopLog(
      "renderer",
      `authoritative trainer intro cleared pokeball trays player=${repairedPlayer} enemy=${repairedEnemy}`,
    );
  }
  return repairedPlayer || repairedEnemy;
}
