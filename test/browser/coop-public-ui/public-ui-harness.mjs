/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import puppeteer from "puppeteer";
import { delay, EvidenceSink } from "./evidence.mjs";

const TITLE_PHASE = /Start Phase TitlePhase/u;
const LOGIN_PHASE = /Start Phase LoginPhase/u;
const SELECT_GENDER_PHASE = /Start Phase SelectGenderPhase/u;
const CHALLENGE_PHASE = /Start Phase SelectChallengePhase/u;
const STARTER_PHASE = /Start Phase SelectStarterPhase/u;
const LOCAL_COMMAND = /CommandPhase .*-> LOCAL UI/u;
const REWARD_PHASE = /Start Phase SelectModifierPhase/u;
const REWARD_OWNER = /OWNER drives reward screen/u;
const GUEST_FAINT_PICKER = /guest own-faint picker OPEN/u;
const HOST_SWITCH_PHASE = /Start Phase SwitchPhase/u;
const GUEST_CONTINUATION_ACK = /guest ACK turn stage=continuationReady e=(\d+) wave=(\d+) turn=(\d+) rev=(\d+)/u;
const SHARED_SESSION_TERMINAL = /\[coop:runtime\] shared session stopped safely: /u;
const LAUNCH_SNAPSHOT_ABORT = /launchSnapshotAbort wave=\d+ reason=/u;

/**
 * Loud-fail on a failed response from an endpoint the harness DRIVES navigation from (the
 * co-op lobby / account view). A non-2xx there means the lobby the player would see never
 * rendered; masking it as a generic "timed out waiting for the lobby list" hides the real
 * cause. Called from every lobby waiter predicate so the run stops on the FIRST failed call.
 */
function assertNoDriverApiFailure(sink, context) {
  const failure = sink.networkState.apiFailure;
  if (failure != null) {
    throw new Error(
      `${sink.label}: ${context} driver API failed (${failure.status} ${failure.pathname}); `
        + "refusing to keep polling a surface the player never saw.",
    );
  }
}

let publicKeyInputTail = Promise.resolve();

function withFocusedPublicKeyInput(page, action) {
  const focused = publicKeyInputTail.then(async () => {
    await page.bringToFront();
    return action();
  });
  publicKeyInputTail = focused.then(
    () => undefined,
    () => undefined,
  );
  return focused;
}

function comparableSurfaceObservation(observation) {
  return {
    surface: observation.surface,
    epoch: observation.epoch,
    membershipRevision: observation.membershipRevision,
    connectionGeneration: observation.connectionGeneration,
    wave: observation.wave,
    turn: observation.turn,
    phase: observation.phase,
    uiMode: observation.uiMode,
    uiActive: observation.uiActive,
    stateDigest: observation.stateDigest,
  };
}

function observedSurfaceEvents(client, surface, from) {
  return client.evidence.events
    .slice(from)
    .filter(event => event.kind === "browser-surface" && event.observation.surface === surface)
    .toReversed();
}

function findSharedSurfaceMatch(host, guest, surface, cursors, priorAddress, allowAddressRepeat, expectedWave) {
  const hostEvents = observedSurfaceEvents(host, surface, cursors[host.label]);
  const guestEvents = observedSurfaceEvents(guest, surface, cursors[guest.label]);
  for (const hostEvent of hostEvents) {
    const comparable = comparableSurfaceObservation(hostEvent.observation);
    const canonical = JSON.stringify(comparable);
    const address = `${comparable.epoch}:${comparable.wave}:${comparable.turn}`;
    if (
      (!allowAddressRepeat && priorAddress === address)
      || (expectedWave != null && comparable.wave !== expectedWave)
    ) {
      continue;
    }
    const guestEvent = guestEvents.find(
      candidate => JSON.stringify(comparableSurfaceObservation(candidate.observation)) === canonical,
    );
    if (guestEvent) {
      return {
        hostObservation: hostEvent.observation,
        guestObservation: guestEvent.observation,
        comparable,
        address,
      };
    }
  }
  return null;
}

const DIGEST_PARTS = /\[coop-browser:digest-parts\] (\{.*\})/u;

/** The latest per-component digest breakdown a client emitted for `address`, or null. */
function latestDigestParts(client, address, from) {
  const events = client.evidence.events;
  for (let i = events.length - 1; i >= from; i--) {
    const match = DIGEST_PARTS.exec(events[i].text ?? "");
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.address === address) {
          return parsed;
        }
      } catch {
        // A malformed diagnostic line is ignored; the combined-digest abort still fires.
      }
    }
  }
  return null;
}

/** Both clients at the SAME address/surface but UNEQUAL digest -> a real state divergence, else null. */
function detectSurfaceDivergence(host, guest, surface, cursors) {
  const h = host.evidence.findLastSurface(surface, cursors[host.label])?.observation;
  const g = guest.evidence.findLastSurface(surface, cursors[guest.label])?.observation;
  if (h == null || g == null) {
    return null;
  }
  const hostAddress = `${h.epoch}:${h.wave}:${h.turn}`;
  const guestAddress = `${g.epoch}:${g.wave}:${g.turn}`;
  if (hostAddress === guestAddress && h.surface === g.surface && h.stateDigest !== g.stateDigest) {
    return { address: hostAddress, hostDigest: h.stateDigest, guestDigest: g.stateDigest };
  }
  return null;
}

