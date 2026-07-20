/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** @deprecated Compatibility barrel. Authority V2 owns one global control ledger. */
// biome-ignore lint/performance/noBarrelFile: compatibility export while callers migrate to control-ledger
export * from "#data/elite-redux/coop/authority-v2/control-ledger";
