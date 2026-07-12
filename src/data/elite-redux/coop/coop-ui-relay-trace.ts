/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { UiMode } from "#enums/ui-mode";

/** Authoritative carriers that can prove a real UI input escaped onto the co-op data plane. */
export type CoopUiRelayCarrier = "battleCommand" | "interactionChoice" | "interactionOutcome" | "operation";

export interface CoopUiRelayEdge {
  readonly inputId: number;
  readonly mode: UiMode;
  readonly carrier: CoopUiRelayCarrier;
  readonly detail: string;
}

interface ActiveUiInput {
  readonly id: number;
  readonly mode: UiMode;
}

const edges: CoopUiRelayEdge[] = [];
const hitModes = new Set<UiMode>();
const inputStack: ActiveUiInput[] = [];
let nextInputId = 1;
const EDGE_CAPACITY = 2_048;

/**
 * Open a synchronous production UI-input scope. Only {@linkcode Ui.processInput} may call this: test helpers
 * that invoke a handler or relay directly therefore cannot manufacture UI-to-relay coverage.
 */
export function beginCoopUiRelayInput(mode: UiMode): number {
  const id = nextInputId++;
  inputStack.push({ id, mode });
  return id;
}

/** Close the matching scope without disturbing a nested input/replay scope. */
export function endCoopUiRelayInput(id: number): void {
  for (let index = inputStack.length - 1; index >= 0; index--) {
    if (inputStack[index]?.id === id) {
      inputStack.splice(index, 1);
      return;
    }
  }
}

/**
 * Called only at production carrier choke points. A send outside a real `Ui.processInput` scope is valid
 * gameplay, but it is not evidence that the UI adapter is wired and deliberately earns no contract hit.
 */
export function recordCoopUiRelayCarrier(carrier: CoopUiRelayCarrier, detail: string): void {
  const input = inputStack.at(-1);
  if (input == null) {
    return;
  }
  hitModes.add(input.mode);
  edges.push({ inputId: input.id, mode: input.mode, carrier, detail });
  while (edges.length > EDGE_CAPACITY) {
    edges.shift();
  }
}

/** Immutable diagnostic/test snapshot. */
export function getCoopUiRelayEdges(): readonly CoopUiRelayEdge[] {
  return edges.map(edge => ({ ...edge }));
}

/** Modes for which a real UI input reached at least one authoritative carrier. */
export function getCoopUiRelayHitModes(): ReadonlySet<UiMode> {
  return new Set(hitModes);
}

/** Compact report block showing whether recent human-facing inputs actually escaped onto a carrier. */
export function formatCoopUiRelayTrace(limit = 16): string {
  const selected = edges.slice(-Math.max(0, Math.trunc(limit)));
  if (selected.length === 0) {
    return "uiRelay:  none";
  }
  return [
    `uiRelay:  ${selected.length}/${edges.length} recent carrier edges`,
    ...selected.map(edge => `  input#${edge.inputId} mode=${UiMode[edge.mode]} carrier=${edge.carrier} ${edge.detail}`),
  ].join("\n");
}

/** Session/test hygiene. */
export function resetCoopUiRelayTrace(): void {
  edges.length = 0;
  hitModes.clear();
  inputStack.length = 0;
  nextInputId = 1;
}
