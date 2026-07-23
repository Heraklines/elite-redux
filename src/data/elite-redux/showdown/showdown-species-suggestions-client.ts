/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown teambuilder - CLIENT for the telemetry "popular sets" route (P3, the flagship's community
// half). Fetches the aggregate popular ITEM + FORM among recent winners for a species from the
// er-telemetry worker (GET /telemetry/species-suggestions).
//
// 🔴 THE HONEST FINDING: telemetry stores only mon FINGERPRINTS (species/form/ITEM/shiny), NOT
// movesets/abilities/natures. So this returns popular ITEM+FORM combos, never a full moveset. The
// editor pairs these community item hints with the player's OWN locally-recorded winning FULL sets
// (showdown-winning-sets.ts) so the "Suggested sets" surface is honest end-to-end.
//
// GRACEFUL DEGRADE (the rank-404 lesson): a missing endpoint, a network error, a 4xx/5xx, or a
// malformed body all resolve to an EMPTY list SILENTLY - no console spam. The caller shows an honest
// empty state when telemetry is sparse/unavailable.
// =============================================================================

/** One community suggestion: a fielded FORM + ITEM combo and how many recent wins ran it. */
export interface ShowdownSpeciesSuggestion {
  speciesId: number;
  formIndex: number;
  item: string;
  wins: number;
}

/** The telemetry worker base URL, or null when unconfigured (own env, else the save-API host). */
function suggestionsBase(): string | null {
  const env = import.meta.env as { VITE_SERVER_URL_TELEMETRY?: string; VITE_SERVER_URL?: string };
  const url = env.VITE_SERVER_URL_TELEMETRY ?? env.VITE_SERVER_URL ?? "";
  return url ? url.replace(/\/$/, "") : null;
}

/** True when a telemetry endpoint is configured at all (the editor hides the fetch attempt otherwise). */
export function isSpeciesSuggestionsConfigured(): boolean {
  return suggestionsBase() != null;
}

function validSuggestion(v: unknown): v is ShowdownSpeciesSuggestion {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const s = v as Record<string, unknown>;
  return (
    typeof s.speciesId === "number"
    && typeof s.formIndex === "number"
    && typeof s.item === "string"
    && typeof s.wins === "number"
  );
}

/**
 * Fetch the community popular sets for a line ROOT. Resolves to an EMPTY array on ANY failure (no
 * endpoint, network error, non-200, malformed body) - the caller degrades gracefully and silently.
 */
export async function fetchShowdownSpeciesSuggestions(
  rootSpeciesId: number,
  limit = 6,
): Promise<ShowdownSpeciesSuggestion[]> {
  const base = suggestionsBase();
  if (base == null) {
    return [];
  }
  try {
    const res = await fetch(`${base}/telemetry/species-suggestions?species=${rootSpeciesId}&limit=${limit}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return [];
    }
    const body = (await res.json()) as unknown;
    if (typeof body !== "object" || body === null) {
      return [];
    }
    const list = (body as { suggestions?: unknown }).suggestions;
    return Array.isArray(list) ? list.filter(validSuggestion) : [];
  } catch {
    // Network / parse failure -> silent empty (no console spam).
    return [];
  }
}
