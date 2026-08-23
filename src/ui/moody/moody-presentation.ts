/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Fun Mode "Moody Mode" - UI-ONLY presentation model.
//
// This module turns core Moody state (moody-state.ts / moody-enemy.ts) into
// typed, renderer-agnostic view payloads: cards, badges, target options, ledger
// tabs, tracker chips, trigger feed rows and the enemy panel. It NEVER mutates
// mechanics state - it only reads the catalog maps and derives labels, tints,
// paging math and deterministic demo data.
//
// Phaser-free on purpose: every function here is unit-testable without a scene.
// Handlers/components under src/ui/ consume these models and do the drawing.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { MOODY_BOON_BY_ID, MOODY_CURSE_BY_ID } from "#data/elite-redux/moody/moody-state";
import type {
  MoodyBoonDefinition,
  MoodyBoonInstance,
  MoodyBoonOffer,
  MoodyBoonProgress,
  MoodyBoonTarget,
  MoodyCurseDefinition,
  MoodyModeSaveData,
  MoodyRarity,
  MoodyTargetKind,
} from "#data/elite-redux/moody/moody-types";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { toTitleCase } from "#utils/strings";

// ---------------------------------------------------------------------------
// Rarity
// ---------------------------------------------------------------------------

/** Rarity tint matches the shared modifier-tier palette (text.ts getModifierTierTextTint). */
export const MOODY_RARITY_TINT: Readonly<Record<MoodyRarity, number>> = {
  great: 0x4998f8,
  ultra: 0xf8d038,
  rogue: 0xdb4343,
  master: 0xe331c5,
};

export const MOODY_RARITY_LABEL: Readonly<Record<MoodyRarity, string>> = {
  great: "GREAT",
  ultra: "ULTRA",
  rogue: "ROGUE",
  master: "MASTER",
};

export const MOODY_DREAD_LABEL: Readonly<Record<1 | 2 | 3, string>> = {
  1: "DREAD I",
  2: "DREAD II",
  3: "DREAD III",
};

export interface MoodyBarrierLayout {
  hpRatio: number;
  barrierRatio: number;
  startRatio: number;
}

/** Place Barrier as a white terminal segment of current HP, sized against maximum HP. */
export function buildMoodyBarrierLayout(barrier: number, maxHp: number, hpRatio: number): MoodyBarrierLayout {
  const clampedHpRatio = Math.min(Math.max(hpRatio, 0), 1);
  const barrierRatio = maxHp <= 0 ? 0 : Math.min(Math.max(barrier / maxHp, 0), clampedHpRatio);
  return {
    hpRatio: clampedHpRatio,
    barrierRatio,
    startRatio: clampedHpRatio - barrierRatio,
  };
}

// ---------------------------------------------------------------------------
// Scope glyphs + target-kind labels.
// Scope and state must never rely on color alone (rarity colors are busy), so
// every surface pairs a glyph with a text label.
// ---------------------------------------------------------------------------

export const MOODY_SCOPE_GLYPH: Readonly<Record<MoodyTargetKind, string>> = {
  slot: "■",
  slots: "■■",
  pokemon: "◆",
  "pokemon-pair": "◆↔◆",
  move: "✦",
  "pokemon-type": "▲",
  "enemy-type": "▼",
  "item-stack": "□",
  team: "★",
  field: "☁",
  economy: "$",
  reward: "✦★",
  contract: "§",
  rule: "∞",
};

export const MOODY_TARGET_LABEL: Readonly<Record<MoodyTargetKind, string>> = {
  slot: "TARGET: SLOT",
  slots: "TARGET: TWO SLOTS",
  pokemon: "TARGET: POKÉMON",
  "pokemon-pair": "TARGET: PAIR",
  move: "TARGET: MOVE",
  "pokemon-type": "TARGET: ALLY TYPE",
  "enemy-type": "TARGET: ENEMY TYPE",
  "item-stack": "TARGET: ITEM STACK",
  team: "TARGET: TEAM",
  field: "TARGET: FIELD",
  economy: "TARGET: ECONOMY",
  reward: "TARGET: REWARDS",
  contract: "TARGET: CONTRACT",
  rule: "TARGET: RULE",
};

// ---------------------------------------------------------------------------
// Reset cadence. The catalog stores no structured cadence, so it is inferred
// from the boon text. "Immediate" glyph + label keeps cards readable at a
// glance without color.
// ---------------------------------------------------------------------------

export type MoodyCadence = "battle" | "wave" | "biome" | "segment" | "boss" | "run" | "passive";

export const MOODY_CADENCE_LABEL: Readonly<Record<MoodyCadence, string>> = {
  battle: "ONCE / BATTLE",
  wave: "ONCE / WAVE",
  biome: "ONCE / BIOME",
  segment: "ONCE / 10 WAVES",
  boss: "ONCE / BOSS",
  run: "RUN PROGRESSION",
  passive: "ALWAYS ON",
};

export function inferMoodyCadence(definition: MoodyBoonDefinition): MoodyCadence {
  const text = `${definition.base} ${definition.rankTwo} ${definition.fullDescription}`.toLowerCase();
  if (text.includes("once per boss") || text.includes("per boss battle")) {
    return "boss";
  }
  if (text.includes("ten-wave segment") || text.includes("per segment") || text.includes("every ten waves")) {
    return "segment";
  }
  if (text.includes("once per biome") || text.includes("per biome") || text.includes("biome transition")) {
    return "biome";
  }
  if (text.includes("each wave") || text.includes("per wave") || text.includes("every wave")) {
    return "wave";
  }
  if (text.includes("each battle") || text.includes("per battle") || text.includes("every battle")) {
    return "battle";
  }
  if (text.includes("permanent") || text.includes("persistent") || text.includes("for the rest of the run")) {
    return "run";
  }
  return "passive";
}