/** Name the digest COMPONENTS that differ between the two clients at `address` (self-identifying divergence). */
function diffDigestComponents(host, guest, address, cursors) {
  const hostParts = latestDigestParts(host, address, cursors[host.label])?.parts;
  const guestParts = latestDigestParts(guest, address, cursors[guest.label])?.parts;
  if (hostParts == null || guestParts == null) {
    return "component breakdown unavailable (digest-parts markers missing)";
  }
  const keys = [...new Set([...Object.keys(hostParts), ...Object.keys(guestParts)])].sort();
  const diffs = keys
    .filter(key => hostParts[key] !== guestParts[key])
    .map(key => `${key} [host=${hostParts[key] ?? "-"} guest=${guestParts[key] ?? "-"}]`);
  return diffs.length > 0 ? diffs.join("; ") : "no component-level difference (combined-hash only)";
}

export class PublicUiClient {
  constructor(browserContext, credentials, config) {
    this.context = browserContext;
    this.credentials = credentials;
    this.config = config;
    this.label = credentials.seat;
    this.page = null;
    this.pageCursor = 0;
    this.pageGeneration = 0;
    this.publicRole = null;
    this.publicSeat = null;
    this.titleNewGameKeys = [
      ...(this.label === "host-seat" ? config.keys.titleNewGame.hostSeat : config.keys.titleNewGame.guestSeat),
    ];
    this.evidence = new EvidenceSink(
      this.label,
      config.artifactDir,
      config.allowedConsoleErrors,
      config.accountMode === "register" ? 1 : 0,
    );
  }

  async init() {
    await this.evidence.init();
    await this.open();
  }

  async open() {
    this.pageGeneration += 1;
    this.pageCursor = this.evidence.cursor();
    this.evidence.networkState.account = null;
    this.evidence.networkState.lobby = null;
    this.publicRole = null;
    this.publicSeat = null;
    this.page = await this.context.newPage();
    await this.page.setViewport(this.config.viewport);
    // The bundle is immutable and digest-verified before launch. Preserve normal browser caching so a
    // cold reopen exercises production cache behavior instead of reloading tens of thousands of assets.
    await this.page.setCacheEnabled(true);
    this.evidence.attach(this.page);
    this.evidence.record("navigate", { url: new URL(this.config.baseUrl).origin });
    await this.page.goto(this.config.baseUrl, { waitUntil: "domcontentloaded", timeout: this.config.bootTimeoutMs });
    await this.page.waitForSelector("#app canvas", { timeout: this.config.bootTimeoutMs });
  }

  async reopen() {
    this.evidence.record("reopen", { reason: "cold browser page using same isolated context" });
    await this.page?.close().catch(() => {});
    await this.open();
  }

  async loginOrReuseSession() {
    const title = this.evidence.find(TITLE_PHASE, this.pageCursor);
    if (title) {
      return title;
    }
    await this.evidence.waitFor(LOGIN_PHASE, {
      from: this.pageCursor,
      timeoutMs: this.config.bootTimeoutMs,
      description: "public LoginPhase",
    });
    await delay(this.config.settleDelayMs);
    const autoTitle = this.evidence.find(TITLE_PHASE, this.pageCursor);
    if (autoTitle) {
      return autoTitle;
    }

    if (this.config.accountMode === "register") {
      await this.openRegistrationForm();
      await this.fillRegistrationForm();
    } else {
      // LOGIN_OR_REGISTER selects Login by default. This is a real keyboard action against the canvas UI.
      await this.press("Space", "open-login-form");
      await this.waitForVisibleInputs({ text: 1, password: 1, purpose: "public login form" });
      await this.fillLoginForm();
    }
    const entered = await this.completePostAuthentication();
    if (TITLE_PHASE.test(entered.text ?? "")) {
      await delay(this.config.settleDelayMs);
      return entered;
    }
    await delay(this.config.settleDelayMs);
    const titleCursor = this.evidence.cursor();
    await this.press("Space", "complete-first-login-gender-prompt");
    const titleAfterOnboarding = await this.evidence.waitFor(TITLE_PHASE, {
      from: titleCursor,
      timeoutMs: this.config.timeoutMs,
      description: "TitlePhase after visible first-login gender selection",
    });
    await delay(this.config.settleDelayMs);
    return titleAfterOnboarding;
  }

