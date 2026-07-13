/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import puppeteer from "puppeteer";
import { delay, EvidenceSink } from "./evidence.mjs";

const TITLE_PHASE = /Start Phase TitlePhase/u;
const LOGIN_PHASE = /Start Phase LoginPhase/u;
const STARTER_PHASE = /Start Phase SelectStarterPhase/u;
const LOCAL_COMMAND = /CommandPhase .*-> LOCAL UI/u;
const REWARD_PHASE = /Start Phase SelectModifierPhase/u;
const REWARD_OWNER = /OWNER drives reward screen/u;
const GUEST_FAINT_PICKER = /guest own-faint picker OPEN/u;
const HOST_SWITCH_PHASE = /Start Phase SwitchPhase/u;

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
    this.titleNewGameKeys = [
      ...(this.label === "host-seat" ? config.keys.titleNewGame.hostSeat : config.keys.titleNewGame.guestSeat),
    ];
    this.evidence = new EvidenceSink(this.label, config.artifactDir, config.allowedConsoleErrors);
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
    this.page = await this.context.newPage();
    await this.page.setViewport(this.config.viewport);
    await this.page.setCacheEnabled(false);
    this.evidence.attach(this.page);
    this.evidence.record("navigate", { url: new URL(this.config.baseUrl).origin });
    await this.page.goto(this.config.baseUrl, { waitUntil: "domcontentloaded", timeout: this.config.timeoutMs });
    await this.page.waitForSelector("#app canvas", { timeout: this.config.timeoutMs });
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
      timeoutMs: this.config.timeoutMs,
      description: "public LoginPhase",
    });
    await delay(this.config.settleDelayMs);
    const autoTitle = this.evidence.find(TITLE_PHASE, this.pageCursor);
    if (autoTitle) {
      return autoTitle;
    }

    // LOGIN_OR_REGISTER selects Login by default. This is a real keyboard action against the canvas UI.
    await this.press("Space", "open-login-form");
    await this.page.waitForFunction(
      () => document.querySelectorAll('input[type="text"], input[type="password"]').length >= 2,
      { timeout: this.config.timeoutMs },
    );
    await this.fillLoginForm();
    const entered = await this.evidence.waitFor(TITLE_PHASE, {
      from: this.pageCursor,
      timeoutMs: this.config.timeoutMs,
      description: "TitlePhase after visible login form submission",
    });
    await delay(this.config.settleDelayMs);
    return entered;
  }

  async fillLoginForm() {
    const usernameInput = await this.page.$('input[type="text"]');
    const passwordInput = await this.page.$('input[type="password"]');
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

  async press(key, purpose, { blurInputs = true } = {}) {
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
    await this.evidence.waitForCondition(sink => sink.networkState.lobby?.request === username, {
      timeoutMs: this.config.timeoutMs,
      description: `visible incoming request from ${username}`,
    });
    await this.press("Space", `lobby-accept-${username}`);
  }

  async waitForPublicRole(from = this.pageCursor) {
    const event = await this.evidence.waitFor(/lobby connected code=.* role=(?:host|guest)/u, {
      from,
      timeoutMs: this.config.timeoutMs,
      description: "lobby connected role log",
    });
    const match = /role=(host|guest)/u.exec(event.text);
    this.publicRole = match?.[1] ?? null;
    if (!this.publicRole) {
      throw new Error(`${this.label}: connected without an observable public role`);
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
    return this.evidence.waitFor(LOCAL_COMMAND, {
      from,
      timeoutMs: this.config.timeoutMs,
      description: "owned CommandPhase public UI",
    });
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
    await Promise.all(Object.values(this.clients).map(client => client.waitForPublicRole(roleCursors[client.label])));
    if (requester.publicRole !== "guest" || acceptor.publicRole !== "host") {
      throw new Error(
        `Lobby role contract changed: requester=${requester.publicRole}, acceptor=${acceptor.publicRole}`,
      );
    }
    await Promise.all(Object.values(this.clients).map(client => client.checkpoint("paired-and-verifying-save")));
    return { requester, acceptor };
  }

  async startFreshRun() {
    if (!this.host || !this.guest) {
      throw new Error("startFreshRun requires a paired public host and guest");
    }
    const phaseCursors = Object.fromEntries(
      Object.values(this.clients).map(client => [client.label, client.evidence.cursor()]),
    );
    await this.host.pulseActionUntil(/SEND resumeStartNew/u, "host-confirm-fresh-run");
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
    await Promise.all(Object.values(this.clients).map(client => client.checkpoint("wave-1-command")));
  }

  async resumeRun() {
    if (!this.host || !this.guest) {
      throw new Error("resumeRun requires a paired public host and guest");
    }
    const resumeCursors = Object.fromEntries(
      Object.values(this.clients).map(client => [client.label, client.evidence.cursor()]),
    );
    await this.host.pulseActionUntil(/SEND resumeOffer/u, "host-open-and-confirm-resume");
    await this.guest.evidence.waitFor(/RECV resumeOffer/u, {
      from: resumeCursors[this.guest.label],
      timeoutMs: this.config.timeoutMs,
      description: "guest receives public resume offer",
    });
    await this.guest.press("Space", "guest-open-resume-offer");
    await delay(this.config.settleDelayMs);
    await this.guest.press("Space", "guest-accept-resume-offer");
    await Promise.all(
      Object.values(this.clients).map(client => client.waitForLocalCommand(resumeCursors[client.label])),
    );
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
        return turn;
      }
      if (outcome.kind === "faint") {
        if (!allowFaint) {
          throw new Error("Unexpected faint picker in the wave-1 journey; use faint-replacement with prepared saves");
        }
        await this.driveReplacement(outcome.client);
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