// ---------------------------------------------------------------------------
// Effect badge states
// ---------------------------------------------------------------------------

export type MoodyEffectState = "ready" | "consumed" | "cooldown" | "dormant" | "suppressed" | "invalid" | "progress";

/** Glyph + text pair: the state is never color-only. */
export const MOODY_STATE_GLYPH: Readonly<Record<MoodyEffectState, string>> = {
  ready: "✓",
  consumed: "×",
  cooldown: "~",
  dormant: "☾",
  suppressed: "/",
  invalid: "!",
  progress: "▲",
};

export const MOODY_STATE_LABEL: Readonly<Record<MoodyEffectState, string>> = {
  ready: "READY",
  consumed: "SPENT",
  cooldown: "COOLDOWN",
  dormant: "DORMANT",
  suppressed: "MUTED",
  invalid: "NO TARGET",
  progress: "GROWING",
};

/** Extra per-badge state the renderer may know but the save data cannot (battle-local). */
export interface MoodyBadgeOverrides {
  state?: MoodyEffectState;
  /** Cooldown turns remaining (cooldown state only). */
  cooldownTurns?: number;
}

export interface MoodyBadgeModel {
  instanceId: string;
  name: string;
  rarity: MoodyRarity;
  tint: number;
  rankLabel: string;
  evolutionName?: string;
  state: MoodyEffectState;
  stateGlyph: string;
  stateLabel: string;
  /** e.g. "Glory 4/10" - first counter surfaced for at-a-glance progress. */
  progressText?: string;
  /** One-line badge text, e.g. "◆ Chosen One II ▲4/10". */
  badgeText: string;
  detail: string;
}

export function moodyRankLabel(instance: MoodyBoonInstance, definition?: MoodyBoonDefinition): string {
  if (instance.rank >= 3 && instance.evolutionId != null) {
    const branch = definition?.evolutions.find(evolution => evolution.id === instance.evolutionId);
    return branch == null ? "★" : `★${branch.name}`;
  }
  return instance.rank === 2 ? "II" : "I";
}

/** The first human-readable progress counter on an instance, if any. */
export function moodyProgressText(instance: MoodyBoonInstance): string | undefined {
  return moodyProgressLines(instance)[0];
}

function moodyProgressKeyLabel(key: string): string {
  return toTitleCase(
    key
      .replace(/^battle\./, "")
      .replace(/\./g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim(),
  );
}

function isPlayerFacingProgressKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    !normalized.startsWith("__")
    && !/(^|[._-])(id|ids|key|seed|json|runtime|binding|source|target|input|output|in|out)([._-]|$)/.test(normalized)
  );
}

/** Human-readable live counters for compact HUD and party surfaces. */
export function moodyProgressLines(
  instance: MoodyBoonInstance,
  progress: MoodyBoonProgress | undefined = instance.progress,
): string[] {
  const counters = Object.entries(progress?.counters ?? {}).filter(
    ([key, value]) => isPlayerFacingProgressKey(key) && Number.isFinite(value),
  );
  if (instance.boonId === "mithridatism") {
    const cures = counters.filter(([key]) => key.startsWith("cures."));
    return cures.map(([key, value]) => {
      const status = toTitleCase(key.slice("cures.".length));
      if (value >= 6 && instance.evolutionId === "acquired-immunity") {
        return `${status}: ${value} cures - immune`;
      }
      if (value >= 6 && instance.evolutionId === "weaponized-affliction") {
        return `${status}: ${value} cures - Resistance II, +25% damage, 20% damage reduction while afflicted`;
      }
      if (value >= 3) {
        return `${status}: ${value}/6 cures - Resistance I active (50% prevention)`;
      }
      return `${status}: ${value}/3 cures - Resistance I at 3 (50% prevention)`;
    });
  }

  const lines = counters.map(([key, value]) => `${moodyProgressKeyLabel(key)}: ${value}`);
  lines.push(
    ...Object.entries(progress?.flags ?? {})
      .filter(([key, value]) => isPlayerFacingProgressKey(key) && value)
      .map(([key]) => `${moodyProgressKeyLabel(key)}: active`),
  );
  return lines;
}

function deriveBadgeState(instance: MoodyBoonInstance, overrides?: MoodyBadgeOverrides): MoodyEffectState {
  if (overrides?.state != null) {
    return overrides.state;
  }
  if (instance.dormant === true) {
    return "dormant";
  }
  const definition = MOODY_BOON_BY_ID.get(instance.boonId);
  if (
    definition != null
    && (definition.targetKind === "slot"
      || definition.targetKind === "slots"
      || definition.targetKind === "pokemon"
      || definition.targetKind === "pokemon-pair"
      || definition.targetKind === "move"
      || definition.targetKind === "item-stack"
      || definition.targetKind === "pokemon-type")
    && instance.target == null
  ) {
    // Targeted boon with no binding: cannot fire.
    return "invalid";
  }
  if (instance.progress?.flags != null && Object.values(instance.progress.flags).some(flag => flag)) {
    return "progress";
  }
  if (moodyProgressText(instance) != null) {
    return "progress";
  }
  return "ready";
}

