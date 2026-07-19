#!/usr/bin/env node
// Browser-native co-op transport checkpoint. Two isolated Chromium contexts load one sealed production bundle,
// establish the production WebRTC connector through an in-memory signaling relay, complete the protocol /
// fingerprint / identity handshake, then force a 512 KiB UTF-8 checkpoint to lose its channel mid-chunk.
// Hot rejoin must restart chunk zero with a new transfer id, deliver the logical checkpoint exactly once,
// and carry subsequent protocol traffic.

import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, normalize, relative, resolve } from "node:path";
import process from "node:process";
import puppeteer from "puppeteer";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.COOP_BROWSER_PORT ?? 4173);
const signalPort = Number(process.env.COOP_BROWSER_SIGNAL_PORT ?? port + 1);
const origin = `http://127.0.0.1:${port}`;
const signalOrigin = `http://127.0.0.1:${signalPort}`;
const artifactDir = resolve(root, "dev-logs", "coop-browser");
const browserDist = resolve(root, process.env.COOP_BROWSER_DIST ?? "dist-coop-browser");
const browserAssets = resolve(root, process.env.COOP_BROWSER_ASSET_DIR ?? "assets");

const verify = spawnSync(
  process.execPath,
  [resolve(root, "scripts", "prepare-coop-browser-artifact.mjs"), "--verify"],
  { cwd: root, env: { ...process.env, COOP_BROWSER_DIST: browserDist }, encoding: "utf8" },
);
if (verify.status !== 0) {
  throw new Error(`browser artifact verification failed:\n${verify.stdout ?? ""}\n${verify.stderr ?? ""}`);
}
process.stdout.write(verify.stdout);
const sealedManifest = JSON.parse(readFileSync(resolve(browserDist, "coop-browser-artifact.json"), "utf8"));
if (process.env.GITHUB_SHA && sealedManifest.sha !== process.env.GITHUB_SHA) {
  throw new Error(`browser artifact SHA mismatch: built=${sealedManifest.sha} runtime=${process.env.GITHUB_SHA}`);
}
if (sealedManifest.signalOrigin !== signalOrigin) {
  throw new Error(
    `browser artifact signaling origin mismatch: built=${sealedManifest.signalOrigin} runtime=${signalOrigin}`,
  );
}

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
};

function safeStaticFile(directory, requested) {
  const absolute = normalize(resolve(directory, requested));
  const inside = relative(directory, absolute);
  return !inside.startsWith("..") && !inside.includes(":") && existsSync(absolute) && statSync(absolute).isFile()
    ? absolute
    : null;
}

/** Serve the sealed production bundle plus its exact checked-out immutable asset pin; never source code. */
const previewServer = createServer((request, response) => {
  let pathname = "/";
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", origin).pathname);
  } catch {
    response.writeHead(400).end("bad request");
    return;
  }
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const absolute = safeStaticFile(browserDist, requested) ?? safeStaticFile(browserAssets, requested);
  if (absolute == null) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
    return;
  }
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": CONTENT_TYPES[extname(absolute)] ?? "application/octet-stream",
  });
  createReadStream(absolute).pipe(response);
});

const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

const sourceAssetRoots = ["/images/", "/audio/", "/battle-anims/", "/battle-anims-er/", "/fonts/"];
const sourceAssetFiles = new Set([
  "/starter-colors.json",
  "/exp-sprites.json",
  "/biome-bgm-loop-points.json",
  "/logo128.png",
  "/logo512.png",
  "/manifest.webmanifest",
]);

/**
 * The sealed preview deliberately has no Cloudflare Pages redirect layer, so CDN-owned assets can 404 even
 * though the same paths are served by the immutable er-assets pin in staging/production. The browser lane
 * proves WebRTC/session behavior, not CDN completeness; keep these misses visible as diagnostics without
 * allowing unrelated console errors to pass.
 */
