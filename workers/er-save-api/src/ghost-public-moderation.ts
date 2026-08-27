/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Bump this whenever an existing public ghost value is newly rewritten. Clients
 * use it to discard cached snapshots that predate the current moderation pass.
 */
export const GHOST_PUBLIC_MODERATION_REVISION = "2026-08-27.1";

const DIALOGUE_REPLACEMENTS: Readonly<Record<string, string>> = Object.freeze({
  "garchomp segs": "My Garchomp clicked Earthquake next to Levitate. We planned this.",
  "no garchomp segs": "Garchomp says that was a skill issue.",
  "yay garchomp segs": "Garchomp has left the group chat.",
  "I enjoy big tit goth girls": "I am very edgy. Dark-type, even.",
  "IF U BEAT ME, U LIKE BEATING KIDS": "If you beat me, I'm reporting your Quick Claw.",
  "pussy to fat": "Snorlax ate my post-battle excuse.",
});

const DIALOGUE_KEYS = ["intro", "defeatPlayer", "defeated", "afterWin"] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rewrite only staff-confirmed public dialogue. This is deliberately exact: it
 * must not turn ordinary battle trash talk into a broad automatic censor.
 */
export function moderateGhostPresentation(value: unknown): unknown {
  if (!isPlainRecord(value) || !isPlainRecord(value.dialogue)) {
    return value;
  }
  const dialogue = { ...value.dialogue };
  let changed = false;
  for (const key of DIALOGUE_KEYS) {
    const line = dialogue[key];
    if (typeof line !== "string") {
      continue;
    }
    const replacement = DIALOGUE_REPLACEMENTS[line];
    if (replacement !== undefined) {
      dialogue[key] = replacement;
      changed = true;
    }
  }
  return changed ? { ...value, dialogue } : value;
}

/** Public alias retained for historical snapshots that predate the D1 rename. */
export function moderateGhostUsername(value: string): string {
  return value.trim().toLowerCase() === "bigdickenergy 69" ? "smallpeckerenergy" : value;
}

/** High-confidence hateful names are unavailable for new account registration. */
export function isDisallowedPublicUsername(value: string): boolean {
  const compact = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const withoutBenignWord = compact.replaceAll("snigger", "");
  return withoutBenignWord.includes("nigga") || withoutBenignWord.includes("nigger");
}