export function buildMoodyBadge(instance: MoodyBoonInstance, overrides?: MoodyBadgeOverrides): MoodyBadgeModel {
  const definition = MOODY_BOON_BY_ID.get(instance.boonId);
  const name = definition?.name ?? instance.boonId;
  const rarity = definition?.rarity ?? "great";
  const state = deriveBadgeState(instance, overrides);
  const rankLabel = moodyRankLabel(instance, definition);
  const evolutionName =
    instance.evolutionId == null ? undefined : definition?.evolutions.find(e => e.id === instance.evolutionId)?.name;
  const progressText =
    overrides?.state === "cooldown" && overrides.cooldownTurns != null
      ? `${overrides.cooldownTurns} turn${overrides.cooldownTurns === 1 ? "" : "s"}`
      : moodyProgressText(instance);
  const stateGlyph = MOODY_STATE_GLYPH[state];
  const stateLabel = MOODY_STATE_LABEL[state];
  const scopeGlyph = definition == null ? "?" : MOODY_SCOPE_GLYPH[definition.targetKind];
  const badgeText = `${scopeGlyph} ${name} ${rankLabel} ${stateGlyph}`;
  const detailParts = [definition?.base ?? "", progressText == null ? "" : `Progress: ${progressText}`];
  if (state === "dormant") {
    detailParts.push("Dormant: Mood Swing has disabled this boon until its next reroll.");
  }
  return {
    instanceId: instance.instanceId,
    name,
    rarity,
    tint: MOODY_RARITY_TINT[rarity],
    rankLabel,
    ...(evolutionName == null ? {} : { evolutionName }),
    state,
    stateGlyph,
    stateLabel,
    ...(progressText == null ? {} : { progressText }),
    badgeText,
    detail: detailParts.filter(part => part.length > 0).join("\n"),
  };
}

/** Group badges for a slot/Pokémon: up to `visible` chips plus a "+N" overflow. */
export function groupMoodyBadges(
  instances: readonly MoodyBoonInstance[],
  visible = 3,
  overrides?: MoodyBadgeOverrides,
): { badges: MoodyBadgeModel[]; overflow: number } {
  const sorted = [...instances].sort((left, right) => {
    const leftRarity = MOODY_BOON_BY_ID.get(left.boonId)?.rarity ?? "great";
    const rightRarity = MOODY_BOON_BY_ID.get(right.boonId)?.rarity ?? "great";
    const order: Record<MoodyRarity, number> = { master: 0, rogue: 1, ultra: 2, great: 3 };
    return order[leftRarity] - order[rightRarity] || left.acquiredAtWave - right.acquiredAtWave;
  });
  return {
    badges: sorted.slice(0, Math.max(0, visible)).map(instance => buildMoodyBadge(instance, overrides)),
    overflow: Math.max(0, sorted.length - visible),
  };
}

// ---------------------------------------------------------------------------
// Card model (draft cards, codex cards, enemy inspection cards)
// ---------------------------------------------------------------------------

export type MoodyCardState = "new" | "rank-up" | "evolution" | "replace" | "hidden";

export const MOODY_CARD_STATE_LABEL: Readonly<Record<MoodyCardState, string>> = {
  new: "NEW",
  "rank-up": "RANK UP",
  evolution: "EVOLVE",
  replace: "REPLACE REQUIRED",
  hidden: "???",
};

export interface MoodyCardModel {
  title: string;
  rarity?: MoodyRarity;
  rarityTint?: number;
  rarityLabel?: string;
  cardState: MoodyCardState;
  cardStateLabel: string;
  scopeGlyph: string;
  scopeLabel: string;
  cadenceLabel: string;
  targetLabel: string;
  description: string;
  /** Exact before/after rows for rank-up/evolution comparison. */
  deltaLines: string[];
  rankLabel?: string;
}

/** Effect text for an offer card: base, rank-up preview, or evolution branches. */
export function moodyOfferDescription(offer: MoodyBoonOffer, definition: MoodyBoonDefinition): string {
  switch (offer.kind) {
    case "rank-up":
      return "RANK I -> RANK II";
    case "evolution":
      return definition.evolutions.length === 1
        ? `EVOLVE: ${definition.evolutions[0].name}`
        : `CHOOSE: ${definition.evolutions.map(branch => branch.name).join(" OR ")}`;
    default:
      return definition.base;
  }
}

/** Exact deltas, never "becomes stronger". */
export function moodyOfferDeltaLines(offer: MoodyBoonOffer, definition: MoodyBoonDefinition): string[] {
  switch (offer.kind) {
    case "rank-up":
      return [`UPGRADE -> ${definition.rankTwo}`];
    case "evolution":
      return definition.evolutions.map(branch => `${branch.name}: ${branch.description}`);
    case "replace":
      return ["You already hold 12 lines.", "One existing line must be discarded."];
    default:
      return [];
  }
}

export function buildMoodyOfferCard(offer: MoodyBoonOffer): MoodyCardModel {
  const definition = MOODY_BOON_BY_ID.get(offer.boonId);
  if (offer.hidden === true || definition == null) {
    return {
      title: "???",
      cardState: "hidden",
      cardStateLabel: MOODY_CARD_STATE_LABEL.hidden,
      scopeGlyph: "?",
      scopeLabel: "unknown",
      cadenceLabel: "unknown",
      targetLabel: "TARGET: ?",
      description: "The Cursed Draft hides this boon.\n\nIt may still be taken - sight unseen.",
      deltaLines: [],
    };
  }
  return {
    title: definition.name,
    rarity: definition.rarity,
    rarityTint: MOODY_RARITY_TINT[definition.rarity],
    rarityLabel: MOODY_RARITY_LABEL[definition.rarity],
    cardState: offer.kind,
    cardStateLabel: MOODY_CARD_STATE_LABEL[offer.kind],
    scopeGlyph: MOODY_SCOPE_GLYPH[definition.targetKind],
    scopeLabel: definition.scope,
    cadenceLabel: MOODY_CADENCE_LABEL[inferMoodyCadence(definition)],
    targetLabel: MOODY_TARGET_LABEL[definition.targetKind],
    description: moodyOfferDescription(offer, definition),
    deltaLines: moodyOfferDeltaLines(offer, definition),
  };
}

