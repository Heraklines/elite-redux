/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op RESUME MARKER (#810, made symmetric + identity-gated per the maintainer
// directive): the lobby's memory that "I have a saved run with THIS partner".
//
// WHY THIS EXISTS / WHAT WAS BROKEN LIVE: the run's SAVE lives in each client's
// own local slot (both the host and the guest write it - `saveAll` has no guest
// early-return). But the marker used to be recorded ONLY by the host and read
// ONLY by the host, while the lobby re-decides "host" every connect (the ACCEPTOR
// of the join request becomes host - `respondToRequest`). So the player who saved
// the run (last session's host) is only THIS session's host if they happen to
// accept; when the ex-guest accepts and becomes host, it looked up a marker it
// never wrote -> no offer -> the flow silently started a NEW game. BOTH clients
// now record the marker, but a pair alone is not sufficient: host/guest is the
// persisted authority-seat assignment that owns Pokemon and control-plane state.
// A cold resume is offered only when both stable identities occupy their saved
// seats. A reversed assignment is safely rejected instead of swapping ownership.
//
// The marker is a pointer, not a save - the session itself lives in the normal
// save slot. Discovery freezes and hashes the validated bytes; the accepted offer
// applies those exact bytes rather than re-reading a mutable slot.
// =============================================================================

import { type CoopControlPlaneSaveData, isCoopControlPlaneSaveData } from "#data/elite-redux/coop/coop-control-plane";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { canonicalCoopParticipantPair, isCoopRunId, sameCoopIdentity } from "#data/elite-redux/coop/coop-run-identity";
import type { CoopResumeCommitment, CoopRole } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";

const COOP_RESUME_MARKER_KEY = "er-coop-resume";
const COOP_RESUME_UNAVAILABLE_KEY = "er-coop-resume-unavailable";
const COOP_DELETED_RUNS_KEY = "er-coop-deleted-runs";

/** Exact browser-storage evidence surrounding one checkpoint replica mutation. */
export interface CoopResumeEvidenceSnapshot {
  markerRaw: string | null;
  unavailableRaw: string | null;
}

export interface CoopResumeMarker {
  /** The save slot holding the co-op session (this client's own auto-picked slot). */
  slot: number;
  /** The LOCAL player's account identity at save time (the run's participant, self). */
  self: string;
  /** The partner's account identity at save time (matched on reconnect). */
  partner: string;
  /** Wave the run was on when saved (shown in the Resume offer). */
  wave: number;
  /** Stable host-minted run identity; same partner pair may own multiple independent runs. */
  runId: string;
  /** Host-monotonic persistence revision, independent of wave/control journal revisions. */
  checkpointRevision: number;
  /** Save timestamp (freshness display / future expiry). */
  ts: number;
}

export interface CoopResumeCandidate extends CoopResumeMarker {
  /** Frozen serialized bytes validated during discovery; never re-read from the mutable slot. */
  sessionJson: string;
  /** Discriminator offered to the guest and revalidated before either scene mutates. */
  commitment: CoopResumeCommitment;
}

/** Exact selected replica. Parsed data is for validation/rendering; `sessionJson` remains authoritative. */
export interface CoopResumeLoadedSession {
  session: CoopResumeSessionSummary;
  sessionJson: string;
}

interface CoopResumeUnavailableEvidence {
  version: 1;
  self: string;
  partner: string;
  wave: number;
  runId: string;
  checkpointRevision: number;
  seats: { host: string; guest: string };
  ts: number;
}

export type CoopResumeDiscovery =
  | { kind: "candidate"; candidate: CoopResumeCandidate }
  | { kind: "no-save" }
  | { kind: "unsafe-role-reversal"; slot: number; wave: number; seats: { host: string; guest: string } }
  | { kind: "legacy-unmappable"; slot: number; wave: number }
  | { kind: "replica-indeterminate"; wave: number }
  | {
      kind: "replica-unavailable";
      wave: number;
      runId: string;
      checkpointRevision: number;
      seats: { host: string; guest: string };
    };

/** User-facing blocker text; unsafe saves are never silently collapsed into the New Game path. */
export function coopResumeBlockMessage(discovery: CoopResumeDiscovery): string | null {
  if (discovery.kind === "unsafe-role-reversal") {
    return (
      `A co-op save was found at wave ${discovery.wave}, but the host/guest seats are reversed. `
      + "Reconnect with the same player accepting the invite as in the saved run, then choose Continue."
    );
  }
  if (discovery.kind === "legacy-unmappable") {
    return (
      `A legacy co-op save was found at wave ${discovery.wave}, but it has no safe player-seat mapping. `
      + "This save cannot be resumed without risking swapped Pokemon ownership."
    );
  }
  if (discovery.kind === "replica-unavailable") {
    return (
      `A co-op save exists at wave ${discovery.wave}, but this account had no verified free save slot for its resume `
      + "copy (slots were occupied or cloud status was unavailable). Free a slot if needed, then reconnect with this "
      + "partner; a new game was not started."
    );
  }
  if (discovery.kind === "replica-indeterminate") {
    return (
      "A co-op save may exist, but its local, cloud, or deletion state could not be reconciled safely. "
      + "Nothing was overwritten and a new run was not started. Reconnect when cloud saves are reachable or resolve the conflicting slot."
    );
  }
  return null;
}

export interface CoopResumeSessionSummary {
  gameMode: number;
  waveIndex: number;
  timestamp: number;
  coopParticipants?:
    | {
        version: 1;
        players: [string, string];
        seats: { host: string; guest: string };
      }
    | undefined;
  coopControlPlane?: CoopControlPlaneSaveData | undefined;
  coopRun?:
    | {
        version: 1;
        runId: string;
        checkpointRevision: number;
      }
    | undefined;
}

/** Runtime-safe exact participant-pair check for untrusted/legacy serialized save data. */
export function coopParticipantPairMatches(players: unknown, self: string, partner: string): boolean {
  if (
    !Array.isArray(players)
    || players.length !== 2
    || typeof players[0] !== "string"
    || typeof players[1] !== "string"
    || players[0].length === 0
    || players[1].length === 0
  ) {
    return false;
  }
  const actual = canonicalCoopParticipantPair(players[0], players[1]);
  const expected = canonicalCoopParticipantPair(self, partner);
  return sameCoopIdentity(actual[0], expected[0]) && sameCoopIdentity(actual[1], expected[1]);
}

export function coopSeatMapMatches(
  participants: CoopResumeSessionSummary["coopParticipants"] | undefined,
  self: string,
  partner: string,
  localRole: CoopRole,
): boolean {
  if (participants?.version !== 1 || !coopParticipantPairMatches(participants.players, self, partner)) {
    return false;
  }
  const expectedHost = localRole === "host" ? self : partner;
  const expectedGuest = localRole === "guest" ? self : partner;
  return (
    sameCoopIdentity(participants.seats?.host, expectedHost)
    && sameCoopIdentity(participants.seats?.guest, expectedGuest)
  );
}

/** SHA-256 over the exact serialized bytes carried through the cold-resume decision. */
export async function digestCoopResumeSession(sessionJson: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionJson));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function sessionRevision(session: CoopResumeSessionSummary): number {
  const controlPlane = session.coopControlPlane;
  if (!isCoopControlPlaneSaveData(controlPlane)) {
    return -1;
  }
  let revision = controlPlane.interactionCounter;
  for (const mark of Object.values(controlPlane.journalHighWater)) {
    revision = Math.max(revision, mark);
  }
  return revision;
}

