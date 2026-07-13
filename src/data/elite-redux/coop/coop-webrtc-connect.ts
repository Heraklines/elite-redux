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
import {
  type CoopP33ClientDependencies,
  CoopP33HttpError,
  type CoopP33LobbyCredentialV1,
  type CoopP33PairingV1,
  endP33Run,
  heartbeatP33Run,
  leaveP33Run,
  pollP33Signal,
  pushP33Signal,
  rejoinP33Run,
} from "#data/elite-redux/coop/coop-p33-client";
import type { CoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { connectCoopSession } from "#data/elite-redux/coop/coop-runtime";
import {
  type CoopP33AuthenticatedContextV1,
  canAdoptCoopP33Rejoin,
  createFreshCoopP33Context,
} from "#data/elite-redux/coop/coop-session-binding";
import {
  type WebRtcTransport,
  webRtcTransportFromChannel,
  wireFromRtcChannel,
} from "#data/elite-redux/coop/coop-webrtc-transport";

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
  // Summarize the SDP by length only (#633): never dump the full blob / ICE candidates.
  coopLog("launch", `pushSignal code=${code} role=${role} sdpBytes=${signal.length}`);
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
  /** Injectable authenticated-client dependencies for focused browser tests. */
  p33Dependencies?: CoopP33ClientDependencies;
}

/**
 * The non-trickle ICE + SDP exchange for an ALREADY-CREATED run row (`code`).
 * host = offerer, guest = answerer. Resolves with the open RTCDataChannel. Shared
 * by every connect entrypoint (manual host/guest + matchmaking).
 */
async function exchangeAndOpenChannel(
  code: string,
  role: CoopRole,
  ice?: CoopIceConfig,
): Promise<{ channel: RTCDataChannel; pc: RTCPeerConnection }> {
  coopLog("launch", `exchange SDP start code=${code} role=${role} (ice=${ice ? "override" : "fetched"})`);
  const iceServers = ice ? buildIceServers(ice) : await fetchIceServers();
  const pc = new RTCPeerConnection({ iceServers });
  pc.addEventListener("iceconnectionstatechange", () => {
    coopLog("launch", `iceConnectionState=${pc.iceConnectionState} code=${code} role=${role}`);
  });
  pc.addEventListener("connectionstatechange", () => {
    coopLog("launch", `pcConnectionState=${pc.connectionState} code=${code} role=${role}`);
  });

  // #857 R2: hand the caller BOTH the channel and its owning pc so the transport can close the pc when
  // this connection is superseded on a hot rejoin (#805). Leaking the pc left a zombie that aborted the
  // next channel -> the flap. On ANY failure before the channel opens, close the pc here (an aborted
  // attempt must not leak its own pc either).
  try {
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
      return { channel: await waitForChannelOpen(channel), pc };
    }

    const channelPromise = new Promise<RTCDataChannel>(resolve => {
      pc.addEventListener("datachannel", ev => {
        coopLog(
          "launch",
          `guest datachannel event label=${ev.channel.label} state=${ev.channel.readyState} code=${code}`,
        );
        resolve(ev.channel);
      });
    });
    const offer = await pollPeerSignal(code, "guest");
    coopLog("launch", `guest received offer code=${code} -> answering`);
    await pc.setRemoteDescription(JSON.parse(offer) as RTCSessionDescriptionInit);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceComplete(pc);
    coopLog("launch", `guest pushing answer code=${code} (ICE gathered)`);
    await pushSignal(code, "guest", JSON.stringify(pc.localDescription));
    return { channel: await waitForChannelOpen(await channelPromise), pc };
  } catch (e) {
    try {
      pc.close();
    } catch {
      /* the pc may already be closed */
    }
    throw e;
  }
}

/** Stable-seat gameplay role. Invitation direction is deliberately absent. */
export function coopP33GameplayRole(context: CoopP33AuthenticatedContextV1): CoopRole {
  return context.localSeatId === context.authoritySeatId ? "host" : "guest";
}

