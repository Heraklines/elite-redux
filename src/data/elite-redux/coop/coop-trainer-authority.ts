/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import type { CoopSerializedTrainer } from "#data/elite-redux/coop/coop-transport";
import { TrainerSlot } from "#enums/trainer-slot";
import type { TrainerType } from "#enums/trainer-type";
import type { TrainerVariant } from "#enums/trainer-variant";
import { Trainer } from "#field/trainer";
import { trainerConfigs } from "#trainers/trainer-config";
import { randSeedItem } from "#utils/common";

function coopTrainerRenderName(
  names: NonNullable<CoopSerializedTrainer["renderNames"]>,
  slot: TrainerSlot,
  includeTitle: boolean,
): string {
  if (slot === TrainerSlot.TRAINER_PARTNER) {
    return includeTitle ? names.partnerWithTitle : names.partner;
  }
  if (slot === TrainerSlot.TRAINER) {
    return includeTitle ? names.trainerWithTitle : names.trainer;
  }
  return includeTitle ? names.noneWithTitle : names.none;
}

/** Capture the complete stable trainer identity used by authoritative encounter presentation. */
export function captureCoopTrainerAuthority(
  trainer: Trainer,
  encounterMessageSeedOffset = globalScene.currentBattle?.waveIndex ?? 0,
): CoopSerializedTrainer {
  const encounterMessages = [...trainer.getEncounterMessages()];
  let selectedEncounterMessage: string | null = null;
  if (encounterMessages.length > 0) {
    globalScene.executeWithSeedOffset(
      () => (selectedEncounterMessage = randSeedItem(encounterMessages)),
      encounterMessageSeedOffset,
    );
  }
  return {
    trainerType: trainer.config.trainerType,
    variant: trainer.variant,
    partyTemplateIndex: trainer.partyTemplateIndex,
    ...(trainer.nameKey ? { nameKey: trainer.nameKey } : {}),
    ...(trainer.partnerNameKey ? { partnerNameKey: trainer.partnerNameKey } : {}),
    ...(trainer.name ? { name: trainer.name } : {}),
    ...(trainer.partnerName ? { partnerName: trainer.partnerName } : {}),
    nameWithTitle: trainer.getName(TrainerSlot.NONE, true),
    renderNames: {
      none: trainer.getName(TrainerSlot.NONE, false),
      noneWithTitle: trainer.getName(TrainerSlot.NONE, true),
      trainer: trainer.getName(TrainerSlot.TRAINER, false),
      trainerWithTitle: trainer.getName(TrainerSlot.TRAINER, true),
      partner: trainer.getName(TrainerSlot.TRAINER_PARTNER, false),
      partnerWithTitle: trainer.getName(TrainerSlot.TRAINER_PARTNER, true),
    },
    encounterMessages,
    selectedEncounterMessage,
    victoryMessages: [...trainer.getVictoryMessages()],
    defeatMessages: [...trainer.getDefeatMessages()],
    ...(trainer.erGhostApproach ? { erGhostApproach: trainer.erGhostApproach } : {}),
    ...(trainer.erGhostAura ? { erGhostAura: trainer.erGhostAura } : {}),
    ...(trainer.erGhostFxSpeed === undefined ? {} : { erGhostFxSpeed: trainer.erGhostFxSpeed }),
    ...(trainer.erGhostFxIntensity === undefined ? {} : { erGhostFxIntensity: trainer.erGhostFxIntensity }),
  };
}

/** Build one presentation-capable trainer from an admitted authoritative descriptor. */
export function buildCoopTrainerAuthority(data: CoopSerializedTrainer): Trainer {
  if (
    !Number.isInteger(data.trainerType)
    || !Object.hasOwn(trainerConfigs, data.trainerType)
    || !Number.isInteger(data.variant)
    || !Number.isInteger(data.partyTemplateIndex)
    || data.partyTemplateIndex < 0
  ) {
    throw new Error("Malformed authoritative trainer descriptor");
  }
  const trainer = new Trainer(
    data.trainerType as TrainerType,
    data.variant as TrainerVariant,
    data.partyTemplateIndex,
    data.nameKey,
    data.partnerNameKey,
  );
  if (data.name !== undefined) {
    trainer.name = data.name;
  }
  if (data.partnerName !== undefined) {
    trainer.partnerName = data.partnerName;
  }
  if (data.renderNames !== undefined) {
    const names = { ...data.renderNames };
    trainer.getName = (slot: TrainerSlot = TrainerSlot.NONE, includeTitle = false): string =>
      coopTrainerRenderName(names, slot, includeTitle);
  } else if (data.nameWithTitle !== undefined) {
    const plainName = data.name ?? trainer.name;
    const titledName = data.nameWithTitle;
    trainer.getName = (_slot: TrainerSlot = TrainerSlot.NONE, includeTitle = false): string =>
      includeTitle ? titledName : plainName;
  }
  // Presentation selection is authoritative too. Expose only the committed line so no renderer
  // can choose a different localized/random variant even if its local RNG or account language differs.
  const selectedEncounterMessage = data.selectedEncounterMessage;
  trainer.getEncounterMessages = () => (selectedEncounterMessage == null ? [] : [selectedEncounterMessage]);
  if (data.victoryMessages !== undefined) {
    const messages = [...data.victoryMessages];
    trainer.getVictoryMessages = () => [...messages];
  }
  if (data.defeatMessages !== undefined) {
    const messages = [...data.defeatMessages];
    trainer.getDefeatMessages = () => [...messages];
  }
  trainer.erGhostApproach = data.erGhostApproach as Trainer["erGhostApproach"];
  trainer.erGhostAura = data.erGhostAura;
  trainer.erGhostFxSpeed = data.erGhostFxSpeed;
  trainer.erGhostFxIntensity = data.erGhostFxIntensity;
  return trainer;
}

/** Atomically replace a battle's locally-derived trainer with the admitted authoritative trainer. */
export function installCoopTrainerAuthority(data: CoopSerializedTrainer | null): Trainer | null {
  const battle = globalScene.currentBattle;
  if (battle == null) {
    throw new Error("Cannot install authoritative trainer without a battle");
  }
  const replacement = data == null ? null : buildCoopTrainerAuthority(data);
  const previous = battle.trainer;
  battle.trainer = replacement;
  if (previous != null && previous !== replacement) {
    globalScene.field.remove(previous, false);
    previous.destroy();
  }
  if (replacement != null) {
    globalScene.field.add(replacement);
  }
  return replacement;
}
