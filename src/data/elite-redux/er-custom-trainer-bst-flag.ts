/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — #419 BST-cap bypass flag for staff-authored custom trainers.
//
// A ZERO-IMPORT leaf module on purpose. `enforceErEliteBstCurve`
// (er-trainer-runtime-hook.ts) is a very central module imported early in the
// graph; it must read this flag WITHOUT pulling in er-custom-trainers.ts's
// heavy transitive deps (held-item-resolver -> encounter-phase-utils -> ...),
// which would create an import cycle ("Class extends undefined"). Keeping the
// flag here lets both the runtime hook and er-custom-trainers.ts share it with
// no cycle.
//
// Lifecycle: set true when a custom trainer is installed for the upcoming wave
// (NewBattlePhase), reset false at the start of every NewBattlePhase so a wave
// without a custom trainer never leaks a previous wave's bypass.
// =============================================================================

let bstBypassActive = false;

/** True while a staff-authored custom trainer is being fielded (skip the #419 BST cap). */
export function isErCustomTrainerBstBypassActive(): boolean {
  return bstBypassActive;
}

/** Enable/disable the #419 BST-cap bypass for the current battle. */
export function setErCustomTrainerBstBypass(active: boolean): void {
  bstBypassActive = active;
}