  async completePostAuthentication() {
    const account = await this.evidence.waitForCondition(
      sink => (sink.networkState.account?.username === this.credentials.username ? sink.networkState.account : null),
      {
        timeoutMs: this.config.timeoutMs,
        description: "authenticated public account response",
      },
    );
    if (this.config.accountMode === "register" && account.lastSessionSlot === -1) {
      await this.evidence.waitForCondition(
        sink =>
          sink.events.find(
            event => event.kind === "response" && event.status === 404 && event.url.endsWith("/savedata/system/get"),
          ),
        {
          timeoutMs: this.config.timeoutMs,
          description: "new-account public save lookup",
        },
      );
      await this.evidence.waitFor(/Could not get system savedata! 404 Save data not found\./u, {
        from: this.pageCursor,
        timeoutMs: this.config.timeoutMs,
        description: "exact fresh-account missing-save modal precursor",
      });
      await delay(this.config.settleDelayMs);
      const onboardingDeadline = Date.now() + this.config.bootTimeoutMs;
      let attempt = 0;
      while (Date.now() < onboardingDeadline) {
        const phase =
          this.evidence.find(TITLE_PHASE, this.pageCursor) ?? this.evidence.find(SELECT_GENDER_PHASE, this.pageCursor);
        if (phase) {
          return phase;
        }
        attempt += 1;
        // A cold production bundle can render the missing-save MessagePhase before its font/input surface
        // is ready. Keep retrying the same public A-button at a human cadence until the phase itself proves
        // it advanced; a fixed number of early presses turns asset latency into a false onboarding hang.
        await this.press("Space", `dismiss-new-account-message:attempt-${attempt}`);
        await delay(Math.max(this.config.settleDelayMs, 5_000));
      }
      const phase =
        this.evidence.find(TITLE_PHASE, this.pageCursor) ?? this.evidence.find(SELECT_GENDER_PHASE, this.pageCursor);
      if (phase) {
        return phase;
      }
      throw new Error(
        `${this.label}: fresh-account MessagePhase did not open TitlePhase or SelectGenderPhase after ${attempt} public retries`,
      );
    }
    return this.evidence.waitForCondition(
      sink => sink.find(TITLE_PHASE, this.pageCursor) ?? sink.find(SELECT_GENDER_PHASE, this.pageCursor),
      {
        timeoutMs: this.config.timeoutMs,
        description: "TitlePhase or visible first-login gender prompt after authentication",
      },
    );
  }

  async openRegistrationForm() {
    await delay(this.config.settleDelayMs);
    const canvas = await this.page.$("#app canvas");
    if (!canvas) {
      throw new Error(`${this.label}: public game canvas disappeared before registration`);
    }
    // The login/register modal is centered in the 320x180 public canvas. Try a tight cluster over the
    // visible right-hand Register button; every attempt is a real pointer click and success is proven only
    // by the three visible registration inputs (never scene/UI-handler inspection).
    const candidates = [
      [0.56, 0.42],
      [0.58, 0.42],
      [0.54, 0.42],
      [0.56, 0.45],
      [0.56, 0.39],
    ];
    for (const [x, y] of candidates) {
      const box = await canvas.boundingBox();
      if (!box) {
        throw new Error(`${this.label}: public game canvas has no visible bounds`);
      }
      this.evidence.record("canvas-click", { purpose: "open-registration-form", x, y });
      await canvas.click({ offset: { x: box.width * x, y: box.height * y } });
      await delay(this.config.settleDelayMs);
      const inputCount = await this.page.$$eval(
        'input[type="text"], input[type="password"]',
        inputs =>
          inputs.filter(input => {
            if (!(input instanceof HTMLInputElement)) {
              return false;
            }
            const bounds = input.getBoundingClientRect();
            return bounds.width > 0 && bounds.height > 0 && getComputedStyle(input).visibility !== "hidden";
          }).length,
      );
      if (inputCount >= 3) {
        return;
      }
      if (inputCount === 2) {
        throw new Error(`${this.label}: public canvas click opened Login instead of Register`);
      }
    }
    throw new Error(`${this.label}: visible Register button did not open three public form inputs`);
  }

  async fillRegistrationForm() {
    const [usernameInput] = await this.visibleInputHandles('input[type="text"]');
    const passwordInputs = await this.visibleInputHandles('input[type="password"]');
    if (!usernameInput || passwordInputs.length < 2) {
      throw new Error(`${this.label}: visible registration inputs were not present`);
    }
    this.evidence.record("fill-registration-form", {
      fields: ["username", "password", "confirm-password"],
      values: "<redacted>",
    });
    await usernameInput.click({ clickCount: 3 });
    await this.page.keyboard.type(this.credentials.username, { delay: 20 });
    for (const passwordInput of passwordInputs.slice(0, 2)) {
      await passwordInput.click({ clickCount: 3 });
      await this.page.keyboard.type(this.credentials.password, { delay: 20 });
    }
    await this.press("Enter", "submit-registration-form", { blurInputs: false });
  }

  async fillLoginForm() {
    const [usernameInput] = await this.visibleInputHandles('input[type="text"]');
    const [passwordInput] = await this.visibleInputHandles('input[type="password"]');
    if (!usernameInput || !passwordInput) {
      throw new Error(`${this.label}: visible login inputs were not present`);
    }
    this.evidence.record("fill-login-form", { fields: ["username", "password"], values: "<redacted>" });
    await usernameInput.click({ clickCount: 3 });
    await this.page.keyboard.press("Control+A");
    await this.page.keyboard.type(this.credentials.username, { delay: 20 });
    await passwordInput.click({ clickCount: 3 });
    await this.page.keyboard.press("Control+A");
    await this.page.keyboard.type(this.credentials.password, { delay: 20 });
    await this.press("Enter", "submit-login-form", { blurInputs: false });
  }