function isExpectedPreviewAssetMiss(text, locationUrl) {
  if (!text.includes("Failed to load resource") || !locationUrl) {
    return false;
  }
  try {
    const url = new URL(locationUrl);
    return (
      url.origin === origin
      && (sourceAssetRoots.some(prefix => url.pathname.startsWith(prefix)) || sourceAssetFiles.has(url.pathname))
    );
  } catch {
    return false;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin);
      if (response.ok) {
        return;
      }
    } catch {
      // Startup is still in progress.
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for sealed browser preview");
}

const signals = { host: [], guest: [] };
async function acceptPostedSignal(request, response) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if ((body.role !== "host" && body.role !== "guest") || typeof body.signal !== "string") {
    response.writeHead(400, { "Content-Type": "application/json" }).end('{"error":"bad signal"}');
    return;
  }
  signals[body.role].push(body.signal);
  response.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
}

async function handleSignalRequest(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  const url = new URL(request.url ?? "/", signalOrigin);
  if (url.pathname === "/coop/signal" && request.method === "POST") {
    await acceptPostedSignal(request, response);
    return;
  }
  if (url.pathname === "/coop/signal" && request.method === "GET") {
    const role = url.searchParams.get("role");
    const peer = role === "host" ? "guest" : "host";
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ signal: signals[peer].shift() ?? null }));
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"not found"}');
}

const signalServer = createServer((request, response) => {
  handleSignalRequest(request, response).catch(error => {
    response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(error) }));
  });
});

async function configurePage(page, label, browserErrors, sourceAssetMisses, bootRecoveries) {
  // Keep references to every native peer connection created by the sealed production bundle. The test later
  // injects a connectionState=failed event while its real DataChannel is still open, reproducing the browser
  // failure shape that previously stayed falsely healthy. This observer does not replace or mock WebRTC.
  await page.evaluateOnNewDocument(() => {
    const NativePeerConnection = globalThis.RTCPeerConnection;
    globalThis.__coopBrowserPeerConnections = [];
    globalThis.RTCPeerConnection = class TrackedPeerConnection extends NativePeerConnection {
      constructor(...args) {
        super(...args);
        globalThis.__coopBrowserPeerConnections.push(this);
      }
    };
  });
  // Stub only services that the transport checkpoint does not own. This removes known sealed-preview noise
  // without weakening page errors, co-op console errors, or arbitrary failed-resource diagnostics.
  await page.setRequestInterception(true);
  page.on("request", request => {
    const requestUrl = request.url();
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    };
    try {
      const url = new URL(requestUrl);
      if (url.pathname === "/manifest.json" && url.origin === origin) {
        request
          .respond({ status: 200, contentType: "application/json", body: '{"manifest":{}}' })
          .catch(error => browserErrors.push(`[${label}:request] manifest stub failed: ${error}`));
        return;
      }
      const localApi = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (localApi && url.pathname === "/game/titlestats") {
        request
          .respond({
            status: 200,
            contentType: "application/json",
            headers: corsHeaders,
            body: '{"playerCount":0,"battleCount":0}',
          })
          .catch(error => browserErrors.push(`[${label}:request] title-stats stub failed: ${error}`));
        return;
      }
      if (localApi && url.pathname === "/devtest/progress") {
        request
          .respond({ status: 200, contentType: "application/json", headers: corsHeaders, body: '{"passed":[]}' })
          .catch(error => browserErrors.push(`[${label}:request] devtest-progress stub failed: ${error}`));
        return;
      }
      if (localApi && url.pathname === "/devtest/event") {
        request
          .respond({ status: 200, contentType: "application/json", headers: corsHeaders, body: '{"ok":true}' })
          .catch(error => browserErrors.push(`[${label}:request] devtest-event stub failed: ${error}`));
        return;
      }
    } catch {
      // Let Chromium handle malformed/non-HTTP URLs; any resulting page/console error remains fatal below.
    }
    request.continue().catch(error => browserErrors.push(`[${label}:request] continue failed: ${error}`));
  });
  page.on("pageerror", error => browserErrors.push(`[${label}:page] ${error.stack ?? error.message}`));
  page.on("console", message => {
    const text = message.text();
    if (message.type() === "error") {
      const location = message.location();
      const source = location.url
        ? ` (${location.url}${location.lineNumber == null ? "" : `:${location.lineNumber}`})`
        : "";
      if (isExpectedPreviewAssetMiss(text, location.url)) {
        sourceAssetMisses.push(`[${label}] ${location.url}`);
      } else {
        browserErrors.push(`[${label}:console] ${text}${source}`);
      }
    }
    if (/\[coop:(?:launch|webrtc|session|runtime|resync)\]/.test(text)) {
      process.stdout.write(`[${label}] ${text}\n`);
    }
  });
  await page.goto(`${origin}/?coopdebug=1`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const waitForBridge = timeout =>
    page.waitForFunction(() => globalThis.__coopBrowserBridge?.ready?.() === true, {
      timeout,
      polling: 250,
    });
  const bootState = () =>
    page
      .evaluate(() => ({
        documentReadyState: document.readyState,
        bridgeDefined: globalThis.__coopBrowserBridge != null,
        bridgeReady: globalThis.__coopBrowserBridge?.ready?.() === true,
        canvasCount: document.querySelectorAll("canvas").length,
        bodyText: document.body?.innerText?.slice(0, 240) ?? "",
        location: location.href,
        visibility: document.visibilityState,
      }))
      .catch(error => ({ diagnosticError: String(error) }));
  try {
    await waitForBridge(90_000);
  } catch (firstError) {
    // This checkpoint owns transport behavior, not simultaneous Phaser boot pressure. A single Chromium
    // process occasionally leaves one of two concurrently-created contexts on the preloader background
    // while the sibling initializes normally; six immediately preceding exact-SHA gates completed this
    // same bridge. Reload only that inert page once, retain the first failure as evidence, and still fail
    // closed if the normal application cannot initialize on the bounded second attempt.
    const firstState = await bootState();
    bootRecoveries.push({ label, firstState, error: String(firstError) });
    process.stderr.write(
      `[coop-browser] ${label} bridge boot stalled; one bounded reload ${JSON.stringify(firstState)}\n`,
    );
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
    try {
      await waitForBridge(180_000);
    } catch (secondError) {
      const secondState = await bootState();
      const relatedErrors = browserErrors.filter(error => error.startsWith(`[${label}:`));
      throw new Error(
        `${label} sealed page bridge never became ready after one reload: `
          + `${JSON.stringify({ firstState, secondState, relatedErrors })}`,
        { cause: secondError },
      );
    }
  }
}

