/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Bounded structured causality ledger for co-op bug reports. Console lines are useful to humans but cannot
 * reliably answer "which commit caused this apply/ACK/retry?". Every entry here carries one canonical id
 * (operation id, lobby decision id, command address, or snapshot id) and an explicit lifecycle stage.
 */

export type CoopCausalDomain = "lobby" | "operation" | "snapshot" | "command" | "recovery";

export interface CoopCausalEvent {
  readonly sequence: number;
  readonly recordedAt: number;
  readonly domain: CoopCausalDomain;
  readonly stage: string;
  readonly causalId: string;
  readonly parentId?: string | undefined;
  readonly role?: "host" | "guest" | undefined;
  readonly epoch?: number | undefined;
  readonly revision?: number | undefined;
  readonly wave?: number | undefined;
  readonly turn?: number | undefined;
  readonly detail?: string | undefined;
}

export type CoopCausalEventInput = Omit<CoopCausalEvent, "sequence" | "recordedAt">;

const TRACE_CAPACITY = 512;
const events: CoopCausalEvent[] = [];
let nextSequence = 1;

/** Record one lifecycle edge. Invalid/empty ids are refused so reports never contain uncorrelatable noise. */
export function recordCoopCausalEvent(input: CoopCausalEventInput): void {
  if (input.causalId.trim().length === 0 || input.stage.trim().length === 0) {
    return;
  }
  events.push({ ...input, sequence: nextSequence++, recordedAt: Date.now() });
  while (events.length > TRACE_CAPACITY) {
    events.shift();
  }
}

/** Immutable copy for diagnostics/tests. */
export function getCoopCausalTrace(): readonly CoopCausalEvent[] {
  return events.map(event => ({ ...event }));
}

/** Session/test hygiene. */
export function resetCoopCausalTrace(): void {
  events.length = 0;
  nextSequence = 1;
}

/** Compact, stable report block. The most recent edge is last, preserving causal reading order. */
export function formatCoopCausalTrace(limit = 32): string {
  const selected = events.slice(-Math.max(0, Math.trunc(limit)));
  if (selected.length === 0) {
    return "causal:   none";
  }
  return [
    `causal:   ${selected.length}/${events.length} most-recent edges`,
    ...selected.map(event => {
      const address = [
        event.epoch == null ? null : `e${event.epoch}`,
        event.revision == null ? null : `r${event.revision}`,
        event.wave == null ? null : `w${event.wave}`,
        event.turn == null ? null : `t${event.turn}`,
      ]
        .filter(Boolean)
        .join("/");
      return (
        `  #${event.sequence} ${event.domain}:${event.stage} id=${event.causalId}`
        + `${event.parentId == null ? "" : ` parent=${event.parentId}`}`
        + `${event.role == null ? "" : ` role=${event.role}`}`
        + `${address.length === 0 ? "" : ` @${address}`}`
        + `${event.detail == null ? "" : ` ${event.detail}`}`
      );
    }),
  ].join("\n");
}
