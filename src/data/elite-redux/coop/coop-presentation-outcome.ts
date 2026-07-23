/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** The terminal result of one immutable authority-authored presentation event. */
export type CoopPresentationOutcome =
  | { readonly kind: "rendered"; readonly actorFingerprint?: string }
  | {
      readonly kind: "intentionally-skipped";
      readonly reason: "animations-disabled";
      readonly actorFingerprint?: string;
    }
  | { readonly kind: "failed"; readonly reason: string; readonly actorFingerprint?: string };

/**
 * One process-local proof cell shared by a replay phase, any requeued continuation, the turn finalizer,
 * and the browser evidence receipt. It is deliberately not serializable authority state.
 */
export interface CoopPresentationOutcomeToken {
  readonly presentationOutcomeToken: true;
}

const outcomes = new WeakMap<CoopPresentationOutcomeToken, CoopPresentationOutcome>();

export function createCoopPresentationOutcomeToken(): CoopPresentationOutcomeToken {
  return Object.freeze({ presentationOutcomeToken: true });
}

/** First terminal result wins; a late animation callback cannot overwrite a watchdog failure. */
export function settleCoopPresentationOutcome(
  token: CoopPresentationOutcomeToken,
  outcome: CoopPresentationOutcome,
): boolean {
  if (outcomes.has(token)) {
    return false;
  }
  outcomes.set(token, Object.freeze({ ...outcome }));
  return true;
}

export function coopPresentationOutcome(token: CoopPresentationOutcomeToken): CoopPresentationOutcome | undefined {
  return outcomes.get(token);
}

export function coopPresentationOutcomeAllowsProgress(outcome: CoopPresentationOutcome | undefined): boolean {
  return outcome?.kind === "rendered" || outcome?.kind === "intentionally-skipped";
}

export function inspectCoopPresentationOutcomes(tokens: readonly CoopPresentationOutcomeToken[]): {
  readonly pending: number;
  readonly failed: readonly CoopPresentationOutcome[];
} {
  const failed: CoopPresentationOutcome[] = [];
  let pending = 0;
  for (const token of tokens) {
    const outcome = outcomes.get(token);
    if (outcome == null) {
      pending += 1;
    } else if (outcome.kind === "failed") {
      failed.push(outcome);
    }
  }
  return Object.freeze({ pending, failed: Object.freeze(failed) });
}
