/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { pokerogueApi } from "#api/api";
import {
  type CoopAccountIdentityV1,
  type CoopTransportRole,
  isCoopAccountId,
} from "#data/elite-redux/coop/coop-session-binding";
import type { CoopIdentityTicketResponse } from "#types/api";

const COOP_DEFAULT_SERVER = "https://er-coop-api.heraklines.workers.dev";

function defaultServerBase(): string {
  return (import.meta.env as unknown as Record<string, string | undefined>).VITE_COOP_SERVER_URL ?? COOP_DEFAULT_SERVER;
}

export type CoopLobbyProtocol = "legacy" | "p33";

export interface CoopP33PeerIdentityV1 extends CoopAccountIdentityV1 {
  connectionGeneration: number;
}

/** Exact authenticated pairing record returned by the signaling Worker. */
export interface CoopP33PairingV1 {
  code: string;
  pairingId: string;
  transportRole: CoopTransportRole;
  connectionGeneration: number;
  account: CoopAccountIdentityV1;
  peer: CoopP33PeerIdentityV1;
}

/** Browser-held signaling credential. The bearer is never copied into peer wire messages. */
export interface CoopP33LobbyCredentialV1 {
  presenceId: string;
  pairingToken: string;
  identity: CoopAccountIdentityV1;
}

export interface CoopP33AnnounceResult extends CoopP33LobbyCredentialV1 {
  pairing: CoopP33PairingV1 | null;
}

export interface CoopP33LobbyPlayer {
  id: string;
  accountId: string;
  name: string;
  age: number;
}

export interface CoopP33LobbyRequest {
  id: string;
  accountId: string;
  name: string;
}

export interface CoopP33LobbySnapshot {
  players: CoopP33LobbyPlayer[];
  pairing: CoopP33PairingV1 | null;
  request: CoopP33LobbyRequest | null;
  declined: string | null;
}

export interface CoopP33Heartbeat {
  state: "active" | "grace";
  bothPresent: boolean;
  partnerPresent: boolean;
  connectionGeneration: number;
}

export interface CoopP33ClientDependencies {
  fetch?: typeof fetch;
  getIdentityTicket?: () => Promise<[CoopIdentityTicketResponse | null, number]>;
  createClientNonce?: () => string;
  retryDelay?: (attempt: number) => Promise<void>;
  serverBase?: () => string;
  /**
   * Optional per-run lobby room/namespace (P33 audit #920). When set, this client only
   * announces into and lists from that room, so concurrent CI runs never see each other's
   * accounts. Omitted (the production default) => no room field is sent and the server places
   * the client in the single shared default room, i.e. exactly today's behavior.
   */
  room?: string;
}

export class CoopP33HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "CoopP33HttpError";
  }
}

function safeText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && ![...value].some(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  );
}

function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseIdentity(value: unknown): CoopAccountIdentityV1 | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const identity = value as Partial<CoopAccountIdentityV1>;
  return identity.version === 1
    && isCoopAccountId(identity.accountId)
    && safeText(identity.displayName, 128)
    && safeText(identity.canonicalUsername, 128)
    ? {
        version: 1,
        accountId: identity.accountId,
        displayName: identity.displayName,
        canonicalUsername: identity.canonicalUsername,
      }
    : null;
}

function sameIdentity(left: CoopAccountIdentityV1, right: CoopAccountIdentityV1): boolean {
  return (
    left.accountId === right.accountId
    && left.displayName === right.displayName
    && left.canonicalUsername === right.canonicalUsername
  );
}

export function parseCoopP33Pairing(value: unknown): CoopP33PairingV1 | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const pairing = value as Record<string, unknown>;
  const account = parseIdentity(
    pairing.account != null && typeof pairing.account === "object"
      ? { version: 1, ...(pairing.account as Record<string, unknown>) }
      : pairing.account,
  );
  const peerRaw = pairing.peer;
  const peer = parseIdentity(
    peerRaw != null && typeof peerRaw === "object" ? { version: 1, ...(peerRaw as Record<string, unknown>) } : peerRaw,
  );
  const peerGeneration =
    peerRaw != null && typeof peerRaw === "object"
      ? (peerRaw as { connectionGeneration?: unknown }).connectionGeneration
      : undefined;
  if (
    !safeText(pairing.code, 32)
    || !safeText(pairing.pairingId, 128)
    || pairing.pairingId !== pairing.code
    || (pairing.transportRole !== "offerer" && pairing.transportRole !== "answerer")
    || !isGeneration(pairing.connectionGeneration)
    || account == null
    || peer == null
    || account.accountId === peer.accountId
    || !isGeneration(peerGeneration)
  ) {
    return null;
  }
  return {
    code: pairing.code,
    pairingId: pairing.pairingId,
    transportRole: pairing.transportRole,
    connectionGeneration: pairing.connectionGeneration,
    account,
    peer: { ...peer, connectionGeneration: peerGeneration },
  };
}

function randomClientNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function isClientNonce(value: unknown): value is string {
  return typeof value === "string" && value.length >= 20 && value.length <= 128 && /^[A-Za-z0-9_-]+$/u.test(value);
}

function dependencies(overrides: CoopP33ClientDependencies = {}) {
  return {
    // Bind the global fetch to its receiver: storing the bare `fetch` and later calling it as
    // `deps.fetch(...)` (detached-method invocation) makes `this` the deps object, and every real browser
    // throws "Failed to execute 'fetch' on 'Window': Illegal invocation" at lobby start, before any request
    // (invisible to co-op vitest, which always passes overrides.fetch). No wire change.
    fetch: overrides.fetch ?? fetch.bind(globalThis),
    getIdentityTicket: overrides.getIdentityTicket ?? (() => pokerogueApi.account.getCoopIdentityTicket()),
    createClientNonce: overrides.createClientNonce ?? randomClientNonce,
    retryDelay:
      overrides.retryDelay
      ?? ((attempt: number) => new Promise<void>(resolve => setTimeout(resolve, Math.min(250 * 2 ** attempt, 1_000)))),
    serverBase: overrides.serverBase ?? defaultServerBase,
  };
}

async function errorFromResponse(response: Response, path: string): Promise<CoopP33HttpError> {
  let detail = "";
  try {
    const body = (await response.json()) as { error?: unknown };
    detail = typeof body.error === "string" ? body.error : "";
  } catch {
    // A non-JSON error still fails closed with its status.
  }
  return new CoopP33HttpError(detail || `co-op P33 ${path} failed (${response.status})`, response.status, path);
}

async function readJson(response: Response, path: string): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw await errorFromResponse(response, path);
  }
  try {
    const value = (await response.json()) as unknown;
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid response");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof CoopP33HttpError) {
      throw error;
    }
    throw new CoopP33HttpError(`co-op P33 ${path} returned invalid JSON`, 502, path);
  }
}

async function exactRetryRequest(
  path: string,
  init: RequestInit,
  overrides: CoopP33ClientDependencies,
  attempts = 3,
): Promise<Record<string, unknown>> {
  const deps = dependencies(overrides);
  let lastNetworkError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await deps.fetch(`${deps.serverBase()}${path}`, init);
      if (response.ok || response.status < 500 || attempt === attempts - 1) {
        return await readJson(response, path);
      }
      lastNetworkError = await errorFromResponse(response, path);
    } catch (error) {
      if (error instanceof CoopP33HttpError && error.status < 500) {
        throw error;
      }
      lastNetworkError = error;
    }
    await deps.retryDelay(attempt);
  }
  throw lastNetworkError instanceof Error
    ? lastNetworkError
    : new CoopP33HttpError(`co-op P33 ${path} network failure`, 0, path);
}

async function acquireTicket(overrides: CoopP33ClientDependencies): Promise<CoopIdentityTicketResponse> {
  const deps = dependencies(overrides);
  const [ticket, status] = await deps.getIdentityTicket();
  const identity = parseIdentity(ticket?.identity);
  if (
    status < 200
    || status >= 300
    || ticket == null
    || !safeText(ticket.ticket, 4_096)
    || identity == null
    || !Number.isSafeInteger(ticket.expiresAt)
    || ticket.expiresAt <= Date.now()
  ) {
    throw new CoopP33HttpError(`could not authenticate co-op identity (${status})`, status, "/account/coop-ticket");
  }
  return { ...ticket, identity };
}

