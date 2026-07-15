/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import puppeteer from "puppeteer";
import { createBattlePromptAdvancer } from "./campaign.mjs";
import {
  confirmDefaultStarterTeam,
  confirmSeededStarterTeam,
  selectOptionById,
  waitForSemanticSurface,
} from "./campaign-nav.mjs";
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
const SHARED_SESSION_TERMINAL = /\[coop:runtime\] shared session (?:terminal requested|stopped safely):/u;
const LAUNCH_SNAPSHOT_ABORT = /launchSnapshotAbort wave=\d+ reason=/u;
const POST_TURN_PHASE_PROGRESS = /Start Phase ([A-Za-z0-9]+Phase)/u;
const POST_TURN_AUTHORITY_PROGRESS = /\[coop:turn\] host recorder: append turn=\d+ seq=(\d+)/u;
const POST_TURN_RENDERER_PROGRESS = /\[coop:replay\] guest replay turn=\d+: live increment seq=(\d+)\.\.(\d+)/u;
const REWARD_RESULT_RETAINED = /reward authoritative RESULT retained rev=(\d+) tick=(\d+) id=([^\s]+)/u;
const FATAL_COOP_RECOVERY = /Co-op Sync Recovery|recovery request attempt=|recovery EXHAUSTED|could not converge/iu;
const RENDEZVOUS_RECOVERY_RETRY_POINT = /\[coop:rendezvous\] RENDEZVOUS RECOVERY RETRY point=([^\s]+) after \d+ms/u;
const TATSUGIRI_SPECIES_ID = 978;
const DONDOZO_SPECIES_ID = 977;
const MAGIKARP_SPECIES_ID = 129;
const BULBASAUR_SPECIES_ID = 1;
const POST_TURN_PROGRESS_ALLOWANCE_MS = 90_000;
const POST_TURN_HARD_CEILING_MS = 360_000;
// Trace-enabled four-core run 29405818635 reached the matching cmd:1:1 observations 0.45s and
// 1.05s after the ordinary ceiling across the two owner parities, with causal Phaser progress.
// Keep that measured launch allowance Commander-only; ordinary waits retain the tighter ceiling.
const COMMANDER_BOUNDARY_HARD_CEILING_MS = 420_000;
// Independent-process guest-owned run 29427072889 made real replay progress again after a measured
// ~100s animation gap. Keep Commander waits alive across that observed dilation while retaining the
// immutable seven-minute ceiling above; ordinary battle waits remain at the tighter 90s allowance.
const COMMANDER_POST_TURN_PROGRESS_ALLOWANCE_MS = 150_000;

// Self-healing pairing cadence: how often the requester re-issues its ask while unpaired. Kept
// well under the observed ~17s worker-side request TTL so each re-send REFRESHES the request and
// keeps the acceptance window open until the accept lands (see driveSelfHealingPairing).
const LOBBY_REQUEST_REISSUE_MS = 5_000;

function classifyPostTurnProgress(event) {
  if (
    event.kind === "browser-surface2"
    && ["battle-progress", "command", "reward"].includes(event.observation?.operationClass)
  ) {
    const observation = event.observation;
    return `${observation.surfaceId}:phase-${observation.phaseInstance}:ready-${
      observation.ready?.awaitingActionInput === true
    }`;
  }
  const text = event.text ?? "";
  const phase = POST_TURN_PHASE_PROGRESS.exec(text);
  if (phase) {
    return `phase:${phase[1]}`;
  }
  const authority = POST_TURN_AUTHORITY_PROGRESS.exec(text);
  if (authority) {
    return `authority-seq:${authority[1]}`;
  }
  const renderer = POST_TURN_RENDERER_PROGRESS.exec(text);
  if (renderer) {
    return `renderer-seq:${renderer[1]}-${renderer[2]}`;
  }
  return null;
}

function postTurnProgressAt(event, startedAtMs, observedAtMs) {
  const parsedAtMs = Date.parse(event.at ?? "");
  return Number.isFinite(parsedAtMs) ? Math.min(Math.max(parsedAtMs, startedAtMs), observedAtMs) : observedAtMs;
}

function latestPostTurnProgress(client, events, startedAtMs, observedAtMs, seenSemanticProgress) {
  return events.reduce((latest, event) => {
    const progress = classifyPostTurnProgress(event);
    if (progress == null) {
      return latest;
    }
    // The semantic observer republishes when selection/readiness detail changes. Those are useful
    // projections, but the same client/surface/phase-instance/readiness tuple is still one causal
    // transition and must not repeatedly buy another 90 seconds. Console phase markers are not
    // deduplicated here because the same phase class can legitimately recur within a battle.
    if (event.kind === "browser-surface2") {
      const semanticProgressToken = `${client.label}:${progress}`;
      if (seenSemanticProgress.has(semanticProgressToken)) {
        return latest;
      }
      seenSemanticProgress.add(semanticProgressToken);
    }
    const eventAtMs = postTurnProgressAt(event, startedAtMs, observedAtMs);
    if (latest != null && eventAtMs < latest.eventAtMs) {
      return latest;
    }
    return { client, event, eventAtMs, progress };
  }, null);
}

function recordPostTurnBudgetExtension(progress, previousDeadlineMs, deadlineMs, hardDeadlineMs) {
  progress.client.evidence.record("public-ui-post-turn-progress-budget", {
    progress: progress.progress,
    progressEventIndex: progress.event.index,
    progressObservedAt: progress.event.at ?? null,
    previousDeadlineAt: new Date(previousDeadlineMs).toISOString(),
    extendedDeadlineAt: new Date(deadlineMs).toISOString(),
    hardDeadlineAt: new Date(hardDeadlineMs).toISOString(),
    hardCeilingReached: deadlineMs === hardDeadlineMs,
  });
}

/**
 * Keep public command/post-turn waits alive only while the real addressed battle is making causal
 * progress. Two Chromium game loops can heavily dilate launch and animations on the standard
 * four-core runner; runs 29330330915 and 29332163279 reached real command/narration surfaces after
 * the ordinary timeout. Phase transitions, new authoritative turn events, renderer sequence
 * increments, and semantic command/battle-prompt instances may extend the soft deadline, but
 * signaling heartbeats/retries may not. The immutable hard deadline still makes every wait terminate.
 */
export function createPublicBattleProgressBudget(
  rig,
  from,
  baseTimeoutMs,
  {
    now = () => Date.now(),
    progressAllowanceMs = POST_TURN_PROGRESS_ALLOWANCE_MS,
    hardCeilingMs = POST_TURN_HARD_CEILING_MS,
  } = {},
) {
  const clients = Object.values(rig.clients);
  const startedAtMs = now();
  const hardDeadlineMs = startedAtMs + Math.max(baseTimeoutMs, hardCeilingMs);
  let deadlineMs = Math.min(startedAtMs + baseTimeoutMs, hardDeadlineMs);
  const scanOffsets = new Map(clients.map(client => [client.label, from[client.label] ?? 0]));
  const seenSemanticProgress = new Set();

  const observe = () => {
    const observedAtMs = now();
    const candidates = clients.flatMap(client => {
      const scanFrom = scanOffsets.get(client.label) ?? 0;
      const events = client.evidence.events.slice(scanFrom);
      scanOffsets.set(client.label, client.evidence.events.length);
      const latest = latestPostTurnProgress(client, events, startedAtMs, observedAtMs, seenSemanticProgress);
      return latest == null ? [] : [latest];
    });
    const latestProgress = candidates.toSorted((left, right) => left.eventAtMs - right.eventAtMs).at(-1) ?? null;

    if (latestProgress != null) {
      const previousDeadlineMs = deadlineMs;
      deadlineMs = Math.min(hardDeadlineMs, Math.max(deadlineMs, latestProgress.eventAtMs + progressAllowanceMs));
      if (deadlineMs > previousDeadlineMs) {
        recordPostTurnBudgetExtension(latestProgress, previousDeadlineMs, deadlineMs, hardDeadlineMs);
      }
    }
    return deadlineMs;
  };

  return Object.freeze({
    observe,
    deadline: () => deadlineMs,
    hardDeadline: () => hardDeadlineMs,
  });
}

