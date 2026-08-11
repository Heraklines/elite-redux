/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MoodyTransitionSection } from "#ui/moody/moody-presentation";

export type MoodyMoveStateKind =
  | "temporary"
  | "sealed"
  | "pp"
  | "overdraft"
  | "refrain"
  | "guaranteed-secondary"
  | "cannot-miss";

export interface MoodyMoveTilePresentation {
  pokemonId: number;
  moveId: number;
  temporary?: boolean;
  sealed?: boolean;
  ppCost?: number;
  overdraftHpPercent?: number;
  overdraftPowerPercent?: number;
  refrainCount?: number;
  guaranteedSecondary?: boolean;
  cannotMiss?: boolean;
  sourceLabel?: string;
  durationLabel?: string;
  originalMoveName?: string;
}

export interface MoodyTemporaryAbilityPresentation {
  abilityId: number;
  name: string;
  description: string;
  sourceLabel: string;
  durationLabel?: string;
  /** Ability Carousel is visually the fifth ability, not a replacement. */
  carousel?: boolean;
}

export interface MoodyItemStackPresentation {
  stackId: string;
  name: string;
  count: number;
  sourceLabel?: string;
  attachedEffects?: readonly string[];
  disabled?: boolean;
  disabledReason?: string;
  setLabel?: string;
  setProgress?: string;
  amplificationLabel?: string;
}

export interface MoodyAttributedModifierPresentation {
  label: string;
  value: string;
  sourceLabel: string;
}

export interface MoodyCurseMarkerPresentation {
  id: string;
  label: string;
  detail: string;
  pokemonId?: number;
  urgency?: "normal" | "warning" | "critical";
}

export interface MoodyDynamicTrackerPresentation {
  id: string;
  label: string;
  value: string;
  detail?: string;
  pokemonId?: number;
  urgency?: "normal" | "warning" | "critical";
  pinned?: boolean;
}

export interface MoodyPokemonPresentation {
  pokemonId: number;
  temporaryAbilities?: readonly MoodyTemporaryAbilityPresentation[];
  moves?: readonly MoodyMoveTilePresentation[];
  itemStacks?: readonly MoodyItemStackPresentation[];
  barrier?: number;
  damageDebt?: number;
  debtDueLabel?: string;
  revivalCharges?: number;
  revivalLabel?: string;
  modifiers?: readonly MoodyAttributedModifierPresentation[];
}

export interface MoodyBountyTrackerPresentation {
  id: string;
  name: string;
  progressLabel: string;
  status: "active" | "complete" | "failed";
  detail?: string;
}

export interface MoodyRunRecapPresentation {
  selectedCurse?: string;
  mostTriggered?: readonly string[];
  completedBounties?: readonly string[];
  highestGlory?: number;
  flawlessLedgerProgress?: string;
  mostUsedPokemon?: string;
  majorCurseEvents?: readonly string[];
  replayId?: string;
}

export interface MoodyRecruiterEyePresentation {
  pokemonId: number;
  guaranteedTrait: string;
  activeAbilityCollected: number;
  activeAbilityTotal: number;
  missingEggMoves: number;
  missingNatures: number;
  ivSummary: string;
}

export interface MoodyLivePresentationSnapshot {
  pokemon?: readonly MoodyPokemonPresentation[];
  enemyEncounterId?: string;
  observedEnemyBoonInstanceIds?: readonly string[];
  observedEnemyMoveIds?: readonly number[];
  observedEnemyAbilityIds?: readonly number[];
  observedEnemyItemStackIds?: readonly string[];
  bounty?: MoodyBountyTrackerPresentation;
  trackers?: readonly MoodyDynamicTrackerPresentation[];
  curseMarkers?: readonly MoodyCurseMarkerPresentation[];
  recruiterEye?: MoodyRecruiterEyePresentation;
  recap?: MoodyRunRecapPresentation;
}

let liveSnapshot: MoodyLivePresentationSnapshot | null = null;

/** UI-owned, read-only projection. Mechanics replaces it after each durable state change. */
export function setMoodyLivePresentationSnapshot(snapshot: MoodyLivePresentationSnapshot | null): void {
  liveSnapshot = snapshot;
}