  async visibleInputHandles(selector) {
    const handles = await this.page.$$(selector);
    const visible = [];
    for (const handle of handles) {
      if (await handle.isVisible()) {
        visible.push(handle);
      }
    }
    return visible;
  }

  async waitForVisibleInputs({ text, password, purpose }) {
    const deadline = Date.now() + this.config.timeoutMs;
    while (Date.now() < deadline) {
      const textInputs = await this.visibleInputHandles('input[type="text"]');
      const passwordInputs = await this.visibleInputHandles('input[type="password"]');
      if (textInputs.length >= text && passwordInputs.length >= password) {
        return { textInputs, passwordInputs };
      }
      await delay(50);
    }
    throw new Error(
      `${this.label}: ${purpose} did not expose ${text} visible text and ${password} visible password inputs`,
    );
  }

  async press(key, purpose, { blurInputs = true } = {}) {
    await withFocusedPublicKeyInput(this.page, async () => {
      const [title, focused] = await Promise.all([
        this.page.title(),
        this.page.$eval("body", () => document.hasFocus()),
      ]);
      this.evidence.record("key-target", {
        focused,
        pageGeneration: this.pageGeneration,
        purpose,
        target: `${new URL(this.page.url()).origin}${new URL(this.page.url()).pathname}`,
        title,
      });
      if (!focused) {
        throw new Error(`${this.label}: public key target did not acquire browser focus for ${purpose}`);
      }
      if (blurInputs) {
        // Public DOM-only focus cleanup. No scene, UI handler, controller, or relay is accessed.
        await this.page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        });
      }
      this.evidence.record("key", { key, purpose });
      await this.page.keyboard.press(key, { delay: Math.min(this.config.actionDelayMs, 100) });
      await delay(this.config.actionDelayMs);
    });
  }

  async sequence(keys, purpose) {
    for (const [index, key] of keys.entries()) {
      await this.press(key, `${purpose}:${index + 1}/${keys.length}`);
    }
  }

  async checkpoint(name) {
    await this.evidence.checkpoint(this.page, this.context, `page-${this.pageGeneration}-${name}`);
  }

  async enterCoopLobby() {
    await this.evidence.waitFor(TITLE_PHASE, {
      from: this.pageCursor,
      timeoutMs: this.config.timeoutMs,
      description: "TitlePhase before opening co-op",
    });
    await this.sequence(this.titleNewGameKeys, "title-select-new-game");
    await this.press("Space", "title-open-new-game");
    await this.press("ArrowDown", "mode-select-coop-below-classic");
    const announceCursor = this.evidence.cursor();
    await this.press("Space", "mode-open-coop-lobby");
    await this.evidence.waitFor(/start announce name=/u, {
      from: announceCursor,
      timeoutMs: this.config.timeoutMs,
      description: "public co-op lobby announce",
    });
    await this.checkpoint("lobby-announced");
  }

  async waitForLobbyPlayer(username) {
    return this.evidence.waitForCondition(
      sink => {
        assertNoDriverApiFailure(sink, "co-op lobby");
        const players = sink.networkState.lobby?.players ?? [];
        const index = players.indexOf(username);
        return index >= 0 ? { players, index } : null;
      },
      { timeoutMs: this.config.timeoutMs, description: `lobby list containing ${username}` },
    );
  }

  async requestPlayer(username) {
    const { index } = await this.waitForLobbyPlayer(username);
    for (let i = 0; i < index; i++) {
      await this.press("ArrowDown", `lobby-select-${username}:${i + 1}/${index}`);
    }
    const requestCursor = this.evidence.cursor();
    await this.press("Space", `lobby-request-${username}`);
    await this.evidence.waitFor(/request target=/u, {
      from: requestCursor,
      timeoutMs: this.config.timeoutMs,
      description: `request relay for ${username}`,
    });
  }

  async acceptRequest(username) {
    await this.evidence.waitForCondition(
      sink => {
        assertNoDriverApiFailure(sink, "co-op lobby");
        return sink.networkState.lobby?.request === username;
      },
      {
        timeoutMs: this.config.timeoutMs,
        description: `visible incoming request from ${username}`,
      },
    );
    await this.press("Space", `lobby-accept-${username}`);
  }

  async waitForPublicRole(from = this.pageCursor) {
    const event = await this.evidence.waitForCondition(sink => sink.findBinding(from), {
      timeoutMs: this.config.timeoutMs,
      description: "authenticated stable-seat session binding",
    });
    this.publicRole = event.observation.role;
    this.publicSeat = event.observation.seat;
    if (this.publicRole == null || this.publicSeat == null) {
      throw new Error(`${this.label}: connected without an observable stable-seat binding`);
    }
    return this.publicRole;
  }

  async pulseActionUntil(pattern, purpose, maxPresses = 12) {
    const from = this.evidence.cursor();
    for (let press = 1; press <= maxPresses; press++) {
      const found = this.evidence.find(pattern, from);
      if (found) {
        return found;
      }
      await this.press("Space", `${purpose}:${press}/${maxPresses}`);
      await delay(this.config.settleDelayMs);
    }
    const found = this.evidence.find(pattern, from);
    if (found) {
      return found;
    }
    throw new Error(`${this.label}: ${purpose} never produced ${pattern}`);
  }

  async waitForLocalCommand(from = 0) {
    const event = await this.evidence.waitForCondition(
      sink =>
        sink.find(LOCAL_COMMAND, from)
        ?? sink.find(SHARED_SESSION_TERMINAL, from)
        ?? sink.find(LAUNCH_SNAPSHOT_ABORT, from),
      {
        timeoutMs: this.config.timeoutMs,
        description: "owned CommandPhase public UI or bounded shared terminal",
      },
    );
    if (!LOCAL_COMMAND.test(event.text ?? "")) {
      throw new Error(`${this.label}: shared session terminated before owned CommandPhase: ${event.text}`);
    }
    return event;
  }

  async waitForObservedSurface(surface, from = 0) {
    return this.evidence.waitForSurface(surface, { from, timeoutMs: this.config.timeoutMs });
  }
}