async function buildResumeCandidate(
  marker: CoopResumeMarker,
  loaded: CoopResumeLoadedSession,
): Promise<CoopResumeCandidate> {
  const { session, sessionJson } = loaded;
  const commitment = await deriveCoopResumeCommitment(sessionJson, session);
  if (commitment == null) {
    throw new Error("validated co-op resume candidate lost its discriminator fields");
  }
  return {
    ...marker,
    wave: session.waveIndex,
    runId: commitment.runId,
    checkpointRevision: commitment.checkpointRevision,
    ts: session.timestamp,
    sessionJson,
    commitment,
  };
}

export async function deriveCoopResumeCommitment(
  sessionJson: string,
  session: CoopResumeSessionSummary,
): Promise<CoopResumeCommitment | null> {
  const participants = session.coopParticipants;
  const coopRun = session.coopRun;
  if (
    session.gameMode !== GameModes.COOP
    || !Number.isInteger(session.waveIndex)
    || session.waveIndex <= 0
    || !Number.isSafeInteger(session.timestamp)
    || session.timestamp < 0
    || participants?.version !== 1
    || !Array.isArray(participants.players)
    || participants.players.length !== 2
    || typeof participants.players[0] !== "string"
    || typeof participants.players[1] !== "string"
    || typeof participants.seats?.host !== "string"
    || typeof participants.seats?.guest !== "string"
    || sameCoopIdentity(participants.players[0], participants.players[1])
    || sameCoopIdentity(participants.seats.host, participants.seats.guest)
    || coopRun?.version !== 1
    || !isCoopControlPlaneSaveData(session.coopControlPlane)
    || !isCoopRunId(coopRun.runId)
    || !Number.isSafeInteger(coopRun.checkpointRevision)
    || coopRun.checkpointRevision < 0
    || !coopParticipantPairMatches(
      [participants.seats.host, participants.seats.guest],
      participants.players[0],
      participants.players[1],
    )
  ) {
    return null;
  }
  return {
    version: 1,
    digest: await digestCoopResumeSession(sessionJson),
    gameMode: session.gameMode,
    wave: session.waveIndex,
    revision: sessionRevision(session),
    runId: coopRun.runId,
    checkpointRevision: coopRun.checkpointRevision,
    timestamp: session.timestamp,
    participants: canonicalCoopParticipantPair(participants.players[0], participants.players[1]),
    seats: { ...participants.seats },
  };
}

