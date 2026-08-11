/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MoodyBoonTarget } from "#data/elite-redux/moody/moody-types";

export type MoodyOperationKind =
  | "recycler"
  | "bounty"
  | "legacy"
  | "borrowed-future"
  | "blood-market"
  | "pressure-valve"
  | "item-stack";

export interface MoodyOperationOption {
  id: string;
  label: string;
  description: string;
  consequenceLines?: readonly string[];
  badge?: string;
  eligible?: boolean;
  ineligibleReason?: string;
  selected?: boolean;
}

export interface MoodyCommittedActionPresentation {
  pokemonId?: string;
  actor: string;
  action: string;
  target: string;
}

export interface MoodyOperationModel {
  kind: MoodyOperationKind;
  title: string;
  prompt?: string;
  options: readonly MoodyOperationOption[];
  confirmLabel: string;
  cancellable: boolean;
  minSelections?: number;
  maxSelections?: number;
  reorderable?: boolean;
  leadCount?: number;
  committedActions?: readonly MoodyCommittedActionPresentation[];
  detailLines?: readonly string[];
  trackerLabel?: string;
}

export interface MoodyOperationResult {
  action: "confirm" | "cancel";
  selectedIds: string[];
  orderedIds: string[];
}

export function isMoodyOperationModel(model: unknown): model is MoodyOperationModel {
  return typeof model === "object" && model != null && "kind" in model && "confirmLabel" in model;
}

/**
 * Plain-language selection requirement shown beside the panel title so that
 * "pick exactly one" (Pressure Valve) never relies on iconography alone:
 * "SELECT 1 OF 1", "2 OF 3 SELECTED", or "" once the pick count is satisfied.
 */
export function moodyOperationSelectionLabel(selected: number, max: number): string {
  const required = Math.max(1, max);
  if (selected >= required) {
    return "";
  }
  return selected === 0 ? `SELECT 1 OF ${required}` : `${selected} OF ${required} SELECTED`;
}

/**
 * Negative Space must leave at least one usable damaging move and may never
 * seal structural moves. Mechanics supplies the actual move classification;
 * this helper supplies the shared picker rule and reason text.
 */
export function moodyNegativeSpaceEligibility(input: {
  damaging: boolean;
  eligible: boolean;
  structural?: boolean;
  usableDamagingMoveCount: number;
}): { eligible: boolean; reason?: string } {
  if (!input.eligible || input.structural === true) {
    return { eligible: false, reason: "Structural or otherwise ineligible move." };
  }
  if (input.damaging && input.usableDamagingMoveCount <= 1) {
    return { eligible: false, reason: "Cannot seal the last usable damaging move." };
  }
  return { eligible: true };
}

export function buildPressureValveOperation(values: {
  healing: string;
  barrier: string;
  pp: string;
}): MoodyOperationModel {
  return {
    kind: "pressure-valve",
    title: "PRESSURE VALVE",
    prompt: "Choose exactly one conversion.",
    confirmLabel: "apply conversion",
    cancellable: false,
    minSelections: 1,
    maxSelections: 1,
    options: [
      { id: "healing", label: "HEALING", description: values.healing },
      { id: "barrier", label: "BARRIER", description: values.barrier },
      { id: "pp", label: "PP", description: values.pp },
    ],
  };
}

export type MoodyPressureValveOption = "healing" | "barrier" | "pp";

export function buildPressureValveBoonTarget(
  pokemonId: number,
  partySlot: number,
  selectedIds: readonly string[],
): MoodyBoonTarget | null {
  const option = selectedIds.length === 1 ? selectedIds[0] : undefined;
  if (option !== "healing" && option !== "barrier" && option !== "pp") {
    return null;
  }
  return { pokemonIds: [pokemonId], partySlots: [partySlot], option };
}
