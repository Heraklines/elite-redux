#!/usr/bin/env node
// Browser-native co-op transport checkpoint. Two isolated Chromium contexts load the real Vite client,
// establish the production WebRTC connector through an in-memory signaling relay, complete the protocol /
// fingerprint / identity handshake, then tear down the first RTCDataChannel and prove hot rejoin replaces it.

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import puppeteer from "puppeteer";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.COOP_BROWSER_PORT ?? 4173);
const origin = `http://127.0.0.1:${port}`;
const signalOrigin = "http://coop-browser.test";
const artifactDir = resolve(root, "dev-logs", "coop-browser");
const vite = resolve(root, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
const server = spawn(vite, ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  env: { ...process.env, VITE_COOP_SERVER_URL: signalOrigin },
  stdio: ["ignore", "pipe", "pipe"],
  shell: process.platform === "win32",
});

server.stdout.on("data", chunk => process.stdout.write(`[vite] ${chunk}`));
server.stderr.on("data", chunk => process.stderr.write(`[vite] ${chunk}`));

const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) {
      throw new Error(`Vite exited before readiness (${server.exitCode})`);
    }
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
  throw new Error("Timed out waiting for Vite");
}

function jsonResponse(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body),
  };
}

const signals = { host: [], guest: [] };

async function configurePage(page, label, browserErrors) {
  await page.setRequestInterception(true);
  page.on("request", request => {
    void (async () => {
      const url = new URL(request.url());
      if (url.origin !== signalOrigin) {
        await request.continue();
        return;
      }
      if (request.method() === "OPTIONS") {
        await request.respond({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
        return;
      }
      if (url.pathname === "/coop/signal" && request.method() === "POST") {
        const body = JSON.parse(request.postData() ?? "{}");
        if ((body.role !== "host" && body.role !== "guest") || typeof body.signal !== "string") {
          await request.respond(jsonResponse({ error: "bad signal" }, 400));
          return;
        }
        signals[body.role].push(body.signal);
        await request.respond(jsonResponse({ ok: true }));
        return;
      }
      if (url.pathname === "/coop/signal" && request.method() === "GET") {
        const role = url.searchParams.get("role");
        const peer = role === "host" ? "guest" : "host";
        await request.respond(jsonResponse({ signal: signals[peer].shift() ?? null }));
        return;
      }
      await request.respond(jsonResponse({ error: "not found" }, 404));
    })().catch(error => browserErrors.push(`[${label}:intercept] ${error.stack ?? error}`));
  });
  page.on("pageerror", error => browserErrors.push(`[${label}:page] ${error.stack ?? error.message}`));
  page.on("console", message => {
    const text = message.text();
    if (/\[coop:(?:launch|webrtc|session)\]/.test(text)) {
      process.stdout.write(`[${label}] ${text}\n`);
    }
  });
  await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForFunction(() => globalThis.dev?.scene?.gameData != null, { timeout: 180_000, polling: 250 });
}

async function browserStatus(page) {
  return page.evaluate(() => {
    const runtime = globalThis.__coopBrowserRuntime;
    return {
      transport: runtime?.localTransport?.state,
      generation: runtime?.localTransport?.connectionGeneration?.(),
      snapshot: runtime?.controller?.snapshot?.(),
      versionMismatch: runtime?.controller?.versionMismatch,
      fingerprintMismatch: runtime?.controller?.functionalFingerprintMismatch,
      epoch: runtime?.controller?.sessionEpoch,
    };
  });
}

let browser;
try {
  await mkdir(artifactDir, { recursive: true });
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
  await Promise.all([configurePage(hostPage, "host", browserErrors), configurePage(guestPage, "guest", browserErrors)]);

  const connect = (page, role, username) =>
    page.evaluate(
      async ({ role: localRole, username: localUsername }) => {
        const { connectCoopWithCode } = await import("/src/data/elite-redux/coop/coop-webrtc-connect.ts");
        const runtime = await connectCoopWithCode("BROWSER", localRole, {
          username: localUsername,
          // Host candidates are sufficient for two local browser contexts; avoid dependence on public STUN.
          ice: { stunUrls: ["stun:127.0.0.1:9"] },
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

  // Close only the current raw channel. The production lifecycle sees "disconnected" and both clients use
  // their installed rejoin drivers to exchange a fresh offer/answer and replace the channel in place.
  await hostPage.evaluate(() => globalThis.__coopBrowserRuntime.localTransport.wire.close());
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

  const rejoined = await Promise.all([browserStatus(hostPage), browserStatus(guestPage)]);
  if (
    rejoined.some(
      state =>
        state.transport !== "connected"
        || state.generation < 1
        || !state.snapshot?.partnerConnected
        || state.versionMismatch
        || state.fingerprintMismatch,
    )
  ) {
    throw new Error(`hot rejoin failed: ${JSON.stringify(rejoined)}`);
  }
  if (browserErrors.length > 0) {
    throw new Error(`browser errors:\n${browserErrors.join("\n")}`);
  }
  process.stdout.write(
    `[coop-browser] PASS native WebRTC handshake + protocol/fingerprint identity + hot rejoin ${JSON.stringify(rejoined)}\n`,
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
  server.kill("SIGTERM");
}