export async function coopResumeCommitmentMatches(
  sessionJson: string,
  session: CoopResumeSessionSummary,
  expected: CoopResumeCommitment,
): Promise<boolean> {
  const actual = await deriveCoopResumeCommitment(sessionJson, session);
  return (
    actual != null
    && actual.version === expected.version
    && actual.digest === expected.digest
    && actual.gameMode === expected.gameMode
    && actual.wave === expected.wave
    && actual.revision === expected.revision
    && actual.runId === expected.runId
    && actual.checkpointRevision === expected.checkpointRevision
    && actual.timestamp === expected.timestamp
    && coopParticipantPairMatches(actual.participants, expected.participants[0], expected.participants[1])
    && sameCoopIdentity(actual.seats.host, expected.seats.host)
    && sameCoopIdentity(actual.seats.guest, expected.seats.guest)
  );
}

function sessionDisposition(
  session: CoopResumeSessionSummary | undefined,
  self: string,
  partner: string,
  localRole: CoopRole,
): "candidate" | "no-match" | "unsafe-role-reversal" | "legacy-unmappable" {
  if (session == null || session.gameMode !== GameModes.COOP) {
    return "no-match";
  }
  const participants = session.coopParticipants;
  if (!coopParticipantPairMatches(participants?.players, self, partner)) {
    return "no-match";
  }
  if (
    participants?.version !== 1
    || typeof participants.seats?.host !== "string"
    || typeof participants.seats?.guest !== "string"
    || sameCoopIdentity(participants.seats.host, participants.seats.guest)
    || session.coopRun?.version !== 1
    || !isCoopControlPlaneSaveData(session.coopControlPlane)
    || !isCoopRunId(session.coopRun.runId)
    || !Number.isSafeInteger(session.coopRun.checkpointRevision)
    || session.coopRun.checkpointRevision < 0
    || !coopParticipantPairMatches(
      [participants.seats.host, participants.seats.guest],
      participants.players[0],
      participants.players[1],
    )
  ) {
    return "legacy-unmappable";
  }
  return coopSeatMapMatches(participants, self, partner, localRole) ? "candidate" : "unsafe-role-reversal";
}

