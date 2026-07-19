/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadCampaignLifecyclePolicy, withinDeadline } from "./campaign-lifecycle.mjs";
import {
  findOwnedActionableMysteryPartySurface,
  findOwnedActionableReplacementSurface,
  isActionableSemanticObservation,
  isPartyPickerSurfaceOpen,
  mysteryPartyTargetOptionId,
  selectOptionById,
} from "./campaign-nav.mjs";
import {
  buildDispatchTable,
  GAME_OVER_PHASE,
  LOCAL_COMMAND,
  loadCampaignPolicy,
  REWARD_PHASE,
  SHARED_SESSION_TERMINAL,
} from "./campaign-policy.mjs";
import { delay } from "./evidence.mjs";
import { assertMarketCoverage, driveTargetedMarket } from "./market-journey.mjs";

const START_PHASE = /Start Phase (\w+)/u;
const OUTCOME_PROGRESS_PHASE = /Start Phase ([A-Za-z0-9]+Phase)/u;
const OUTCOME_PROGRESS_AUTHORITY = /\[coop:turn\] host recorder: append turn=\d+ seq=\d+/u;
const OUTCOME_PROGRESS_RENDERER = /\[coop:replay\] guest replay turn=\d+: live increment seq=\d+\.\.\d+/u;
const OUTCOME_PROGRESS_RESOLUTION = /\[coop:replay\] guest (?:RECV turnResolution|awaitTurn turn=\d+ RESOLVE)/u;
const GUEST_FAINT_PICKER = /guest own-faint picker OPEN/u;
const HOST_SWITCH_PHASE = /Start Phase SwitchPhase/u;
const TURN_PROGRESS = /Start Phase TurnStartPhase|host recorder: begin turn=/u;
const AUTHORITY_MOVE_EFFECT = /Start Phase MoveEffectPhase/u;
const RENDERER_MOVE_REPLAY = /Start Phase CoopMoveAnimReplayPhase/u;
const RENDERER_MOVE_SKIPPED = /present move .* NO-OP end \(user=.* anims=false\)/u;
const POST_MYSTERY_PHASE = /Start Phase PostMysteryEncounterPhase/u;
const BARGAIN_OWNER_TERMINAL = /bargain OWNER terminal: outcome blob sent/u;
const BARGAIN_WATCHER_TERMINAL = /bargain WATCHER: outcome blob received -> converging/u;
const BATTLE_PROMPT_PHASES = new Map([
  // Battle narration is rendered by MessageUiHandler from several phase classes (SummonPhase,
  // ShowTrainerPhase, replay phases, and MessagePhase itself). The semantic surface's prompt
  // generation is the actionable identity; only EXP needs an exact phase-class restriction.
  ["battle:message", null],
  ["battle:exp", "ExpPhase"],
]);
const ANIMATION_PROGRESS_ALLOWANCE_MS = 90_000;
const OUTCOME_HARD_CEILING_MS = 360_000;
// Track R cycle 13 - animations-on-surface profile calibration (integration-owner authorized).
// INVESTIGATION FIRST: this is NOT generic timeout inflation. The launch config already sets every
// anti-throttling flag (--disable-background-timer-throttling / --disable-backgrounding-occluded-windows
// / --disable-renderer-backgrounding, see DuoPublicUiRig.launch), so there is no rAF-throttling defect to
// fix. The runner has NO hardware GPU - Xvfb has no GL device, so Phaser renders through Chromium's
// SwiftShader software WebGL (--use-gl=angle --use-angle=swiftshader-webgl), and TWO Chromium game loops
// share four cores. Under that the per-EVENT move-animation cost is genuinely irreducible: measured ~18s
// per streamed battle event (a real GPU client renders one in ~1-3s). A dense ~24-event turn therefore
// needs ~440s of WALL CLOCK while sync stays byte-correct (per-turn checksums matched); the 360s default
// ceiling expired it mid-animation even though nothing had diverged. The animations-on ceiling is derived
// from that measured per-event cost times a bounded max turn-event count (with headroom over the observed
// 24). It applies to the animations-on-surface profile ONLY - every other profile keeps
// OUTCOME_HARD_CEILING_MS untouched (the depth/mystery profiles skip animations and never approach it).
const ANIMATIONS_ON_MEASURED_PER_EVENT_MS = 18_000;
const ANIMATIONS_ON_MAX_TURN_EVENTS = 32;
const ANIMATIONS_ON_OUTCOME_HARD_CEILING_MS = ANIMATIONS_ON_MEASURED_PER_EVENT_MS * ANIMATIONS_ON_MAX_TURN_EVENTS;

function fromEach(clients, fn) {
  return Object.fromEntries(clients.map(client => [client.label, fn(client)]));
}

const DIGEST_PARTS = /\[coop-browser:digest-parts\] (\{.*\})/u;

/** The most recent per-mon innate ids ({player, enemy}) a client emitted, or null. */
function latestInnates(client) {
  const events = client.evidence.events;
  for (let i = events.length - 1; i >= 0; i--) {
    const match = DIGEST_PARTS.exec(events[i].text ?? "");
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.innates) {
          return parsed.innates;
        }
      } catch {
        // A malformed diagnostic line is skipped.
      }
    }
  }
  return null;
}

/**
 * Innate-activation invariant check (maintainer-directed): the passive-digest fix must not disable ER
 * innates. At the first battle surface assert the ace-difficulty enemy's innates are LIVE and that both
 * browsers compute IDENTICAL innate ids (the real correctness). Player innates are starterData-gated, so
 * a fresh account may have none - only cross-browser consistency is required there.
 */
function assertInnatesLive(rig) {
  const clients = Object.values(rig.clients);
  const perClient = clients.map(client => ({ client, innates: latestInnates(client) }));
  if (perClient.some(entry => entry.innates == null)) {
    for (const { client } of perClient) {
      client.evidence.record("innate-check", { status: "skipped", reason: "no digest-parts innate marker captured" });
    }
    return;
  }
  const canonical = JSON.stringify(perClient[0].innates);
  const consistent = perClient.every(entry => JSON.stringify(entry.innates) === canonical);
  const enemyLive = perClient.map(entry => ({
    label: entry.client.label,
    live: (entry.innates.enemy ?? []).some(mon => Array.isArray(mon) && mon.some(id => id !== -1)),
  }));
  for (const entry of perClient) {
    entry.client.evidence.record("innate-check", {
      crossBrowserConsistent: consistent,
      enemyInnatesLive: enemyLive.find(e => e.label === entry.client.label)?.live ?? false,
      enemy: entry.innates.enemy,
      player: entry.innates.player,
    });
  }
  if (!consistent) {
    throw new Error(
      `innate-check: innate ids DIVERGE between browsers (regression): ${perClient.map(e => `${e.client.label}=${JSON.stringify(e.innates)}`).join(" | ")}`,
    );
  }
  const dead = enemyLive.filter(e => !e.live);
  if (dead.length > 0) {
    throw new Error(
      `innate-check: ace-difficulty enemy innates NOT live on ${dead.map(e => e.label).join(",")}; enemy innates=${JSON.stringify(perClient[0].innates.enemy)}`,
    );
  }
}

/** Structured per-wave campaign progress log written next to the harness evidence. */
class CampaignProgress {
  constructor(artifactDir) {
    this.path = resolve(artifactDir, "campaign-progress.jsonl");
    this.tail = Promise.resolve();
    // Stage-timing instrumentation (optimization brief step 1): every row carries its
    // delta since the previous row and since run start, so each existing note/wave
    // boundary doubles as a measured stage with NO new call sites. `rows` mirrors the
    // file for the end-of-run rollup.
    this.startedMs = performance.now();
    this.lastRowMs = this.startedMs;
    this.rows = [];
  }

  append(row) {
    const nowMs = performance.now();
    const timed = {
      at: new Date().toISOString(),
      sinceLastMs: Math.round(nowMs - this.lastRowMs),
      sinceStartMs: Math.round(nowMs - this.startedMs),
      ...row,
    };
    this.lastRowMs = nowMs;
    this.rows.push(timed);
    const line = `${JSON.stringify(timed)}\n`;
    this.tail = this.tail.then(() => appendFile(this.path, line));
    return this.tail;
  }

  /**
   * Ordered stage rollup for the acceptance budgets: every note/wave/summary row with
   * its delta. Written as ONE small machine-readable file at run end so before/after
   * comparisons never re-parse the whole trace.
   */
  stageRollup() {
    return {
      totalMs: Math.round(performance.now() - this.startedMs),
      stages: this.rows.map(r => ({
        kind: r.kind,
        message: r.message ?? r.wave ?? null,
        sinceLastMs: r.sinceLastMs,
        sinceStartMs: r.sinceStartMs,
      })),
    };
  }

  async writeStageRollup() {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      resolve(dirname(this.path), "stage-timing.json"),
      `${JSON.stringify(this.stageRollup(), null, 2)}\n`,
    );
  }

  note(message, detail = {}) {
    return this.append({ kind: "note", message, ...detail });
  }

  wave(row) {
    return this.append({ kind: "wave", ...row });
  }

  summary(row) {
    return this.append({ kind: "summary", ...row });
  }

  async flush() {
    await this.tail;
  }
}

/** Bounded per-step observation window for the state-aware Settings walk. */
const SPEED_STEP_OBSERVATION_TIMEOUT_MS = 1500;

/**
 * How long a SINGLE-sided command frontier must survive (no reward / wipe / faint / two-sided
 * frontier superseding it) before it is trusted as the next turn. The renderer seat's wave-end
 * transient CommandPhase was superseded ~13s later under CI's ~3fps starvation (run
 * 29551213918); the window must comfortably outlast that gap while staying far below the
 * per-turn budget.
 */
const SINGLE_SIDED_COMMAND_CONFIRM_MS = 20_000;

/**
 * Classify WHICH input layer dropped a key using the entry probe's diagnostics
 * (raw DOM keydown counter + Phaser frame counter + visibility/focus): run 29548390234
 * proved the blind walk can dispatch 12 keys with zero game reaction and no way to name
 * the broken layer. Diagnostics only - quoted in the step-exhaustion error.
 */
function inputLayerDiagnosis(client, from) {
  const health = client.evidence.findLastInputHealth(from)?.observation ?? null;
  const echo = client.evidence.findLastInputEcho(from)?.observation ?? null;
  if (health == null) {
    return "no input-health heartbeat since the step began: raw DOM keydowns never arrived - input was lost at the browser/CDP dispatch layer";
  }
  const layer =
    health.frameAdvancing === false
      ? "DOM keydowns arrived but the Phaser frame counter is FROZEN - the game loop is stalled (visibility/RAF)"
      : "DOM keydowns arrived and the game loop is stepping - the key was dropped inside the game's input pipeline";
  const echoSuffix = echo == null ? "" : ` lastEcho=${echo.uiMode}:${echo.cursor}:${echo.phase}`;
  return `${layer} (domKeys=${health.domKeys} lastKey=${health.lastKey} frame=${health.frame} vis=${health.vis} foc=${health.foc}${echoSuffix})`;
}

/**
 * Press `key` until `readObservation` reports `target`, one observed reaction per press.
 * Every press waits for the game's OWN emitted observation (bounded), so a swallowed key
 * is retried instead of silently desynchronizing the rest of a blind sequence. At the
 * midpoint of a dead run, one `recoveryKey` nudge models a real player's reaction to an
 * unresponsive menu. Exhaustion throws with the input-layer diagnosis.
 */
async function pressUntilObserved(
  client,
  key,
  purpose,
  readObservation,
  target,
  { attempts = 8, recoveryKey = null } = {},
) {
  const stepStart = client.evidence.cursor();
  if (readObservation(client.evidence, 0) === target) {
    return;
  }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const pressCursor = client.evidence.cursor();
    await client.press(key, `${purpose}:attempt-${attempt}`);
    try {
      const observed = await client.evidence.waitForCondition(sink => readObservation(sink, pressCursor), {
        timeoutMs: SPEED_STEP_OBSERVATION_TIMEOUT_MS,
        description: `${purpose} observed reaction`,
      });
      if (observed === target) {
        return;
      }
    } catch {
      if (recoveryKey != null && attempt === Math.ceil(attempts / 2)) {
        await client.press(recoveryKey, `${purpose}:recovery`);
      }
    }
  }
  throw new Error(
    `${client.label}: ${purpose} - no expected reaction after ${attempts} attempts; ${inputLayerDiagnosis(client, stepStart)}`,
  );
}

/** Latest observed Title-menu selection (semanticId) at/after `from`. */
function titleSelection(sink, from) {
  return sink.findLastSemanticSurface(from, "title-menu")?.observation.selectedOptionId;
}

/** Latest observed Settings Game Speed value at/after `from` (present only while Settings is open). */
function observedGameSpeed(sink, from) {
  return sink.findLastRenderProfileObservation(from)?.observation.gameSpeed;
}

