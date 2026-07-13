/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

const SURFACE_PREFIX = "[coop-browser:surface] ";
const SURFACE2_PREFIX = "[coop-browser:surface2] ";
const BINDING_PREFIX = "[coop-browser:binding] ";
const SURFACES = new Set(["command", "replacement", "reward", "starter"]);
const CHECKSUM_SENTINEL = "0000000000000000";

function cleanSegment(value) {
  return (
    String(value)
      .normalize("NFKD")
      .replaceAll(/[^a-zA-Z0-9_-]+/gu, "-")
      .replaceAll(/^-+|-+$/gu, "")
      .slice(0, 80) || "step"
  );
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

function parsedUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// Diagnostic request/response body capture is scoped to the co-op save + signal workers ONLY
// (never game assets/CDN/localhost), to keep artifacts sane and never touch unrelated traffic.
const CAPTURED_API_HOST = /(?:er-save-api|er-coop-api)/u;
const MAX_BODY_BYTES = 256 * 1024;

function isCapturedApiHost(hostname) {
  return CAPTURED_API_HOST.test(hostname);
}

// NEVER capture request bodies for the auth routes: /account/register and /account/login carry
// the account password. Diagnostics only need the savedata + coop protocol bodies.
function isCredentialPath(pathname) {
  return pathname.startsWith("/account/");
}

function truncateBody(body) {
  if (typeof body !== "string") {
    return null;
  }
  return body.length > MAX_BODY_BYTES ? `${body.slice(0, MAX_BODY_BYTES)}…[truncated ${body.length} bytes]` : body;
}

function isExpectedMissingSystemSaveError(type, text, source, registerMode) {
  if (type !== "error" || !registerMode) {
    return false;
  }
  // A fresh (register-mode) account has NO persisted data yet: the client reads the system
  // AND session saves, which legitimately 404 until the first persist, and the game logs its
  // own "Session read failed (missing)." line for the same missing-session read. These are the
  // expected fresh-account no-save condition - exempt them (dedicated exemption, NOT the
  // general allowlist). An EXISTING (login-mode) account gets no exemption, so a real missing
  // save there still fails closed.
  const path = parsedUrl(source)?.pathname;
  const missingSaveRead =
    (path === "/savedata/system/get" || path === "/savedata/session/get") && /status of 404/u.test(text);
  const missingSessionLog = /Session read failed \(missing\)\.?/u.test(text);
  return missingSaveRead || missingSessionLog;
}

function accountView(body) {
  const account = Array.isArray(body) ? body[0] : body;
  if (!account || typeof account !== "object") {
    return null;
  }
  return {
    username: typeof account.username === "string" ? account.username : null,
    lastSessionSlot: Number.isInteger(account.lastSessionSlot) ? account.lastSessionSlot : -1,
  };
}

function lobbyView(body) {
  if (!body || typeof body !== "object") {
    return null;
  }
  const players = Array.isArray(body.players)
    ? body.players.filter(player => player && typeof player.name === "string").map(player => player.name)
    : [];
  const request = body.request && typeof body.request.name === "string" ? body.request.name : null;
  const role = body.pairing?.role === "host" || body.pairing?.role === "guest" ? body.pairing.role : null;
  return { players, request, role };
}

function continuationSurfaceView(text) {
  if (!text.startsWith(SURFACE_PREFIX)) {
    return null;
  }
  let value;
  try {
    value = JSON.parse(text.slice(SURFACE_PREFIX.length));
  } catch (error) {
    throw new Error("built browser emitted malformed continuation JSON", { cause: error });
  }
  if (
    !value
    || typeof value !== "object"
    || value.version !== 1
    || !SURFACES.has(value.surface)
    || (value.role !== "host" && value.role !== "guest")
    || !Number.isSafeInteger(value.seat)
    || value.seat < 0
    || !Number.isSafeInteger(value.epoch)
    || value.epoch <= 0
    || !Number.isSafeInteger(value.membershipRevision)
    || value.membershipRevision <= 0
    || !Number.isSafeInteger(value.connectionGeneration)
    || value.connectionGeneration < 0
    || !Number.isSafeInteger(value.wave)
    || value.wave <= 0
    || !Number.isSafeInteger(value.turn)
    || value.turn <= 0
    || typeof value.phase !== "string"
    || value.phase.length === 0
    || typeof value.uiMode !== "string"
    || value.uiMode.length === 0
    || value.uiActive !== true
    || typeof value.stateDigest !== "string"
    || !/^[0-9a-f]{16}$/iu.test(value.stateDigest)
    || value.stateDigest === CHECKSUM_SENTINEL
  ) {
    throw new Error("built browser emitted an invalid continuation observation");
  }
  return Object.freeze({ ...value });
}

function bindingView(text) {
  if (!text.startsWith(BINDING_PREFIX)) {
    return null;
  }
  let value;
  try {
    value = JSON.parse(text.slice(BINDING_PREFIX.length));
  } catch (error) {
    throw new Error("built browser emitted malformed session-binding JSON", { cause: error });
  }
  if (
    !value
    || typeof value !== "object"
    || value.version !== 1
    || (value.role !== "host" && value.role !== "guest")
    || !Number.isSafeInteger(value.seat)
    || value.seat < 0
    || !Number.isSafeInteger(value.epoch)
    || value.epoch <= 0
    || !Number.isSafeInteger(value.membershipRevision)
    || value.membershipRevision <= 0
    || !Number.isSafeInteger(value.connectionGeneration)
    || value.connectionGeneration < 0
    || value.membershipState !== "active"
  ) {
    throw new Error("built browser emitted an invalid session-binding observation");
  }
  return Object.freeze({ ...value });
}

/**
 * Parse the read-only v2 semantic surface mirror. Lenient by design: an unrecognized or
 * malformed line returns null and is dropped (v2 drives navigation; it is not a hard proof
 * like v1, whose parser fails closed). Only the fields a driver needs are validated.
 */
function semanticSurfaceView(text) {
  if (!text.startsWith(SURFACE2_PREFIX)) {
    return null;
  }
  let value;
  try {
    value = JSON.parse(text.slice(SURFACE2_PREFIX.length));
  } catch {
    return null;
  }
  if (
    !value
    || typeof value !== "object"
    || value.version !== 2
    || typeof value.surfaceId !== "string"
    || value.surfaceId.length === 0
    || typeof value.operationClass !== "string"
    || !value.address
    || typeof value.address !== "object"
    || !Number.isSafeInteger(value.address.epoch)
    || !Number.isSafeInteger(value.address.wave)
    || !Number.isSafeInteger(value.address.turn)
  ) {
    return null;
  }
  return Object.freeze({ ...value, address: Object.freeze({ ...value.address }) });
}

export class EvidenceSink {
  constructor(label, artifactDir, allowedConsoleErrors = [], expectedMissingSystemSaveErrors = 0) {
    this.label = label;
    this.dir = resolve(artifactDir, label);
    this.allowedConsoleErrors = allowedConsoleErrors;
    this.expectedMissingSystemSaveErrors = expectedMissingSystemSaveErrors;
    this.events = [];
    this.failures = [];
    this.networkState = { account: null, lobby: null };
    this.writeTail = Promise.resolve();
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
  }

  cursor() {
    return this.events.length;
  }

  record(kind, detail = {}) {
    const event = {
      index: this.events.length,
      at: new Date().toISOString(),
      monotonicMs: Math.round(performance.now()),
      label: this.label,
      kind,
      ...detail,
    };
    this.events.push(event);
    this.writeTail = this.writeTail.then(() =>
      appendFile(resolve(this.dir, "public-ui-trace.jsonl"), `${JSON.stringify(event)}\n`),
    );
    return event;
  }

  find(pattern, from = 0) {
    return this.events.slice(from).find(event => pattern.test(event.text ?? ""));
  }

  findLast(pattern, from = 0) {
    return this.events
      .slice(from)
      .toReversed()
      .find(event => pattern.test(event.text ?? ""));
  }

  findSurface(surface, from = 0) {
    return this.events
      .slice(from)
      .find(event => event.kind === "browser-surface" && event.observation.surface === surface);
  }

  findLastSurface(surface, from = 0) {
    return this.events
      .slice(from)
      .toReversed()
      .find(event => event.kind === "browser-surface" && event.observation.surface === surface);
  }

  findBinding(from = 0) {
    return this.events.slice(from).find(event => event.kind === "browser-binding");
  }

  /** The latest v2 semantic surface observation (optionally matching a surfaceId) from `from`. */
  findLastSemanticSurface(from = 0, surfaceId = null) {
    return this.events
      .slice(from)
      .toReversed()
      .find(
        event => event.kind === "browser-surface2" && (surfaceId == null || event.observation.surfaceId === surfaceId),
      );
  }

  async waitForSurface(surface, { from = 0, timeoutMs = 120_000 } = {}) {
    return this.waitForCondition(sink => sink.findSurface(surface, from), {
      timeoutMs,
      description: `built-browser ${surface} continuation observation`,
    });
  }

  async waitFor(pattern, { from = 0, timeoutMs = 120_000, description = String(pattern) } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const event = this.find(pattern, from);
      if (event) {
        return event;
      }
      await delay(100);
    }
    throw new Error(`${this.label}: timed out waiting for ${description}`);
  }

  async waitForCondition(predicate, { timeoutMs = 120_000, description = "condition" } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = predicate(this);
      if (result) {
        return result;
      }
      await delay(100);
    }
    throw new Error(`${this.label}: timed out waiting for ${description}`);
  }

  attach(page) {
    page.on("console", message => {
      const text = message.text();
      const source = safeUrl(message.location().url || "");
      const event = this.record("console", {
        level: message.type(),
        text,
        source,
      });
      const expectedMissingSystemSave = isExpectedMissingSystemSaveError(
        message.type(),
        text,
        source,
        this.expectedMissingSystemSaveErrors,
      );
      if (expectedMissingSystemSave) {
        // A register-mode flag, not a countdown: a fresh account reads several missing saves
        // (system + session) before its first persist, so all such reads are expected.
        this.record("console-error-expected", { source, reason: "fresh account has no persisted save yet" });
      } else if (message.type() === "error" && !this.allowedConsoleErrors.some(pattern => pattern.test(text))) {
        this.failures.push(event);
      }
      try {
        const binding = bindingView(text);
        if (binding != null) {
          this.record("browser-binding", { observation: binding });
        }
        const observation = continuationSurfaceView(text);
        if (observation != null) {
          this.record("browser-surface", { observation });
        }
      } catch (error) {
        const invalid = this.record("browser-surface-invalid", {
          text: error instanceof Error ? error.message : String(error),
        });
        this.failures.push(invalid);
      }
      // The v2 semantic mirror is advisory (it drives state-aware navigation, it is not a
      // hard convergence proof like v1), so a malformed line is ignored, never fatal.
      const semantic = semanticSurfaceView(text);
      if (semantic != null) {
        this.record("browser-surface2", { observation: semantic });
      }
    });
    page.on("pageerror", error => {
      const event = this.record("pageerror", { text: error.stack ?? error.message });
      this.failures.push(event);
    });
    page.on("request", request => {
      const url = parsedUrl(request.url());
      const method = request.method();
      if (
        url == null
        || !isCapturedApiHost(url.hostname)
        || isCredentialPath(url.pathname)
        || !["POST", "PUT", "PATCH"].includes(method)
      ) {
        return;
      }
      const body = request.postData();
      if (body == null) {
        return;
      }
      // Diagnostic-only: the exact bytes the client submitted (e.g. the first-save CAS payload).
      this.record("request-body", {
        method,
        url: safeUrl(request.url()),
        bytes: body.length,
        body: truncateBody(body),
      });
    });
    page.on("requestfailed", request => {
      const errorText = request.failure()?.errorText ?? "request failed";
      const event = this.record("requestfailed", {
        text: errorText,
        method: request.method(),
        url: safeUrl(request.url()),
      });
      // Closing/replacing a page intentionally aborts in-flight telemetry and asset
      // requests. Preserve the event as evidence, but do not turn that public browser
      // lifecycle detail into a journey failure.
      if (!/net::ERR_ABORTED/u.test(errorText)) {
        this.failures.push(event);
      }
    });
    page.on("response", response => {
      const status = response.status();
      this.record("response", {
        status,
        method: response.request().method(),
        url: safeUrl(response.url()),
      });
      this.capturePublicResponse(response).catch(error => {
        this.record("response-observation-error", {
          text: error instanceof Error ? error.message : String(error),
          url: safeUrl(response.url()),
        });
      });
      // Capture the response BODY for a non-2xx status on the co-op workers only, so the exact
      // error text (e.g. the first-save CAS 409 message) is in the artifact. Bodies carry no
      // credentials on these routes; auth error bodies are advisory, so this is safe.
      const url = parsedUrl(response.url());
      if (url != null && isCapturedApiHost(url.hostname) && (status < 200 || status >= 300)) {
        response
          .text()
          .then(text => {
            this.record("response-body", {
              status,
              url: safeUrl(response.url()),
              bytes: text.length,
              body: truncateBody(text),
            });
          })
          .catch(() => {});
      }
    });
  }

  async capturePublicResponse(response) {
    const url = parsedUrl(response.url());
    if (!url) {
      return;
    }
    if (
      url.pathname !== "/account/info"
      && !url.pathname.startsWith("/coop/lobby")
      && !url.pathname.startsWith("/coop/v3/lobby")
    ) {
      return;
    }
    let body;
    try {
      body = await response.json();
    } catch {
      return;
    }
    if (url.pathname === "/account/info") {
      this.networkState.account = accountView(body);
      if (this.networkState.account) {
        this.record("account-view", this.networkState.account);
      }
      return;
    }

    this.networkState.lobby = lobbyView(body);
    if (this.networkState.lobby) {
      this.record("lobby-view", this.networkState.lobby);
    }
  }

  async checkpoint(page, context, name) {
    const step = cleanSegment(name);
    await page.screenshot({ path: resolve(this.dir, `${step}.png`), fullPage: true });
    const dom = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      bodyText: document.body.innerText,
      canvases: [...document.querySelectorAll("canvas")].map(canvas => ({
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
      })),
      inputs: [...document.querySelectorAll("input,textarea")].map(input => ({
        tag: input.tagName.toLowerCase(),
        type: input.getAttribute("type"),
        disabled: input.disabled,
        visible: input.getClientRects().length > 0,
      })),
      storage: Object.keys(localStorage)
        .sort()
        .map(key => ({ key, length: localStorage.getItem(key)?.length ?? 0 })),
    }));
    const cookies = (await context.cookies()).map(cookie => ({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expires: cookie.expires,
    }));
    await Promise.all([
      writeFile(resolve(this.dir, `${step}.dom.json`), `${JSON.stringify(dom, null, 2)}\n`),
      writeFile(resolve(this.dir, `${step}.cookies.json`), `${JSON.stringify(cookies, null, 2)}\n`),
    ]);
    this.record("checkpoint", { name: step });
  }

  assertClean() {
    if (this.failures.length > 0) {
      throw new Error(`${this.label}: ${this.failures.length} fatal browser event(s); inspect ${this.dir}`);
    }
  }

  async flush() {
    await this.writeTail;
  }
}
