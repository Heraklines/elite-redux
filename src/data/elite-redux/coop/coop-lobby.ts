/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op matchmaking lobby (#633). The client half of the "see waiting players,
// pick one, just connect" design - host/guest is IRRELEVANT to players:
//
//   announce(name)  ->  poll the worker for OTHER waiting players  ->  pick one
//                   ->  the WORKER matches the pair + assigns roles (picked
//                       player hosts, picker joins)  ->  each side reads its
//                       {code, role} on its next poll  ->  connectCoopWithCode.
//
// The blue-panel UI just renders onPlayers() and calls pick(); everything else
// (presence heartbeat via polling, role assignment, the WebRTC handshake) is
// hidden here. The pure HTTP helpers are unit-tested with a mocked fetch; the
// live RTCPeerConnection leg is browser-only.
// =============================================================================

import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  announceToP33Lobby,
  type CoopLobbyProtocol,
  type CoopP33ClientDependencies,
  CoopP33HttpError,
  type CoopP33LobbyCredentialV1,
  type CoopP33PairingV1,
  fetchP33Lobby,
  leaveP33Lobby,
  leaveP33Run,
  requestP33Player,
  respondToP33Request,
} from "#data/elite-redux/coop/coop-p33-client";
import type { CoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { connectCoopP33Pairing, connectCoopWithCode, coopServerBase } from "#data/elite-redux/coop/coop-webrtc-connect";

/** A player currently waiting in the lobby (as seen by someone else). */
export interface LobbyPlayer {
  /** Opaque presence id (pass to {@linkcode CoopLobbyController.pick}). */
  id: string;
  /** Display name. */
  name: string;
  /** Milliseconds since this player's last poll (freshness). */
  age: number;
  /** Immutable P33 identity, absent on the explicit legacy lobby. */
  accountId?: string;
}

/** A completed match: the run code + this client's worker-assigned role. */
export interface LobbyPairing {
  code: string;
  role: "host" | "guest";
}

function lobbyError(action: string, status: number, body: string): Error {
  // The worker returns { error } on 4xx/410/409 - surface it verbatim.
  const parsed = (() => {
    try {
      return (JSON.parse(body) as { error?: string }).error;
    } catch {
      return;
    }
  })();
  return new Error(parsed ?? `coop ${action} failed (${status})`);
}

async function lobbyPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${coopServerBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw lobbyError(path, res.status, text);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function asPairing(v: unknown): LobbyPairing | null {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.code === "string" && (o.role === "host" || o.role === "guest")) {
      return { code: o.code, role: o.role };
    }
  }
  return null;
}

/**
 * Announce/refresh my presence in the lobby. Pass an existing `id` to refresh it
 * (the worker mints one on the first call). Returns my id + any pairing already
 * made for me (e.g. someone picked me while I was announcing).
 */
export async function announceToLobby(
  name: string,
  id?: string,
): Promise<{ id: string; pairing: LobbyPairing | null }> {
  const body = await lobbyPost("/coop/lobby/announce", id ? { name, id } : { name });
  return { id: String(body.id), pairing: asPairing(body.pairing) };
}

/** An incoming join request (lobby v2): who is asking to play with me. */
export interface LobbyRequest {
  id: string;
  name: string;
  accountId?: string;
}

/** One full lobby poll result (lobby v2 adds `request` + the one-shot `declined`). */
export interface LobbySnapshot {
  players: LobbyPlayer[];
  pairing: LobbyPairing | null;
  /** Someone is asking to join ME (answer via {@linkcode respondToRequest}). */
  request: LobbyRequest | null;
  /** One-shot: the named player DECLINED my request (already cleared server-side). */
  declined: string | null;
}

/**
 * Poll the lobby: returns OTHER waiting players + my pairing if the worker matched
 * me, plus any incoming join request / decline notice (lobby v2). Doubles as a
 * presence heartbeat (the worker refreshes my seen_at). Tolerant of an OLD worker
 * that omits the v2 fields (they parse to null).
 */
export async function fetchLobby(self: string): Promise<LobbySnapshot> {
  const res = await fetch(`${coopServerBase()}/coop/lobby?self=${encodeURIComponent(self)}`);
  const text = await res.text();
  if (!res.ok) {
    throw lobbyError("/coop/lobby", res.status, text);
  }
  const body = JSON.parse(text) as {
    players?: LobbyPlayer[];
    pairing?: unknown;
    request?: unknown;
    declined?: unknown;
  };
  let request: LobbyRequest | null = null;
  if (body.request && typeof body.request === "object") {
    const r = body.request as Record<string, unknown>;
    if (typeof r.id === "string" && typeof r.name === "string") {
      request = { id: r.id, name: r.name };
    }
  }
  return {
    players: Array.isArray(body.players) ? body.players : [],
    pairing: asPairing(body.pairing),
    request,
    declined: typeof body.declined === "string" ? body.declined : null,
  };
}