/**
 * Early Game Speed 10x raise through the visible Settings UI. Default path is
 * OBSERVATION-GATED: each public key press is verified against the game's own surface
 * observations (Title selection semanticIds / the Settings render-profile attestation)
 * with bounded retries - the former blind 12-key replay dispatched keys with no
 * verification and desynchronized wholesale when a single key was swallowed
 * (run 29548390234: 12 keys, zero observed reactions, blind 120s timeout). A NON-EMPTY
 * `COOP_UI_SPEED_KEYS` still replays that exact sequence blind (maintainer escape
 * hatch), and `[]` still skips the raise entirely. Public keyboard input only - no
 * game-state seams, no coop-runtime surface.
 */
async function raiseGameSpeed(rig, policy, progress) {
  const clients = Object.values(rig.clients);
  const keys = policy.keys.speed;
  if (keys.length === 0) {
    for (const client of clients) {
      client.evidence.record("campaign-speed", { status: "skipped", reason: "COOP_UI_SPEED_KEYS not set" });
    }
    await progress.note(
      "speed-raise skipped: set COOP_UI_SPEED_KEYS to a verified Title->Settings->GameSpeed sequence",
    );
    return;
  }
  for (const client of clients) {
    const speedCursor = client.evidence.cursor();
    if (policy.keys.speedKeysFromEnv) {
      // Maintainer-supplied sequence: replay verbatim (blind), as before.
      await client.sequence(keys, "raise-game-speed-to-10x");
      await delay(client.config.settleDelayMs);
    } else {
      // 1) Title menu -> the Settings row, selection-verified per press.
      await pressUntilObserved(client, "ArrowDown", "speed-walk-title-to-settings", titleSelection, "settings");
      // 2) Open Settings: ANY render-profile observation proves the General menu is open.
      const openCursor = client.evidence.cursor();
      await pressUntilObserved(
        client,
        "Space",
        "speed-walk-open-settings",
        (sink, from) =>
          sink.findLastRenderProfileObservation(Math.max(from, openCursor)) == null ? undefined : "open",
        "open",
        { attempts: 3 },
      );
      // 3) Game Speed is the first row; step RIGHT until the observer attests 10x. The row
      //    WRAPS ([2,3,4,5,7,10] -> 2), so allow a full second lap if a double-step overshoots.
      await pressUntilObserved(client, "ArrowRight", "speed-walk-raise-to-10x", observedGameSpeed, 10, {
        attempts: 12,
      });
      // 4) Close Settings and park the Title cursor back on New Game for pairing. If the
      //    Backspace was swallowed the ArrowUps move the (still open) Settings cursor and
      //    the Title selection never changes - the midpoint recovery Backspace re-closes.
      await client.press("Backspace", "speed-walk-close-settings");
      await pressUntilObserved(client, "ArrowUp", "speed-walk-title-to-new-game", titleSelection, "new-game", {
        recoveryKey: "Backspace",
      });
    }
    const attestation = await client.evidence.waitForCondition(sink => sink.findGameSpeed(10, speedCursor), {
      timeoutMs: client.config.timeoutMs,
      description: "visible Settings Game Speed=10 attestation",
    });
    client.evidence.record("campaign-speed", {
      status: "attested",
      gameSpeed: attestation.observation.gameSpeed,
      keys: policy.keys.speedKeysFromEnv ? keys : "observation-gated",
    });
    await client.checkpoint("speed-raised");
  }
  await progress.note("speed-raise observer-attested (Game Speed -> 10x via Settings UI)");
}

/**
 * Select and attest one of the two explicit rendering-fidelity profiles through the real
 * Display Settings UI. The browser observer only reports the applied value; every change
 * is still a public keyboard action and both clients leave a screenshot on the selected row.
 */
async function configureRenderProfile(rig, policy, progress) {
  const clients = Object.values(rig.clients);
  const expected = policy.moveAnimationsExpected;
  for (const client of clients) {
    const openCursor = client.evidence.cursor();
    await client.sequence(policy.keys.renderProfileOpen, `open-render-profile-${policy.renderProfile}`);
    let attestation = await client.evidence.waitForCondition(
      sink => sink.findRenderProfile(true, openCursor) ?? sink.findRenderProfile(false, openCursor),
      {
        timeoutMs: rig.config.timeoutMs,
        description: "visible Display Settings move-animation attestation",
      },
    );
    if (attestation.observation.moveAnimations !== expected) {
      const toggleCursor = client.evidence.cursor();
      await client.sequence(policy.keys.renderProfileToggle, `toggle-render-profile-${policy.renderProfile}`);
      attestation = await client.evidence.waitForCondition(sink => sink.findRenderProfile(expected, toggleCursor), {
        timeoutMs: rig.config.timeoutMs,
        description: `Move Animations=${expected ? "On" : "Off"} after visible Settings toggle`,
      });
    }
    await delay(client.config.settleDelayMs);
    client.evidence.record("campaign-render-profile", {
      profile: policy.renderProfile,
      moveAnimations: attestation.observation.moveAnimations,
      fidelity: expected
        ? "move-animation rendering covered"
        : "move-animation rendering intentionally skipped; mechanics/network/public UI retained",
    });
    await client.checkpoint(`render-profile-${policy.renderProfile}-selected`);
    await client.sequence(policy.keys.renderProfileClose, `close-render-profile-${policy.renderProfile}`);
  }
  await progress.note("render profile visibly selected and observer-attested", {
    renderProfile: policy.renderProfile,
    moveAnimations: expected,
    fidelity: expected
      ? "move-animation rendering covered"
      : "move-animation rendering intentionally skipped; mechanics/network/public UI retained",
  });
}

/** Prove the selected profile actually governed at least one authoritative/replayed move. */
async function assertRenderProfileExecution(rig, policy, progress) {
  const authorityMove = rig.host.evidence.find(AUTHORITY_MOVE_EFFECT);
  if (!authorityMove) {
    throw new Error(`${policy.renderProfile}: no authoritative MoveEffectPhase was observed`);
  }
  const rendererEvidence = policy.moveAnimationsExpected
    ? rig.guest.evidence.find(RENDERER_MOVE_REPLAY)
    : rig.guest.evidence.find(RENDERER_MOVE_SKIPPED);
  if (!rendererEvidence) {
    throw new Error(
      policy.moveAnimationsExpected
        ? "animations-on-surface: renderer never ran a CoopMoveAnimReplayPhase"
        : "animations-skipped-depth: renderer never attested a move-animation NO-OP with anims=false",
    );
  }
  const proof = {
    renderProfile: policy.renderProfile,
    moveAnimations: policy.moveAnimationsExpected,
    authorityMoveEventIndex: authorityMove.index,
    rendererMoveEventIndex: rendererEvidence.index,
  };
  rig.host.evidence.record("campaign-render-profile-proof", proof);
  rig.guest.evidence.record("campaign-render-profile-proof", proof);
  await progress.note("render profile governed real battle execution", proof);
}

/** Clients whose submitted command has not yet opened the real turn/replay path. */
export function clientsAwaitingTurnProgress(rig, from) {
  return Object.values(rig.clients).filter(client => !client.evidence.find(TURN_PROGRESS, from[client.label] ?? 0));
}

export function findOwnedCommandFrontier(client, from) {
  const semantic = client.evidence.findLastSemanticSurface(from);
  if (
    semantic?.observation.surfaceId === "command:command"
    && semantic.observation.ready?.handlerActive === true
    && semantic.observation.phase === "CommandPhase"
    && semantic.observation.uiMode === "COMMAND"
    && semantic.observation.localSeat === client.publicSeat
    && semantic.observation.seatsWithInput?.includes(client.publicSeat)
  ) {
    return semantic;
  }
  // Once this browser exposes semantic surface evidence, its latest observation is the
  // current public UI. Never resurrect a historical command (or its legacy console line)
  // after a reward, narration, party picker, or other surface has superseded it.
  if (semantic != null) {
    return null;
  }
  return client.evidence.find(LOCAL_COMMAND, from);
}

function commandFrontierIdentity(client, event) {
  const observation = event.observation;
  if (observation == null) {
    return JSON.stringify([client.label, "legacy", event.index]);
  }
  const address = observation.address;
  const hasStableGeneration =
    address != null || observation.phaseInstance != null || observation.surfaceGeneration != null;
  return JSON.stringify([
    client.label,
    address?.epoch ?? null,
    address?.wave ?? null,
    address?.turn ?? null,
    observation.phaseInstance ?? null,
    observation.surfaceGeneration ?? null,
    hasStableGeneration ? null : event.index,
  ]);
}

/** Every player has reached its own actionable command UI, using semantic evidence first. */
export function allClientsAtOwnedCommandFrontier(clients, from) {
  return clients.every(client => findOwnedCommandFrontier(client, from[client.label] ?? 0) != null);
}

/**
 * Drive only the clients whose first command never entered the turn path. A valid but CPU-starved
 * browser turn can take much longer than the short fallback window. Run 29312876722 proved that
 * blindly replaying the whole fallback on BOTH clients in that state smears its keys across damage,
 * faint and EXP messages. Progress evidence makes the fallback selective instead.
 */
export async function driveBattleFallback(rig, keys, from, purpose) {
  const pending = clientsAwaitingTurnProgress(rig, from);
  await Promise.all(pending.map(client => client.sequence(keys, `${purpose}-${client.label}`)));
  return pending;
}

function currentSharedCommandAddress(clients, purpose) {
  const addresses = clients.map(client => {
    const observation = client.evidence.findLastSurface("command")?.observation;
    return observation == null ? null : `${observation.epoch}:${observation.wave}:${observation.turn}`;
  });
  if (addresses.some(address => address == null) || new Set(addresses).size !== 1) {
    throw new Error(`${purpose}: battle prompt advancement requires one shared public command address`);
  }
  return addresses[0];
}

/**
 * Public-input driver for readiness-proven per-client battle messages.
 *
 * Both ordinary MessagePhase narration (for example, "Wild Yungoos fainted!") and ExpPhase can
 * block the authoritative phase queue on a human ACTION. The read-only semantic observer publishes
 * them only with the handler's complete `isAwaitingPromptAction()` contract, the exact current
 * shared command address, and a phase-instance discriminator. One distinct ready instance
 * authorizes exactly one Space on that same public client. Most renderer phases are passive, but a
 * narrated CoopFaintReplayPhase opens a real local MessagePhase prompt too; run 29321837675 proved
 * leaving that readiness signal undriven prevents the guest from applying/ACKing the completed turn
 * forever.
 */
export function createBattlePromptAdvancer(
  rig,
  from,
  stats,
  purpose,
  { requireSharedCommandAddress = true, expectedCommandAddress = null } = {},
) {
  if (!rig.host) {
    throw new Error(`${purpose}: battle prompt advancement requires the authenticated public host`);
  }
  const clients = Object.values(rig.clients);
  // Ordinary battles derive the address from both clients' last public command surface. Commander is
  // intentionally asymmetric: the hidden Tatsugiri owner must never expose that surface. Its strict
  // read-only Commander observation already proves one shared epoch/wave/turn, so that caller supplies
  // the exact address instead of weakening prompt admission to any live battle address.
  const expectedAddress =
    expectedCommandAddress ?? (requireSharedCommandAddress ? currentSharedCommandAddress(clients, purpose) : null);
  const cursors = new Map(clients.map(client => [client.label, from[client.label] ?? 0]));
  const consumedInstances = new Set();
  return async () => {
    for (const client of clients) {
      const readyEvent = client.evidence.events.slice(cursors.get(client.label) ?? 0).find(event => {
        if (event.kind !== "browser-surface2") {
          return false;
        }
        const observation = event.observation;
        const expectedPhase = BATTLE_PROMPT_PHASES.get(observation.surfaceId);
        const observedAddress = `${observation.address?.epoch}:${observation.address?.wave}:${observation.address?.turn}`;
        const hasLiveBattleAddress =
          Number.isSafeInteger(observation.address?.epoch)
          && Number.isSafeInteger(observation.address?.wave)
          && observation.address.wave > 0
          && Number.isSafeInteger(observation.address?.turn)
          && observation.address.turn > 0;
        const instanceKey = `${client.label}:${observation.surfaceId}:${observation.phaseInstance}`;
        return (
          BATTLE_PROMPT_PHASES.has(observation.surfaceId)
          && (expectedAddress == null ? hasLiveBattleAddress : observedAddress === expectedAddress)
          && (expectedPhase == null || observation.phase === expectedPhase)
          && observation.uiMode === "MESSAGE"
          && observation.ownerModel === "local"
          && observation.coop === true
          && observation.seatsWithInput?.includes(observation.localSeat)
          && Number.isSafeInteger(observation.phaseInstance)
          && observation.ready?.handlerActive === true
          && observation.ready?.awaitingActionInput === true
          && !consumedInstances.has(instanceKey)
        );
      });
      if (!readyEvent) {
        continue;
      }
      // A live party picker (faint replacement OR a Mystery-encounter `selectPokemonForOption`
      // sub-prompt) means the intro/narration chain has ALREADY yielded to the party UI: the matched
      // message event is stale, and one more Space would fall through into the picker and select a
      // default slot (run 29613070126: the faint picker's fainted-field submenu lacks send-out, so
      // the slot drive threw "target not in options"; the ME party class is the same fall-through
      // hazard). Leave the picker to driveReplacement / driveMysteryPartyPicker.
      const latestSurface = client.evidence.findLastSemanticSurface(cursors.get(client.label) ?? 0);
      if (isPartyPickerSurfaceOpen(latestSurface?.observation)) {
        continue;
      }
      cursors.set(client.label, readyEvent.index + 1);
      const { surfaceId, phase, phaseInstance } = readyEvent.observation;
      consumedInstances.add(`${client.label}:${surfaceId}:${phaseInstance}`);
      const statName = phase === "ExpPhase" ? "postBattleExpPrompts" : "battleMessagePrompts";
      stats[statName] = (stats[statName] ?? 0) + 1;
      client.evidence.record("campaign-battle-prompt-advance", {
        surfaceId,
        phase,
        phaseInstance,
        readyEventIndex: readyEvent.index,
        promptOrdinal: stats[statName],
        inputSeat: client.label,
        authority: client === rig.host,
      });
      await client.press("Space", `${purpose}-${client.label}-${surfaceId}-${stats[statName]}`);
      return true;
    }
    return false;
  };
}