async function browserStatus(page) {
  return page.evaluate(() => {
    const runtime = globalThis.__coopBrowserRuntime;
    return {
      transport: runtime?.localTransport?.state,
      generation: runtime?.localTransport?.connectionGeneration?.(),
      wireReadyState: runtime?.localTransport?.wire?.readyState,
      snapshot: runtime?.controller?.snapshot?.(),
      versionMismatch: runtime?.controller?.versionMismatch,
      fingerprintMismatch: runtime?.controller?.functionalFingerprintMismatch,
      epoch: runtime?.controller?.sessionEpoch,
      runId: runtime?.controller?.runId,
      checkpointRevision: runtime?.controller?.checkpointRevision,
    };
  });
}

/**
 * A replacement DataChannel being momentarily `open` is not yet evidence of a usable recovered carrier.
 * Under runner/network pressure ICE can invalidate that candidate pair immediately and the production
 * runtime correctly enters another hot-rejoin generation. Require both real endpoints to remain open for
 * two keepalive intervals; a transient replacement is then observed as recovery-in-progress instead of
 * being mistaken for the final frontier and making the one-shot continuation probe a false failure.
 */
async function waitForStableConnectedPair(hostPage, guestPage, { minGeneration, timeoutMs = 120_000 }) {
  const deadline = Date.now() + timeoutMs;
  const stableMs = 10_000;
  let candidate = null;
  let last = null;
  while (Date.now() < deadline) {
    last = await Promise.all([browserStatus(hostPage), browserStatus(guestPage)]);
    const ready = last.every(
      state => state.transport === "connected" && state.wireReadyState === "open" && state.generation >= minGeneration,
    );
    const identity = ready ? last.map(state => state.generation).join(":") : null;
    if (identity == null) {
      candidate = null;
    } else if (candidate?.identity !== identity) {
      candidate = { identity, since: Date.now() };
    } else if (Date.now() - candidate.since >= stableMs) {
      return last;
    }
    await delay(250);
  }
  throw new Error(`native WebRTC pair never held one open replacement for ${stableMs}ms: ${JSON.stringify(last)}`);
}

