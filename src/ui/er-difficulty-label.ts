import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import i18next from "i18next";

/** Localized display name for a persisted Elite Redux run difficulty. */
export function getErDifficultyLabel(difficulty: ErDifficulty | undefined): string {
  const resolved = difficulty ?? "ace";
  const suffix = resolved.charAt(0).toUpperCase() + resolved.slice(1);
  return i18next.t(`starterSelectUiHandler:difficulty${suffix}`);
}
