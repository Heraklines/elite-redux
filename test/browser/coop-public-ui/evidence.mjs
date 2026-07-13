/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

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

export class EvidenceSink {
  constructor(label, artifactDir, allowedConsoleErrors = []) {
    this.label = label;
    this.dir = resolve(artifactDir, label);
    this.allowedConsoleErrors = allowedConsoleErrors;
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
      const event = this.record("console", {
        level: message.type(),
        text,
        source: safeUrl(message.location().url || ""),
      });
      if (message.type() === "error" && !this.allowedConsoleErrors.some(pattern => pattern.test(text))) {
        this.failures.push(event);
      }
    });
    page.on("pageerror", error => {
      const event = this.record("pageerror", { text: error.stack ?? error.message });
      this.failures.push(event);
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
      this.record("response", {
        status: response.status(),
        method: response.request().method(),
        url: safeUrl(response.url()),
      });
      this.capturePublicResponse(response).catch(error => {
        this.record("response-observation-error", {
          text: error instanceof Error ? error.message : String(error),
          url: safeUrl(response.url()),
        });
      });
    });
  }

  async capturePublicResponse(response) {
    const url = parsedUrl(response.url());
    if (!url) {
      return;
    }
    if (url.pathname !== "/account/info" && !url.pathname.startsWith("/coop/lobby")) {
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