export class DuoPublicUiRig {
  constructor(browser, config) {
    this.browser = browser;
    this.config = config;
    this.clients = {};
    this.tracePage = null;
    this.traceGeneration = 0;
    this.replacementCount = 0;
    this.lastSharedSurfaceAddress = new Map();
    this.activeBattleWave = null;
    this.pairRoleCursors = null;
  }

  static async launch(config) {
    const browser = await puppeteer.launch({
      headless: config.headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-ui-for-media-stream",
      ],
    });
    const rig = new DuoPublicUiRig(browser, config);
    try {
      const [hostContext, guestContext] = await Promise.all([
        browser.createBrowserContext(),
        browser.createBrowserContext(),
      ]);
      if (hostContext === guestContext) {
        throw new Error("Puppeteer returned one browser context for both players");
      }
      rig.clients["host-seat"] = new PublicUiClient(hostContext, config.credentials.hostSeat, config);
      rig.clients["guest-seat"] = new PublicUiClient(guestContext, config.credentials.guestSeat, config);
      await Promise.all(Object.values(rig.clients).map(client => client.init()));
      return rig;
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
  }

  async startChromeTrace() {
    if (!this.config.chromeTrace || this.tracePage) {
      return;
    }
    this.traceGeneration += 1;
    this.tracePage = this.clients["host-seat"].page;
    await this.tracePage.tracing.start({
      path: `${this.config.artifactDir}/combined-chrome-trace-${this.traceGeneration}.json`,
      screenshots: true,
    });
  }

  async stopChromeTrace() {
    if (!this.config.chromeTrace || !this.tracePage) {
      return;
    }
    await this.tracePage.tracing.stop();
    this.tracePage = null;
  }

  client(seat) {
    const client = this.clients[seat];
    if (!client) {
      throw new Error(`Unknown seat ${seat}`);
    }
    return client;
  }

  get host() {
    return Object.values(this.clients).find(client => client.publicRole === "host") ?? null;
  }

  get guest() {
    return Object.values(this.clients).find(client => client.publicRole === "guest") ?? null;
  }

  async loginBoth() {
    await Promise.all(Object.values(this.clients).map(client => client.loginOrReuseSession()));
    await Promise.all(Object.values(this.clients).map(client => client.checkpoint("title-ready")));
    // Begin optional Chrome tracing only after credential entry is complete. The
    // mandatory JSONL evidence recorder remains active from initial navigation.
    await this.startChromeTrace();
  }

  async pair(requesterSeat) {
    const requester = this.client(requesterSeat);
    const acceptor = Object.values(this.clients).find(client => client !== requester);
    await Promise.all(Object.values(this.clients).map(client => client.enterCoopLobby()));
    const roleCursors = Object.fromEntries(
      Object.values(this.clients).map(client => [client.label, client.evidence.cursor()]),
    );
    await requester.requestPlayer(acceptor.credentials.username);
    await acceptor.acceptRequest(requester.credentials.username);
    // The co-op HOST binds from the WebRTC session connect (sessionEpoch>0). The co-op GUEST
    // only binds AFTER the host fires its LAUNCH DECISION ("Press to start co-op" ->
    // sendResumeStartNew / resume offer), which the journey (startFreshRun/resumeRun) drives
    // next. Identify the host here; the guest binding + full role/seat verification is deferred
    // to completePairingBinding() AFTER that human launch press - otherwise we deadlock waiting
    // for a binding that only the launch action produces.
    this.pairRoleCursors = roleCursors;
    await this.waitForCoopHost(roleCursors);
    await Promise.all(Object.values(this.clients).map(client => client.checkpoint("paired-awaiting-launch")));
    return { requester, acceptor };
  }

  /** Wait for the co-op HOST to publish its stable-seat binding (it connects before the launch). */
  async waitForCoopHost(roleCursors) {
    const deadline = Date.now() + this.config.timeoutMs;
    while (Date.now() < deadline) {
      for (const client of Object.values(this.clients)) {
        const binding = client.evidence.findBinding(roleCursors[client.label]);
        if (binding) {
          client.publicRole = binding.observation.role;
          client.publicSeat = binding.observation.seat;
          if (binding.observation.role === "host") {
            return client;
          }
        }
      }
      await delay(100);
    }
    throw new Error("Co-op host never reached a stable-seat session binding after lobby pairing");
  }