/**
 * Advance the OWNER's post-pick Mystery-encounter narration prompts.
 *
 * After the owner chooses an ME option the encounter types its outcome text as a chain of
 * `mystery-encounter:message` prompts (operationClass "encounter-prompt", ownerModel "interaction").
 * The authoritative host parks in MysteryEncounterPhase and the replaying guest in CoopReplayMePhase,
 * BOTH awaiting the OWNER seat's advance. The between-wave battle-prompt advancer ignores these -
 * they are not in BATTLE_PROMPT_PHASES - so nothing pressed them and both seats stalled until the
 * deadline (run 29644735938). This presses Space once PER PROMPT GENERATION for the owner seat only,
 * keyed by phaseInstance in a consumed-instance set exactly like createBattlePromptAdvancer (the
 * product bumps phaseInstance per narration message, so distinct prompts are distinct). The owner
 * client matches: its interaction surface stamps ownerSeat === localSeat and seatsWithInput =
 * [ownerSeat], while the watcher's projection carries the same seatsWithInput = [ownerSeat] with its
 * own localSeat != ownerSeat and is therefore never pressed - exactly a human at the owner seat.
 *
 * GUEST-OWNED ME (#816): the authoritative HOST additionally drives its OWN MysteryEncounterPhase
 * engine MESSAGE dialogue, because ui.ts lets the host advance that dialogue itself while the guest
 * owns the ME (the guest renderer's CoopReplayMePhase Space never relays to the host). Without it the
 * host's outcome narration parks forever after the owner's option pick.
 */
export function createMysteryNarrationAdvancer(rig, from, stats, purpose) {
  const clients = Object.values(rig.clients);
  const cursors = new Map(clients.map(client => [client.label, from[client.label] ?? 0]));
  const consumedInstances = new Set();
  // Keep this aligned with Ui.coopMeInteractivePhase(): these are the production phases whose
  // MESSAGE handlers can participate in the owner/watcher ME input pump. Run 29672540141 selected
  // a guest-owned option successfully, advanced its selected-option dialogue, and then left the
  // authoritative host visibly parked in MysteryEncounterOptionSelectedPhase because the browser
  // driver admitted only the opening MysteryEncounterPhase. A real player can and must advance
  // that prompt too. The surface/operation/readiness/ownership fences below remain the authority;
  // this set only names the phase classes in which that exact public prompt is valid.
  const interactiveMysteryPhases = new Set([
    "MysteryEncounterPhase",
    "MysteryEncounterOptionSelectedPhase",
    "MysteryEncounterRewardsPhase",
    "PostMysteryEncounterPhase",
    "ErQuizPhase",
    "CoopReplayMePhase",
  ]);
  return async () => {
    for (const client of clients) {
      const readyEvent = client.evidence.events.slice(cursors.get(client.label) ?? 0).find(event => {
        if (event.kind !== "browser-surface2") {
          return false;
        }
        const observation = event.observation;
        const instanceKey = `${client.label}:${observation.surfaceId}:${observation.phaseInstance}`;
        // The OWNER seat advances its own ME narration prompt: its interaction surface stamps ownerSeat
        // === localSeat with seatsWithInput = [ownerSeat]; the watcher's projection carries the same
        // seatsWithInput with a DIFFERENT localSeat and is therefore never pressed - a human at the owner.
        const ownerDrives =
          observation.localSeat === observation.ownerSeat
          && observation.seatsWithInput?.includes(observation.ownerSeat)
          && observation.seatsWithInput?.includes(observation.localSeat);
        // #816 (GUEST-owned ME): the authoritative HOST runs the sole ME engine (MysteryEncounterPhase)
        // and, per ui.ts processInputCoopAware, ADVANCES ITS OWN engine MESSAGE dialogue itself while a
        // GUEST owns the ME - the guest renderer (CoopReplayMePhase) cannot drive the host's authoritative
        // narration (its Space advances only the local replay, never relays), so NOTHING else presses the
        // host's outcome prompt and MysteryEncounterPhase parks forever (Track R mystery-gauntlet lane,
        // wave-1 ME: host stalled at an actionable mystery-encounter:message awaiting the owner seat). The
        // host is NOT the owner here (localSeat !== ownerSeat) and its engine dialogue omits the owner seat
        // from its own input, so this branch is disjoint from ownerDrives and never fires on a host-owned ME.
        const hostEngineDialogue =
          client === rig.host
          && observation.phase === "MysteryEncounterPhase"
          && observation.localSeat !== observation.ownerSeat;
        return (
          observation.surfaceId === "mystery-encounter:message"
          && observation.operationClass === "encounter-prompt"
          && interactiveMysteryPhases.has(observation.phase)
          && observation.uiMode === "MESSAGE"
          && observation.ownerModel === "interaction"
          && observation.coop === true
          && (ownerDrives || hostEngineDialogue)
          && Number.isSafeInteger(observation.phaseInstance)
          && observation.ready?.handlerActive === true
          && observation.ready?.awaitingActionInput === true
          && !consumedInstances.has(instanceKey)
        );
      });
      if (!readyEvent) {
        continue;
      }
      // Same picker-guard as the battle-prompt advancer: once the ME has yielded to a party
      // sub-prompt (`selectPokemonForOption`), the last narration prompt is stale and one more Space
      // would fall through into the party UI. Leave the picker to driveMysteryPartyPicker.
      const latestSurface = client.evidence.findLastSemanticSurface(cursors.get(client.label) ?? 0);
      if (isPartyPickerSurfaceOpen(latestSurface?.observation)) {
        continue;
      }
      cursors.set(client.label, readyEvent.index + 1);
      const { surfaceId, phase, phaseInstance, ownerSeat } = readyEvent.observation;
      consumedInstances.add(`${client.label}:${surfaceId}:${phaseInstance}`);
      stats.mysteryNarrationPrompts = (stats.mysteryNarrationPrompts ?? 0) + 1;
      client.evidence.record("campaign-mystery-narration-advance", {
        surfaceId,
        phase,
        phaseInstance,
        readyEventIndex: readyEvent.index,
        promptOrdinal: stats.mysteryNarrationPrompts,
        inputSeat: client.label,
        ownerSeat,
      });
      await client.press("Space", `${purpose}-${client.label}-mystery-narration-${stats.mysteryNarrationPrompts}`);
      return true;
    }
    return false;
  };
}

/**
 * Bound a browser outcome wait by both a normal deadline and a larger hard ceiling while
 * allowing a newly observed real move-animation phase to refresh part of the budget.
 *
 * Two built Chromium clients can heavily dilate Phaser tweens on the standard four-core
 * runner. Run 29319610458 measured a nominal 13-frame Vine Whip animation taking 26.31s,
 * so a later 33-frame Mega Drain legitimately crossed the turn-wide timeout even though its
 * tween was still advancing. A phase event is therefore evidence of progress, but never an
 * excuse to wait forever: each distinct animation phase gets a bounded allowance and the
 * whole outcome wait remains capped by one immutable hard deadline.
 */
export function createAnimationProgressBudget(
  rig,
  from,
  baseTimeoutMs,
  {
    now = () => Date.now(),
    animationAllowanceMs = ANIMATION_PROGRESS_ALLOWANCE_MS,
    hardCeilingMs = OUTCOME_HARD_CEILING_MS,
  } = {},
) {
  const clients = Object.values(rig.clients);
  const startedAtMs = now();
  const hardDeadlineMs = startedAtMs + Math.max(baseTimeoutMs, hardCeilingMs);
  let deadlineMs = Math.min(startedAtMs + baseTimeoutMs, hardDeadlineMs);
  const scanOffsets = new Map(clients.map(client => [client.label, from[client.label] ?? 0]));

  const observeClient = client => {
    const scanFrom = scanOffsets.get(client.label) ?? 0;
    const events = client.evidence.events.slice(scanFrom);
    scanOffsets.set(client.label, client.evidence.events.length);
    for (const event of events) {
      const text = event.text ?? "";
      const phase = OUTCOME_PROGRESS_PHASE.exec(text)?.[1] ?? null;
      const progress =
        phase
        ?? (OUTCOME_PROGRESS_AUTHORITY.test(text) ? "authority-stream" : null)
        ?? (OUTCOME_PROGRESS_RENDERER.test(text) ? "renderer-stream" : null)
        ?? (OUTCOME_PROGRESS_RESOLUTION.test(text) ? "turn-resolution" : null);
      if (progress == null) {
        continue;
      }
      const parsedEventAtMs = Date.parse(event.at ?? "");
      const eventAtMs = Number.isFinite(parsedEventAtMs) ? Math.max(parsedEventAtMs, startedAtMs) : now();
      const previousDeadlineMs = deadlineMs;
      deadlineMs = Math.min(hardDeadlineMs, Math.max(deadlineMs, eventAtMs + animationAllowanceMs));
      client.evidence.record("campaign-animation-budget", {
        phase: progress,
        phaseEventIndex: event.index,
        phaseObservedAt: event.at ?? null,
        phaseMonotonicMs: event.monotonicMs ?? null,
        waitStartedAt: new Date(startedAtMs).toISOString(),
        previousDeadlineAt: new Date(previousDeadlineMs).toISOString(),
        extendedDeadlineAt: new Date(deadlineMs).toISOString(),
        hardDeadlineAt: new Date(hardDeadlineMs).toISOString(),
        baseTimeoutMs,
        animationAllowanceMs,
        extensionApplied: deadlineMs > previousDeadlineMs,
        hardCeilingReached: deadlineMs === hardDeadlineMs,
      });
    }
  };

  const observe = () => {
    clients.forEach(observeClient);
    return deadlineMs;
  };

  return Object.freeze({
    observe,
    deadline: () => deadlineMs,
    hardDeadline: () => hardDeadlineMs,
  });
}