/**
 * Resolve an exact-seat resume from the actual saved session. The marker is only a fast pointer
 * and never proof. Pre-seat-map saves are intentionally non-resumable because their unordered pair
 * cannot determine Pokemon/control ownership after lobby-role reversal. Valid saves are frozen and
 * SHA-256 bound here, preventing a scan-to-load slot replacement from changing the accepted bytes.
 */
export async function findCoopResumeCandidate(
  self: string,
  partner: string,
  localRole: CoopRole,
  loadSession: (slot: number) => Promise<CoopResumeLoadedSession | undefined>,
): Promise<CoopResumeDiscovery> {
  let replicaIndeterminate = false;
  const readMarker = readCoopResumeMarker(self, partner);
  const marker = readMarker != null && !isCoopRunLocallyDeleted(self, readMarker.runId) ? readMarker : null;
  const unavailable = readCoopResumeUnavailableEvidence(self, partner);
  let unsafe: Extract<CoopResumeDiscovery, { kind: "unsafe-role-reversal" | "legacy-unmappable" }> | null = null;
  if (marker != null) {
    const loaded = await loadSession(marker.slot).catch<CoopResumeLoadedSession | undefined>(error => {
      replicaIndeterminate = true;
      coopWarn("launch", `resume marker slot=${marker.slot} load failed -> scanning saves`, error);
      return;
    });
    const saved = loaded?.session;
    // Legacy unordered-pair saves are deliberately not resumable: without authenticated seat
    // ownership, a reversed lobby role would silently hand each player the other player's mons.
    const disposition =
      saved?.gameMode === GameModes.COOP && (saved.coopParticipants == null || saved.coopRun == null)
        ? "legacy-unmappable"
        : sessionDisposition(saved, self, partner, localRole);
    if (
      disposition === "candidate"
      && saved != null
      && marker.runId === saved.coopRun?.runId
      && marker.checkpointRevision <= saved.coopRun.checkpointRevision
    ) {
      return { kind: "candidate", candidate: await buildResumeCandidate(marker, loaded!) };
    }
    if (disposition === "unsafe-role-reversal" && saved?.coopParticipants != null) {
      unsafe = {
        kind: "unsafe-role-reversal",
        slot: marker.slot,
        wave: saved.waveIndex,
        seats: { ...saved.coopParticipants.seats },
      };
    } else if (disposition === "legacy-unmappable" && saved != null) {
      unsafe = { kind: "legacy-unmappable", slot: marker.slot, wave: saved.waveIndex };
    }
    coopWarn("launch", `resume marker slot=${marker.slot} is missing/non-coop/wrong-pair -> scanning saves`);
  }

  const sessions = await Promise.all(
    [0, 1, 2, 3, 4].map(async slot => ({
      slot,
      loaded: await loadSession(slot).catch<CoopResumeLoadedSession | undefined>(error => {
        replicaIndeterminate = true;
        coopWarn("launch", `resume scan slot=${slot} load failed (ignored)`, error);
        return;
      }),
    })),
  );
  const candidates = sessions
    .filter(
      ({ loaded }) =>
        sessionDisposition(loaded?.session, self, partner, localRole) === "candidate"
        && !isCoopRunLocallyDeleted(self, loaded?.session.coopRun?.runId ?? ""),
    )
    .sort((a, b) => (b.loaded?.session.timestamp ?? 0) - (a.loaded?.session.timestamp ?? 0));
  const best = candidates[0];
  if (best?.loaded == null) {
    if (unsafe != null) {
      return unsafe;
    }
    for (const { slot, loaded } of sessions) {
      const session = loaded?.session;
      const disposition = sessionDisposition(session, self, partner, localRole);
      if (disposition === "unsafe-role-reversal" && session?.coopParticipants != null) {
        return {
          kind: "unsafe-role-reversal",
          slot,
          wave: session.waveIndex,
          seats: { ...session.coopParticipants.seats },
        };
      }
      if (disposition === "legacy-unmappable" && session != null) {
        unsafe ??= { kind: "legacy-unmappable", slot, wave: session.waveIndex };
      }
    }
    if (unsafe != null) {
      return unsafe;
    }
    if (unavailable != null && !isCoopRunLocallyDeleted(self, unavailable.runId)) {
      return {
        kind: "replica-unavailable",
        wave: unavailable.wave,
        runId: unavailable.runId,
        checkpointRevision: unavailable.checkpointRevision,
        seats: { ...unavailable.seats },
      };
    }
    if (replicaIndeterminate) {
      return { kind: "replica-indeterminate", wave: 0 };
    }
    return { kind: "no-save" };
  }
  const recovered: CoopResumeMarker = {
    slot: best.slot,
    self,
    partner,
    wave: best.loaded.session.waveIndex,
    runId: best.loaded.session.coopRun!.runId,
    checkpointRevision: best.loaded.session.coopRun!.checkpointRevision,
    ts: best.loaded.session.timestamp,
  };
  recordCoopResumeMarker(recovered.slot, self, partner, recovered.wave, recovered.runId, recovered.checkpointRevision);
  coopLog("launch", `resume candidate recovered from save slot=${recovered.slot} wave=${recovered.wave}`);
  return { kind: "candidate", candidate: await buildResumeCandidate(recovered, best.loaded) };
}