  /** After the host's launch decision, wait for BOTH bindings and verify the stable-seat assignment. */
  async completePairingBinding() {
    const roleCursors = this.pairRoleCursors;
    if (!roleCursors) {
      throw new Error("completePairingBinding called before pair()");
    }
    await Promise.all(Object.values(this.clients).map(client => client.waitForPublicRole(roleCursors[client.label])));
    const roles = Object.values(this.clients)
      .map(client => client.publicRole)
      .sort();
    const seats = Object.values(this.clients)
      .map(client => client.publicSeat)
      .sort();
    if (JSON.stringify(roles) !== JSON.stringify(["guest", "host"]) || JSON.stringify(seats) !== "[0,1]") {
      throw new Error(
        `Stable-seat binding invalid after launch decision: roles=${JSON.stringify(roles)} seats=${JSON.stringify(seats)}`,
      );
    }
    await Promise.all(Object.values(this.clients).map(client => client.checkpoint("paired-and-verifying-save")));
  }

  async assertSharedSurface(surface, cursors, proofName, { allowAddressRepeat = false, expectedWave = null } = {}) {
    const values = Object.values(this.clients);
    const host = this.host;
    const guest = this.guest;
    if (!host || !guest) {
      throw new Error(`${proofName}: paired host/guest observations were unavailable`);
    }
    const priorAddress = this.lastSharedSurfaceAddress.get(surface);
    const deadline = Date.now() + this.config.timeoutMs;
    let match = null;
    // Divergence-aware fast-abort: if both clients sit at the SAME address/surface with STABLE but
    // UNEQUAL digests for ~30s, converge will never happen - abort now with the diverging components
    // instead of burning the full timeout on a decided divergence.
    let divergenceSignature = null;
    let divergenceSince = 0;
    while (Date.now() < deadline && match == null) {
      match = findSharedSurfaceMatch(host, guest, surface, cursors, priorAddress, allowAddressRepeat, expectedWave);
      if (match != null) {
        break;
      }
      const divergence = detectSurfaceDivergence(host, guest, surface, cursors);
      if (divergence == null) {
        divergenceSignature = null;
      } else {
        const signature = `${divergence.address}|${divergence.hostDigest}|${divergence.guestDigest}`;
        if (signature !== divergenceSignature) {
          divergenceSignature = signature;
          divergenceSince = Date.now();
        } else if (Date.now() - divergenceSince > 30_000) {
          const components = diffDigestComponents(host, guest, divergence.address, cursors);
          throw new Error(
            `${proofName}: STABLE state-digest DIVERGENCE at ${surface} address ${divergence.address} (host=${divergence.hostDigest} guest=${divergence.guestDigest}) held >30s; diverging components: ${components}`,
          );
        }
      }
      await delay(100);
    }
    if (match == null) {
      const hostLast = host.evidence.findLastSurface(surface, cursors[host.label])?.observation ?? null;
      const guestLast = guest.evidence.findLastSurface(surface, cursors[guest.label])?.observation ?? null;
      throw new Error(
        `${proofName}: clients never converged on one ${surface} address/state/surface; host=${JSON.stringify(hostLast)} guest=${JSON.stringify(guestLast)}`,
      );
    }
    const { hostObservation, guestObservation, comparable: sharedComparable, address } = match;
    if (
      hostObservation.role !== "host"
      || hostObservation.seat !== 0
      || guestObservation.role !== "guest"
      || guestObservation.seat !== 1
    ) {
      throw new Error(
        `${proofName}: surface seats disagree with the authenticated binding: host=${hostObservation.role}/${hostObservation.seat} guest=${guestObservation.role}/${guestObservation.seat}`,
      );
    }
    this.lastSharedSurfaceAddress.set(surface, address);
    for (const client of values) {
      client.evidence.record("shared-surface-proof", {
        proofName,
        peer: client === host ? guest.label : host.label,
        observation: sharedComparable,
      });
    }
    return sharedComparable;
  }

  async assertRetainedContinuation(cursors, proofName) {
    if (!this.host || !this.guest) {
      throw new Error(`${proofName}: retained continuation proof requires a paired host and guest`);
    }
    const guestEvent = await this.guest.evidence.waitFor(GUEST_CONTINUATION_ACK, {
      from: cursors[this.guest.label],
      timeoutMs: this.config.timeoutMs,
      description: `${proofName} guest continuationReady ACK`,
    });
    const guestMatch = GUEST_CONTINUATION_ACK.exec(guestEvent.text);
    if (!guestMatch) {
      throw new Error(`${proofName}: malformed guest continuationReady evidence`);
    }
    const retainedAddress = guestMatch.slice(1).join(":");
    const exactRelease = new RegExp(`host RELEASE retained turn after continuationReady key=${retainedAddress}`, "u");
    await this.host.evidence.waitFor(exactRelease, {
      from: cursors[this.host.label],
      timeoutMs: this.config.timeoutMs,
      description: `${proofName} host exact-address retained release`,
    });
    this.guest.evidence.record("retained-continuation-proof", { proofName, retainedAddress, side: "ack" });
    this.host.evidence.record("retained-continuation-proof", { proofName, retainedAddress, side: "release" });
    return retainedAddress;
  }

