/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op WebRTC connector (#633, P6). The browser glue that turns a pairing code
// into a live, host<->guest RTCDataChannel and hands it to the game:
//   pairing code  ->  RTCPeerConnection (STUN, optional TURN)
//                 ->  offer/answer exchanged via the er-coop-api signaling worker
//                 ->  open data channel  ->  WebRtcTransport  ->  CoopSessionController
//
// QUOTA / TURN (the maintainer's concern): connections use FREE public STUN by
// default and connect peer-to-peer (no relay, no ongoing cost) for the large
// majority of players. TURN (a relay for peers behind symmetric NAT) is OPTIONAL
// and OFF unless `VITE_COOP_TURN_URL` is set - and even then co-op carries only
// game commands (a few KB/s), so relayed traffic is megabytes per hour, trivially
// inside any TURN free tier. The signaling worker itself only brokers the
// handshake (a handful of requests + ~10 D1 writes per session).
//
// Uses non-trickle ICE (wait for gathering to complete, then exchange ONE SDP
// blob) so it pairs cleanly with the worker's one-shot signal relay - no
// candidate-streaming loop. Pure config (`buildIceServers`) is unit-tested; the
// live RTCPeerConnection flow is browser-only (no headless harness).
// =============================================================================

import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { connectCoopSession } from "#data/elite-redux/coop/coop-runtime";
import { webRtcTransportFromChannel } from "#data/elite-redux/coop/coop-webrtc-transport";

/**
 * Free public STUN (no account, no cost, no relay - just IP reflection so the two
 * peers can connect directly). Cloudflare's own STUN first (keeps it in-account),
 * Google's as a backup. STUN is NOT a relay and carries no game data.
 */
export const COOP_DEFAULT_STUN = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];

/** ICE configuration: STUN (always) + an OPTIONAL TURN relay. */
export interface CoopIceConfig {
  /** STUN urls; defaults to {@linkcode COOP_DEFAULT_STUN} when omitted/empty. */
  stunUrls?: string[];
  /** Optional TURN relay (only needed for peers behind symmetric NAT). */
  turn?: { urls: string | string[]; username?: string | undefined; credential?: string | undefined };
}

/**
 * Build the `RTCIceServer[]` for a peer connection. Always includes STUN; appends
 * a TURN entry only when one is configured. Pure - the unit-testable core of the
 * STUN-default / optional-TURN policy.
 */
export function buildIceServers(config: CoopIceConfig = {}): RTCIceServer[] {
  const stun = config.stunUrls && config.stunUrls.length > 0 ? config.stunUrls : COOP_DEFAULT_STUN;
  const servers: RTCIceServer[] = [{ urls: stun }];
  if (config.turn?.urls) {
    const turn: RTCIceServer = { urls: config.turn.urls };
    if (config.turn.username) {
      turn.username = config.turn.username;
    }
    if (config.turn.credential) {
      turn.credential = config.turn.credential;
    }
    servers.push(turn);
  }
  return servers;
}

/** Read build-time env (custom VITE_* keys are not on the typed ImportMetaEnv). */
function env(key: string): string | undefined {
  return (import.meta.env as unknown as Record<string, string | undefined>)[key];
}

/** The deployed er-coop-api signaling worker (#633, P6). A single shared
 *  deployment used by every build; `VITE_COOP_SERVER_URL` overrides it. */
const COOP_DEFAULT_SERVER = "https://er-coop-api.heraklines.workers.dev";

/** Base URL of the er-coop-api signaling worker (`VITE_COOP_SERVER_URL`, else the
 *  deployed default). */
export function coopServerBase(): string {
  return env("VITE_COOP_SERVER_URL") ?? COOP_DEFAULT_SERVER;
}

/** Whether co-op networking is configured (a signaling worker URL is set). */
export function isCoopNetworkingConfigured(): boolean {
  return coopServerBase().length > 0;
}

/** ICE config assembled from env (`VITE_COOP_TURN_URL` / `_USERNAME` / `_CREDENTIAL`). */
export function coopIceConfigFromEnv(): CoopIceConfig {
  const turnUrl = env("VITE_COOP_TURN_URL");
  if (!turnUrl) {
    return {};
  }
  return {
    turn: {
      urls: turnUrl,
      username: env("VITE_COOP_TURN_USERNAME"),
      credential: env("VITE_COOP_TURN_CREDENTIAL"),
    },
  };
}