/**
 * Record/refresh the marker on every co-op session save. Called by BOTH clients
 * (host and guest each hold their own local save slot), so whichever client is
 * assigned host on the next lobby connect can find its own resume memory.
 * `self` + `partner` are the two players' stable account identities (the same
 * `loggedInUser?.username`-derived names the lobby matches on).
 */
export function recordCoopResumeMarker(
  slot: number,
  self: string,
  partner: string,
  wave: number,
  runId: string,
  checkpointRevision: number,
): void {
  if (
    slot < 0
    || slot >= 5
    || !self
    || !partner
    || !isCoopRunId(runId)
    || !Number.isSafeInteger(checkpointRevision)
    || checkpointRevision < 0
    || isCoopRunLocallyDeleted(self, runId)
  ) {
    return;
  }
  try {
    const marker: CoopResumeMarker = { slot, self, partner, wave, runId, checkpointRevision, ts: Date.now() };
    localStorage.setItem(COOP_RESUME_MARKER_KEY, JSON.stringify(marker));
    localStorage.removeItem(COOP_RESUME_UNAVAILABLE_KEY);
    coopLog("launch", `resume marker recorded slot=${slot} self=${self} partner=${partner} wave=${wave} (#810)`);
  } catch {
    /* storage full/unavailable is non-fatal - resume just won't be offered */
  }
}

/**
 * Preserve explicit evidence when the guest cannot store the host's exact replica without
 * overwriting an unrelated run. Discovery consumes this outside-slot record on the next lobby so
 * role reversal cannot silently collapse a known co-op save into the New Game path.
 */
export function recordCoopResumeUnavailableEvidence(
  self: string,
  partner: string,
  wave: number,
  runId: string,
  checkpointRevision: number,
  seats: { host: string; guest: string },
): void {
  if (
    !self
    || !partner
    || !Number.isInteger(wave)
    || wave <= 0
    || !isCoopRunId(runId)
    || !Number.isSafeInteger(checkpointRevision)
    || checkpointRevision < 0
    || !coopParticipantPairMatches([seats.host, seats.guest], self, partner)
  ) {
    return;
  }
  try {
    const evidence: CoopResumeUnavailableEvidence = {
      version: 1,
      self,
      partner,
      wave,
      runId,
      checkpointRevision,
      seats: { ...seats },
      ts: Date.now(),
    };
    localStorage.setItem(COOP_RESUME_UNAVAILABLE_KEY, JSON.stringify(evidence));
    coopWarn("launch", `resume replica unavailable self=${self} partner=${partner} wave=${wave}`);
  } catch {
    /* Storage itself is unavailable; the live controller still retains the checkpoint for retry. */
  }
}

/**
 * Capture the two out-of-slot records that make a co-op replica discoverable. The raw strings are
 * intentional: rollback is compare-and-swap guarded and must not overwrite evidence written by a
 * newer callback/tab while an awaited cloud CAS was in flight.
 */