  async startFreshRun() {
    if (!this.host) {
      throw new Error("startFreshRun requires a paired public host (call pair() first)");
    }
    const phaseCursors = Object.fromEntries(
      Object.values(this.clients).map(client => [client.label, client.evidence.cursor()]),
    );
    // Drive the host's "Press to start co-op" launch decision, then confirm BOTH clients now
    // hold their stable-seat binding (the guest binds only in response to this press).
    await this.host.pulseActionUntil(/SEND resumeStartNew/u, "host-confirm-fresh-run");
    await this.completePairingBinding();
    const hostEntrySurface = await this.host.evidence.waitForCondition(
      sink =>
        sink.find(CHALLENGE_PHASE, phaseCursors[this.host.label])
        ?? sink.find(STARTER_PHASE, phaseCursors[this.host.label]),
      {
        timeoutMs: this.config.timeoutMs,
        description: "host challenge or starter surface after committed New Game",
      },
    );
    if (CHALLENGE_PHASE.test(hostEntrySurface.text ?? "")) {
      await this.host.checkpoint("challenge-select-open");
      await this.host.sequence(this.config.keys.challenge, "select-redundant-doubles-only-challenge");
    }
    await Promise.all(
      Object.values(this.clients).map(client =>
        client.evidence.waitFor(STARTER_PHASE, {
          from: phaseCursors[client.label],
          timeoutMs: this.config.timeoutMs,
          description: "SelectStarterPhase after committed New Game",
        }),
      ),
    );
    await Promise.all(Object.values(this.clients).map(client => client.checkpoint("starter-select-open")));
    await Promise.all(
      Object.values(this.clients).map(client => client.sequence(this.config.keys.starter, "select-default-team")),
    );
    await this.guest.evidence.waitFor(/\[coop-runconfig\] guest waiting - requesting runConfig from host/u, {
      from: phaseCursors[this.guest.label],
      timeoutMs: this.config.timeoutMs,
      description: "guest bounded wait for the host difficulty decision",
    });
    await this.host.checkpoint("difficulty-select-open");
    const runConfigCursor = this.host.evidence.cursor();
    await this.host.sequence(this.config.keys.difficulty, "host-select-ace-difficulty");
    await this.host.evidence.waitFor(/\[coop-runconfig\] startRun role=host willBroadcast=true difficulty=/u, {
      from: runConfigCursor,
      timeoutMs: this.config.timeoutMs,
      description: "host authoritative difficulty/runConfig broadcast",
    });
    await Promise.all(
      Object.values(this.clients).map(client =>
        client.evidence.waitFor(/local team locked in:/u, {
          timeoutMs: this.config.timeoutMs,
          description: "public team lock-in",
        }),
      ),
    );
    await Promise.all(
      Object.values(this.clients).map(client => client.waitForLocalCommand(phaseCursors[client.label])),
    );
    const boundary = await this.assertSharedSurface("command", phaseCursors, "fresh-wave-1-command", {
      expectedWave: 1,
    });
    this.activeBattleWave = boundary.wave;
    await Promise.all(Object.values(this.clients).map(client => client.checkpoint("wave-1-command")));
  }

  async resumeRun({ expectedWave = null } = {}) {
    if (!this.host) {
      throw new Error("resumeRun requires a paired public host (call pair() first)");
    }
    // The guest client is the non-host seat; its stable-seat binding is only produced once it
    // accepts the host's resume offer below, so reference it directly until completePairingBinding.
    const guestClient = Object.values(this.clients).find(client => client !== this.host);
    const resumeCursors = Object.fromEntries(
      Object.values(this.clients).map(client => [client.label, client.evidence.cursor()]),
    );
    await this.host.pulseActionUntil(/SEND resumeOffer/u, "host-open-and-confirm-resume");
    await guestClient.evidence.waitFor(/RECV resumeOffer/u, {
      from: resumeCursors[guestClient.label],
      timeoutMs: this.config.timeoutMs,
      description: "guest receives public resume offer",
    });
    await guestClient.press("Space", "guest-open-resume-offer");
    await delay(this.config.settleDelayMs);
    await guestClient.press("Space", "guest-accept-resume-offer");
    await this.completePairingBinding();
    await Promise.all(
      Object.values(this.clients).map(client => client.waitForLocalCommand(resumeCursors[client.label])),
    );
    const boundary = await this.assertSharedSurface("command", resumeCursors, "resumed-command", {
      allowAddressRepeat: true,
      expectedWave,
    });
    this.activeBattleWave = boundary.wave;
    await Promise.all(Object.values(this.clients).map(client => client.checkpoint("resumed-command")));
  }

