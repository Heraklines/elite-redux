/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — move-detail derivation for the fight-menu detail panel.
//
// The ER ROM's move-select screen shows several cyclable pages of a move's
// properties. This module is the data layer: given a (fully ER-wired) `Move`,
// it derives the labelled rows for each page from the move's flags, attrs and
// fields — so the panel reflects the ACTUAL in-engine behaviour, not a static
// table. The UI layer (move-info-overlay) only renders what this returns.
//
// Pages mirror the ER ROM:
//   1. Description — the move's effect text.
//   2. Mechanics   — Effect / Chance / Priority / Contact.
//   3. Combat      — Target / Critical / Sheer Force (has a boostable secondary).
//   4. Properties  — Boost Type / Based On / Ign. Ability / Ign. Stats.
// =============================================================================

import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveTarget } from "#enums/move-target";
import { StatusEffect } from "#enums/status-effect";
import type { Move } from "#moves/move";

/** A single label/value line on a detail page. */
export interface MoveDetailRow {
  readonly label: string;
  readonly value: string;
}

/** One page of move detail. Page 1 is free text; the rest are label/value rows. */
export interface MoveDetailPage {
  readonly title: string;
  readonly description?: string;
  readonly rows?: readonly MoveDetailRow[];
}

/** Placeholder for an inapplicable / unknown field (matches the ROM's "---"). */
const DASH = "—";

/**
 * ER "boost type" categories — the move-flavour flags that damage-boosting
 * abilities key off (Air Blower boosts Air moves, Keen Edge boosts Blades, …).
 * Order is display priority; a move may carry more than one.
 */
const BOOST_TYPE_FLAGS: readonly (readonly [MoveFlags, string])[] = [
  [MoveFlags.AIR_BASED, "Air"],
  [MoveFlags.WIND_MOVE, "Wind"],
  [MoveFlags.SLICING_MOVE, "Blade"],
  [MoveFlags.BITING_MOVE, "Bite"],
  [MoveFlags.PUNCHING_MOVE, "Punch"],
  [MoveFlags.KICKING_MOVE, "Kick"],
  [MoveFlags.HORN_BASED, "Horn"],
  [MoveFlags.HAMMER_BASED, "Hammer"],
  [MoveFlags.DRILL_BASED, "Drill"],
  [MoveFlags.BONE_BASED, "Bone"],
  [MoveFlags.ARROW_BASED, "Arrow"],
  [MoveFlags.PULSE_MOVE, "Pulse"],
  [MoveFlags.SOUND_BASED, "Sound"],
  [MoveFlags.DANCE_MOVE, "Dance"],
  [MoveFlags.POWDER_MOVE, "Powder"],
  [MoveFlags.BALLBOMB_MOVE, "Bomb"],
  [MoveFlags.LUNAR_MOVE, "Lunar"],
  [MoveFlags.FIELD_BASED, "Field"],
];

/** Human label per move-target shape. */
const TARGET_LABELS: Partial<Record<MoveTarget, string>> = {
  [MoveTarget.USER]: "Self",
  [MoveTarget.OTHER]: "Single",
  [MoveTarget.NEAR_OTHER]: "Single",
  [MoveTarget.NEAR_ENEMY]: "Single",
  [MoveTarget.RANDOM_NEAR_ENEMY]: "Random",
  [MoveTarget.ALL_NEAR_OTHERS]: "All Adj.",
  [MoveTarget.ALL_NEAR_ENEMIES]: "Both",
  [MoveTarget.ALL_ENEMIES]: "All Foes",
  [MoveTarget.ALL_OTHERS]: "All Others",
  [MoveTarget.ALL]: "All",
  [MoveTarget.ALLY]: "Ally",
  [MoveTarget.NEAR_ALLY]: "Ally",
  [MoveTarget.USER_OR_NEAR_ALLY]: "Self/Ally",
  [MoveTarget.USER_AND_ALLIES]: "Team",
  [MoveTarget.USER_SIDE]: "Your Side",
  [MoveTarget.ENEMY_SIDE]: "Foe Side",
  [MoveTarget.BOTH_SIDES]: "Field",
  [MoveTarget.PARTY]: "Party",
  [MoveTarget.ATTACKER]: "Attacker",
  [MoveTarget.CURSE]: "Special",
};

