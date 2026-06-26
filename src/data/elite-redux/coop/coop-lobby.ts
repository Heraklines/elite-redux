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
import type { CoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { connectCoopWithCode, coopServerBase } from "#data/elite-redux/coop/coop-webrtc-connect";

/** A player currently waiting in the lobby (as seen by someone else). */
export interface LobbyPlayer {
  /** Opaque presence id (pass to {@linkcode CoopLobbyController.pick}). */
  id: string;
  /** Display name. */
  name: string;
  /** Milliseconds since this player's last poll (freshness). */
  age: number;
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

/**
 * Poll the lobby: returns OTHER waiting players + my pairing if the worker matched
 * me. Doubles as a presence heartbeat (the worker refreshes my seen_at).
 */
export async function fetchLobby(self: string): Promise<{ players: LobbyPlayer[]; pairing: LobbyPairing | null }> {
  const res = await fetch(`${coopServerBase()}/coop/lobby?self=${encodeURIComponent(self)}`);
  const text = await res.text();
  if (!res.ok) {
    throw lobbyError("/coop/lobby", res.status, text);
  }
  const body = JSON.parse(text) as { players?: LobbyPlayer[]; pairing?: unknown };
  return { players: Array.isArray(body.players) ? body.players : [], pairing: asPairing(body.pairing) };
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
}

/** The WebRTC connect signature - injectable so tests can stub the browser leg. */
export type CoopConnectFn = (code: string, role: "host" | "guest", opts: { username: string }) => Promise<CoopRuntime>;

/** Extra controller options (mainly a connect override for headless tests). */
export interface CoopLobbyOptions {
  /** Override the WebRTC connect (defaults to {@linkcode connectCoopWithCode}). */
  connect?: CoopConnectFn;
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

  constructor(
    private readonly name: string,
    private readonly callbacks: CoopLobbyCallbacks,
    options: CoopLobbyOptions = {},
  ) {
    this.connectFn = options.connect ?? connectCoopWithCode;
  }

  /** Announce presence and begin polling. Connects immediately if already paired. */
  async start(): Promise<void> {
    coopLog("lobby", `start announce name=${this.name}`);
    try {
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

  /** Back out: stop polling and drop my presence row. */
  cancel(): void {
    coopLog("lobby", `cancel (id=${this.id ?? "none"} connecting=${this.connecting})`);
    this.stopped = true;
    this.clearTimer();
    if (this.id) {
      void leaveLobby(this.id);
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
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
      const { players, pairing } = await fetchLobby(this.id);
      if (this.stopped || this.connecting) {
        return;
      }
      if (pairing) {
        coopLog("lobby", `poll matched code=${pairing.code} role=${pairing.role} -> connect`);
        await this.connect(pairing);
        return;
      }
      coopLog("lobby", `poll players=${players.length}`);
      this.callbacks.onPlayers(players);
    } catch {
      // transient network blip; keep polling
    }
    this.scheduleNextPoll(POLL_INTERVAL_MS);
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
}