/**
 * Lobby v2: ASK a player to co-op (they must ACCEPT before anything connects).
 * Resolves when the request is parked on their row; the answer arrives via polling
 * (a pairing on accept, a `declined` notice on decline). Throws "not found" against
 * an OLD worker - the caller falls back to the instant {@linkcode pickPlayer}.
 */
export async function requestPlayer(self: string, target: string): Promise<void> {
  await lobbyPost("/coop/lobby/request", { self, target });
}

/**
 * Lobby v2: ANSWER the join request parked on my row. Accepting returns MY pairing
 * (I host; the requester reads its pairing on its next poll); declining resolves null.
 */
export async function respondToRequest(self: string, from: string, accept: boolean): Promise<LobbyPairing | null> {
  const body = await lobbyPost("/coop/lobby/respond", { self, from, accept });
  return accept ? asPairing(body) : null;
}

/**
 * Pick a player to co-op with. The worker matches us and returns MY pairing (I am
 * the guest; the picked player hosts). Throws if they were just matched by someone
 * else - the caller keeps browsing.
 */
export async function pickPlayer(self: string, target: string): Promise<LobbyPairing> {
  const body = await lobbyPost("/coop/lobby/pick", { self, target });
  const pairing = asPairing(body);
  if (!pairing) {
    throw new Error("matchmaking failed - try another player");
  }
  return pairing;
}

/** Leave the lobby (best-effort; ignores failure). */
export async function leaveLobby(self: string): Promise<void> {
  try {
    await lobbyPost("/coop/lobby/leave", { self });
  } catch {
    // best-effort: the worker prunes stale presence anyway
  }
}

/** Callbacks the lobby UI supplies; the controller drives them. */
export interface CoopLobbyCallbacks {
  /** Fresh list of waiting players (re-render the panel). */
  onPlayers: (players: LobbyPlayer[]) => void;
  /** Matched - the WebRTC handshake is now running (show "connecting"). */
  onConnecting: () => void;
  /** Connected to the partner; the live CoopRuntime is ready. */
  onConnected: (runtime: CoopRuntime) => void;
  /** A fatal error (announce/connect failed). */
  onError: (message: string) => void;
  /** A recoverable lobby race; keep the lobby open and rebuild its actionable panel. */
  onTransientError?: (message: string) => void;
  /** Lobby v2: someone is asking to join ME - show Accept / Decline. */
  onRequest?: (from: LobbyRequest) => void;
  /** Lobby v2: the incoming request evaporated (requester left / was matched). */
  onRequestGone?: () => void;
  /** Lobby v2: the named player DECLINED my outgoing request. */
  onDeclined?: (name: string) => void;
  /** Lobby v2: my outgoing request is parked - waiting on their answer. */
  onRequestPending?: (targetName: string) => void;
}

/** The WebRTC connect signature - injectable so tests can stub the browser leg. */
export type CoopConnectFn = (code: string, role: "host" | "guest", opts: { username: string }) => Promise<CoopRuntime>;
export type CoopP33ConnectFn = (
  credential: CoopP33LobbyCredentialV1,
  pairing: CoopP33PairingV1,
  opts: { p33Dependencies?: CoopP33ClientDependencies },
) => Promise<CoopRuntime>;

/** Extra controller options (mainly a connect override for headless tests). */
export interface CoopLobbyOptions {
  /** Override the WebRTC connect (defaults to {@linkcode connectCoopWithCode}). */
  connect?: CoopConnectFn;
  /** Explicit signaling protocol. P33 never falls back after selection. */
  protocol?: CoopLobbyProtocol;
  connectP33?: CoopP33ConnectFn;
  p33Dependencies?: CoopP33ClientDependencies;
}

/** Staging selects P33 explicitly; legacy remains isolated until the Worker promotion is complete. */
export function coopLobbyProtocolFromEnv(): CoopLobbyProtocol {
  const selected = (import.meta.env as unknown as Record<string, string | undefined>).VITE_COOP_SIGNALING_PROTOCOL;
  return selected === "p33" ? "p33" : "legacy";
}