function findOwnedCommandOrTerminal(client, from) {
  const semantic = client.evidence.findLastSemanticSurface(from, "command:command");
  const ownedSemantic =
    semantic?.observation.ready?.handlerActive === true
    && semantic.observation.phase === "CommandPhase"
    && semantic.observation.uiMode === "COMMAND"
    && semantic.observation.localSeat === client.publicSeat
    && semantic.observation.seatsWithInput?.includes(client.publicSeat)
      ? semantic
      : null;
  return (
    ownedSemantic
    ?? client.evidence.find(LOCAL_COMMAND, from)
    ?? client.evidence.find(SHARED_SESSION_TERMINAL, from)
    ?? client.evidence.find(LAUNCH_SNAPSHOT_ABORT, from)
  );
}

/**
 * SelectGenderPhase first exposes its preceding MESSAGE projection, then replaces it with the
 * actionable option picker. Do not spend the one public confirm key until that picker proves its
 * handler, phase instance, options, and local input ownership are all live.
 */
export function findActionableFirstLoginGenderSurface(evidence, from = 0) {
  const event = evidence.findLastSemanticSurface(from, "option-select:SelectGenderPhase");
  const observation = event?.observation;
  if (
    observation?.phase !== "SelectGenderPhase"
    || !Number.isSafeInteger(observation.phaseInstance)
    || observation.phaseInstance < 2
    || observation.uiMode !== "OPTION_SELECT"
    || observation.ready?.handlerActive !== true
    || !observation.seatsWithInput?.includes(0)
    || observation.optionIds?.length !== 2
    || !observation.optionIds.includes("boy")
    || !observation.optionIds.includes("girl")
  ) {
    return null;
  }
  return event;
}

function findOwnedReadyReward(client, from) {
  const semantic = client.evidence.findLastSemanticSurface(from, "reward-shop");
  return semantic?.observation.operationClass === "reward"
    && semantic.observation.ownerModel === "interaction"
    && semantic.observation.phase === "SelectModifierPhase"
    && semantic.observation.uiMode === "MODIFIER_SELECT"
    && semantic.observation.localSeat === client.publicSeat
    && semantic.observation.ownerSeat === client.publicSeat
    && semantic.observation.seatsWithInput?.includes(client.publicSeat)
    && semantic.observation.ready?.handlerActive === true
    && semantic.observation.ready.awaitingActionInput === true
    ? semantic
    : null;
}

