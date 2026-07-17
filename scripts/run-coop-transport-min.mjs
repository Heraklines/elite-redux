#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Optimization brief R6 tier-1: MINIMAL transport checkpoint. Serves the tiny
// connector-factory bundle (no game, no Phaser), drives the REAL production
// signaling client + SDP exchange + chunker + reconnection over native Chromium
// WebRTC in two pages, and budgets the whole test body under 60 seconds.
//
// Tier-2 (run-coop-browser-transport.mjs on the sealed full bundle) proves
// src/main wires the SAME factory; this lane exists for fast feedback, never as
// the only proof of connector wiring.
// =============================================================================

import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import puppeteer from "puppeteer";

const startedAt = Date.now();
const BUDGET_MS = 60_000;
const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, process.env.COOP_TRANSPORT_MIN_DIST ?? "dist-coop-transport-min");
const origin = "http://127.0.0.1:4186";
const signalOrigin = "http://127.0.0.1:4174";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const previewServer = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", origin).pathname;
  const requested =
    pathname === "/" ? "scripts/coop-transport-min.html" : pathname.replace(/^\/+/u, "").replace(/\.\./gu, "");
  const absolute = resolve(dist, requested);
  if (!absolute.startsWith(dist) || !existsSync(absolute)) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(absolute)] ?? "application/octet-stream" });
  createReadStream(absolute).pipe(response);
});

// The exact in-memory signal-slot relay the tier-2 checkpoint uses (same production
// endpoints the real signaling client calls).
const signals = { host: [], guest: [] };
const signalServer = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  const url = new URL(request.url ?? "/", signalOrigin);
  if (url.pathname === "/coop/signal" && request.method === "POST") {
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
});

let browser;
async function main() {
  await new Promise((res, rej) => {
    previewServer.once("error", rej);
    previewServer.listen(4186, "127.0.0.1", res);
  });
  await new Promise((res, rej) => {
    signalServer.once("error", rej);
    signalServer.listen(4174, "127.0.0.1", res);
  });

  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--mute-audio"],
  });
  const pageFor = async label => {
    const page = await browser.newPage();
    page.on("pageerror", error => {
      throw new Error(`[${label}] page error: ${error.message}`);
    });
    // Track native peer connections (tier-2's technique) so the reconnect proof can kill
    // the LIVE pc - the real failure shape - instead of the deliberate transport.close().
    await page.evaluateOnNewDocument(() => {
      const NativePeerConnection = globalThis.RTCPeerConnection;
      globalThis.__minPeerConnections = [];
      globalThis.RTCPeerConnection = class TrackedPeerConnection extends NativePeerConnection {
        constructor(...args) {
          super(...args);
          globalThis.__minPeerConnections.push(this);
        }
      };
    });
    await page.goto(origin, { waitUntil: "load" });
    await page.waitForFunction(() => globalThis.__coopTransportMinBridge?.ready?.() === true, { timeout: 15_000 });
    return page;
  };
  const [hostPage, guestPage] = await Promise.all([pageFor("host"), pageFor("guest")]);

  const establish = (page, role) =>
    page.evaluate(async localRole => {
      const { transport, rejoin } = await globalThis.__coopTransportMinBridge.establish("BROWSER", localRole, {
        ice: { stunUrls: [] },
      });
      globalThis.__minTransport = transport;
      globalThis.__minRejoin = rejoin;
      globalThis.__minReceived = [];
      transport.onMessage(message => {
        if (message.t === "resumeCheckpoint") {
          globalThis.__minReceived.push(message.session?.length ?? 0);
        }
      });
      return transport.state;
    }, role);

  const [hostState, guestState] = await Promise.all([establish(hostPage, "host"), establish(guestPage, "guest")]);
  if (hostState !== "connected" || guestState !== "connected") {
    throw new Error(`native handshake failed: host=${hostState} guest=${guestState}`);
  }
  console.log(`[transport-min] native WebRTC handshake connected in ${Date.now() - startedAt}ms`);

  // Chunker proof: a payload far above the single-frame threshold must arrive byte-complete.
  const payloadLength = 512 * 1024;
  await hostPage.evaluate(size => {
    globalThis.__minTransport.send({
      t: "resumeCheckpoint",
      checkpointId: "transport-min",
      commitment: { version: 1, digest: "0".repeat(16), wave: 1, revision: 0, timestamp: 1 },
      session: "x".repeat(size),
      mirrorCloud: false,
    });
  }, payloadLength);
  await guestPage.waitForFunction(size => globalThis.__minReceived.includes(size), { timeout: 20_000 }, payloadLength);
  console.log(`[transport-min] ${payloadLength}-byte chunked payload arrived byte-complete`);

  // Reconnection proof: kill both LIVE native peer connections (the real failure shape -
  // never transport.close(), which is the deliberate session-over teardown), then drive
  // the production rejoin driver from both sides (the exchange is symmetric).
  await Promise.all([
    hostPage.evaluate(() => globalThis.__minPeerConnections.at(-1)?.close()),
    guestPage.evaluate(() => globalThis.__minPeerConnections.at(-1)?.close()),
  ]);
  const rejoin = page => page.evaluate(() => globalThis.__minRejoin());
  const [hostRejoined, guestRejoined] = await Promise.all([rejoin(hostPage), rejoin(guestPage)]);
  if (!hostRejoined || !guestRejoined) {
    throw new Error(`production rejoin driver failed: host=${hostRejoined} guest=${guestRejoined}`);
  }
  const [hostAfter, guestAfter] = await Promise.all([
    hostPage.evaluate(() => globalThis.__minTransport.state),
    guestPage.evaluate(() => globalThis.__minTransport.state),
  ]);
  if (hostAfter !== "connected" || guestAfter !== "connected") {
    throw new Error(`post-rejoin state: host=${hostAfter} guest=${guestAfter}`);
  }
  const elapsed = Date.now() - startedAt;
  console.log(`[transport-min] rejoin reconnected both seats; total test body ${elapsed}ms`);
  if (elapsed > BUDGET_MS) {
    throw new Error(`[transport-min] budget exceeded: ${elapsed}ms > ${BUDGET_MS}ms`);
  }
  console.log(`[transport-min] PASS within the ${BUDGET_MS / 1000}s budget`);
}

main()
  .then(async () => {
    await browser?.close();
    previewServer.close();
    signalServer.close();
    process.exit(0);
  })
  .catch(async error => {
    console.error(error);
    await browser?.close();
    previewServer.close();
    signalServer.close();
    process.exit(1);
  });