/** Poll the post-turn outcome markers for a bounded window; null on timeout (no throw). */
export async function waitForOutcomeBounded(
  rig,
  from,
  timeoutMs,
  {
    stopOnTurnProgress = false,
    stopOnOwnedCommandFrontier = false,
    advanceBattlePrompt = null,
    extendForAnimationProgress = false,
    // Per-profile animation-aware hard ceiling (Track R cycle 13). Null = the default
    // OUTCOME_HARD_CEILING_MS; only the animations-on-surface caller passes the calibrated value, so no
    // other profile's budget changes. Ignored unless extendForAnimationProgress is set.
    animationHardCeilingMs = null,
    singleSidedConfirmMs = 0,
  } = {},
) {
  const clients = Object.values(rig.clients);
  const fixedDeadline = Date.now() + timeoutMs;
  const animationBudget = extendForAnimationProgress
    ? createAnimationProgressBudget(
        rig,
        from,
        timeoutMs,
        animationHardCeilingMs == null ? {} : { hardCeilingMs: animationHardCeilingMs },
      )
    : null;
  const confirmationHardDeadline =
    (animationBudget?.hardDeadline() ?? fixedDeadline) + Math.max(0, singleSidedConfirmMs);
  let singleSidedCandidate = null;
  while (true) {
    const deadline = animationBudget?.observe() ?? fixedDeadline;
    // A mid-battle wipe / game-over is a real run END, not a driver softlock: classify it
    // distinctly so the campaign still produces clean evidence instead of a generic hang.
    if (
      clients.some(
        client =>
          client.evidence.find(GAME_OVER_PHASE, from[client.label])
          || client.evidence.find(SHARED_SESSION_TERMINAL, from[client.label]),
      )
    ) {
      return { kind: "wipe" };
    }
    if (clients.every(client => client.evidence.find(REWARD_PHASE, from[client.label]))) {
      return { kind: "reward" };
    }
    for (const client of clients) {
      if (findOwnedActionableReplacementSurface(client, from[client.label])) {
        return { kind: "faint", client };
      }
      if (
        client.evidence.find(GUEST_FAINT_PICKER, from[client.label])
        || client.evidence.find(HOST_SWITCH_PHASE, from[client.label])
      ) {
        return { kind: "faint", client };
      }
    }
    if (allClientsAtOwnedCommandFrontier(clients, from)) {
      return { kind: "command" };
    }
    if (stopOnOwnedCommandFrontier) {
      const commandCandidate = clients
        .map(client => ({
          client,
          event: findOwnedCommandFrontier(client, from[client.label]),
        }))
        .find(candidate => candidate.event != null);
      if (commandCandidate == null) {
        singleSidedCandidate = null;
      } else {
        // A SINGLE-sided command frontier can be a wave-end transient: the pure-renderer seat
        // locally opens its next CommandPhase for a few (starved) frames before the
        // authoritative wave resolution supersedes it with the reward flow (run 29551213918,
        // surface profile: transient command:command w1t4 4s before reward-shop, then a blind
        // frontier-convergence timeout). Confirm it for a bounded window: if a reward / wipe /
        // faint / TWO-sided frontier lands first, that outcome wins; only a frontier that
        // SURVIVES the window is a real next turn. Zero window preserves legacy behavior.
        if (singleSidedConfirmMs <= 0) {
          return { kind: "command", client: commandCandidate.client };
        }
        const identity = commandFrontierIdentity(commandCandidate.client, commandCandidate.event);
        if (singleSidedCandidate?.identity !== identity) {
          singleSidedCandidate = {
            identity,
            client: commandCandidate.client,
            sinceMs: Date.now(),
          };
        }
        if (Date.now() - singleSidedCandidate.sinceMs >= singleSidedConfirmMs) {
          return { kind: "command", client: commandCandidate.client };
        }
      }
    }
    if (stopOnTurnProgress && clientsAwaitingTurnProgress(rig, from).length === 0) {
      return { kind: "turn-progress" };
    }
    if (advanceBattlePrompt && (await advanceBattlePrompt())) {
      continue;
    }
    // Drain evidence once before honoring the deadline. Under severe event-loop dilation the timer callback
    // can resume after the immutable ceiling even though the commit/reward event was already buffered.
    if (Date.now() >= deadline) {
      // A provisional frontier may first appear near the ordinary fallback deadline. Give that
      // exact identity its full confirmation window so fallback keys never smear across a live
      // command UI, but cap all replacements at one immutable extra window.
      const candidateDeadline =
        singleSidedCandidate == null
          ? deadline
          : Math.min(singleSidedCandidate.sinceMs + singleSidedConfirmMs, confirmationHardDeadline);
      if (Date.now() < candidateDeadline) {
        await delay(Math.min(100, candidateDeadline - Date.now()));
        continue;
      }
      break;
    }
    await delay(100);
  }
  return null;
}

/**
 * Drive one battle wave: attack-first per turn, one fallback move-cycle, faints handled.
 * Returns "reward" when the wave is won and the shop is open, or "wipe" when the shared
 * session ends (game-over) mid-battle. Throws only on a genuine softlock (no reward, no
 * wipe, no progress within budget) - named distinctly from a wipe so a lost wave reads as
 * evidence, not a harness bug.
 */
async function driveBattleWave(rig, policy, stats) {
  const clients = Object.values(rig.clients);
  let commandCursors = fromEach(clients, client => findOwnedCommandFrontier(client, 0)?.index ?? 0);
  let pendingCommandProof = null;
  const fallbackWindow = Math.min(rig.config.timeoutMs, 15_000);
  for (let turn = 1; turn <= rig.config.maxTurns; turn++) {
    const purpose = `wave-${stats.wave}-turn-${turn}`;
    if (pendingCommandProof != null) {
      // The previous round's "next command" may have been a wave-end transient (renderer-local
      // CommandPhase superseded by the authoritative reward flow). Probe the wave-end markers
      // once BEFORE pressing more battle keys, so no key is ever driven into the reward shop.
      const superseded = await waitForOutcomeBounded(rig, pendingCommandProof.cursors, 1, {});
      if (superseded?.kind === "reward") {
        await rig.assertSharedSurface(
          "reward",
          pendingCommandProof.cursors,
          `${pendingCommandProof.name}-superseded-by-reward`,
          {
            expectedWave: rig.activeBattleWave,
          },
        );
        await rig.assertRetainedContinuation(
          pendingCommandProof.cursors,
          `${pendingCommandProof.name}-superseded-by-reward`,
        );
        return "reward";
      }
      if (superseded?.kind === "wipe") {
        return "wipe";
      }
    }
    const { outcomeCursors, expectedCommandAddress } = await rig.driveSequentialCommandRound(
      commandCursors,
      policy.keys.battle,
      `${purpose}-attack-first`,
    );
    if (pendingCommandProof != null) {
      try {
        await rig.assertSharedCommandFrontier(pendingCommandProof.cursors, pendingCommandProof.name, {
          expectedWave: rig.activeBattleWave,
          expectedAddress: expectedCommandAddress,
        });
        await rig.assertRetainedContinuation(pendingCommandProof.cursors, pendingCommandProof.name);
      } catch (error) {
        // Belt-and-braces for the wave-end transient (see the pre-round probe above): if the
        // frontier never converged because the wave actually ENDED, honor the real outcome.
        const superseded = await waitForOutcomeBounded(rig, pendingCommandProof.cursors, 1, {});
        if (superseded?.kind === "reward") {
          await rig.assertSharedSurface(
            "reward",
            pendingCommandProof.cursors,
            `${pendingCommandProof.name}-superseded-by-reward`,
            { expectedWave: rig.activeBattleWave },
          );
          await rig.assertRetainedContinuation(
            pendingCommandProof.cursors,
            `${pendingCommandProof.name}-superseded-by-reward`,
          );
          return "reward";
        }
        if (superseded?.kind === "wipe") {
          return "wipe";
        }
        throw error;
      }
      pendingCommandProof = null;
    }
    stats.turns = turn;
    const from = outcomeCursors;
    const advanceBattlePrompt = createBattlePromptAdvancer(rig, from, stats, purpose, {
      expectedCommandAddress,
    });
    let outcome = await waitForOutcomeBounded(rig, from, fallbackWindow, {
      stopOnTurnProgress: true,
      stopOnOwnedCommandFrontier: true,
      singleSidedConfirmMs: SINGLE_SIDED_COMMAND_CONFIRM_MS,
    });
    const fallbackClients = [];
    let turnProgressed = false;
    if (outcome?.kind === "turn-progress") {
      turnProgressed = true;
      rig.host.evidence.record("campaign-turn-progress", {
        wave: stats.wave,
        turn,
        fallbackSuppressed: true,
        reason: "both public clients entered the addressed turn path",
      });
      outcome = await waitForOutcomeBounded(rig, from, rig.config.timeoutMs, {
        advanceBattlePrompt,
        extendForAnimationProgress: true,
        animationHardCeilingMs: policy.moveAnimationsExpected ? ANIMATIONS_ON_OUTCOME_HARD_CEILING_MS : null,
        stopOnOwnedCommandFrontier: true,
        singleSidedConfirmMs: SINGLE_SIDED_COMMAND_CONFIRM_MS,
      });
    }
    if (!outcome && !turnProgressed) {
      // Attack-first did not resolve or fully enter the turn (no PP / disabled / wrong target).
      // Cycle only clients lacking turn-progress evidence; never replay input on a client whose
      // valid turn is already executing under browser CPU pressure.
      fallbackClients.push(
        ...(await driveBattleFallback(rig, policy.keys.battleFallback, from, `${purpose}-fallback`)),
      );
      if (fallbackClients.length > 0) {
        stats.fallbackTurns += 1;
      }
      outcome = await waitForOutcomeBounded(rig, from, rig.config.timeoutMs, {
        advanceBattlePrompt,
        extendForAnimationProgress: true,
        animationHardCeilingMs: policy.moveAnimationsExpected ? ANIMATIONS_ON_OUTCOME_HARD_CEILING_MS : null,
        stopOnOwnedCommandFrontier: true,
        singleSidedConfirmMs: SINGLE_SIDED_COMMAND_CONFIRM_MS,
      });
    }
    if (!outcome) {
      const parked = latestStartPhase(clients);
      const fallbackDetail =
        fallbackClients.length > 0
          ? `fallback clients=${fallbackClients.map(client => client.label).join(",")}`
          : "fallback suppressed: submitted turn was already progressing";
      throw new Error(
        `[campaign-softlock] wave ${stats.wave} turn ${turn}: attack-first produced no reward, wipe, faint, `
          + `or next command within budget (${fallbackDetail}); latest phase=${parked?.name ?? "unknown"}`,
      );
    }
    if (outcome.kind === "wipe") {
      return "wipe";
    }
    if (outcome.kind === "reward") {
      await rig.assertSharedSurface("reward", from, `wave-${stats.wave}-turn-${turn}-reward`, {
        expectedWave: rig.activeBattleWave,
      });
      await rig.assertRetainedContinuation(from, `wave-${stats.wave}-turn-${turn}-reward`);
      return "reward";
    }
    if (outcome.kind === "faint") {
      stats.faints += 1;
      await rig.driveReplacement(outcome.client, from);
    }
    if (outcome.kind === "command") {
      // The next command owners open one at a time. The next sequential round proves and
      // consumes both public surfaces before asserting two-sided continuation convergence.
      pendingCommandProof = { cursors: from, name: `wave-${stats.wave}-turn-${turn}-next-command` };
    }
    commandCursors = from;
  }
  throw new Error(`[campaign-softlock] wave ${stats.wave} did not reach rewards in ${rig.config.maxTurns} rounds`);
}

/**
 * The client that reports ITSELF as owner of `surfaceId` in the v2 semantic mirror
 * (ownerSeat === its own localSeat), or null. Evidence-derived ownership - never rig.host.
 */
function findSemanticOwner(rig, surfaceId, cursors) {
  for (const client of Object.values(rig.clients)) {
    const event = client.evidence.findLastSemanticSurface(cursors[client.label] ?? 0, surfaceId);
    const observation = event?.observation;
    if (observation && observation.ownerSeat != null && observation.ownerSeat === observation.localSeat) {
      return { client, markerEvent: event };
    }
  }
  return null;
}

/**
 * Whether either browser has observed this exact semantic surface since the current
 * campaign cursor. A phase-start marker can precede its interactive UI by several
 * message prompts, so phase presence alone is not evidence that an owner marker is
 * malformed yet.
 */
function hasSemanticSurface(rig, surfaceId, cursors) {
  return Object.values(rig.clients).some(
    client => client.evidence.findLastSemanticSurface(cursors[client.label] ?? 0, surfaceId) != null,
  );
}

function semanticAppearanceIdentity(event) {
  const observation = event?.kind === "browser-surface2" ? event.observation : null;
  if (observation == null) {
    return null;
  }
  return JSON.stringify([
    observation.surfaceId,
    observation.address?.epoch,
    observation.address?.wave,
    observation.address?.turn,
    observation.phaseInstance,
    observation.surfaceGeneration,
  ]);
}

function semanticAppearanceIsNew(event, handled) {
  if (event == null) {
    return false;
  }
  const identity = semanticAppearanceIdentity(event);
  return identity == null || typeof handled !== "string" ? event.index > (handled ?? -1) : identity !== handled;
}

/**
 * Return the first registered between-wave surface observed since this wave began.
 *
 * A phase/owner marker can precede the handler's actionable semantic projection by much
 * longer than the short UNKNOWN-surface budget on a CPU-constrained Chromium runner. That
 * is a known surface waiting for production UI readiness, not an unhandled surface. Keep
 * it under the immutable between-wave deadline while preserving the short loud-fail for a
 * phase that has no driver at all.
 */
export function findRegisteredSurface(rig, dispatch, cursors, handledIndex = new Map()) {
  return (
    dispatch.find(driver => {
      // The ME PARTY sub-prompt shares the plain `party` surfaceId with a (non-driven) between-wave
      // party context, so it can only be considered "registered" via its ME-gated owned-picker finder
      // - never a bare `party` semantic presence, which would strand a non-ME party surface at the
      // deadline. Owner-only: the watcher never renders it.
      if (driver.mysteryParty) {
        return Object.values(rig.clients).some(client => {
          const event = findOwnedActionableMysteryPartySurface(client, cursors[client.label] ?? 0);
          return semanticAppearanceIsNew(event, handledIndex.get(`${driver.name}:${client.label}`));
        });
      }
      if (driver.v2SurfaceId && hasSemanticSurface(rig, driver.v2SurfaceId, cursors)) {
        return Object.values(rig.clients).some(client => {
          const event = client.evidence.findLastSemanticSurface(cursors[client.label] ?? 0, driver.v2SurfaceId);
          return semanticAppearanceIsNew(event, handledIndex.get(`${driver.name}:${client.label}`));
        });
      }
      if (driver.semanticOnly) {
        return false;
      }
      return Object.values(rig.clients).some(client => {
        const event = client.evidence.find(driver.present, cursors[client.label] ?? 0);
        return event != null && event.index > (handledIndex.get(`${driver.name}:${client.label}`) ?? -1);
      });
    }) ?? null
  );
}

