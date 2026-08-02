/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { erBadSpliceLedger } from "#data/elite-redux/abilities/bad-splice";
import { erBorrowedTimeState } from "#data/elite-redux/abilities/borrowed-time";
import { getActiveTurns, getCharge } from "#data/elite-redux/abilities/charge-stack";
import { erChivalryRedirectState } from "#data/elite-redux/abilities/chivalry";
import { erCleansingLightKoState } from "#data/elite-redux/abilities/cleansing-light";
import { erDandelionBurstUsedWave } from "#data/elite-redux/abilities/dandelion-burst";
import { getDualTypePrime } from "#data/elite-redux/abilities/dual-type-move";
import { erLastHostUsedWave } from "#data/elite-redux/abilities/last-host";
import { erLibraryState } from "#data/elite-redux/abilities/library";
import { erLifePreserverUsedWave } from "#data/elite-redux/abilities/life-preserver";
import { getRawLinkPartner } from "#data/elite-redux/abilities/link";
import {
  type NewcomerSignatureMechanicStateValue,
  snapshotNewcomerSignatureMechanics,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { getOmniformOriginal } from "#data/elite-redux/abilities/omniform-registry";
import { erQuickeningGraceUsedTurn } from "#data/elite-redux/abilities/quickening-grace";
import { erShatteredPsycheState } from "#data/elite-redux/abilities/shattered-psyche";
import { getGraftedTypes } from "#data/elite-redux/abilities/type-graft";
import { erWorldInPiecesState } from "#data/elite-redux/abilities/world-in-pieces";
import { erDeferredReviveState } from "#data/elite-redux/archetypes/post-faint-deferred-revive";
import { erRetrieverOriginalHeldItems } from "#data/elite-redux/archetypes/pre-switch-out-item-restore";
import type { Pokemon } from "#field/pokemon";

export type ErCombatPrivateStateValue = NewcomerSignatureMechanicStateValue;

export interface ErCombatPrivateMechanicSnapshot {
  effectId: string;
  sourceMoveId?: number;
  sourceEntityId?: number;
  state: ReadonlyArray<readonly [string, ErCombatPrivateStateValue]>;
}

/**
 * Read-only acting-side projection for state that cannot be recovered from
 * PokemonData, battler tags, arena tags, or modifiers. Adding a persistent ER
 * mechanic backed by a module-local map requires adding its projection here.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Each independent module-local mechanic requires an explicit projection.
export function snapshotErCombatPrivateMechanics(pokemon: Pokemon): ErCombatPrivateMechanicSnapshot[] {
  const snapshots: ErCombatPrivateMechanicSnapshot[] = [];
  const add = (
    effectId: string,
    state: ReadonlyArray<readonly [string, ErCombatPrivateStateValue]>,
    source?: { moveId?: number; entityId?: number },
  ): void => {
    snapshots.push({
      effectId,
      ...(source?.moveId == null ? {} : { sourceMoveId: source.moveId }),
      ...(source?.entityId == null ? {} : { sourceEntityId: source.entityId }),
      state,
    });
  };

  const charge = getCharge(pokemon);
  const activeTurns = getActiveTurns(pokemon);
  if (charge > 0 || activeTurns > 0) {
    add("ability-state:charge-stack", [
      ["charge", charge],
      ["activeTurns", activeTurns],
    ]);
  }

  const borrowed = erBorrowedTimeState(pokemon);
  if (borrowed) {
    add(
      "ability-state:borrowed-time",
      [
        ["holderBaseSpeed", borrowed.holderBase],
        ["partnerBaseSpeed", borrowed.partnerBase],
        ["difference", borrowed.diff],
        ["elapsed", borrowed.elapsed],
      ],
      { entityId: borrowed.partner.id },
    );
  }

  const chivalry = erChivalryRedirectState(pokemon);
  if (chivalry) {
    add(
      "relation:chivalry-redirect",
      [
        ["holderEntityId", chivalry.holderEntityId],
        ["expiryTurn", chivalry.expiryTurn],
        ["turnsLeft", chivalry.turnsLeft],
      ],
      { entityId: chivalry.holderEntityId },
    );
  }

  const dualType = getDualTypePrime(pokemon);
  if (dualType) {
    add("move-prime:dual-type", [
      ["primaryType", dualType.primaryType],
      ["secondType", dualType.secondType],
      ["physicalOnly", dualType.physicalOnly],
    ]);
  }

  const library = erLibraryState(pokemon);
  if (library) {
    add("ability-state:library", [
      ["wave", library.wave],
      ["recordedMoveIds", library.entries.map(entry => entry.moveId).join(",")],
      ["recordedFoeIds", [...library.recordedFoeIds].sort((a, b) => a - b).join(",")],
      ["castPpRemaining", library.castPpRemaining],
      ["pendingMoveId", library.pendingCast?.moveId ?? null],
      ["pendingTurn", library.pendingCast?.turnKey ?? null],
    ]);
  }

  const world = erWorldInPiecesState(pokemon);
  if (world) {
    add("ability-state:world-in-pieces", [
      ["originalTypes", world.original.join(",")],
      ["removedTypes", world.removed.join(",")],
      ["removedThisTurn", world.removedThisTurn],
    ]);
  }

  const graftedTypes = getGraftedTypes(pokemon);
  if (graftedTypes.length > 0) {
    add("ability-state:type-graft", [["types", [...graftedTypes].sort((a, b) => a - b).join(",")]]);
  }

  const link = getRawLinkPartner(pokemon);
  if (link) {
    add("relation:link", [["partnerEntityId", link.id]], { entityId: link.id });
  }

  const splice = erBadSpliceLedger(pokemon);
  if (splice.length > 0) {
    add("ability-state:bad-splice", [
      ["foes", splice.map(entry => `${entry.foeEntityId}:${entry.types.join("+")}`).join(",")],
    ]);
  }

  const omniform = getOmniformOriginal(pokemon);
  if (omniform) {
    add("ability-state:omniform", [
      ["originalSpecies", omniform.species.speciesId],
      ["originalForm", omniform.formIndex],
    ]);
  }

  const shatteredPsyche = erShatteredPsycheState(pokemon);
  if (shatteredPsyche) {
    add(
      "ability-state:shattered-psyche",
      [
        ["fired", shatteredPsyche.fired],
        ["wave", shatteredPsyche.wave],
        ["fusionPrimaryMax", shatteredPsyche.fusion?.primaryMax ?? null],
        ["fusionConstituentMax", shatteredPsyche.fusion?.constituentMax ?? null],
        ["fusionConstituentId", shatteredPsyche.fusion?.constituentId ?? null],
      ],
      shatteredPsyche.fusion ? { entityId: shatteredPsyche.fusion.constituentId } : undefined,
    );
  }

  const oneShotStates: ReadonlyArray<readonly [string, number | string | undefined]> = [
    ["ability-state:dandelion-burst", erDandelionBurstUsedWave(pokemon)],
    ["ability-state:last-host", erLastHostUsedWave(pokemon)],
    ["ability-state:life-preserver", erLifePreserverUsedWave(pokemon)],
    ["ability-state:quickening-grace", erQuickeningGraceUsedTurn(pokemon)],
  ];
  for (const [effectId, usedAt] of oneShotStates) {
    if (usedAt != null) {
      add(effectId, [["usedAt", usedAt]]);
    }
  }

  const cleansingLight = erCleansingLightKoState(pokemon);
  if (cleansingLight) {
    add("ability-state:cleansing-light", [
      ["turn", cleansingLight.key],
      ["koCount", cleansingLight.count],
    ]);
  }

  const deferredRevive = erDeferredReviveState(pokemon);
  if (deferredRevive.pendingHpFraction != null || deferredRevive.usedThisBattle) {
    add("deferred:revive", [
      ["pendingHpFraction", deferredRevive.pendingHpFraction],
      ["usedThisBattle", deferredRevive.usedThisBattle],
    ]);
  }

  const retrieverItems = erRetrieverOriginalHeldItems(pokemon);
  if (retrieverItems.length > 0) {
    add("item-restore:retriever", [
      [
        "items",
        retrieverItems
          .map(item => `${item.type.id}:${item.stackCount + item.virtualStackCount}`)
          .sort()
          .join(","),
      ],
    ]);
  }

  for (const state of snapshotNewcomerSignatureMechanics(pokemon)) {
    add(
      `ability-state:${state.effectId}`,
      state.state,
      state.sourceMoveId == null && state.sourceEntityId == null
        ? undefined
        : {
            ...(state.sourceMoveId == null ? {} : { moveId: state.sourceMoveId }),
            ...(state.sourceEntityId == null ? {} : { entityId: state.sourceEntityId }),
          },
    );
  }

  return snapshots.sort((a, b) => a.effectId.localeCompare(b.effectId));
}
