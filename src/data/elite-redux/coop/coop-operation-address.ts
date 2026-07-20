/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// PURE OPERATION-ADDRESS CONSTANTS.
//
// Authority V2's engine-free validators and projection decoders must be able to
// parse operation IDs without importing live operation modules. Those modules
// register engine appliers and may pull Phaser into Node-only contract tests.
// =============================================================================

/** Ordered operation slots reserved per ability-picker interaction. */
export const COOP_ABILITY_ACTION_STRIDE = 100;

/** Ordered operation slots reserved per Colosseum interaction. */
export const COOP_COLOSSEUM_ACTION_STRIDE = 100;

/** Ordered operation slots reserved per reward/market interaction. */
export const COOP_REWARD_ACTION_STRIDE = 100_000;