/** Card for an owned instance (ledger, inspector, codex-owned view). */
export function buildMoodyInstanceCard(instance: MoodyBoonInstance): MoodyCardModel {
  const definition = MOODY_BOON_BY_ID.get(instance.boonId);
  if (definition == null) {
    return {
      title: instance.boonId,
      cardState: "new",
      cardStateLabel: "",
      scopeGlyph: "?",
      scopeLabel: "unknown",
      cadenceLabel: "",
      targetLabel: "",
      description: "",
      deltaLines: [],
    };
  }
  const deltaLines: string[] = [];
  if (instance.rank >= 2) {
    deltaLines.push(`Rank II: ${definition.rankTwo}`);
  }
  if (instance.rank >= 3 && instance.evolutionId != null) {
    const branch = definition.evolutions.find(evolution => evolution.id === instance.evolutionId);
    if (branch != null) {
      deltaLines.push(`${branch.name}: ${branch.description}`);
    }
  }
  return {
    title: definition.name,
    rarity: definition.rarity,
    rarityTint: MOODY_RARITY_TINT[definition.rarity],
    rarityLabel: MOODY_RARITY_LABEL[definition.rarity],
    cardState: "new",
    cardStateLabel: instance.dormant === true ? "DORMANT" : "",
    scopeGlyph: MOODY_SCOPE_GLYPH[definition.targetKind],
    scopeLabel: definition.scope,
    cadenceLabel: MOODY_CADENCE_LABEL[inferMoodyCadence(definition)],
    targetLabel: MOODY_TARGET_LABEL[definition.targetKind],
    description: definition.base,
    deltaLines,
    rankLabel: moodyRankLabel(instance, definition),
  };
}

/** Curse card for the setup draft: name, Dread severity, full run-wide effect. */
export interface MoodyCurseCardModel {
  title: string;
  dreadLabel: string;
  description: string;
  /** Party-aware preview, e.g. which duplicated types Type Tax would hit. */
  impactLines: string[];
  targetLabel?: string;
}

export function buildMoodyCurseCard(definition: MoodyCurseDefinition, impactLines: string[] = []): MoodyCurseCardModel {
  return {
    title: definition.name,
    dreadLabel: MOODY_DREAD_LABEL[definition.dread],
    description: definition.description,
    impactLines,
    ...(definition.id === "oathbound" ? { targetLabel: "TARGET: POKÉMON (Anchor)" } : {}),
  };
}

/** Static mode rules shown during curse setup. */
export const MOODY_MODE_RULES: readonly string[] = [
  "Every ten waves, choose a boon or upgrade and receive a curse.",
  "Maximum 12 unique boon lines.",
  "Duplicate lines produce ranks / evolutions.",
  "Enemy teams generate their own boon loadouts.",
];

// ---------------------------------------------------------------------------
// Target summary + target picker options
// ---------------------------------------------------------------------------

export function moodyTypeLabel(type: PokemonType): string {
  const raw = PokemonType[type];
  return raw.charAt(0) + raw.slice(1).toLowerCase();
}

export function moodyTargetSummary(target: MoodyBoonTarget | undefined): string {
  if (target == null) {
    return "team";
  }
  const slots = (target.partySlots ?? []).map(slot => `slot ${slot + 1}`);
  const parts: string[] = [];
  if (target.pokemonType != null) {
    parts.push(`${moodyTypeLabel(target.pokemonType)}${(target.pokemonIds?.length ?? 0) > 0 ? " ally" : " foes"}`);
  }
  if (slots.length > 0) {
    parts.push(slots.join(" + "));
  }
  if ((target.moveIds?.length ?? 0) > 0) {
    const moveId = target.moveIds![0];
    const enumName = MoveId[moveId];
    parts.push(allMoves[moveId]?.name ?? (typeof enumName === "string" ? toTitleCase(enumName) : `move ${moveId}`));
  }
  if ((target.itemTypeIds?.length ?? 0) > 0) {
    parts.push("item stack");
  }
  if (target.option != null) {
    parts.push(target.option);
  }
  if (parts.length === 0 && (target.pokemonIds?.length ?? 0) > 0) {
    parts.push("Pokémon");
  }
  return parts.length === 0 ? "team" : parts.join(" · ");
}

/** One option row in the generic target picker. */
export interface MoodyTargetOption {
  /** Stable id interpreted by the caller (party index, move index, type id...). */
  id: number | string;
  label: string;
  /** Right-aligned secondary text (e.g. "Lv50", "PP 1/15"). */
  detail?: string;
  eligible: boolean;
  /** Exactly WHY the option is dimmed (spec: never a bare grey row). */
  ineligibleReason?: string;
  /** Effect names already attached to the candidate. */
  attachments?: readonly string[];
  /** What binding this option would produce (preview before confirmation). */
  preview?: string;
}

export interface MoodyTargetPickerModel {
  title: string;
  options: MoodyTargetOption[];
  /** "Decision 1 / 2" style queue position. */
  queueLabel?: string;
  hint?: string;
  allowCancel: boolean;
}

/** Ineligible rows are dimmed but stay selectable for focus, so the reason is readable. */
export function moodyOptionRowText(option: MoodyTargetOption): string {
  const suffix = option.eligible ? "" : `  — ${option.ineligibleReason ?? "ineligible"}`;
  return `${option.label}${option.detail == null ? "" : `  ${option.detail}`}${suffix}`;
}

// ---------------------------------------------------------------------------
// Paging / scrolling math (shared by every list surface)
// ---------------------------------------------------------------------------