function bearerHeaders(token: string, json = false): Headers {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (json) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

function validateCredentialBody(
  body: Record<string, unknown>,
  expectedIdentity: CoopAccountIdentityV1,
): CoopP33AnnounceResult {
  const identity = parseIdentity(body.identity);
  const pairing = body.pairing == null ? null : parseCoopP33Pairing(body.pairing);
  if (
    !safeText(body.presenceId, 128)
    || !safeText(body.pairingToken, 256)
    || identity == null
    || !sameIdentity(identity, expectedIdentity)
    || (body.pairing != null && pairing == null)
    || (pairing != null && !sameIdentity(pairing.account, identity))
  ) {
    throw new CoopP33HttpError("co-op P33 identity binding response was inconsistent", 502, "/coop/v3");
  }
  return {
    presenceId: body.presenceId,
    pairingToken: body.pairingToken,
    identity,
    pairing,
  };
}

/** Mint one ticket and retry the exact ticket+nonce body if the announce response is lost. */
export async function announceToP33Lobby(overrides: CoopP33ClientDependencies = {}): Promise<CoopP33AnnounceResult> {
  const ticket = await acquireTicket(overrides);
  const clientNonce = dependencies(overrides).createClientNonce();
  if (!isClientNonce(clientNonce)) {
    throw new CoopP33HttpError("could not create a valid co-op client nonce", 0, "/coop/v3/lobby/announce");
  }
  const announceBody: Record<string, unknown> = { ticket: ticket.ticket, clientNonce };
  // Additive room namespace: omit the field entirely when no room is set so a production
  // (room-less) announce is byte-identical to today's request.
  if (overrides.room != null && overrides.room.length > 0) {
    announceBody.room = overrides.room;
  }
  const body = JSON.stringify(announceBody);
  const response = await exactRetryRequest(
    "/coop/v3/lobby/announce",
    { method: "POST", headers: { "Content-Type": "application/json" }, body },
    overrides,
    15,
  );
  return validateCredentialBody(response, ticket.identity);
}

async function authenticatedJson(
  credential: CoopP33LobbyCredentialV1,
  path: string,
  method: "GET" | "POST",
  body: Record<string, unknown> | undefined,
  overrides: CoopP33ClientDependencies,
): Promise<Record<string, unknown>> {
  const deps = dependencies(overrides);
  const response = await deps.fetch(`${deps.serverBase()}${path}`, {
    method,
    headers: bearerHeaders(credential.pairingToken, body != null),
    body: body == null ? null : JSON.stringify(body),
  });
  return readJson(response, path);
}

export async function fetchP33Lobby(
  credential: CoopP33LobbyCredentialV1,
  overrides: CoopP33ClientDependencies = {},
): Promise<CoopP33LobbySnapshot> {
  // Additive room namespace: append `&room=` only when a room is set, so a production
  // (room-less) list request is byte-identical to today's request.
  const path =
    overrides.room != null && overrides.room.length > 0
      ? `/coop/v3/lobby?self=${encodeURIComponent(credential.presenceId)}&room=${encodeURIComponent(overrides.room)}`
      : `/coop/v3/lobby?self=${encodeURIComponent(credential.presenceId)}`;
  const body = await authenticatedJson(credential, path, "GET", undefined, overrides);
  const pairing = body.pairing == null ? null : parseCoopP33Pairing(body.pairing);
  if (body.pairing != null && pairing == null) {
    throw new CoopP33HttpError("co-op P33 lobby returned an invalid pairing", 502, path);
  }
  if (pairing != null && !sameIdentity(pairing.account, credential.identity)) {
    throw new CoopP33HttpError("co-op P33 lobby pairing changed authenticated identity", 502, path);
  }
  const players = Array.isArray(body.players)
    ? body.players.flatMap(value => {
        if (value == null || typeof value !== "object") {
          return [];
        }
        const player = value as Record<string, unknown>;
        return safeText(player.id, 128)
          && isCoopAccountId(player.accountId)
          && safeText(player.name, 128)
          && typeof player.age === "number"
          && Number.isFinite(player.age)
          && player.age >= 0
          ? [{ id: player.id, accountId: player.accountId, name: player.name, age: player.age }]
          : [];
      })
    : [];
  let request: CoopP33LobbyRequest | null = null;
  if (body.request != null && typeof body.request === "object") {
    const incoming = body.request as Record<string, unknown>;
    if (safeText(incoming.id, 128) && isCoopAccountId(incoming.accountId) && safeText(incoming.name, 128)) {
      request = { id: incoming.id, accountId: incoming.accountId, name: incoming.name };
    }
  }
  return {
    players,
    pairing,
    request,
    declined: typeof body.declined === "string" ? body.declined : null,
  };
}

export async function requestP33Player(
  credential: CoopP33LobbyCredentialV1,
  target: string,
  overrides: CoopP33ClientDependencies = {},
): Promise<void> {
  await authenticatedJson(
    credential,
    "/coop/v3/lobby/request",
    "POST",
    { self: credential.presenceId, target },
    overrides,
  );
}

export async function respondToP33Request(
  credential: CoopP33LobbyCredentialV1,
  from: string,
  accept: boolean,
  overrides: CoopP33ClientDependencies = {},
): Promise<CoopP33PairingV1 | null> {
  const body = await authenticatedJson(
    credential,
    "/coop/v3/lobby/respond",
    "POST",
    { self: credential.presenceId, from, accept },
    overrides,
  );
  if (!accept) {
    return null;
  }
  const pairing = parseCoopP33Pairing(body);
  if (pairing == null || !sameIdentity(pairing.account, credential.identity)) {
    throw new CoopP33HttpError("co-op P33 response returned an invalid pairing", 502, "/coop/v3/lobby/respond");
  }
  return pairing;
}

export async function leaveP33Lobby(
  credential: CoopP33LobbyCredentialV1,
  overrides: CoopP33ClientDependencies = {},
): Promise<void> {
  await authenticatedJson(credential, "/coop/v3/lobby/leave", "POST", { self: credential.presenceId }, overrides);
}

export async function pushP33Signal(
  credential: CoopP33LobbyCredentialV1,
  code: string,
  signal: string,
  overrides: CoopP33ClientDependencies = {},
): Promise<void> {
  await authenticatedJson(credential, "/coop/v3/signal", "POST", { code, signal }, overrides);
}

export async function pollP33Signal(
  credential: CoopP33LobbyCredentialV1,
  code: string,
  overrides: CoopP33ClientDependencies = {},
): Promise<string | null> {
  const path = `/coop/v3/signal?code=${encodeURIComponent(code)}`;
  const body = await authenticatedJson(credential, path, "GET", undefined, overrides);
  return body.signal == null ? null : typeof body.signal === "string" ? body.signal : null;
}

export async function heartbeatP33Run(
  credential: CoopP33LobbyCredentialV1,
  code: string,
  overrides: CoopP33ClientDependencies = {},
): Promise<CoopP33Heartbeat> {
  const body = await authenticatedJson(credential, "/coop/v3/heartbeat", "POST", { code }, overrides);
  if (
    (body.state !== "active" && body.state !== "grace")
    || typeof body.bothPresent !== "boolean"
    || typeof body.partnerPresent !== "boolean"
    || !isGeneration(body.connectionGeneration)
  ) {
    throw new CoopP33HttpError("co-op P33 heartbeat response was invalid", 502, "/coop/v3/heartbeat");
  }
  return {
    state: body.state,
    bothPresent: body.bothPresent,
    partnerPresent: body.partnerPresent,
    connectionGeneration: body.connectionGeneration,
  };
}

export async function leaveP33Run(
  credential: CoopP33LobbyCredentialV1,
  code: string,
  overrides: CoopP33ClientDependencies = {},
): Promise<void> {
  await authenticatedJson(credential, "/coop/v3/leave", "POST", { code }, overrides);
}

export async function endP33Run(
  credential: CoopP33LobbyCredentialV1,
  code: string,
  overrides: CoopP33ClientDependencies = {},
): Promise<void> {
  await authenticatedJson(credential, "/coop/v3/end", "POST", { code }, overrides);
}

/** Mint one fresh ticket, then retry the exact rejoin body so a lost response cannot double-increment. */
export async function rejoinP33Run(
  code: string,
  currentCredential: CoopP33LobbyCredentialV1,
  overrides: CoopP33ClientDependencies = {},
): Promise<CoopP33AnnounceResult & { pairing: CoopP33PairingV1 }> {
  const ticket = await acquireTicket(overrides);
  const clientNonce = dependencies(overrides).createClientNonce();
  if (!isClientNonce(clientNonce)) {
    throw new CoopP33HttpError("could not create a valid co-op rejoin nonce", 0, "/coop/v3/rejoin");
  }
  const body = JSON.stringify({ code, ticket: ticket.ticket, clientNonce });
  const response = await exactRetryRequest(
    "/coop/v3/rejoin",
    { method: "POST", headers: bearerHeaders(currentCredential.pairingToken, true), body },
    overrides,
    120,
  );
  const credential = validateCredentialBody(response, ticket.identity);
  if (credential.pairing == null || credential.pairing.code !== code) {
    throw new CoopP33HttpError("co-op P33 rejoin returned the wrong run", 502, "/coop/v3/rejoin");
  }
  return { ...credential, pairing: credential.pairing };
}