async function pollP33PeerSignal(
  credential: CoopP33LobbyCredentialV1,
  code: string,
  dependencies: CoopP33ClientDependencies,
  timeoutMs = 60_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const signal = await pollP33Signal(credential, code, dependencies);
      if (signal != null) {
        return signal;
      }
    } catch (error) {
      // Credential failures are terminal. A transient network/5xx failure remains within the bounded poll.
      if (error instanceof CoopP33HttpError && [401, 403, 409].includes(error.status)) {
        throw error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error("coop: timed out waiting for the authenticated partner signal");
}

/** P33 SDP exchange. `transportRole` chooses offer/answer only; it never reaches gameplay ownership. */
async function exchangeAndOpenP33Channel(
  credential: CoopP33LobbyCredentialV1,
  pairing: CoopP33PairingV1,
  dependencies: CoopP33ClientDependencies,
  ice?: CoopIceConfig,
): Promise<{ channel: RTCDataChannel; pc: RTCPeerConnection }> {
  const iceServers = ice ? buildIceServers(ice) : await fetchIceServers();
  const pc = new RTCPeerConnection({ iceServers });
  try {
    if (pairing.transportRole === "offerer") {
      const channel = pc.createDataChannel("coop", { ordered: true });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceComplete(pc);
      await pushP33Signal(credential, pairing.code, JSON.stringify(pc.localDescription), dependencies);
      const answer = await pollP33PeerSignal(credential, pairing.code, dependencies);
      await pc.setRemoteDescription(JSON.parse(answer) as RTCSessionDescriptionInit);
      return { channel: await waitForChannelOpen(channel), pc };
    }

    const channelPromise = new Promise<RTCDataChannel>(resolve => {
      pc.addEventListener("datachannel", event => resolve(event.channel));
    });
    const offer = await pollP33PeerSignal(credential, pairing.code, dependencies);
    await pc.setRemoteDescription(JSON.parse(offer) as RTCSessionDescriptionInit);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceComplete(pc);
    await pushP33Signal(credential, pairing.code, JSON.stringify(pc.localDescription), dependencies);
    return { channel: await waitForChannelOpen(await channelPromise), pc };
  } catch (error) {
    try {
      pc.close();
    } catch {
      // The failed attempt may already have closed it.
    }
    throw error;
  }
}

function p33Context(credential: CoopP33LobbyCredentialV1, pairing: CoopP33PairingV1): CoopP33AuthenticatedContextV1 {
  if (credential.identity.accountId !== pairing.account.accountId) {
    throw new Error("co-op P33 pairing does not belong to the authenticated account");
  }
  const context = createFreshCoopP33Context({
    pairingId: pairing.pairingId,
    pairingBearer: credential.pairingToken,
    transportRole: pairing.transportRole,
    account: pairing.account,
    peerAccount: pairing.peer,
    connectionGeneration: pairing.connectionGeneration,
    peerConnectionGeneration: pairing.peer.connectionGeneration,
  });
  if (context == null) {
    throw new Error("co-op P33 pairing context was invalid");
  }
  return context;
}

/**
 * Connect to an already-paired co-op run by its `code` and worker-assigned `role`
 * (#633, matchmaking). The run row already exists (the matchmaker created it), so
 * this skips create/join and goes straight to the SDP exchange. This is the entry
 * the lobby uses - players never see host/guest; the worker decides.
 */
/**
 * #805 HOT REJOIN driver: re-runs the SDP exchange with the SAME code/role (the worker's
 * poll-then-clear signal slots tolerate a fresh exchange) and swaps the new channel into the
 * LIVE transport - the whole co-op session survives in place. Retries within the 2-minute
 * grace window; both peers must re-enter (the exchange is symmetric), which is exactly the
 * grace semantics. Resolves true on reconnect, false when the window expires.
 */
const COOP_REJOIN_GRACE_MS = 120_000;
const COOP_P33_HEARTBEAT_MS = 5_000;
function makeCoopRejoinDriver(
  code: string,
  role: CoopRole,
  transport: WebRtcTransport,
  ice?: CoopIceConfig,
): () => Promise<boolean> {
  return async () => {
    const startedAt = Date.now();
    let attempt = 0;
    while (Date.now() - startedAt < COOP_REJOIN_GRACE_MS) {
      attempt++;
      coopLog("launch", `rejoin attempt ${attempt} code=${code} role=${role} elapsed=${Date.now() - startedAt}ms`);
      try {
        const { channel, pc } = await exchangeAndOpenChannel(code, role, ice);
        transport.replaceChannel(wireFromRtcChannel(role, channel, pc));
        coopLog("launch", `rejoin SUCCESS attempt=${attempt} code=${code} role=${role}`);
        return true;
      } catch (e) {
        coopWarn("launch", `rejoin attempt ${attempt} failed (${(e as Error)?.message ?? "?"}); retrying in 5s`);
        await new Promise(resolve => setTimeout(resolve, 5_000));
      }
    }
    coopWarn("launch", `rejoin grace EXPIRED code=${code} role=${role} after ${attempt} attempts`);
    return false;
  };
}

/**
 * Connect one Worker-authenticated P33 pairing. The bearer fences every signaling call, while stable
 * account seats determine the gameplay authority independently of offerer/answerer.
 */
export async function connectCoopP33Pairing(
  credential: CoopP33LobbyCredentialV1,
  pairing: CoopP33PairingV1,
  opts: CoopConnectOptions = {},
): Promise<CoopRuntime> {
  if (!isCoopNetworkingConfigured()) {
    throw new Error("coop networking is not configured (VITE_COOP_SERVER_URL unset)");
  }
  const dependencies = opts.p33Dependencies ?? {};
  let activeCredential = { ...credential, identity: { ...credential.identity } };
  let activePairing = structuredClone(pairing);
  let context = p33Context(activeCredential, activePairing);
  const gameplayRole = coopP33GameplayRole(context);
  const { channel, pc } = await exchangeAndOpenP33Channel(activeCredential, activePairing, dependencies, opts.ice);
  const transport = webRtcTransportFromChannel(gameplayRole, channel, pc, activePairing.connectionGeneration);
  const runtime = connectCoopSession(transport, {
    username: activePairing.account.displayName,
    p33: context,
  });

  runtime.rejoinDriver = async () => {
    const startedAt = Date.now();
    let rebound: Awaited<ReturnType<typeof rejoinP33Run>> | null = null;
    let attempt = 0;
    while (Date.now() - startedAt < COOP_REJOIN_GRACE_MS) {
      attempt++;
      try {
        // Mint/rotate once. Every later SDP retry uses the exact accepted credential and generation.
        rebound ??= await rejoinP33Run(activePairing.code, activeCredential, dependencies);
        const nextContext = p33Context(rebound, rebound.pairing);
        if (
          rebound.pairing.connectionGeneration !== transport.connectionGeneration() + 1
          || !canAdoptCoopP33Rejoin(context, nextContext)
        ) {
          throw new Error("co-op P33 rejoin changed a retained session-binding axis");
        }
        // Rotate the HTTP credential as soon as the Worker commits it; the prior bearer is now stale.
        activeCredential = {
          presenceId: rebound.presenceId,
          pairingToken: rebound.pairingToken,
          identity: { ...rebound.identity },
        };
        activePairing = structuredClone(rebound.pairing);
        const replacement = await exchangeAndOpenP33Channel(activeCredential, activePairing, dependencies, opts.ice);
        if (!runtime.controller.adoptP33Rejoin(nextContext)) {
          replacement.pc.close();
          throw new Error("co-op P33 controller refused the retained rejoin binding");
        }
        transport.replaceChannel(wireFromRtcChannel(gameplayRole, replacement.channel, replacement.pc));
        context = nextContext;
        coopLog(
          "launch",
          `P33 rejoin SUCCESS attempt=${attempt} pairing=${activePairing.pairingId} generation=${activePairing.connectionGeneration}`,
        );
        return true;
      } catch (error) {
        if (error instanceof CoopP33HttpError && [401, 403].includes(error.status)) {
          coopWarn("launch", `P33 rejoin terminal credential failure status=${error.status}`);
          return false;
        }
        coopWarn(
          "launch",
          `P33 rejoin attempt ${attempt} failed (${error instanceof Error ? error.message : String(error)})`,
        );
        await new Promise(resolve => setTimeout(resolve, 5_000));
      }
    }
    try {
      await leaveP33Run(activeCredential, activePairing.code, dependencies);
    } catch {
      // Grace expiry is already terminal locally; stale/absent Worker state needs no further action.
    }
    return false;
  };

  let stopped = false;
  let ended = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let offState = (): void => {};
  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
    offState();
  };
  const heartbeat = async (): Promise<void> => {
    const credentialAtStart = activeCredential;
    const codeAtStart = activePairing.code;
    const generationAtStart = activePairing.connectionGeneration;
    const result = await heartbeatP33Run(credentialAtStart, codeAtStart, dependencies);
    if (result.connectionGeneration !== generationAtStart) {
      throw new CoopP33HttpError(
        "co-op P33 heartbeat reported a stale connection generation",
        409,
        "/coop/v3/heartbeat",
      );
    }
  };
  const failClosedHeartbeat = (): void => {
    const bearerAtStart = activeCredential.pairingToken;
    void heartbeat().catch(error => {
      if (
        bearerAtStart === activeCredential.pairingToken
        && error instanceof CoopP33HttpError
        && [401, 403, 409].includes(error.status)
      ) {
        coopWarn("launch", `P33 heartbeat lost authenticated ownership status=${error.status}; closing channel`);
        stop();
        transport.close();
      }
      // Transient network/5xx failures are retried by the next heartbeat tick.
    });
  };
  runtime.p33Signaling = {
    heartbeat,
    leave: async () => {
      stop();
      await leaveP33Run(activeCredential, activePairing.code, dependencies);
    },
    end: async () => {
      ended = true;
      stop();
      await endP33Run(activeCredential, activePairing.code, dependencies);
    },
    dispose: stop,
  };
  offState = transport.onStateChange(state => {
    if (state === "closed") {
      const shouldLeave = !ended;
      stop();
      if (shouldLeave) {
        void leaveP33Run(activeCredential, activePairing.code, dependencies).catch(() => {});
      }
    }
  });
  timer = setInterval(failClosedHeartbeat, COOP_P33_HEARTBEAT_MS);
  failClosedHeartbeat();
  return runtime;
}

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
  const { channel, pc } = await exchangeAndOpenChannel(code, role, opts.ice);
  const transport = webRtcTransportFromChannel(role, channel, pc);
  const runtime = connectCoopSession(transport, { username: opts.username });
  runtime.rejoinDriver = makeCoopRejoinDriver(code, role, transport, opts.ice);
  return runtime;
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

  const { channel, pc } = await exchangeAndOpenChannel(code, "host", opts.ice);
  const transport = webRtcTransportFromChannel("host", channel, pc);
  const runtime = connectCoopSession(transport, { username: opts.username });
  runtime.rejoinDriver = makeCoopRejoinDriver(code, "host", transport, opts.ice);
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
  const { channel, pc } = await exchangeAndOpenChannel(code, "guest", opts.ice);
  const transport = webRtcTransportFromChannel("guest", channel, pc);
  const runtime = connectCoopSession(transport, { username: opts.username });
  runtime.rejoinDriver = makeCoopRejoinDriver(code, "guest", transport, opts.ice);
  return runtime;
}
