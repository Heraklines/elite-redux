/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopOperationKind } from "#data/elite-redux/coop/coop-operation-envelope";
import { UiMode } from "#enums/ui-mode";

/**
 * Canonical inventory of every migrated authoritative operation surface. Coverage, wiring tests, and
 * diagnostics derive from this list so adding an adapter cannot silently leave those backstops stale.
 */
export const COOP_OPERATION_SURFACES = [
  "op:ability",
  "op:bargain",
  "op:biome",
  "op:catchFull",
  "op:colosseum",
  "op:faintSwitch",
  "op:learnMove",
  "op:me",
  "op:revival",
  "op:reward",
  "op:stormglass",
  "op:wave",
] as const;

export type CoopOperationSurfaceClass = (typeof COOP_OPERATION_SURFACES)[number];

export interface CoopOperationUiContract {
  /** Public UI modes whose input callbacks can commit this operation class. */
  readonly uiModes: readonly UiMode[];
  /** Exact public Phaser phase classes allowed to own those handlers. */
  readonly phaseNames: readonly string[];
  /** Required only when this operation is intentionally committed by phase/runtime code, not player input. */
  readonly systemOnlyReason?: string;
}

export type CoopV2InteractionOperationKind = Exclude<CoopOperationKind, "FAINT_SWITCH" | "WAVE_ADVANCE">;

/**
 * Address-exact public proof contracts for V2 interaction successors. These are intentionally narrower than
 * the legacy surface inventory: `op:me`, for example, cannot let an active quiz handler prove a Colosseum
 * board or an unrelated Mystery picker merely because all three historically shared one journal class.
 */
