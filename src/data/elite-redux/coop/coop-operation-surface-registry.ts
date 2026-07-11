/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

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

const operationSurfaceSet: ReadonlySet<string> = new Set(COOP_OPERATION_SURFACES);

export function isCoopOperationSurfaceClass(value: string): value is CoopOperationSurfaceClass {
  return operationSurfaceSet.has(value);
}