/** Short name per status, for the "Effect" row. */
const STATUS_LABELS: Partial<Record<StatusEffect, string>> = {
  [StatusEffect.POISON]: "Poison",
  [StatusEffect.TOXIC]: "Bad Poison",
  [StatusEffect.PARALYSIS]: "Paralyze",
  [StatusEffect.SLEEP]: "Sleep",
  [StatusEffect.FREEZE]: "Freeze",
  [StatusEffect.BURN]: "Burn",
};

const STAT_ABBR = ["HP", "Atk", "Def", "SpA", "SpD", "Spe", "Acc", "Eva"];

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

/** First-matching boost-type flag(s), joined; "—" when the move has none. */
function boostType(move: Move): string {
  const hits = BOOST_TYPE_FLAGS.filter(([flag]) => move.hasFlag(flag)).map(([, label]) => label);
  return hits.length > 0 ? hits.join(", ") : DASH;
}

function targetLabel(move: Move): string {
  return TARGET_LABELS[move.moveTarget] ?? "Single";
}

function critical(move: Move): string {
  if (move.hasAttr("CritOnlyAttr")) {
    return "Always";
  }
  if (move.hasAttr("HighCritAttr")) {
    return "+1";
  }
  return DASH;
}

/** The move's most salient secondary effect, named (Flinch / Poison / Atk -1 / …). */
function secondaryEffect(move: Move): string {
  if (move.hasAttr("FlinchAttr")) {
    return "Flinch";
  }
  if (move.hasAttr("ConfuseAttr")) {
    return "Confuse";
  }
  const status = move.getAttrs("StatusEffectAttr")[0];
  if (status) {
    return STATUS_LABELS[status.effect] ?? "Status";
  }
  const statChange = move.getAttrs("StatStageChangeAttr")[0];
  if (statChange) {
    const stats = statChange.stats.map(s => STAT_ABBR[s] ?? "?").join("/");
    const sign = statChange.stages > 0 ? "+" : "";
    return `${stats} ${sign}${statChange.stages}`;
  }
  return DASH;
}

/** Whether the move carries a Sheer-Force-boostable secondary effect. */
function hasBoostableSecondary(move: Move): boolean {
  return (
    move.chance > 0
    || move.hasAttr("FlinchAttr")
    || move.hasAttr("ConfuseAttr")
    || move.hasAttr("StatusEffectAttr")
    || move.hasAttr("StatStageChangeAttr")
  );
}

/**
 * Build the cyclable detail pages for a move. Pure — depends only on the move's
 * own wired flags/attrs/fields, so it always matches in-battle behaviour.
 */
export function getErMoveDetailPages(move: Move): MoveDetailPage[] {
  const isStatus = move.category === MoveCategory.STATUS;
  const priority = move.priority;
  return [
    { title: "Description", description: move.effect || "" },
    {
      title: "Mechanics",
      rows: [
        { label: "Effect", value: secondaryEffect(move) },
        { label: "Chance", value: move.chance > 0 ? `${move.chance}%` : DASH },
        { label: "Priority", value: `${priority > 0 ? "+" : ""}${priority}` },
        { label: "Contact", value: yesNo(move.hasFlag(MoveFlags.MAKES_CONTACT)) },
      ],
    },
    {
      title: "Combat",
      rows: [
        { label: "Target", value: targetLabel(move) },
        { label: "Critical", value: isStatus ? DASH : critical(move) },
        { label: "Sheer Force", value: yesNo(hasBoostableSecondary(move)) },
      ],
    },
    {
      title: "Properties",
      rows: [
        { label: "Boost Type", value: boostType(move) },
        { label: "Charged", value: yesNo(move.isChargingMove()) },
        { label: "Ign. Ability", value: yesNo(move.hasFlag(MoveFlags.IGNORE_ABILITIES)) },
        { label: "Ign. Stats", value: yesNo(move.hasAttr("IgnoreOpponentStatStagesAttr")) },
      ],
    },
  ];
}