/**
 * Find the OWNER client + the evidence event that identifies this appearance, or null.
 *
 * `strict` (every loud-fail run - gating + nightly; false only under the explicit
 * shakedown/auto-first ordering opt-in) forbids the role-default fallback: a surface that
 * declares a v2 semantic mirror (`v2SurfaceId`) but whose mirror never reports an owner is a
 * MISSING/MALFORMED marker, and drops the run loudly rather than silently assuming `rig.host`.
 */
export function resolveSurfaceOwner(rig, driver, cursors, handledIndex, strict) {
  const clients = Object.values(rig.clients);
  const notYetHandled = (client, event) => {
    const handled = handledIndex.get(`${driver.name}:${client.label}`);
    return event?.kind === "browser-surface2"
      ? semanticAppearanceIsNew(event, handled)
      : event != null && event.index > (handled ?? -1);
  };

  // Mystery-encounter PARTY sub-prompt (`selectPokemonForOption`): projected as the plain `party`
  // surface with `ownerModel: "local"` and `ownerSeat: null`, so the generic v2 semantic-owner path
  // (which requires `ownerSeat === localSeat`) can never resolve it. The owner is the seat that
  // rendered its own actionable ME party slot-list; the watcher never renders it. Inert for any
  // non-ME party surface (the predicate gates on `mysteryEncounterType`), so it never fires in a
  // between-wave party context.
  if (driver.mysteryParty) {
    for (const client of clients) {
      const event = findOwnedActionableMysteryPartySurface(client, cursors[client.label] ?? 0);
      if (notYetHandled(client, event)) {
        return { client, markerEvent: event };
      }
    }
    return null;
  }

  // The v2 projection is the actionable public surface and its own ownership contract. Legacy
  // OWNER lines can be emitted while preceding narration is still active, or before a campaign's
  // post-battle cursor is captured. Prefer the semantic appearance whenever a driver declares one;
  // otherwise a valid visible reward/market can be parked even though both browsers report its owner.
  if (driver.v2SurfaceId) {
    const semanticOwner = findSemanticOwner(rig, driver.v2SurfaceId, cursors);
    if (semanticOwner) {
      // Phase/owner evidence can precede the real handler by several seconds while narration or
      // transitions finish. Keyboard input in that interval is legitimately discarded. Wait for
      // the observer's addressed actionable projection; this is the same state a human sees before
      // acting and prevents a valid reward from being stranded by an early leave/pick sequence.
      if (!isActionableSemanticObservation(semanticOwner.markerEvent.observation)) {
        return null;
      }
      if (notYetHandled(semanticOwner.client, semanticOwner.markerEvent)) {
        return semanticOwner;
      }
      return null;
    }
    const semanticEvents = clients.map(client =>
      client.evidence.findLastSemanticSurface(cursors[client.label] ?? 0, driver.v2SurfaceId),
    );
    if (semanticEvents.every(event => event == null)) {
      return null;
    }
    // Watchers can publish the addressed semantic surface before the owning browser finishes the
    // preceding narration/phase transition. Treat that one-sided projection as provisional: the Mystery
    // browser campaign otherwise fails in the few seconds between the watcher's ownerSeat=partner marker
    // and the partner's own ownerSeat===localSeat mirror. Once every browser has published this surface,
    // a missing self-owner is genuinely malformed and still fails loudly.
    if (strict && semanticEvents.every(event => event != null)) {
      throw new Error(
        `[campaign-owner-evidence] surface "${driver.name}" is up but its v2 semantic mirror `
          + `(${driver.v2SurfaceId}) never reported an owner (ownerSeat === localSeat); refusing to `
          + "assume the role default. Fix the surface's marker or run the explicit shakedown opt-in.",
      );
    }
    // A watcher projection proves only that the surface exists somewhere. Do
    // not fall through to the legacy role heuristic until the authoritative
    // owner has projected its own actionable surface.
    return null;
  }

  if (driver.owner.marker) {
    for (const client of clients) {
      const event = client.evidence.find(driver.owner.marker, cursors[client.label]);
      if (notYetHandled(client, event)) {
        return { client, markerEvent: event };
      }
    }
    return null;
  }

  // Role-owned surfaces (mystery encounter host option-owner, egg host, learn-move host
  // unless the guest owns the mon). Presence is the phase marker on either client.
  let presence = null;
  for (const client of clients) {
    const event = client.evidence.find(driver.present, cursors[client.label]);
    if (notYetHandled(client, event)) {
      presence = { client, markerEvent: event };
      break;
    }
  }
  if (!presence) {
    return null;
  }
  if (driver.owner.guestMarker) {
    const guest = rig.guest;
    if (guest) {
      const guestEvent = guest.evidence.find(driver.owner.guestMarker, cursors[guest.label]);
      if (notYetHandled(guest, guestEvent)) {
        return { client: guest, markerEvent: presence.markerEvent };
      }
    }
  }
  // The surface is up (presence found) but no per-client OWNER evidence resolved it. In a
  // loud-fail run, refuse to assume the role default when the surface advertised a v2 mirror
  // that should have named the owner - a missing/malformed marker must fail, not auto-advance.
  const owner = driver.owner.role ? rig[driver.owner.role] : null;
  if (!owner) {
    return null;
  }
  return { client: owner, markerEvent: presence.markerEvent };
}

async function finalizePendingMysteryEvent(rig, stats, nextBoundary) {
  const event = stats.mysteryEvents.at(-1);
  if (event == null || event.terminal != null) {
    return;
  }
  // Some Mystery options hand off to a real battle without advancing the wave. The command
  // surface for that embedded battle is continuation, not the ME terminal. Keep the event open
  // across the outer battle-loop iteration and close it only when a causally later wave is visible.
  if (nextBoundary.wave <= event.wave) {
    return;
  }
  const clients = Object.values(rig.clients);
  if (event.kind === "bargain") {
    const owner = clients.find(client => client.publicSeat === event.ownerSeat);
    const watcher = clients.find(client => client !== owner);
    if (owner == null || watcher == null) {
      throw new Error(`[campaign-mystery] bargain wave ${event.wave} has no exact owner/watcher pair`);
    }
    await Promise.all([
      owner.evidence.waitFor(BARGAIN_OWNER_TERMINAL, {
        from: event.terminalCursors[owner.label],
        timeoutMs: rig.config.timeoutMs,
        description: `bargain wave ${event.wave} owner retained terminal`,
      }),
      watcher.evidence.waitFor(BARGAIN_WATCHER_TERMINAL, {
        from: event.terminalCursors[watcher.label],
        timeoutMs: rig.config.timeoutMs,
        description: `bargain wave ${event.wave} watcher applied terminal`,
      }),
    ]);
  } else {
    await Promise.all(
      clients.map(client =>
        client.evidence.waitFor(POST_MYSTERY_PHASE, {
          from: event.terminalCursors[client.label],
          timeoutMs: rig.config.timeoutMs,
          description: `Mystery wave ${event.wave} paired PostMystery terminal`,
        }),
      ),
    );
  }
  event.terminal = nextBoundary;
  await Promise.all(clients.map(client => client.checkpoint(`wave-${event.wave}-mystery-terminal`)));
  await Promise.all(
    clients.map(client =>
      client.checkpoint(`wave-${event.wave}-mystery-next-${nextBoundary.kind}-${nextBoundary.wave}`),
    ),
  );
}

function appendMysteryProof(rig, event, proof) {
  event.surfaces.push(proof);
  for (const client of Object.values(rig.clients)) {
    client.evidence.record("campaign-mystery-checkpoint", proof);
  }
}

async function checkpointPairedMysterySurface(rig, surfaceId, cursors, stats, stage) {
  const clients = Object.values(rig.clients);
  const events = await Promise.all(
    clients.map(client =>
      client.evidence.waitForCondition(
        sink => {
          const event = sink.findLastSemanticSurface(cursors[client.label] ?? 0, surfaceId);
          if (event == null || event.observation.ready?.handlerActive !== true) {
            return null;
          }
          const localOwns = event.observation.ownerSeat === event.observation.localSeat;
          return !localOwns || isActionableSemanticObservation(event.observation) ? event : null;
        },
        {
          timeoutMs: rig.config.timeoutMs,
          description: `paired actionable Mystery ${stage} surface ${surfaceId}`,
        },
      ),
    ),
  );
  const observations = events.map(surfaceEvent => surfaceEvent.observation);
  const first = observations[0];
  // The two engines legitimately host the SAME mystery surface from different phase classes: the
  // authoritative host sits in MysteryEncounterPhase while the replaying guest presents it from
  // CoopReplayMePhase (run 29595067992: every other field incl. the state digest matched). Compare
  // phases modulo that known pairing - a genuine divergence still differs in digest/address/options.
  const normalizeMePhase = phase => (phase === "CoopReplayMePhase" ? "MysteryEncounterPhase" : phase);
  for (const observation of observations.slice(1)) {
    const sameAddress = JSON.stringify(observation.address) === JSON.stringify(first.address);
    const sameOptions = JSON.stringify(observation.optionIds ?? null) === JSON.stringify(first.optionIds ?? null);
    if (
      observation.surfaceId !== first.surfaceId
      || normalizeMePhase(observation.phase) !== normalizeMePhase(first.phase)
      || observation.uiMode !== first.uiMode
      || observation.operationClass !== first.operationClass
      || observation.ownerSeat !== first.ownerSeat
      || observation.selectedOptionId !== first.selectedOptionId
      || observation.mysteryEncounterType !== first.mysteryEncounterType
      || observation.stateDigest !== first.stateDigest
      || !sameAddress
      || !sameOptions
    ) {
      throw new Error(`[campaign-mystery] paired ${stage} surface diverged: ${JSON.stringify(observations)}`);
    }
  }
  const proof = {
    stage,
    surfaceId,
    phase: first.phase,
    uiMode: first.uiMode,
    selectedOptionId: first.selectedOptionId ?? null,
    address: first.address,
    ownerSeat: first.ownerSeat,
    optionIds: first.optionIds ?? null,
    mysteryEncounterType: first.mysteryEncounterType ?? null,
    stateDigest: first.stateDigest ?? null,
  };
  if (stage === "presentation") {
    await finalizePendingMysteryEvent(rig, stats, {
      kind: "mystery-surface",
      wave: first.address.wave,
      address: first.address,
    });
    if (first.address.wave > stats.targetWave) {
      stats.targetBoundary = {
        kind: "mystery-surface",
        wave: first.address.wave,
        address: first.address,
      };
      await Promise.all(clients.map(client => client.checkpoint(`wave-${first.address.wave}-target-addressed`)));
      return true;
    }
  }
  let event = stats.mysteryEvents.find(candidate => candidate.wave === first.address.wave);
  if (event == null) {
    if (stage !== "presentation") {
      throw new Error(`[campaign-mystery] ${stage} appeared at wave ${first.address.wave} before a presentation`);
    }
    event = {
      kind: "mystery",
      wave: first.address.wave,
      ownerSeat: first.ownerSeat,
      mysteryEncounterType: first.mysteryEncounterType ?? null,
      surfaces: [],
      terminalCursors: fromEach(clients, client => client.evidence.cursor()),
      terminal: null,
    };
    stats.mysteryEvents.push(event);
  }
  if (event.mysteryEncounterType !== (first.mysteryEncounterType ?? null)) {
    throw new Error(
      `[campaign-mystery] encounter type changed within wave ${first.address.wave}: `
        + `${event.mysteryEncounterType} -> ${first.mysteryEncounterType ?? null}`,
    );
  }
  appendMysteryProof(rig, event, proof);
  await Promise.all(clients.map(client => client.checkpoint(`wave-${event.wave}-mystery-${stage}-${surfaceId}`)));
  return false;
}

