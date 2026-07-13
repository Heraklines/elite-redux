/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

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
  /** Required only when this operation is intentionally committed by phase/runtime code, not player input. */
  readonly systemOnlyReason?: string;
}

/**
 * Total operation -> public-UI contract. This is deliberately separate from the flat operation inventory:
 * journal/fault tests prove transport durability, while this table states which human-facing call chains
 * must reach each journal class. A new operation cannot compile until its UI boundary is reviewed.
 */
export const COOP_OPERATION_UI_CONTRACTS = {
  "op:ability": { uiModes: [UiMode.OPTION_SELECT, UiMode.PARTY, UiMode.ER_BARGAIN] },
  "op:bargain": { uiModes: [UiMode.ER_BARGAIN, UiMode.PARTY, UiMode.OPTION_SELECT] },
  "op:biome": { uiModes: [UiMode.ER_MAP, UiMode.OPTION_SELECT] },
  "op:catchFull": { uiModes: [UiMode.PARTY] },
  "op:colosseum": { uiModes: [UiMode.COLOSSEUM] },
  "op:faintSwitch": { uiModes: [UiMode.PARTY] },
  "op:learnMove": { uiModes: [UiMode.SUMMARY, UiMode.CONFIRM, UiMode.LEARN_MOVE_BATCH] },
  "op:me": { uiModes: [UiMode.MYSTERY_ENCOUNTER, UiMode.ER_QUIZ, UiMode.PARTY, UiMode.OPTION_SELECT] },
  "op:revival": { uiModes: [UiMode.PARTY] },
  "op:reward": { uiModes: [UiMode.MODIFIER_SELECT, UiMode.BIOME_SHOP, UiMode.CONFIRM, UiMode.PARTY] },
  "op:stormglass": { uiModes: [UiMode.OPTION_SELECT] },
  "op:wave": {
    uiModes: [],
    systemOnlyReason:
      "VictoryPhase commits post-battle advancement after deterministic phase completion; it has no player choice UI.",
  },
} as const satisfies Record<CoopOperationSurfaceClass, CoopOperationUiContract>;

const operationSurfaceSet: ReadonlySet<string> = new Set(COOP_OPERATION_SURFACES);

export function isCoopOperationSurfaceClass(value: string): value is CoopOperationSurfaceClass {
  return operationSurfaceSet.has(value);
}
