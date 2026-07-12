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
    if (info != null) {
      info.visible = false;
    }
  } catch {
    /* headless battle-info stub */
  }
  const sprite = pokemon.getSprite();
  sprite?.setVisible(false);
  if (sprite != null) {
    sprite.visible = false;
  }
  const tintSprite = pokemon.getTintSprite();
  tintSprite?.setVisible(false);
  if (tintSprite != null) {
    tintSprite.visible = false;
  }
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
    completeTweensOf(trainer);
    // ShowTrainerPhase restores `visible`, but not alpha. Keep the persistent player trainer ready for
    // its next entrance while container visibility provides the absolute hidden postcondition.
    trainer.setVisible(false).setAlpha(1);
    // Some reconstructed/headless trainer shells implement the setters as presentation stubs. Preserve the
    // same absolute postcondition on the public Phaser properties so a stale overlay cannot survive either.
    trainer.visible = false;
    trainer.alpha = 1;
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
    if (info != null) {
      info.visible = true;
    }
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
  if (sprite != null) {
    sprite.visible = true;
    sprite.alpha = 1;
  }
  const tintSprite = pokemon.getTintSprite();
  tintSprite?.setVisible(false);
  tintSprite?.setAlpha(1);
  tintSprite?.clearTint();
  if (tintSprite != null) {
    tintSprite.visible = false;
    tintSprite.alpha = 1;
  }
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
    void globalScene.setFieldScale(fieldScale, true);
    completeTweensOf(globalScene.field);
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