const COOP_V2_INTERACTION_UI_PROOFS = {
  ABILITY_PRESENT: {
    uiModes: [UiMode.OPTION_SELECT, UiMode.PARTY, UiMode.ER_BARGAIN, UiMode.MESSAGE],
    phaseNames: ["ErAbilityCapsulePhase", "ErGreaterAbilityCapsulePhase", "ErGreaterAbilityRandomizerPhase"],
  },
  ABILITY_PICK: {
    uiModes: [UiMode.OPTION_SELECT, UiMode.PARTY, UiMode.ER_BARGAIN],
    phaseNames: [
      "ErAbilityCapsulePhase",
      "ErGreaterAbilityCapsulePhase",
      "ErGreaterAbilityRandomizerPhase",
      "SelectModifierPhase",
      "BiomeShopPhase",
      "TheBargainPhase",
    ],
  },
  BARGAIN_PRESENT: {
    uiModes: [UiMode.ER_BARGAIN, UiMode.MESSAGE],
    phaseNames: ["TheBargainPhase"],
  },
  BARGAIN: {
    uiModes: [UiMode.ER_BARGAIN, UiMode.PARTY, UiMode.OPTION_SELECT],
    phaseNames: ["TheBargainPhase"],
  },
  BIOME_PICK: {
    uiModes: [UiMode.ER_MAP, UiMode.OPTION_SELECT],
    phaseNames: ["SelectBiomePhase"],
  },
  CATCH_FULL: {
    uiModes: [UiMode.PARTY],
    phaseNames: ["AttemptCapturePhase", "CoopGuestCatchFullPhase", "CoopReplayMePhase"],
  },
  COLO_PICK: {
    uiModes: [UiMode.COLOSSEUM],
    phaseNames: ["ColosseumChoicePhase", "CoopGuestColosseumChoicePhase"],
  },
  CROSSROADS_PICK: {
    uiModes: [UiMode.OPTION_SELECT],
    phaseNames: ["ErCrossroadsPhase"],
  },
  LEARN_MOVE: {
    uiModes: [UiMode.SUMMARY, UiMode.CONFIRM],
    phaseNames: ["LearnMovePhase", "CoopReplayLearnMovePhase"],
  },
  LEARN_MOVE_BATCH: {
    uiModes: [UiMode.LEARN_MOVE_BATCH],
    phaseNames: ["LearnMoveBatchPhase", "CoopReplayLearnMoveBatchPhase"],
  },
  ME_BUTTON: {
    uiModes: [UiMode.MYSTERY_ENCOUNTER, UiMode.PARTY, UiMode.OPTION_SELECT],
    phaseNames: ["MysteryEncounterPhase", "CoopReplayMePhase"],
  },
  ME_PICK: {
    uiModes: [UiMode.MYSTERY_ENCOUNTER, UiMode.PARTY, UiMode.OPTION_SELECT],
    phaseNames: ["MysteryEncounterPhase", "CoopReplayMePhase"],
  },
  ME_PRESENT: {
    uiModes: [UiMode.MYSTERY_ENCOUNTER, UiMode.PARTY, UiMode.OPTION_SELECT, UiMode.MESSAGE],
    phaseNames: ["MysteryEncounterPhase", "CoopReplayMePhase"],
  },
  ME_SUB: {
    uiModes: [UiMode.MYSTERY_ENCOUNTER, UiMode.PARTY, UiMode.OPTION_SELECT],
    phaseNames: ["MysteryEncounterPhase", "CoopReplayMePhase"],
  },
  ME_TERMINAL: {
    uiModes: [
      UiMode.MODIFIER_SELECT,
      UiMode.BIOME_SHOP,
      UiMode.CONFIRM,
      UiMode.PARTY,
      UiMode.ER_MAP,
      UiMode.OPTION_SELECT,
    ],
    phaseNames: [
      "SelectModifierPhase",
      "BiomeShopPhase",
      "ExoticShopPhase",
      "BlackMarketShopPhase",
      "ImportBazaarShopPhase",
      "SelectBiomePhase",
    ],
  },
  QUIZ_ANSWER: {
    uiModes: [UiMode.ER_QUIZ, UiMode.MESSAGE],
    phaseNames: ["ErQuizPhase", "CoopReplayMePhase"],
  },
  REVIVAL: {
    uiModes: [UiMode.PARTY],
    phaseNames: ["RevivalBlessingPhase", "CoopGuestRevivalPhase", "CoopReplayMePhase"],
  },
  REWARD: {
    uiModes: [UiMode.MODIFIER_SELECT, UiMode.CONFIRM, UiMode.PARTY],
    phaseNames: ["SelectModifierPhase"],
  },
  REWARD_PRESENT: {
    uiModes: [UiMode.MODIFIER_SELECT, UiMode.CONFIRM, UiMode.PARTY],
    phaseNames: ["SelectModifierPhase"],
  },
  SHOP_PRESENT: {
    uiModes: [UiMode.BIOME_SHOP, UiMode.CONFIRM, UiMode.PARTY, UiMode.MESSAGE],
    phaseNames: ["BiomeShopPhase", "ExoticShopPhase", "BlackMarketShopPhase", "ImportBazaarShopPhase"],
  },
  SHOP_BUY: {
    uiModes: [UiMode.BIOME_SHOP, UiMode.CONFIRM, UiMode.PARTY, UiMode.MESSAGE],
    phaseNames: ["BiomeShopPhase", "ExoticShopPhase", "BlackMarketShopPhase", "ImportBazaarShopPhase"],
  },
  STORMGLASS_PRESENT: {
    uiModes: [UiMode.OPTION_SELECT, UiMode.MESSAGE],
    phaseNames: ["ErStormglassPickerPhase"],
  },
  STORMGLASS: {
    uiModes: [UiMode.OPTION_SELECT],
    phaseNames: ["ErStormglassPickerPhase"],
  },
} as const satisfies Record<CoopV2InteractionOperationKind, CoopOperationUiContract>;

const COOP_V2_INTERACTION_SOURCE_SURFACES = {
  ABILITY_PRESENT: "op:ability",
  ABILITY_PICK: "op:ability",
  BARGAIN_PRESENT: "op:bargain",
  BARGAIN: "op:bargain",
  BIOME_PICK: "op:biome",
  CATCH_FULL: "op:catchFull",
  COLO_PICK: "op:colosseum",
  CROSSROADS_PICK: "op:biome",
  LEARN_MOVE: "op:learnMove",
  LEARN_MOVE_BATCH: "op:learnMove",
  ME_BUTTON: "op:me",
  ME_PICK: "op:me",
  ME_PRESENT: "op:me",
  ME_SUB: "op:me",
  ME_TERMINAL: "op:me",
  QUIZ_ANSWER: "op:me",
  REVIVAL: "op:revival",
  REWARD: "op:reward",
  REWARD_PRESENT: "op:reward",
  SHOP_BUY: "op:reward",
  SHOP_PRESENT: "op:reward",
  STORMGLASS_PRESENT: "op:stormglass",
  STORMGLASS: "op:stormglass",
} as const satisfies Record<CoopV2InteractionOperationKind, CoopOperationSurfaceClass>;

/** Exact legacy source carrier for one closed V2 interaction kind. */
export function coopV2InteractionSourceSurface(
  operationKind: CoopV2InteractionOperationKind,
): CoopOperationSurfaceClass {
  return COOP_V2_INTERACTION_SOURCE_SURFACES[operationKind];
}