export function getMoodyLivePresentationSnapshot(): MoodyLivePresentationSnapshot | null {
  return liveSnapshot;
}

export function getMoodyPokemonPresentation(pokemonId: number): MoodyPokemonPresentation | null {
  return liveSnapshot?.pokemon?.find(entry => entry.pokemonId === pokemonId) ?? null;
}

export function getMoodyMovePresentation(pokemonId: number, moveId: number): MoodyMoveTilePresentation | null {
  return getMoodyPokemonPresentation(pokemonId)?.moves?.find(move => move.moveId === moveId) ?? null;
}

export function buildMoodyMoveStateLabels(move: MoodyMoveTilePresentation | null): string[] {
  if (move == null) {
    return [];
  }
  const labels: string[] = [];
  if (move.temporary) {
    labels.push(`TEMP${move.durationLabel == null ? "" : `: ${move.durationLabel}`}`);
  }
  if (move.sealed) {
    labels.push("SEALED");
  }
  if (move.ppCost != null && move.ppCost > 1) {
    labels.push(`PP COST ${move.ppCost}`);
  }
  if (move.overdraftHpPercent != null && move.overdraftHpPercent > 0) {
    labels.push(
      `OVERDRAFT: ${move.overdraftHpPercent}% max HP${
        move.overdraftPowerPercent == null ? "" : ` / +${move.overdraftPowerPercent}% power`
      }`,
    );
  }
  if (move.refrainCount != null && move.refrainCount > 0) {
    labels.push(`REFRAIN x${move.refrainCount}`);
  }
  if (move.guaranteedSecondary) {
    labels.push("SECONDARY GUARANTEED");
  }
  if (move.cannotMiss) {
    labels.push("CANNOT MISS");
  }
  if (move.originalMoveName != null) {
    labels.push(`REPLACES: ${move.originalMoveName}`);
  }
  if (move.sourceLabel != null) {
    labels.push(`SOURCE: ${move.sourceLabel}`);
  }
  return labels;
}

export function buildMoodyMoveTileSuffix(move: MoodyMoveTilePresentation | null): string {
  if (move == null) {
    return "";
  }
  const flags = [
    move.temporary ? "T" : "",
    move.sealed ? "X" : "",
    move.ppCost != null && move.ppCost > 1 ? `P${move.ppCost}` : "",
    move.overdraftHpPercent != null && move.overdraftHpPercent > 0 ? "O" : "",
    move.refrainCount != null && move.refrainCount > 0 ? `R${move.refrainCount}` : "",
    move.guaranteedSecondary ? "S" : "",
    move.cannotMiss ? "!" : "",
  ].filter(Boolean);
  return flags.length === 0 ? "" : ` [${flags.join(" ")}]`;
}

export interface MoodySummaryPresentationRow {
  label: string;
  detail: string;
  tint: number;
}