async function checkpointAsymmetricBargainSurface(rig, cursors, stats, owner) {
  const watcher = Object.values(rig.clients).find(client => client !== owner);
  if (watcher == null) {
    throw new Error("[campaign-mystery] bargain has no watcher browser");
  }
  const ownerEvent = await owner.evidence.waitForCondition(
    sink => sink.findLastSemanticSurface(cursors[owner.label] ?? 0, "bargain"),
    { timeoutMs: rig.config.timeoutMs, description: "owner bargain surface" },
  );
  const ownerObservation = ownerEvent.observation;
  const watcherEvent = await watcher.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(cursors[watcher.label] ?? 0, "mystery-encounter:message");
      return candidate?.observation.address.wave === ownerObservation.address.wave ? candidate : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "watcher partner-bargaining projection" },
  );
  const watcherObservation = watcherEvent.observation;
  if (
    JSON.stringify(watcherObservation.address) !== JSON.stringify(ownerObservation.address)
    || watcherObservation.ownerSeat !== ownerObservation.ownerSeat
    || watcherObservation.mysteryEncounterType !== ownerObservation.mysteryEncounterType
    || watcherObservation.stateDigest !== ownerObservation.stateDigest
    || ownerObservation.ownerSeat !== owner.publicSeat
  ) {
    throw new Error(
      `[campaign-mystery] asymmetric bargain ownership/address diverged: ${JSON.stringify({ ownerObservation, watcherObservation })}`,
    );
  }
  await finalizePendingMysteryEvent(rig, stats, {
    kind: "bargain-surface",
    wave: ownerObservation.address.wave,
    address: ownerObservation.address,
  });
  const event = {
    kind: "bargain",
    wave: ownerObservation.address.wave,
    ownerSeat: ownerObservation.ownerSeat,
    mysteryEncounterType: ownerObservation.mysteryEncounterType ?? null,
    surfaces: [],
    terminalCursors: fromEach(Object.values(rig.clients), client => client.evidence.cursor()),
    terminal: null,
  };
  const proof = {
    stage: "presentation",
    surfaceId: "bargain",
    watcherSurfaceId: "mystery-encounter:message",
    address: ownerObservation.address,
    ownerSeat: ownerObservation.ownerSeat,
    optionIds: ownerObservation.optionIds ?? null,
    mysteryEncounterType: ownerObservation.mysteryEncounterType ?? null,
    stateDigest: ownerObservation.stateDigest ?? null,
  };
  stats.mysteryEvents.push(event);
  appendMysteryProof(rig, event, proof);
  await Promise.all(
    Object.values(rig.clients).map(client => client.checkpoint(`wave-${event.wave}-mystery-presentation-bargain`)),
  );
}

/**
 * Every symmetric registered interface is also a mechanical convergence boundary. This turns the
 * semantic observer into a generic future-screen contract: adding a driver without matching the
 * authority address and state digest on both real browsers cannot silently green the campaign.
 */
async function checkpointPairedMechanicalSurface(rig, surfaceId, cursors, owner) {
  const ownerEvent = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(cursors[owner.label] ?? 0, surfaceId);
      return candidate != null && isActionableSemanticObservation(candidate.observation) ? candidate : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: `actionable owner surface ${surfaceId}` },
  );
  const authority = ownerEvent.observation;
  if (authority.stateDigest == null) {
    throw new Error(`[campaign-convergence] ${surfaceId} omitted its mechanical state digest`);
  }
  const peers = Object.values(rig.clients).filter(client => client !== owner);
  const peerEvents = await Promise.all(
    peers.map(peer =>
      peer.evidence.waitForCondition(
        sink => {
          const candidate = sink.findLastSemanticSurface(cursors[peer.label] ?? 0, surfaceId);
          if (
            candidate == null
            || candidate.observation.ready?.handlerActive !== true
            || JSON.stringify(candidate.observation.address) !== JSON.stringify(authority.address)
            || candidate.observation.stateDigest !== authority.stateDigest
          ) {
            return null;
          }
          return candidate;
        },
        {
          timeoutMs: rig.config.timeoutMs,
          description: `paired address/digest convergence for ${surfaceId} on ${peer.label}`,
        },
      ),
    ),
  );
  const proof = {
    surfaceId,
    address: authority.address,
    stateDigest: authority.stateDigest,
    ownerSeat: authority.ownerSeat,
    peers: peerEvents.map(event => event.observation.localSeat),
  };
  for (const client of Object.values(rig.clients)) {
    client.evidence.record("campaign-semantic-convergence", proof);
  }
  return { authority, ownerEvent, peerEvents };
}

/**
 * A party-target reward is intentionally asymmetric while the owner chooses: the owner
 * opens PARTY and the watcher stays parked on its read-only reward replica. Prove that
 * both projections carry one address, owner and mechanical digest before sending input.
 */
async function checkpointRewardPartyTarget(rig, cursors, owner) {
  const ownerEvent = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(cursors[owner.label] ?? 0, "party:reward-target");
      return candidate != null && isActionableSemanticObservation(candidate.observation) ? candidate : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "actionable reward party-target owner" },
  );
  const authority = ownerEvent.observation;
  if (authority.stateDigest == null) {
    throw new Error("[campaign-convergence] party:reward-target omitted its mechanical state digest");
  }
  const watcher = Object.values(rig.clients).find(client => client !== owner);
  if (watcher == null) {
    throw new Error("[campaign-convergence] party:reward-target has no paired watcher");
  }
  const watcherEvent = await watcher.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(cursors[watcher.label] ?? 0, "reward-shop");
      const observation = candidate?.observation;
      return observation != null
        && observation.ready?.handlerActive === true
        && observation.ownerSeat === owner.publicSeat
        && observation.seatsWithInput?.includes(owner.publicSeat)
        && !observation.seatsWithInput?.includes(watcher.publicSeat)
        && JSON.stringify(observation.address) === JSON.stringify(authority.address)
        && observation.stateDigest === authority.stateDigest
        ? candidate
        : null;
    },
    {
      timeoutMs: rig.config.timeoutMs,
      description: `reward watcher parked at party-target address on ${watcher.label}`,
    },
  );
  const proof = {
    surfaceId: "party:reward-target",
    watcherSurfaceId: "reward-shop",
    address: authority.address,
    stateDigest: authority.stateDigest,
    ownerSeat: owner.publicSeat,
    watcherSeat: watcher.publicSeat,
  };
  for (const client of Object.values(rig.clients)) {
    client.evidence.record("campaign-semantic-convergence", proof);
  }
  return { authority, ownerEvent, peerEvents: [watcherEvent] };
}

async function driveRewardPartyTarget(rig, driver, owner, boundary) {
  const targetSlot = driver.partySlot ?? 0;
  let event = boundary.ownerEvent;
  const selectedCursor = () => /^party-slot:(\d+)$/u.exec(event.observation.selectedOptionId ?? "");
  const match = selectedCursor();
  if (match == null) {
    throw new Error(`[campaign-reward-target] ${owner.label} exposed no stable party cursor before target selection`);
  }
  let cursor = Number(match[1]);
  for (let attempt = 0; cursor !== targetSlot && attempt < 12; attempt++) {
    const key = cursor < targetSlot ? "ArrowDown" : "ArrowUp";
    const nextCursor = cursor + (key === "ArrowDown" ? 1 : -1);
    const priorIndex = event.index;
    await owner.press(key, `campaign-reward-target-slot-${targetSlot}`);
    event = await owner.evidence.waitForCondition(
      sink => {
        const candidate = sink.findLastSemanticSurface(priorIndex + 1, "party:reward-target");
        return candidate?.observation.selectedOptionId === `party-slot:${nextCursor}` ? candidate : null;
      },
      { timeoutMs: rig.config.timeoutMs, description: `reward party cursor ${targetSlot}` },
    );
    cursor = nextCursor;
  }
  if (cursor !== targetSlot) {
    throw new Error(`[campaign-reward-target] could not reach party slot ${targetSlot} from ${cursor}`);
  }

  const optionCursor = owner.evidence.cursor();
  await owner.press("Space", "campaign-reward-target-open-action");
  const optionEvent = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(optionCursor, "party:reward-target");
      const observation = candidate?.observation;
      const selected = observation?.selectedOptionId;
      return observation != null
        && JSON.stringify(observation.address) === JSON.stringify(boundary.authority.address)
        && observation.stateDigest === boundary.authority.stateDigest
        && Array.isArray(observation.optionIds)
        && observation.optionIds.length > 0
        && typeof selected === "string"
        && selected.startsWith("party-option:")
        && selected !== "party-option:cancel"
        && isActionableSemanticObservation(observation)
        ? candidate
        : null;
    },
    {
      timeoutMs: rig.config.timeoutMs,
      description: `semantic reward action for party slot ${targetSlot}`,
    },
  );
  owner.evidence.record("campaign-reward-target-action", {
    address: boundary.authority.address,
    ownerSeat: owner.publicSeat,
    partySlot: targetSlot,
    selectedOptionId: optionEvent.observation.selectedOptionId,
    optionIds: optionEvent.observation.optionIds,
  });
  await owner.press("Space", `campaign-reward-target-apply-${optionEvent.observation.selectedOptionId}`);
}

/**
 * Drive the OWNER seat's mystery-encounter PARTY sub-prompt (`selectPokemonForOption`, e.g.
 * PART_TIMER). Only the owning browser opens the party UI; a guest owner relays its slot pick to
 * the authoritative host, a host owner applies it locally, and the watcher never renders the
 * surface. Pick a legal party slot from the observer-proven slot list, then confirm through the mon
 * action submenu's `select` option - the SAME semantic-surface + generation-keyed navigation idiom
 * driveOwnedReplacementPicker uses, never a blind key macro, and gated to the picker-open cursor so
 * a stale prompt can never fall through into a default slot.
 */
async function driveMysteryPartyPicker(rig, owner, cursors, stats) {
  const from = cursors[owner.label] ?? 0;
  // Wait for the actionable owned slot-list projection. The finder rejects the mid-descent submenu
  // form (party-option:* ids) and every non-ME party context (mysteryEncounterType == null).
  const deadline = Date.now() + rig.config.timeoutMs;
  let slotSurface = null;
  while (Date.now() < deadline) {
    slotSurface = findOwnedActionableMysteryPartySurface(owner, from);
    if (slotSurface != null) {
      break;
    }
    const terminal = owner.evidence.find(SHARED_SESSION_TERMINAL, from) ?? owner.evidence.find(GAME_OVER_PHASE, from);
    if (terminal != null) {
      throw new Error(
        `${owner.label}: shared session terminated before the Mystery party sub-prompt: ${terminal.text}`,
      );
    }
    await delay(100);
  }
  if (slotSurface == null) {
    throw new Error(`${owner.label}: timed out waiting for an actionable owned Mystery party sub-prompt`);
  }
  const targetOptionId = mysteryPartyTargetOptionId(slotSurface.observation);
  if (targetOptionId == null) {
    throw new Error(
      `${owner.label}: Mystery party sub-prompt exposed no in-battle-eligible party slot: `
        + `${JSON.stringify(slotSurface.observation.partySlots ?? null)}`,
    );
  }
  // Record the sub-prompt against this wave's mystery event so the gauntlet surface tally includes it.
  const event = stats.mysteryEvents.find(candidate => candidate.wave === slotSurface.observation.address.wave);
  if (event != null) {
    appendMysteryProof(rig, event, {
      stage: "party",
      surfaceId: "party",
      phase: slotSurface.observation.phase,
      uiMode: slotSurface.observation.uiMode,
      selectedOptionId: slotSurface.observation.selectedOptionId ?? null,
      address: slotSurface.observation.address,
      ownerSeat: owner.publicSeat,
      optionIds: slotSurface.observation.optionIds ?? null,
      mysteryEncounterType: slotSurface.observation.mysteryEncounterType ?? null,
      stateDigest: slotSurface.observation.stateDigest ?? null,
    });
  }
  await owner.checkpoint(`wave-${stats.wave}-mystery-party-slot`);
  const slotCursor = owner.evidence.cursor();
  // 1) Navigate to the legal slot and open its mon action submenu.
  await selectOptionById(owner, {
    surfaceId: "party",
    targetId: targetOptionId,
    navKeys: ["ArrowDown", "ArrowUp"],
    submitKey: "Space",
    timeoutMs: rig.config.timeoutMs,
    fromCursor: from,
  });
  // 2) PartyUiMode.SELECT opens the mon action SUBMENU (PartyOption.SELECT). Wait for its actionable
  // projection (party-option:* ids), then confirm `select` to commit the pick.
  const submenuSurface = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(slotCursor, "party");
      const observation = candidate?.observation;
      return observation?.optionIds?.includes("party-option:select")
        && isActionableSemanticObservation(observation, { requireExplicitUnblocked: true })
        ? candidate
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: `Mystery party action submenu for ${targetOptionId}` },
  );
  await selectOptionById(owner, {
    surfaceId: "party",
    targetId: "party-option:select",
    navKeys: ["ArrowDown", "ArrowUp"],
    submitKey: "Space",
    timeoutMs: rig.config.timeoutMs,
    fromCursor: submenuSurface.index,
  });
  owner.evidence.record("campaign-mystery-party-pick", {
    address: slotSurface.observation.address,
    ownerSeat: owner.publicSeat,
    targetOptionId,
    mysteryEncounterType: slotSurface.observation.mysteryEncounterType ?? null,
  });
}

/**
 * A leave action is two separate public surfaces, not a timing-based key macro. Open
 * the confirmation, prove that exact addressed handler is actionable, and only then
 * submit the remaining key(s). This is load-bearing on throttled remote Chromium.
 */