async function installLifecycleProbe(page) {
  return page.evaluate(() => {
    const runtime = globalThis.__coopBrowserRuntime;
    if (runtime == null || typeof runtime.rejoinDriver !== "function") {
      throw new Error("browser lifecycle probe requires an installed rejoin driver");
    }
    if (globalThis.__coopBrowserLifecycleProbe != null) {
      throw new Error("browser lifecycle probe was installed twice");
    }
    const probe = {
      rejoinCalls: 0,
      transitions: [],
    };
    globalThis.__coopBrowserLifecycleProbe = probe;
    runtime.localTransport.onStateChange(state => {
      probe.transitions.push({
        state,
        generation: runtime.localTransport.connectionGeneration(),
      });
    });
    const rejoinDriver = runtime.rejoinDriver;
    runtime.rejoinDriver = async () => {
      probe.rejoinCalls++;
      return rejoinDriver.call(runtime);
    };
    return true;
  });
}

async function lifecycleProbeStatus(page) {
  return page.evaluate(() => {
    const runtime = globalThis.__coopBrowserRuntime;
    const probe = globalThis.__coopBrowserLifecycleProbe;
    if (runtime == null || probe == null) {
      throw new Error("browser lifecycle probe is not installed");
    }
    return {
      transport: runtime.localTransport.state,
      generation: runtime.localTransport.connectionGeneration(),
      wireReadyState: runtime.localTransport.wire.readyState,
      rejoinCalls: probe.rejoinCalls,
      disconnectedTransitions: probe.transitions.filter(entry => entry.state === "disconnected").length,
      connectedTransitions: probe.transitions.filter(entry => entry.state === "connected").length,
      transitions: [...probe.transitions],
      peerConnectionCount: (globalThis.__coopBrowserPeerConnections ?? []).length,
    };
  });
}

async function forcePeerConnectionState(page, state, peerConnectionIndex = -1) {
  return page.evaluate(
    ({ forcedState, requestedIndex }) => {
      const runtime = globalThis.__coopBrowserRuntime;
      const peerConnections = globalThis.__coopBrowserPeerConnections ?? [];
      const index = requestedIndex < 0 ? peerConnections.length - 1 : requestedIndex;
      const pc = peerConnections[index];
      if (runtime == null || pc == null) {
        throw new Error(`peer failure fixture cannot resolve peer connection index ${index}`);
      }
      globalThis.__coopBrowserForcedPeerStates ??= new WeakMap();
      const forcedStates = globalThis.__coopBrowserForcedPeerStates;
      if (!Object.hasOwn(pc, "connectionState")) {
        Object.defineProperty(pc, "connectionState", {
          configurable: true,
          get: () => forcedStates.get(pc),
        });
      }
      forcedStates.set(pc, forcedState);
      const channelStateBefore = runtime.localTransport.wire.readyState;
      pc.dispatchEvent(new Event("connectionstatechange"));
      return {
        channelStateBefore,
        generationAfterEvent: runtime.localTransport.connectionGeneration(),
        peerConnectionCount: peerConnections.length,
        peerConnectionIndex: index,
        transportAfterEvent: runtime.localTransport.state,
      };
    },
    { forcedState: state, requestedIndex: peerConnectionIndex },
  );
}

