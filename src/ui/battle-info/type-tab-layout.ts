/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Resolve the battle-info atlas for one type in the paired-column layout.
 *
 * A complete column must use the short `type1`/`type2` cap textures. A final
 * unpaired type uses the original full-height `type` texture instead.
 */
export function battleInfoTypeTextureKey(baseKey: string, index: number, count: number): string {
  if (index % 2 === 1) {
    return `${baseKey}_type2`;
  }
  return `${baseKey}_type${index + 1 < count ? "1" : ""}`;
}