export async function driveConfirmedLeave(rig, driver, owner, authority, waveStartCursors = null) {
  const [openConfirmKey, ...confirmKeys] = driver.keys;
  if (!openConfirmKey || confirmKeys.length === 0 || !driver.confirmSurfaceId) {
    throw new Error(`[campaign-readiness] ${driver.name} semantic leave has no open/confirm key split`);
  }
  const clients = Object.values(rig.clients);
  const watcher = clients.find(client => client !== owner);
  if (watcher == null) {
    throw new Error(`[campaign-readiness] ${driver.name} semantic leave has no paired watcher`);
  }
  const confirmationCursors = fromEach(clients, client => client.evidence.cursor());
  // The watcher's non-actionable reward-shop replica is a STABLE state: on a throttled runner whose
  // semantic-digest budget is blown (Track R dirty lane wave-3: the guest logged "mechanical digest p95
  // 70.7ms exceeds the 50ms budget") the guest emits that projection ONCE and holds it, rather than
  // re-emitting across the owner's confirm navigation. checkpointPairedMechanicalSurface already CONVERGED
  // on (and consumed) that single projection, so scanning the watcher from confirmationCursors - captured
  // AFTER the convergence - finds no fresh emission and times out even though the guest is correctly parked
  // ("timed out waiting for non-actionable reward watcher at .../3/3"). Scan the watcher from the wave-start
  // cursor instead, so the already-proven, address-pinned non-actionable replica still satisfies the wait.
  // The invariant is intact: findAddressedRewardWatcher returns the LATEST reward-shop and requires
  // awaitingActionInput === false at the exact authority address, so a watcher that ever turned actionable
  // still fails. The owner-confirm half is unchanged (its reward:confirm surface only appears post-open).
  const watcherRewardFrom = waveStartCursors?.[watcher.label] ?? confirmationCursors[watcher.label];
  await owner.press(openConfirmKey, `campaign-${driver.name}-open-confirm`);

  let ownerConfirm;
  if (driver.confirmSurfaceId === "reward:confirm") {
    [ownerConfirm] = await Promise.all([
      owner.waitForOwnedRewardConfirm(confirmationCursors[owner.label], authority.address),
      watcher.waitForAddressedRewardWatcher(watcherRewardFrom, owner.publicSeat, authority.address),
    ]);
  } else {
    ownerConfirm = await owner.evidence.waitForCondition(
      sink => {
        const candidate = sink.findLastSemanticSurface(confirmationCursors[owner.label], driver.confirmSurfaceId);
        const observation = candidate?.observation;
        return observation != null
          && observation.localSeat === owner.publicSeat
          && observation.ownerSeat === owner.publicSeat
          && observation.seatsWithInput?.includes(owner.publicSeat)
          && observation.selectedOptionId === "yes"
          && JSON.stringify(observation.address) === JSON.stringify(authority.address)
          && observation.stateDigest === authority.stateDigest
          && isActionableSemanticObservation(observation)
          ? candidate
          : null;
      },
      {
        timeoutMs: rig.config.timeoutMs,
        description: `actionable ${driver.confirmSurfaceId} at the exact ${driver.name} address`,
      },
    );
  }
  const proof = {
    surface: driver.name,
    confirmSurfaceId: driver.confirmSurfaceId,
    address: authority.address,
    stateDigest: authority.stateDigest,
    ownerSeat: owner.publicSeat,
    confirmationEventIndex: ownerConfirm.index,
  };
  for (const client of clients) {
    client.evidence.record("campaign-semantic-confirmation-barrier", proof);
  }
  for (const [index, key] of confirmKeys.entries()) {
    await owner.press(key, `campaign-${driver.name}-confirm:${index + 1}/${confirmKeys.length}`);
  }
}

/** Drive at most one pending between-wave surface. Returns the surface name driven, or null. */
async function driveOnePendingSurface(rig, dispatch, cursors, handledIndex, stats, strict) {
  for (const driver of dispatch) {
    const resolved = resolveSurfaceOwner(rig, driver, cursors, handledIndex, strict);
    if (!resolved) {
      continue;
    }
    const { client } = resolved;
    const mysteryStage =
      driver.name === "mystery-encounter"
        ? "presentation"
        : driver.name === "mystery-bargain"
          ? "bargain"
          : driver.name.startsWith("mystery-")
            ? "subprompt"
            : driver.name === "reward" && stats.mysteryEvents.some(event => event.terminal == null)
              ? "reward"
              : null;
    let mechanicalBoundary = null;
    if (driver.mysteryParty) {
      // The ME PARTY sub-prompt is OWNER-ONLY: only the owning browser opens the party UI
      // (`selectPokemonForOption`); the watcher never renders it, so the paired-mystery checkpoint
      // (which awaits the surface on BOTH clients) would hang. Its owner-only convergence + drive
      // live in driveMysteryPartyPicker below.
    } else if (mysteryStage === "bargain") {
      await checkpointAsymmetricBargainSurface(rig, cursors, stats, client);
    } else if (mysteryStage != null && driver.v2SurfaceId) {
      const targetReached = await checkpointPairedMysterySurface(rig, driver.v2SurfaceId, cursors, stats, mysteryStage);
      if (targetReached) {
        return "target-reached";
      }
    } else if (driver.name === "reward-target") {
      mechanicalBoundary = await checkpointRewardPartyTarget(rig, cursors, client);
    } else if (driver.v2SurfaceId) {
      mechanicalBoundary = await checkpointPairedMechanicalSurface(rig, driver.v2SurfaceId, cursors, client);
    }
    await client.checkpoint(`wave-${stats.wave}-${driver.name}-owner`);
    if (driver.name === "biome-shop" && driver.market?.mode === "target-held") {
      stats.market = await driveTargetedMarket(rig, cursors, driver.market);
    } else if (driver.name === "reward-target" && mechanicalBoundary != null) {
      await driveRewardPartyTarget(rig, driver, client, mechanicalBoundary);
    } else if (driver.mysteryParty) {
      await driveMysteryPartyPicker(rig, client, cursors, stats);
    } else if (driver.confirmSurfaceId && mechanicalBoundary != null) {
      await driveConfirmedLeave(rig, driver, client, mechanicalBoundary.authority, cursors);
    } else {
      await client.sequence(driver.keys, `campaign-${driver.name}`);
    }
    client.evidence.record("campaign-surface", { surface: driver.name, ownerSeat: client.label });
    stats.surfaces.push({ surface: driver.name, ownerSeat: client.label });
    // Suppress THIS appearance on every client that shows it, keyed by each client's OWN
    // event index (evidence indices are per-client and not cross-comparable). Both clients
    // log the phase marker for role-owned surfaces, so mark both to avoid a double drive.
    const suppress = driver.owner.marker ?? driver.present;
    for (const c of Object.values(rig.clients)) {
      const seen = c.evidence.findLast(suppress, cursors[c.label]);
      if (seen) {
        handledIndex.set(`${driver.name}:${c.label}`, seen.index);
      }
      if (driver.v2SurfaceId) {
        const semantic = c.evidence.findLastSemanticSurface(cursors[c.label], driver.v2SurfaceId);
        if (semantic) {
          handledIndex.set(`${driver.name}:${c.label}`, semanticAppearanceIdentity(semantic));
        }
      }
    }
    return driver.name;
  }
  return null;
}

/** The most recent `Start Phase <Name>` across both clients, by monotonic time (comparable in-process). */
function latestStartPhase(clients) {
  let best = null;
  for (const client of clients) {
    const event = client.evidence.findLast(START_PHASE);
    if (!event) {
      continue;
    }
    const match = START_PHASE.exec(event.text ?? "");
    if (match && (best == null || (event.monotonicMs ?? 0) >= best.monotonicMs)) {
      best = { name: match[1], monotonicMs: event.monotonicMs ?? 0, client };
    }
  }
  return best;
}

/**
 * A signature that changes whenever EITHER client emits a new Start Phase line. Evidence
 * indices are per-client, so progress is the pair of per-client last-phase indices, not a
 * single cross-client max.
 */
function phaseProgressSignature(clients) {
  return clients.map(client => client.evidence.findLast(START_PHASE)?.index ?? -1).join(",");
}

function currentPairedBattleKind(rig, wave) {
  const observations = Object.values(rig.clients).map(client => {
    const event = client.evidence.findLastSurface("command");
    if (event?.observation.wave !== wave) {
      throw new Error(`[campaign-mystery] ${client.label} has no current command observation for wave ${wave}`);
    }
    return event.observation;
  });
  const first = observations[0];
  const fields = observation => ({
    battleType: observation.battleType,
    trainerBoss: observation.trainerBoss,
    maxBossSegments: observation.maxBossSegments,
  });
  if (
    observations.slice(1).some(observation => JSON.stringify(fields(observation)) !== JSON.stringify(fields(first)))
  ) {
    throw new Error(`[campaign-mystery] battle kind diverged at wave ${wave}: ${JSON.stringify(observations)}`);
  }
  return { wave, ...fields(first) };
}

/**
 * Leave the reward shop and drive every between-wave interactive surface (biome shop,
 * crossroads, biome pick, mystery encounters, learn-move, eggs) until both clients reach
 * the next wave's command surface, or the shared session terminates.
 *
 * Any interactive surface that parks the phase pump with no registered driver is the
 * campaign's UNKNOWN case: it fails loudly by the phase name from console evidence, or
 * (COOP_UI_AUTO_FIRST=1) presses through logging `[auto-first] <phase>` - the exact
 * loud-fail / auto-first contract the headless autopilot enforces.
 */
async function advanceToNextWaveCommand(rig, policy, waveOrdinal, stats, surfaceCursors) {
  const clients = Object.values(rig.clients);
  const dispatch = buildDispatchTable(policy);
  const handledIndex = new Map();
  // Owner markers for reward/biome/crossroads/etc. are searched from the wave start
  // (surfaceCursors); the next command and terminal are searched from the post-battle
  // cursor so this wave's own commands never read as the next wave.
  const commandCursors = fromEach(clients, client => client.evidence.cursor());
  const advanceBattlePrompt = createBattlePromptAdvancer(
    rig,
    commandCursors,
    stats,
    `wave-${waveOrdinal}-between-wave`,
    { requireSharedCommandAddress: false },
  );
  // The owner's post-pick Mystery narration prompts (mystery-encounter:message) are not battle
  // prompts, so advanceBattlePrompt ignores them; without this both seats park after the ME option
  // pick (host in MysteryEncounterPhase, guest in CoopReplayMePhase) until the deadline.
  const advanceMysteryNarration = createMysteryNarrationAdvancer(
    rig,
    commandCursors,
    stats,
    `wave-${waveOrdinal}-mystery-narration`,
  );
  const deadline = Date.now() + rig.config.timeoutMs * 3;
  let stallSince = 0;
  let lastPhaseProgress = phaseProgressSignature(clients);
  let lastRegisteredSurface = null;
  let drivenSurfacePhaseSignature = null;

  while (Date.now() < deadline) {
    if (
      clients.some(
        client =>
          client.evidence.find(SHARED_SESSION_TERMINAL, commandCursors[client.label])
          || client.evidence.find(GAME_OVER_PHASE, commandCursors[client.label]),
      )
    ) {
      return { status: "terminal" };
    }

    if (clients.some(client => findOwnedCommandFrontier(client, commandCursors[client.label]) != null)) {
      const boundary = await rig.assertSharedCommandFrontier(commandCursors, `wave-${waveOrdinal}-advance`, {
        allowAddressRepeat: true,
      });
      rig.activeBattleWave = boundary.wave;
      await finalizePendingMysteryEvent(rig, stats, {
        kind: "command",
        wave: boundary.wave,
        address: { epoch: boundary.epoch, wave: boundary.wave, turn: boundary.turn },
        stateDigest: boundary.stateDigest,
      });
      if (stats.market != null) {
        stats.market.continuation = {
          status: "command",
          epoch: boundary.epoch,
          wave: boundary.wave,
          turn: boundary.turn,
          stateDigest: boundary.stateDigest,
        };
      }
      return { status: "continue", boundary };
    }

    // Loud-fail (strict) unless the explicit shakedown/auto-first ordering opt-in is set: the same
    // gate that permits press-through of an unknown surface also permits the role-default fallback.
    const drove = await driveOnePendingSurface(rig, dispatch, surfaceCursors, handledIndex, stats, !policy.autoFirst);
    if (drove === "target-reached") {
      rig.activeBattleWave = stats.targetBoundary.wave;
      return { status: "continue", boundary: stats.targetBoundary };
    }
    if (drove) {
      stallSince = 0;
      lastRegisteredSurface = drove;
      lastPhaseProgress = phaseProgressSignature(clients);
      drivenSurfacePhaseSignature = lastPhaseProgress;
      continue;
    }

    if (await advanceBattlePrompt()) {
      stallSince = 0;
      lastRegisteredSurface = null;
      lastPhaseProgress = phaseProgressSignature(clients);
      drivenSurfacePhaseSignature = lastPhaseProgress;
      continue;
    }

    if (await advanceMysteryNarration()) {
      stallSince = 0;
      lastRegisteredSurface = null;
      lastPhaseProgress = phaseProgressSignature(clients);
      drivenSurfacePhaseSignature = lastPhaseProgress;
      continue;
    }

    const phaseSignature = phaseProgressSignature(clients);
    if (drivenSurfacePhaseSignature === phaseSignature) {
      // The public input was spent on a readiness-proven handler, but its reciprocal
      // material/continuation barrier has not started another phase yet. This is still
      // completion of the registered surface, bounded by the immutable outer deadline.
      stallSince = 0;
      await delay(150);
      continue;
    }
    drivenSurfacePhaseSignature = null;

    // A registered surface can be visible while its real handler is still animating or
    // typing narration. Run 29436980968 needed 15.5s for reward-shop readiness on a loaded
    // Chromium runner; treating it as UNKNOWN after 8s made the gold-standard campaign fail
    // before a human could act. The immutable outer deadline still catches a handler that
    // never becomes ready or a handled surface that never completes.
    const registeredSurface = findRegisteredSurface(rig, dispatch, surfaceCursors, handledIndex);
    if (registeredSurface != null) {
      lastRegisteredSurface = registeredSurface.name;
      stallSince = 0;
      await delay(150);
      continue;
    }

    if (phaseSignature !== lastPhaseProgress) {
      lastPhaseProgress = phaseSignature;
      lastRegisteredSurface = null;
      stallSince = 0;
    } else if (stallSince === 0) {
      stallSince = Date.now();
    } else if (Date.now() - stallSince > policy.stallMs) {
      const parked = latestStartPhase(clients);
      const name = parked?.name ?? "unknown";
      if (policy.autoFirst) {
        for (const client of clients) {
          await client.press("Space", `auto-first-${name}-action`);
          await client.press("Backspace", `auto-first-${name}-cancel`);
          client.evidence.record("campaign-auto-first", { surface: name });
        }
        stats.autoFirst.push(name);
        process.stdout.write(`[auto-first] ${name}\n`);
        stallSince = 0;
      } else {
        throw new Error(
          `[campaign-unknown] Unhandled interactive surface parked the campaign: phase=${name} `
            + `(wave ordinal ${waveOrdinal}). Add a driver or set COOP_UI_AUTO_FIRST=1 to press through.`,
        );
      }
    }
    await delay(150);
  }

  const parked = latestStartPhase(clients);
  if (lastRegisteredSurface != null) {
    throw new Error(
      `[campaign-readiness] registered surface ${lastRegisteredSurface} never became actionable or completed `
        + `before the between-wave deadline; latest phase=${parked?.name ?? "unknown"}`,
    );
  }
  throw new Error(
    `wave ${waveOrdinal}: clients never reached the next command surface before the between-wave deadline; `
      + `latest phase=${parked?.name ?? "unknown"}`,
  );
}