let browser;
try {
  await mkdir(artifactDir, { recursive: true });
  await new Promise((resolveListen, rejectListen) => {
    previewServer.once("error", rejectListen);
    previewServer.listen(port, "127.0.0.1", resolveListen);
  });
  await new Promise((resolveListen, rejectListen) => {
    signalServer.once("error", rejectListen);
    signalServer.listen(signalPort, "127.0.0.1", resolveListen);
  });
  await waitForServer();
  browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const hostContext = await browser.createBrowserContext();
  const guestContext = await browser.createBrowserContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();
  const browserErrors = [];
  const sourceAssetMisses = [];
  const bootRecoveries = [];
  await Promise.all([
    configurePage(hostPage, "host", browserErrors, sourceAssetMisses, bootRecoveries),
    configurePage(guestPage, "guest", browserErrors, sourceAssetMisses, bootRecoveries),
  ]);

  const connect = (page, role, username) =>
    page.evaluate(
      async ({ role: localRole, username: localUsername }) => {
        const runtime = await globalThis.__coopBrowserBridge.connect("BROWSER", localRole, {
          username: localUsername,
          ice: { stunUrls: ["stun:stun.cloudflare.com:3478"] },
        });
        globalThis.__coopBrowserRuntime = runtime;
        const identity = await runtime.controller.awaitPartnerIdentity(15_000);
        if (identity == null) {
          throw new Error("peer identity handshake did not complete");
        }
        return runtime.controller.snapshot();
      },
      { role, username },
    );

  const [hostIdentity, guestIdentity] = await Promise.all([
    connect(hostPage, "host", "Browser Host"),
    connect(guestPage, "guest", "Browser Guest"),
  ]);
  if (hostIdentity.partnerName !== "Browser Guest" || guestIdentity.partnerName !== "Browser Host") {
    throw new Error(`identity mismatch: ${JSON.stringify({ hostIdentity, guestIdentity })}`);
  }

  const initial = await Promise.all([browserStatus(hostPage), browserStatus(guestPage)]);
  if (initial.some(state => state.transport !== "connected" || state.versionMismatch || state.fingerprintMismatch)) {
    throw new Error(`initial native handshake failed: ${JSON.stringify(initial)}`);
  }
  if (initial[0].epoch <= 0 || initial[0].epoch !== initial[1].epoch) {
    throw new Error(`operation epoch did not converge: ${JSON.stringify(initial)}`);
  }

  // Install a direct transport observer in the isolated guest context. The normal controller remains a
  // consumer too; this probe only verifies byte-exact/exactly-once framing below it.
  await guestPage.evaluate(() => {
    const targetBytes = 512 * 1024;
    const quoteHeavy = '"quoted\\path" — café — 漢字 — 🧬 — e\u0301\n'.repeat(4_096);
    const shell = JSON.stringify({ waveIndex: 77, quoteHeavy, filler: "" });
    const shellBytes = new TextEncoder().encode(shell).byteLength;
    const expected = JSON.stringify({ waveIndex: 77, quoteHeavy, filler: "x".repeat(targetBytes - shellBytes) });
    if (new TextEncoder().encode(expected).byteLength !== targetBytes) {
      throw new Error("browser checkpoint fixture is not exactly 512 KiB");
    }
    globalThis.__coopBrowserProbe = {
      expected,
      received: null,
      checkpointCount: 0,
      continued: 0,
      pcFailureContinued: 0,
      pcClosedContinued: 0,
    };
    globalThis.__coopBrowserRuntime.localTransport.onMessage(message => {
      if (message.t === "resumeCheckpoint" && message.checkpointId === "browser-midchunk-checkpoint") {
        globalThis.__coopBrowserProbe.checkpointCount++;
        globalThis.__coopBrowserProbe.received = message.session;
      }
      if (message.t === "stallBeat" && message.waitingMs === 424_242) {
        globalThis.__coopBrowserProbe.continued++;
      }
      if (message.t === "stallBeat" && message.waitingMs === 515_151) {
        globalThis.__coopBrowserProbe.pcFailureContinued++;
      }
      if (message.t === "stallBeat" && message.waitingMs === 616_161) {
        globalThis.__coopBrowserProbe.pcClosedContinued++;
      }
    });
  });

  const checkpointFixture = await hostPage.evaluate(async () => {
    const targetBytes = 512 * 1024;
    const quoteHeavy = '"quoted\\path" — café — 漢字 — 🧬 — e\u0301\n'.repeat(4_096);
    const shell = JSON.stringify({ waveIndex: 77, quoteHeavy, filler: "" });
    const shellBytes = new TextEncoder().encode(shell).byteLength;
    const session = JSON.stringify({ waveIndex: 77, quoteHeavy, filler: "x".repeat(targetBytes - shellBytes) });
    const bytes = new TextEncoder().encode(session);
    if (bytes.byteLength !== targetBytes) {
      throw new Error(`browser checkpoint fixture has ${bytes.byteLength} bytes, expected ${targetBytes}`);
    }
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const digest = [...hash].map(value => value.toString(16).padStart(2, "0")).join("");
    const runtime = globalThis.__coopBrowserRuntime;
    const transport = runtime.localTransport;
    const wire = transport.wire;
    const originalSend = wire.send.bind(wire);
    let chunkFrames = 0;
    let faulted = false;
    wire.send = data => {
      let frame;
      try {
        frame = JSON.parse(data);
      } catch {
        frame = null;
      }
      if (!faulted && frame?.__coopChunk === 1 && ++chunkFrames === 8) {
        faulted = true;
        wire.close();
        throw new Error("forced browser-native mid-chunk channel loss");
      }
      originalSend(data);
    };
    transport.send({
      t: "resumeCheckpoint",
      checkpointId: "browser-midchunk-checkpoint",
      commitment: {
        version: 1,
        digest,
        gameMode: globalThis.__coopBrowserBridge.gameModeCoop,
        wave: 77,
        revision: 0,
        runId: runtime.controller.runId,
        checkpointRevision: runtime.controller.checkpointRevision,
        timestamp: 77,
        participants: ["Browser Guest", "Browser Host"],
        seats: { host: "Browser Host", guest: "Browser Guest" },
      },
      session,
      mirrorCloud: false,
    });
    if (!faulted) {
      throw new Error(`forced mid-chunk fault did not fire (sent chunks=${chunkFrames})`);
    }
    return { bytes: bytes.byteLength, chunkFramesBeforeLoss: chunkFrames };
  });

  // The production lifecycle sees "disconnected" and both clients use their installed rejoin drivers to
  // exchange a fresh offer/answer and replace the channel in place. The queued logical send must restart.
  await Promise.all([
    hostPage.waitForFunction(
      () =>
        globalThis.__coopBrowserRuntime?.localTransport?.state === "connected"
        && globalThis.__coopBrowserRuntime?.localTransport?.connectionGeneration?.() >= 1,
      { timeout: 90_000, polling: 250 },
    ),
    guestPage.waitForFunction(
      () =>
        globalThis.__coopBrowserRuntime?.localTransport?.state === "connected"
        && globalThis.__coopBrowserRuntime?.localTransport?.connectionGeneration?.() >= 1,
      { timeout: 90_000, polling: 250 },
    ),
  ]);

  await guestPage.waitForFunction(
    () =>
      globalThis.__coopBrowserProbe?.checkpointCount === 1
      && globalThis.__coopBrowserProbe?.received === globalThis.__coopBrowserProbe?.expected,
    { timeout: 90_000, polling: 100 },
  );
  await delay(500);
  const exactCheckpoint = await guestPage.evaluate(() => ({
    count: globalThis.__coopBrowserProbe.checkpointCount,
    exact: globalThis.__coopBrowserProbe.received === globalThis.__coopBrowserProbe.expected,
    bytes: new TextEncoder().encode(globalThis.__coopBrowserProbe.received ?? "").byteLength,
  }));
  if (exactCheckpoint.count !== 1 || !exactCheckpoint.exact || exactCheckpoint.bytes !== 512 * 1024) {
    throw new Error(`mid-chunk checkpoint was not byte-exact/exactly-once: ${JSON.stringify(exactCheckpoint)}`);
  }

  const firstRejoin = await waitForStableConnectedPair(hostPage, guestPage, { minGeneration: 1 });
  if (firstRejoin.some(state => state.transport !== "connected" || state.generation < 1)) {
    throw new Error(`mid-chunk hot rejoin failed: ${JSON.stringify(firstRejoin)}`);
  }
  await hostPage.evaluate(() => {
    globalThis.__coopBrowserRuntime.localTransport.send({ t: "stallBeat", waitingMs: 424_242 });
  });
  await guestPage.waitForFunction(() => globalThis.__coopBrowserProbe?.continued === 1, {
    timeout: 15_000,
    polling: 50,
  });

  // Observe the production runtime's public lifecycle seam without replacing it. Every terminal carrier
  // below must produce one disconnect and one rejoin-driver call on EACH endpoint, even though close/error/
  // peer-state callbacks can all fire for the same generation.
  await Promise.all([installLifecycleProbe(hostPage), installLifecycleProbe(guestPage)]);

  // A transient RTCPeerConnection.disconnected is not terminal. Force the native event, recover it within
  // the production grace period, then wait beyond that exact exported duration. No lifecycle transition,
  // rejoin attempt, PC replacement, or generation increment is allowed.
  const transientBefore = await Promise.all([lifecycleProbeStatus(hostPage), lifecycleProbeStatus(guestPage)]);
  const transientPcIndex = transientBefore[0].peerConnectionCount - 1;
  const transientDisconnect = await forcePeerConnectionState(hostPage, "disconnected", transientPcIndex);
  if (transientDisconnect.channelStateBefore !== "open" || transientDisconnect.transportAfterEvent !== "connected") {
    throw new Error(`transient disconnected was not debounced: ${JSON.stringify(transientDisconnect)}`);
  }
  await delay(250);
  const transientRecovery = await forcePeerConnectionState(hostPage, "connected", transientPcIndex);
  const peerDisconnectedGraceMs = await hostPage.evaluate(() => globalThis.__coopBrowserBridge.peerDisconnectedGraceMs);
  await delay(peerDisconnectedGraceMs + 250);
  const transientAfter = await Promise.all([lifecycleProbeStatus(hostPage), lifecycleProbeStatus(guestPage)]);
  if (
    transientAfter.some(
      (state, index) =>
        state.transport !== "connected"
        || state.generation !== transientBefore[index].generation
        || state.rejoinCalls !== transientBefore[index].rejoinCalls
        || state.disconnectedTransitions !== transientBefore[index].disconnectedTransitions
        || state.peerConnectionCount !== transientBefore[index].peerConnectionCount,
    )
  ) {
    throw new Error(
      `transient disconnected escaped its debounce: ${JSON.stringify({ transientBefore, transientRecovery, transientAfter })}`,
    );
  }

  const exerciseTerminalPeerState = async ({ state, trafficMarker, probeKey }) => {
    const before = await Promise.all([lifecycleProbeStatus(hostPage), lifecycleProbeStatus(guestPage)]);
    const targetGeneration = before[0].generation + 1;
    const terminalPcIndex = before[0].peerConnectionCount - 1;
    const injected = await forcePeerConnectionState(hostPage, state, terminalPcIndex);
    if (injected.channelStateBefore !== "open" || injected.transportAfterEvent !== "disconnected") {
      throw new Error(`${state}-with-open-channel was not propagated immediately: ${JSON.stringify(injected)}`);
    }
    // Duplicate native callbacks from the same failed carrier must collapse before the asynchronous redial
    // completes. This is the browser-native counterpart to the fake-PC exactly-once unit assertion.
    await forcePeerConnectionState(hostPage, state, terminalPcIndex);

    await Promise.all([
      hostPage.waitForFunction(
        generation =>
          globalThis.__coopBrowserRuntime?.localTransport?.state === "connected"
          && globalThis.__coopBrowserRuntime?.localTransport?.connectionGeneration?.() >= generation,
        { timeout: 90_000, polling: 250 },
        targetGeneration,
      ),
      guestPage.waitForFunction(
        generation =>
          globalThis.__coopBrowserRuntime?.localTransport?.state === "connected"
          && globalThis.__coopBrowserRuntime?.localTransport?.connectionGeneration?.() >= generation,
        { timeout: 90_000, polling: 250 },
        targetGeneration,
      ),
    ]);
    await hostPage.evaluate(marker => {
      globalThis.__coopBrowserRuntime.localTransport.send({ t: "stallBeat", waitingMs: marker });
    }, trafficMarker);
    await guestPage.waitForFunction(
      key => globalThis.__coopBrowserProbe?.[key] === 1,
      {
        timeout: 15_000,
        polling: 50,
      },
      probeKey,
    );

    const after = await Promise.all([lifecycleProbeStatus(hostPage), lifecycleProbeStatus(guestPage)]);
    for (const [index, endpoint] of ["host", "guest"].entries()) {
      const expectedGeneration = before[index].generation + 1;
      if (
        after[index].transport !== "connected"
        || after[index].wireReadyState !== "open"
        || after[index].generation !== expectedGeneration
        || after[index].rejoinCalls !== before[index].rejoinCalls + 1
        || after[index].disconnectedTransitions !== before[index].disconnectedTransitions + 1
      ) {
        throw new Error(
          `${state} carrier did not activate exactly one ${endpoint} lifecycle/rejoin: ${JSON.stringify({ before, injected, after })}`,
        );
      }
    }

    // Fire the superseded PC again AFTER its replacement is carrying traffic. The obsolete callback must
    // not change state, generation, lifecycle counts, the replacement channel, or start another redial.
    const staleBefore = await lifecycleProbeStatus(hostPage);
    const staleEvent = await forcePeerConnectionState(hostPage, state, terminalPcIndex);
    await delay(250);
    const staleAfter = await lifecycleProbeStatus(hostPage);
    if (
      staleAfter.transport !== "connected"
      || staleAfter.wireReadyState !== "open"
      || staleAfter.generation !== staleBefore.generation
      || staleAfter.rejoinCalls !== staleBefore.rejoinCalls
      || staleAfter.disconnectedTransitions !== staleBefore.disconnectedTransitions
    ) {
      throw new Error(
        `obsolete ${state} peer callback tore down its replacement: ${JSON.stringify({ staleBefore, staleEvent, staleAfter })}`,
      );
    }
    return { before, injected, after, staleEvent, staleAfter };
  };

  const failedOpenCarrier = await exerciseTerminalPeerState({
    state: "failed",
    trafficMarker: 515_151,
    probeKey: "pcFailureContinued",
  });
  const closedOpenCarrier = await exerciseTerminalPeerState({
    state: "closed",
    trafficMarker: 616_161,
    probeKey: "pcClosedContinued",
  });

  const rejoined = await Promise.all([browserStatus(hostPage), browserStatus(guestPage)]);
  if (
    rejoined.some(
      state =>
        state.transport !== "connected"
        || state.generation < firstRejoin[0].generation + 2
        || !state.snapshot?.partnerConnected
        || state.versionMismatch
        || state.fingerprintMismatch,
    )
  ) {
    throw new Error(`terminal peer-state hot rejoins failed: ${JSON.stringify(rejoined)}`);
  }
  if (browserErrors.length > 0) {
    throw new Error(`browser errors:\n${browserErrors.join("\n")}`);
  }
  if (sourceAssetMisses.length > 0) {
    const uniqueMisses = [...new Set(sourceAssetMisses)];
    process.stdout.write(
      "[coop-browser] sealed-preview CDN misses (non-fatal; staging owns redirect/asset verification): "
        + `${uniqueMisses.length} unique\n${uniqueMisses.join("\n")}\n`,
    );
  }
  process.stdout.write(
    `[coop-browser] PASS native WebRTC handshake + exact 512KiB UTF-8 mid-chunk restart + transient-PC debounce + failed/closed-PC open-channel recovery + exact lifecycle activation + stale-PC fencing + continued traffic ${JSON.stringify({ checkpointFixture, exactCheckpoint, transientAfter, failedOpenCarrier, closedOpenCarrier, rejoined, bootRecoveries })}\n`,
  );
} catch (error) {
  process.stderr.write(`[coop-browser] FAIL ${error.stack ?? error}\n`);
  if (browser) {
    for (const [index, page] of (await browser.pages()).entries()) {
      await page.screenshot({ path: resolve(artifactDir, `failure-${index}.png`) }).catch(() => {});
    }
  }
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  signalServer.close();
  previewServer.close();
}