/**
 * Resolve the ICE servers to use, preferring the worker's `/coop/ice` endpoint
 * (which mints short-lived CLOUDFLARE Realtime TURN credentials when the worker is
 * configured with a TURN key - keeping everything in your Cloudflare account). On
 * any failure / when no signaling URL is set, falls back to the static env config
 * (`coopIceConfigFromEnv`) and ultimately free STUN. Never throws.
 */
export async function fetchIceServers(): Promise<RTCIceServer[]> {
  const base = coopServerBase();
  if (base && typeof fetch === "function") {
    try {
      const res = await fetch(`${base}/coop/ice`);
      if (res.ok) {
        const data = (await res.json()) as { iceServers?: RTCIceServer[] };
        if (data.iceServers && data.iceServers.length > 0) {
          coopLog("launch", `ICE from worker /coop/ice servers=${data.iceServers.length}`);
          return data.iceServers;
        }
      }
    } catch {
      // fall through to the static config below
    }
  }
  coopLog("launch", "ICE fallback to static env/STUN config");
  return buildIceServers(coopIceConfigFromEnv());
}

type CoopRole = "host" | "guest";

async function postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${coopServerBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`coop ${path} failed: ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** Resolve once the peer connection has gathered all ICE candidates (non-trickle). */
function waitForIceComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
  });
}

/** Push this side's SDP blob to the signaling worker. */
async function pushSignal(code: string, role: CoopRole, signal: string): Promise<void> {
  await postJson("/coop/signal", { code, role, signal });
}

/** Poll the worker for the PEER's SDP blob until it appears (or the timeout). */
async function pollPeerSignal(code: string, role: CoopRole, timeoutMs = 60_000): Promise<string> {
  coopLog("launch", `await peer signal start code=${code} role=${role} timeout=${timeoutMs}ms`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${coopServerBase()}/coop/signal?code=${encodeURIComponent(code)}&role=${role}`);
    if (res.ok) {
      const body = (await res.json()) as { signal?: string | null };
      if (body.signal) {
        coopLog("launch", `await peer signal resolve code=${code} role=${role} (${body.signal.length}b)`);
        return body.signal;
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  coopWarn("launch", `await peer signal TIMEOUT code=${code} role=${role} after ${timeoutMs}ms`);
  throw new Error("coop: timed out waiting for the partner to connect");
}

/** Resolve with the data channel once it opens (or reject on timeout). */
function waitForChannelOpen(channel: RTCDataChannel, timeoutMs = 30_000): Promise<RTCDataChannel> {
  if (channel.readyState === "open") {
    coopLog("launch", "data channel already open");
    return Promise.resolve(channel);
  }
  coopLog("launch", `await data channel open (state=${channel.readyState} timeout=${timeoutMs}ms)`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      coopWarn("launch", `data channel did not open within ${timeoutMs}ms`);
      reject(new Error("coop: data channel did not open"));
    }, timeoutMs);
    channel.addEventListener("open", () => {
      clearTimeout(timer);
      coopLog("launch", "data channel OPEN");
      resolve(channel);
    });
  });
}

/** Options shared by the host/guest connect flows. */
export interface CoopConnectOptions {
  /** Local account name, shown to the partner. */
  username?: string | undefined;
  /** ICE override; defaults to {@linkcode coopIceConfigFromEnv}. */
  ice?: CoopIceConfig;
}

/**
 * The non-trickle ICE + SDP exchange for an ALREADY-CREATED run row (`code`).
 * host = offerer, guest = answerer. Resolves with the open RTCDataChannel. Shared
 * by every connect entrypoint (manual host/guest + matchmaking).
 */
