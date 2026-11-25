/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 5: the player words that stand for engine values in the declarations of this chunk. Not a declaration, so the
// registry (which only collects `*.decl.ts` and `bindings.ts`) does not load it.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";

/**
 * A share of max HP: staff pick a whole percent (25), the class keeps a fraction (0.25).
 * `Number((raw * 100).toPrecision(12))` removes float noise (0.35 * 100 is 35.00000000000001).
 */
export const percentOfMaxHpCodec: ParamCodec = {
  toCtor: value => Number(value) / 100,
  fromInstance: raw => (typeof raw === "number" ? Number((raw * 100).toPrecision(12)) : undefined),
};