export function moodyPageCount(totalItems: number, visibleRows: number): number {
  if (visibleRows <= 0 || totalItems <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(totalItems / visibleRows));
}

/**
 * Keep `cursor` inside the `[scrollTop, scrollTop + visible)` window.
 * Returns the new scrollTop (clamped to the valid range).
 */
export function moodyClampScroll(cursor: number, scrollTop: number, count: number, visible: number): number {
  if (count <= 0 || visible <= 0) {
    return 0;
  }
  let top = scrollTop;
  if (cursor < top) {
    top = cursor;
  } else if (cursor >= top + visible) {
    top = cursor - visible + 1;
  }
  return Math.max(0, Math.min(top, Math.max(0, count - visible)));
}

/** Word-wrap helper for fixed-width rows (character-based; renderer may rewrap). */
export function moodyWrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine.length <= maxChars) {
      lines.push(rawLine);
      continue;
    }
    let rest = rawLine;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(" ", maxChars);
      if (cut <= 0) {
        cut = maxChars;
      }
      lines.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    if (rest.length > 0) {
      lines.push(rest);
    }
  }
  return lines;
}

export function moodyTruncate(label: string, maxLength: number): string {
  return label.length <= maxLength ? label : `${label.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

// ---------------------------------------------------------------------------
// Trigger feed
// ---------------------------------------------------------------------------

export interface MoodyFeedEntry {
  /** Engine resolution order (ascending). */
  order: number;
  label: string;
  detail?: string;
}

export interface MoodyFeedModel {
  visible: MoodyFeedEntry[];
  /** How many simultaneous entries were collapsed into the summary row. */
  collapsed: number;
  summaryLabel?: string;
}

/**
 * Ordered, non-modal trigger feed. When more than `maxVisible` effects trigger
 * simultaneously they collapse into "N Moody effects activated"; expanding is a
 * renderer concern - the model keeps engine order intact for debugging.
 */
export function buildMoodyFeed(entries: readonly MoodyFeedEntry[], maxVisible = 4): MoodyFeedModel {
  const ordered = [...entries].sort((left, right) => left.order - right.order);
  if (ordered.length <= maxVisible) {
    return { visible: ordered, collapsed: 0 };
  }
  return {
    visible: ordered.slice(0, maxVisible),
    collapsed: ordered.length - maxVisible,
    summaryLabel: `${ordered.length} Moody effects activated`,
  };
}

// ---------------------------------------------------------------------------
// Tracker chips
// ---------------------------------------------------------------------------

export interface MoodyTrackerChipModel {
  id: string;
  /** Glyph + short label, e.g. "☠ Sweeper 2". */
  label: string;
  value: string;
  urgency: "normal" | "warning" | "critical";
  pinned: boolean;
  detail?: string;
}

/** Chips above the pin budget are contextual; pinned chips always render first. */
export function orderMoodyTrackerChips(
  chips: readonly MoodyTrackerChipModel[],
  maxPinned = 3,
): MoodyTrackerChipModel[] {
  const pinned = chips.filter(chip => chip.pinned).slice(0, maxPinned);
  const rest = chips.filter(chip => !pinned.includes(chip));
  return [...pinned, ...rest];
}

// ---------------------------------------------------------------------------
// Contextual choice panel
// ---------------------------------------------------------------------------

export interface MoodyChoiceOption {
  id: string;
  label: string;
  description: string;
  /** Cost / consequence line, e.g. "Cost: 15% maximum HP". */
  costLine?: string;
}

export interface MoodyChoicePanelModel {
  title: string;
  prompt?: string;
  options: MoodyChoiceOption[];
  queueLabel?: string;
  /** Whether CANCEL dismisses without choosing (Final Draft: no; battle queue: yes). */
  cancellable: boolean;
}

// ---------------------------------------------------------------------------
// Enemy boon panel (current encounter only; fog-safe)
// ---------------------------------------------------------------------------

export interface MoodyEnemyPanelRow {
  kind: "header" | "side" | "slot" | "boon";
  label: string;
  tint?: number;
  detail?: string;
}

export interface MoodyEnemyPanelOptions {
  /** Roster slots to render (7/8 under Public Enemy). */
  rosterSize: number;
  /** Reserve species are silhouettes: never reveal species via a boon assignment. */
  hiddenReserves?: boolean;
  /** Fog of War: unseen boons render as "?" until observed. */
  fogOfWar?: boolean;
  /** Instance ids the player has already observed trigger. */
  observedInstanceIds?: ReadonlySet<string>;
  /** Developer detail: rarity rolls / targeting reasons. */
  debug?: boolean;
}

export function buildMoodyEnemyPanelRows(
  boons: readonly MoodyBoonInstance[],
  options: MoodyEnemyPanelOptions,
): MoodyEnemyPanelRow[] {
  const rows: MoodyEnemyPanelRow[] = [];
  const generated = boons.length;
  const upgrades = boons.filter(boon => boon.rank >= 2).length;
  rows.push({
    kind: "header",
    label: `Boon rolls: ${generated + upgrades}   Lines: ${generated}   Upgrades: ${upgrades}`,
  });

  const sideWide = boons.filter(boon => {
    const kind = MOODY_BOON_BY_ID.get(boon.boonId)?.targetKind;
    return kind === "team" || kind === "field" || kind === "rule";
  });
  if (sideWide.length > 0) {
    rows.push({ kind: "header", label: "SIDE-WIDE" });
    for (const boon of sideWide) {
      rows.push(enemyBoonRow(boon, options));
    }
  }

  const rosterSize = Math.max(1, options.rosterSize);
  for (let slot = 0; slot < rosterSize; slot++) {
    const slotBoons = boons.filter(boon => boon.target?.partySlots?.includes(slot));
    const hidden = options.hiddenReserves === true && slot > 0;
    const slotLabel = slot === 0 ? "SLOT 1 — Lead" : hidden ? `SLOT ${slot + 1} — Unknown reserve` : `SLOT ${slot + 1}`;
    rows.push({ kind: "slot", label: slotLabel });
    for (const boon of slotBoons) {
      rows.push(enemyBoonRow(boon, options));
    }
  }

  // Pokémon-targeted boons whose slot is unknown to the renderer land in an ACE/Other group.
  const unassigned = boons.filter(
    boon =>
      !sideWide.includes(boon)
      && boons.indexOf(boon) >= 0
      && (boon.target?.partySlots == null || boon.target.partySlots.length === 0),
  );
  if (unassigned.length > 0) {
    rows.push({ kind: "slot", label: "ATTACHED" });
    for (const boon of unassigned) {
      rows.push(enemyBoonRow(boon, options));
    }
  }
  return rows;
}

function enemyBoonRow(boon: MoodyBoonInstance, options: MoodyEnemyPanelOptions): MoodyEnemyPanelRow {
  const definition = MOODY_BOON_BY_ID.get(boon.boonId);
  const observed = options.observedInstanceIds?.has(boon.instanceId) === true;
  if (options.fogOfWar === true && !observed) {
    return { kind: "boon", label: "  ?  unseen boon", tint: 0x9a90a8 };
  }
  if (definition == null) {
    return { kind: "boon", label: `  ${boon.boonId}`, tint: 0x9a90a8 };
  }
  const rank = moodyRankLabel(boon, definition);
  const debugSuffix =
    options.debug === true
      ? `  [${MOODY_RARITY_LABEL[definition.rarity]} · ${definition.targetKind} · wave ${boon.acquiredAtWave}]`
      : "";
  return {
    kind: "boon",
    label: `  • ${definition.name} ${rank}${debugSuffix}`,
    tint: MOODY_RARITY_TINT[definition.rarity],
    detail: options.debug === true ? definition.fullDescription : definition.base,
  };
}

// ---------------------------------------------------------------------------
// Ledger tab models
// ---------------------------------------------------------------------------

export const MOODY_LEDGER_TABS = ["OVERVIEW", "BINDINGS", "PROGRESS", "HISTORY", "CODEX"] as const;
export type MoodyLedgerTab = (typeof MOODY_LEDGER_TABS)[number];

export interface MoodyLedgerRow {
  kind: "header" | "entry";
  label: string;
  tint: number;
  detail: string;
}

const MUTED_TINT = 0x9a90a8;
const CURSE_TINT = 0xb06ac0;

export function buildMoodyOverviewRows(state: MoodyModeSaveData, waveIndex: number): MoodyLedgerRow[] {
  const rows: MoodyLedgerRow[] = [];
  rows.push({ kind: "header", label: "— BUILD —", tint: MUTED_TINT, detail: "" });
  rows.push({
    kind: "entry",
    label: `Boon lines: ${state.boons.length} / 12`,
    tint: 0xf8f8f8,
    detail: "Twelve unique lines maximum; duplicates rank up or evolve instead.",
  });
  const totalRanks = state.boons.reduce((sum, boon) => sum + boon.rank, 0);
  rows.push({
    kind: "entry",
    label: `Total boon ranks: ${totalRanks}   Acquisitions: ${state.acquisitionRolls}`,
    tint: 0xf8f8f8,
    detail: "",
  });
  const nextDraft = waveIndex + (10 - (waveIndex % 10 || 10)) + (waveIndex % 10 === 0 ? 0 : 0);
  rows.push({
    kind: "entry",
    label: `Next draft: wave ${nextDraft}`,
    tint: 0xf8f8f8,
    detail: "Choose a boon or upgrade every ten waves, then receive a curse.",
  });
  if (state.curses.length > 0) {
    rows.push({ kind: "header", label: "— CURSE —", tint: MUTED_TINT, detail: "" });
    for (const curse of state.curses) {
      const definition = MOODY_CURSE_BY_ID.get(curse.curseId);
      rows.push({
        kind: "entry",
        label: definition == null ? curse.curseId : `${definition.name}  ${MOODY_DREAD_LABEL[definition.dread]}`,
        tint: CURSE_TINT,
        detail: definition?.description ?? "",
      });
    }
  }
  const teamWide = state.boons.filter(boon => {
    const kind = MOODY_BOON_BY_ID.get(boon.boonId)?.targetKind;
    return kind === "team" || kind === "field" || kind === "rule";
  });
  if (teamWide.length > 0) {
    rows.push({ kind: "header", label: "— TEAM / FIELD —", tint: MUTED_TINT, detail: "" });
    for (const boon of teamWide) {
      rows.push(moodyInstanceLedgerRow(boon));
    }
  }
  return rows;
}

function moodyInstanceLedgerRow(boon: MoodyBoonInstance): MoodyLedgerRow {
  const definition = MOODY_BOON_BY_ID.get(boon.boonId);
  if (definition == null) {
    return { kind: "entry", label: boon.boonId, tint: MUTED_TINT, detail: "" };
  }
  const rankMark = moodyRankLabel(boon, definition);
  const dormant = boon.dormant === true ? " (dormant)" : "";
  const label = `${MOODY_RARITY_LABEL[definition.rarity]} · ${definition.name} ${rankMark} · ${moodyTargetSummary(boon.target)}${dormant}`;
  return {
    kind: "entry",
    label,
    tint: MOODY_RARITY_TINT[definition.rarity],
    detail: boonDetailText(boon, definition),
  };
}

function boonDetailText(boon: MoodyBoonInstance, definition: MoodyBoonDefinition): string {
  const lines: string[] = [];
  if (boon.rank >= 2) {
    lines.push(`Rank II: ${definition.rankTwo}`, "");
  }
  if (boon.rank >= 3 && boon.evolutionId != null) {
    const branch = definition.evolutions.find(evolution => evolution.id === boon.evolutionId);
    if (branch != null) {
      lines.push(`${branch.name}: ${branch.description}`, "");
    }
  }
  lines.push(definition.base);
  return lines.join("\n");
}

/** Bindings tab: the party map of where every effect is attached. */
export function buildMoodyBindingRows(state: MoodyModeSaveData): MoodyLedgerRow[] {
  const groups: { header: string; predicate: (kind: MoodyTargetKind | undefined) => boolean }[] = [
    { header: "— SLOT BOONS —", predicate: kind => kind === "slot" || kind === "slots" },
    { header: "— POKÉMON BOONS —", predicate: kind => kind === "pokemon" },
    { header: "— PAIRINGS —", predicate: kind => kind === "pokemon-pair" },
    { header: "— MOVE ATTACHMENTS —", predicate: kind => kind === "move" },
    { header: "— ITEM ATTACHMENTS —", predicate: kind => kind === "item-stack" },
    { header: "— TYPE OATHS —", predicate: kind => kind === "pokemon-type" || kind === "enemy-type" },
    {
      header: "— TEAM / FIELD / RULES —",
      predicate: kind =>
        kind === "team"
        || kind === "field"
        || kind === "rule"
        || kind === "economy"
        || kind === "reward"
        || kind === "contract",
    },
  ];
  const rows: MoodyLedgerRow[] = [];
  for (const group of groups) {
    const members = state.boons.filter(boon => group.predicate(MOODY_BOON_BY_ID.get(boon.boonId)?.targetKind));
    if (members.length === 0) {
      continue;
    }
    rows.push({ kind: "header", label: group.header, tint: MUTED_TINT, detail: "" });
    for (const boon of members) {
      rows.push(moodyInstanceLedgerRow(boon));
    }
  }
  return rows;
}

/** Progress tab: persistent counters (Glory, Feast tokens, marks...). */
export function buildMoodyProgressRows(state: MoodyModeSaveData): MoodyLedgerRow[] {
  const rows: MoodyLedgerRow[] = [];
  const tracked = state.boons.filter(
    boon =>
      (boon.progress?.counters != null && Object.keys(boon.progress.counters).length > 0)
      || (boon.progress?.flags != null && Object.keys(boon.progress.flags).length > 0),
  );
  if (tracked.length === 0) {
    rows.push({
      kind: "entry",
      label: "No persistent counters yet.",
      tint: MUTED_TINT,
      detail: "Glory stacks, Feast tokens, contract progress and similar trackers appear here.",
    });
    return rows;
  }
  for (const boon of tracked) {
    const definition = MOODY_BOON_BY_ID.get(boon.boonId);
    const name = definition?.name ?? boon.boonId;
    rows.push({ kind: "header", label: `— ${name.toUpperCase()} —`, tint: MUTED_TINT, detail: "" });
    for (const [key, value] of Object.entries(boon.progress?.counters ?? {})) {
      rows.push({ kind: "entry", label: `${key}: ${value}`, tint: 0xf8f8f8, detail: definition?.base ?? "" });
    }
    for (const [key, value] of Object.entries(boon.progress?.flags ?? {})) {
      rows.push({ kind: "entry", label: `${key}: ${value ? "yes" : "no"}`, tint: 0xf8f8f8, detail: "" });
    }
  }
  return rows;
}

/** History tab: chronological acquisition/upgrade record. */
export function buildMoodyHistoryRows(state: MoodyModeSaveData): MoodyLedgerRow[] {
  const events: MoodyLedgerRow[] = [];
  for (const boon of state.boons) {
    const definition = MOODY_BOON_BY_ID.get(boon.boonId);
    const name = definition?.name ?? boon.boonId;
    events.push({
      kind: "entry",
      label: `Wave ${boon.acquiredAtWave} — Acquired ${name} (${moodyTargetSummary(boon.target)})`,
      tint: MOODY_RARITY_TINT[definition?.rarity ?? "great"],
      detail: definition?.base ?? "",
    });
    if (boon.rank >= 2) {
      events.push({
        kind: "entry",
        label: `Wave ${boon.acquiredAtWave}+ — ${name} reached Rank II`,
        tint: MOODY_RARITY_TINT[definition?.rarity ?? "great"],
        detail: definition?.rankTwo ?? "",
      });
    }
    if (boon.rank >= 3 && boon.evolutionId != null) {
      const branch = definition?.evolutions.find(evolution => evolution.id === boon.evolutionId);
      events.push({
        kind: "entry",
        label: `Wave ${boon.acquiredAtWave}+ - ${name} evolved into ${branch?.name ?? boon.evolutionId}`,
        tint: MOODY_RARITY_TINT[definition?.rarity ?? "great"],
        detail: branch?.description ?? "",
      });
    }
    if (boon.dormant === true) {
      events.push({
        kind: "entry",
        label: `Wave ${boon.acquiredAtWave}+ - Mood Swing disabled ${name}`,
        tint: MUTED_TINT,
        detail: "Dormant boons keep their progression and reroll every ten waves.",
      });
    }
  }
  for (const curse of state.curses) {
    const definition = MOODY_CURSE_BY_ID.get(curse.curseId);
    events.push({
      kind: "entry",
      label: `Wave ${curse.acquiredAtWave} — Curse: ${definition?.name ?? curse.curseId}`,
      tint: CURSE_TINT,
      detail: definition?.description ?? "",
    });
  }
  return events.sort((left, right) => {
    const leftWave = Number(/Wave (\d+)/.exec(left.label)?.[1] ?? 0);
    const rightWave = Number(/Wave (\d+)/.exec(right.label)?.[1] ?? 0);
    return leftWave - rightWave;
  });
}

/** Codex tab: all 100 lines + curses, with rarity/scope filtering. */
export interface MoodyCodexFilter {
  rarity?: MoodyRarity;
  targetKind?: MoodyTargetKind;
  text?: string;
}

export function buildMoodyCodexRows(state: MoodyModeSaveData | null, filter: MoodyCodexFilter = {}): MoodyLedgerRow[] {
  const ownedIds = new Set((state?.boons ?? []).map(boon => boon.boonId));
  const rows: MoodyLedgerRow[] = [];
  const boons = [...MOODY_BOON_BY_ID.values()]
    .sort((left, right) => left.number - right.number)
    .filter(
      definition =>
        (filter.rarity == null || definition.rarity === filter.rarity)
        && (filter.targetKind == null || definition.targetKind === filter.targetKind)
        && (filter.text == null || definition.name.toLowerCase().includes(filter.text.toLowerCase())),
    );
  rows.push({ kind: "header", label: `— BOON LINES (${boons.length}) —`, tint: MUTED_TINT, detail: "" });
  for (const definition of boons) {
    const discovered = ownedIds.has(definition.id);
    rows.push({
      kind: "entry",
      label: `${discovered ? "◆" : "◇"} #${definition.number} ${definition.name} · ${MOODY_RARITY_LABEL[definition.rarity]}`,
      tint: discovered ? MOODY_RARITY_TINT[definition.rarity] : MUTED_TINT,
      detail: definition.fullDescription,
    });
  }
  const curses = [...MOODY_CURSE_BY_ID.values()].sort((left, right) => left.number - right.number);
  rows.push({ kind: "header", label: `— CURSES (${curses.length}) —`, tint: MUTED_TINT, detail: "" });
  const ownedCurses = new Set((state?.curses ?? []).map(curse => curse.curseId));
  for (const curse of curses) {
    const discovered = ownedCurses.has(curse.id);
    rows.push({
      kind: "entry",
      label: `${discovered ? "◆" : "◇"} ${curse.name} · ${MOODY_DREAD_LABEL[curse.dread]}`,
      tint: discovered ? CURSE_TINT : MUTED_TINT,
      detail: curse.description,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Party attachment classification (slot vs Pokémon vs pair vs team)
// ---------------------------------------------------------------------------

export type MoodyAttachmentClass = "slot" | "pokemon" | "pair" | "move" | "item" | "team" | "type";

export function moodyAttachmentClass(definition: MoodyBoonDefinition): MoodyAttachmentClass {
  switch (definition.targetKind) {
    case "slot":
    case "slots":
      return "slot";
    case "pokemon-pair":
      return "pair";
    case "move":
      return "move";
    case "item-stack":
      return "item";
    case "pokemon":
      return "pokemon";
    case "pokemon-type":
    case "enemy-type":
      return "type";
    default:
      return "team";
  }
}

/**
 * Pair emblem: partners of a pair boon share a Roman numeral (I, II, III...)
 * so the link survives small screens without drawing lines between portraits.
 */
export function moodyPairEmblem(pairIndex: number): string {
  const numerals = ["I", "II", "III", "IV", "V", "VI"];
  return numerals[pairIndex % numerals.length];
}

// ---------------------------------------------------------------------------
// Biome transition report
// ---------------------------------------------------------------------------

export interface MoodyTransitionSection {
  title: string;
  lines: string[];
}

export interface MoodyTransitionReportModel {
  sections: MoodyTransitionSection[];
  isEmpty: boolean;
}

export function buildMoodyTransitionReport(sections: readonly MoodyTransitionSection[]): MoodyTransitionReportModel {
  const nonEmpty = sections.filter(section => section.lines.length > 0);
  return { sections: nonEmpty, isEmpty: nonEmpty.length === 0 };
}

// ---------------------------------------------------------------------------
// End-run recap
// ---------------------------------------------------------------------------

export function buildMoodyRecapRows(state: MoodyModeSaveData, seedLabel: string): MoodyLedgerRow[] {
  const rows: MoodyLedgerRow[] = [];
  rows.push({ kind: "header", label: "— MOODY MODE —", tint: MUTED_TINT, detail: "" });
  for (const curse of state.curses) {
    const definition = MOODY_CURSE_BY_ID.get(curse.curseId);
    rows.push({
      kind: "entry",
      label: `Curse: ${definition?.name ?? curse.curseId} (${definition == null ? "" : MOODY_DREAD_LABEL[definition.dread]})`,
      tint: CURSE_TINT,
      detail: definition?.description ?? "",
    });
  }
  rows.push({
    kind: "entry",
    label: `Final build: ${state.boons.length} lines · ${state.acquisitionRolls} acquisitions`,
    tint: 0xf8f8f8,
    detail: "",
  });
  for (const boon of [...state.boons].sort((left, right) => left.acquiredAtWave - right.acquiredAtWave)) {
    const definition = MOODY_BOON_BY_ID.get(boon.boonId);
    rows.push({
      kind: "entry",
      label: `Wave ${boon.acquiredAtWave} — ${definition?.name ?? boon.boonId} ${moodyRankLabel(boon, definition)}`,
      tint: MOODY_RARITY_TINT[definition?.rarity ?? "great"],
      detail: "",
    });
  }
  rows.push({ kind: "entry", label: `Run seed: ${seedLabel}`, tint: MUTED_TINT, detail: "" });
  return rows;
}