function sameAddress(left, right) {
  return left?.epoch === right?.epoch && left?.wave === right?.wave && left?.turn === right?.turn;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function findOwnedRewardConfirm(client, from, expectedAddress) {
  const semantic = client.evidence.findLastSemanticSurface(from);
  return semantic?.observation.surfaceId === "reward:confirm"
    && semantic.observation.operationClass === "reward"
    && semantic.observation.ownerModel === "interaction"
    && semantic.observation.phase === "SelectModifierPhase"
    && semantic.observation.uiMode === "CONFIRM"
    && semantic.observation.localSeat === client.publicSeat
    && semantic.observation.ownerSeat === client.publicSeat
    && semantic.observation.seatsWithInput?.includes(client.publicSeat)
    && semantic.observation.selectedOptionId === "yes"
    && semantic.observation.ready?.handlerActive === true
    && sameAddress(semantic.observation.address, expectedAddress)
    ? semantic
    : null;
}

function findAddressedRewardWatcher(client, from, ownerSeat, expectedAddress) {
  const semantic = client.evidence.findLastSemanticSurface(from, "reward-shop");
  return semantic?.observation.operationClass === "reward"
    && semantic.observation.ownerModel === "interaction"
    && semantic.observation.phase === "SelectModifierPhase"
    && semantic.observation.uiMode === "MODIFIER_SELECT"
    && semantic.observation.localSeat === client.publicSeat
    && semantic.observation.ownerSeat === ownerSeat
    && client.publicSeat !== ownerSeat
    && semantic.observation.seatsWithInput?.includes(ownerSeat)
    && !semantic.observation.seatsWithInput?.includes(client.publicSeat)
    && semantic.observation.ready?.handlerActive === true
    && semantic.observation.ready.awaitingActionInput === false
    && sameAddress(semantic.observation.address, expectedAddress)
    ? semantic
    : null;
}

async function waitForProgressBoundedEvidence(client, from, findEvidence, description, progressBudgetOptions) {
  const clients = { [client.label]: client };
  const progressBudget = createPublicBattleProgressBudget(
    { clients },
    { [client.label]: from },
    client.config.timeoutMs,
    progressBudgetOptions,
  );
  let event = null;
  while (Date.now() < progressBudget.observe()) {
    event = findEvidence();
    if (event != null) {
      break;
    }
    await delay(100);
  }
  // Drain once after the soft/hard deadline check. Under severe browser CPU contention a semantic
  // event can already be buffered when the timer callback finally resumes; discard it only if the
  // bounded wait truly has no matching public evidence.
  event ??= findEvidence();
  if (event == null) {
    throw new Error(`${client.label}: timed out waiting for ${description}`);
  }
  return event;
}

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

function isCrossedLobbyRequestFailure(failure) {
  return failure?.status === 401 && failure.pathname === "/coop/v3/lobby/request";
}

function clearCrossedLobbyRequestFailures(clients) {
  for (const client of clients) {
    const failure = client.evidence.networkState.apiFailure;
    if (!isCrossedLobbyRequestFailure(failure)) {
      continue;
    }
    client.evidence.networkState.apiFailure = null;
    client.evidence.record("driver-api-failure-superseded", {
      ...failure,
      proof: "stable-seat-binding",
    });
  }
}

let publicKeyInputTail = Promise.resolve();
// The Puppeteer page most recently brought to the front, so consecutive same-page presses can
// skip a redundant bringToFront (see withFocusedPublicKeyInput). Module-scoped because the front
// tab is a single browser-wide state shared across both clients.
let lastFrontedPublicPage = null;

function withFocusedPublicKeyInput(page, action) {
  const enqueuedAt = Date.now();
  const focused = publicKeyInputTail.then(async () => {
    const queueWaitMs = Date.now() - enqueuedAt;
    // bringToFront is load-bearing (the game gates input on document.hasFocus()) but it runs on
    // EVERY press and is the prime suspect for the per-keypress latency, which taxes the whole
    // campaign. Skip it when THIS page was the last one fronted - the common case for a run of
    // same-page keys (a battle/between-wave sequence, the reissue loop). If the assumption is
    // wrong (focus was stolen), the caller's focus check calls forceFront() and re-verifies, so
    // the skip can never press into an unfocused page.
    let bringToFrontMs = 0;
    let didFront = false;
    if (lastFrontedPublicPage !== page) {
      const startedAt = Date.now();
      await page.bringToFront();
      bringToFrontMs = Date.now() - startedAt;
      lastFrontedPublicPage = page;
      didFront = true;
    }
    const forceFront = async () => {
      const startedAt = Date.now();
      await page.bringToFront();
      lastFrontedPublicPage = page;
      return Date.now() - startedAt;
    };
    // didFront is true exactly when another page held the front since this page's last press -
    // i.e. the ONLY case its focus could have changed. The caller pays the main-thread focus
    // check / input blur only then; a same-page consecutive press provably keeps focus.
    return action({ queueWaitMs, bringToFrontMs, didFront, forceFront });
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

function comparableCommanderObservation(observation) {
  return {
    commanderOwnerRole: observation.commanderOwnerRole,
    epoch: observation.epoch,
    membershipRevision: observation.membershipRevision,
    connectionGeneration: observation.connectionGeneration,
    wave: observation.wave,
    turn: observation.turn,
    point: observation.point,
    stateDigest: observation.stateDigest,
    commanderPokemonId: observation.commanderPokemonId,
    commanderSpeciesId: observation.commanderSpeciesId,
    commanderBattlerIndex: observation.commanderBattlerIndex,
    commandedPokemonId: observation.commandedPokemonId,
    commandedSpeciesId: observation.commandedSpeciesId,
    commandedBattlerIndex: observation.commandedBattlerIndex,
  };
}

function findSharedCommanderMatch(host, guest, cursors, expectedWave) {
  const hostEvents = host.evidence.events
    .slice(cursors[host.label])
    .filter(event => event.kind === "browser-commander")
    .toReversed();
  const guestEvents = guest.evidence.events
    .slice(cursors[guest.label])
    .filter(event => event.kind === "browser-commander")
    .toReversed();
  for (const hostEvent of hostEvents) {
    const comparable = comparableCommanderObservation(hostEvent.observation);
    if (expectedWave != null && comparable.wave !== expectedWave) {
      continue;
    }
    const canonical = JSON.stringify(comparable);
    const guestEvent = guestEvents.find(
      candidate => JSON.stringify(comparableCommanderObservation(candidate.observation)) === canonical,
    );
    if (guestEvent) {
      return { hostEvent, guestEvent, comparable };
    }
  }
  return null;
}

function findOwnedCommandUi(client, from) {
  const semantic = client.evidence.findLastSemanticSurface(from, "command:command");
  if (
    semantic?.observation.ready?.handlerActive === true
    && semantic.observation.phase === "CommandPhase"
    && semantic.observation.uiMode === "COMMAND"
    && semantic.observation.localSeat === client.publicSeat
    && semantic.observation.seatsWithInput?.includes(client.publicSeat)
  ) {
    return semantic;
  }
  return client.evidence.find(LOCAL_COMMAND, from) ?? null;
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
    // Journey-owned state, learned only after the public authentication flow succeeds. A cold
    // page reopen keeps the browser context and account session, so an already-authenticated
    // player must be given time to reach TitlePhase instead of being driven through Register a
    // second time while the automatic session restore is still loading.
    this.authenticatedOnce = false;
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
    const entryUrl = new URL(this.config.baseUrl);
    if (this.config.journey === "commander-skip") {
      entryUrl.searchParams.set("coopfixture", this.label === this.config.commanderOwnerSeat ? "commander" : "dondozo");
    } else if (this.config.journey === "faint-replacement") {
      entryUrl.searchParams.set(
        "coopfixture",
        this.label === this.config.faintOwnerSeat ? "faint-owner" : "faint-partner",
      );
    }
    this.evidence.record("navigate", { url: entryUrl.origin });
    await this.page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: this.config.bootTimeoutMs });
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
      this.authenticatedOnce = true;
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
      this.authenticatedOnce = true;
      return autoTitle;
    }

    if (this.authenticatedOnce) {
      const restoreDeadline = Date.now() + Math.min(this.config.bootTimeoutMs, 15_000);
      while (Date.now() < restoreDeadline) {
        const restoredTitle = this.evidence.find(TITLE_PHASE, this.pageCursor);
        if (restoredTitle) {
          this.evidence.record("public-session-restored", { proof: "TitlePhase" });
          return restoredTitle;
        }
        if (this.evidence.networkState.account?.username === this.credentials.username) {
          const titleAfterAccountRestore = await this.evidence.waitFor(TITLE_PHASE, {
            from: this.pageCursor,
            timeoutMs: this.config.bootTimeoutMs,
            description: "TitlePhase after restored public account response",
          });
          this.evidence.record("public-session-restored", { proof: "account-view+TitlePhase" });
          return titleAfterAccountRestore;
        }
        await delay(100);
      }
      this.evidence.record("public-session-restore-expired", {
        fallback: "visible-login-form",
        waitedMs: Math.min(this.config.bootTimeoutMs, 15_000),
      });
    }

    if (this.config.accountMode === "register" && !this.authenticatedOnce) {
      await this.openRegistrationForm();
      await this.fillRegistrationForm();
    } else {
      // LOGIN_OR_REGISTER selects Login by default. This is a real keyboard action against the canvas UI.
      await this.press("Space", "open-login-form");
      await this.waitForVisibleInputs({ text: 1, password: 1, purpose: "public login form" });
      await this.fillLoginForm();
    }
    const entered = await this.completePostAuthentication();
    this.authenticatedOnce = true;
    if (TITLE_PHASE.test(entered.text ?? "")) {
      await delay(this.config.settleDelayMs);
      return entered;
    }
    const onboardingCursor = entered.index ?? this.pageCursor;
    await delay(this.config.settleDelayMs);
    const actionableGenderOrTitle = await this.evidence.waitForCondition(
      sink => sink.find(TITLE_PHASE, onboardingCursor) ?? findActionableFirstLoginGenderSurface(sink, onboardingCursor),
      {
        timeoutMs: this.config.bootTimeoutMs,
        description: "actionable first-login gender option surface or TitlePhase",
      },
    );
    if (TITLE_PHASE.test(actionableGenderOrTitle.text ?? "")) {
      return actionableGenderOrTitle;
    }
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
    await this.press("Enter", "submit-registration-form");
    await this.clearDomInputFocus();
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
    await this.press("Enter", "submit-login-form");
    await this.clearDomInputFocus();
  }

  /**
   * Explicitly blur any focused DOM input after credential entry. Per-press blur is gated to
   * (re)fronts (see press), so the credential forms - the only place a DOM input gains focus -
   * clear it deterministically here instead of relying on the next game keystroke to do it.
   */
  async clearDomInputFocus() {
    await this.page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
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

  async press(key, purpose) {
    await withFocusedPublicKeyInput(this.page, async ({ queueWaitMs, bringToFrontMs, didFront, forceFront }) => {
      // The focus check (page.title() + $eval hasFocus) is a MAIN-THREAD call that blocks behind
      // the game loop - measured ~5.5s under 10x CPU load, the dominant per-press cost that starves
      // command input (turn-1 softlock root cause). It is only needed when focus could have changed,
      // i.e. when this page was just (re)fronted. On a same-page consecutive press (didFront ===
      // false) focus provably held, so skip it. DOM inputs are blurred at the credential-entry site
      // (clearDomInputFocus), never per keystroke, so no blur is needed here.
      let focused = true;
      let title = null;
      let focusCheckMs = 0;
      let refrontMs = 0;
      if (didFront) {
        const focusCheckStart = Date.now();
        [title, focused] = await Promise.all([this.page.title(), this.page.$eval("body", () => document.hasFocus())]);
        focusCheckMs = Date.now() - focusCheckStart;
        // Fallback: this page was fronted but did not acquire focus - force it and re-verify.
        if (!focused) {
          refrontMs = await forceFront();
          [title, focused] = await Promise.all([this.page.title(), this.page.$eval("body", () => document.hasFocus())]);
        }
      }
      this.evidence.record("key-target", {
        focused,
        pageGeneration: this.pageGeneration,
        purpose,
        target: `${new URL(this.page.url()).origin}${new URL(this.page.url()).pathname}`,
        title,
        // Per-press latency diagnostics: time on the shared input tail, bringToFront, the focus
        // check, and any fallback re-front. didFront marks whether the costly checks ran at all.
        queueWaitMs,
        bringToFrontMs,
        focusCheckMs,
        refrontMs,
        didFront,
      });
      if (!focused) {
        throw new Error(`${this.label}: public key target did not acquire browser focus for ${purpose}`);
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

  async waitForLocalCommand(from = 0, progressBudgetOptions = {}) {
    const event = await waitForProgressBoundedEvidence(
      this,
      from,
      () => findOwnedCommandOrTerminal(this, from),
      "owned semantic command surface or bounded shared terminal",
      progressBudgetOptions,
    );
    if (event.kind !== "browser-surface2" && !LOCAL_COMMAND.test(event.text ?? "")) {
      throw new Error(`${this.label}: shared session terminated before owned CommandPhase: ${event.text}`);
    }
    return event;
  }

  async waitForOwnedReward(from = 0, progressBudgetOptions = {}) {
    return waitForProgressBoundedEvidence(
      this,
      from,
      () => findOwnedReadyReward(this, from),
      "actionable owned semantic reward surface",
      progressBudgetOptions,
    );
  }

  async waitForOwnedRewardConfirm(from, expectedAddress, progressBudgetOptions) {
    return waitForProgressBoundedEvidence(
      this,
      from,
      () => {
        const terminal =
          this.evidence.find(SHARED_SESSION_TERMINAL, from) ?? this.evidence.find(LAUNCH_SNAPSHOT_ABORT, from);
        if (terminal != null) {
          throw new Error(
            `${this.label}: shared session terminated while waiting for reward confirmation: ${terminal.text}`,
          );
        }
        return findOwnedRewardConfirm(this, from, expectedAddress);
      },
      `actionable reward confirmation at ${expectedAddress.epoch}/${expectedAddress.wave}/${expectedAddress.turn}`,
      progressBudgetOptions,
    );
  }

  async waitForAddressedRewardWatcher(from, ownerSeat, expectedAddress, progressBudgetOptions) {
    return waitForProgressBoundedEvidence(
      this,
      from,
      () => {
        const terminal =
          this.evidence.find(SHARED_SESSION_TERMINAL, from) ?? this.evidence.find(LAUNCH_SNAPSHOT_ABORT, from);
        if (terminal != null) {
          throw new Error(
            `${this.label}: shared session terminated while waiting for the reward watcher: ${terminal.text}`,
          );
        }
        return findAddressedRewardWatcher(this, from, ownerSeat, expectedAddress);
      },
      `non-actionable reward watcher at ${expectedAddress.epoch}/${expectedAddress.wave}/${expectedAddress.turn}`,
      progressBudgetOptions,
    );
  }

  async waitForObservedSurface(surface, from = 0) {
    return this.evidence.waitForSurface(surface, { from, timeoutMs: this.config.timeoutMs });
  }
}

export class DuoPublicUiRig {
  constructor(browsers, config) {
    this.browsers = browsers;
    this.config = config;
    this.clients = {};
    this.tracePage = null;
    this.traceGeneration = 0;
    this.replacementCount = 0;
    this.lastSharedSurfaceAddress = new Map();
    this.activeBattleWave = null;
    this.pairRoleCursors = null;
  }

  async waitForAllLocalCommandsDrivingBattlePrompts(from, purpose) {
    const clients = Object.values(this.clients);
    const progressBudget = createPublicBattleProgressBudget(this, from, this.config.timeoutMs);
    const advanceBattlePrompt = createBattlePromptAdvancer(this, from, {}, purpose, {
      requireSharedCommandAddress: false,
    });
    while (Date.now() < progressBudget.observe()) {
      if (clients.every(client => findOwnedCommandOrTerminal(client, from[client.label]) != null)) {
        break;
      }
      if (await advanceBattlePrompt()) {
        continue;
      }
      await delay(100);
    }
    for (const client of clients) {
      const event = findOwnedCommandOrTerminal(client, from[client.label]);
      if (event == null) {
        throw new Error(`${client.label}: timed out waiting for owned command while ${purpose}`);
      }
      if (event.kind !== "browser-surface2" && !LOCAL_COMMAND.test(event.text ?? "")) {
        throw new Error(`${client.label}: shared session terminated before owned CommandPhase: ${event.text}`);
      }
    }
  }

  /**
   * Advance only readiness-proven public battle prompts until both clients publish the same
   * Commander boundary. Unlike the ordinary command-frontier driver, this must not require an
   * owned command UI from both clients: Tatsugiri's owner automatically contributes its generated
   * skip, while only Dondozo's owner receives public command input.
   */
  async waitForCommanderCommandBoundaryDrivingBattlePrompts(cursors, purpose, { expectedWave = null } = {}) {
    if (!this.host || !this.guest) {
      throw new Error(`${purpose}: Commander prompt advancement requires a paired host and guest`);
    }
    const clients = Object.values(this.clients);
    const progressBudget = createPublicBattleProgressBudget(this, cursors, this.config.timeoutMs, {
      hardCeilingMs: COMMANDER_BOUNDARY_HARD_CEILING_MS,
    });
    const advanceBattlePrompt = createBattlePromptAdvancer(this, cursors, {}, purpose, {
      requireSharedCommandAddress: false,
    });
    while (Date.now() < progressBudget.observe()) {
      for (const client of clients) {
        const terminal =
          client.evidence.find(SHARED_SESSION_TERMINAL, cursors[client.label])
          ?? client.evidence.find(LAUNCH_SNAPSHOT_ABORT, cursors[client.label]);
        if (terminal != null) {
          throw new Error(`${purpose}: ${client.label} terminated before the Commander boundary: ${terminal.text}`);
        }
      }
      if (findSharedCommanderMatch(this.host, this.guest, cursors, expectedWave) != null) {
        return this.assertCommanderCommandBoundary(cursors, purpose, { expectedWave });
      }
      if (await advanceBattlePrompt()) {
        continue;
      }
      await delay(100);
    }
    throw new Error(`${purpose}: timed out driving public battle prompts to the shared Commander boundary`);
  }

  assertNoFatalRecoverySince(cursors, purpose) {
    for (const client of Object.values(this.clients)) {
      const recovery =
        client.evidence.find(FATAL_COOP_RECOVERY, cursors[client.label])
        ?? client.evidence.find(SHARED_SESSION_TERMINAL, cursors[client.label])
        ?? client.evidence.find(LAUNCH_SNAPSHOT_ABORT, cursors[client.label]);
      if (recovery != null) {
        throw new Error(`${purpose}: ${client.label} entered fatal recovery/terminal: ${recovery.text}`);
      }
    }
  }

  /**
   * A retained rendezvous retransmission is healthy only when it targets the exact Commander point
   * that both browsers subsequently matched. Record the count for diagnosis while rejecting a
   * malformed or unrelated retry; the caller already proved eventual exact address/digest convergence.
   */
  assertCommanderRetriesConverged(cursors, purpose, expectedPoint) {
    for (const client of Object.values(this.clients)) {
      const retries = [];
      for (const event of client.evidence.events.slice(cursors[client.label])) {
        const text = event.text ?? "";
        if (!text.includes("RENDEZVOUS RECOVERY RETRY")) {
          continue;
        }
        const match = RENDEZVOUS_RECOVERY_RETRY_POINT.exec(text);
        if (match?.[1] !== expectedPoint) {
          throw new Error(`${purpose}: ${client.label} retried an unexpected rendezvous point: ${text}`);
        }
        retries.push(event);
      }
      client.evidence.record("commander-rendezvous-retry-converged-proof", {
        purpose,
        point: expectedPoint,
        retryCount: retries.length,
        retryEvidenceIndices: retries.map(event => event.index),
        outcome: "exact-address-and-digest-converged",
      });
    }
  }

  /**
   * Prove both built clients observe the same Commander command boundary while only Dondozo's
   * owner exposes an actionable command UI. The observation is read-only and never drives input.
   */
  async assertCommanderCommandBoundary(cursors, purpose, { expectedWave = null } = {}) {
    if (!this.host || !this.guest) {
      throw new Error(`${purpose}: Commander proof requires a paired host and guest`);
    }
    const match = await this.host.evidence.waitForCondition(
      () => findSharedCommanderMatch(this.host, this.guest, cursors, expectedWave),
      {
        timeoutMs: this.config.timeoutMs,
        description: `${purpose} shared Commander address/digest`,
      },
    );
    const observation = match.comparable;
    if (
      observation.commanderSpeciesId !== TATSUGIRI_SPECIES_ID
      || observation.commandedSpeciesId !== DONDOZO_SPECIES_ID
    ) {
      throw new Error(
        `${purpose}: fixture did not materialize Tatsugiri Commander + commanded Dondozo: ${JSON.stringify(observation)}`,
      );
    }
    const owner = this.client(this.config.commanderOwnerSeat);
    if (owner.publicRole !== observation.commanderOwnerRole) {
      throw new Error(
        `${purpose}: configured Commander owner ${owner.label}/${owner.publicRole} disagrees with ${observation.commanderOwnerRole}`,
      );
    }
    const actor = Object.values(this.clients).find(client => client !== owner);
    const actionable = await actor.evidence.waitForCondition(() => findOwnedCommandUi(actor, cursors[actor.label]), {
      timeoutMs: this.config.timeoutMs,
      description: `${purpose} public Dondozo command UI`,
    });
    const unexpectedOwnerUi = findOwnedCommandUi(owner, cursors[owner.label]);
    if (unexpectedOwnerUi != null) {
      throw new Error(`${purpose}: Commander owner ${owner.label} incorrectly exposed a public command UI`);
    }
    this.assertNoFatalRecoverySince(cursors, purpose);
    this.assertCommanderRetriesConverged(cursors, purpose, observation.point);
    for (const client of Object.values(this.clients)) {
      client.evidence.record("shared-commander-boundary-proof", {
        purpose,
        observation,
        commanderOwnerLabel: owner.label,
        dondozoActorLabel: actor.label,
        actionableEvidenceIndex: actionable.index,
      });
    }
    return { actor, owner, observation, cursors };
  }

  /** Prove the hidden, locally owned generated skip used the real reciprocal cmd rendezvous. */
  async assertCommanderGeneratedSkipRendezvous(boundary, purpose) {
    const pointPattern = new RegExp(
      `next-command barrier (?:ARRIVE\\+AWAIT )?${escapeRegExp(boundary.observation.point)}(?: |$)`,
      "u",
    );
    const [ownerBarrier, actorBarrier] = await Promise.all([
      boundary.owner.evidence.waitFor(pointPattern, {
        from: boundary.cursors[boundary.owner.label],
        timeoutMs: this.config.timeoutMs,
        description: `${purpose} Commander-owner generated-skip rendezvous`,
      }),
      boundary.actor.evidence.waitFor(pointPattern, {
        from: boundary.cursors[boundary.actor.label],
        timeoutMs: this.config.timeoutMs,
        description: `${purpose} Dondozo-owner reciprocal rendezvous`,
      }),
    ]);
    if (findOwnedCommandUi(boundary.owner, boundary.cursors[boundary.owner.label]) != null) {
      throw new Error(`${purpose}: Commander owner exposed input while proving its automatic skip`);
    }
    this.assertNoFatalRecoverySince(boundary.cursors, purpose);
    boundary.owner.evidence.record("commander-generated-skip-rendezvous-proof", {
      purpose,
      point: boundary.observation.point,
      side: "automatic-skip",
      evidenceIndex: ownerBarrier.index,
    });
    boundary.actor.evidence.record("commander-generated-skip-rendezvous-proof", {
      purpose,
      point: boundary.observation.point,
      side: "public-command",
      evidenceIndex: actorBarrier.index,
    });
  }

  static async launch(config) {
    const launchBrowser = () =>
      puppeteer.launch({
        headless: config.headless,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--autoplay-policy=no-user-gesture-required",
          "--use-fake-ui-for-media-stream",
          // Each player owns an independent Chrome process. A single process made one real renderer
          // share browser-global focus and scheduling with the other: run 29421978972 took minutes to
          // drain Summon/PostSummon while the peer waited at cmd:1:1. Separate processes match two
          // players on two devices and prevent bringToFront for one seat from backgrounding its peer.
          // Keep the background flags as a second guard for OS-level occlusion on hosted runners.
          "--mute-audio",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
        ],
      });
    const launchResults = await Promise.allSettled([launchBrowser(), launchBrowser()]);
    const browsers = launchResults.flatMap(result => (result.status === "fulfilled" ? [result.value] : []));
    const launchFailure = launchResults.find(result => result.status === "rejected");
    if (launchFailure) {
      await Promise.allSettled(browsers.map(browser => browser.close()));
      throw launchFailure.reason;
    }
    const [hostBrowser, guestBrowser] = browsers;
    const rig = new DuoPublicUiRig(browsers, config);
    try {
      const [hostContext, guestContext] = await Promise.all([
        hostBrowser.createBrowserContext(),
        guestBrowser.createBrowserContext(),
      ]);
      if (hostBrowser === guestBrowser || hostContext === guestContext) {
        throw new Error("Puppeteer did not isolate both players into distinct browser processes and contexts");
      }
      rig.clients["host-seat"] = new PublicUiClient(hostContext, config.credentials.hostSeat, config);
      rig.clients["guest-seat"] = new PublicUiClient(guestContext, config.credentials.guestSeat, config);
      await Promise.all(Object.values(rig.clients).map(client => client.init()));
      return rig;
    } catch (error) {
      await Promise.allSettled(browsers.map(browser => browser.close()));
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
    // Navigate the requester's cursor onto the acceptor and send the FIRST request. This parks
    // the OPTION_SELECT cursor on the acceptor's "Ask ... to play" row, so a bare Space re-issues
    // the same request without re-navigating.
    await requester.requestPlayer(acceptor.credentials.username);
    // The co-op HOST binds from the WebRTC session connect (sessionEpoch>0). The co-op GUEST
    // only binds AFTER the host fires its LAUNCH DECISION ("Press to start co-op" ->
    // sendResumeStartNew / resume offer), which the journey (startFreshRun/resumeRun) drives
    // next. Identify the host here; the guest binding + full role/seat verification is deferred
    // to completePairingBinding() AFTER that human launch press - otherwise we deadlock waiting
    // for a binding that only the launch action produces.
    this.pairRoleCursors = roleCursors;
    await this.driveSelfHealingPairing(requester, acceptor, roleCursors);
    await Promise.all(Object.values(this.clients).map(client => client.checkpoint("paired-awaiting-launch")));
    return { requester, acceptor };
  }

  /**
   * Self-healing lobby pairing, driven until the HOST publishes its stable-seat binding.
   *
   * A single "wait for the request, press Accept once" is fragile: the incoming request has a
   * finite worker-side lifetime (~17s) and only surfaces on the acceptor's poll cadence, so one
   * slow accept can land after the request has already evaporated - `respond()` then early-returns
   * (its `incomingRequestId` is null) and NO accept is ever sent, leaving both clients polling
   * forever (the observed 7ms-miss failure). Instead, loop both sides to remove the luck:
   *   - ACCEPTOR: the instant an incoming request FROM the requester is visible, press Space
   *     (Accept is option 0 of the take-over panel). Press once per distinct appearance; if it
   *     evaporates and returns, accept again.
   *   - REQUESTER: whenever no request is in flight, re-press Space to re-issue the ask. `request()`
   *     re-sends unconditionally (no pending guard), which REFRESHES the worker-side request TTL,
   *     keeping the acceptance window open until the accept lands.
   * Exits when either client observes a role=host binding; throws (same message as before) on the
   * pairing deadline so a genuine never-binds still fails loudly.
   */
  async driveSelfHealingPairing(requester, acceptor, roleCursors) {
    const requesterName = requester.credentials.username;
    const acceptorName = acceptor.credentials.username;
    const deadline = Date.now() + this.config.timeoutMs;
    let acceptedForLiveRequest = false;
    let nextReissueAt = Date.now() + LOBBY_REQUEST_REISSUE_MS;
    let supersededRequestFailure = null;
    while (Date.now() < deadline) {
      for (const client of Object.values(this.clients)) {
        const failure = client.evidence.networkState.apiFailure;
        if (isCrossedLobbyRequestFailure(failure)) {
          // Reciprocal requests can cross: one request consumes the lobby credential and creates
          // the match while the other in-flight request receives 401. Do not call that a pass;
          // keep driving until the public stable-seat binding proves the match won the race. If no
          // binding arrives by the deadline, surface this exact failure below.
          supersededRequestFailure = { client: client.label, ...failure };
        } else {
          assertNoDriverApiFailure(client.evidence, "co-op lobby");
        }
        const binding = client.evidence.findBinding(roleCursors[client.label]);
        if (binding) {
          client.publicRole = binding.observation.role;
          client.publicSeat = binding.observation.seat;
          if (binding.observation.role === "host") {
            clearCrossedLobbyRequestFailures(Object.values(this.clients));
            return client;
          }
        }
      }
      const incoming = acceptor.evidence.networkState.lobby?.request ?? null;
      if (incoming === requesterName) {
        if (!acceptedForLiveRequest) {
          await acceptor.press("Space", `lobby-accept-${requesterName}`);
          acceptedForLiveRequest = true;
        }
      } else {
        acceptedForLiveRequest = false;
        if (Date.now() >= nextReissueAt) {
          await requester.press("Space", `lobby-reissue-request-${acceptorName}`);
          nextReissueAt = Date.now() + LOBBY_REQUEST_REISSUE_MS;
        }
      }
      await delay(150);
    }
    if (supersededRequestFailure != null) {
      throw new Error(
        `${supersededRequestFailure.client}: lobby request credential failed without a later stable-seat binding `
          + `(${supersededRequestFailure.status} ${supersededRequestFailure.pathname})`,
      );
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

  async assertRetainedRewardTerminal(cursors, expectedAddress, ownerSeat) {
    if (!this.host || !this.guest) {
      throw new Error("retained reward terminal proof requires a paired host and guest");
    }
    const retained = await this.host.evidence.waitFor(REWARD_RESULT_RETAINED, {
      from: cursors[this.host.label],
      timeoutMs: this.config.timeoutMs,
      description: "host retained complete reward terminal result",
    });
    const retainedMatch = REWARD_RESULT_RETAINED.exec(retained.text);
    if (!retainedMatch) {
      throw new Error("host emitted malformed retained reward terminal evidence");
    }
    const [, revision, tick, operationId] = retainedMatch;
    const expectedOperationPrefix = `${expectedAddress.epoch}:${ownerSeat}:REWARD:`;
    if (!operationId.startsWith(expectedOperationPrefix)) {
      throw new Error(`reward terminal operation ${operationId} is not addressed to ${expectedOperationPrefix}`);
    }
    const escapedOperationId = escapeRegExp(operationId);
    const [hostTerminal, guestApplied, guestMaterialized] = await Promise.all([
      this.host.evidence.waitFor(
        new RegExp(`OWNER retained terminal before continuation seq=\\d+ id=${escapedOperationId}`, "u"),
        {
          from: cursors[this.host.label],
          timeoutMs: this.config.timeoutMs,
          description: `host retained reward terminal ${operationId}`,
        },
      ),
      this.guest.evidence.waitFor(
        new RegExp(
          `shop authoritative RESULT applied-before-render kind=REWARD id=${escapedOperationId} rev=${revision} tick=${tick}`,
          "u",
        ),
        {
          from: cursors[this.guest.label],
          timeoutMs: this.config.timeoutMs,
          description: `guest applied exact retained reward result ${operationId}`,
        },
      ),
      this.guest.evidence.waitFor(
        new RegExp(`reward op WATCHER materialize JOURNAL choice=-1 terminal=true id=${escapedOperationId}`, "u"),
        {
          from: cursors[this.guest.label],
          timeoutMs: this.config.timeoutMs,
          description: `guest materialized exact retained reward terminal ${operationId}`,
        },
      ),
    ]);
    const proof = { operationId, revision: Number(revision), tick: Number(tick), ownerSeat, expectedAddress };
    this.host.evidence.record("retained-reward-terminal-proof", {
      ...proof,
      side: "retained",
      evidenceIndex: hostTerminal.index,
    });
    this.guest.evidence.record("retained-reward-terminal-proof", {
      ...proof,
      side: "applied-and-materialized",
      evidenceIndex: Math.max(guestApplied.index, guestMaterialized.index),
    });
    return proof;
  }

  async startFreshRun({ commanderFixture = false, faintFixture = false } = {}) {
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
    const starterLaunchCursors = Object.fromEntries(
      await Promise.all(
        Object.values(this.clients).map(async client => {
          const expectedSeededSpecies = commanderFixture
            ? [client.label === this.config.commanderOwnerSeat ? TATSUGIRI_SPECIES_ID : DONDOZO_SPECIES_ID]
            : faintFixture
              ? client.label === this.config.faintOwnerSeat
                ? [MAGIKARP_SPECIES_ID, BULBASAUR_SPECIES_ID]
                : [BULBASAUR_SPECIES_ID]
              : null;
          const result =
            expectedSeededSpecies == null
              ? await confirmDefaultStarterTeam(client, { timeoutMs: this.config.timeoutMs })
              : await confirmSeededStarterTeam(client, expectedSeededSpecies, { timeoutMs: this.config.timeoutMs });
          return [client.label, result.launchCursor];
        }),
      ),
    );
    await this.guest.evidence.waitFor(/\[coop-runconfig\] guest waiting - requesting runConfig from host/u, {
      from: starterLaunchCursors[this.guest.label],
      timeoutMs: this.config.timeoutMs,
      description: "guest bounded wait for the host difficulty decision",
    });
    await waitForSemanticSurface(this.host, "option-select:SelectStarterPhase", {
      fromCursor: starterLaunchCursors[this.host.label],
      timeoutMs: this.config.timeoutMs,
    });
    await this.host.checkpoint("difficulty-select-open");
    const runConfigCursor = this.host.evidence.cursor();
    await selectOptionById(this.host, {
      surfaceId: "option-select:SelectStarterPhase",
      targetId: "ace",
      navKeys: ["ArrowUp", "ArrowDown"],
      timeoutMs: this.config.timeoutMs,
    });
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
    if (commanderFixture) {
      const boundary = await this.waitForCommanderCommandBoundaryDrivingBattlePrompts(
        phaseCursors,
        "fresh-wave-1-commander",
        { expectedWave: 1 },
      );
      this.activeBattleWave = boundary.observation.wave;
      this.pendingCommanderBoundary = boundary;
    } else {
      await this.waitForAllLocalCommandsDrivingBattlePrompts(phaseCursors, "fresh-wave-1-intro");
      const boundary = await this.assertSharedSurface("command", phaseCursors, "fresh-wave-1-command", {
        expectedWave: 1,
      });
      this.activeBattleWave = boundary.wave;
    }
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
    await this.waitForAllLocalCommandsDrivingBattlePrompts(resumeCursors, "resume-battle-intro");
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
    let commandCursors = Object.fromEntries(
      Object.values(this.clients).map(client => [client.label, client.evidence.findLast(LOCAL_COMMAND)?.index ?? 0]),
    );
    let pendingCommandProof = null;
    for (let turn = 1; turn <= this.config.maxTurns; turn++) {
      const { outcomeCursors } = await this.driveSequentialCommandRound(
        commandCursors,
        this.config.keys.battle,
        `turn-${turn}-first-move`,
      );
      if (pendingCommandProof != null) {
        await this.assertSharedSurface("command", pendingCommandProof.cursors, pendingCommandProof.name, {
          expectedWave: this.activeBattleWave,
        });
        await this.assertRetainedContinuation(pendingCommandProof.cursors, pendingCommandProof.name);
        pendingCommandProof = null;
      }

      const outcome = await this.waitForPostTurnOutcome(outcomeCursors);
      if (outcome.kind === "reward") {
        await this.assertSharedSurface("reward", outcomeCursors, `turn-${turn}-reward`, {
          expectedWave: this.activeBattleWave,
        });
        await this.assertRetainedContinuation(outcomeCursors, `turn-${turn}-reward`);
        return turn;
      }
      if (outcome.kind === "faint") {
        if (!allowFaint) {
          throw new Error("Unexpected faint picker in the wave-1 journey; use faint-replacement with prepared saves");
        }
        await this.driveReplacement(outcome.client);
      }
      if (outcome.kind === "command") {
        // Command ownership opens sequentially: submitting the first owner's next-turn command is
        // what lets the partner's command UI open. Defer the two-sided convergence proof until the
        // next command round has observed both public surfaces; their evidence remains address-exact.
        pendingCommandProof = { cursors: outcomeCursors, name: `turn-${turn}-next-command` };
      }
      commandCursors = outcomeCursors;
    }
    throw new Error(`Battle did not reach rewards in ${this.config.maxTurns} public command rounds`);
  }

  /**
   * Drive a Commander wave: only Dondozo receives real public input while the hidden Tatsugiri
   * must traverse the same reciprocal cmd barrier automatically on its owning client.
   */
  async driveCommanderWaveToReward() {
    this.lastWaveCursors =
      this.pendingCommanderBoundary?.cursors
      ?? Object.fromEntries(Object.values(this.clients).map(client => [client.label, client.evidence.cursor()]));
    let boundary = this.pendingCommanderBoundary;
    this.pendingCommanderBoundary = null;
    let commandCursors = this.lastWaveCursors;
    let pendingContinuation = null;
    for (let round = 1; round <= this.config.maxTurns; round++) {
      boundary ??= await this.waitForCommanderCommandBoundaryDrivingBattlePrompts(
        commandCursors,
        `commander-turn-${round}`,
        { expectedWave: this.activeBattleWave },
      );
      if (pendingContinuation != null) {
        await this.assertRetainedContinuation(pendingContinuation.cursors, pendingContinuation.name);
        pendingContinuation = null;
      }
      const outcomeCursors = Object.fromEntries(
        Object.values(this.clients).map(client => [client.label, client.evidence.cursor()]),
      );
      await boundary.actor.sequence(
        this.config.keys.battle,
        `commander-${boundary.observation.point}-dondozo-public-move`,
      );
      await this.assertCommanderGeneratedSkipRendezvous(boundary, `commander-${boundary.observation.point}`);
      const outcome = await this.waitForPostTurnOutcome(outcomeCursors, {
        expectedCommandAddress: `${boundary.observation.epoch}:${boundary.observation.wave}:${boundary.observation.turn}`,
        progressBudgetOptions: {
          progressAllowanceMs: COMMANDER_POST_TURN_PROGRESS_ALLOWANCE_MS,
          hardCeilingMs: COMMANDER_BOUNDARY_HARD_CEILING_MS,
        },
      });
      if (outcome.kind === "reward") {
        await this.assertSharedSurface("reward", outcomeCursors, `commander-turn-${round}-reward`, {
          expectedWave: this.activeBattleWave,
        });
        await this.assertRetainedContinuation(outcomeCursors, `commander-turn-${round}-reward`);
        this.assertNoFatalRecoverySince(this.lastWaveCursors, "Commander wave through retained reward");
        return round;
      }
      if (outcome.kind === "faint") {
        throw new Error("Commander public journey reached an unexpected faint replacement");
      }
      pendingContinuation = { cursors: outcomeCursors, name: `commander-turn-${round}-next-command` };
      commandCursors = outcomeCursors;
      boundary = null;
    }
    throw new Error(`Commander battle did not reach rewards in ${this.config.maxTurns} public command rounds`);
  }

  /**
   * Submit one reciprocal co-op command round in the order the real UIs become actionable.
   *
   * The second player's CommandPhase is intentionally gated by the first player's public choice.
   * Waiting for both clients before sending either choice therefore deadlocks a healthy game. This
   * driver observes one owned semantic command surface, submits only that client's configured public
   * key sequence, then observes and submits the partner's surface. No scene/runtime state is read or
   * mutated; the returned cursors exclude these command surfaces so the post-turn outcome cannot
   * mistake the just-submitted round for the next one.
   */
  async driveSequentialCommandRound(from, keys, purpose) {
    const clients = Object.values(this.clients);
    const pending = new Set(clients.map(client => client.label));
    const outcomeCursors = {};
    const commandEvents = {};
    const progressBudget = createPublicBattleProgressBudget(this, from, this.config.timeoutMs);
    let advanceBattlePrompt = null;
    let promptCommandAddress = null;

    while (pending.size > 0 && Date.now() < progressBudget.observe()) {
      let droveCommand = false;
      for (const client of clients) {
        if (!pending.has(client.label)) {
          continue;
        }
        const event = findOwnedCommandOrTerminal(client, from[client.label] ?? 0);
        if (event == null) {
          continue;
        }
        if (event.kind !== "browser-surface2" && !LOCAL_COMMAND.test(event.text ?? "")) {
          throw new Error(`${client.label}: shared session terminated before ${purpose}: ${event.text}`);
        }
        commandEvents[client.label] = event;
        outcomeCursors[client.label] = client.evidence.cursor();
        await client.checkpoint(`${purpose}-${client.label}-command`);
        await client.sequence(keys, `${purpose}-${client.label}`);
        pending.delete(client.label);
        const commandAddress = event.observation?.address;
        if (
          pending.size > 0
          && Number.isSafeInteger(commandAddress?.epoch)
          && Number.isSafeInteger(commandAddress?.wave)
          && Number.isSafeInteger(commandAddress?.turn)
        ) {
          // The reciprocal command surface is intentionally sequential. Once one player submits, the peer can
          // still be rendering the preceding turn, so its last command observation is not required to match yet.
          // Pin prompt admission to the exact public address that authorized this submission instead.
          promptCommandAddress = `${commandAddress.epoch}:${commandAddress.wave}:${commandAddress.turn}`;
          advanceBattlePrompt = null;
        }
        droveCommand = true;
        // Re-scan after every submission: that public choice may synchronously open the peer UI.
        break;
      }
      if (droveCommand) {
        continue;
      }
      advanceBattlePrompt ??= createBattlePromptAdvancer(
        this,
        from,
        {},
        `${purpose}-prompt-frontier`,
        promptCommandAddress == null ? undefined : { expectedCommandAddress: promptCommandAddress },
      );
      if (await advanceBattlePrompt()) {
        continue;
      }
      await delay(100);
    }

    if (pending.size > 0) {
      throw new Error(`${purpose}: timed out waiting for sequential command owners ${[...pending].join(", ")}`);
    }
    for (const client of clients) {
      client.evidence.record("sequential-command-proof", {
        purpose,
        commandEventIndex: commandEvents[client.label]?.index ?? null,
        outcomeCursor: outcomeCursors[client.label],
      });
    }
    return { commandEvents, outcomeCursors };
  }

  async waitForPostTurnOutcome(from, { expectedCommandAddress = null, progressBudgetOptions = {} } = {}) {
    const advanceBattlePrompt = createBattlePromptAdvancer(this, from, {}, "public-ui-post-turn", {
      expectedCommandAddress,
    });
    const progressBudget = createPublicBattleProgressBudget(this, from, this.config.timeoutMs, progressBudgetOptions);
    while (Date.now() < progressBudget.observe()) {
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
      // A renderer can still be parked on an exact, readiness-proven narration prompt
      // after the authority has opened the next command frontier. Drain that human input
      // before accepting the frontier; returning first strands the renderer and makes the
      // next sequential round observe only one real browser. Structural reward/faint
      // outcomes above retain priority over cosmetic prompt advancement.
      if (await advanceBattlePrompt()) {
        continue;
      }
      // The next command frontier is healthy as soon as ONE addressed owner UI opens. Its
      // public choice unlocks the partner's UI, so requiring both here creates a harness-only
      // deadlock. driveSequentialCommandRound consumes this frontier one owner at a time.
      const commandClient = values.find(client => findOwnedCommandOrTerminal(client, from[client.label]) != null);
      if (commandClient) {
        const event = findOwnedCommandOrTerminal(commandClient, from[commandClient.label]);
        if (event?.kind !== "browser-surface2" && !LOCAL_COMMAND.test(event?.text ?? "")) {
          throw new Error(
            `${commandClient.label}: shared session terminated at the post-turn frontier: ${event?.text}`,
          );
        }
        return { kind: "command", client: commandClient };
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

  async leaveRewardsAndReachWave2({ commanderFixture = false } = {}) {
    const values = Object.values(this.clients);
    const ownerCursors =
      this.lastWaveCursors ?? Object.fromEntries(values.map(client => [client.label, client.pageCursor]));
    const owner = await values[0].evidence.waitForCondition(
      () => values.find(client => client.evidence.find(REWARD_OWNER, ownerCursors[client.label])),
      { timeoutMs: this.config.timeoutMs, description: "reward owner public UI" },
    );
    if (owner !== this.host || !this.guest) {
      throw new Error(
        `wave-1 reward leave requires authenticated host ownership; observed ${owner.label}/seat-${owner.publicSeat}`,
      );
    }
    const watcher = this.guest;
    const ownedReward = await owner.waitForOwnedReward(ownerCursors[owner.label]);
    const expectedRewardAddress = ownedReward.observation.address;
    await owner.checkpoint("reward-owner-screen");
    const commandCursors = Object.fromEntries(values.map(client => [client.label, client.evidence.cursor()]));
    const [openConfirmKey, ...confirmKeys] = this.config.keys.rewardLeave;
    if (openConfirmKey == null || confirmKeys.length === 0) {
      throw new Error("public reward-leave journey requires keys to open and accept the reward confirmation");
    }
    const rewardConfirmCursors = Object.fromEntries(values.map(client => [client.label, client.evidence.cursor()]));
    await owner.press(openConfirmKey, `leave-reward-screen:1/${this.config.keys.rewardLeave.length}`);
    const [ownerConfirmation, watcherProjection] = await Promise.all([
      owner.waitForOwnedRewardConfirm(rewardConfirmCursors[owner.label], expectedRewardAddress),
      watcher.waitForAddressedRewardWatcher(
        rewardConfirmCursors[watcher.label],
        owner.publicSeat,
        expectedRewardAddress,
      ),
    ]);
    owner.evidence.record("shared-reward-confirm-proof", {
      peer: watcher.label,
      address: ownerConfirmation.observation.address,
      ownerSeat: owner.publicSeat,
      projection: "actionable-confirmation",
    });
    watcher.evidence.record("shared-reward-confirm-proof", {
      peer: owner.label,
      address: watcherProjection.observation.address,
      ownerSeat: owner.publicSeat,
      projection: "non-actionable-shop-watcher",
    });
    const terminalCursors = Object.fromEntries(values.map(client => [client.label, client.evidence.cursor()]));
    for (const [index, key] of confirmKeys.entries()) {
      await owner.press(key, `leave-reward-screen:${index + 2}/${this.config.keys.rewardLeave.length}`);
    }
    await this.assertRetainedRewardTerminal(terminalCursors, expectedRewardAddress, owner.publicSeat);
    const expectedWave = this.activeBattleWave == null ? null : this.activeBattleWave + 1;
    if (commanderFixture) {
      const boundary = await this.waitForCommanderCommandBoundaryDrivingBattlePrompts(
        commandCursors,
        "wave-2-commander-command",
        { expectedWave },
      );
      this.activeBattleWave = boundary.observation.wave;
      this.pendingCommanderBoundary = boundary;
      this.assertNoFatalRecoverySince(commandCursors, "retained reward to wave-2 Commander command");
    } else {
      await this.waitForAllLocalCommandsDrivingBattlePrompts(commandCursors, "next-wave-intro");
      const boundary = await this.assertSharedSurface("command", commandCursors, "wave-2-command", {
        expectedWave,
      });
      this.activeBattleWave = boundary.wave;
    }
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
    await Promise.allSettled(this.browsers.map(browser => browser.close()));
  }

  assertClean() {
    for (const client of Object.values(this.clients)) {
      client.evidence.assertClean();
    }
  }
}
