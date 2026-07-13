/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopOperationSurfaceClass } from "#data/elite-redux/coop/coop-operation-surface-registry";
import { UiMode } from "#enums/ui-mode";

/** Authoritative carriers that can prove a real UI input escaped onto the co-op data plane. */
export type CoopUiRelayCarrier = "battleCommand" | "interactionChoice" | "interactionOutcome" | "operation";

export interface CoopUiRelayEdge {
  readonly inputId: number;
  readonly mode: UiMode;
  readonly carrier: CoopUiRelayCarrier;
  readonly detail: string;
  readonly operationClass?: CoopOperationSurfaceClass;
}

interface ActiveUiInput {
  readonly id: number;
  readonly mode: UiMode;
}

const edges: CoopUiRelayEdge[] = [];
const hitModes = new Set<UiMode>();
const hitUiOperations = new Set<string>();
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
export function recordCoopUiRelayCarrier(
  carrier: CoopUiRelayCarrier,
  detail: string,
  operationClass?: CoopOperationSurfaceClass,
): void {
  const input = inputStack.at(-1);
  if (input == null) {
    return;
  }
  hitModes.add(input.mode);
  if (operationClass != null) {
    hitUiOperations.add(coopUiOperationHitKey(input.mode, operationClass));
  }
  edges.push({
    inputId: input.id,
    mode: input.mode,
    carrier,
    detail,
    ...(operationClass == null ? {} : { operationClass }),
  });
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

/** Stable key for a proven public UI input -> committed operation-class edge. */
export function coopUiOperationHitKey(mode: UiMode, operationClass: CoopOperationSurfaceClass): string {
  return `${UiMode[mode]}->${operationClass}`;
}

/** Operation/UI pairs proven synchronously at production choke points (not limited by the diagnostic ring). */
export function getCoopUiOperationHits(): ReadonlySet<string> {
  return new Set(hitUiOperations);
}

/** Compact report block showing whether recent human-facing inputs actually escaped onto a carrier. */
export function formatCoopUiRelayTrace(limit = 16): string {
  const selected = edges.slice(-Math.max(0, Math.trunc(limit)));
  if (selected.length === 0) {
    return "uiRelay:  none";
  }
  return [
    `uiRelay:  ${selected.length}/${edges.length} recent carrier edges`,
    ...selected.map(
      edge =>
        `  input#${edge.inputId} mode=${UiMode[edge.mode]} carrier=${edge.carrier}`
        + `${edge.operationClass == null ? "" : ` operation=${edge.operationClass}`} ${edge.detail}`,
    ),
  ].join("\n");
}

/** Session/test hygiene. */
export function resetCoopUiRelayTrace(): void {
  edges.length = 0;
  hitModes.clear();
  hitUiOperations.clear();
  inputStack.length = 0;
  nextInputId = 1;
}
