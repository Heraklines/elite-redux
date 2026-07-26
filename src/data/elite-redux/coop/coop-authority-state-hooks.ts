/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";

/**
 * Engine boundary used by operation adapters. Keeping this registry engine-free prevents an adapter from
 * importing the battle engine and closing a runtime -> operation -> battle-engine -> runtime cycle.
 * The co-op composition root installs the real implementation before it enables any operation surface.
 */
export interface CoopAuthorityStateHooks {
  readonly capture: (turn: number) => CoopAuthoritativeBattleStateV1 | null;
  readonly apply: (state: CoopAuthoritativeBattleStateV1) => boolean;
  readonly reapply: (state: CoopAuthoritativeBattleStateV1) => boolean;
}

let installedHooks: CoopAuthorityStateHooks | null = null;

export function setCoopAuthorityStateHooks(hooks: CoopAuthorityStateHooks | null): void {
  installedHooks = hooks;
}

export function captureCoopOperationAuthorityState(turn: number): CoopAuthoritativeBattleStateV1 | null {
  return installedHooks?.capture(turn) ?? null;
}

export function applyCoopOperationAuthorityState(state: CoopAuthoritativeBattleStateV1): boolean {
  return installedHooks?.apply(state) ?? false;
}

export function reapplyCoopOperationAuthorityState(state: CoopAuthoritativeBattleStateV1): boolean {
  return installedHooks?.reapply(state) ?? false;
}
