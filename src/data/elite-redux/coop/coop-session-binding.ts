/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** The invitation/SDP axis. It never grants gameplay authority or ownership. */
export type CoopTransportRole = "offerer" | "answerer";

/** The gameplay reducer axis for one bound session epoch. */
export type CoopAuthorityRole = "authority" | "replica";

/** Opaque, immutable, server-issued identity. It must never be derived from a username. */
export type CoopAccountId = string;

/** Stable ownership position within a run. */
export type CoopSeatId = number;

export interface CoopAccountIdentityV1 {
  version: 1;
  accountId: CoopAccountId;
  displayName: string;
  /** Migration aid only. Native P33 authorization must use accountId. */
  canonicalUsername: string;
}

export interface CoopSeatBindingV1 {
  seatId: CoopSeatId;
  accountId: CoopAccountId;
}

export interface CoopRunSeatMapV1 {
  version: 1;
  revision: 1;
  /** SHA-256 of the canonical version/revision/seats payload. */
  seatMapId: string;
  seats: CoopSeatBindingV1[];
}

export interface CoopSessionBindingV1 {
  version: 1;
  bindingId: string;
  sessionId: string;
  runId?: string;
  sessionEpoch: number;
  checkpointRevision: number;
  seatMap: CoopRunSeatMapV1;
  authoritySeatId: CoopSeatId;
  membershipRevision: number;
  source: "fresh" | "resume" | "showdown";
}

export interface CoopFrameContextV1 {
  sessionId: string;
  sessionEpoch: number;
  seatMapId: string;
  membershipRevision: number;
  fromSeatId: CoopSeatId;
  connectionGeneration: number;
}

/**
 * Authenticated public-pairing context held by the browser controller. The bearer remains local and is
 * deliberately absent from every peer wire shape; it authorizes signaling Worker calls only.
 */
