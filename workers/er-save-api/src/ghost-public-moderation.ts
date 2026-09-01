/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Bump this whenever an existing public ghost value is newly rewritten. Clients
 * use it to discard cached snapshots that predate the current moderation pass.
 */
export const GHOST_PUBLIC_MODERATION_REVISION = "2026-09-01.1";

const PUBLIC_NAME_REPLACEMENTS: Readonly<Record<string, string>> = Object.freeze({
  "bigdickenergy 69": "smallpeckerenergy",
  iceuranus: "IceUrshifu",
  pocketbussy: "PocketBlissey",
});

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

function moderateDialogue(value: Record<string, unknown>): Record<string, unknown> {
  const moderated = { ...value };
  for (const key of DIALOGUE_KEYS) {
    const line = moderated[key];
    if (typeof line === "string" && DIALOGUE_REPLACEMENTS[line] !== undefined) {
      moderated[key] = DIALOGUE_REPLACEMENTS[line];
    }
  }
  return moderated;
}

/**
 * Rewrite only staff-confirmed public dialogue. This is deliberately exact: it
 * must not turn ordinary battle trash talk into a broad automatic censor.
 */
export function moderateGhostPresentation(value: unknown): unknown {
  if (!isPlainRecord(value)) {
    return value;
  }
  let moderated = value;
  let changed = false;

  if (typeof value.displayName === "string") {
    const displayName = moderateGhostUsername(value.displayName);
    if (displayName !== value.displayName) {
      moderated = { ...moderated, displayName };
      changed = true;
    }
  }

  if (isPlainRecord(value.dialogue)) {
    const dialogue = moderateDialogue(value.dialogue);
    if (DIALOGUE_KEYS.some(key => dialogue[key] !== value.dialogue[key])) {
      moderated = { ...moderated, dialogue };
      changed = true;
    }
  }

  return changed ? moderated : value;
}

/** Public alias retained for historical snapshots that predate the D1 rename. */
export function moderateGhostUsername(value: string): string {
  return PUBLIC_NAME_REPLACEMENTS[value.trim().toLowerCase()] ?? value;
}

/** High-confidence hateful names are unavailable for new account registration. */
export function isDisallowedPublicUsername(value: string): boolean {
  if (PUBLIC_NAME_REPLACEMENTS[value.trim().toLowerCase()] !== undefined) {
    return true;
  }
  const compact = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const withoutBenignWord = compact.replaceAll("snigger", "");
  return withoutBenignWord.includes("nigga") || withoutBenignWord.includes("nigger");
}
