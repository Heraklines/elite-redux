/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * One same-context mutation tail for session cloud writes. It orders ordinary `updateAll` saves and
 * guest co-op mirrors even when different GameData instances share the account in tests/reloads.
 * Cross-tab/device ordering still requires the save API's conditional run/revision CAS.
 */
const sessionCloudMutationTails = new Map<string, Promise<void>>();

export type SessionProtection = "solo" | "coop-valid" | "coop-invalid" | "unknown";

const COOP_GAME_MODE_ID = 6;
const COOP_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;

/**
 * Classify untrusted session bytes before choosing a legacy or protected mutation path.
 * Keep this deliberately structural so pre-run-id co-op saves remain protected migration debt.
 */
export function classifySessionProtection(data: string | null): SessionProtection {
  if (data == null) {
    return "solo";
  }
  try {
    const parsed = JSON.parse(data) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "unknown";
    }
    const record = parsed as Record<string, unknown>;
    const coopLike =
      record.gameMode === COOP_GAME_MODE_ID
      || Object.hasOwn(record, "coopRun")
      || Object.hasOwn(record, "coopParticipants")
      || Object.hasOwn(record, "coopControlPlane");
    if (!coopLike) {
      return "solo";
    }
    const coopRun = record.coopRun;
    if (coopRun == null || typeof coopRun !== "object" || Array.isArray(coopRun)) {
      return "coop-invalid";
    }
    const run = coopRun as Record<string, unknown>;
    return typeof run.runId === "string"
      && COOP_RUN_ID_PATTERN.test(run.runId)
      && typeof run.checkpointRevision === "number"
      && Number.isSafeInteger(run.checkpointRevision)
      && run.checkpointRevision >= 0
      ? "coop-valid"
      : "coop-invalid";
  } catch {
    return "unknown";
  }
}

function normalizeAccountScope(accountScope: string | null | undefined): string {
  return accountScope == null ? "<guest>" : accountScope.normalize("NFKC").toLowerCase();
}

/** Only definitive ownership/version failures terminate a shared run; transport/read outages accrue debt. */
export function isDeterministicCoopCloudCasFailure(message: string): boolean {
  return /\b(?:conflict|changed|deleted|another|revision|digest|tombstone|invalid)\b|account changed|does not advance/iu.test(
    message,
  );
}

export function enqueueSessionCloudMutation<T>(
  accountScope: string | null | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const scope = normalizeAccountScope(accountScope);
  const tail = sessionCloudMutationTails.get(scope) ?? Promise.resolve();
  const result = tail.then(operation, operation);
  const nextTail = result.then(
    () => undefined,
    () => undefined,
  );
  sessionCloudMutationTails.set(scope, nextTail);
  void nextTail.finally(() => {
    if (sessionCloudMutationTails.get(scope) === nextTail) {
      sessionCloudMutationTails.delete(scope);
    }
  });
  return result;
}

/** Test-only visibility/reset; production should never clear ordering while requests are active. */
export function resetSessionCloudMutationTailForTests(): void {
  sessionCloudMutationTails.clear();
}
