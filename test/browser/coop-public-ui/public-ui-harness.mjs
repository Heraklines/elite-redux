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
const GAME_OVER_PHASE = /Start Phase GameOverPhase/u;
const REWARD_OWNER = /OWNER drives reward screen/u;
const GUEST_FAINT_PICKER = /guest own-faint picker OPEN/u;
const HOST_SWITCH_PHASE = /Start Phase SwitchPhase/u;
const GUEST_CONTINUATION_ACK = /guest ACK turn stage=continuationReady e=(\d+) wave=(\d+) turn=(\d+) rev=(\d+)/u;
const SHARED_SESSION_TERMINAL = /\[coop:runtime\] shared session (?:terminal requested|stopped safely):/u;
const LAUNCH_SNAPSHOT_ABORT = /launchSnapshotAbort wave=\d+ reason=/u;
const DATA_FINGERPRINT =
  /dataFingerprint compute moveMap=([^\s(]+)\((\d+)\) movesData=([^\s(]+)\((\d+)\) movesName=([^\s(]+)\((\d+)\) movesets=([^\s(]+)\((\d+)\) abilitiesData=([^\s(]+)\((\d+)\) abilitiesName=([^\s(]+)\((\d+)\)/u;
const FUNCTIONAL_FINGERPRINT_MISMATCH = /FUNCTIONAL MISMATCH sections=/u;
const COMPATIBLE_FINGERPRINT =
  /MATCH - data tables identical across clients|PRESENTATION MISMATCH sections=.* - simulation compatible -/u;
const POST_TURN_PHASE_PROGRESS = /Start Phase ([A-Za-z0-9]+Phase)/u;
const POST_TURN_AUTHORITY_PROGRESS = /\[coop:turn\] host recorder: append turn=\d+ seq=(\d+)/u;
const POST_TURN_RENDERER_PROGRESS = /\[coop:replay\] guest replay turn=\d+: live increment seq=(\d+)\.\.(\d+)/u;
const REWARD_RESULT_RETAINED = /reward authoritative RESULT retained rev=(\d+) tick=(\d+) id=([^\s]+)/u;
const FATAL_COOP_RECOVERY = /Co-op Sync Recovery|recovery request attempt=|recovery EXHAUSTED|could not converge/iu;
const RENDEZVOUS_RECOVERY_RETRY_POINT =
  /\[coop:rendezvous\] RENDEZVOUS RECOVERY RETRY point=([^\s]+)(?: attempt=\d+\/\d+)? after \d+ms/u;
const TATSUGIRI_SPECIES_ID = 978;
const DONDOZO_SPECIES_ID = 977;
const MAGIKARP_SPECIES_ID = 129;
const BULBASAUR_SPECIES_ID = 1;
const SEEL_SPECIES_ID = 86;
const POST_TURN_PROGRESS_ALLOWANCE_MS = 90_000;
const POST_TURN_HARD_CEILING_MS = 360_000;
const COLD_REJOIN_RELEASE_MS = 160_000;
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
const LOBBY_REQUEST_REISSUE_MS = 10_000;
const OPTIONAL_LOBBY_RELAY_WAIT_MS = 1_500;

function primaryLanguage(locale) {
  return locale.trim().toLowerCase().split("-")[0];
}

function browserLocale(locale) {
  if (locale === "en") {
    return "en-US";
  }
  if (locale === "de") {
    return "de-DE";
  }
  return locale;
}

function parseFunctionalFingerprint(event, label) {
  const match = DATA_FINGERPRINT.exec(event.text ?? "");
  if (match == null) {
    throw new Error(`${label}: malformed dataFingerprint compute evidence`);
  }
  return Object.freeze({
    moveMap: Object.freeze({ hash: match[1], n: Number(match[2]) }),
    movesData: Object.freeze({ hash: match[3], n: Number(match[4]) }),
    movesets: Object.freeze({ hash: match[7], n: Number(match[8]) }),
    abilitiesData: Object.freeze({ hash: match[9], n: Number(match[10]) }),
  });
}

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
  const observation = semantic?.observation;
  const semanticOwner =
    observation != null
    && (observation.coop === false
      ? observation.ownerModel === "local" && observation.localSeat == null && observation.seatsWithInput?.includes(0)
      : observation.localSeat === client.publicSeat && observation.seatsWithInput?.includes(client.publicSeat));
  const ownedSemantic =
    observation?.ready?.handlerActive === true
    && observation.phase === "CommandPhase"
    && observation.uiMode === "COMMAND"
    && semanticOwner
      ? semantic
      : null;
  return (
    ownedSemantic
    ?? client.evidence.find(LOCAL_COMMAND, from)
    ?? client.evidence.find(SHARED_SESSION_TERMINAL, from)
    ?? client.evidence.find(LAUNCH_SNAPSHOT_ABORT, from)
  );
}

function findAddressedCommandCollectionClosed(client, from, expectedAddress) {
  return client.evidence.events.slice(from).find(event => {
    const observation = event.kind === "browser-surface2" ? event.observation : null;
    return (
      (observation?.operationClass === "battle-progress" || observation?.operationClass === "reward")
      && observation.phase !== "CommandPhase"
      && sameAddress(observation.address, expectedAddress)
    );
  });
}

/**
 * SelectGenderPhase first exposes its preceding MESSAGE projection, then replaces it with the
 * actionable option picker. Do not spend the one public confirm key until that picker proves its
 * handler, phase instance, options, and local input ownership are all live.
 */
export function findActionableFirstLoginGenderSurface(evidence, from = 0) {
  const event = evidence.findLastSemanticSurface(from, "option-select:SelectGenderPhase");
  const observation = event?.observation;
  const optionIds = observation?.optionIds;
  if (
    observation?.phase !== "SelectGenderPhase"
    || !Number.isSafeInteger(observation.phaseInstance)
    || observation.phaseInstance < 2
    || observation.uiMode !== "OPTION_SELECT"
    || observation.ready?.handlerActive !== true
    || observation.ready.inputBlocked === true
    || !observation.seatsWithInput?.includes(0)
    || !Number.isSafeInteger(observation.surfaceGeneration)
    || observation.surfaceGeneration < 1
    || optionIds?.length !== 2
    || optionIds.some(optionId => typeof optionId !== "string" || optionId.length === 0)
    || new Set(optionIds).size !== 2
    || typeof observation.selectedOptionId !== "string"
    || !optionIds.includes(observation.selectedOptionId)
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

function findOwnedReadyReplacement(client, from) {
  const semantic = client.evidence.findLastSemanticSurface(from, "party:replacement");
  return semantic?.observation.operationClass === "replacement"
    && semantic.observation.ownerModel === "interaction"
    && semantic.observation.phase === "SwitchPhase"
    && semantic.observation.uiMode === "PARTY"
    && semantic.observation.localSeat === client.publicSeat
    && semantic.observation.ownerSeat === client.publicSeat
    && semantic.observation.seatsWithInput?.includes(client.publicSeat)
    && semantic.observation.ready?.handlerActive === true
    && semantic.observation.ready.inputBlocked !== true
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

function isRetryableLobbyRaceFailure(failure) {
  if (failure?.status === 401 && failure.pathname === "/coop/v3/lobby/request") {
    return true;
  }
  // The incoming request has a short worker-side TTL. A human can press Accept after the
  // accept panel became visible but just after that TTL elapsed; the production controller
  // deliberately treats the resulting 409 as transient and returns to browsing. The browser
  // oracle must do the same while still requiring a later stable-seat binding by its deadline.
  return (
    failure?.status === 409
    && (failure.pathname === "/coop/v3/lobby/request" || failure.pathname === "/coop/v3/lobby/respond")
  );
}

function clearRetryableLobbyRaceFailures(clients) {
  for (const client of clients) {
    const failure = client.evidence.networkState.apiFailure;
    if (!isRetryableLobbyRaceFailure(failure)) {
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
    battleType: observation.battleType,
    trainerBoss: observation.trainerBoss,
    maxBossSegments: observation.maxBossSegments,
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

function commandFrontierProjection(client, event) {
  if (event?.kind !== "browser-surface2") {
    return null;
  }
  const observation = event.observation;
  const address = observation?.address;
  const rendererWatcher =
    observation?.surfaceId === "command:watcher"
    && observation.operationClass === "command"
    && observation.phase === "CoopReplayTurnPhase"
    && observation.seatsWithInput?.length === 0
    && observation.ready?.handlerActive === false
    && observation.ready.awaitingActionInput === false
    && observation.ready.inputBlocked === true;
  if (
    observation?.coop !== true
    || observation.localSeat !== client.publicSeat
    || !Number.isSafeInteger(address?.epoch)
    || !Number.isSafeInteger(address?.wave)
    || !Number.isSafeInteger(address?.turn)
    || !Number.isSafeInteger(observation.membershipRevision)
    || !Number.isSafeInteger(observation.connectionGeneration)
    || typeof observation.stateDigest !== "string"
    || observation.stateDigest.length === 0
    || (observation.ready?.handlerActive !== true && !rendererWatcher)
  ) {
    return null;
  }
  const owner =
    observation.surfaceId === "command:command"
    && observation.operationClass === "command"
    && observation.phase === "CommandPhase"
    && observation.uiMode === "COMMAND"
    && observation.seatsWithInput?.includes(client.publicSeat);
  const watcher =
    rendererWatcher
    || (observation.surfaceId === "battle:message"
      && observation.operationClass === "battle-progress"
      && observation.phase === "CommandPhase"
      && observation.uiMode === "MESSAGE"
      && observation.ready.awaitingActionInput === true);
  if (!owner && !watcher) {
    return null;
  }
  return {
    event,
    observation,
    kind: owner ? "owner" : "watcher",
    address: `${address.epoch}:${address.wave}:${address.turn}`,
  };
}

function observedCommandFrontiers(client, from) {
  return client.evidence.events
    .slice(from)
    .map(event => commandFrontierProjection(client, event))
    .filter(Boolean)
    .toReversed();
}

export function findSharedCommandFrontierMatch(
  host,
  guest,
  cursors,
  priorAddress,
  { allowAddressRepeat = false, expectedWave = null, expectedAddress = null } = {},
) {
  const hostEvents = observedCommandFrontiers(host, cursors[host.label] ?? 0);
  const guestEvents = observedCommandFrontiers(guest, cursors[guest.label] ?? 0);
  for (const hostProjection of hostEvents) {
    const observation = hostProjection.observation;
    if (
      (!allowAddressRepeat && priorAddress === hostProjection.address)
      || (expectedWave != null && observation.address.wave !== expectedWave)
      || (expectedAddress != null && hostProjection.address !== expectedAddress)
    ) {
      continue;
    }
    const guestProjection = guestEvents.find(candidate => {
      const peer = candidate.observation;
      return (
        candidate.address === hostProjection.address
        && peer.membershipRevision === observation.membershipRevision
        && peer.connectionGeneration === observation.connectionGeneration
        && peer.stateDigest === observation.stateDigest
      );
    });
    if (guestProjection == null || (hostProjection.kind !== "owner" && guestProjection.kind !== "owner")) {
      continue;
    }
    return {
      hostProjection,
      guestProjection,
      address: hostProjection.address,
      comparable: {
        surface: "command",
        epoch: observation.address.epoch,
        membershipRevision: observation.membershipRevision,
        connectionGeneration: observation.connectionGeneration,
        wave: observation.address.wave,
        turn: observation.address.turn,
        phase: "CommandPhase",
        stateDigest: observation.stateDigest,
        hostProjection: hostProjection.kind,
        guestProjection: guestProjection.kind,
      },
    };
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
    this.lobbySurfaceCursor = 0;
    this.pageGeneration = 0;
    this.publicRole = null;
    this.publicSeat = null;
    // Journey-owned state, learned only after the public authentication flow succeeds. A cold
    // page reopen keeps the browser context and account session, so an already-authenticated
    // player must be given time to reach TitlePhase instead of being driven through Register a
    // second time while the automatic session restore is still loading.
    this.authenticatedOnce = false;
    this.forceVisibleLogin = false;
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
    this.evidence.networkState.apiFailure = null;
    this.publicRole = null;
    this.publicSeat = null;
    this.page = await this.context.newPage();
    await this.page.setViewport(this.config.viewport);
    // The bundle is immutable and digest-verified before launch. Preserve normal browser caching so a
    // cold reopen exercises production cache behavior instead of reloading tens of thousands of assets.
    await this.page.setCacheEnabled(true);
    this.evidence.attach(this.page);
    const entryUrl = new URL(this.config.baseUrl);
    if (this.config.lobbyRoom != null) {
      entryUrl.searchParams.set("cooproom", this.config.lobbyRoom);
    }
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
    // Closing a loading page intentionally aborts asset preloads. Detach only this page's error observer
    // immediately before teardown; errors from the replacement page remain strict.
    this.page?.removeAllListeners("pageerror");
    await this.page?.close().catch(() => {});
    await this.open();
  }

  async replaceWithEmptyContext() {
    const browser = this.context.browser();
    if (browser == null) {
      throw new Error(`${this.label}: browser disappeared before cold-context replacement`);
    }
    this.evidence.record("cold-context-replace", {
      reason: "brand-new cookie jar and local storage; visible login required",
    });
    this.page?.removeAllListeners("pageerror");
    await this.context.close();
    this.context = await browser.createBrowserContext();
    this.authenticatedOnce = true;
    this.forceVisibleLogin = true;
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

    if (this.authenticatedOnce && !this.forceVisibleLogin) {
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
      // LOGIN_OR_REGISTER selects Login by default. FormModalUiHandler accepts SUBMIT, not ACTION,
      // so the public keyboard equivalent is Enter after the active modal is observably ready.
      const loginSurface = await waitForSemanticSurface(this, "auth:login-or-register", {
        fromCursor: this.pageCursor,
        timeoutMs: this.config.bootTimeoutMs,
      });
      if (loginSurface.observation.ready?.handlerActive !== true) {
        throw new Error(`${this.label}: public login selector was visible but not actionable`);
      }
      await this.press("Enter", "open-login-form");
      await this.waitForVisibleInputs({ text: 1, password: 1, purpose: "public login form" });
      await this.fillLoginForm();
    }
    const entered = await this.completePostAuthentication();
    this.authenticatedOnce = true;
    this.forceVisibleLogin = false;
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
    if (this.config.accountMode === "register" && !this.authenticatedOnce && account.lastSessionSlot === -1) {
      await this.evidence.waitForCondition(
        sink =>
          sink.events
            .slice(this.pageCursor)
            .find(
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
    // Credential entry is setup, not gameplay cadence. CDP still emits public DOM key events,
    // but an artificial per-character timer dilated 20 ms into minutes on a saturated runner.
    await usernameInput.click({ clickCount: 3 });
    await this.page.keyboard.type(this.credentials.username);
    for (const passwordInput of passwordInputs.slice(0, 2)) {
      await passwordInput.click({ clickCount: 3 });
      await this.page.keyboard.type(this.credentials.password);
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
    await this.selectAllFocusedText();
    await this.page.keyboard.type(this.credentials.username);
    await passwordInput.click({ clickCount: 3 });
    await this.selectAllFocusedText();
    await this.page.keyboard.type(this.credentials.password);
    await this.press("Enter", "submit-login-form");
    await this.clearDomInputFocus();
  }

  /** Send the real select-all keyboard chord; Puppeteer does not accept composite key names. */
  async selectAllFocusedText() {
    await this.page.keyboard.down("Control");
    try {
      await this.page.keyboard.press("a");
    } finally {
      await this.page.keyboard.up("Control");
    }
  }

  /**
   * Explicitly blur any focused DOM input after credential entry. Per-press blur is gated to
   * (re)fronts (see press), so the credential forms - the only place a DOM input gains focus -
   * clear it deterministically here instead of relying on the next game keystroke to do it.
   */
  async clearDomInputFocus() {
    const observedLocale = await this.page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      return {
        navigatorLanguage: navigator.language,
        persistedLanguage: localStorage.getItem("prLang"),
      };
    });
    const expectedLocale = this.config.locales[this.label];
    if (
      primaryLanguage(observedLocale.navigatorLanguage) !== primaryLanguage(expectedLocale)
      || primaryLanguage(observedLocale.persistedLanguage ?? "") !== primaryLanguage(expectedLocale)
    ) {
      throw new Error(
        `${this.label}: browser/app locale mismatch expected=${expectedLocale} navigator=${observedLocale.navigatorLanguage} persisted=${observedLocale.persistedLanguage}`,
      );
    }
    this.evidence.record("browser-locale-proof", { expectedLocale, ...observedLocale });
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
      // Aggregate counters (optimization brief step 1): the run-level focus-arbitration
      // baseline without re-parsing per-press events from the trace.
      this.evidence.recordInputTiming({ queueWaitMs, bringToFrontMs: bringToFrontMs + refrontMs, didFront });
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
    return this.evidence.checkpoint(this.page, this.context, `page-${this.pageGeneration}-${name}`);
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
    this.lobbySurfaceCursor = this.evidence.cursor();
    const announceCursor = this.evidence.cursor();
    await this.press("Space", "mode-open-coop-lobby");
    await this.evidence.waitFor(/start announce name=/u, {
      from: announceCursor,
      timeoutMs: this.config.timeoutMs,
      description: "public co-op lobby announce",
    });
    await this.checkpoint("lobby-announced");
  }

  async waitForLobbyPlayer(username, timeoutMs = this.config.timeoutMs) {
    return this.evidence.waitForCondition(
      sink => {
        assertNoDriverApiFailure(sink, "co-op lobby");
        const players = sink.networkState.lobby?.players ?? [];
        const index = players.indexOf(username);
        return index >= 0 ? { players, index } : null;
      },
      { timeoutMs, description: `lobby list containing ${username}` },
    );
  }

  async requestPlayer(
    username,
    { purpose = "request", timeoutMs = this.config.timeoutMs, relayTimeoutMs = timeoutMs, optional = false } = {},
  ) {
    const targetId = `ask:${username}`;
    let requestCursor = this.evidence.cursor();
    try {
      await this.waitForLobbyPlayer(username, timeoutMs);
      await this.evidence.waitForCondition(
        sink => {
          assertNoDriverApiFailure(sink, "co-op lobby");
          const surface = sink.findLastSemanticSurface(this.lobbySurfaceCursor, "option-select:TitlePhase");
          return surface?.observation.optionIds?.includes(targetId) ? surface : null;
        },
        { timeoutMs, description: `visible lobby option for ${username}` },
      );
      // The worker lobby list is dynamic under a sharded campaign. Select by the exact visible
      // username immediately before every request; an old cursor index may now name another runner.
      // Submission stays inside the readiness-aware navigator. Splitting selection and Space into
      // separate operations let a TitlePhase repaint block the key after the correct row was visibly
      // selected, producing a twelve-minute false softlock in all three real-browser lanes.
      requestCursor = this.evidence.cursor();
      this.evidence.record("lobby-request-attempt", { username, targetId, purpose });
      await selectOptionById(this, {
        surfaceId: "option-select:TitlePhase",
        targetId,
        navKeys: ["ArrowUp", "ArrowDown"],
        timeoutMs,
        fromCursor: this.lobbySurfaceCursor,
      });
    } catch (error) {
      if (
        optional
        && error instanceof Error
        && (/timed out waiting for lobby list containing/u.test(error.message)
          || /timed out waiting for visible lobby option/u.test(error.message)
          || /selectOptionById\(option-select:TitlePhase->.*\) (?:saw no|target not in options)/u.test(error.message))
      ) {
        this.evidence.record("lobby-request-deferred", { username, targetId, reason: error.message });
        return false;
      }
      throw error;
    }
    try {
      const outcome = await this.evidence.waitForCondition(
        sink => {
          const relayed = sink.find(/request target=/u, requestCursor);
          if (relayed) {
            return { kind: "relayed", event: relayed };
          }
          // `CoopLobbyController.cancel()` is also the normal cleanup path after a crossed
          // request has already paired this browser. Treating that log line as a user cancel
          // made the real-browser oracle fail while the same page was entering
          // SelectChallengePhase with a valid host binding. Only an actual TitlePhase return is
          // terminal; post-lobby setup or a stable binding proves the request was superseded by a
          // successful pairing.
          const binding = sink.findBinding(requestCursor);
          if (binding) {
            return { kind: "paired", event: binding };
          }
          const postLobby = sink.find(/Start Phase (?:SelectChallengePhase|SelectStarterPhase)/u, requestCursor);
          if (postLobby) {
            return { kind: "paired", event: postLobby };
          }
          const titleReturn = sink.find(/Start Phase TitlePhase/u, requestCursor);
          return titleReturn ? { kind: "title-return", event: titleReturn } : null;
        },
        {
          timeoutMs: relayTimeoutMs,
          description: `request relay for ${username}`,
        },
      );
      if (outcome.kind === "title-return") {
        this.evidence.record("lobby-request-terminal", {
          username,
          targetId,
          terminal: outcome.kind,
          sourceEventIndex: outcome.event.index,
        });
        throw new Error(
          `${this.label}: lobby selection returned to TitlePhase before request relay for ${username} `
            + `(terminal=${outcome.kind})`,
        );
      }
    } catch (error) {
      if (optional && error instanceof Error && /timed out waiting for request relay/u.test(error.message)) {
        // A public key can coincide with the lobby's asynchronous option-list repaint. The
        // self-healing loop will re-select the exact username and try again; only this explicitly
        // optional TTL refresh may defer. A lobby cancellation/Title return cannot defer because
        // the requester has left the lobby and must fail with its exact terminal classification.
        this.evidence.record("lobby-request-deferred", { username, targetId, reason: error.message });
        return false;
      }
      throw error;
    }
    return true;
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
    const progressBudget = createPublicBattleProgressBudget(this, from, this.config.timeoutMs);
    const advanceBattlePrompt = createBattlePromptAdvancer(this, from, {}, purpose, {
      requireSharedCommandAddress: false,
    });
    while (Date.now() < progressBudget.observe()) {
      if (
        this.host
        && this.guest
        && findSharedCommandFrontierMatch(this.host, this.guest, from, this.lastSharedSurfaceAddress.get("command"), {
          allowAddressRepeat: true,
        }) != null
      ) {
        break;
      }
      if (await advanceBattlePrompt()) {
        continue;
      }
      await delay(100);
    }
    if (
      !this.host
      || !this.guest
      || findSharedCommandFrontierMatch(this.host, this.guest, from, this.lastSharedSurfaceAddress.get("command"), {
        allowAddressRepeat: true,
      }) == null
    ) {
      throw new Error(`${purpose}: timed out waiting for an addressed command owner/watcher frontier`);
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
    const launchBrowser = locale =>
      puppeteer.launch({
        headless: config.headless,
        defaultViewport: config.viewport,
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
          // Avoid Docker's small shared-memory mount. Xvfb has no hardware GL device, so use
          // Chromium's WebGL-only SwiftShader ANGLE backend; the full SwiftShader compositor
          // produced striped PNGs and Mesa could not create the Phaser WebGL context in CI.
          "--disable-dev-shm-usage",
          "--use-gl=angle",
          "--use-angle=swiftshader-webgl",
          "--enable-unsafe-swiftshader",
          `--lang=${locale}`,
          // Chromium documents --accept-lang as the headless switch exposed through
          // navigator.language; Linux commonly ignores --lang for that API.
          `--accept-lang=${browserLocale(locale)}`,
          `--window-size=${config.viewport.width},${config.viewport.height}`,
        ],
      });
    const launchResults = await Promise.allSettled([
      launchBrowser(config.locales["host-seat"]),
      launchBrowser(config.locales["guest-seat"]),
    ]);
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
    // Navigate by the exact public option id and send the first request. The lobby is shared by
    // every remote shard, so a numeric cursor position is never an identity proof.
    await requester.requestPlayer(acceptor.credentials.username, {
      purpose: "initial-request",
      relayTimeoutMs: OPTIONAL_LOBBY_RELAY_WAIT_MS,
      optional: true,
    });
    // The co-op HOST binds from the WebRTC session connect (sessionEpoch>0). The co-op GUEST
    // only binds AFTER the host fires its LAUNCH DECISION ("Press to start co-op" ->
    // sendResumeStartNew / resume offer), which the journey (startFreshRun/resumeRun) drives
    // next. Identify the host here; the guest binding + full role/seat verification is deferred
    // to completePairingBinding() AFTER that human launch press - otherwise we deadlock waiting
    // for a binding that only the launch action produces.
    this.pairRoleCursors = roleCursors;
    await this.driveSelfHealingPairing(requester, acceptor, roleCursors);
    await this.assertPairingFunctionalFingerprintMatch(roleCursors);
    await Promise.all(Object.values(this.clients).map(client => client.checkpoint("paired-awaiting-launch")));
    return { requester, acceptor };
  }

  /** Prove differently localized production clients built identical simulation tables. */
  async assertPairingFunctionalFingerprintMatch(roleCursors) {
    const proofs = await Promise.all(
      Object.values(this.clients).map(async client => {
        const from = roleCursors[client.label];
        const fingerprintEvent = await client.evidence.waitFor(DATA_FINGERPRINT, {
          from,
          timeoutMs: this.config.timeoutMs,
          description: "local ER data fingerprint computation",
        });
        const compatibilityEvent = await client.evidence.waitForCondition(
          sink => {
            const mismatch = sink.find(FUNCTIONAL_FINGERPRINT_MISMATCH, from);
            if (mismatch != null) {
              throw new Error(`${client.label}: ${mismatch.text}`);
            }
            return sink.find(COMPATIBLE_FINGERPRINT, from);
          },
          {
            timeoutMs: this.config.timeoutMs,
            description: "peer functional fingerprint compatibility verdict",
          },
        );
        return {
          client,
          fingerprint: parseFunctionalFingerprint(fingerprintEvent, client.label),
          compatibilityEvent,
        };
      }),
    );
    const [first, second] = proofs;
    if (JSON.stringify(first.fingerprint) !== JSON.stringify(second.fingerprint)) {
      throw new Error(
        `paired browsers computed different functional fingerprints: ${first.client.label}=${JSON.stringify(first.fingerprint)} ${second.client.label}=${JSON.stringify(second.fingerprint)}`,
      );
    }
    for (const proof of proofs) {
      proof.client.evidence.record("pairing-functional-fingerprint-proof", {
        expectedLocale: this.config.locales[proof.client.label],
        functionalFingerprint: proof.fingerprint,
        compatibilityEvidenceIndex: proof.compatibilityEvent.index,
      });
    }
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
   *   - REQUESTER: whenever no request is in flight, re-select the exact acceptor username from the
   *     current public option list, then re-issue. `request()` refreshes the worker-side TTL. A bare
   *     Space is forbidden because concurrent shards continuously reorder the lobby rows.
   * Exits when either client observes a role=host binding; throws (same message as before) on the
   * pairing deadline so a genuine never-binds still fails loudly.
   */
  async driveSelfHealingPairing(requester, acceptor, roleCursors) {
    const requesterName = requester.credentials.username;
    const acceptorName = acceptor.credentials.username;
    const deadline = Date.now() + this.config.timeoutMs;
    let acceptedForLiveRequest = false;
    // The initial public key may land in the tiny repaint window after the semantic read. Enter
    // the bounded self-healing loop immediately instead of waiting a full request TTL to discover it.
    let nextReissueAt = Date.now();
    let supersededRequestFailure = null;
    while (Date.now() < deadline) {
      for (const client of Object.values(this.clients)) {
        const failure = client.evidence.networkState.apiFailure;
        if (isRetryableLobbyRaceFailure(failure)) {
          // Reciprocal requests can cross: one request consumes the lobby credential and creates
          // the match while the other in-flight request receives 401. Do not call that a pass;
          // keep driving until the public stable-seat binding proves the match won the race. If no
          // binding arrives by the deadline, surface this exact failure below.
          supersededRequestFailure = { client: client.label, ...failure };
          // The evidence recorder deliberately retains the first failed driver request. Clear
          // only this classified matchmaking race after copying it above; otherwise the next
          // semantic lobby waiter calls assertNoDriverApiFailure and aborts before the bounded
          // self-healing loop can perform the retry it promises.
          client.evidence.networkState.apiFailure = null;
          client.evidence.record("driver-api-failure-retry", {
            ...failure,
            proofRequired: "stable-seat-binding",
          });
        } else {
          assertNoDriverApiFailure(client.evidence, "co-op lobby");
        }
        const binding = client.evidence.findBinding(roleCursors[client.label]);
        if (binding) {
          client.publicRole = binding.observation.role;
          client.publicSeat = binding.observation.seat;
          if (binding.observation.role === "host") {
            clearRetryableLobbyRaceFailures(Object.values(this.clients));
            return client;
          }
        }
      }
      const incoming = acceptor.evidence.networkState.lobby?.request ?? null;
      if (incoming === requesterName) {
        if (!acceptedForLiveRequest) {
          // The lobby publishes the incoming request before its option-panel repaint releases
          // blockInput. A bare Space here is swallowed by the real handler (the depth campaign
          // reproduced this for twelve minutes). Navigate to the exact requester identity and wait
          // for the live panel's explicit unblocked projection before accepting. If its short TTL
          // expires during that wait, let the requester refresh it and try the next appearance.
          try {
            const acceptCursor = acceptor.evidence.cursor();
            await selectOptionById(acceptor, {
              surfaceId: "option-select:TitlePhase",
              targetId: `accept:${requesterName}`,
              navKeys: ["ArrowUp", "ArrowDown"],
              timeoutMs: LOBBY_REQUEST_REISSUE_MS,
              fromCursor: roleCursors[acceptor.label],
            });
            // Selecting a semantic row is not proof that Phaser consumed the queued key. Require
            // the public handler-to-relay log before suppressing another attempt; this catches a
            // repaint/blockInput race without calling controller internals.
            await acceptor.evidence.waitFor(/respond accept=true from=/u, {
              from: acceptCursor,
              timeoutMs: OPTIONAL_LOBBY_RELAY_WAIT_MS,
              description: `Accept relay for ${requesterName}`,
            });
            acceptedForLiveRequest = true;
          } catch (error) {
            acceptor.evidence.record("lobby-accept-deferred", {
              requesterName,
              reason: error instanceof Error ? error.message : String(error),
            });
            acceptedForLiveRequest = false;
          }
        }
      } else {
        acceptedForLiveRequest = false;
        if (Date.now() >= nextReissueAt) {
          await requester.requestPlayer(acceptorName, {
            purpose: "reissue-request",
            timeoutMs: LOBBY_REQUEST_REISSUE_MS,
            relayTimeoutMs: OPTIONAL_LOBBY_RELAY_WAIT_MS,
            optional: true,
          });
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

  /**
   * Prove one addressed command frontier without assuming both players have a living
   * battler. Each browser must publish the same epoch/revision/generation/wave/turn and
   * mechanical digest. At least one side must own an actionable command UI; a side with
   * no legal battler is represented by its real CommandPhase partner-waiting message.
   */
  async assertSharedCommandFrontier(
    cursors,
    proofName,
    { allowAddressRepeat = false, expectedWave = null, expectedAddress = null } = {},
  ) {
    const host = this.host;
    const guest = this.guest;
    if (!host || !guest) {
      throw new Error(`${proofName}: paired host/guest command observations were unavailable`);
    }
    const priorAddress = this.lastSharedSurfaceAddress.get("command");
    const deadline = Date.now() + this.config.timeoutMs;
    let match = null;
    while (Date.now() < deadline && match == null) {
      match = findSharedCommandFrontierMatch(host, guest, cursors, priorAddress, {
        allowAddressRepeat,
        expectedWave,
        expectedAddress,
      });
      if (match == null) {
        await delay(100);
      }
    }
    if (match == null) {
      const latest = client => observedCommandFrontiers(client, cursors[client.label] ?? 0)[0] ?? null;
      throw new Error(
        `${proofName}: clients never converged on one addressed command owner/watcher frontier; `
          + `host=${JSON.stringify(latest(host)?.observation ?? null)} `
          + `guest=${JSON.stringify(latest(guest)?.observation ?? null)}`,
      );
    }
    this.lastSharedSurfaceAddress.set("command", match.address);
    for (const client of Object.values(this.clients)) {
      const projection = client === host ? match.hostProjection : match.guestProjection;
      client.evidence.record("shared-command-frontier-proof", {
        proofName,
        address: match.address,
        projection: projection.kind,
        observation: match.comparable,
      });
    }
    return match.comparable;
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
                ? [MAGIKARP_SPECIES_ID, SEEL_SPECIES_ID]
                : [BULBASAUR_SPECIES_ID]
              : null;
          const result =
            expectedSeededSpecies == null
              ? await confirmDefaultStarterTeam(client, {
                  fromCursor: phaseCursors[client.label],
                  timeoutMs: this.config.timeoutMs,
                })
              : await confirmSeededStarterTeam(client, expectedSeededSpecies, {
                  fromCursor: phaseCursors[client.label],
                  timeoutMs: this.config.timeoutMs,
                });
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
    const runConfigCursors = Object.fromEntries(
      Object.values(this.clients).map(client => [client.label, client.evidence.cursor()]),
    );
    await selectOptionById(this.host, {
      surfaceId: "option-select:SelectStarterPhase",
      targetId: this.config.difficultyOptionId,
      navKeys: ["ArrowUp", "ArrowDown"],
      timeoutMs: this.config.timeoutMs,
    });
    await Promise.all([
      this.host.evidence.waitFor(
        new RegExp(
          `\\[coop-runconfig\\] startRun role=host willBroadcast=true difficulty=${this.config.difficultyId}(?:\\s|$)`,
          "u",
        ),
        {
          from: runConfigCursors[this.host.label],
          timeoutMs: this.config.timeoutMs,
          description: `host authoritative runConfig difficulty=${this.config.difficultyId}`,
        },
      ),
      this.guest.evidence.waitFor(
        new RegExp(
          `guest received difficulty=${this.config.difficultyId} netcode=authoritative kind=coop(?:\\s|$)`,
          "u",
        ),
        {
          from: runConfigCursors[this.guest.label],
          timeoutMs: this.config.timeoutMs,
          description: `guest adopted authoritative runConfig difficulty=${this.config.difficultyId}`,
        },
      ),
    ]);
    await Promise.all(
      Object.values(this.clients).map(client => client.checkpoint(`difficulty-${this.config.difficultyId}-attested`)),
    );
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
      const boundary = await this.assertSharedCommandFrontier(phaseCursors, "fresh-wave-1-command", {
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
    const boundary = await this.assertSharedCommandFrontier(resumeCursors, "resumed-command", {
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
      const { outcomeCursors, expectedCommandAddress } = await this.driveSequentialCommandRound(
        commandCursors,
        this.config.keys.battle,
        `turn-${turn}-first-move`,
      );
      if (pendingCommandProof != null) {
        await this.assertSharedCommandFrontier(pendingCommandProof.cursors, pendingCommandProof.name, {
          expectedWave: this.activeBattleWave,
          expectedAddress: expectedCommandAddress,
        });
        await this.assertRetainedContinuation(pendingCommandProof.cursors, pendingCommandProof.name);
        pendingCommandProof = null;
      }

      const outcome = await this.waitForPostTurnOutcome(outcomeCursors, { expectedCommandAddress });
      if (outcome.kind === "gameOver") {
        throw new Error(`Both browsers reached GameOver after turn ${turn}; the reward journey ended terminally`);
      }
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
        await this.driveReplacement(outcome.client, outcomeCursors);
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
      if (outcome.kind === "gameOver") {
        throw new Error(
          `Both browsers reached GameOver after Commander round ${round}; the reward journey ended terminally`,
        );
      }
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
    let submittedCommandAddress = null;
    let postSubmissionCursors = null;
    let commandCollectionClosed = null;

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
        const beforeSubmissionCursors = Object.fromEntries(
          clients.map(value => [value.label, value.evidence.cursor()]),
        );
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
          submittedCommandAddress = commandAddress;
          postSubmissionCursors = beforeSubmissionCursors;
          advanceBattlePrompt = null;
        }
        droveCommand = true;
        // Re-scan after every submission: that public choice may synchronously open the peer UI.
        break;
      }
      if (droveCommand) {
        continue;
      }
      if (submittedCommandAddress != null && postSubmissionCursors != null) {
        commandCollectionClosed =
          clients
            .map(client => ({
              client,
              event: findAddressedCommandCollectionClosed(
                client,
                postSubmissionCursors[client.label] ?? 0,
                submittedCommandAddress,
              ),
            }))
            .find(candidate => candidate.event != null) ?? null;
        if (commandCollectionClosed != null) {
          // A non-command phase at the exact submitted address is the public state machine's proof
          // that no reciprocal command owner exists for this round (for example, that battler is
          // fainted or structurally hidden). Never invent a second owner after collection has closed.
          for (const label of pending) {
            // Preserve the pre-round cursor: a one-shot reward/terminal surface may itself be the exact
            // collection-close event and must remain visible to the following outcome scan.
            outcomeCursors[label] = from[label] ?? 0;
          }
          pending.clear();
          break;
        }
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
        skippedAfterCollectionClosed: commandEvents[client.label] == null && commandCollectionClosed != null,
        collectionClosedEventIndex: commandCollectionClosed?.event.index ?? null,
        collectionClosedObservedBy: commandCollectionClosed?.client.label ?? null,
        outcomeCursor: outcomeCursors[client.label],
      });
    }
    const expectedCommandAddress =
      submittedCommandAddress == null
        ? null
        : `${submittedCommandAddress.epoch}:${submittedCommandAddress.wave}:${submittedCommandAddress.turn}`;
    return { commandEvents, outcomeCursors, expectedCommandAddress };
  }

  async waitForPostTurnOutcome(from, { expectedCommandAddress = null, progressBudgetOptions = {} } = {}) {
    let advanceBattlePrompt = null;
    const progressBudget = createPublicBattleProgressBudget(this, from, this.config.timeoutMs, progressBudgetOptions);
    let partialGameOver = [];
    while (Date.now() < progressBudget.observe()) {
      const values = Object.values(this.clients);
      const gameOvers = values.map(client => client.evidence.find(GAME_OVER_PHASE, from[client.label]));
      if (gameOvers.every(Boolean)) {
        for (let i = 0; i < values.length; i++) {
          values[i].evidence.record("paired-game-over-proof", {
            eventIndex: gameOvers[i].index,
            peerEventIndex: gameOvers[(i + 1) % values.length].index,
          });
        }
        return { kind: "gameOver" };
      }
      partialGameOver = values.filter((_client, index) => gameOvers[index] != null).map(client => client.label);
      // Once one peer has entered GameOver, do not misclassify its later terminal log as a generic
      // post-turn failure. Keep the browsers alive until the partner exposes the same terminal surface.
      if (partialGameOver.length > 0) {
        await delay(100);
        continue;
      }
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
      advanceBattlePrompt ??= createBattlePromptAdvancer(this, from, {}, "public-ui-post-turn", {
        expectedCommandAddress,
      });
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
    if (partialGameOver.length > 0) {
      throw new Error(
        `Timed out waiting for both browsers to reach GameOver; terminal observed only on ${partialGameOver.join(", ")}`,
      );
    }
    throw new Error("Timed out waiting for public post-turn command, faint, or reward evidence");
  }

  async driveReplacement(client = null, from = null) {
    let owner = client;
    if (!owner) {
      owner = this.client(this.config.faintOwnerSeat);
      await owner.evidence.waitFor(HOST_SWITCH_PHASE, {
        timeoutMs: this.config.timeoutMs,
        description: "configured owner SwitchPhase for faint replacement",
      });
    }
    const replacementCursors =
      from ?? Object.fromEntries(Object.values(this.clients).map(value => [value.label, value.evidence.cursor()]));
    const advanceBattlePrompt = createBattlePromptAdvancer(this, replacementCursors, {}, "faint-replacement-picker");
    const deadline = Date.now() + this.config.timeoutMs;
    let replacementSurface = null;
    while (Date.now() < deadline) {
      replacementSurface = findOwnedReadyReplacement(owner, replacementCursors[owner.label]);
      if (replacementSurface != null) {
        break;
      }
      const terminal =
        owner.evidence.find(SHARED_SESSION_TERMINAL, replacementCursors[owner.label])
        ?? owner.evidence.find(LAUNCH_SNAPSHOT_ABORT, replacementCursors[owner.label]);
      if (terminal != null) {
        throw new Error(`${owner.label}: shared session terminated before the replacement picker: ${terminal.text}`);
      }
      if (await advanceBattlePrompt()) {
        continue;
      }
      await delay(100);
    }
    if (replacementSurface == null) {
      throw new Error(`${owner.label}: timed out waiting for an actionable owned replacement picker`);
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
      const boundary = await this.assertSharedCommandFrontier(commandCursors, "wave-2-command", {
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
    const abandonedAt = Date.now();
    await this.stopChromeTrace();
    await Promise.all(Object.values(this.clients).map(client => client.reopen()));
    await this.loginBoth();
    // The worker releases a crashed pair only after the 30s presence window plus 120s hot-rejoin grace.
    // Login usually consumes most of this interval; wait only the bounded remainder before a fresh announce.
    const releaseRemainderMs = abandonedAt + COLD_REJOIN_RELEASE_MS - Date.now();
    if (releaseRemainderMs > 0) {
      for (const client of Object.values(this.clients)) {
        client.evidence.record("cold-rejoin-grace-wait", { remainingMs: releaseRemainderMs });
      }
      await delay(releaseRemainderMs);
    }
    await this.pair(requesterSeat);
  }

  async coldReplaceContextsAndLogin() {
    await this.stopChromeTrace();
    await Promise.all(Object.values(this.clients).map(client => client.replaceWithEmptyContext()));
    await this.loginBoth();
  }

  async close() {
    await this.stopChromeTrace().catch(() => {});
    for (const client of Object.values(this.clients)) {
      await client.checkpoint("final").catch(() => {});
      // Stage-timing instrumentation (optimization brief step 1): one aggregate record per
      // seat (input arbitration + checkpoint capture totals) so baselines never re-parse
      // the per-press trace.
      try {
        client.evidence.record("stage-timing-summary", client.evidence.stageTimingSummary());
      } catch {
        /* instrumentation must never fail a run */
      }
      await client.evidence.flush().catch(() => {});
    }
    await Promise.allSettled(this.browsers.map(browser => browser.close()));
  }

  assertClean() {
    const failures = [];
    for (const client of Object.values(this.clients)) {
      try {
        client.evidence.assertClean();
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `${failures.length} browser evidence failure(s): ${failures.map(error => error.message).join("; ")}`,
      );
    }
  }

  aggregateFailureWithBrowserEvidence(primary) {
    const failure = primary instanceof Error ? primary : new Error(String(primary));
    try {
      this.assertClean();
      return failure;
    } catch (error) {
      const browserFailure = error instanceof Error ? error : new Error(String(error));
      return new AggregateError(
        [failure, browserFailure],
        `${failure.message}; browser evidence: ${browserFailure.message}`,
      );
    }
  }
}
