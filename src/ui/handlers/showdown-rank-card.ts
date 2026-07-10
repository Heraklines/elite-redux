/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown ranked ladder — RANK CARD (reusable UI element). Builds a compact card
// showing the tier ball emblem + rank label + segment gauge + streak from a server-served
// ShowdownRankState. Reused on the Team Preset Menu and the wager screen. Pure builder:
// returns a Phaser container the caller positions/adds; no state, no network. Guarded so a
// missing texture never throws into the host handler.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  rankLabel,
  SHOWDOWN_RANK_TIER,
  SHOWDOWN_SEGMENTS_PER_RANK,
  type ShowdownRankState,
  tierBallFrame,
  tierLocaleSuffix,
} from "#data/elite-redux/showdown/showdown-rank-types";
import { TextStyle } from "#enums/text-style";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";

/** The card's fixed footprint (logical px). */
export const SHOWDOWN_RANK_CARD_WIDTH = 132;
export const SHOWDOWN_RANK_CARD_HEIGHT = 40;

/** The localized tier name (falls back to the built-in English label). */
function localizedTierName(tier: number): string {
  return i18next.t(`battle:showdownRankTier${tierLocaleSuffix(tier)}`, {
    defaultValue: rankLabel(tier, SHOWDOWN_RANK_TIER.pokeball).split(" ").slice(0, -1).join(" ") || "Unranked",
  });
}

/**
 * Build a rank card container for `state` at (`x`, `y`). The caller adds it to its own
 * container/UI and destroys it on teardown. When `state` is null (offline / unranked), a
 * neutral "Unranked" card is rendered so the surface never shows a gap. `width` lets a cramped
 * host (the wager screen) request a narrower card.
 */
export function buildShowdownRankCard(
  state: ShowdownRankState | null,
  x = 0,
  y = 0,
  width: number = SHOWDOWN_RANK_CARD_WIDTH,
): Phaser.GameObjects.Container {
  const card = globalScene.add.container(x, y);

  card.add(addWindow(0, 0, width, SHOWDOWN_RANK_CARD_HEIGHT));

  if (state == null) {
    const label = addTextObject(
      width / 2,
      SHOWDOWN_RANK_CARD_HEIGHT / 2 - 5,
      i18next.t("battle:showdownRankUnranked", { defaultValue: "Unranked" }),
      TextStyle.SUMMARY_GRAY,
    );
    label.setOrigin(0.5, 0);
    card.add(label);
    return card;
  }

  // Tier ball emblem (reuse the "pb" ball atlas; champion reuses the master-ball frame + gold text).
  try {
    const emblem = globalScene.add.sprite(18, 20, "pb", tierBallFrame(state.tier)).setOrigin(0.5, 0.5).setScale(0.9);
    card.add(emblem);
  } catch {
    /* a missing ball atlas must never break the host screen */
  }

  const isChampion = state.tier === SHOWDOWN_RANK_TIER.champion;
  const tierName = localizedTierName(state.tier);
  // Rank label (e.g. "Ultra Ball 2" / "Champion").
  const label = addTextObject(
    36,
    5,
    rankLabel(state.tier, state.rank, tierName),
    isChampion ? TextStyle.SUMMARY_GOLD : TextStyle.SUMMARY_HEADER,
  );
  label.setOrigin(0, 0);
  card.add(label);

  // Segment gauge: filled/empty pips.
  const pipY = 22;
  const pipStartX = 36;
  const pipStep = 12;
  for (let i = 0; i < SHOWDOWN_SEGMENTS_PER_RANK; i++) {
    const filled = i < state.segments;
    const pip = globalScene.add
      .rectangle(pipStartX + i * pipStep, pipY, 9, 6, filled ? 0x64d264 : 0x30343c, 1)
      .setOrigin(0, 0.5);
    pip.setStrokeStyle(1, 0x101418, 1);
    card.add(pip);
  }

  // Streak badge (only when hot).
  if (state.streak >= 3) {
    const streak = addTextObject(
      width - 6,
      5,
      i18next.t("battle:showdownRankStreak", { streak: state.streak, defaultValue: `x${state.streak}` }),
      TextStyle.SUMMARY_GOLD,
    );
    streak.setOrigin(1, 0);
    card.add(streak);
  }

  // Season line (compact).
  const season = addTextObject(
    36,
    30,
    i18next.t("battle:showdownRankSeason", { season: state.seasonId, defaultValue: state.seasonId }),
    TextStyle.SHADOW_TEXT,
  );
  season.setOrigin(0, 0);
  card.add(season);

  return card;
}

// =============================================================================
// COMPACT rank CHIP - a one-line ball emblem + short tier label for a cramped host (the Team Menu
// header band), where the full card above would cover the content beneath it (it overlapped the
// preview column's moveset). Same tier vocabulary + guards as the card; the wager screen keeps the
// big card.
// =============================================================================

/** The compact chip's fixed height (logical px). Width is label-dependent - see {@linkcode showdownRankChipWidth}. */
export const SHOWDOWN_RANK_CHIP_HEIGHT = 11;

/** The compact chip's one-line label ("Unranked" / "Ultra Ball 2" / "Champion"). Pure, so the host can measure it. */
function chipLabel(state: ShowdownRankState | null): string {
  return state == null
    ? i18next.t("battle:showdownRankUnranked", { defaultValue: "Unranked" })
    : rankLabel(state.tier, state.rank, localizedTierName(state.tier));
}

/** The compact chip's width for the given state, so a host can right-align it without measuring pixels. */
export function showdownRankChipWidth(state: ShowdownRankState | null): number {
  return 16 + chipLabel(state).length * 3.2 + 6;
}

/**
 * Build a COMPACT one-line rank chip (ball emblem + short tier label) at (`x`, `y`) TOP-LEFT. For a
 * cramped host like the Team Menu header where {@linkcode buildShowdownRankCard} would obstruct the
 * content. `state == null` renders a neutral "Unranked" chip. Guarded so a missing ball atlas never
 * throws into the host screen. The caller adds it to its own container and destroys it on teardown.
 */
export function buildShowdownRankChip(state: ShowdownRankState | null, x = 0, y = 0): Phaser.GameObjects.Container {
  const chip = globalScene.add.container(x, y);
  const h = SHOWDOWN_RANK_CHIP_HEIGHT;
  const w = showdownRankChipWidth(state);
  const isChampion = state?.tier === SHOWDOWN_RANK_TIER.champion;

  // Pill background + subtle edge.
  const bg = globalScene.add.rectangle(0, 0, w, h, 0x18233b, 1).setOrigin(0, 0);
  bg.setStrokeStyle(1, state == null ? 0x33436a : 0x4a5a80, 1);
  chip.add(bg);

  // Ball emblem (unranked reuses the pokeball frame; the gray label reads as "no rank").
  try {
    const emblem = globalScene.add
      .sprite(9, h / 2, "pb", tierBallFrame(state?.tier ?? SHOWDOWN_RANK_TIER.pokeball))
      .setOrigin(0.5, 0.5)
      .setScale(0.5);
    chip.add(emblem);
  } catch {
    /* a missing ball atlas must never break the host screen */
  }

  const label = addTextObject(
    17,
    1,
    chipLabel(state),
    state == null ? TextStyle.SUMMARY_GRAY : isChampion ? TextStyle.SUMMARY_GOLD : TextStyle.SUMMARY_HEADER,
    { fontSize: "22px" },
  );
  label.setOrigin(0, 0);
  chip.add(label);

  return chip;
}