/**
 * Optional non-production lobby namespace used by the real-browser matrix.
 * Production and ordinary staging players omit both build switches and remain in the shared room.
 */
export function coopLobbyRoomFromEnv(): string | undefined {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  const configured = env.VITE_COOP_LOBBY_ROOM?.trim();
  const queryRoom =
    env.VITE_COOP_LOBBY_ROOM_QUERY === "1" && typeof globalThis.location?.search === "string"
      ? new URLSearchParams(globalThis.location.search).get("cooproom")?.trim()
      : undefined;
  const room = configured || queryRoom;
  return room != null && room.length <= 64 && /^[A-Za-z0-9_-]+$/u.test(room) ? room : undefined;
}

const POLL_INTERVAL_MS = 1500;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Drives one trip through the co-op lobby: announce, poll for players + a pairing,
 * pick on demand, and connect once matched. The UI owns rendering; this owns the
 * network loop and lifecycle. Call {@linkcode start} once; {@linkcode cancel} when
 * the player backs out.
 */
export class CoopLobbyController {
  private id: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private connecting = false;
  private readonly connectFn: CoopConnectFn;
  private readonly connectP33Fn: CoopP33ConnectFn;
  private readonly protocol: CoopLobbyProtocol;
  private readonly p33Dependencies: CoopP33ClientDependencies;
  private p33Credential: CoopP33LobbyCredentialV1 | null = null;
  /** Lobby v2: the presence id of the player currently asking to join ME (dedupe onRequest). */
  private incomingRequestId: string | null = null;
  /** Lobby v2: whether MY outgoing request is parked awaiting the other player's answer. */
  private outgoingPending = false;

  constructor(
    private readonly name: string,
    private readonly callbacks: CoopLobbyCallbacks,
    options: CoopLobbyOptions = {},
  ) {
    this.connectFn = options.connect ?? connectCoopWithCode;
    this.connectP33Fn = options.connectP33 ?? connectCoopP33Pairing;
    this.protocol = options.protocol ?? coopLobbyProtocolFromEnv();
    const room = coopLobbyRoomFromEnv();
    this.p33Dependencies = options.p33Dependencies ?? (room == null ? {} : { room });
  }

  /** Announce presence and begin polling. Connects immediately if already paired. */
  async start(): Promise<void> {
    coopLog("lobby", `start announce name=${this.name} protocol=${this.protocol}`);
    try {
      if (this.protocol === "p33") {
        const announced = await announceToP33Lobby(this.p33Dependencies);
        if (this.stopped) {
          return;
        }
        this.p33Credential = {
          presenceId: announced.presenceId,
          pairingToken: announced.pairingToken,
          identity: announced.identity,
        };
        this.id = announced.presenceId;
        if (announced.pairing != null) {
          await this.connectP33(announced.pairing);
          return;
        }
        this.scheduleNextPoll(0);
        return;
      }
      const { id, pairing } = await announceToLobby(this.name);
      if (this.stopped) {
        coopLog("lobby", "start: announced but already stopped -> abort");
        return;
      }
      this.id = id;
      if (pairing) {
        coopLog("lobby", `start: already paired on announce code=${pairing.code} role=${pairing.role} -> connect`);
        await this.connect(pairing);
        return;
      }
      coopLog("lobby", `announced id=${id} -> begin polling`);
      this.scheduleNextPoll(0);
    } catch (e) {
      coopWarn("lobby", `start failed: ${message(e)}`);
      this.callbacks.onError(message(e));
    }
  }

  /** The player picked someone from the list. */
  async pick(targetId: string): Promise<void> {
    if (!this.id || this.connecting || this.stopped) {
      coopLog(
        "lobby",
        `pick IGNORED target=${targetId} (id=${this.id != null} connecting=${this.connecting} stopped=${this.stopped})`,
      );
      return;
    }
    if (this.protocol === "p33") {
      this.callbacks.onError("Authenticated co-op requires the player to accept your request.");
      return;
    }
    coopLog("lobby", `pick target=${targetId} (self=${this.id})`);
    try {
      const pairing = await pickPlayer(this.id, targetId);
      coopLog("lobby", `pick matched code=${pairing.code} role=${pairing.role} -> connect`);
      await this.connect(pairing);
    } catch (e) {
      // Transient (they got matched first / left): surface + keep browsing.
      coopWarn("lobby", `pick failed (transient): ${message(e)} -> keep browsing`);
      this.callbacks.onError(message(e));
      this.scheduleNextPoll(POLL_INTERVAL_MS);
    }
  }