async function exchangeAndOpenChannel(code: string, role: CoopRole, ice?: CoopIceConfig): Promise<RTCDataChannel> {
  coopLog("launch", `exchange SDP start code=${code} role=${role} (ice=${ice ? "override" : "fetched"})`);
  const iceServers = ice ? buildIceServers(ice) : await fetchIceServers();
  const pc = new RTCPeerConnection({ iceServers });
  pc.addEventListener("iceconnectionstatechange", () => {
    coopLog("launch", `iceConnectionState=${pc.iceConnectionState} code=${code} role=${role}`);
  });
  pc.addEventListener("connectionstatechange", () => {
    coopLog("launch", `pcConnectionState=${pc.connectionState} code=${code} role=${role}`);
  });

  if (role === "host") {
    const channel = pc.createDataChannel("coop", { ordered: true });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceComplete(pc);
    coopLog("launch", `host pushing offer code=${code} (ICE gathered)`);
    await pushSignal(code, "host", JSON.stringify(pc.localDescription));

    const answer = await pollPeerSignal(code, "host");
    coopLog("launch", `host received answer code=${code} -> setRemoteDescription`);
    await pc.setRemoteDescription(JSON.parse(answer) as RTCSessionDescriptionInit);
    return waitForChannelOpen(channel);
  }

  const channelPromise = new Promise<RTCDataChannel>(resolve => {
    pc.addEventListener("datachannel", ev => resolve(ev.channel));
  });
  const offer = await pollPeerSignal(code, "guest");
  coopLog("launch", `guest received offer code=${code} -> answering`);
  await pc.setRemoteDescription(JSON.parse(offer) as RTCSessionDescriptionInit);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceComplete(pc);
  coopLog("launch", `guest pushing answer code=${code} (ICE gathered)`);
  await pushSignal(code, "guest", JSON.stringify(pc.localDescription));
  return waitForChannelOpen(await channelPromise);
}

/**
 * Connect to an already-paired co-op run by its `code` and worker-assigned `role`
 * (#633, matchmaking). The run row already exists (the matchmaker created it), so
 * this skips create/join and goes straight to the SDP exchange. This is the entry
 * the lobby uses - players never see host/guest; the worker decides.
 */
export async function connectCoopWithCode(
  code: string,
  role: CoopRole,
  opts: CoopConnectOptions = {},
): Promise<CoopRuntime> {
  if (!isCoopNetworkingConfigured()) {
    coopWarn("launch", "connectCoopWithCode aborted: coop networking not configured");
    throw new Error("coop networking is not configured (VITE_COOP_SERVER_URL unset)");
  }
  coopLog("launch", `connectCoopWithCode code=${code} role=${role} username=${opts.username ?? "(default)"}`);
  const channel = await exchangeAndOpenChannel(code, role, opts.ice);
  return connectCoopSession(webRtcTransportFromChannel(role, channel), { username: opts.username });
}

/**
 * HOST a co-op run (#633, P6): create the run (get a shareable pairing code),
 * open the data channel as the offerer, and start the live session over it.
 * Returns the pairing code (show it to the guest) and the CoopRuntime. (Manual
 * code flow; the matchmaking lobby uses {@linkcode connectCoopWithCode} instead.)
 */
export async function connectCoopAsHost(
  opts: CoopConnectOptions & { seed?: string; onCode?: (code: string) => void } = {},
): Promise<{ code: string; runtime: CoopRuntime }> {
  if (!isCoopNetworkingConfigured()) {
    coopWarn("launch", "connectCoopAsHost aborted: coop networking not configured");
    throw new Error("coop networking is not configured (VITE_COOP_SERVER_URL unset)");
  }
  coopLog("launch", `connectCoopAsHost username=${opts.username ?? "(default)"} seed=${opts.seed != null}`);
  const created = await postJson("/coop/create", { host: opts.username ?? "Player 1", seed: opts.seed });
  const code = String(created.code);
  coopLog("launch", `host run created code=${code}`);
  // Surface the code to the UI immediately so the host can share it while the
  // rest of this function blocks waiting for the guest to connect.
  opts.onCode?.(code);

  const channel = await exchangeAndOpenChannel(code, "host", opts.ice);
  const runtime = connectCoopSession(webRtcTransportFromChannel("host", channel), { username: opts.username });
  coopLog("launch", `host session live code=${code}`);
  return { code, runtime };
}

/**
 * JOIN a co-op run as the guest (#633, P6): exchange SDP via the worker, open the
 * data channel as the answerer, and start the live session over it. (Manual code
 * flow; the matchmaking lobby uses {@linkcode connectCoopWithCode} instead.)
 */
export async function connectCoopAsGuest(code: string, opts: CoopConnectOptions = {}): Promise<CoopRuntime> {
  if (!isCoopNetworkingConfigured()) {
    coopWarn("launch", "connectCoopAsGuest aborted: coop networking not configured");
    throw new Error("coop networking is not configured (VITE_COOP_SERVER_URL unset)");
  }
  coopLog("launch", `connectCoopAsGuest code=${code} username=${opts.username ?? "(default)"}`);
  await postJson("/coop/join", { code, guest: opts.username ?? "Player 2" });
  const channel = await exchangeAndOpenChannel(code, "guest", opts.ice);
  return connectCoopSession(webRtcTransportFromChannel("guest", channel), { username: opts.username });
}