export function captureCoopResumeEvidence(): CoopResumeEvidenceSnapshot {
  return {
    markerRaw: localStorage.getItem(COOP_RESUME_MARKER_KEY),
    unavailableRaw: localStorage.getItem(COOP_RESUME_UNAVAILABLE_KEY),
  };
}

/**
 * Restore an earlier marker/unavailable pair only when both still exactly equal the evidence this
 * transaction wrote. Returns false rather than clobbering a concurrent/newer persistence result.
 */
export function restoreCoopResumeEvidenceIfUnchanged(
  expectedCurrent: CoopResumeEvidenceSnapshot,
  previous: CoopResumeEvidenceSnapshot,
): boolean {
  try {
    if (
      localStorage.getItem(COOP_RESUME_MARKER_KEY) !== expectedCurrent.markerRaw
      || localStorage.getItem(COOP_RESUME_UNAVAILABLE_KEY) !== expectedCurrent.unavailableRaw
    ) {
      return false;
    }
    if (previous.markerRaw == null) {
      localStorage.removeItem(COOP_RESUME_MARKER_KEY);
    } else {
      localStorage.setItem(COOP_RESUME_MARKER_KEY, previous.markerRaw);
    }
    if (previous.unavailableRaw == null) {
      localStorage.removeItem(COOP_RESUME_UNAVAILABLE_KEY);
    } else {
      localStorage.setItem(COOP_RESUME_UNAVAILABLE_KEY, previous.unavailableRaw);
    }
    return (
      localStorage.getItem(COOP_RESUME_MARKER_KEY) === previous.markerRaw
      && localStorage.getItem(COOP_RESUME_UNAVAILABLE_KEY) === previous.unavailableRaw
    );
  } catch (error) {
    coopWarn("launch", "resume evidence rollback failed", error);
    return false;
  }
}

function readCoopResumeUnavailableEvidence(self: string, partner: string): CoopResumeUnavailableEvidence | null {
  try {
    const raw = localStorage.getItem(COOP_RESUME_UNAVAILABLE_KEY);
    if (raw == null) {
      return null;
    }
    const evidence = JSON.parse(raw) as CoopResumeUnavailableEvidence;
    if (
      evidence?.version !== 1
      || !sameCoopIdentity(evidence.self, self)
      || !sameCoopIdentity(evidence.partner, partner)
      || !Number.isInteger(evidence.wave)
      || evidence.wave <= 0
      || !isCoopRunId(evidence.runId)
      || !Number.isSafeInteger(evidence.checkpointRevision)
      || evidence.checkpointRevision < 0
      || !coopParticipantPairMatches([evidence.seats?.host, evidence.seats?.guest], self, partner)
    ) {
      return null;
    }
    return evidence;
  } catch {
    return null;
  }
}

/**
 * Read the marker only if it matches the EXACT participant pair (both identities,
 * case-insensitive); null otherwise. Matching `self` too prevents offering account
 * A's saved run after a different account logs in on the same browser; matching
 * `partner` is the identity gate the maintainer requires - a save is never offered
 * with a different partner.
 */
export function readCoopResumeMarker(self: string | null, partner: string | null): CoopResumeMarker | null {
  if (!self || !partner) {
    return null;
  }
  try {
    const raw = localStorage.getItem(COOP_RESUME_MARKER_KEY);
    if (raw == null) {
      return null;
    }
    const marker = JSON.parse(raw) as CoopResumeMarker;
    if (
      typeof marker?.slot !== "number"
      || marker.slot < 0
      || marker.slot >= 5
      || typeof marker.self !== "string"
      || typeof marker.partner !== "string"
      || typeof marker.wave !== "number"
      || !isCoopRunId(marker.runId)
      || !Number.isSafeInteger(marker.checkpointRevision)
      || marker.checkpointRevision < 0
    ) {
      localStorage.removeItem(COOP_RESUME_MARKER_KEY);
      return null;
    }
    if (!sameCoopIdentity(marker.self, self) || !sameCoopIdentity(marker.partner, partner)) {
      return null;
    }
    return marker;
  } catch (e) {
    coopWarn("launch", `resume marker unreadable (${e}) -> cleared`);
    try {
      localStorage.removeItem(COOP_RESUME_MARKER_KEY);
    } catch {
      /* ignore */
    }
    return null;
  }
}