export function buildMoodyRuntimeSummaryRows(
  presentation: MoodyPokemonPresentation | null,
): MoodySummaryPresentationRow[] {
  if (presentation == null) {
    return [];
  }
  const rows: MoodySummaryPresentationRow[] = [];
  for (const ability of presentation.temporaryAbilities ?? []) {
    rows.push({
      label: `${ability.carousel ? "ABILITY 5" : "TEMP ABILITY"} / ${ability.name}`,
      detail: `${ability.description}\nSOURCE: ${ability.sourceLabel}${
        ability.durationLabel == null ? "" : `\nDURATION: ${ability.durationLabel}`
      }`,
      tint: 0x66d9ef,
    });
  }
  for (const move of presentation.moves ?? []) {
    const state = buildMoodyMoveStateLabels(move);
    if (state.length > 0) {
      rows.push({
        label: `MOVE / ${move.moveId}${buildMoodyMoveTileSuffix(move)}`,
        detail: state.join("\n"),
        tint: 0x80cbc4,
      });
    }
  }
  for (const stack of presentation.itemStacks ?? []) {
    const detail = [
      `COUNT: x${stack.count}`,
      stack.sourceLabel == null ? "" : `SOURCE: ${stack.sourceLabel}`,
      ...(stack.attachedEffects ?? []).map(effect => `ATTACHED: ${effect}`),
      stack.setLabel == null
        ? ""
        : `SET: ${stack.setLabel}${stack.setProgress == null ? "" : ` (${stack.setProgress})`}`,
      stack.amplificationLabel == null ? "" : `AMPLIFIED: ${stack.amplificationLabel}`,
      stack.disabled ? `DISABLED: ${stack.disabledReason ?? "suppressed"}` : "",
    ].filter(Boolean);
    rows.push({
      label: `ITEM STACK / ${stack.name} x${stack.count}`,
      detail: detail.join("\n"),
      tint: stack.disabled ? 0x9a90a8 : 0xf8d038,
    });
  }
  if ((presentation.barrier ?? 0) > 0) {
    rows.push({
      label: `BARRIER / ${presentation.barrier}`,
      detail: "Temporary damage absorption currently active.",
      tint: 0x66d9ef,
    });
  }
  if ((presentation.damageDebt ?? 0) > 0) {
    rows.push({
      label: `DAMAGE DEBT / ${presentation.damageDebt}`,
      detail: presentation.debtDueLabel ?? "Pending damage debt.",
      tint: 0xdb4343,
    });
  }
  if ((presentation.revivalCharges ?? 0) > 0) {
    rows.push({
      label: `${presentation.revivalLabel ?? "REVIVAL"} / x${presentation.revivalCharges}`,
      detail: "Remaining revival charges.",
      tint: 0xe331c5,
    });
  }
  for (const modifier of presentation.modifiers ?? []) {
    rows.push({
      label: `MODIFIER / ${modifier.label}: ${modifier.value}`,
      detail: `SOURCE: ${modifier.sourceLabel}`,
      tint: 0xf8f8f8,
    });
  }
  return rows;
}

export function buildMoodyMarkerSummaryRows(
  snapshot: MoodyLivePresentationSnapshot | null,
  pokemonId: number,
): MoodySummaryPresentationRow[] {
  if (snapshot == null) {
    return [];
  }
  return [
    ...(snapshot.trackers ?? [])
      .filter(tracker => tracker.pokemonId === pokemonId)
      .map(tracker => ({
        label: `TRACKER / ${tracker.label}: ${tracker.value}`,
        detail: tracker.detail ?? "Live Moody cadence counter.",
        tint: tracker.urgency === "critical" ? 0xdb4343 : tracker.urgency === "warning" ? 0xf8d038 : 0x66d9ef,
      })),
    ...(snapshot.curseMarkers ?? [])
      .filter(marker => marker.pokemonId === pokemonId)
      .map(marker => ({
        label: `CURSE / ${marker.label}`,
        detail: marker.detail,
        tint: marker.urgency === "critical" ? 0xdb4343 : 0xe331c5,
      })),
  ];
}

export function buildMoodyDetailedRecapSections(
  base: readonly MoodyTransitionSection[],
  recap: MoodyRunRecapPresentation | undefined,
): MoodyTransitionSection[] {
  if (recap == null) {
    return [...base];
  }
  const mostTriggered = recap.mostTriggered ?? [];
  const completedBounties = recap.completedBounties ?? [];
  return [
    ...base,
    ...(recap.selectedCurse == null ? [] : [{ title: "SELECTED CURSE", lines: [recap.selectedCurse] }]),
    ...(mostTriggered.length > 0 ? [{ title: "MOST TRIGGERED", lines: [...mostTriggered] }] : []),
    ...(completedBounties.length > 0 ? [{ title: "BOUNTIES COMPLETED", lines: [...completedBounties] }] : []),
    {
      title: "RUN HIGHLIGHTS",
      lines: [
        recap.highestGlory == null ? "" : `Highest Chosen One Glory: ${recap.highestGlory}`,
        recap.flawlessLedgerProgress == null ? "" : `Flawless Ledger: ${recap.flawlessLedgerProgress}`,
        recap.mostUsedPokemon == null ? "" : `Most-used Pokemon: ${recap.mostUsedPokemon}`,
        ...(recap.majorCurseEvents ?? []).map(event => `Curse event: ${event}`),
        recap.replayId == null ? "" : `Replay / report ID: ${recap.replayId}`,
      ].filter(Boolean),
    },
  ].filter(section => section.lines.length > 0);
}