export interface CoopP33AuthenticatedContextV1 {
  version: 1;
  pairingId: string;
  pairingBearer: string;
  transportRole: CoopTransportRole;
  account: CoopAccountIdentityV1;
  peerAccount: CoopAccountIdentityV1;
  localSeatId: CoopSeatId;
  authoritySeatId: CoopSeatId;
  connectionGeneration: number;
  peerConnectionGeneration: number;
  source: "fresh" | "resume" | "showdown";
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isCoopAccountId(value: unknown): value is CoopAccountId {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= 256
    && ![...value].some(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  );
}

export function isCoopSeatId(value: unknown): value is CoopSeatId {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function canonicalSeatBindings(accountIds: readonly CoopAccountId[]): CoopSeatBindingV1[] | null {
  if (accountIds.length < 2 || new Set(accountIds).size !== accountIds.length || !accountIds.every(isCoopAccountId)) {
    return null;
  }
  return [...accountIds].sort().map((accountId, seatId) => ({ seatId, accountId }));
}

/** Canonical bytes hashed by seatMapId. Display names and invitation direction are deliberately absent. */
export function canonicalCoopSeatMapPayload(seats: readonly CoopSeatBindingV1[]): string {
  return JSON.stringify({
    version: 1,
    revision: 1,
    seats: seats.map(({ seatId, accountId }) => ({ seatId, accountId })),
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Fresh maps are invariant to invitation direction because opaque account IDs define seat order. */
export async function createFreshCoopSeatMap(accountIds: readonly CoopAccountId[]): Promise<CoopRunSeatMapV1 | null> {
  const seats = canonicalSeatBindings(accountIds);
  if (seats == null) {
    return null;
  }
  return {
    version: 1,
    revision: 1,
    seatMapId: await sha256Hex(canonicalCoopSeatMapPayload(seats)),
    seats,
  };
}

/** Strict wire/save validation. Seat IDs must be dense, ordered, and account IDs exact and unique. */
export async function validateCoopRunSeatMap(value: CoopRunSeatMapV1): Promise<boolean> {
  if (
    value.version !== 1
    || value.revision !== 1
    || !SHA256_HEX.test(value.seatMapId)
    || !Array.isArray(value.seats)
    || value.seats.length < 2
  ) {
    return false;
  }
  const accounts = new Set<CoopAccountId>();
  for (let index = 0; index < value.seats.length; index++) {
    const seat = value.seats[index];
    if (seat.seatId !== index || !isCoopAccountId(seat.accountId) || accounts.has(seat.accountId)) {
      return false;
    }
    accounts.add(seat.accountId);
  }
  return value.seatMapId === (await sha256Hex(canonicalCoopSeatMapPayload(value.seats)));
}

export function coopSeatForAccount(seatMap: CoopRunSeatMapV1, accountId: CoopAccountId): CoopSeatBindingV1 | null {
  return seatMap.seats.find(seat => seat.accountId === accountId) ?? null;
}

function validIdentity(identity: CoopAccountIdentityV1): boolean {
  const safePresentation = (value: string): boolean =>
    value.length > 0
    && value.length <= 128
    && ![...value].some(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    });
  return (
    identity.version === 1
    && isCoopAccountId(identity.accountId)
    && safePresentation(identity.displayName)
    && safePresentation(identity.canonicalUsername)
  );
}

/**
 * Build the fresh P33 axes independently of invitation direction. Seat 0 is the deterministic initial
 * authority; transport offerer/answerer never influences the seat map or authority choice.
 */
export function createFreshCoopP33Context(input: {
  pairingId: string;
  pairingBearer: string;
  transportRole: CoopTransportRole;
  account: CoopAccountIdentityV1;
  peerAccount: CoopAccountIdentityV1;
  connectionGeneration: number;
  peerConnectionGeneration: number;
}): CoopP33AuthenticatedContextV1 | null {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/u.test(input.pairingId)
    || !/^[A-Za-z0-9_-]{32,256}$/u.test(input.pairingBearer)
    || (input.transportRole !== "offerer" && input.transportRole !== "answerer")
    || !validIdentity(input.account)
    || !validIdentity(input.peerAccount)
    || input.account.accountId === input.peerAccount.accountId
    || !Number.isSafeInteger(input.connectionGeneration)
    || input.connectionGeneration < 0
    || !Number.isSafeInteger(input.peerConnectionGeneration)
    || input.peerConnectionGeneration < 0
  ) {
    return null;
  }
  const accounts = [input.account.accountId, input.peerAccount.accountId].sort();
  return {
    version: 1,
    ...input,
    localSeatId: accounts.indexOf(input.account.accountId),
    authoritySeatId: 0,
    source: "fresh",
  };
}

/** Exact hot-rejoin fence: only the local bearer/generation/name may rotate. */
export function canAdoptCoopP33Rejoin(
  current: CoopP33AuthenticatedContextV1,
  next: CoopP33AuthenticatedContextV1,
): boolean {
  return (
    next.version === 1
    && next.pairingId === current.pairingId
    && next.transportRole === current.transportRole
    && next.account.accountId === current.account.accountId
    && next.peerAccount.accountId === current.peerAccount.accountId
    && next.localSeatId === current.localSeatId
    && next.authoritySeatId === current.authoritySeatId
    && next.source === current.source
    && next.connectionGeneration === current.connectionGeneration + 1
    && next.peerConnectionGeneration >= current.peerConnectionGeneration
  );
}

/** Frame authorization binds the claimed seat to the authenticated channel account and exact session epoch. */
export function coopFrameContextMatchesBinding(
  context: CoopFrameContextV1,
  binding: CoopSessionBindingV1,
  authenticatedAccountId: CoopAccountId,
  currentConnectionGeneration: number,
  expectedMembershipRevision: number = binding.membershipRevision,
): boolean {
  const seat = coopSeatForAccount(binding.seatMap, authenticatedAccountId);
  return (
    seat != null
    && context.sessionId === binding.sessionId
    && context.sessionEpoch === binding.sessionEpoch
    && context.seatMapId === binding.seatMap.seatMapId
    && context.membershipRevision === expectedMembershipRevision
    && context.fromSeatId === seat.seatId
    && context.connectionGeneration === currentConnectionGeneration
  );
}