/** Clear the marker (run ended, or it went stale/corrupt). */
export function clearCoopResumeMarker(): void {
  try {
    localStorage.removeItem(COOP_RESUME_MARKER_KEY);
    localStorage.removeItem(COOP_RESUME_UNAVAILABLE_KEY);
  } catch {
    /* ignore */
  }
}

/** Clear only evidence for one exact account/run, preserving a newer tab's replacement marker. */
export function clearCoopResumeEvidenceIfRun(self: string, runId: string): boolean {
  for (const key of [COOP_RESUME_MARKER_KEY, COOP_RESUME_UNAVAILABLE_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) {
        continue;
      }
      const evidence = JSON.parse(raw) as { self?: unknown; runId?: unknown };
      if (typeof evidence.self !== "string" || typeof evidence.runId !== "string") {
        return false;
      }
      if (!sameCoopIdentity(evidence.self, self) || evidence.runId !== runId) {
        continue;
      }
      if (localStorage.getItem(key) !== raw) {
        return false;
      }
      localStorage.removeItem(key);
      if (localStorage.getItem(key) != null) {
        return false;
      }
    } catch {
      // Malformed lineage cannot prove it belongs to another run, so tombstone adoption fails closed.
      return false;
    }
  }
  return true;
}

interface CoopDeletedRunEvidence {
  version: 1;
  self: string;
  runId: string;
  ts: number;
}

function readDeletedRuns(): CoopDeletedRunEvidence[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(COOP_DELETED_RUNS_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is CoopDeletedRunEvidence =>
            entry?.version === 1
            && typeof entry.self === "string"
            && typeof entry.runId === "string"
            && isCoopRunId(entry.runId)
            && typeof entry.ts === "number",
        )
      : [];
  } catch {
    return [];
  }
}

export function isCoopRunLocallyDeleted(self: string, runId: string): boolean {
  return (
    isCoopRunId(runId) && readDeletedRuns().some(entry => sameCoopIdentity(entry.self, self) && entry.runId === runId)
  );
}

/** Durable browser-side fence written only after the exact backend tombstone commits. */
export function recordCoopDeletedRun(self: string, runId: string): boolean {
  if (!self || !isCoopRunId(runId)) {
    return false;
  }
  const priorDeletedRuns = localStorage.getItem(COOP_DELETED_RUNS_KEY);
  const priorMarker = localStorage.getItem(COOP_RESUME_MARKER_KEY);
  const priorUnavailable = localStorage.getItem(COOP_RESUME_UNAVAILABLE_KEY);
  let writtenDeletedRuns: string | null = null;
  try {
    const retained = readDeletedRuns().filter(entry => !(sameCoopIdentity(entry.self, self) && entry.runId === runId));
    retained.push({ version: 1, self, runId, ts: Date.now() });
    writtenDeletedRuns = JSON.stringify(retained.slice(-64));
    localStorage.setItem(COOP_DELETED_RUNS_KEY, writtenDeletedRuns);
    if (clearCoopResumeEvidenceIfRun(self, runId) && isCoopRunLocallyDeleted(self, runId)) {
      return true;
    }
  } catch {
    // Roll back below when every touched key still contains this transaction's value.
  }
  try {
    if (writtenDeletedRuns != null && localStorage.getItem(COOP_DELETED_RUNS_KEY) === writtenDeletedRuns) {
      if (priorDeletedRuns == null) {
        localStorage.removeItem(COOP_DELETED_RUNS_KEY);
      } else {
        localStorage.setItem(COOP_DELETED_RUNS_KEY, priorDeletedRuns);
      }
    }
    for (const [key, prior] of [
      [COOP_RESUME_MARKER_KEY, priorMarker],
      [COOP_RESUME_UNAVAILABLE_KEY, priorUnavailable],
    ] as const) {
      if (prior != null && localStorage.getItem(key) == null) {
        localStorage.setItem(key, prior);
      }
    }
  } catch {
    // Failure remains fail-closed; callers retain the protected local checkpoint and lineage head.
  }
  return false;
}