  /**
   * Lobby v2: ASK `targetId` to co-op (they must ACCEPT before anything connects).
   * Falls back to the instant {@linkcode pick} when the worker predates the
   * request/respond endpoints (a "not found" answer), so an un-deployed worker
   * never bricks the lobby - it just behaves like the old consentless flow.
   */
  async request(targetId: string, targetName: string): Promise<void> {
    if (!this.id || this.connecting || this.stopped) {
      return;
    }
    coopLog("lobby", `request target=${targetId} (self=${this.id})`);
    try {
      if (this.protocol === "p33") {
        if (this.p33Credential == null) {
          throw new Error("authenticated co-op lobby credential is missing");
        }
        await requestP33Player(this.p33Credential, targetId, this.p33Dependencies);
        this.outgoingPending = true;
        this.callbacks.onRequestPending?.(targetName);
        this.scheduleNextPoll(0);
        return;
      }
      await requestPlayer(this.id, targetId);
      this.outgoingPending = true;
      this.callbacks.onRequestPending?.(targetName);
      this.scheduleNextPoll(0);
    } catch (e) {
      const msg = message(e);
      if (this.failClosedP33Credential(e)) {
        return;
      }
      if (this.protocol === "legacy" && /not found/i.test(msg)) {
        // OLD worker (no request/respond endpoints): degrade to the instant pick.
        coopWarn("lobby", "request unsupported by worker -> falling back to instant pick");
        await this.pick(targetId);
        return;
      }
      coopWarn("lobby", `request failed (transient): ${msg} -> keep browsing`);
      this.outgoingPending = false;
      this.callbacks.onTransientError?.(msg);
      this.scheduleNextPoll(POLL_INTERVAL_MS);
    }
  }

  /**
   * Lobby v2: ANSWER the incoming join request. Accepting pairs us (I host) and
   * connects immediately; declining clears it and keeps browsing.
   */
  async respond(accept: boolean): Promise<void> {
    if (!this.id || this.connecting || this.stopped || this.incomingRequestId == null) {
      return;
    }
    const from = this.incomingRequestId;
    this.incomingRequestId = null;
    coopLog("lobby", `respond accept=${accept} from=${from} (self=${this.id})`);
    try {
      if (this.protocol === "p33") {
        if (this.p33Credential == null) {
          throw new Error("authenticated co-op lobby credential is missing");
        }
        const pairing = await respondToP33Request(this.p33Credential, from, accept, this.p33Dependencies);
        if (pairing != null) {
          await this.connectP33(pairing);
          return;
        }
        this.scheduleNextPoll(POLL_INTERVAL_MS);
        return;
      }
      const pairing = await respondToRequest(this.id, from, accept);
      if (pairing) {
        await this.connect(pairing);
        return;
      }
    } catch (e) {
      // The requester left / was matched while we decided: keep browsing.
      if (this.failClosedP33Credential(e)) {
        return;
      }
      coopWarn("lobby", `respond failed (transient): ${message(e)} -> keep browsing`);
      this.callbacks.onTransientError?.(message(e));
    }
    this.scheduleNextPoll(POLL_INTERVAL_MS);
  }