/** The 30-wave (default) co-op campaign, driven end to end through public UI only. */
export async function runCampaign(rig) {
  const policy = loadCampaignPolicy();
  const lifecycle = loadCampaignLifecyclePolicy();
  const progress = new CampaignProgress(rig.config.artifactDir);
  const clients = Object.values(rig.clients);
  await progress.note("campaign start", {
    targetWaves: policy.targetWaves,
    rewardMode: policy.rewardMode,
    market: policy.market,
    renderProfile: policy.renderProfile,
    mysteryGauntlet: policy.mysteryGauntlet,
    setupTimeoutMs: lifecycle.setupTimeoutMs,
  });

  const setup = (async () => {
    await rig.loginBoth();
    await progress.note("login and fresh-account onboarding complete");
    if (policy.raiseSpeed) {
      await raiseGameSpeed(rig, policy, progress);
    }
    await configureRenderProfile(rig, policy, progress);
    await rig.pair(rig.config.requesterSeat);
    await progress.note("public lobby pairing complete");
    await rig.startFreshRun();
    await progress.note("fresh co-op run reached its first shared command surface");
    if (rig.config.expectReclaim) {
      // Dirty-account fidelity: the pre-seeded full accounts force the reclaim path, and the
      // ranking must consume the divergent slot-4 remnant BEFORE any healthy save. Assert from
      // the HOST's own console evidence (the guest may reclaim via its checkpoint persist).
      const reclaims = rig.host.evidence.events
        .filter(event => /reclaiming least-recent (save|slot)/u.test(event.text ?? ""))
        .map(event => event.text);
      if (reclaims.length === 0) {
        throw new Error(
          "[campaign-dirty-account] the seeded-full host launched WITHOUT any visible reclaim - "
            + "the dirty-account fixture did not exercise the reclaim path",
        );
      }
      if (!/slot=4/u.test(reclaims[0])) {
        throw new Error(
          `[campaign-dirty-account] first reclaim did not target the divergent slot-4 remnant: ${reclaims[0]}`,
        );
      }
      rig.host.evidence.record("campaign-dirty-account-reclaim-proof", { reclaims });
      await progress.note("dirty-account reclaim proven (divergent remnant consumed first)", { reclaims });
    }
  })();
  try {
    await withinDeadline(setup, lifecycle.setupTimeoutMs, "public setup through first shared command surface");
  } catch (error) {
    await progress.note("setup stage failed before first shared command surface", {
      setupTimeoutMs: lifecycle.setupTimeoutMs,
      error: error instanceof Error ? error.message : String(error),
    });
    await progress.writeStageRollup().catch(() => {});
    await progress.flush();
    throw error;
  }
  await progress.note("setup stage completed within immutable deadline", {
    setupTimeoutMs: lifecycle.setupTimeoutMs,
  });
  // Verify the layer-8 passive-digest fix did not disable ER innates (maintainer-directed invariant).
  assertInnatesLive(rig);
  await progress.note("innate-activation invariant checked at wave-1 command surface");

  let wavesCleared = 0;
  let battleLoops = 0;
  let status = "continue";
  const marketCoverage = { visits: [], purchases: [] };
  const mysteryCoverage = { events: [], battleKinds: [] };
  try {
    for (let ordinal = 1; ordinal <= policy.maxBattleLoops && wavesCleared < policy.targetWaves; ordinal++) {
      battleLoops = ordinal;
      const waveNo = rig.activeBattleWave;
      if (waveNo > policy.targetWaves) {
        break;
      }
      const stats = {
        wave: waveNo,
        ordinal,
        turns: 0,
        faints: 0,
        fallbackTurns: 0,
        battleMessagePrompts: 0,
        postBattleExpPrompts: 0,
        mysteryNarrationPrompts: 0,
        surfaces: [],
        // One ME can hand off to a battle at the same wave and finish only after the next outer
        // battle-loop iteration. The ledger must therefore outlive any individual stats record.
        mysteryEvents: mysteryCoverage.events,
        targetWave: policy.targetWaves,
        targetBoundary: null,
        autoFirst: [],
      };
      const battleKind = currentPairedBattleKind(rig, waveNo);
      stats.battleKind = battleKind;
      mysteryCoverage.battleKinds.push(battleKind);
      const startMs = Date.now();
      // Capture the wave-start cursor BEFORE the battle: the reward shop's OWNER marker is
      // logged when the shop opens (mid-wave), so the between-wave surface search must
      // begin here, not after the battle. Next-command/terminal detection uses the
      // post-battle cursor the advancer captures internally.
      const surfaceCursors = fromEach(clients, client => client.evidence.cursor());
      const battleResult = await driveBattleWave(rig, policy, stats);
      if (battleResult === "wipe") {
        status = "wipe";
        await Promise.all(clients.map(client => client.checkpoint(`wave-${waveNo}-wiped`)));
        await progress.wave({
          ...stats,
          replacementCountTotal: rig.replacementCount,
          ms: Date.now() - startMs,
          status,
        });
        break;
      }
      const advanced = await advanceToNextWaveCommand(rig, policy, ordinal, stats, surfaceCursors);
      if (stats.market != null) {
        marketCoverage.visits.push(stats.market);
        marketCoverage.purchases.push(...stats.market.purchases);
      }
      status = advanced.status;
      if (advanced.boundary != null) {
        wavesCleared = Math.max(wavesCleared, advanced.boundary.wave - 1);
      }
      await Promise.all(clients.map(client => client.checkpoint(`wave-${waveNo}-cleared`)));
      await progress.wave({
        ...stats,
        replacementCountTotal: rig.replacementCount,
        ms: Date.now() - startMs,
        status,
      });
      if (status !== "continue") {
        break;
      }
    }
    if (status === "continue" && wavesCleared >= policy.targetWaves) {
      await assertRenderProfileExecution(rig, policy, progress);
    }
    assertMarketCoverage(marketCoverage, policy.market);
    if (policy.mysteryGauntlet.required) {
      const expectedEvents = new Map([
        [2, "mystery"],
        [3, "mystery"],
        [4, "mystery"],
        [5, "mystery"],
        [6, "mystery"],
        [9, "bargain"],
        [10, "mystery"],
      ]);
      const missing = [...expectedEvents].filter(
        ([wave, kind]) =>
          !mysteryCoverage.events.some(
            event =>
              event.wave === wave
              && event.kind === kind
              && event.terminal != null
              && event.terminal.wave === wave + 1
              && event.surfaces.some(surface => surface.stage === "presentation"),
          ),
      );
      const unexpected = mysteryCoverage.events.filter(
        event => !expectedEvents.has(event.wave) || expectedEvents.get(event.wave) !== event.kind,
      );
      const duplicateWaves = [...new Set(mysteryCoverage.events.map(event => event.wave))].filter(
        wave => mysteryCoverage.events.filter(event => event.wave === wave).length !== 1,
      );
      if (
        missing.length > 0
        || unexpected.length > 0
        || duplicateWaves.length > 0
        || mysteryCoverage.events.length !== expectedEvents.size
      ) {
        throw new Error(
          `[campaign-mystery] exact wave schedule mismatch missing=${JSON.stringify(missing)} `
            + `unexpected=${JSON.stringify(unexpected.map(event => ({ wave: event.wave, kind: event.kind })))} `
            + `duplicateWaves=${JSON.stringify(duplicateWaves)} total=${mysteryCoverage.events.length}/${expectedEvents.size}`,
        );
      }
      const ordinaryMysteryEvents = mysteryCoverage.events.filter(event => event.kind === "mystery");
      const ordinaryMysteryTypes = ordinaryMysteryEvents.map(event => event.mysteryEncounterType);
      if (
        ordinaryMysteryTypes.some(type => !Number.isSafeInteger(type))
        || new Set(ordinaryMysteryTypes).size !== ordinaryMysteryEvents.length
      ) {
        throw new Error(
          `[campaign-mystery] ordinary encounters were not six distinct registry types: ${JSON.stringify(ordinaryMysteryTypes)}`,
        );
      }
      const wildOne = mysteryCoverage.battleKinds.find(kind => kind.wave === 1);
      const ghostSeven = mysteryCoverage.battleKinds.find(kind => kind.wave === 7);
      const bossEight = mysteryCoverage.battleKinds.find(kind => kind.wave === 8);
      if (wildOne?.battleType !== "WILD" || ghostSeven?.battleType !== "TRAINER") {
        throw new Error(`[campaign-mystery] wave 1/7 kind mismatch: ${JSON.stringify({ wildOne, ghostSeven })}`);
      }
      if (bossEight?.battleType !== "WILD" || bossEight.maxBossSegments < 2) {
        throw new Error(
          `[campaign-mystery] wave 8 was not the scripted segmented wild boss: ${JSON.stringify(bossEight)}`,
        );
      }
      // Only the authority selects the ghost. The renderer adopts the resulting trainer carrier;
      // requiring it to run the selector would weaken the authoritative architecture.
      await rig.host.evidence.waitFor(/\[er-ghost\] wave 7: (?:ghost|reusing cached ghost) /u, {
        timeoutMs: rig.config.timeoutMs,
        description: "authority selected the Mystery gauntlet wave 7 ghost team",
      });
      if (mysteryCoverage.events.length < policy.mysteryGauntlet.minSurfaces) {
        throw new Error(
          `[campaign-mystery] observed ${mysteryCoverage.events.length} distinct completed event waves; required ${policy.mysteryGauntlet.minSurfaces}`,
        );
      }
    }
  } finally {
    rig.marketCoverage = marketCoverage;
    await progress.summary({
      targetWaves: policy.targetWaves,
      renderProfile: policy.renderProfile,
      moveAnimations: policy.moveAnimationsExpected,
      wavesCleared,
      finalWave: rig.activeBattleWave,
      lastStatus: status,
      replacementCount: rig.replacementCount,
      battleLoops,
      maxBattleLoops: policy.maxBattleLoops,
      marketCoverage,
      mysteryCoverage,
    });
    await progress.writeStageRollup().catch(() => {});
    await progress.flush();
  }

  if (status === "wipe") {
    throw new Error(
      `[campaign-wipe] Party wiped after clearing ${wavesCleared} waves (target ${policy.targetWaves}); `
        + "the co-op run reached a game-over through public play. Evidence is complete.",
    );
  }
  if (status === "terminal") {
    throw new Error(
      `Campaign shared session terminated after ${wavesCleared} cleared waves (target ${policy.targetWaves})`,
    );
  }
  if (wavesCleared < policy.targetWaves) {
    if (battleLoops >= policy.maxBattleLoops) {
      throw new Error(
        `[campaign-loop-budget] exhausted ${policy.maxBattleLoops} battle loops at game wave ${rig.activeBattleWave}; `
          + `cleared ${wavesCleared}/${policy.targetWaves} addressed waves`,
      );
    }
    throw new Error(`Campaign reached ${wavesCleared} cleared waves; target was ${policy.targetWaves}`);
  }
}