/**
 * Resolve a control proof only for a semantically valid destination tuple. `ME_TERMINAL` is the sole
 * cross-surface successor: its immutable destination may open a reward or biome surface.
 */
export function coopV2InteractionUiProofContract(
  surfaceClass: Exclude<CoopOperationSurfaceClass, "op:faintSwitch" | "op:wave">,
  operationKind: CoopV2InteractionOperationKind,
): CoopOperationUiContract | null {
  const source = COOP_V2_INTERACTION_SOURCE_SURFACES[operationKind];
  if (
    surfaceClass !== source
    && !(operationKind === "ME_TERMINAL" && (surfaceClass === "op:reward" || surfaceClass === "op:biome"))
  ) {
    return null;
  }
  return COOP_V2_INTERACTION_UI_PROOFS[operationKind];
}

/**
 * Total operation -> public-UI contract. This is deliberately separate from the flat operation inventory:
 * journal/fault tests prove transport durability, while this table states which human-facing call chains
 * must reach each journal class. A new operation cannot compile until its UI boundary is reviewed.
 */
export const COOP_OPERATION_UI_CONTRACTS = {
  "op:ability": {
    uiModes: [UiMode.OPTION_SELECT, UiMode.PARTY, UiMode.ER_BARGAIN],
    phaseNames: [
      "ErAbilityCapsulePhase",
      "ErGreaterAbilityCapsulePhase",
      "ErGreaterAbilityRandomizerPhase",
      "SelectModifierPhase",
      "BiomeShopPhase",
      "TheBargainPhase",
    ],
  },
  "op:bargain": {
    uiModes: [UiMode.ER_BARGAIN, UiMode.PARTY, UiMode.OPTION_SELECT],
    phaseNames: ["TheBargainPhase"],
  },
  "op:biome": {
    uiModes: [UiMode.ER_MAP, UiMode.OPTION_SELECT],
    phaseNames: ["SelectBiomePhase", "ErCrossroadsPhase"],
  },
  "op:catchFull": {
    uiModes: [UiMode.PARTY],
    phaseNames: ["AttemptCapturePhase", "CoopGuestCatchFullPhase", "CoopReplayMePhase"],
  },
  "op:colosseum": {
    uiModes: [UiMode.COLOSSEUM],
    phaseNames: ["ColosseumChoicePhase", "CoopGuestColosseumChoicePhase"],
  },
  "op:faintSwitch": {
    uiModes: [UiMode.PARTY],
    phaseNames: ["SwitchPhase", "CoopGuestFaintSwitchPhase", "ShowdownEnemyFaintSwitchPhase"],
  },
  "op:learnMove": {
    uiModes: [UiMode.SUMMARY, UiMode.CONFIRM, UiMode.LEARN_MOVE_BATCH],
    phaseNames: ["LearnMovePhase", "LearnMoveBatchPhase", "CoopReplayLearnMovePhase", "CoopReplayLearnMoveBatchPhase"],
  },
  "op:me": {
    uiModes: [UiMode.MYSTERY_ENCOUNTER, UiMode.ER_QUIZ, UiMode.PARTY, UiMode.OPTION_SELECT],
    phaseNames: ["MysteryEncounterPhase", "CoopReplayMePhase", "ErQuizPhase"],
  },
  "op:revival": {
    uiModes: [UiMode.PARTY],
    phaseNames: ["RevivalBlessingPhase", "CoopGuestRevivalPhase", "CoopReplayMePhase"],
  },
  "op:reward": {
    uiModes: [UiMode.MODIFIER_SELECT, UiMode.BIOME_SHOP, UiMode.CONFIRM, UiMode.PARTY],
    phaseNames: [
      "SelectModifierPhase",
      "BiomeShopPhase",
      "ExoticShopPhase",
      "BlackMarketShopPhase",
      "ImportBazaarShopPhase",
    ],
  },
  "op:stormglass": {
    uiModes: [UiMode.OPTION_SELECT],
    phaseNames: ["ErStormglassPickerPhase"],
  },
  "op:wave": {
    uiModes: [],
    phaseNames: [],
    systemOnlyReason:
      "VictoryPhase commits post-battle advancement after deterministic phase completion; it has no player choice UI.",
  },
} as const satisfies Record<CoopOperationSurfaceClass, CoopOperationUiContract>;

const operationSurfaceSet: ReadonlySet<string> = new Set(COOP_OPERATION_SURFACES);

export function isCoopOperationSurfaceClass(value: string): value is CoopOperationSurfaceClass {
  return operationSurfaceSet.has(value);
}