  async driveWaveToReward({ allowFaint = false } = {}) {
    this.lastWaveCursors = Object.fromEntries(
      Object.values(this.clients).map(client => [client.label, client.evidence.cursor()]),
    );
    let cursors = Object.fromEntries(
      Object.values(this.clients).map(client => [client.label, client.evidence.findLast(LOCAL_COMMAND)?.index ?? 0]),
    );
    for (let turn = 1; turn <= this.config.maxTurns; turn++) {
      await Promise.all(Object.values(this.clients).map(client => client.waitForLocalCommand(cursors[client.label])));
      await Promise.all(Object.values(this.clients).map(client => client.checkpoint(`turn-${turn}-command`)));
      const from = Object.fromEntries(
        Object.values(this.clients).map(client => [client.label, client.evidence.cursor()]),
      );
      await Promise.all(
        Object.values(this.clients).map(client => client.sequence(this.config.keys.battle, `turn-${turn}-first-move`)),
      );

      const outcome = await this.waitForPostTurnOutcome(from);
      if (outcome.kind === "reward") {
        await this.assertSharedSurface("reward", from, `turn-${turn}-reward`, {
          expectedWave: this.activeBattleWave,
        });
        await this.assertRetainedContinuation(from, `turn-${turn}-reward`);
        return turn;
      }
      if (outcome.kind === "faint") {
        if (!allowFaint) {
          throw new Error("Unexpected faint picker in the wave-1 journey; use faint-replacement with prepared saves");
        }
        await this.driveReplacement(outcome.client);
      }
      if (outcome.kind === "command") {
        await this.assertSharedSurface("command", from, `turn-${turn}-next-command`, {
          expectedWave: this.activeBattleWave,
        });
        await this.assertRetainedContinuation(from, `turn-${turn}-next-command`);
      }
      cursors = from;
    }
    throw new Error(`Battle did not reach rewards in ${this.config.maxTurns} public command rounds`);
  }

  async waitForPostTurnOutcome(from) {
    const deadline = Date.now() + this.config.timeoutMs;
    while (Date.now() < deadline) {
      const values = Object.values(this.clients);
      const rewards = values.map(client => client.evidence.find(REWARD_PHASE, from[client.label]));
      if (rewards.every(Boolean)) {
        return { kind: "reward" };
      }
      for (const client of values) {
        if (client.evidence.find(GUEST_FAINT_PICKER, from[client.label])) {
          return { kind: "faint", client };
        }
        if (
          client.label === this.config.faintOwnerSeat
          && client.evidence.find(HOST_SWITCH_PHASE, from[client.label])
        ) {
          return { kind: "faint", client };
        }
      }
      const commands = values.map(client => client.evidence.find(LOCAL_COMMAND, from[client.label]));
      if (commands.every(Boolean)) {
        return { kind: "command" };
      }
      await delay(100);
    }
    throw new Error("Timed out waiting for public post-turn command, faint, or reward evidence");
  }

  async driveReplacement(client = null) {
    let owner = client;
    if (!owner) {
      owner = this.client(this.config.faintOwnerSeat);
      await owner.evidence.waitFor(HOST_SWITCH_PHASE, {
        timeoutMs: this.config.timeoutMs,
        description: "configured owner SwitchPhase for faint replacement",
      });
    }
    await owner.checkpoint("faint-replacement-picker");
    const replacementCursor = owner.evidence.cursor();
    await owner.sequence(this.config.keys.replacement, "choose-first-legal-replacement");
    await owner.evidence.waitFor(/faint picker PICK|Start Phase SwitchSummonPhase/u, {
      from: replacementCursor,
      timeoutMs: this.config.timeoutMs,
      description: "replacement pick/summon evidence",
    });
    this.replacementCount += 1;
    await Promise.all(Object.values(this.clients).map(value => value.checkpoint("replacement-applied")));
  }

  async leaveRewardsAndReachWave2() {
    const values = Object.values(this.clients);
    const ownerCursors =
      this.lastWaveCursors ?? Object.fromEntries(values.map(client => [client.label, client.pageCursor]));
    const owner = await values[0].evidence.waitForCondition(
      () => values.find(client => client.evidence.find(REWARD_OWNER, ownerCursors[client.label])),
      { timeoutMs: this.config.timeoutMs, description: "reward owner public UI" },
    );
    await owner.checkpoint("reward-owner-screen");
    const commandCursors = Object.fromEntries(values.map(client => [client.label, client.evidence.cursor()]));
    await owner.sequence(this.config.keys.rewardLeave, "leave-reward-screen");
    await Promise.all(values.map(client => client.waitForLocalCommand(commandCursors[client.label])));
    const expectedWave = this.activeBattleWave == null ? null : this.activeBattleWave + 1;
    const boundary = await this.assertSharedSurface("command", commandCursors, "wave-2-command", {
      expectedWave,
    });
    this.activeBattleWave = boundary.wave;
    await Promise.all(values.map(client => client.checkpoint("wave-2-command")));
    // A successful fresh wave boundary creates Continue above New Game on the next
    // public title menu. Treat that visible layout change as a journey postcondition.
    for (const client of values) {
      client.titleNewGameKeys = ["ArrowDown"];
    }
  }

  async coldReopenAndPair(requesterSeat) {
    await this.stopChromeTrace();
    await Promise.all(Object.values(this.clients).map(client => client.reopen()));
    await this.loginBoth();
    await this.pair(requesterSeat);
  }

  async close() {
    await this.stopChromeTrace().catch(() => {});
    for (const client of Object.values(this.clients)) {
      await client.checkpoint("final").catch(() => {});
      await client.evidence.flush().catch(() => {});
    }
    await this.browser.close();
  }

  assertClean() {
    for (const client of Object.values(this.clients)) {
      client.evidence.assertClean();
    }
  }
}