  /** Back out: stop polling and drop my presence row. */
  cancel(): void {
    coopLog("lobby", `cancel (id=${this.id ?? "none"} connecting=${this.connecting})`);
    this.stopped = true;
    this.clearTimer();
    if (this.protocol === "p33" && this.p33Credential != null) {
      void leaveP33Lobby(this.p33Credential, this.p33Dependencies).catch(() => {});
    } else if (this.id) {
      void leaveLobby(this.id);
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private failClosedP33Credential(error: unknown): boolean {
    if (this.protocol !== "p33" || !(error instanceof CoopP33HttpError)) {
      return false;
    }
    // 409 means different things on different endpoints. On the authenticated lobby GET it
    // means this presence/bearer binding was replaced and continuing would be unsafe. On
    // request/respond it is an ordinary matchmaking race (the row expired, left, or paired)
    // and must return to browsing. Treating every 409 as credential loss permanently stopped
    // polling after one late Accept and turned a recoverable race into a real softlock.
    const credentialFailure =
      error.status === 401
      || error.status === 403
      || (error.status === 409 && error.path.startsWith("/coop/v3/lobby?"));
    if (!credentialFailure) {
      return false;
    }
    this.stopped = true;
    this.clearTimer();
    this.callbacks.onError(message(error));
    return true;
  }

  private scheduleNextPoll(delayMs: number): void {
    if (this.stopped || this.connecting) {
      return;
    }
    this.clearTimer();
    this.timer = setTimeout(() => void this.poll(), delayMs);
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.connecting || !this.id) {
      return;
    }
    try {
      const snapshot =
        this.protocol === "p33"
          ? this.p33Credential == null
            ? null
            : await fetchP33Lobby(this.p33Credential, this.p33Dependencies)
          : await fetchLobby(this.id);
      if (snapshot == null) {
        throw new Error("authenticated co-op lobby credential is missing");
      }
      const { players, pairing, request, declined } = snapshot;
      if (this.stopped || this.connecting) {
        return;
      }
      if (pairing) {
        if ("transportRole" in pairing) {
          coopLog("lobby", `poll matched code=${pairing.code} transportRole=${pairing.transportRole} -> connect`);
          await this.connectP33(pairing);
        } else {
          coopLog("lobby", `poll matched code=${pairing.code} role=${pairing.role} -> connect`);
          await this.connect(pairing);
        }
        return;
      }
      // Lobby v2: my outgoing request was DECLINED (one-shot notice) - resume browsing.
      if (declined) {
        coopLog("lobby", `poll: request declined by ${declined}`);
        this.outgoingPending = false;
        this.callbacks.onDeclined?.(declined);
      }
      // Lobby v2: an INCOMING join request appeared / evaporated - surface the change once.
      if (request && request.id !== this.incomingRequestId) {
        coopLog("lobby", `poll: incoming request from=${request.id} name=${request.name}`);
        this.incomingRequestId = request.id;
        this.callbacks.onRequest?.(request);
      } else if (!request && this.incomingRequestId != null) {
        coopLog("lobby", "poll: incoming request gone (requester left / matched)");
        this.incomingRequestId = null;
        this.callbacks.onRequestGone?.();
      }
      coopLog("lobby", `poll players=${players.length}`);
      this.callbacks.onPlayers(players);
    } catch (error) {
      if (this.failClosedP33Credential(error)) {
        return;
      }
      // transient network blip; keep polling
    }
    this.scheduleNextPoll(POLL_INTERVAL_MS);
  }

  /** Lobby v2: whether MY outgoing request is still awaiting the other player's answer. */
  isRequestPending(): boolean {
    return this.outgoingPending;
  }

  /** Authenticated presence id used for deterministic headless matchmaking. */
  ownPresenceId(): string | null {
    return this.id;
  }

  private async connect(pairing: LobbyPairing): Promise<void> {
    if (this.connecting) {
      coopLog("lobby", `connect IGNORED code=${pairing.code} (already connecting)`);
      return;
    }
    coopLog("launch", `lobby connect code=${pairing.code} role=${pairing.role} name=${this.name}`);
    this.connecting = true;
    this.clearTimer();
    this.callbacks.onConnecting();
    try {
      const runtime = await this.connectFn(pairing.code, pairing.role, { username: this.name });
      if (this.stopped) {
        coopLog("launch", `lobby connect: runtime ready but stopped -> discard code=${pairing.code}`);
        return;
      }
      coopLog("launch", `lobby connected code=${pairing.code} role=${pairing.role} -> onConnected`);
      this.callbacks.onConnected(runtime);
    } catch (e) {
      coopWarn("launch", `lobby connect failed code=${pairing.code} role=${pairing.role}: ${message(e)}`);
      this.callbacks.onError(message(e));
    }
  }

  private async connectP33(pairing: CoopP33PairingV1): Promise<void> {
    if (this.connecting || this.p33Credential == null) {
      return;
    }
    this.connecting = true;
    this.clearTimer();
    this.callbacks.onConnecting();
    try {
      const runtime = await this.connectP33Fn(this.p33Credential, pairing, {
        p33Dependencies: this.p33Dependencies,
      });
      if (this.stopped) {
        runtime.localTransport.close();
        return;
      }
      this.callbacks.onConnected(runtime);
    } catch (error) {
      coopWarn(
        "launch",
        `P33 lobby connect failed pairing=${pairing.pairingId} transportRole=${pairing.transportRole}: ${message(error)}`,
      );
      try {
        await leaveP33Run(this.p33Credential, pairing.code, this.p33Dependencies);
      } catch {
        // The credential may already be stale; the original error is the useful one.
      }
      this.callbacks.onError(message(error));
    }
  }
}
