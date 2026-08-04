/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadCampaignLifecyclePolicy, withinDeadline } from "./campaign-lifecycle.mjs";
import {
  driveBestCampaignMove,
  findLocalActionableIvScannerSurface,
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
  SHARED_SESSION_TERMINAL,
} from "./campaign-policy.mjs";
import { delay } from "./evidence.mjs";
import {
  assertMarketCoverage,
  driveMarketLeave,
  driveTargetedMarket,
  findPairedMarketOutcome,
} from "./market-journey.mjs";

const START_PHASE = /Start Phase (\w+)/u;
const OUTCOME_PROGRESS_PHASE = /Start Phase ([A-Za-z0-9]+Phase)/u;
const OUTCOME_PROGRESS_AUTHORITY = /\[coop:turn\] host recorder: append turn=\d+ seq=\d+/u;
const OUTCOME_PROGRESS_RENDERER = /\[coop:replay\] guest replay turn=\d+: live increment seq=\d+\.\.\d+/u;
const OUTCOME_PROGRESS_RESOLUTION = /\[coop:replay\] guest (?:RECV turnResolution|awaitTurn turn=\d+ RESOLVE)/u;
const TURN_PROGRESS =
  /Start Phase (?:TurnStartPhase|CoopTurnCommitPhase)|host recorder: (?:begin|append|finalize) turn=|guest (?:RECV live battleEvent|RECV turnResolution) turn=/u;
const REPLACEMENT_PHASE_START = /Start Phase (?:SwitchPhase|CoopGuestFaintSwitchPhase)/u;
const BATTLE_END_PHASE = /Start Phase BattleEndPhase/u;
const FAINT_PHASE = /Start Phase FaintPhase/u;
const ORDERED_TRAINER_VICTORY = /\[coop:v2-control\] projected ordered trainer victory rev=\d+ wave=(\d+) turn=(\d+)/u;
const NEXT_TURN_BATTLE_PROMPT_PHASES = new Set([
  "MessagePhase",
  "TrainerVictoryPhase",
  "MoneyRewardPhase",
  "ModifierRewardPhase",
]);
const POST_MYSTERY_PHASE = /Start Phase PostMysteryEncounterPhase/u;
const BARGAIN_OWNER_TERMINAL = /bargain OWNER terminal: outcome blob sent/u;
const BARGAIN_WATCHER_TERMINAL = /bargain WATCHER: outcome blob received -> converging/u;
const BATTLE_PROMPT_PHASES = new Map([
  // Battle narration is rendered by MessageUiHandler from several phase classes (SummonPhase,
  // ShowTrainerPhase, replay phases, and MessagePhase itself). The semantic surface's prompt
  // generation is the actionable identity. EXP and evolution accept both their authority phase and
  // retained V2 renderer, but evolution's real input handler remains in EVOLUTION_SCENE.
  ["battle:message", { phases: null, uiMode: "MESSAGE" }],
  ["battle:exp", { phases: new Set(["ExpPhase", "CoopWaveProgressionReplayPhase"]), uiMode: "MESSAGE" }],
  [
    "battle:evolution",
    { phases: new Set(["EvolutionPhase", "CoopWaveProgressionReplayPhase"]), uiMode: "EVOLUTION_SCENE" },
  ],
  [
    "battle:form-change",
    { phases: new Set(["FormChangePhase", "CoopFormChangeCutsceneReplayPhase"]), uiMode: "EVOLUTION_SCENE" },
  ],
]);
const INTERACTIVE_MYSTERY_NARRATION_PHASES = new Set([
  "MysteryEncounterPhase",
  "MysteryEncounterOptionSelectedPhase",
  "MysteryEncounterRewardsPhase",
  "PostMysteryEncounterPhase",
  "ErQuizPhase",
  "TheBargainPhase",
  "CoopReplayMePhase",
]);
const ANIMATION_PROGRESS_ALLOWANCE_MS = 90_000;
// Run 30389490030 completed the exact WAVE_ADVANCE and reconstructed the actionable reward shop
// about 100s after the authority won the turn. That retained progression is a typed causal successor,
// not an animation keepalive. Give it 50% measured headroom while preserving the same immutable 360s
// per-turn circuit breaker used by every animations-skipped profile.
const WAVE_PROGRESSION_ALLOWANCE_MS = 150_000;
// Run 30366519918 measured one complete Lovely Bite animation at 252.3s on the GPU-less
// two-browser SwiftShader runner: authority moveAnim seq=17 at 14:22:25.734, then the mechanically
// resulting hp seq=18 at 14:26:38.030. Both screenshots showed the same live animation and the exact
// presentation/state stream remained ordered. Give only the animations-on profile 25% headroom over
// that measured single-event cost. Skipped-animation profiles retain the strict 90s stall detector,
// and the immutable per-turn hard ceiling below still makes a genuinely parked animation fail.
const ANIMATIONS_ON_SLOW_EVENT_MEASURED_MS = 253_000;
const ANIMATIONS_ON_PROGRESS_ALLOWANCE_MS = Math.ceil(ANIMATIONS_ON_SLOW_EVENT_MEASURED_MS * 1.25);
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
const MYSTERY_PROGRESSING_BATTLE_MAX_TURNS = 30;

/**
 * Mystery encounters can deliberately create longer legal battles than the ordinary fast lane. Run
 * 30824237635 was still installing the paired command frontier at turn 13 when the generic 12-turn cap
 * mislabeled it a softlock. Preserve the strict default everywhere else, but give a visibly progressing
 * Mystery battle bounded headroom under the campaign's separate immutable wall-clock deadline.
 */
export function campaignBattleTurnBudget(configuredMaxTurns, policy) {
  return policy.mysteryGauntlet.required
    ? Math.max(configuredMaxTurns, MYSTERY_PROGRESSING_BATTLE_MAX_TURNS)
    : configuredMaxTurns;
}

function fromEach(clients, fn) {
  return Object.fromEntries(clients.map(client => [client.label, fn(client)]));
}

/**
 * Start a battle round at each browser's current public frontier.
 *
 * A seat with no live battler correctly exposes only a passive command watcher. Falling back to
 * cursor zero for that omitted seat resurrects old reward/GameOver evidence, so the sequential
 * driver mistakes a historical wave boundary for a partial current terminal and never drives the
 * remaining real owner. Preserve an owned command itself when present; otherwise begin at the
 * current tail, exactly where a human starts observing this new battle.
 */
export function initialBattleCommandCursors(clients) {
  return fromEach(clients, client => findOwnedCommandFrontier(client, 0)?.index ?? client.evidence.cursor());
}

const DIGEST_PARTS = /\[coop-browser:digest-parts\] (\{.*\})/u;
function retainedEvolutionKeys(rig, stage, role) {
  const keys = new Set();
  for (const client of Object.values(rig.clients)) {
    for (const entry of client.evidence.events) {
      const observation = entry.kind === "browser-progression-event" ? entry.observation : null;
      const event = observation?.event;
      if (observation?.stage !== stage || observation.role !== role || event?.k !== "evolution") {
        continue;
      }
      keys.add(`${observation.wave}:${event.partySlot}:${event.fromSpeciesId}->${event.toSpeciesId}`);
    }
  }
  return [...keys];
}

/**
 * Every authority-recorded evolution must finish once on the renderer before the wave DATA boundary.
 * The 30-wave depth profile must also exercise at least one real evolution so a green campaign cannot
 * silently omit this presentation class while only testing low-level protocol validators.
 */
export function assertRetainedEvolutionPresentationParity(rig, policy) {
  // Browser labels describe which account/page the harness launched first; WebRTC role selection may place
  // the authority on either label. Compare the strict lifecycle ledger by its embedded role/stage instead
  // of scraping legacy console prose from rig.host/rig.guest (run 30778145880 had the roles reversed).
  const authority = retainedEvolutionKeys(rig, "authority-recorded", "host").toSorted();
  const renderer = retainedEvolutionKeys(rig, "renderer-completed", "guest").toSorted();
  const proof = { authority, renderer, required: policy.targetWaves >= 30 && policy.navigation?.required !== true };
  for (const client of Object.values(rig.clients)) {
    client.evidence.record("campaign-retained-evolution-proof", proof);
  }
  if (proof.required && authority.length === 0) {
    throw new Error("[campaign-evolution] 30-wave depth completed without exercising retained evolution");
  }
  if (JSON.stringify(authority) !== JSON.stringify(renderer)) {
    throw new Error(
      `[campaign-evolution] retained evolution presentation mismatch authority=${JSON.stringify(authority)} renderer=${JSON.stringify(renderer)}`,
    );
  }
  return proof;
}

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
    this.heartbeatTimer = null;
  }

  emitLive(kind, detail) {
    console.log(`[coop-soak:${kind}] ${JSON.stringify(detail)}`);
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
    this.emitLive("progress", timed);
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

  /**
   * Keep long Chromium stages observable in the Actions log while their compact artifacts are still open.
   * The sampler only reads already-captured evidence and never touches either page or its input timing.
   */
  startHeartbeat(sample, intervalMs = 60_000) {
    if (this.heartbeatTimer != null) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      try {
        this.emitLive("heartbeat", {
          sinceStartMs: Math.round(performance.now() - this.startedMs),
          lastProgress: this.rows.at(-1) ?? null,
          ...sample(),
        });
      } catch (error) {
        this.emitLive("heartbeat-error", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }, intervalMs);
    this.heartbeatTimer.unref?.();
  }

  async flush() {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    await this.tail;
  }
}

function campaignLiveSnapshot(rig, clients, targetWaves) {
  return {
    activeWave: rig.activeBattleWave,
    targetWaves,
    clients: Object.fromEntries(
      clients.map(client => {
        const phase = client.evidence.findLast(START_PHASE);
        const surface = client.evidence.findLastSemanticSurface();
        return [
          client.label,
          {
            evidenceEvents: client.evidence.events.length,
            phase: phase == null ? null : (START_PHASE.exec(phase.text ?? "")?.[1] ?? null),
            surface: surface?.observation?.surfaceId ?? null,
            address: surface?.observation?.address ?? null,
            ready: surface?.observation?.ready ?? null,
          },
        ];
      }),
    ),
  };
}

/** Bounded per-step observation window for the state-aware Settings walk. */
// The two software-WebGL browsers can take ~2.8s to publish one real menu reaction while
// their initial asset/background-account work is still draining. A 1.5s step timeout queued
// another key before the first one reacted, then misreported the delayed cursor as a dropped
// input. Four seconds matches the semantic navigator's proven reaction budget and returns
// immediately on healthy runners.
const SPEED_STEP_OBSERVATION_TIMEOUT_MS = 4_000;

/**
 * How long a SINGLE-sided actionable command frontier must survive (no reward / wipe / faint /
 * two-sided frontier superseding it) before it is trusted as the next turn. This does not bound a
 * passive command watcher: that surface has no input handler and stays provisional under the immutable
 * between-wave deadline while real presentation continues.
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
export async function raiseGameSpeed(rig, policy, progress) {
  const clients = Object.values(rig.clients);
  const keys = policy.keys.speed;
  if (keys.length === 0) {
    await Promise.all(
      clients.map(async client => {
        client.evidence.record("campaign-speed", { status: "skipped", reason: "COOP_UI_SPEED_KEYS not set" });
      }),
    );
    await progress.note(
      "speed-raise skipped: set COOP_UI_SPEED_KEYS to a verified Title->Settings->GameSpeed sequence",
    );
    return;
  }
  await Promise.all(
    clients.map(async client => {
      const speedCursor = client.evidence.cursor();
      if (policy.keys.speedKeysFromEnv) {
        // Maintainer-supplied sequence: replay verbatim (blind), as before.
        await client.sequence(keys, `raise-game-speed-to-${policy.gameSpeed}x`);
        await delay(client.config.settleDelayMs);
      } else {
        // 1+2) Navigate by the title menu's stable option ids and submit Settings. The generic
        // semantic navigator survives a late post-login TitlePhase rebuild (which can reset the
        // cursor to Continue while initial account migration drains) and verifies every public
        // arrow reaction. A fixed eight-key loop failed one option before Settings in that race.
        const openCursor = client.evidence.cursor();
        await selectOptionById(client, {
          surfaceId: "title-menu",
          targetId: "settings",
          navKeys: ["ArrowDown", "ArrowUp"],
          submitKey: "Space",
          timeoutMs: client.config.timeoutMs,
        });
        await client.evidence.waitForCondition(sink => sink.findLastRenderProfileObservation(openCursor), {
          timeoutMs: client.config.timeoutMs,
          description: "visible Settings menu after semantic title selection",
        });
        // 3) Game Speed is the first row; step RIGHT until the observer attests the requested
        //    benchmark value. The row wraps, so allow a full second lap after a double-step.
        await pressUntilObserved(
          client,
          "ArrowRight",
          `speed-walk-raise-to-${policy.gameSpeed}x`,
          observedGameSpeed,
          policy.gameSpeed,
          { attempts: 12 },
        );
        // 4) Close Settings once, wait for a FRESH title surface, then semantically select New
        //    Game without submitting it. Waiting for the fresh surface prevents Settings-row
        //    arrows from being mistaken for title navigation on a heavily dilated runner.
        const closeCursor = client.evidence.cursor();
        await client.press("Backspace", "speed-walk-close-settings");
        await client.evidence.waitForCondition(sink => sink.findLastSemanticSurface(closeCursor, "title-menu"), {
          timeoutMs: client.config.timeoutMs,
          description: "fresh Title menu after closing Settings",
        });
        await selectOptionById(client, {
          surfaceId: "title-menu",
          targetId: "new-game",
          navKeys: ["ArrowUp", "ArrowDown"],
          submit: false,
          timeoutMs: client.config.timeoutMs,
          fromCursor: closeCursor,
        });
      }
      const attestation = await client.evidence.waitForCondition(
        sink => sink.findGameSpeed(policy.gameSpeed, speedCursor),
        {
          timeoutMs: client.config.timeoutMs,
          description: `visible Settings Game Speed=${policy.gameSpeed} attestation`,
        },
      );
      client.evidence.record("campaign-speed", {
        status: "attested",
        gameSpeed: attestation.observation.gameSpeed,
        keys: policy.keys.speedKeysFromEnv ? keys : "observation-gated",
      });
      await client.checkpoint("speed-raised");
    }),
  );
  await progress.note(`speed-raise observer-attested (Game Speed -> ${policy.gameSpeed}x via Settings UI)`);
}

/**
 * Select and attest one of the two explicit rendering-fidelity profiles through the real
 * Display Settings UI. The browser observer only reports the applied value; every change
 * is still a public keyboard action and both clients leave a screenshot on the selected row.
 */
export async function configureRenderProfile(rig, policy, progress) {
  const clients = Object.values(rig.clients);
  const expected = policy.moveAnimationsExpected;
  await Promise.all(
    clients.map(async client => {
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
      const closeCursor = client.evidence.cursor();
      await client.sequence(policy.keys.renderProfileClose, `close-render-profile-${policy.renderProfile}`);
      if (policy.keys.renderProfileCloseKeysFromEnv) {
        // Explicit maintainer reproductions preserve their exact sequence and pacing.
        await delay(client.config.settleDelayMs);
      } else {
        // Do not let the next workflow stage race a key whose input dispatch was accepted but
        // whose Title cursor update has not rendered yet. The market journey in run
        // 30237105683 selected Load Game this way: the old blind ArrowUp tail was still
        // draining while enterCoopLobby planned from the preceding Settings observation.
        await client.evidence.waitForCondition(sink => sink.findLastSemanticSurface(closeCursor, "title-menu"), {
          timeoutMs: client.config.timeoutMs,
          description: "fresh Title menu after closing Display Settings",
        });
        await selectOptionById(client, {
          surfaceId: "title-menu",
          targetId: "new-game",
          navKeys: ["ArrowUp", "ArrowDown"],
          submit: false,
          timeoutMs: client.config.timeoutMs,
          fromCursor: closeCursor,
        });
      }
    }),
  );
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
  const authorityMove = rig.host.evidence.findPresentationEvent({
    stage: "authority-recorded",
    eventKind: "moveAnim",
  });
  if (!authorityMove) {
    throw new Error(`${policy.renderProfile}: no authoritative move-animation boundary was recorded`);
  }
  const rendererEvidence = policy.moveAnimationsExpected
    ? rig.guest.evidence.findPresentationEvent({ stage: "renderer-completed", eventKind: "moveAnim" })
    : rig.guest.evidence.findPresentationEvent({
        stage: "renderer-skipped",
        eventKind: "moveAnim",
        reason: "animations-disabled",
      });
  if (!rendererEvidence) {
    throw new Error(
      policy.moveAnimationsExpected
        ? "animations-on-surface: renderer never completed an authoritative move animation"
        : "animations-skipped-depth: renderer never issued a structured animations-disabled receipt",
    );
  }
  const authoritySwitches = rig.host.evidence.findPresentationEvents({
    stage: "authority-recorded",
    eventKind: "switch",
  });
  const rendererSwitches = authoritySwitches.map(authoritySwitch => {
    const switchAddress = authoritySwitch.observation;
    const rendererSwitch = rig.guest.evidence.findPresentationEvent({
      stage: policy.moveAnimationsExpected ? "renderer-completed" : "renderer-skipped",
      eventKind: "switch",
      reason: policy.moveAnimationsExpected ? null : "animations-disabled",
      epoch: switchAddress.epoch,
      wave: switchAddress.wave,
      turn: switchAddress.turn,
      seq: switchAddress.seq,
      canonicalEvent: switchAddress.event,
    });
    if (rendererSwitch == null) {
      throw new Error(
        `${policy.renderProfile}: authoritative switch ${switchAddress.wave}:${switchAddress.turn}:${switchAddress.seq} `
          + "did not produce its exact guest renderer receipt",
      );
    }
    const trainerPostcondition = rig.guest.evidence.findTrainerPostcondition({
      epoch: switchAddress.epoch,
      wave: switchAddress.wave,
      turn: switchAddress.turn,
      seq: switchAddress.seq,
      canonicalEvent: switchAddress.event,
    });
    if (trainerPostcondition == null) {
      throw new Error(
        `${policy.renderProfile}: authoritative switch ${switchAddress.wave}:${switchAddress.turn}:${switchAddress.seq} `
          + "did not produce a two-frame trainer cleanup proof",
      );
    }
    if (trainerPostcondition.observation.trainerPresented) {
      throw new Error(
        `${policy.renderProfile}: trainer remained presented after switch `
          + `${switchAddress.wave}:${switchAddress.turn}:${switchAddress.seq}`,
      );
    }
    return { rendererSwitch, trainerPostcondition };
  });
  const proof = {
    renderProfile: policy.renderProfile,
    moveAnimations: policy.moveAnimationsExpected,
    authorityMoveEventIndex: authorityMove.index,
    rendererMoveEventIndex: rendererEvidence.index,
    authoritySwitchEventIndex: authoritySwitches[0]?.index ?? null,
    rendererSwitchEventIndex: rendererSwitches[0]?.rendererSwitch.index ?? null,
    authoritySwitchEventIndices: authoritySwitches.map(event => event.index),
    rendererSwitchEventIndices: rendererSwitches.map(({ rendererSwitch }) => rendererSwitch.index),
    trainerPostconditionEventIndices: rendererSwitches.map(({ trainerPostcondition }) => trainerPostcondition.index),
  };
  rig.host.evidence.record("campaign-render-profile-proof", proof);
  rig.guest.evidence.record("campaign-render-profile-proof", proof);
  await progress.note("render profile governed real battle execution", proof);
}

/**
 * A hidden final trainer state is not proof that the transition ever rendered. For every trainer battle
 * entered after wave 1, require the signed guest player-trainer cue plus positive enemy-trainer intro and
 * victory samples on both real browsers.
 */
function assertTrainerPresentationCoverage(rig, battleKinds) {
  const trainerWaves = [
    ...new Set(battleKinds.filter(kind => kind.wave > 1 && kind.battleType === "TRAINER").map(kind => kind.wave)),
  ];
  if (trainerWaves.length === 0) {
    return null;
  }
  const proof = trainerWaves.map(wave => {
    const playerTransition = rig.guest.evidence.findTrainerTransition({ wave });
    if (playerTransition == null) {
      throw new Error(`[campaign-trainer-presentation] guest omitted the signed player-trainer cue at wave ${wave}`);
    }
    const clients = Object.values(rig.clients).map(client => {
      const intro = client.evidence.events.find(
        event =>
          event.kind === "browser-surface2"
          && event.observation.address?.wave === wave
          && event.observation.phase === "NextEncounterPhase"
          && event.observation.presentation?.enemyTrainerPresented === true,
      );
      const victory = client.evidence.events.find(
        event =>
          event.kind === "browser-surface2"
          && event.observation.address?.wave === wave
          && event.observation.phase === "TrainerVictoryPhase"
          && event.observation.presentation?.enemyTrainerPresented === true,
      );
      if (intro == null || victory == null) {
        throw new Error(
          `[campaign-trainer-presentation] ${client.label} omitted ${intro == null ? "intro" : "victory"} `
            + `trainer presentation at wave ${wave}`,
        );
      }
      return { label: client.label, introEventIndex: intro.index, victoryEventIndex: victory.index };
    });
    return { wave, playerTransitionEventIndex: playerTransition.index, clients };
  });
  for (const client of Object.values(rig.clients)) {
    client.evidence.record("campaign-trainer-presentation-coverage", { proof });
  }
  return proof;
}

function isExactNextTurnCommand(observation, expectedCommandAddress) {
  if (observation == null || expectedCommandAddress == null) {
    return false;
  }
  const expected = expectedCommandAddress.split(":").map(Number);
  const address = observation.address;
  return (
    expected.length === 3
    && expected.every(Number.isSafeInteger)
    && address != null
    && address.epoch === expected[0]
    && address.wave === expected[1]
    && address.turn === expected[2] + 1
  );
}

/** Clients whose submitted command has not yet opened the real turn/replay path. */
export function clientsAwaitingTurnProgress(rig, from, expectedCommandAddress = null) {
  return Object.values(rig.clients).filter(client => {
    const cursor = from[client.label] ?? 0;
    if (client.evidence.find(TURN_PROGRESS, cursor)) {
      return false;
    }
    // A CPU-starved renderer can publish its next exact CommandPhase after TurnStart scrolled past the
    // caller's evidence floor. That newer owned frontier is conclusive progress for the submitted turn.
    // A same-address re-emission is deliberately not progress: it may be the still-unsubmitted command.
    return !isExactNextTurnCommand(findOwnedCommandFrontier(client, cursor)?.observation, expectedCommandAddress);
  });
}

export function findOwnedCommandFrontier(client, from) {
  const semantic = client.evidence.findLastSemanticSurface(from);
  const ownedCommandSurface =
    (semantic?.observation.surfaceId === "command:command" && semantic.observation.uiMode === "COMMAND")
    || (semantic?.observation.surfaceId === "command:fight" && semantic.observation.uiMode === "FIGHT");
  if (
    ownedCommandSurface
    && semantic.observation.ready?.handlerActive === true
    && semantic.observation.phase === "CommandPhase"
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
 * Whether every browser's CURRENT semantic projection belongs to the same command-frontier class.
 *
 * Between waves, one browser can legitimately reach the next CommandPhase while its partner is still
 * resolving a public LearnMove/egg/reward continuation. Historical command evidence is insufficient:
 * entering the blocking shared-frontier proof at that moment prevents the campaign from driving the
 * partner's visible continuation. Accept owner and renderer/partner-wait projections, but only when each
 * is the latest semantic UI after this wave's cursor. The full shared proof still validates address,
 * membership, generation, digest, and at least one actionable owner.
 */
export function allClientsAtCurrentCommandFrontier(clients, from) {
  return clients.every(client => {
    const cursor = from[client.label] ?? 0;
    const event = client.evidence.findLastSemanticSurface(cursor);
    const observation = event?.observation;
    if (observation == null) {
      return findOwnedCommandFrontier(client, cursor) != null;
    }
    const ownerSurface =
      (observation.surfaceId === "command:command" && observation.uiMode === "COMMAND")
      || (observation.surfaceId === "command:fight" && observation.uiMode === "FIGHT");
    const owner =
      ownerSurface
      && observation.operationClass === "command"
      && observation.phase === "CommandPhase"
      && observation.ready?.handlerActive === true
      && observation.localSeat === client.publicSeat
      && observation.seatsWithInput?.includes(client.publicSeat);
    const rendererWatcher =
      observation.surfaceId === "command:watcher"
      && observation.operationClass === "command"
      && observation.phase === "CoopReplayTurnPhase"
      && observation.seatsWithInput?.length === 0
      && observation.ready?.handlerActive === false
      && observation.ready?.awaitingActionInput === false
      && observation.ready?.inputBlocked === true;
    const partnerCommandWatcher =
      observation.surfaceId === "command:watcher"
      && observation.operationClass === "command"
      && observation.phase === "CommandPhase"
      && observation.uiMode === "MESSAGE"
      && observation.seatsWithInput?.length === 1
      && !observation.seatsWithInput.includes(client.publicSeat)
      && observation.ready?.handlerActive === true
      && observation.ready?.inputBlocked !== true;
    const partnerWaiting =
      observation.surfaceId === "battle:message"
      && observation.operationClass === "battle-progress"
      && observation.phase === "CommandPhase"
      && observation.uiMode === "MESSAGE"
      && observation.ready?.handlerActive === true
      && observation.ready?.awaitingActionInput === true;
    return owner || rendererWatcher || partnerCommandWatcher || partnerWaiting;
  });
}

/**
 * Drive only the clients whose first command never entered the turn path. A valid but CPU-starved
 * browser turn can take much longer than the short fallback window. Run 29312876722 proved that
 * blindly replaying the whole fallback on BOTH clients in that state smears its keys across damage,
 * faint and EXP messages. Progress evidence makes the fallback selective instead.
 */
export async function driveBattleFallback(rig, keys, from, purpose, expectedCommandAddress = null) {
  const pending = clientsAwaitingTurnProgress(rig, from, expectedCommandAddress);
  await Promise.all(
    pending.map(async client => {
      for (const [index, key] of keys.entries()) {
        // A fallback is a human retry of a command that did not visibly enter the turn. Under
        // severe runner dilation, the first retry can succeed while later queued keys are still
        // waiting for browser focus. Re-check the public turn evidence before every key so the
        // remaining fallback cannot spill into the next CommandPhase and open its Fight submenu
        // (market-wide-lens run 30246932430).
        if (!clientsAwaitingTurnProgress(rig, from, expectedCommandAddress).includes(client)) {
          client.evidence.record("campaign-battle-fallback-superseded", {
            purpose,
            inputSeat: client.label,
            keysSent: index,
            keysSuppressed: keys.length - index,
          });
          break;
        }
        await client.press(key, `${purpose}-${client.label}:${index + 1}/${keys.length}`);
      }
    }),
  );
  return pending;
}

function currentSharedCommandAddress(clients) {
  const addresses = clients.map(client => {
    // The append-only legacy command mirror records only command-menu appearances. During the
    // ordinary sequential frontier one browser can already be waiting on a battle MESSAGE at turn
    // N while its partner is still exposing the preceding command marker. Treating both historical
    // command markers as current produced a harness-only desync at wave 3 turn 4 (depth run
    // 30500538258). The semantic mirror describes what each browser displays NOW, including that
    // partner-wait message, so prefer its address and use the legacy command only before any semantic
    // surface exists. No convergence means "not actionable yet", never permission to guess.
    const semantic = client.evidence.findLastSemanticSurface()?.observation;
    const address =
      semantic?.address ?? (semantic == null ? client.evidence.findLastSurface("command")?.observation : null);
    return Number.isSafeInteger(address?.epoch)
      && Number.isSafeInteger(address?.wave)
      && Number.isSafeInteger(address?.turn)
      ? `${address.epoch}:${address.wave}:${address.turn}`
      : null;
  });
  if (addresses.some(address => address == null) || new Set(addresses).size !== 1) {
    return null;
  }
  return addresses[0];
}

/**
 * Admit the submitted turn's exact prompt address, plus exact structural successor narrations.
 *
 * BattleEndPhase increments the public turn before its money/cleanup MessagePhase is displayed. That
 * visible prompt therefore carries turn N+1 even though it is the terminal narration for submitted
 * turn N (run 29676344808: "You picked up ₽30!"). Requiring the old address strands a real actionable
 * human prompt. FaintPhase likewise runs after TurnEnd advances the public address, so its later
 * faint narration is stamped N+1 (public journey 30186100483). Trainer battles likewise render their
 * post-BattleEnd human prompts through TrainerVictoryPhase, MoneyRewardPhase, and ModifierRewardPhase
 * (mystery runs 30366178580 and 30370796112). A retained evolution is likewise installed after the
 * guest's BattleEndPhase and exposes its final human prompt at N+1 (evolution run 30628643225).
 * The exception remains fail-closed: same epoch and wave, exactly the next turn, a closed actionable
 * successor surface, and an exact structural boundary on this browser between the scan floor and the
 * prompt. Evolution specifically requires BattleEndPhase; FaintPhase alone cannot authorize it.
 * Arbitrary future-turn battle messages still cannot authorize input.
 */
function battlePromptMatchesAddress(client, scanFloor, event, expectedAddress, sharedCurrentAddress = null) {
  const observation = event.observation;
  const address = observation.address;
  const hasLiveBattleAddress =
    Number.isSafeInteger(address?.epoch)
    && Number.isSafeInteger(address?.wave)
    && address.wave > 0
    && Number.isSafeInteger(address?.turn)
    && address.turn > 0;
  if (expectedAddress == null) {
    return hasLiveBattleAddress;
  }
  const observedAddress = `${address?.epoch}:${address?.wave}:${address?.turn}`;
  if (observedAddress === expectedAddress) {
    return true;
  }
  const expectedParts = expectedAddress.split(":").map(Number);
  // A completed turn can install the next COMMAND_FRONTIER before its local TurnInit narration becomes
  // actionable. In that schedule the renderer is already the passive N+1 command watcher while the
  // authority is visibly waiting on an ordinary N+1 MessagePhase. Both CURRENT semantic surfaces naming
  // that exact immediate successor is stronger evidence than the old submitted-turn cursor: it proves the
  // prompt is live, paired, and belongs to the committed successor (run 30927575552). One-sided or later
  // future addresses remain excluded, and the caller's current-surface/readiness guards still apply.
  const isPairedImmediateSuccessor =
    sharedCurrentAddress === observedAddress
    && expectedParts.length === 3
    && expectedParts.every(part => Number.isSafeInteger(part))
    && address?.epoch === expectedParts[0]
    && address.wave === expectedParts[1]
    && address.turn === expectedParts[2] + 1;
  if (isPairedImmediateSuccessor) {
    return true;
  }
  const isSuccessorSettlementMessage =
    observation.surfaceId === "battle:message" && NEXT_TURN_BATTLE_PROMPT_PHASES.has(observation.phase);
  const isSuccessorEvolution =
    (observation.surfaceId === "battle:evolution" || observation.surfaceId === "battle:form-change")
    && BATTLE_PROMPT_PHASES.get(observation.surfaceId)?.phases?.has(observation.phase) === true;
  if (
    !hasLiveBattleAddress
    || expectedParts.length !== 3
    || expectedParts.some(part => !Number.isSafeInteger(part))
    || (!isSuccessorSettlementMessage && !isSuccessorEvolution)
    || address.epoch !== expectedParts[0]
    || address.wave !== expectedParts[1]
    || address.turn !== expectedParts[2] + 1
  ) {
    return false;
  }
  const boundaryEvents = client.evidence.events.slice(scanFloor, event.index + 1);
  if (isSuccessorEvolution) {
    return boundaryEvents.some(candidate => BATTLE_END_PHASE.test(candidate.text ?? ""));
  }
  // The Authority V2 renderer does not execute BattleEndPhase for a trainer win. Its signed
  // trainer-victory-open entry projects TrainerVictoryPhase directly, and that finite presentation can
  // legitimately queue account-local voucher ModifierRewardPhase prompts. Require the exact projection's
  // authenticated wave/turn marker before admitting those successor-address prompts. A bare phase name (or
  // a marker from another battle) remains insufficient, so this cannot turn an arbitrary future-turn message
  // into input authority. Run 30862517427 otherwise left the guest's real voucher popup untouched while the
  // host waited at shop:5:4 until rendezvous recovery exhausted.
  const hasExactOrderedTrainerVictory = boundaryEvents.some(candidate => {
    const match = ORDERED_TRAINER_VICTORY.exec(candidate.text ?? "");
    return match != null && Number(match[1]) === address.wave && Number(match[2]) === address.turn;
  });
  return (
    boundaryEvents.some(
      candidate => BATTLE_END_PHASE.test(candidate.text ?? "") || FAINT_PHASE.test(candidate.text ?? ""),
    ) || hasExactOrderedTrainerVictory
  );
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
  // Ordinary battles freeze the first address on which both browsers' CURRENT public semantic
  // surfaces converge. Sequential command ownership legitimately opens one browser before the other;
  // until both observations name the same address the helper is inert and its caller keeps polling.
  // Commander is intentionally asymmetric: the hidden Tatsugiri owner must never expose a command
  // surface, so that caller supplies the exact address from its stricter Commander proof.
  let expectedAddress = expectedCommandAddress ?? null;
  const cursors = new Map(clients.map(client => [client.label, from[client.label] ?? 0]));
  // Consumption belongs to the browser session, not one helper invocation. Several public journeys
  // create a fresh advancer at the same battle boundary (post-turn -> faint picker -> next command).
  // A per-call set forgets every prior Space and can replay an old readiness event into a later UI.
  rig.consumedBattlePromptInstances ??= new Set();
  const consumedInstances = rig.consumedBattlePromptInstances;
  const instanceKeyFor = (client, observation) =>
    JSON.stringify([
      client.label,
      observation.surfaceId,
      observation.phase,
      observation.address?.epoch ?? null,
      observation.address?.wave ?? null,
      observation.address?.turn ?? null,
      observation.membershipRevision ?? null,
      observation.connectionGeneration ?? null,
      observation.phaseInstance,
      observation.surfaceGeneration ?? null,
    ]);
  const pairedTrainerVictoryIsReady = observation => {
    if (observation.phase !== "TrainerVictoryPhase") {
      return true;
    }
    return clients.every(peer => {
      const paired = peer.evidence.findLastSemanticSurface(from[peer.label] ?? 0)?.observation;
      return (
        paired?.phase === "TrainerVictoryPhase"
        && paired.surfaceId === "battle:message"
        && paired.address?.epoch === observation.address?.epoch
        && paired.address?.wave === observation.address?.wave
        && paired.address?.turn === observation.address?.turn
        && paired.ready?.handlerActive === true
        && paired.ready?.awaitingActionInput === true
        && paired.ready?.inputBlocked !== true
      );
    });
  };
  const advanceReadyPrompt = async (client, readyEvent) => {
    cursors.set(client.label, readyEvent.index + 1);
    const { surfaceId, phase, phaseInstance } = readyEvent.observation;
    consumedInstances.add(instanceKeyFor(client, readyEvent.observation));
    const statName =
      surfaceId === "battle:evolution" || surfaceId === "battle:form-change"
        ? "postBattleEvolutionPrompts"
        : phase === "ExpPhase" || phase === "CoopWaveProgressionReplayPhase"
          ? "postBattleExpPrompts"
          : "battleMessagePrompts";
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
  };
  return async () => {
    if (expectedAddress == null && requireSharedCommandAddress) {
      expectedAddress = currentSharedCommandAddress(clients);
      if (expectedAddress == null) {
        return false;
      }
    }
    const sharedCurrentAddress = currentSharedCommandAddress(clients);
    for (const client of clients) {
      const readyEvent = client.evidence.events.slice(cursors.get(client.label) ?? 0).find(event => {
        if (event.kind !== "browser-surface2") {
          return false;
        }
        const observation = event.observation;
        const surfaceContract = BATTLE_PROMPT_PHASES.get(observation.surfaceId);
        const instanceKey = instanceKeyFor(client, observation);
        // Prompt cursors advance after every public Space, but the structural BattleEnd/Faint proof
        // authorizes the entire bounded settlement narration chain. Keep that proof's scan floor at
        // this driver's boundary; otherwise consuming TrainerVictory/MoneyReward hides BattleEnd from
        // the immediately following MoneyReward/ModifierReward prompt (run 30370796112).
        const addressMatches = battlePromptMatchesAddress(
          client,
          from[client.label] ?? 0,
          event,
          expectedAddress,
          sharedCurrentAddress,
        );
        return (
          BATTLE_PROMPT_PHASES.has(observation.surfaceId)
          && addressMatches
          && (surfaceContract?.phases == null || surfaceContract.phases.has(observation.phase))
          && observation.uiMode === surfaceContract?.uiMode
          && observation.ownerModel === "local"
          && observation.coop === true
          && observation.seatsWithInput?.includes(observation.localSeat)
          && Number.isSafeInteger(observation.phaseInstance)
          && observation.ready?.handlerActive === true
          && observation.ready?.awaitingActionInput === true
          && observation.ready?.inputBlocked !== true
          && pairedTrainerVictoryIsReady(observation)
          && !consumedInstances.has(instanceKey)
        );
      });
      if (!readyEvent) {
        continue;
      }
      // Evidence is append-only; an old ready event remains searchable after its UI has been replaced.
      // It authorizes input only while it is still the browser's CURRENT semantic surface. Run
      // 29673757003's depth lane recreated this helper after a faint and re-pressed stale CommandPhase,
      // MessagePhase and ExpPhase events into the live SwitchPhase boundary. Retire stale candidates
      // without spending a key; the next poll can admit the current prompt if one exists.
      const latestSurface = client.evidence.findLastSemanticSurface(cursors.get(client.label) ?? 0);
      if (latestSurface?.index !== readyEvent.index) {
        cursors.set(client.label, readyEvent.index + 1);
        continue;
      }
      if (readyEvent.observation.phase === "TrainerVictoryPhase") {
        // Both victory messages are local human-input surfaces. Real players do not dismiss them on the
        // same frame, and the production Authority V2 contract must keep the ordered successor fenced while
        // either exact presentation remains open. Start only after both addressed prompts are proven, then
        // deliberately advance the authority first and hold a short human-sized skew before advancing the
        // renderer. Re-prove the renderer after the skew: an older implementation let WAVE_ADVANCE overtake
        // this prompt, so blindly spending the saved key would conceal the product failure instead of
        // detecting it. The in-flight pair is completed in this call, avoiding the old next-poll bug where
        // the authority's newer reward surface made the still-actionable renderer prompt undiscoverable.
        const pairedEvents = clients.map(peer => ({
          client: peer,
          event: peer.evidence.findLastSemanticSurface(from[peer.label] ?? 0),
        }));
        const authorityPair = pairedEvents.find(({ client: peer }) => peer === rig.host);
        const authorityObservation = authorityPair?.event?.observation;
        // Only the authoritative engine executes BattleEndPhase. The renderer enters its retained
        // TrainerVictoryPhase directly from the signed CONTROL_COMMIT, so requiring a renderer-local
        // BattleEnd marker makes a healthy exact pair permanently undiscoverable. Prove the causal
        // successor once on the host, then require both CURRENT prompts to name that same immutable
        // successor address. The replica cannot manufacture this surface: production exposes it only
        // after applying the retained trainer-victory-open material.
        const pairIsCurrentAndUnspent = pairedEvents.every(({ client: peer, event }) => {
          const observation = event?.observation;
          return (
            event != null
            && observation?.phase === "TrainerVictoryPhase"
            && observation.surfaceId === "battle:message"
            && observation.address?.epoch === authorityObservation?.address?.epoch
            && observation.address?.wave === authorityObservation?.address?.wave
            && observation.address?.turn === authorityObservation?.address?.turn
            && observation.ready?.handlerActive === true
            && observation.ready?.awaitingActionInput === true
            && observation.ready?.inputBlocked !== true
            && !consumedInstances.has(instanceKeyFor(peer, observation))
          );
        });
        if (
          authorityPair?.event == null
          || !battlePromptMatchesAddress(
            authorityPair.client,
            from[authorityPair.client.label] ?? 0,
            authorityPair.event,
            expectedAddress,
          )
          || !pairIsCurrentAndUnspent
        ) {
          continue;
        }
        await advanceReadyPrompt(authorityPair.client, authorityPair.event);
        await delay(rig.trainerVictoryStaggerMs ?? 1_500);
        for (const paired of pairedEvents) {
          if (paired.client === rig.host || paired.event == null) {
            continue;
          }
          const current = paired.client.evidence.findLastSemanticSurface(paired.event.index);
          if (
            current == null
            || current.observation.phase !== "TrainerVictoryPhase"
            || current.observation.surfaceId !== "battle:message"
            || instanceKeyFor(paired.client, current.observation)
              !== instanceKeyFor(paired.client, paired.event.observation)
            || current.observation.ready?.handlerActive !== true
            || current.observation.ready?.awaitingActionInput !== true
            || current.observation.ready?.inputBlocked === true
          ) {
            throw new Error(
              `${purpose}: renderer trainer-victory prompt was superseded during the authority-first human input skew`,
            );
          }
          await advanceReadyPrompt(paired.client, current);
        }
        return true;
      }
      // The semantic mirror is frame-driven and can lag the production phase boundary on a heavily
      // throttled browser. In market-wide-lens 30691739712, SwitchPhase had already started but the
      // last semantic observation was still the preceding MessagePhase for another ten seconds. A
      // stale prompt Space then entered the replacement party and opened Summary on the fainted slot.
      // A replacement phase start is not ownership proof, but it is conclusive proof that this old
      // battle prompt no longer authorizes input. Wait for the exact owned party surface instead.
      if (client.evidence.find(REPLACEMENT_PHASE_START, readyEvent.index + 1)) {
        continue;
      }
      // A live party picker (faint replacement OR a Mystery-encounter `selectPokemonForOption`
      // sub-prompt) means the intro/narration chain has ALREADY yielded to the party UI: the matched
      // message event is stale, and one more Space would fall through into the picker and select a
      // default slot (run 29613070126: the faint picker's fainted-field submenu lacks send-out, so
      // the slot drive threw "target not in options"; the ME party class is the same fall-through
      // hazard). Leave the picker to driveReplacement / driveMysteryPartyPicker.
      if (isPartyPickerSurfaceOpen(latestSurface?.observation)) {
        continue;
      }
      await advanceReadyPrompt(client, readyEvent);
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
  const interactiveMysteryPhases = INTERACTIVE_MYSTERY_NARRATION_PHASES;
  // Keep this aligned with Ui.coopMeInteractivePhase(): these are the production phases whose
  // MESSAGE handlers can participate in the owner/watcher ME input pump. Run 29672540141 selected
  // a guest-owned option successfully, advanced its selected-option dialogue, and then left the
  // authoritative host visibly parked in MysteryEncounterOptionSelectedPhase because the browser
  // driver admitted only the opening MysteryEncounterPhase. A real player can and must advance
  // that prompt too. The surface/operation/readiness/ownership fences below remain the authority;
  // this set only names the phase classes in which that exact public prompt is valid.
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
        // #816 (GUEST-owned ME): the authoritative HOST runs the sole ME engine and, per ui.ts
        // processInputCoopAware, ADVANCES ITS OWN engine MESSAGE dialogue while a GUEST owns the ME. The
        // guest renderer (CoopReplayMePhase) cannot drive the host's authoritative narration (its Space
        // advances only the local replay, never relays), so NOTHING else presses the host's opening,
        // selected-option, reward, quiz, or post-event prompt. The host is NOT the owner here
        // (localSeat !== ownerSeat), so this branch is disjoint from ownerDrives and never fires on a
        // host-owned ME. The outer interactiveMysteryPhases fence still limits this to production ME phases.
        const hostEngineDialogue = client === rig.host && observation.localSeat !== observation.ownerSeat;
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
          && observation.ready?.inputBlocked !== true
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
    waveProgressAllowanceMs = Math.max(animationAllowanceMs, WAVE_PROGRESSION_ALLOWANCE_MS),
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
      // A retained evolution is one finite presentation event, but on the two-Chromium SwiftShader runner
      // its staged tween can outlive the one-time replay-phase allowance. Every heartbeat names a distinct,
      // monotonically advancing stage from that closed cutscene (assets -> cycle -> reveal -> completion),
      // so it is causal progress rather than a keepalive. It may refresh only inside the existing immutable
      // animations-on hard ceiling.
      const retainedEvolutionProgress =
        /\[coop:progression\] GUEST retained evolution heartbeat\b[\s\S]*\bstage=/u.test(text);
      const retainedWaveProgress =
        phase === "CoopWaveProgressionReplayPhase" || /\bWAVE_ADVANCE\b/u.test(text) || retainedEvolutionProgress;
      const progress =
        phase
        ?? (retainedWaveProgress ? "wave-successor" : null)
        ?? (OUTCOME_PROGRESS_AUTHORITY.test(text) ? "authority-stream" : null)
        ?? (OUTCOME_PROGRESS_RENDERER.test(text) ? "renderer-stream" : null)
        ?? (OUTCOME_PROGRESS_RESOLUTION.test(text) ? "turn-resolution" : null);
      if (progress == null) {
        continue;
      }
      const parsedEventAtMs = Date.parse(event.at ?? "");
      const eventAtMs = Number.isFinite(parsedEventAtMs) ? Math.max(parsedEventAtMs, startedAtMs) : now();
      const previousDeadlineMs = deadlineMs;
      const allowanceMs = retainedWaveProgress ? waveProgressAllowanceMs : animationAllowanceMs;
      deadlineMs = Math.min(hardDeadlineMs, Math.max(deadlineMs, eventAtMs + allowanceMs));
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
        allowanceMs,
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

/**
 * A Mystery-difficulty run can cross several complete, human-driven encounters before another battle
 * command exists. A single fixed between-wave deadline therefore measures the whole gauntlet as though it
 * were one stalled screen. Refresh one normal surface allowance after each proven public input, while an
 * immutable ceiling derived from the required gauntlet coverage still makes loops fail loudly.
 */
export function createRegisteredSurfaceProgressBudget(
  baseTimeoutMs,
  progressAllowanceMs,
  maxExtensionWindows,
  { now = () => Date.now() } = {},
) {
  const startedAtMs = now();
  const hardDeadlineMs =
    startedAtMs + Math.max(0, baseTimeoutMs) + Math.max(0, progressAllowanceMs) * Math.max(0, maxExtensionWindows);
  let deadlineMs = Math.min(startedAtMs + Math.max(0, baseTimeoutMs), hardDeadlineMs);

  const noteProgress = () => {
    const previousDeadlineMs = deadlineMs;
    deadlineMs = Math.min(hardDeadlineMs, Math.max(deadlineMs, now() + Math.max(0, progressAllowanceMs)));
    return Object.freeze({
      previousDeadlineMs,
      deadlineMs,
      hardDeadlineMs,
      extensionApplied: deadlineMs > previousDeadlineMs,
      hardCeilingReached: deadlineMs === hardDeadlineMs,
    });
  };

  return Object.freeze({
    noteProgress,
    deadline: () => deadlineMs,
    hardDeadline: () => hardDeadlineMs,
  });
}

/** Whether a skipped-move-animation journey still retains a finite native evolution cutscene. */
export function retainedPartyEvolutionNeedsProgressBudget(partyMutatingReward) {
  return (
    partyMutatingReward?.required === true
    && /^(?:EVOLUTION_ITEM|RARE_EVOLUTION_ITEM)$/u.test(partyMutatingReward.rewardId ?? "")
  );
}

/**
 * Prove that an embedded battle has already crossed into the next wave's public encounter presentation.
 *
 * Mystery battles do not necessarily open the ordinary reward shop. Their authoritative terminal path can install
 * the next wave's `NextEncounterPhase` directly, so waiting only for reward/faint/command markers mislabels healthy
 * cross-wave progress as a battle softlock. This proof is intentionally narrow: both CURRENT semantic surfaces must
 * be the same immutable next-wave/turn-1 state, on the exact encounter phase, and newer than this submitted turn.
 */
export function findSharedSuccessorWavePresentation(rig, from) {
  const clients = Object.values(rig.clients);
  const events = clients.map(client => client.evidence.findLastSemanticSurface(from[client.label] ?? 0));
  if (events.some(event => event == null)) {
    return null;
  }
  const observations = events.map(event => event.observation);
  const first = observations[0];
  const address = first.address;
  if (
    first.surfaceId !== "battle:message"
    || first.operationClass !== "battle-progress"
    || first.phase !== "NextEncounterPhase"
    || first.coop !== true
    || !Number.isSafeInteger(address?.epoch)
    || address.wave !== rig.activeBattleWave + 1
    || address.turn !== 1
    || typeof first.stateDigest !== "string"
    || first.stateDigest.length === 0
  ) {
    return null;
  }
  const sharedIdentity = observation =>
    JSON.stringify([
      observation.surfaceId,
      observation.operationClass,
      observation.phase,
      observation.address?.epoch,
      observation.address?.wave,
      observation.address?.turn,
      observation.membershipRevision,
      observation.connectionGenerations,
      observation.mysteryEncounterType ?? null,
      observation.stateDigest,
    ]);
  if (observations.some(observation => sharedIdentity(observation) !== sharedIdentity(first))) {
    return null;
  }
  return Object.freeze({
    epoch: address.epoch,
    wave: address.wave,
    turn: address.turn,
    stateDigest: first.stateDigest,
    mysteryEncounterType: first.mysteryEncounterType ?? null,
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
    animationProgressAllowanceMs = null,
    singleSidedConfirmMs = 0,
    driveTargetSelection = null,
    driveRegisteredInteraction = null,
  } = {},
) {
  const clients = Object.values(rig.clients);
  const fixedDeadline = Date.now() + timeoutMs;
  const animationBudget = extendForAnimationProgress
    ? createAnimationProgressBudget(rig, from, timeoutMs, {
        ...(animationHardCeilingMs == null ? {} : { hardCeilingMs: animationHardCeilingMs }),
        ...(animationProgressAllowanceMs == null ? {} : { animationAllowanceMs: animationProgressAllowanceMs }),
      })
    : null;
  const confirmationHardDeadline =
    (animationBudget?.hardDeadline() ?? fixedDeadline) + Math.max(0, singleSidedConfirmMs);
  let singleSidedCandidate = null;
  let nextCommandPromptIdentity = null;
  let advanceNextCommandPrompt = null;
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
    // SelectModifierPhase is shared by the ordinary reward shop and the every-ten-waves biome
    // market. A phase-name match therefore cannot classify the public surface: navigation run
    // 30589285987 reached a healthy, synchronized biome market and was then falsely forced through
    // assertSharedSurface("reward"). Wait for the sealed browser observer on BOTH clients and carry
    // the exact surface identity to the battle driver. The between-wave dispatcher performs the
    // full owner/watcher/state proof before sending any input.
    const marketOutcome = findPairedMarketOutcome(clients, from);
    if (marketOutcome != null) {
      return marketOutcome;
    }
    if (clients.every(client => client.evidence.findLastSemanticSurface(from[client.label], "reward-shop") != null)) {
      return { kind: "reward", surfaceId: "reward-shop" };
    }
    const successorWave = findSharedSuccessorWavePresentation(rig, from);
    if (successorWave != null) {
      return { kind: "wave-transition", boundary: successorWave };
    }
    for (const client of clients) {
      // Ownership-PROVEN faint detection only: the semantic party:replacement mirror carries the
      // exact localSeat/ownerSeat/actionability proof of which seat owes a pick. Phase-name/log
      // evidence is NOT ownership evidence - the sole authoritative host runs "Start Phase
      // SwitchPhase" even for a GUEST-owned (or already-resolved / stale) faint, so classifying a
      // faint from that host log mis-routed driveReplacement to the host, which then hung on a
      // host-owned picker that never opens (run 29912693840 depth lane: both leads alive and
      // commanding at wave 2 while the driver timed out waiting for an owned host picker). This is
      // the same semantic-only contract the post-turn journey scanner already holds
      // (waitForPostTurnOutcome); the outcome loop below waits for a lagging picker to become
      // actionable rather than trusting a bare phase name.
      if (findOwnedActionableReplacementSurface(client, from[client.label])) {
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
          const address = commandCandidate.event.observation?.address;
          const expectedAddress =
            Number.isSafeInteger(address?.epoch)
            && Number.isSafeInteger(address?.wave)
            && Number.isSafeInteger(address?.turn)
              ? `${address.epoch}:${address.wave}:${address.turn}`
              : null;
          nextCommandPromptIdentity = expectedAddress == null ? null : identity;
          advanceNextCommandPrompt =
            expectedAddress == null
              ? null
              : createBattlePromptAdvancer(rig, from, {}, "post-turn-next-command-frontier", {
                  expectedCommandAddress: expectedAddress,
                });
        }
        if (Date.now() - singleSidedCandidate.sinceMs >= singleSidedConfirmMs) {
          return { kind: "command", client: commandCandidate.client };
        }
      }
    }
    // A target press can synchronously publish the submitted turn's progress evidence. Re-check
    // that evidence before invoking the target hook again: a browser may keep the old target
    // surface rendered for another frame, and a test double may deliberately keep returning true.
    // Letting the callback outrank this proof can spin forever and starve both the deadline and the
    // successfully observed outcome (campaign build 30385689570).
    if (stopOnTurnProgress && clientsAwaitingTurnProgress(rig, from).length === 0) {
      return { kind: "turn-progress" };
    }
    // Some registered interactions are real mid-turn human boundaries. Revival Blessing is the
    // first deterministic example: both commands have already entered the authoritative turn, then
    // one owner must choose a fainted party member while the peer remains an inert watcher. Keep
    // this exact public UI-to-relay chain armed in every causal outcome wait instead of limiting the
    // generic registered-surface driver to rewards/between-wave phases.
    if (driveRegisteredInteraction && (await driveRegisteredInteraction())) {
      continue;
    }
    // A move submission can open SelectTargetPhase only after the final sequential command owner
    // has been removed from the command driver's pending set. The target is ordinary required human
    // input, not evidence that the move failed. Consume only the caller's exact-address, readiness-
    // proven target before the short blind-fallback timer can arm (run 30380532647 spent 15 seconds
    // on every turn and then used fallback's first Space merely to confirm this visible picker).
    if (driveTargetSelection && (await driveTargetSelection())) {
      continue;
    }
    // A next-turn owner can open before its partner finishes a real CommandPhase MESSAGE prompt.
    // The caller's ordinary advancer is pinned to the command that was just submitted and therefore
    // (correctly) rejects this next address. Drive the exact candidate address here while confirming
    // the one-sided frontier, just as the second human would press that visible prompt. Never scan
    // generically: a replaced candidate discards this closure and receives a newly pinned one.
    if (
      advanceNextCommandPrompt != null
      && nextCommandPromptIdentity === singleSidedCandidate?.identity
      && (await advanceNextCommandPrompt())
    ) {
      continue;
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
 * Returns "reward" when the ordinary reward shop is open, "between-wave" when a registered
 * post-battle surface such as the biome market is already open, or "wipe" when the shared session
 * ends (game-over) mid-battle. Throws only on a genuine softlock (no reward, no wipe, no progress
 * within budget) - named distinctly from a wipe so a lost wave reads as evidence, not a harness bug.
 */
async function driveBattleWave(rig, policy, stats, reportProgress = async () => {}) {
  const clients = Object.values(rig.clients);
  let commandCursors = initialBattleCommandCursors(clients);
  let pendingCommandProof = null;
  const fallbackWindow = Math.min(rig.config.timeoutMs, 15_000);
  const finishSuccessorWaveTransition = (outcome, cursors) => {
    // Preserve the post-command floor so the between-wave driver can consume an encounter prompt that was already
    // visible when this battle wait returned. Capturing a fresh cursor there would strand the exact current prompt.
    stats._successorWaveCursors = cursors;
    rig.host.evidence.record("campaign-successor-wave-presentation", outcome.boundary);
    return "transition";
  };
  const finishPostBattleSurface = async (outcome, cursors, proofName) => {
    if (outcome.surfaceId === "biome-market") {
      // BiomeShopPhase deliberately uses SelectModifierPhase as its phaseName, but it is a distinct
      // registered interaction. Preserve it untouched for advanceToNextWaveCommand, whose biome-shop
      // driver proves the paired V2 projection and its actual owner before driving the market.
      rig.host.evidence.record("campaign-between-wave-surface", {
        surfaceId: outcome.surfaceId,
        wave: stats.wave,
        proofName,
      });
      return "between-wave";
    }
    if (outcome.surfaceId !== "reward-shop") {
      throw new Error(`[campaign-outcome] unsupported post-battle surface ${String(outcome.surfaceId)}`);
    }
    await rig.assertSharedSurface("reward", cursors, proofName, {
      expectedWave: rig.activeBattleWave,
    });
    await rig.assertRetainedContinuation(cursors, proofName);
    return "reward";
  };
  const maxBattleTurns = campaignBattleTurnBudget(rig.config.maxTurns, policy);
  const cycleCampaignMoves =
    policy.navigation.required || policy.market.requiredPurchases > 0 || policy.mysteryGauntlet.required;
  for (let turn = 1; turn <= maxBattleTurns; turn++) {
    const purpose = `wave-${stats.wave}-turn-${turn}`;
    await reportProgress("battle turn started", {
      wave: stats.wave,
      ordinal: stats.ordinal,
      turn,
    });
    if (pendingCommandProof != null) {
      // The previous round's "next command" may have been a wave-end transient (renderer-local
      // CommandPhase superseded by the authoritative reward flow). Probe the wave-end markers
      // once BEFORE pressing more battle keys, so no key is ever driven into the reward shop.
      const superseded = await waitForOutcomeBounded(rig, pendingCommandProof.cursors, 1, {});
      if (superseded?.kind === "reward") {
        return finishPostBattleSurface(
          superseded,
          pendingCommandProof.cursors,
          `${pendingCommandProof.name}-superseded-by-reward`,
        );
      }
      if (superseded?.kind === "wipe") {
        return "wipe";
      }
      if (superseded?.kind === "wave-transition") {
        return finishSuccessorWaveTransition(superseded, pendingCommandProof.cursors);
      }
    }
    const commandRound = await rig.driveSequentialCommandRound(
      commandCursors,
      policy.keys.battle,
      `${purpose}-attack-first`,
      {
        driveCommand: policy.keys.battleKeysFromEnv
          ? null
          : (client, commandPurpose, commandEvent) =>
              driveBestCampaignMove(client, commandPurpose, {
                timeoutMs: rig.config.timeoutMs,
                // Ordinary campaigns keep choosing the strongest visible move. The sealed
                // navigation/market fixture deliberately exposes a legal multi-type coverage set
                // and cycles it like a human responding to an immunity; otherwise one immune foe
                // can consume the longitudinal journey before it reaches the target interactions.
                commandEvent,
                cycleIndex: cycleCampaignMoves ? turn - 1 : 0,
                preferredMoveId: policy.registeredInteractions.preferredMoveId,
              }),
      },
    );
    const { outcomeCursors, expectedCommandAddress, commandPartition } = commandRound;
    await reportProgress("battle commands submitted", {
      wave: stats.wave,
      ordinal: stats.ordinal,
      turn,
      expectedCommandAddress,
    });
    if (pendingCommandProof != null) {
      try {
        await rig.assertSequentialCommandFrontier(commandRound, pendingCommandProof.cursors, pendingCommandProof.name, {
          // The exact expected address and per-round cursors already prove freshness. The frontier
          // may also have been accepted by another public journey boundary before this deliberately
          // deferred proof runs, so a mutable global "last address" must not hide the historical
          // owner+watcher pair after the following sequential round has superseded it.
          allowAddressRepeat: true,
          expectedWave: rig.activeBattleWave,
        });
        await rig.assertRetainedContinuation(pendingCommandProof.cursors, pendingCommandProof.name, {
          retainedTurnAddress: pendingCommandProof.retainedTurnAddress,
          // If the authoritative collection-close proof says the guest has no command at the successor
          // address (for example its final Pokemon fainted), no guest continuationReady event can exist.
          // The exact V2 retirement/subsumption proof remains the progression authority.
          allowGuestOmission: commandPartition?.omitted.some(candidate => candidate.label === rig.guest.label) === true,
        });
      } catch (error) {
        // Belt-and-braces for the wave-end transient (see the pre-round probe above): if the
        // frontier never converged because the wave actually ENDED, honor the real outcome.
        const superseded = await waitForOutcomeBounded(rig, pendingCommandProof.cursors, 1, {});
        if (superseded?.kind === "reward") {
          return finishPostBattleSurface(
            superseded,
            pendingCommandProof.cursors,
            `${pendingCommandProof.name}-superseded-by-reward`,
          );
        }
        if (superseded?.kind === "wipe") {
          return "wipe";
        }
        if (superseded?.kind === "wave-transition") {
          return finishSuccessorWaveTransition(superseded, pendingCommandProof.cursors);
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
    const driveTargetSelection = () =>
      rig.driveAddressedTargetSelection(from, expectedCommandAddress, `${purpose}-post-command-target`);
    const driveRegisteredInteraction = createBattleRegisteredInteractionDriver(rig, policy, from, stats);
    let outcome = await waitForOutcomeBounded(rig, from, fallbackWindow, {
      stopOnTurnProgress: true,
      stopOnOwnedCommandFrontier: true,
      singleSidedConfirmMs: SINGLE_SIDED_COMMAND_CONFIRM_MS,
      driveTargetSelection,
      driveRegisteredInteraction,
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
        // A partner target picker can become actionable only after the other browser has already
        // entered its turn path on a CPU-dilated runner. Keep the same exact-address semantic driver
        // armed throughout the causal wait; the consumed-instance ledger prevents duplicate input.
        driveTargetSelection,
        driveRegisteredInteraction,
        extendForAnimationProgress: true,
        animationHardCeilingMs: policy.moveAnimationsExpected ? ANIMATIONS_ON_OUTCOME_HARD_CEILING_MS : null,
        animationProgressAllowanceMs: policy.moveAnimationsExpected ? ANIMATIONS_ON_PROGRESS_ALLOWANCE_MS : null,
        stopOnOwnedCommandFrontier: true,
        singleSidedConfirmMs: SINGLE_SIDED_COMMAND_CONFIRM_MS,
      });
    }
    if (!outcome && !turnProgressed) {
      // Drain once after the bounded wait as well. The timer can resume after its deadline while
      // the target event is already buffered; an exact semantic target must always outrank blind
      // command cycling. If this consumes the picker, the ordinary outcome wait below observes the
      // resulting turn and no fallback is counted.
      const recoveredTarget = await driveTargetSelection();
      // Attack-first did not resolve or fully enter the turn (no PP / disabled / wrong target).
      // Cycle only clients lacking turn-progress evidence; never replay input on a client whose
      // valid turn is already executing under browser CPU pressure.
      if (!recoveredTarget) {
        fallbackClients.push(
          ...(await driveBattleFallback(
            rig,
            policy.keys.battleFallback,
            from,
            `${purpose}-fallback`,
            expectedCommandAddress,
          )),
        );
      }
      if (fallbackClients.length > 0) {
        stats.fallbackTurns += 1;
      }
      outcome = await waitForOutcomeBounded(rig, from, rig.config.timeoutMs, {
        advanceBattlePrompt,
        // Blind fallback can open the real target picker rather than submit the move. Continue the
        // address-bound UI-to-relay chain during this second wait instead of parking a real human UI.
        driveTargetSelection,
        driveRegisteredInteraction,
        extendForAnimationProgress: true,
        animationHardCeilingMs: policy.moveAnimationsExpected ? ANIMATIONS_ON_OUTCOME_HARD_CEILING_MS : null,
        animationProgressAllowanceMs: policy.moveAnimationsExpected ? ANIMATIONS_ON_PROGRESS_ALLOWANCE_MS : null,
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
    await reportProgress("battle turn outcome observed", {
      wave: stats.wave,
      ordinal: stats.ordinal,
      turn,
      outcome: outcome.kind,
      surfaceId: outcome.surfaceId ?? null,
    });
    if (outcome.kind === "wipe") {
      return "wipe";
    }
    if (outcome.kind === "reward") {
      return finishPostBattleSurface(outcome, from, `wave-${stats.wave}-turn-${turn}-${outcome.surfaceId}`);
    }
    if (outcome.kind === "wave-transition") {
      return finishSuccessorWaveTransition(outcome, from);
    }
    if (outcome.kind === "faint") {
      stats.faints += 1;
      await rig.driveReplacement(outcome.client, from);
    }
    if (outcome.kind === "command") {
      // The next command owners open one at a time. The next sequential round proves and
      // consumes both public surfaces before asserting two-sided continuation convergence.
      pendingCommandProof = {
        cursors: from,
        name: `wave-${stats.wave}-turn-${turn}-next-command`,
        retainedTurnAddress: expectedCommandAddress,
      };
    }
    commandCursors = from;
  }
  throw new Error(`[campaign-softlock] wave ${stats.wave} did not reach rewards in ${maxBattleTurns} rounds`);
}

/**
 * The client that reports ITSELF as owner of `surfaceId` in the v2 semantic mirror
 * (ownerSeat === its own localSeat), or null. Evidence-derived ownership - never rig.host.
 */
function findSemanticOwner(rig, surfaceId, cursors, { currentOnly = false } = {}) {
  for (const client of Object.values(rig.clients)) {
    const cursor = cursors[client.label] ?? 0;
    const event = client.evidence.findLastSemanticSurface(cursor, surfaceId);
    if (currentOnly && event?.index !== client.evidence.findLastSemanticSurface(cursor)?.index) {
      continue;
    }
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

/** Whether every mirror event refers to the same authoritative surface address. */
function semanticEventsShareAppearance(events) {
  const observations = events.map(event => event?.observation);
  if (observations.some(observation => observation == null)) {
    return false;
  }
  const identities = observations.map(observation =>
    JSON.stringify([
      observation.surfaceId,
      observation.address?.epoch,
      observation.address?.wave,
      observation.address?.turn,
    ]),
  );
  return new Set(identities).size === 1;
}

/**
 * Whether a legacy phase/owner marker still belongs to the client's current phase.
 *
 * Phase start lines are intentionally retained for the entire campaign. They may prove
 * that a registered UI is still being constructed only until a later phase starts. Once
 * that happens, treating the old marker as a pending surface turns legitimate no-op
 * phases (for example EggLapsePhase with no egg to hatch) into deadline-long false reds.
 */
function legacySurfacePhaseIsCurrent(client, driver, cursor) {
  if (!(driver.phase instanceof RegExp)) {
    return true;
  }
  const surfacePhase = client.evidence.findLast(driver.phase, cursor);
  if (surfacePhase == null) {
    return false;
  }
  const currentPhase = client.evidence.findLast(START_PHASE, cursor);
  return currentPhase == null || surfacePhase.index >= currentPhase.index;
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
          const cursor = cursors[client.label] ?? 0;
          const event = client.evidence.findLastSemanticSurface(cursor, driver.v2SurfaceId);
          // Semantic-only sub-surfaces have no phase/owner fallback. They are pending only while
          // they are the browser's CURRENT public surface; retaining an old reward-target after
          // LearnMovePhase (or an old ME subprompt after its successor) mislabeled the eventual
          // timeout and could mask a genuinely different stuck UI for the entire outer deadline.
          const current = client.evidence.findLastSemanticSurface(cursor);
          return (
            (!driver.semanticOnly || event?.index === current?.index)
            && semanticAppearanceIsNew(event, handledIndex.get(`${driver.name}:${client.label}`))
          );
        });
      }
      if (driver.semanticOnly) {
        return false;
      }
      return Object.values(rig.clients).some(client => {
        if (!legacySurfacePhaseIsCurrent(client, driver, cursors[client.label] ?? 0)) {
          return false;
        }
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

  // Renderer-only prompts are reciprocal local input: each browser owns and dismisses its own copy.
  // They deliberately have ownerSeat=null, so the alternating shared-interaction owner resolver cannot
  // and must not choose one peer on behalf of the other.
  if (driver.localPerClientSurface) {
    for (const client of clients) {
      const event = findLocalActionableIvScannerSurface(client, cursors[client.label] ?? 0);
      if (notYetHandled(client, event)) {
        return { client, markerEvent: event };
      }
    }
    return null;
  }

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
    const semanticOwner = findSemanticOwner(rig, driver.v2SurfaceId, cursors, {
      currentOnly: driver.semanticOnly === true,
    });
    if (semanticOwner) {
      if (driver.semanticOnly) {
        const cursor = cursors[semanticOwner.client.label] ?? 0;
        const current = semanticOwner.client.evidence.findLastSemanticSurface(cursor);
        if (semanticOwner.markerEvent.index !== current?.index) {
          // Semantic-only controls have no phase/owner fallback. A completed in-battle Revival can remain
          // in the wave-wide evidence window when the between-wave dispatcher is recreated; once reward,
          // command, or any other public surface supersedes it, that historical owner must never be driven
          // again. findRegisteredSurface already held this invariant; direct dispatch must hold it too.
          return null;
        }
      }
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
    const semanticEvents = clients.map(client => {
      const cursor = cursors[client.label] ?? 0;
      const event = client.evidence.findLastSemanticSurface(cursor, driver.v2SurfaceId);
      // Semantic-only controls are mutually exclusive current UI states. Once the owner advances
      // from Bargain/quiz/subprompt to its terminal narration while the watcher intentionally
      // retains the frozen replica, the owner's historical surface must not help manufacture a
      // malformed two-sided appearance. This is the same current-only rule used above to select
      // the owner and by findRegisteredSurface to decide whether the driver is still pending.
      return driver.semanticOnly === true && event?.index !== client.evidence.findLastSemanticSurface(cursor)?.index
        ? null
        : event;
    });
    if (semanticEvents.every(event => event == null)) {
      return null;
    }
    // Watchers can publish the addressed semantic surface before the owning browser finishes the
    // preceding narration/phase transition. Treat that one-sided projection as provisional: the Mystery
    // browser campaign otherwise fails in the few seconds between the watcher's ownerSeat=partner marker
    // and the partner's own ownerSeat===localSeat mirror. Once every browser has published this surface,
    // a missing self-owner is genuinely malformed and still fails loudly.
    if (strict && semanticEvents.every(event => event != null) && semanticEventsShareAppearance(semanticEvents)) {
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

export function mechanicalBoundaryFromPairedSurfaces(events, surfaceId) {
  const ownerEvent = events.find(event => {
    const observation = event?.observation;
    return (
      observation?.localSeat === observation?.ownerSeat && observation.seatsWithInput?.includes(observation.ownerSeat)
    );
  });
  if (ownerEvent == null) {
    throw new Error(`[campaign-convergence] paired ${surfaceId} surface omitted its actionable owner`);
  }
  return {
    authority: ownerEvent.observation,
    ownerEvent,
    peerEvents: events.filter(event => event !== ownerEvent),
  };
}

const normalizeMysteryProjectionPhase = phase => (phase === "CoopReplayMePhase" ? "MysteryEncounterPhase" : phase);

/**
 * Compare a projected Mystery surface against the host-authored immutable view.
 *
 * Nested structured phases such as ErQuizPhase do not retain the ambient
 * `mysteryEncounterType` on every renderer even though the paired presentation already proved that
 * lineage. A missing value is therefore telemetry, while two conflicting non-null values are still
 * divergence. Address, state digest, options, operation, phase, and ownership remain exact.
 */
export function pairedMysteryProjectionMatches(authority, observation, stage) {
  const sameAddress = JSON.stringify(observation.address) === JSON.stringify(authority.address);
  const sameOptions = JSON.stringify(observation.optionIds ?? null) === JSON.stringify(authority.optionIds ?? null);
  const authorityEncounterType = authority.mysteryEncounterType ?? null;
  const observedEncounterType = observation.mysteryEncounterType ?? null;
  const sameEncounterLineage =
    stage === "reward"
    || authorityEncounterType == null
    || observedEncounterType == null
    || observedEncounterType === authorityEncounterType;
  const sameDisplayedWave =
    authority.displayedWave === authority.address.wave && observation.displayedWave === observation.address.wave;
  return (
    observation.surfaceId === authority.surfaceId
    && normalizeMysteryProjectionPhase(observation.phase) === normalizeMysteryProjectionPhase(authority.phase)
    && observation.uiMode === authority.uiMode
    && observation.operationClass === authority.operationClass
    && observation.ownerSeat === authority.ownerSeat
    && observation.selectedOptionId === authority.selectedOptionId
    && sameEncounterLineage
    && observation.stateDigest === authority.stateDigest
    && sameDisplayedWave
    && sameAddress
    && sameOptions
  );
}

/**
 * Select the newest globally ordered Mystery surface without treating the runtime host as a progress clock.
 *
 * Interaction ownership alternates independently of the transport role. At a wave edge the interaction owner can
 * install N+1 before the runtime host has replaced its retained N surface. Canonizing the host in that window makes
 * the campaign wait for an already-retired address forever. Prefer the greatest address within the same session;
 * retain the runtime host only as the deterministic tie-breaker for two observations of that exact address.
 */
export function selectLatestMysteryAuthorityEvent(events) {
  const hostEvent = events.find(event => event?.observation?.localRole === "host") ?? events[0];
  if (hostEvent == null) {
    throw new Error("[campaign-convergence] paired Mystery surface omitted every browser observation");
  }
  return events.reduce((selected, candidate) => {
    const selectedAddress = selected?.observation?.address;
    const candidateAddress = candidate?.observation?.address;
    if (selectedAddress == null || candidateAddress == null || selectedAddress.epoch !== candidateAddress.epoch) {
      return selected;
    }
    const selectedOrder = [selectedAddress.wave, selectedAddress.turn];
    const candidateOrder = [candidateAddress.wave, candidateAddress.turn];
    for (let index = 0; index < selectedOrder.length; index += 1) {
      if (candidateOrder[index] !== selectedOrder[index]) {
        return candidateOrder[index] > selectedOrder[index] ? candidate : selected;
      }
    }
    // Cursor/selection projection can briefly lead or trail the actual owner even after both browsers
    // publish the same immutable address and digest. Canonizing the runtime host in that frame freezes a
    // transient watcher cursor and waits for the owner to reproduce stale presentation (run 30928165876,
    // wave 6 reward). At an equal ordered address the actionable interaction owner is the source of truth;
    // runtime host remains only the deterministic fallback when neither event proves ownership.
    const isActionableOwner = event => {
      const observation = event?.observation;
      return (
        observation?.localSeat === observation?.ownerSeat && observation.seatsWithInput?.includes(observation.ownerSeat)
      );
    };
    const selectedIsOwner = isActionableOwner(selected);
    const candidateIsOwner = isActionableOwner(candidate);
    if (selectedIsOwner !== candidateIsOwner) {
      return candidateIsOwner ? candidate : selected;
    }
    return candidate.observation.localRole === "host" ? candidate : selected;
  }, hostEvent);
}

async function checkpointPairedMysterySurface(rig, surfaceId, cursors, stats, stage) {
  const clients = Object.values(rig.clients);
  let events = await Promise.all(
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
          description: `paired Mystery ${stage} surface ${surfaceId}`,
        },
      ),
    ),
  );
  let observations = events.map(surfaceEvent => surfaceEvent.observation);
  // A fast authority can open N+1 while the renderer is still installing the globally ordered terminal for
  // N. That is a provisional frame, not proof of divergence. Use the newest complete ordered surface
  // as the convergence target and require every browser to publish that exact immutable view within the
  // ordinary bounded surface deadline. A genuinely different digest/options/owner never matches and still
  // fails closed; this merely observes the same asynchronous projection edge humans experience.
  const authorityEvent = selectLatestMysteryAuthorityEvent(events);
  const authority = authorityEvent.observation;
  // The two engines legitimately host the SAME mystery surface from different phase classes: the
  // authoritative host sits in MysteryEncounterPhase while the replaying guest presents it from
  // CoopReplayMePhase (run 29595067992: every other field incl. the state digest matched).
  const matchesAuthority = observation => pairedMysteryProjectionMatches(authority, observation, stage);
  if (!observations.every(matchesAuthority)) {
    events = await Promise.all(
      clients.map(client =>
        client.evidence.waitForCondition(
          sink => {
            const event = sink.findLastSemanticSurface(cursors[client.label] ?? 0, surfaceId);
            return event != null && matchesAuthority(event.observation) ? event : null;
          },
          {
            timeoutMs: rig.config.timeoutMs,
            description: `paired Mystery ${stage} convergence at ${JSON.stringify(authority.address)}`,
          },
        ),
      ),
    );
    observations = events.map(surfaceEvent => surfaceEvent.observation);
  }
  // Keep the authority's complete immutable metadata as the canonical proof. A renderer may omit
  // presentation lineage on a nested structured phase, but it may never replace the proven value
  // with null in the campaign ledger.
  const first = authority;
  const proof = {
    stage,
    surfaceId,
    phase: first.phase,
    uiMode: first.uiMode,
    selectedOptionId: first.selectedOptionId ?? null,
    address: first.address,
    ownerSeat: first.ownerSeat,
    optionIds: first.optionIds ?? null,
    mysteryEncounterType:
      stage === "reward"
        ? (stats.mysteryEvents.find(candidate => candidate.wave === first.address.wave)?.mysteryEncounterType ?? null)
        : (first.mysteryEncounterType ?? null),
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
      return { targetReached: true, boundary: null };
    }
  }
  const firstMysteryVisualProof = stage === "presentation" && stats.mysteryEvents.length === 0;
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
  const observedEncounterType = first.mysteryEncounterType ?? null;
  if (stage !== "reward" && event.mysteryEncounterType !== observedEncounterType) {
    throw new Error(
      `[campaign-mystery] encounter type changed within wave ${first.address.wave}: `
        + `${event.mysteryEncounterType} -> ${observedEncounterType}`,
    );
  }
  appendMysteryProof(rig, event, proof);
  await Promise.all(
    clients.map(client =>
      client.checkpoint(`wave-${event.wave}-mystery-${stage}-${surfaceId}`, { full: firstMysteryVisualProof }),
    ),
  );
  return {
    targetReached: false,
    boundary: mechanicalBoundaryFromPairedSurfaces(events, surfaceId),
  };
}

const MYSTERY_WATCHER_SURFACES = new Set([
  "mystery-encounter",
  "mystery-encounter:message",
  "mystery-encounter:prompt",
]);

/**
 * A generic Mystery secondary prompt is intentionally owner-only. The authoritative host runs the
 * encounter engine, but only the interaction owner renders the capture selector; a guest owner gets
 * it from CoopReplayMePhase, while a host owner gets it from MysteryEncounterPhase. The watcher stays
 * on its already-addressed, input-inert Mystery projection.
 *
 * This is not the paired-screen contract used by quizzes/colosseum. Requiring a second
 * `mystery-encounter:prompt` fabricated a harness timeout after production had correctly delivered
 * the host-authored sub-prompt (run 29673757003). Prove the stronger real contract instead: exactly
 * one owner can act, the watcher cannot, and both projections carry one address/digest/encounter.
 */
export function assertAsymmetricMysteryPromptProjection(ownerObservation, watcherObservation) {
  if (
    ownerObservation?.surfaceId !== "mystery-encounter:prompt"
    || ownerObservation.ownerSeat !== ownerObservation.localSeat
    || ownerObservation.seatsWithInput?.length !== 1
    || ownerObservation.seatsWithInput[0] !== ownerObservation.localSeat
    || !isActionableSemanticObservation(ownerObservation)
  ) {
    throw new Error(
      `[campaign-mystery] secondary prompt owner was not exclusively actionable: ${JSON.stringify(ownerObservation)}`,
    );
  }
  if (
    !MYSTERY_WATCHER_SURFACES.has(watcherObservation?.surfaceId)
    || watcherObservation.localSeat === ownerObservation.localSeat
    || watcherObservation.ownerSeat !== ownerObservation.ownerSeat
    || watcherObservation.seatsWithInput?.includes(watcherObservation.localSeat)
    || watcherObservation.seatsWithInput?.length !== 1
    || watcherObservation.seatsWithInput[0] !== ownerObservation.ownerSeat
  ) {
    throw new Error(
      `[campaign-mystery] secondary prompt watcher was not input-inert: ${JSON.stringify(watcherObservation)}`,
    );
  }
  const sameAddress = JSON.stringify(watcherObservation.address) === JSON.stringify(ownerObservation.address);
  if (
    !sameAddress
    || ownerObservation.stateDigest == null
    || watcherObservation.stateDigest !== ownerObservation.stateDigest
    || watcherObservation.mysteryEncounterType !== ownerObservation.mysteryEncounterType
  ) {
    throw new Error(
      "[campaign-mystery] secondary prompt owner/watcher state diverged: "
        + `${JSON.stringify({ ownerObservation, watcherObservation })}`,
    );
  }
  if (
    watcherObservation.surfaceId === ownerObservation.surfaceId
    && JSON.stringify(watcherObservation.optionIds ?? null) !== JSON.stringify(ownerObservation.optionIds ?? null)
  ) {
    throw new Error(
      "[campaign-mystery] mirrored secondary prompt options diverged: "
        + `${JSON.stringify({ ownerObservation, watcherObservation })}`,
    );
  }
  return {
    stage: "subprompt",
    surfaceId: ownerObservation.surfaceId,
    watcherSurfaceId: watcherObservation.surfaceId,
    phase: ownerObservation.phase,
    uiMode: ownerObservation.uiMode,
    selectedOptionId: ownerObservation.selectedOptionId ?? null,
    address: ownerObservation.address,
    ownerSeat: ownerObservation.ownerSeat,
    watcherSeat: watcherObservation.localSeat,
    optionIds: ownerObservation.optionIds ?? null,
    mysteryEncounterType: ownerObservation.mysteryEncounterType ?? null,
    stateDigest: ownerObservation.stateDigest,
  };
}

async function checkpointAsymmetricMysteryPromptSurface(rig, cursors, stats, owner) {
  const ownerEvent = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(cursors[owner.label] ?? 0, "mystery-encounter:prompt");
      const observation = candidate?.observation;
      return observation?.ownerSeat === owner.publicSeat
        && observation.localSeat === owner.publicSeat
        && observation.seatsWithInput?.length === 1
        && observation.seatsWithInput[0] === owner.publicSeat
        && isActionableSemanticObservation(observation)
        ? candidate
        : null;
    },
    {
      timeoutMs: rig.config.timeoutMs,
      description: `owner-only actionable Mystery secondary prompt on ${owner.label}`,
    },
  );
  const authority = ownerEvent.observation;
  const watcher = Object.values(rig.clients).find(client => client !== owner);
  if (watcher == null) {
    throw new Error("[campaign-mystery] secondary prompt has no watcher browser");
  }
  const watcherEvent = await watcher.evidence.waitForCondition(
    sink =>
      sink.events
        .slice(cursors[watcher.label] ?? 0)
        .toReversed()
        .find(traceEvent => {
          const observation = traceEvent.observation;
          return (
            traceEvent.kind === "browser-surface2"
            && MYSTERY_WATCHER_SURFACES.has(observation.surfaceId)
            && observation.localSeat === watcher.publicSeat
            && observation.ownerSeat === authority.ownerSeat
            && !observation.seatsWithInput?.includes(watcher.publicSeat)
            && JSON.stringify(observation.address) === JSON.stringify(authority.address)
            && observation.stateDigest === authority.stateDigest
            && observation.mysteryEncounterType === authority.mysteryEncounterType
          );
        }) ?? null,
    {
      timeoutMs: rig.config.timeoutMs,
      description: `input-inert Mystery secondary watcher projection on ${watcher.label}`,
    },
  );
  const proof = assertAsymmetricMysteryPromptProjection(authority, watcherEvent.observation);
  const event = stats.mysteryEvents.find(candidate => candidate.wave === authority.address.wave);
  const presentation = event?.surfaces.find(surface => surface.stage === "presentation");
  if (
    event == null
    || presentation == null
    || event.ownerSeat !== authority.ownerSeat
    || event.mysteryEncounterType !== (authority.mysteryEncounterType ?? null)
    || JSON.stringify(presentation.address) !== JSON.stringify(authority.address)
    || presentation.stateDigest !== authority.stateDigest
  ) {
    throw new Error(
      "[campaign-mystery] secondary prompt did not descend from its paired presentation: "
        + `${JSON.stringify({ authority, event })}`,
    );
  }
  appendMysteryProof(rig, event, proof);
  await Promise.all(
    Object.values(rig.clients).map(client =>
      client.checkpoint(`wave-${event.wave}-mystery-subprompt-${authority.surfaceId}`),
    ),
  );
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
      const candidate = sink.findLastSemanticSurface(cursors[watcher.label] ?? 0, "bargain");
      return JSON.stringify(candidate?.observation.address) === JSON.stringify(ownerObservation.address)
        ? candidate
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "watcher input-inert mirrored Bargain projection" },
  );
  const proof = assertAsymmetricBargainProjection(ownerObservation, watcherEvent.observation);
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
  stats.mysteryEvents.push(event);
  appendMysteryProof(rig, event, proof);
  await Promise.all(
    Object.values(rig.clients).map(client => client.checkpoint(`wave-${event.wave}-mystery-presentation-bargain`)),
  );
}

/** The Bargain offer is mirrored visually, but only its exact interaction owner may act. */
export function assertAsymmetricBargainProjection(ownerObservation, watcherObservation) {
  if (
    ownerObservation?.surfaceId !== "bargain"
    || ownerObservation.ownerSeat !== ownerObservation.localSeat
    || ownerObservation.seatsWithInput?.length !== 1
    || ownerObservation.seatsWithInput[0] !== ownerObservation.localSeat
    || !isActionableSemanticObservation(ownerObservation)
  ) {
    throw new Error(
      `[campaign-mystery] Bargain owner was not exclusively actionable: ${JSON.stringify(ownerObservation)}`,
    );
  }
  if (
    watcherObservation?.surfaceId !== "bargain"
    || watcherObservation.localSeat === ownerObservation.localSeat
    || watcherObservation.ownerSeat !== ownerObservation.ownerSeat
    || watcherObservation.seatsWithInput?.length !== 1
    || watcherObservation.seatsWithInput[0] !== ownerObservation.ownerSeat
    || watcherObservation.ready?.handlerActive !== true
    || watcherObservation.ready?.inputBlocked !== true
  ) {
    throw new Error(
      `[campaign-mystery] mirrored Bargain watcher was not input-inert: ${JSON.stringify(watcherObservation)}`,
    );
  }
  if (
    JSON.stringify(watcherObservation.address) !== JSON.stringify(ownerObservation.address)
    || ownerObservation.stateDigest == null
    || watcherObservation.stateDigest !== ownerObservation.stateDigest
    || watcherObservation.mysteryEncounterType !== ownerObservation.mysteryEncounterType
    || JSON.stringify(watcherObservation.optionIds ?? null) !== JSON.stringify(ownerObservation.optionIds ?? null)
  ) {
    throw new Error(
      "[campaign-mystery] mirrored Bargain owner/watcher state diverged: "
        + `${JSON.stringify({ ownerObservation, watcherObservation })}`,
    );
  }
  return {
    stage: "presentation",
    surfaceId: ownerObservation.surfaceId,
    watcherSurfaceId: watcherObservation.surfaceId,
    phase: ownerObservation.phase,
    uiMode: ownerObservation.uiMode,
    selectedOptionId: ownerObservation.selectedOptionId ?? null,
    address: ownerObservation.address,
    ownerSeat: ownerObservation.ownerSeat,
    watcherSeat: watcherObservation.localSeat,
    optionIds: ownerObservation.optionIds ?? null,
    mysteryEncounterType: ownerObservation.mysteryEncounterType ?? null,
    stateDigest: ownerObservation.stateDigest,
  };
}

/**
 * Validate the intentionally asymmetric host-owned learn-move presentation. The owner is on the
 * actionable CONFIRM while the partner watches the move list read-only, but both clients must still
 * be on the same authoritative wave/turn and state image. A watcher that has already crossed into
 * NextEncounterPhase is a product ordering failure, not a harmless presentation difference.
 */
export function assertAsymmetricLearnMoveProjection(ownerObservation, watcherObservation) {
  const watcherPhase = watcherObservation?.phase;
  if (
    ownerObservation?.surfaceId !== "learn-move:confirm"
    || ownerObservation.ownerSeat !== ownerObservation.localSeat
    || !isActionableSemanticObservation(ownerObservation)
  ) {
    throw new Error(
      `[campaign-learn-move] owner confirmation was not exclusively actionable: ${JSON.stringify(ownerObservation)}`,
    );
  }
  if (
    watcherObservation?.surfaceId !== "learn-move:summary"
    || (watcherPhase !== "LearnMovePhase" && watcherPhase !== "CoopReplayLearnMovePhase")
    || watcherObservation.ready?.handlerActive !== true
    || watcherObservation.ready?.inputBlocked !== true
    || watcherObservation.localSeat === ownerObservation.localSeat
  ) {
    throw new Error(
      `[campaign-learn-move] partner did not expose the read-only move watcher: ${JSON.stringify(watcherObservation)}`,
    );
  }
  if (
    JSON.stringify(watcherObservation.address) !== JSON.stringify(ownerObservation.address)
    || ownerObservation.stateDigest == null
    || watcherObservation.stateDigest !== ownerObservation.stateDigest
  ) {
    throw new Error(
      `[campaign-learn-move] owner/watcher crossed different authoritative states: ${JSON.stringify({
        ownerObservation,
        watcherObservation,
      })}`,
    );
  }
}

async function checkpointAsymmetricLearnMoveSurface(rig, cursors, owner) {
  const ownerEvent = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(cursors[owner.label] ?? 0, "learn-move:confirm");
      return candidate != null && isActionableSemanticObservation(candidate.observation) ? candidate : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "actionable learn-move confirmation owner" },
  );
  const watcher = Object.values(rig.clients).find(client => client !== owner);
  if (watcher == null) {
    throw new Error("[campaign-learn-move] host-owned prompt has no partner watcher");
  }
  const watcherEvent = await watcher.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(cursors[watcher.label] ?? 0);
      if (candidate == null) {
        return null;
      }
      try {
        assertAsymmetricLearnMoveProjection(ownerEvent.observation, candidate.observation);
        return candidate;
      } catch {
        return null;
      }
    },
    { timeoutMs: rig.config.timeoutMs, description: "same-state read-only learn-move watcher" },
  );
  const proof = {
    surfaceId: "learn-move:confirm",
    watcherSurfaceId: watcherEvent.observation.surfaceId,
    address: ownerEvent.observation.address,
    stateDigest: ownerEvent.observation.stateDigest,
    ownerSeat: owner.publicSeat,
    watcherSeat: watcher.publicSeat,
  };
  for (const client of Object.values(rig.clients)) {
    client.evidence.record("campaign-semantic-convergence", proof);
  }
  return { authority: ownerEvent.observation, ownerEvent, peerEvents: [watcherEvent] };
}

/** Decline a learn cleanly: decline replacement, then confirm that teaching should stop. */
export async function driveLearnMoveDecline(rig, owner, boundary) {
  const firstIdentity = semanticAppearanceIdentity(boundary.ownerEvent);
  const from = boundary.ownerEvent.index + 1;
  await owner.press("Backspace", "campaign-learn-move-decline-replacement");
  const outcome = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(from, "learn-move:confirm");
      if (
        candidate != null
        && semanticAppearanceIdentity(candidate) !== firstIdentity
        && JSON.stringify(candidate.observation.address) === JSON.stringify(boundary.authority.address)
        && isActionableSemanticObservation(candidate.observation)
      ) {
        return { kind: "confirmation", event: candidate };
      }
      // The projected guest picker can treat Backspace on its SUMMARY cancel row as the final decline and
      // relay the immutable result immediately; unlike the host's ordinary LearnMovePhase it then opens no
      // second CONFIRM. A fresh non-learn-move semantic surface at this or a later ordered address proves that
      // this exact picker has closed. Return to the outer successor proof instead of waiting 120 seconds for a
      // UI that cannot exist (rare-evolution run 30775674276).
      const latest = sink.findLastSemanticSurface(from);
      const expectedAddress = boundary.authority.address;
      const observedAddress = latest?.observation.address;
      const sameOrLaterAddress =
        Number.isSafeInteger(expectedAddress?.epoch)
        && observedAddress?.epoch === expectedAddress.epoch
        && Number.isSafeInteger(expectedAddress.wave)
        && Number.isSafeInteger(expectedAddress.turn)
        && Number.isSafeInteger(observedAddress.wave)
        && Number.isSafeInteger(observedAddress.turn)
        && (observedAddress.wave > expectedAddress.wave
          || (observedAddress.wave === expectedAddress.wave && observedAddress.turn >= expectedAddress.turn));
      return latest != null && !latest.observation.surfaceId.startsWith("learn-move:") && sameOrLaterAddress
        ? { kind: "closed", event: latest }
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "learn-move decline confirmation or committed close" },
  );
  if (outcome.kind === "confirmation") {
    await owner.press("Space", `campaign-learn-move-stop:${outcome.event.index}`);
  }
}

/** Classify the exact native prompt chain between accepting a teach and opening its Summary picker. */
export function classifyLearnMovePickerProgress(observation, expectedAddress, localSeat) {
  const sameAddress =
    observation?.address?.epoch === expectedAddress?.epoch
    && observation.address.wave === expectedAddress.wave
    && observation.address.turn === expectedAddress.turn;
  if (!sameAddress) {
    return "wait";
  }
  if (
    observation.surfaceId === "learn-move:confirm"
    && observation.uiMode === "SUMMARY"
    && isActionableSemanticObservation(observation)
  ) {
    return "ready";
  }
  if (
    observation.surfaceId === "battle:message"
    && observation.phase === "LearnMovePhase"
    && observation.uiMode === "MESSAGE"
    && observation.ready?.handlerActive === true
    && observation.ready.awaitingActionInput === true
    && observation.ready.inputBlocked !== true
    && observation.seatsWithInput?.includes(localSeat)
  ) {
    return "advance";
  }
  return "wait";
}

/** Accept a full-moveset teach and replace the currently selected move through the real Summary UI. */
async function driveLearnMoveAccept(rig, owner, boundary, rewardId) {
  let picker = boundary.ownerEvent;
  if (picker.observation.uiMode !== "SUMMARY") {
    const pickerCursor = owner.evidence.cursor();
    await owner.press("Space", "campaign-learn-move-accept-replacement");
    const pickerDeadline = Date.now() + rig.config.timeoutMs;
    const advancedPrompts = new Set();
    for (;;) {
      const candidate = owner.evidence.findLastSemanticSurface(pickerCursor);
      const progress = classifyLearnMovePickerProgress(
        candidate?.observation,
        boundary.authority.address,
        owner.publicSeat,
      );
      if (progress === "ready") {
        picker = candidate;
        break;
      }
      if (progress === "advance") {
        const identity = semanticAppearanceIdentity(candidate);
        if (!advancedPrompts.has(identity)) {
          advancedPrompts.add(identity);
          await owner.press("Space", `campaign-learn-move-open-picker:${candidate.index}`);
          continue;
        }
      }
      if (Date.now() >= pickerDeadline) {
        throw new Error(`${owner.label}: timed out waiting for actionable learn-move forget picker`);
      }
      await delay(100);
    }
  }
  if (picker.observation.uiMode !== "SUMMARY") {
    throw new Error(`[campaign-learn-move] ${owner.label} never opened the full-moveset Summary picker`);
  }
  const replacementMoveId = picker.observation.optionIds?.find(optionId => /^move:\d+:slot:\d+$/u.test(optionId));
  if (replacementMoveId == null) {
    throw new Error(
      `[campaign-learn-move] ${owner.label} exposed no existing move row in the full-moveset Summary picker: `
        + JSON.stringify(picker.observation),
    );
  }
  const replacementSelection = await selectOptionById(owner, {
    surfaceId: "learn-move:confirm",
    targetId: replacementMoveId,
    navKeys: ["ArrowDown", "ArrowUp"],
    submit: false,
    timeoutMs: rig.config.timeoutMs,
    fromCursor: picker.index,
  });
  picker = owner.evidence.events[replacementSelection.surfaceEventIndex];
  if (
    picker?.observation?.uiMode !== "SUMMARY"
    || picker.observation.selectedOptionId !== replacementMoveId
    || picker.observation.selectedOptionId === "learn-move:cancel"
  ) {
    throw new Error(
      `[campaign-learn-move] ${owner.label} did not select an existing move before confirming replacement: `
        + JSON.stringify(picker?.observation ?? null),
    );
  }
  const confirmationCursor = owner.evidence.cursor();
  await owner.press("Space", "campaign-learn-move-forget-selected");
  const replacementResolution = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(confirmationCursor, "learn-move:confirm");
      if (
        candidate != null
        && candidate.observation.uiMode === "CONFIRM"
        && candidate.observation.selectedOptionId === "yes"
        && JSON.stringify(candidate.observation.address) === JSON.stringify(boundary.authority.address)
        && isActionableSemanticObservation(candidate.observation)
      ) {
        return { kind: "confirmation", event: candidate };
      }
      // Ordinary TM variants commit immediately when the player selects the forgotten move; TM Case
      // and mushroom flows may instead open a final Yes/No prompt. Accept the former only after the
      // owner has observably left LearnMovePhase at the same or a later exact authority address. The
      // journey's final party-material oracle still proves that the requested move actually changed.
      const transitioned = sink.findLastSemanticSurface(confirmationCursor);
      const sourceAddress = boundary.authority.address;
      const destinationAddress = transitioned?.observation?.address;
      const orderedTransition =
        transitioned != null
        && transitioned.observation.phase !== "LearnMovePhase"
        && transitioned.observation.surfaceId !== "unclassified"
        && destinationAddress?.epoch === sourceAddress?.epoch
        && (destinationAddress.wave > sourceAddress.wave
          || (destinationAddress.wave === sourceAddress.wave && destinationAddress.turn >= sourceAddress.turn));
      return orderedTransition ? { kind: "immediate", event: transitioned } : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "learn-move replacement confirmation or immediate commit" },
  );
  if (replacementResolution.kind === "confirmation") {
    await owner.press("Space", `campaign-learn-move-confirm-replacement:${replacementResolution.event.index}`);
  }
  owner.evidence.record("campaign-learn-move-accepted", {
    address: boundary.authority.address,
    ownerSeat: owner.publicSeat,
    rewardId,
    selectedOptionId: picker.observation.selectedOptionId,
    navigationSteps: replacementSelection.steps,
    resolution: replacementResolution.kind,
    confirmationEventIndex: replacementResolution.kind === "confirmation" ? replacementResolution.event.index : null,
    transitionEventIndex: replacementResolution.kind === "immediate" ? replacementResolution.event.index : null,
  });
}

/**
 * Validate an Authority V2 ability workflow while its owner and watcher intentionally render
 * different UI modes. The owner alone may act; the watcher must remain on the phase-specific MESSAGE
 * shell, name the same owner, and carry the same immutable battle address/mechanical state.
 */
export function assertAsymmetricAbilityProjection(ownerObservation, watcherObservation) {
  const phase = ownerObservation?.phase;
  const ownerPrefix = typeof phase === "string" ? `ability:${phase}:` : null;
  if (
    ownerPrefix == null
    || !ownerObservation.surfaceId?.startsWith(ownerPrefix)
    || ownerObservation.operationClass !== "ability"
    || ownerObservation.ownerSeat !== ownerObservation.localSeat
    || ownerObservation.seatsWithInput?.length !== 1
    || ownerObservation.seatsWithInput[0] !== ownerObservation.localSeat
    || !isActionableSemanticObservation(ownerObservation)
  ) {
    throw new Error(
      `[campaign-ability] owner surface was not exclusively actionable: ${JSON.stringify(ownerObservation)}`,
    );
  }
  if (
    watcherObservation?.surfaceId !== `${ownerPrefix}message`
    || watcherObservation.operationClass !== "ability"
    || watcherObservation.phase !== phase
    || watcherObservation.ready?.handlerActive !== true
    || watcherObservation.localSeat === ownerObservation.localSeat
    || watcherObservation.ownerSeat !== ownerObservation.ownerSeat
    || watcherObservation.seatsWithInput?.length !== 1
    || watcherObservation.seatsWithInput[0] !== ownerObservation.ownerSeat
    || watcherObservation.seatsWithInput.includes(watcherObservation.localSeat)
  ) {
    throw new Error(
      `[campaign-ability] partner did not expose the input-inert ability watcher: ${JSON.stringify(watcherObservation)}`,
    );
  }
  if (
    JSON.stringify(watcherObservation.address) !== JSON.stringify(ownerObservation.address)
    || ownerObservation.stateDigest == null
    || watcherObservation.stateDigest !== ownerObservation.stateDigest
    || watcherObservation.interactionTargetPartySlot !== ownerObservation.interactionTargetPartySlot
  ) {
    throw new Error(
      `[campaign-ability] owner/watcher crossed different authoritative states: ${JSON.stringify({
        ownerObservation,
        watcherObservation,
      })}`,
    );
  }
  return {
    surfaceId: ownerObservation.surfaceId,
    watcherSurfaceId: watcherObservation.surfaceId,
    phase,
    address: ownerObservation.address,
    stateDigest: ownerObservation.stateDigest,
    ownerSeat: ownerObservation.ownerSeat,
    watcherSeat: watcherObservation.localSeat,
    interactionTargetPartySlot: ownerObservation.interactionTargetPartySlot ?? null,
  };
}

async function checkpointAsymmetricAbilitySurface(rig, driver, cursors, owner) {
  const ownerEvent = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(cursors[owner.label] ?? 0, driver.v2SurfaceId);
      return candidate != null && isActionableSemanticObservation(candidate.observation) ? candidate : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: `actionable ability owner ${driver.v2SurfaceId}` },
  );
  const watcher = Object.values(rig.clients).find(client => client !== owner);
  if (watcher == null) {
    throw new Error(`[campaign-ability] ${driver.abilityPhase} has no watcher browser`);
  }
  const watcherSurfaceId = `ability:${driver.abilityPhase}:message`;
  const watcherEvent = await watcher.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(cursors[watcher.label] ?? 0, watcherSurfaceId);
      if (candidate == null) {
        return null;
      }
      try {
        assertAsymmetricAbilityProjection(ownerEvent.observation, candidate.observation);
        return candidate;
      } catch {
        return null;
      }
    },
    { timeoutMs: rig.config.timeoutMs, description: `input-inert ability watcher ${watcherSurfaceId}` },
  );
  const proof = assertAsymmetricAbilityProjection(ownerEvent.observation, watcherEvent.observation);
  for (const client of Object.values(rig.clients)) {
    client.evidence.record("campaign-semantic-convergence", proof);
  }
  return { authority: ownerEvent.observation, ownerEvent, peerEvents: [watcherEvent] };
}

function assertAsymmetricRegisteredInteraction(ownerObservation, watcherObservation, contract) {
  if (
    !contract.ownerSurfaceIds.includes(ownerObservation?.surfaceId)
    || ownerObservation.operationClass !== contract.operationClass
    || !contract.ownerPhases.includes(ownerObservation.phase)
    || ownerObservation.ownerSeat !== ownerObservation.localSeat
    || ownerObservation.seatsWithInput?.length !== 1
    || ownerObservation.seatsWithInput[0] !== ownerObservation.localSeat
    || !isActionableSemanticObservation(ownerObservation, { requireExplicitUnblocked: true })
  ) {
    throw new Error(
      `[campaign-${contract.label}] owner surface was not exclusively actionable: ${JSON.stringify(ownerObservation)}`,
    );
  }
  if (
    watcherObservation?.surfaceId !== contract.watcherSurfaceId
    || watcherObservation.operationClass !== contract.operationClass
    || !contract.watcherPhases.includes(watcherObservation.phase)
    || watcherObservation.ready?.handlerActive !== true
    || watcherObservation.localSeat === ownerObservation.localSeat
    || watcherObservation.ownerSeat !== ownerObservation.ownerSeat
    || watcherObservation.seatsWithInput?.length !== 1
    || watcherObservation.seatsWithInput[0] !== ownerObservation.ownerSeat
    || watcherObservation.seatsWithInput.includes(watcherObservation.localSeat)
    || isActionableSemanticObservation(watcherObservation, { requireExplicitUnblocked: true })
  ) {
    throw new Error(
      `[campaign-${contract.label}] partner did not expose an input-inert watcher: ${JSON.stringify(watcherObservation)}`,
    );
  }
  if (
    JSON.stringify(watcherObservation.address) !== JSON.stringify(ownerObservation.address)
    || ownerObservation.stateDigest == null
    || watcherObservation.stateDigest !== ownerObservation.stateDigest
  ) {
    throw new Error(
      `[campaign-${contract.label}] owner/watcher crossed different authoritative states: ${JSON.stringify({
        ownerObservation,
        watcherObservation,
      })}`,
    );
  }
  return {
    surfaceId: ownerObservation.surfaceId,
    watcherSurfaceId: watcherObservation.surfaceId,
    address: ownerObservation.address,
    stateDigest: ownerObservation.stateDigest,
    ownerSeat: ownerObservation.ownerSeat,
    watcherSeat: watcherObservation.localSeat,
  };
}

/** Revival Blessing is a symmetric PARTY shell with one stable Pokemon-owner input lease. */
export function assertAsymmetricRevivalProjection(ownerObservation, watcherObservation) {
  return assertAsymmetricRegisteredInteraction(ownerObservation, watcherObservation, {
    label: "revival",
    operationClass: "revival",
    ownerSurfaceIds: ["revival:party"],
    watcherSurfaceId: "revival:party",
    ownerPhases: ["RevivalBlessingPhase", "CoopGuestRevivalPhase"],
    watcherPhases: ["RevivalBlessingPhase", "CoopGuestRevivalPhase"],
  });
}

/** Stormglass is fixed-host input: the guest remains on one passive MESSAGE shell. */
export function assertAsymmetricStormglassProjection(ownerObservation, watcherObservation) {
  return assertAsymmetricRegisteredInteraction(ownerObservation, watcherObservation, {
    label: "stormglass",
    operationClass: "stormglass",
    ownerSurfaceIds: ["stormglass:message", "stormglass:option"],
    watcherSurfaceId: "stormglass:message",
    ownerPhases: ["ErStormglassPickerPhase"],
    watcherPhases: ["ErStormglassPickerPhase"],
  });
}

async function checkpointAsymmetricRegisteredSurface(rig, driver, cursors, owner) {
  const ownerEvent = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(cursors[owner.label] ?? 0, driver.v2SurfaceId);
      return candidate != null
        && isActionableSemanticObservation(candidate.observation, { requireExplicitUnblocked: true })
        ? candidate
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: `actionable ${driver.asymmetricSurface} owner` },
  );
  const watcher = Object.values(rig.clients).find(client => client !== owner);
  if (watcher == null) {
    throw new Error(`[campaign-${driver.asymmetricSurface}] surface has no watcher browser`);
  }
  const assertProjection =
    driver.asymmetricSurface === "revival" ? assertAsymmetricRevivalProjection : assertAsymmetricStormglassProjection;
  const watcherEvent = await watcher.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(cursors[watcher.label] ?? 0, driver.watcherSurfaceId);
      if (candidate == null) {
        return null;
      }
      try {
        assertProjection(ownerEvent.observation, candidate.observation);
        return candidate;
      } catch {
        return null;
      }
    },
    { timeoutMs: rig.config.timeoutMs, description: `input-inert ${driver.asymmetricSurface} watcher` },
  );
  const proof = assertProjection(ownerEvent.observation, watcherEvent.observation);
  for (const client of Object.values(rig.clients)) {
    client.evidence.record("campaign-semantic-convergence", proof);
  }
  return { authority: ownerEvent.observation, ownerEvent, peerEvents: [watcherEvent] };
}

/** Choose the stable party or ability option that advances the current registered ability workflow. */
export function chooseAbilityInteractionOption(observation, excludedOptionIds = new Set()) {
  const options = observation?.optionIds;
  if (!Array.isArray(options) || options.length === 0) {
    return null;
  }
  if (options.every(optionId => /^party-slot:\d+$/u.test(optionId))) {
    return Number.isSafeInteger(observation.interactionTargetPartySlot)
      ? `party-slot:${observation.interactionTargetPartySlot}`
      : null;
  }
  if (observation.phase === "ErDexNavPhase") {
    return options.find(optionId => /^slot:\d+$/u.test(optionId) && !excludedOptionIds.has(optionId)) ?? null;
  }
  if (observation.phase === "ErGreaterAbilityCapsulePhase" && options.includes("slot:1")) {
    // Exercise the run-material branch. The permanent branch intentionally changes only the owner's
    // account unlocks, whereas run-unlock-two must become identical current-party material on both peers.
    return "slot:1";
  }
  const abilitySlots = observation.phase === "ErGreaterAbilityRandomizerPhase" ? [0, 1, 2, 3] : [1, 2, 3, 0];
  const abilitySlot = abilitySlots
    .map(slot => `party-option:ability-slot-${slot}`)
    .find(optionId => options.includes(optionId) && !excludedOptionIds.has(optionId));
  if (abilitySlot != null) {
    return abilitySlot;
  }
  return typeof observation.selectedOptionId === "string" && options.includes(observation.selectedOptionId)
    ? observation.selectedOptionId
    : null;
}

async function driveAbilityInteraction(rig, driver, owner, boundary) {
  const priorChoiceIds = new Set(
    owner.evidence.events
      .filter(event => event.kind === "campaign-ability-choice" && event.phase === driver.abilityPhase)
      .map(event => event.targetId),
  );
  if (driver.abilitySurfaceKind !== "party") {
    const targetId = chooseAbilityInteractionOption(boundary.ownerEvent.observation, priorChoiceIds);
    if (driver.abilitySurfaceKind === "option" || driver.abilitySurfaceKind === "choice") {
      if (targetId == null) {
        throw new Error(
          `[campaign-ability] ${driver.abilityPhase} exposed no stable ${driver.abilitySurfaceKind} choice: `
            + `${JSON.stringify(boundary.ownerEvent.observation)}`,
        );
      }
      await selectOptionById(owner, {
        surfaceId: driver.v2SurfaceId,
        targetId,
        navKeys: ["ArrowDown", "ArrowUp"],
        submitKey: "Space",
        timeoutMs: rig.config.timeoutMs,
        fromCursor: boundary.ownerEvent.index,
      });
      owner.evidence.record("campaign-ability-choice", {
        phase: driver.abilityPhase,
        surfaceId: driver.v2SurfaceId,
        targetId,
        address: boundary.authority.address,
      });
    } else {
      await owner.sequence(driver.keys, `campaign-${driver.name}`);
    }
    return;
  }
  let surface = boundary.ownerEvent;
  let targetId = chooseAbilityInteractionOption(surface.observation, priorChoiceIds);
  if (targetId == null) {
    throw new Error(
      `[campaign-ability] ${driver.abilityPhase} exposed no driveable party choice: `
        + `${JSON.stringify(surface.observation)}`,
    );
  }
  if (targetId.startsWith("party-slot:")) {
    const submenuCursor = owner.evidence.cursor();
    await selectOptionById(owner, {
      surfaceId: driver.v2SurfaceId,
      targetId,
      navKeys: ["ArrowDown", "ArrowUp"],
      submitKey: "Space",
      timeoutMs: rig.config.timeoutMs,
      fromCursor: surface.index,
    });
    surface = await owner.evidence.waitForCondition(
      sink => {
        const candidate = sink.findLastSemanticSurface(submenuCursor, driver.v2SurfaceId);
        return candidate != null
          && candidate.observation.optionIds?.some(optionId => optionId.startsWith("party-option:ability-slot-"))
          && isActionableSemanticObservation(candidate.observation, { requireExplicitUnblocked: true })
          ? candidate
          : null;
      },
      { timeoutMs: rig.config.timeoutMs, description: `${driver.abilityPhase} ability-slot submenu` },
    );
    targetId = chooseAbilityInteractionOption(surface.observation, priorChoiceIds);
    if (targetId == null || !targetId.startsWith("party-option:ability-slot-")) {
      throw new Error(
        `[campaign-ability] ${driver.abilityPhase} opened no stable ability-slot option: `
          + `${JSON.stringify(surface.observation)}`,
      );
    }
  }
  await selectOptionById(owner, {
    surfaceId: driver.v2SurfaceId,
    targetId,
    navKeys: ["ArrowDown", "ArrowUp"],
    submitKey: "Space",
    timeoutMs: rig.config.timeoutMs,
    fromCursor: surface.index,
  });
  owner.evidence.record("campaign-ability-choice", {
    phase: driver.abilityPhase,
    surfaceId: driver.v2SurfaceId,
    targetId,
    address: boundary.authority.address,
  });
}

/** Choose a currently fainted party member from the real Revival Blessing slot list. */
export function chooseRevivalPartySlot(observation) {
  const optionIds = Array.isArray(observation?.optionIds) ? observation.optionIds : [];
  const target = observation?.partySlots?.find(
    slot => slot?.fainted === true && Number.isSafeInteger(slot.slot) && optionIds.includes(`party-slot:${slot.slot}`),
  );
  return target == null ? null : `party-slot:${target.slot}`;
}

async function driveRevivalInteraction(rig, owner, boundary) {
  const targetId = chooseRevivalPartySlot(boundary.authority);
  if (targetId == null) {
    throw new Error(`[campaign-revival] picker exposed no fainted target: ${JSON.stringify(boundary.authority)}`);
  }
  const submenuCursor = owner.evidence.cursor();
  await selectOptionById(owner, {
    surfaceId: "revival:party",
    targetId,
    navKeys: ["ArrowDown", "ArrowUp"],
    submitKey: "Space",
    timeoutMs: rig.config.timeoutMs,
    fromCursor: boundary.ownerEvent.index,
  });
  const submenu = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(submenuCursor, "revival:party");
      const observation = candidate?.observation;
      return candidate != null
        && observation.optionIds?.includes("party-option:revive")
        && JSON.stringify(observation.address) === JSON.stringify(boundary.authority.address)
        && isActionableSemanticObservation(observation, { requireExplicitUnblocked: true })
        ? candidate
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: `Revival Blessing REVIVE submenu for ${targetId}` },
  );
  await selectOptionById(owner, {
    surfaceId: "revival:party",
    targetId: "party-option:revive",
    navKeys: ["ArrowDown", "ArrowUp"],
    submitKey: "Space",
    timeoutMs: rig.config.timeoutMs,
    fromCursor: submenu.index,
  });
  owner.evidence.record("campaign-revival-choice", {
    address: boundary.authority.address,
    ownerSeat: owner.publicSeat,
    targetId,
  });
}

/** Choose one visible Stormglass weather without depending on translated labels. */
export function chooseStormglassOption(observation) {
  return observation?.optionIds?.find(optionId => /^slot:\d+$/u.test(optionId)) ?? null;
}

async function driveStormglassOption(rig, owner, boundary) {
  const targetId = chooseStormglassOption(boundary.authority);
  if (targetId == null) {
    throw new Error(`[campaign-stormglass] picker exposed no weather option: ${JSON.stringify(boundary.authority)}`);
  }
  await selectOptionById(owner, {
    surfaceId: "stormglass:option",
    targetId,
    navKeys: ["ArrowDown", "ArrowUp"],
    submitKey: "Space",
    timeoutMs: rig.config.timeoutMs,
    fromCursor: boundary.ownerEvent.index,
  });
  owner.evidence.record("campaign-stormglass-choice", {
    address: boundary.authority.address,
    ownerSeat: owner.publicSeat,
    targetId,
  });
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
 * The reward cursor is presentation-only, but it still has to project the owner's exact visible
 * selection on every watcher. Address/digest equality prevents a stale card from satisfying this
 * proof, while the ownership checks ensure the watcher stayed input-inert.
 */
export function rewardCursorProjectionMatches(authority, observation) {
  return (
    observation?.surfaceId === "reward-shop"
    && JSON.stringify(observation.address) === JSON.stringify(authority.address)
    && observation.stateDigest === authority.stateDigest
    && observation.ownerSeat === authority.ownerSeat
    && observation.localSeat !== authority.ownerSeat
    && observation.seatsWithInput?.length === 1
    && observation.seatsWithInput[0] === authority.ownerSeat
    && observation.selectedOptionId === authority.selectedOptionId
    && JSON.stringify(observation.optionIds ?? null) === JSON.stringify(authority.optionIds ?? null)
    && observation.ready?.handlerActive === true
  );
}

async function selectRewardOptionWithMirroredCursor(rig, owner, boundary, targetId) {
  const peers = Object.values(rig.clients).filter(client => client !== owner);
  const peerCursors = fromEach(peers, peer => peer.evidence.cursor());
  const navigation = await selectOptionById(owner, {
    surfaceId: "reward-shop",
    targetId,
    navKeys: ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"],
    submit: false,
    timeoutMs: rig.config.timeoutMs,
    fromCursor: boundary.ownerEvent.index,
  });
  const authorityEvent = owner.evidence.events[navigation.surfaceEventIndex];
  const authority = authorityEvent?.observation;
  if (
    authority?.surfaceId !== "reward-shop"
    || authority.selectedOptionId !== targetId
    || JSON.stringify(authority.address) !== JSON.stringify(boundary.authority.address)
  ) {
    throw new Error(
      `[campaign-reward-cursor] owner did not expose ${targetId} at the addressed reward surface: `
        + `${JSON.stringify(authority ?? null)}`,
    );
  }
  const peerEvents = await Promise.all(
    peers.map(peer =>
      peer.evidence.waitForCondition(
        sink => {
          const candidate = sink.findLastSemanticSurface(peerCursors[peer.label], "reward-shop");
          return rewardCursorProjectionMatches(authority, candidate?.observation) ? candidate : null;
        },
        {
          timeoutMs: rig.config.timeoutMs,
          description: `mirrored reward cursor ${targetId} on ${peer.label}`,
        },
      ),
    ),
  );
  const proof = {
    address: authority.address,
    stateDigest: authority.stateDigest,
    ownerSeat: authority.ownerSeat,
    selectedOptionId: targetId,
    navigationSteps: navigation.steps,
    watcherSeats: peerEvents.map(event => event.observation.localSeat),
  };
  for (const client of Object.values(rig.clients)) {
    client.evidence.record("campaign-reward-cursor-mirror", proof);
  }
  return { ...navigation, authorityEvent, peerEvents };
}

/** Exact field proof for a Check Team reorder: party material and the visible battlers agree. */
export function partyReorderPresentationMatches(observation, expectedPartyIds) {
  const partyIds = observation?.partySlots?.map(slot => slot.pokemonId);
  const expectedFieldIds = observation?.presentation?.expectedPlayerFieldIds;
  const readyFieldIds = observation?.presentation?.playerField
    ?.filter(
      pokemon =>
        pokemon.visible === true
        && pokemon.alpha > 0
        && pokemon.spriteVisible === true
        && pokemon.spriteAlpha > 0
        && pokemon.infoVisible === true
        && pokemon.infoAlpha > 0,
    )
    .map(pokemon => pokemon.pokemonId);
  return (
    JSON.stringify(partyIds ?? null) === JSON.stringify(expectedPartyIds)
    && observation?.presentation?.playerFieldReady === true
    && Array.isArray(expectedFieldIds)
    && expectedFieldIds.length > 0
    && JSON.stringify(expectedFieldIds) === JSON.stringify(expectedPartyIds.slice(0, expectedFieldIds.length))
    && JSON.stringify(readyFieldIds ?? null) === JSON.stringify(expectedFieldIds)
  );
}

/**
 * Returning from an owner-only party screen does not change the watcher UI. Keep the owner's fresh
 * return cursor, but let each watcher reuse the exact post-reorder reward projection that already
 * proved the new party digest. Requiring a later watcher emission turns a correct stable renderer
 * into a timeout on slower clients.
 */
export function retainStableWatcherSurfaceCursors(returnCursors, stableCursors, watcherLabels) {
  const cursors = { ...returnCursors };
  for (const label of watcherLabels) {
    const stableCursor = stableCursors[label];
    if (!Number.isSafeInteger(stableCursor) || stableCursor < 0) {
      throw new Error(`[campaign-convergence] ${label} has no stable watcher cursor`);
    }
    cursors[label] = stableCursor;
  }
  return cursors;
}

/** The Check Team return initially restores the action row; require the original reward-card row again. */
export function restoredRewardRowMatches(observation, expectedOptionIds, expectedAddress) {
  return (
    observation?.surfaceId === "reward-shop"
    && JSON.stringify(observation.address) === JSON.stringify(expectedAddress)
    && JSON.stringify(observation.optionIds ?? null) === JSON.stringify(expectedOptionIds ?? null)
    && isActionableSemanticObservation(observation)
  );
}

async function restoreRewardRowAfterCheckTeam(rig, owner, boundary, restored) {
  const expectedOptionIds = boundary.authority.optionIds;
  const expectedAddress = boundary.authority.address;
  if (!Array.isArray(expectedOptionIds) || expectedOptionIds.length === 0) {
    throw new Error("[campaign-check-team] original reward row had no stable option identities");
  }
  let current = restored;
  for (let step = 0; step <= 6; step++) {
    if (restoredRewardRowMatches(current.authority, expectedOptionIds, expectedAddress)) {
      const peerEvents = await Promise.all(
        Object.values(rig.clients)
          .filter(client => client !== owner)
          .map(peer =>
            peer.evidence.waitForCondition(
              sink => {
                const candidate = sink.findLastSemanticSurface(0, "reward-shop");
                return rewardCursorProjectionMatches(current.authority, candidate?.observation) ? candidate : null;
              },
              { timeoutMs: rig.config.timeoutMs, description: `restored reward-card row on ${peer.label}` },
            ),
          ),
      );
      const proof = {
        address: current.authority.address,
        optionIds: current.authority.optionIds,
        selectedOptionId: current.authority.selectedOptionId,
        steps: step,
      };
      for (const client of Object.values(rig.clients)) {
        client.evidence.record("campaign-check-team-reward-row-restored", proof);
      }
      return { ...current, peerEvents };
    }
    const fromCursor = owner.evidence.cursor();
    const priorSelection = current.authority.selectedOptionId;
    const priorOptions = JSON.stringify(current.authority.optionIds ?? null);
    await owner.press("ArrowUp", `campaign-check-team-restore-reward-row-${step + 1}`);
    const ownerEvent = await owner.evidence.waitForCondition(
      sink => {
        const candidate = sink.findLastSemanticSurface(fromCursor, "reward-shop");
        const observation = candidate?.observation;
        return candidate != null
          && JSON.stringify(observation.address) === JSON.stringify(expectedAddress)
          && isActionableSemanticObservation(observation)
          && (observation.selectedOptionId !== priorSelection
            || JSON.stringify(observation.optionIds ?? null) !== priorOptions)
          ? candidate
          : null;
      },
      { timeoutMs: rig.config.timeoutMs, description: "Check Team return navigation toward retained reward cards" },
    );
    current = { authority: ownerEvent.observation, ownerEvent, peerEvents: [] };
  }
  throw new Error(
    `[campaign-check-team] could not restore reward row ${JSON.stringify(expectedOptionIds)} after returning from PARTY`,
  );
}

/**
 * Exercise the player-reported nested reward path exclusively through public keyboard input:
 * reward row -> Check Team -> Move active slot 0 -> swap with reserve slot 2 -> return.
 * The watcher deliberately remains on the reward surface, so this asserts asymmetric UI plus
 * identical party material and atomic visible-field readiness before accepting the return.
 */
async function driveRewardCheckTeamReorder(rig, owner, boundary) {
  const clients = Object.values(rig.clients);
  const peers = clients.filter(client => client !== owner);
  const address = boundary.authority.address;
  const addressJson = JSON.stringify(address);
  const beforePartyIds = boundary.authority.partySlots?.map(slot => slot.pokemonId) ?? [];
  if (beforePartyIds.length < 3) {
    throw new Error(
      `[campaign-check-team] requires an active lead and slot-2 reserve: ${JSON.stringify(boundary.authority.partySlots ?? null)}`,
    );
  }

  // Account-local shopCursorTarget can start on rewards, actions, or a paid shop row. Walk
  // downward by observed semantic state until the stable Check Team action row is visible.
  let actionEvent = boundary.ownerEvent;
  for (let step = 0; step < 6 && !actionEvent.observation.optionIds?.includes("reward-action:check-team"); step++) {
    const beforeIndex = actionEvent.index;
    await owner.press("ArrowDown", `campaign-check-team-action-row-${step}`);
    actionEvent = await owner.evidence.waitForCondition(
      sink => {
        const candidate = sink.findLastSemanticSurface(beforeIndex, "reward-shop");
        return candidate != null
          && JSON.stringify(candidate.observation.address) === addressJson
          && candidate.observation.selectedOptionId !== actionEvent.observation.selectedOptionId
          && isActionableSemanticObservation(candidate.observation)
          ? candidate
          : null;
      },
      { timeoutMs: rig.config.timeoutMs, description: "Check Team reward action row navigation" },
    );
  }
  if (!actionEvent.observation.optionIds?.includes("reward-action:check-team")) {
    throw new Error(
      `[campaign-check-team] reward surface exposed no Check Team action: ${JSON.stringify(actionEvent.observation)}`,
    );
  }

  const peerCursorBeforeAction = fromEach(peers, peer => peer.evidence.cursor());
  const selectedAction = await selectOptionById(owner, {
    surfaceId: "reward-shop",
    targetId: "reward-action:check-team",
    navKeys: ["ArrowRight", "ArrowLeft"],
    submit: false,
    timeoutMs: rig.config.timeoutMs,
    fromCursor: actionEvent.index,
  });
  const ownerActionEvent = owner.evidence.events[selectedAction.surfaceEventIndex];
  const ownerAction = ownerActionEvent?.observation;
  if (ownerAction?.selectedOptionId !== "reward-action:check-team") {
    throw new Error(`[campaign-check-team] owner never selected Check Team: ${JSON.stringify(ownerAction ?? null)}`);
  }
  await Promise.all(
    peers.map(peer =>
      peer.evidence.waitForCondition(
        sink => {
          const candidate = sink.findLastSemanticSurface(peerCursorBeforeAction[peer.label], "reward-shop");
          return rewardCursorProjectionMatches(ownerAction, candidate?.observation) ? candidate : null;
        },
        { timeoutMs: rig.config.timeoutMs, description: `mirrored Check Team cursor on ${peer.label}` },
      ),
    ),
  );

  const partyOpenCursor = owner.evidence.cursor();
  await owner.press("Space", "campaign-check-team-open");
  let partyEvent = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(partyOpenCursor, "party:reward-target");
      return candidate != null
        && JSON.stringify(candidate.observation.address) === addressJson
        && candidate.observation.optionIds?.includes("party-slot:2")
        && isActionableSemanticObservation(candidate.observation, { requireExplicitUnblocked: true })
        ? candidate
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "Check Team party list" },
  );

  const sourceMenuCursor = owner.evidence.cursor();
  await selectOptionById(owner, {
    surfaceId: "party:reward-target",
    targetId: "party-slot:0",
    navKeys: ["ArrowUp", "ArrowDown"],
    submitKey: "Space",
    timeoutMs: rig.config.timeoutMs,
    fromCursor: partyEvent.index,
  });
  let moveEvent = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(sourceMenuCursor, "party:reward-target");
      return candidate?.observation.optionIds?.includes("party-option:move")
        && JSON.stringify(candidate.observation.address) === addressJson
        && isActionableSemanticObservation(candidate.observation, { requireExplicitUnblocked: true })
        ? candidate
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "Check Team source Move action" },
  );
  const targetListCursor = owner.evidence.cursor();
  await selectOptionById(owner, {
    surfaceId: "party:reward-target",
    targetId: "party-option:move",
    navKeys: ["ArrowDown", "ArrowUp"],
    submitKey: "Space",
    timeoutMs: rig.config.timeoutMs,
    fromCursor: moveEvent.index,
  });
  partyEvent = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(targetListCursor, "party:reward-target");
      return candidate?.observation.optionIds?.includes("party-slot:2")
        && JSON.stringify(candidate.observation.address) === addressJson
        && isActionableSemanticObservation(candidate.observation, { requireExplicitUnblocked: true })
        ? candidate
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "Check Team reorder target list" },
  );

  const targetMenuCursor = owner.evidence.cursor();
  await selectOptionById(owner, {
    surfaceId: "party:reward-target",
    targetId: "party-slot:2",
    navKeys: ["ArrowDown", "ArrowUp"],
    submitKey: "Space",
    timeoutMs: rig.config.timeoutMs,
    fromCursor: partyEvent.index,
  });
  moveEvent = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(targetMenuCursor, "party:reward-target");
      return candidate?.observation.optionIds?.includes("party-option:move")
        && JSON.stringify(candidate.observation.address) === addressJson
        && isActionableSemanticObservation(candidate.observation, { requireExplicitUnblocked: true })
        ? candidate
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "Check Team target Move action" },
  );

  const convergenceCursors = fromEach(clients, client => client.evidence.cursor());
  await selectOptionById(owner, {
    surfaceId: "party:reward-target",
    targetId: "party-option:move",
    navKeys: ["ArrowDown", "ArrowUp"],
    submitKey: "Space",
    timeoutMs: rig.config.timeoutMs,
    fromCursor: moveEvent.index,
  });
  const expectedPartyIds = [...beforePartyIds];
  [expectedPartyIds[0], expectedPartyIds[2]] = [expectedPartyIds[2], expectedPartyIds[0]];
  const converged = await Promise.all(
    clients.map(client =>
      client.evidence.waitForCondition(
        sink => {
          const candidate = sink.findLastSemanticSurface(convergenceCursors[client.label]);
          return candidate != null && partyReorderPresentationMatches(candidate.observation, expectedPartyIds)
            ? candidate
            : null;
        },
        {
          timeoutMs: rig.config.timeoutMs,
          description: `Check Team party/visible-field convergence on ${client.label}`,
        },
      ),
    ),
  );
  const proof = {
    address,
    ownerSeat: owner.publicSeat,
    beforePartyIds,
    expectedPartyIds,
    fieldIds: converged.map(event => event.observation.presentation.expectedPlayerFieldIds),
  };
  for (const client of clients) {
    client.evidence.record("campaign-check-team-reorder", proof);
  }

  const returnCursors = fromEach(clients, client => client.evidence.cursor());
  // The watcher never left reward-shop. Its post-reorder surface is already the exact stable projection
  // we need, and it is not required to emit a duplicate merely because the owner closes PARTY.
  const restoredSurfaceCursors = retainStableWatcherSurfaceCursors(
    returnCursors,
    convergenceCursors,
    peers.map(peer => peer.label),
  );
  await owner.press("Backspace", "campaign-check-team-return-to-reward");
  const restored = await checkpointPairedMechanicalSurface(rig, "reward-shop", restoredSurfaceCursors, owner);
  const restoredPeerEvents = await Promise.all(
    peers.map(peer =>
      peer.evidence.waitForCondition(
        sink => {
          const candidate = sink.findLastSemanticSurface(restoredSurfaceCursors[peer.label], "reward-shop");
          return rewardCursorProjectionMatches(restored.authority, candidate?.observation) ? candidate : null;
        },
        { timeoutMs: rig.config.timeoutMs, description: `absolute reward cursor restored on ${peer.label}` },
      ),
    ),
  );
  for (const client of clients) {
    client.evidence.record("campaign-check-team-return", {
      address: restored.authority.address,
      selectedOptionId: restored.authority.selectedOptionId,
      watcherSeats: restoredPeerEvents.map(event => event.observation.localSeat),
    });
  }
  return restoreRewardRowAfterCheckTeam(rig, owner, boundary, restored);
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

/** Ordered public party targets for the visible reward, preferring the acting seat's usable mons. */
export function rewardPartyTargetCandidates(boundary, fallbackSlot = 0) {
  const slots = Array.isArray(boundary?.authority?.partySlots) ? boundary.authority.partySlots : [];
  const localRole = /^(?:host|guest)$/u.test(boundary?.authority?.localRole) ? boundary.authority.localRole : null;
  const orderedSlots =
    localRole == null
      ? slots
      : [
          ...slots.filter(slot => slot?.coopOwner === localRole),
          ...slots.filter(slot => slot?.coopOwner !== localRole),
        ];
  const rewardId =
    boundary?.peerEvents?.map(event => event?.observation).find(observation => observation?.surfaceId === "reward-shop")
      ?.selectedOptionId ?? null;
  const usableSlots = orderedSlots.filter(slot => Number.isSafeInteger(slot?.slot));
  let candidates = [];
  if (typeof rewardId === "string" && /REVIVE/u.test(rewardId)) {
    candidates = usableSlots.filter(slot => slot.fainted === true);
  } else if (typeof rewardId === "string" && /^(?:FULL_HEAL|FULL_RESTORE)$/u.test(rewardId)) {
    // Full Heal is legal on a full-HP status target, while Full Restore is legal for either
    // missing HP or status. Run 30795897194 proved the old generic healing predicate discarded
    // the exact burned reserve, exhausted two healthy active slots, and left an otherwise
    // actionable production PARTY handler parked. Keep legality derived from the public party
    // material so this remains a real UI driver rather than a fixture-specific slot shortcut.
    candidates = usableSlots.filter(
      slot =>
        slot.fainted !== true
        && (slot.statusEffect != null
          || (typeof slot.hp === "number" && typeof slot.maxHp === "number" && slot.hp < slot.maxHp)),
    );
  } else if (
    typeof rewardId === "string"
    && /POTION|RESTORE|HEAL|WATER|SODA|LEMONADE|MOOMOO_MILK|ENERGY_ROOT|BERRY/u.test(rewardId)
  ) {
    candidates = usableSlots.filter(
      slot =>
        slot.fainted !== true && typeof slot.hp === "number" && typeof slot.maxHp === "number" && slot.hp < slot.maxHp,
    );
  } else {
    candidates = usableSlots.filter(slot => slot.fainted !== true && slot.allowedInBattle === true);
  }
  if (candidates.length === 0) {
    candidates = usableSlots.filter(slot => slot.fainted !== true);
  }
  const exactFallback = candidates.find(slot => slot.slot === fallbackSlot);
  if (exactFallback != null && (localRole == null || exactFallback.coopOwner === localRole)) {
    candidates = [exactFallback, ...candidates.filter(slot => slot !== exactFallback)];
  }
  return {
    slots: candidates.map(slot => slot.slot),
    rewardId,
  };
}

/** Pick the first party slot on which the visible reward can operate. */
export function chooseRewardPartyTargetSlot(boundary, fallbackSlot = 0) {
  const candidates = rewardPartyTargetCandidates(boundary, fallbackSlot);
  return {
    slot: candidates.slots[0] ?? fallbackSlot,
    rewardId: candidates.rewardId,
  };
}

/**
 * Choose the public PARTY submenu action that actually applies the selected reward.
 *
 * Most modifiers expose APPLY, but move-targeting rewards (Ether, PP Up, etc.) descend
 * directly into MOVE_1..MOVE_5 and ability modifiers descend into an ability-slot row.
 * Those are complete, player-actionable choices rather than a missing APPLY button.
 * Keep this list closed so Summary/Cancel or a newly introduced menu cannot be pressed
 * through while the journey claims it proved the reward continuation.
 */
export function chooseRewardPartyActionOption(observation) {
  const options = Array.isArray(observation?.optionIds)
    ? observation.optionIds.filter(optionId => typeof optionId === "string")
    : [];
  const apply = options.find(optionId => optionId === "party-option:apply");
  if (apply != null) {
    return apply;
  }
  return (
    options.find(optionId =>
      /^party-option:(?:teach|splice|select|move-[1-5]|move-index:\d+|ability-slot-[0-3])$/u.test(optionId),
    ) ?? null
  );
}

/**
 * Classify only public evidence emitted after applying a party-target reward.
 *
 * A valid application can briefly return to the PARTY slot list before its V2 result advances the
 * phase, so that shell alone is not rejection evidence. A filter rejection instead installs a real
 * Action/Cancel message prompt on the same exact-address PARTY surface. That callback-backed prompt
 * is the human-visible distinction the driver uses; no modifier or engine state is inspected.
 */
export function classifyRewardTargetApplyOutcome(events, from, address) {
  for (const event of events.slice(from)) {
    if (event.kind === "console") {
      const phaseMatch = START_PHASE.exec(event.text ?? "");
      if (phaseMatch != null && phaseMatch[1] !== "SelectModifierPhase") {
        return { status: "accepted", event };
      }
    }
    if (event.kind !== "browser-surface2") {
      continue;
    }
    const surfaceOutcome = classifyRewardTargetSurface(event.observation, address);
    if (surfaceOutcome != null) {
      return { status: surfaceOutcome, event };
    }
  }
  return null;
}

function classifyRewardTargetSurface(observation, address) {
  if (
    JSON.stringify(observation?.address) !== JSON.stringify(address)
    || observation.surfaceId !== "party:reward-target"
  ) {
    return "accepted";
  }
  return /^party-slot:\d+$/u.test(observation.selectedOptionId ?? "") && observation.ready?.awaitingActionInput === true
    ? "rejected"
    : null;
}

function authoritativeAddressKey(address) {
  return JSON.stringify([address?.epoch ?? null, address?.wave ?? null, address?.turn ?? null]);
}

function campaignRewardUtility(optionId) {
  if (/REVIVE|SACRED_ASH/u.test(optionId)) {
    return 600;
  }
  if (/POTION|RESTORE|HEAL|WATER|SODA|LEMONADE|MOOMOO_MILK|ENERGY_ROOT/u.test(optionId)) {
    return 500;
  }
  if (/RARE_CANDY|CANDY_JAR|EXP_(?:CHARM|SHARE|BALANCE)/u.test(optionId)) {
    return 400;
  }
  if (/BERRY/u.test(optionId)) {
    return 300;
  }
  if (/TEMP_STAT_STAGE_BOOSTER|X_(?:ATTACK|DEFENSE|SP_ATK|SP_DEF|SPEED|ACCURACY)/u.test(optionId)) {
    return 200;
  }
  if (/TM|MINT|ABILITY|VITAMIN|PROTEIN|IRON|CALCIUM|ZINC|CARBOS/u.test(optionId)) {
    return 100;
  }
  return 0;
}

function visiblePartyRewardFixtureId(authority, configuredId) {
  const options = Array.isArray(authority?.optionIds) ? authority.optionIds : [];
  return typeof configuredId === "string" && options.includes(configuredId) ? configuredId : null;
}

function partyRewardMutationProjection(slot) {
  return slot == null
    ? null
    : {
        pokemonId: slot.pokemonId,
        speciesId: slot.speciesId,
        formIndex: slot.formIndex,
        fusionSpeciesId: slot.fusionSpeciesId,
        fusionFormIndex: slot.fusionFormIndex,
        hp: slot.hp,
        maxHp: slot.maxHp,
        fainted: slot.fainted,
        level: slot.level,
        exp: slot.exp,
        statusEffect: slot.statusEffect,
        abilityIndex: slot.abilityIndex,
        abilityId: slot.abilityId,
        innateAbilityIds: slot.innateAbilityIds,
        abilitySlotActivity: slot.abilitySlotActivity,
        runUnlockedAbilitySlots: slot.runUnlockedAbilitySlots,
        nature: slot.nature,
        teraType: slot.teraType,
        maxMoveCount: slot.maxMoveCount,
        bonusMoveSlots: slot.bonusMoveSlots,
        modifierStacks: slot.modifierStacks,
        moves: slot.moves,
      };
}

const PARTY_REWARD_PRESENTATION_SURFACES = new Map([
  [
    "EVOLUTION_ITEM",
    { surfaceId: "battle:evolution", phases: new Set(["EvolutionPhase", "CoopWaveProgressionReplayPhase"]) },
  ],
  [
    "RARE_EVOLUTION_ITEM",
    { surfaceId: "battle:evolution", phases: new Set(["EvolutionPhase", "CoopWaveProgressionReplayPhase"]) },
  ],
  [
    "FORM_CHANGE_ITEM",
    { surfaceId: "battle:form-change", phases: new Set(["FormChangePhase", "CoopFormChangeCutsceneReplayPhase"]) },
  ],
  [
    "RARE_FORM_CHANGE_ITEM",
    { surfaceId: "battle:form-change", phases: new Set(["FormChangePhase", "CoopFormChangeCutsceneReplayPhase"]) },
  ],
]);

/**
 * A converged final form/species proves mechanics, but it does not prove the user-visible cutscene.
 * Under the animations-on profile, require both public browsers to expose a fresh, input-ready
 * evolution-scene surface after the exact reward action. This catches the V2 failure mode where the
 * authority plays the ordinary phase while the complete result silently teleports the watcher to the
 * final material without installing its mechanics-free renderer.
 */
export function assertPartyRewardPresentationParity(clients, rewardId, presentationCursors, renderProfile) {
  const contract = PARTY_REWARD_PRESENTATION_SURFACES.get(rewardId);
  if (renderProfile !== "animations-on-surface" || contract == null) {
    return null;
  }
  const proof = clients.map(client => {
    const from = presentationCursors?.[client.label];
    if (!Number.isSafeInteger(from)) {
      throw new Error(`[campaign-party-reward] ${rewardId} omitted the ${client.label} pre-action presentation cursor`);
    }
    const seen = new Map();
    for (const event of client.evidence.events.slice(from)) {
      const observation = event.kind === "browser-surface2" ? event.observation : null;
      if (
        observation?.surfaceId !== contract.surfaceId
        || observation.uiMode !== "EVOLUTION_SCENE"
        || !contract.phases.has(observation.phase)
        || observation.ready?.handlerActive !== true
        || !Number.isSafeInteger(observation.phaseInstance)
      ) {
        continue;
      }
      const identity = JSON.stringify([
        observation.phase,
        observation.phaseInstance,
        observation.surfaceGeneration ?? null,
      ]);
      seen.set(identity, {
        phase: observation.phase,
        phaseInstance: observation.phaseInstance,
        surfaceGeneration: observation.surfaceGeneration ?? null,
        address: observation.address,
      });
    }
    return { client: client.label, observations: [...seen.values()] };
  });
  const missing = proof.filter(entry => entry.observations.length === 0);
  if (missing.length > 0) {
    throw new Error(
      `[campaign-party-reward] ${rewardId} omitted animations-enabled ${contract.surfaceId} presentation: `
        + JSON.stringify(proof),
    );
  }
  for (const client of clients) {
    client.evidence.record("campaign-party-reward-presentation-proof", {
      rewardId,
      surfaceId: contract.surfaceId,
      clients: proof,
    });
  }
  return proof;
}

function assertPartyRewardChangedConfiguredMaterial(rewardId, before, after, abilityChoices) {
  const beforeProjection = partyRewardMutationProjection(before);
  const afterProjection = partyRewardMutationProjection(after);
  if (beforeProjection == null || afterProjection == null) {
    throw new Error(`[campaign-party-reward] ${rewardId} had no before/after target material`);
  }
  const changed = JSON.stringify(beforeProjection) !== JSON.stringify(afterProjection);
  if (!changed) {
    throw new Error(
      `[campaign-party-reward] ${rewardId} crossed into the next wave without changing its target: `
        + JSON.stringify({ before: beforeProjection, after: afterProjection, abilityChoices }),
    );
  }
  if (rewardId === "MOVE_SLOT_EXPANDER" && after.maxMoveCount !== before.maxMoveCount + 1) {
    throw new Error(
      `[campaign-party-reward] Move Slot Expander did not raise the exact target cap: ${JSON.stringify({ before, after })}`,
    );
  }
  if (
    (rewardId === "TM_CASE"
      || rewardId === "ER_LEARNERS_SHROOM"
      || rewardId === "MEMORY_MUSHROOM"
      || rewardId === "TM_COMMON"
      || rewardId === "TM_GREAT"
      || rewardId === "TM_ULTRA")
    && JSON.stringify(before.moves?.map(move => move.moveId)) === JSON.stringify(after.moves?.map(move => move.moveId))
  ) {
    throw new Error(`[campaign-party-reward] ${rewardId} accepted teaching but retained the old move ids`);
  }
  if (/^(?:POTION|SUPER_POTION|HYPER_POTION|MAX_POTION|FULL_RESTORE)$/u.test(rewardId) && after.hp <= before.hp) {
    throw new Error(`[campaign-party-reward] ${rewardId} did not restore HP: ${JSON.stringify({ before, after })}`);
  }
  if (
    /^(?:REVIVE|MAX_REVIVE)$/u.test(rewardId)
    && (before.fainted !== true || after.fainted === true || after.hp <= 0)
  ) {
    throw new Error(
      `[campaign-party-reward] ${rewardId} did not revive the target: ${JSON.stringify({ before, after })}`,
    );
  }
  if (/^(?:FULL_RESTORE|FULL_HEAL)$/u.test(rewardId) && (before.statusEffect == null || after.statusEffect != null)) {
    throw new Error(`[campaign-party-reward] ${rewardId} did not clear status: ${JSON.stringify({ before, after })}`);
  }
  if (rewardId === "RARE_CANDY" && after.level <= before.level) {
    throw new Error(
      `[campaign-party-reward] Rare Candy did not raise the target level: ${JSON.stringify({ before, after })}`,
    );
  }
  if (/^(?:EVOLUTION_ITEM|RARE_EVOLUTION_ITEM)$/u.test(rewardId) && after.speciesId === before.speciesId) {
    throw new Error(
      `[campaign-party-reward] ${rewardId} did not evolve the target: ${JSON.stringify({ before, after })}`,
    );
  }
  if (/^(?:FORM_CHANGE_ITEM|RARE_FORM_CHANGE_ITEM)$/u.test(rewardId) && after.formIndex === before.formIndex) {
    throw new Error(`[campaign-party-reward] ${rewardId} did not change form: ${JSON.stringify({ before, after })}`);
  }
  if (rewardId === "TERA_SHARD" && after.teraType === before.teraType) {
    throw new Error(`[campaign-party-reward] Tera Shard retained the old type: ${JSON.stringify({ before, after })}`);
  }
  if (/^(?:PP_UP|PP_MAX)$/u.test(rewardId)) {
    const beforePp = before.moves?.map(move => move.ppUp) ?? [];
    const afterPp = after.moves?.map(move => move.ppUp) ?? [];
    if (!afterPp.some((value, index) => value > (beforePp[index] ?? value))) {
      throw new Error(
        `[campaign-party-reward] ${rewardId} did not raise move PP: ${JSON.stringify({ before, after })}`,
      );
    }
  }
  if (/^(?:ETHER|MAX_ETHER|ELIXIR|MAX_ELIXIR)$/u.test(rewardId)) {
    const beforeUsed = before.moves?.reduce((sum, move) => sum + (move.ppUsed ?? 0), 0) ?? 0;
    const afterUsed = after.moves?.reduce((sum, move) => sum + (move.ppUsed ?? 0), 0) ?? 0;
    if (afterUsed >= beforeUsed) {
      throw new Error(`[campaign-party-reward] ${rewardId} did not restore PP: ${JSON.stringify({ before, after })}`);
    }
  }
  if (rewardId === "DNA_SPLICERS" && after.fusionSpeciesId == null) {
    throw new Error(`[campaign-party-reward] DNA Splicers did not install a fusion species: ${JSON.stringify(after)}`);
  }
}

/**
 * Pick the highest-utility still-untried visible reward after a learn-move decline returns to the
 * same shop. The observer exposes only the option ids a player can currently see; selection still
 * happens exclusively through public arrow/action keys. Sustain outranks collection/map items so
 * the depth campaign behaves like a player trying to survive, while stable visible order breaks
 * ties and makes the run reproducible.
 *
 * Selecting the same TM again is not useful depth coverage: a real player who deliberately declines
 * that teaching flow moves to another option. Returning null is a loud exhaustion signal; it never
 * silently loops on an already-rejected choice. Production independently gives each reopened reward
 * presentation a fresh operation identity, so this policy is representative behavior rather than an
 * idempotency workaround.
 */
export function chooseUntriedRewardOption(authority, rejectedRewardIds) {
  const options = Array.isArray(authority?.optionIds)
    ? authority.optionIds.filter(optionId => typeof optionId === "string")
    : [];
  const rejected = rejectedRewardIds instanceof Set ? rejectedRewardIds : new Set(rejectedRewardIds ?? []);
  return (
    options
      .map((optionId, index) => ({ optionId, index, utility: campaignRewardUtility(optionId) }))
      .filter(option => !rejected.has(option.optionId))
      .sort((left, right) => right.utility - left.utility || left.index - right.index)[0]?.optionId ?? null
  );
}

/**
 * The production modifier handler deliberately renders an actionable Continue row when a reward
 * pool is empty. This is distinct from a missing observer projection (`optionIds: null`) and from
 * exhausting a non-empty list after declining nested learn-move prompts. A human simply presses
 * ACTION on that row; the campaign must do the same instead of misclassifying a healthy exact-
 * address surface as a reward-policy failure.
 */
export function isExplicitEmptyRewardShop(authority) {
  return Array.isArray(authority?.optionIds) && authority.optionIds.length === 0 && authority.optionCount === 0;
}

/**
 * Release only the two semantic appearances that participate in an exhausted party-reward retry.
 *
 * The reward shop can reopen PARTY for a different item without changing the Authority V2 address,
 * SelectModifierPhase instance, or PARTY surface generation. Keeping the first picker's handled
 * identity therefore makes the driver ignore the second picker's real actionable UI forever. A
 * human has explicitly returned to the reward row at this point, so both the row and its nested
 * picker are new work; unrelated between-wave surfaces must remain suppressed.
 */
export function resetRewardRetrySurfaceLedger(handledIndex, clients) {
  for (const client of clients) {
    handledIndex.delete(`reward:${client.label}`);
    handledIndex.delete(`reward-target:${client.label}`);
  }
}

async function moveRewardPartyCursor(rig, owner, event, targetSlot) {
  const match = /^party-slot:(\d+)$/u.exec(event.observation.selectedOptionId ?? "");
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
  return event;
}

async function openRewardPartyApply(rig, owner, boundary, targetSlot) {
  const optionCursor = owner.evidence.cursor();
  await owner.press("Space", "campaign-reward-target-open-action");
  return owner.evidence.waitForCondition(
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
}

async function dismissRewardTargetRejection(rig, owner, boundary, targetSlot) {
  const dismissCursor = owner.evidence.cursor();
  await owner.press("Space", `campaign-reward-target-dismiss-rejection-${targetSlot}`);
  return owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(dismissCursor, "party:reward-target");
      return candidate != null
        && JSON.stringify(candidate.observation.address) === JSON.stringify(boundary.authority.address)
        && /^party-slot:\d+$/u.test(candidate.observation.selectedOptionId ?? "")
        && candidate.observation.ready?.awaitingActionInput !== true
        ? candidate
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: `dismissed reward rejection for party slot ${targetSlot}` },
  );
}

/**
 * Exercise the exact nested path reported by players: open Summary from the reward-owned PARTY
 * submenu, return to the unchanged addressed selector, and reopen the same mon's action menu.
 * Gameplay is driven only through public keys; the CI observer is read-only evidence.
 */
async function inspectRewardPartySummary(rig, owner, boundary, targetSlot, optionEvent) {
  const summaryCursor = owner.evidence.cursor();
  await selectOptionById(owner, {
    surfaceId: "party:reward-target",
    targetId: "party-option:summary",
    navKeys: ["ArrowDown", "ArrowUp"],
    submitKey: "Space",
    timeoutMs: rig.config.timeoutMs,
    fromCursor: optionEvent.index,
  });
  const summary = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(summaryCursor, "summary");
      const observation = candidate?.observation;
      return candidate != null
        && observation?.phase === "SelectModifierPhase"
        && observation.uiMode === "SUMMARY"
        && observation.ownerModel === "local"
        && observation.ready?.handlerActive === true
        && observation.ready?.inputBlocked !== true
        ? candidate
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "reward target nested Summary became actionable" },
  );
  await owner.checkpoint("reward-target-summary-open");

  const restoreCursor = owner.evidence.cursor();
  await owner.press("Backspace", "campaign-reward-target-summary-back");
  const restored = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(restoreCursor, "party:reward-target");
      const observation = candidate?.observation;
      return candidate != null
        && JSON.stringify(observation?.address) === JSON.stringify(boundary.authority.address)
        && observation.selectedOptionId === `party-slot:${targetSlot}`
        && observation.ready?.handlerActive === true
        && observation.ready?.inputBlocked !== true
        && observation.ready?.awaitingActionInput !== true
        ? candidate
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "exact reward PARTY selector restored after Summary" },
  );
  owner.evidence.record("campaign-reward-summary-inspection", {
    address: boundary.authority.address,
    ownerSeat: owner.publicSeat,
    partySlot: targetSlot,
    summaryEventIndex: summary.index,
    restoredEventIndex: restored.index,
  });
  return openRewardPartyApply(rig, owner, boundary, targetSlot);
}

async function finishRewardFusion(rig, owner, boundary, primarySlot, fromCursor) {
  const primary = boundary.authority.partySlots?.find(slot => slot.slot === primarySlot) ?? null;
  const secondarySlot = boundary.authority.partySlots?.find(
    slot =>
      slot.slot !== primarySlot
      && slot.coopOwner === primary?.coopOwner
      && slot.fainted !== true
      && slot.allowedInBattle === true,
  )?.slot;
  if (!Number.isSafeInteger(secondarySlot)) {
    throw new Error(
      `[campaign-reward-fusion] no same-owner secondary target for slot ${primarySlot}: `
        + JSON.stringify(boundary.authority.partySlots ?? null),
    );
  }
  let slotEvent = await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(fromCursor, "party:reward-target");
      const observation = candidate?.observation;
      return candidate != null
        && JSON.stringify(observation?.address) === JSON.stringify(boundary.authority.address)
        && /^party-slot:\d+$/u.test(observation.selectedOptionId ?? "")
        && isActionableSemanticObservation(observation)
        ? candidate
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "DNA Splicers secondary party selector" },
  );
  slotEvent = await moveRewardPartyCursor(rig, owner, slotEvent, secondarySlot);
  const secondaryCursor = owner.evidence.cursor();
  await owner.press("Space", "campaign-reward-fusion-select-secondary");
  const secondaryResolution = await owner.evidence.waitForCondition(
    sink => {
      const optionEvent = sink.findLastSemanticSurface(secondaryCursor, "party:reward-target");
      if (
        optionEvent != null
        && JSON.stringify(optionEvent.observation.address) === JSON.stringify(boundary.authority.address)
        && optionEvent.observation.optionIds?.includes("party-option:splice")
        && isActionableSemanticObservation(optionEvent.observation)
      ) {
        return { kind: "splice-action", event: optionEvent };
      }
      const outcome = classifyRewardTargetApplyOutcome(sink.events, secondaryCursor, boundary.authority.address);
      return outcome?.status === "accepted" ? { kind: "immediate", outcome } : null;
    },
    {
      timeoutMs: rig.config.timeoutMs,
      description: "DNA Splicers secondary target action or immediate fusion commit",
    },
  );
  if (secondaryResolution.kind === "immediate") {
    owner.evidence.record("campaign-reward-fusion-secondary", {
      address: boundary.authority.address,
      ownerSeat: owner.publicSeat,
      primarySlot,
      secondarySlot,
      resolution: "immediate",
    });
    return secondaryResolution.outcome;
  }
  const optionEvent = secondaryResolution.event;
  if (!optionEvent.observation.optionIds?.includes("party-option:splice")) {
    throw new Error(
      `[campaign-reward-fusion] slot ${secondarySlot} exposed no splice action: `
        + JSON.stringify(optionEvent.observation.optionIds ?? null),
    );
  }
  owner.evidence.record("campaign-reward-fusion-secondary", {
    address: boundary.authority.address,
    ownerSeat: owner.publicSeat,
    primarySlot,
    secondarySlot,
    resolution: "splice-action",
  });
  const spliceCursor = owner.evidence.cursor();
  await selectOptionById(owner, {
    surfaceId: "party:reward-target",
    targetId: "party-option:splice",
    navKeys: ["ArrowDown", "ArrowUp"],
    submitKey: "Space",
    timeoutMs: rig.config.timeoutMs,
    fromCursor: optionEvent.index,
  });
  return owner.evidence.waitForCondition(
    sink => classifyRewardTargetApplyOutcome(sink.events, spliceCursor, boundary.authority.address),
    { timeoutMs: rig.config.timeoutMs, description: "DNA Splicers accepted or visibly rejected" },
  );
}

async function driveRewardPartyTarget(rig, driver, owner, boundary) {
  const target = rewardPartyTargetCandidates(boundary, driver.partySlot ?? 0);
  const forcedSlot = driver.partySlot ?? 0;
  const candidateSlots =
    driver.forcePartySlot === true && target.slots.includes(forcedSlot)
      ? [forcedSlot, ...target.slots.filter(slot => slot !== forcedSlot)]
      : target.slots;
  let event = boundary.ownerEvent;
  for (const targetSlot of candidateSlots) {
    event = await moveRewardPartyCursor(rig, owner, event, targetSlot);
    let optionEvent = await openRewardPartyApply(rig, owner, boundary, targetSlot);
    if (
      driver.inspectSummary === true
      && !owner.evidence.events.some(event => event.kind === "campaign-reward-summary-inspection")
    ) {
      optionEvent = await inspectRewardPartySummary(rig, owner, boundary, targetSlot, optionEvent);
    }
    owner.evidence.record("campaign-reward-target-action", {
      address: boundary.authority.address,
      ownerSeat: owner.publicSeat,
      partySlot: targetSlot,
      rewardId: target.rewardId,
      presentationCursors: Object.fromEntries(
        Object.values(rig.clients).map(client => [client.label, client.evidence.cursor()]),
      ),
      beforePartySlot: boundary.authority.partySlots?.find(slot => slot.slot === targetSlot) ?? null,
      selectedOptionId: optionEvent.observation.selectedOptionId,
      optionIds: optionEvent.observation.optionIds,
    });
    const actionOptionId = chooseRewardPartyActionOption(optionEvent.observation);
    if (actionOptionId == null) {
      throw new Error(
        `[campaign-reward-target] no supported reward action after selecting slot ${targetSlot}: `
          + `${JSON.stringify(optionEvent.observation.optionIds)}`,
      );
    }
    const applyCursor = owner.evidence.cursor();
    await selectOptionById(owner, {
      surfaceId: "party:reward-target",
      targetId: actionOptionId,
      navKeys: ["ArrowDown", "ArrowUp"],
      submitKey: "Space",
      timeoutMs: rig.config.timeoutMs,
      fromCursor: optionEvent.index,
    });
    const outcome =
      target.rewardId === "DNA_SPLICERS" && actionOptionId === "party-option:apply"
        ? await finishRewardFusion(rig, owner, boundary, targetSlot, applyCursor)
        : await owner.evidence.waitForCondition(
            sink => classifyRewardTargetApplyOutcome(sink.events, applyCursor, boundary.authority.address),
            {
              timeoutMs: rig.config.timeoutMs,
              description: `reward target ${targetSlot} accepted or visibly rejected`,
            },
          );
    if (outcome.status === "accepted") {
      return {
        addressKey: authoritativeAddressKey(boundary.authority.address),
        address: boundary.authority.address,
        rewardId: target.rewardId,
        exhausted: false,
      };
    }

    owner.evidence.record("campaign-reward-target-rejected", {
      address: boundary.authority.address,
      ownerSeat: owner.publicSeat,
      partySlot: targetSlot,
      rewardId: target.rewardId,
    });
    event = await dismissRewardTargetRejection(rig, owner, boundary, targetSlot);
  }

  const cancelCursor = owner.evidence.cursor();
  await owner.press("Backspace", "campaign-reward-target-exhausted-cancel");
  await owner.evidence.waitForCondition(
    sink => {
      const candidate = sink.findLastSemanticSurface(cancelCursor, "reward-shop");
      return candidate != null
        && JSON.stringify(candidate.observation.address) === JSON.stringify(boundary.authority.address)
        && candidate.observation.ownerSeat === owner.publicSeat
        && isActionableSemanticObservation(candidate.observation)
        ? candidate
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "reward shop restored after all party targets rejected" },
  );
  return {
    addressKey: authoritativeAddressKey(boundary.authority.address),
    address: boundary.authority.address,
    rewardId: target.rewardId,
    exhausted: true,
  };
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
 * Choose the first option the production Mystery handler reports as selectable.
 *
 * Run 29676344808 opened Hot Spring with option zero visibly disabled because the fresh party had
 * no berries. A blind Space was swallowed while both browsers correctly waited for the guest owner.
 * The observer exposes only ordinal option identity plus the handler's computed availability; every
 * state change here is still a real, verified keyboard action against the public UI.
 */
export function chooseMysteryEncounterOption(observation, preferLastEnabledOption = false) {
  const enabled = observation?.optionIds?.filter(id => /^mystery-option:\d+:enabled$/u.test(id)) ?? [];
  return preferLastEnabledOption ? (enabled.at(-1) ?? null) : (enabled[0] ?? null);
}

export async function driveMysteryEncounterChoice(rig, owner, cursors, preferLastEnabledOption = false) {
  const fromCursor = cursors[owner.label] ?? 0;
  const choice = await owner.evidence.waitForCondition(
    sink => {
      const event = sink.findLastSemanticSurface(fromCursor, "mystery-encounter");
      const observation = event?.observation;
      const targetId = chooseMysteryEncounterOption(observation, preferLastEnabledOption);
      return event != null
        && targetId != null
        && observation.ownerSeat === owner.publicSeat
        && observation.localSeat === owner.publicSeat
        && observation.seatsWithInput?.includes(owner.publicSeat)
        && isActionableSemanticObservation(observation, { requireExplicitUnblocked: true })
        ? { event, targetId }
        : null;
    },
    {
      timeoutMs: rig.config.timeoutMs,
      description: `${owner.label} actionable enabled Mystery option`,
    },
  );
  await selectOptionById(owner, {
    surfaceId: "mystery-encounter",
    targetId: choice.targetId,
    navKeys: ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"],
    fromCursor,
    timeoutMs: rig.config.timeoutMs,
  });
  owner.evidence.record("campaign-mystery-option-proof", {
    targetId: choice.targetId,
    surfaceEventIndex: choice.event.index,
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
async function driveOnePendingSurface(
  rig,
  dispatch,
  cursors,
  handledIndex,
  stats,
  strict,
  rewardRetryState,
  policy,
  navigationCoverage = null,
) {
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
    let drivenName = driver.name;
    if (driver.localPerClientSurface) {
      // No paired mechanical checkpoint: this is a presentation-only prompt local to this browser.
    } else if (driver.mysteryParty) {
      // The ME PARTY sub-prompt is OWNER-ONLY: only the owning browser opens the party UI
      // (`selectPokemonForOption`); the watcher never renders it, so the paired-mystery checkpoint
      // (which awaits the surface on BOTH clients) would hang. Its owner-only convergence + drive
      // live in driveMysteryPartyPicker below.
    } else if (mysteryStage === "bargain") {
      await checkpointAsymmetricBargainSurface(rig, cursors, stats, client);
    } else if (driver.name === "mystery-subprompt") {
      await checkpointAsymmetricMysteryPromptSurface(rig, cursors, stats, client);
    } else if (mysteryStage != null && driver.v2SurfaceId) {
      const mysteryCheckpoint = await checkpointPairedMysterySurface(
        rig,
        driver.v2SurfaceId,
        cursors,
        stats,
        mysteryStage,
      );
      if (mysteryCheckpoint.targetReached) {
        return "target-reached";
      }
      mechanicalBoundary = mysteryCheckpoint.boundary;
    } else if (driver.name === "reward-target") {
      mechanicalBoundary = await checkpointRewardPartyTarget(rig, cursors, client);
    } else if (driver.name === "learn-move-confirm") {
      mechanicalBoundary = await checkpointAsymmetricLearnMoveSurface(rig, cursors, client);
    } else if (driver.abilitySurface) {
      mechanicalBoundary = await checkpointAsymmetricAbilitySurface(rig, driver, cursors, client);
    } else if (driver.asymmetricSurface) {
      mechanicalBoundary = await checkpointAsymmetricRegisteredSurface(rig, driver, cursors, client);
    } else if (driver.name === "biome-shop") {
      // The owner exposes an actionable semantic grid; the watcher intentionally stays on MESSAGE
      // and exposes its read-only browser-market apply ledger. Both leave and purchase drivers below
      // use that asymmetric paired projection, so the generic two-semantic-surface checkpoint would
      // wait forever on the correct watcher UI.
    } else if (driver.v2SurfaceId) {
      mechanicalBoundary = await checkpointPairedMechanicalSurface(rig, driver.v2SurfaceId, cursors, client);
    }
    await client.checkpoint(`wave-${stats.wave}-${driver.name}-owner`);
    if (driver.localPerClientSurface) {
      await selectOptionById(client, {
        surfaceId: driver.v2SurfaceId,
        targetId: "no",
        navKeys: ["ArrowDown", "ArrowUp"],
        submitKey: "Space",
        timeoutMs: rig.config.timeoutMs,
        fromCursor: cursors[client.label] ?? 0,
      });
      client.evidence.record("campaign-local-presentation", {
        surface: driver.name,
        localSeat: client.publicSeat,
        targetId: "no",
      });
    } else if (driver.name === "biome-shop") {
      stats.market =
        driver.market?.mode === "target-held"
          ? await driveTargetedMarket(rig, cursors, driver.market)
          : await driveMarketLeave(rig, cursors);
    } else if (driver.name === "reward" && mechanicalBoundary != null && driver.confirmSurfaceId == null) {
      if (
        policy.partyMutatingReward.checkTeamReorder
        && mechanicalBoundary.authority.optionIds?.includes(policy.partyMutatingReward.rewardId)
        && !Object.values(rig.clients).some(client =>
          client.evidence.events.some(event => event.kind === "campaign-check-team-reorder"),
        )
      ) {
        mechanicalBoundary = await driveRewardCheckTeamReorder(rig, client, mechanicalBoundary);
      }
      const addressKey = authoritativeAddressKey(mechanicalBoundary.authority.address);
      const rejected = rewardRetryState.rejectedByAddress.get(addressKey) ?? new Set();
      const capsuleTarget =
        mechanicalBoundary.authority.optionIds?.includes("ER_ABILITY_CAPSULE") && policy.abilityCapsule.required
          ? "ER_ABILITY_CAPSULE"
          : null;
      const partyRewardTarget = policy.partyMutatingReward.required
        ? visiblePartyRewardFixtureId(mechanicalBoundary.authority, policy.partyMutatingReward.rewardId)
        : null;
      if (policy.partyMutatingReward.required && partyRewardTarget == null) {
        throw new Error(
          `[campaign-party-reward] fixture reward ${policy.partyMutatingReward.rewardId} was not visible: `
            + JSON.stringify(mechanicalBoundary.authority.optionIds ?? null),
        );
      }
      const targetId =
        capsuleTarget ?? partyRewardTarget ?? chooseUntriedRewardOption(mechanicalBoundary.authority, rejected);
      if (policy.partyMutatingReward.direct && targetId === policy.partyMutatingReward.rewardId) {
        client.evidence.record("campaign-direct-party-reward-action", {
          address: mechanicalBoundary.authority.address,
          ownerSeat: client.publicSeat,
          rewardId: targetId,
          beforePartySlots: mechanicalBoundary.authority.partySlots,
        });
      }
      if (targetId == null) {
        if (isExplicitEmptyRewardShop(mechanicalBoundary.authority)) {
          client.evidence.record("campaign-empty-reward-continue", {
            address: mechanicalBoundary.authority.address,
            selectedOptionId: mechanicalBoundary.authority.selectedOptionId,
            optionCount: mechanicalBoundary.authority.optionCount,
          });
          await client.sequence(driver.keys, `campaign-${driver.name}-empty-continue`);
        } else {
          throw new Error(
            `[campaign-reward-policy] every visible reward at ${addressKey} was already declined: `
              + `${JSON.stringify(mechanicalBoundary.authority.optionIds ?? null)}`,
          );
        }
      } else if (
        targetId === mechanicalBoundary.authority.selectedOptionId
        && !(policy.abilityCapsule.required && targetId === "ER_ABILITY_CAPSULE")
      ) {
        await client.sequence(driver.keys, `campaign-${driver.name}`);
      } else {
        if (targetId === mechanicalBoundary.authority.selectedOptionId) {
          const alternateId = mechanicalBoundary.authority.optionIds?.find(optionId => optionId !== targetId) ?? null;
          if (alternateId == null) {
            throw new Error("[campaign-reward-cursor] Ability Capsule fixture exposed no alternate reward card");
          }
          await selectRewardOptionWithMirroredCursor(rig, client, mechanicalBoundary, alternateId);
        }
        const mirroredCursor = await selectRewardOptionWithMirroredCursor(rig, client, mechanicalBoundary, targetId);
        await client.press("Space", `campaign-${driver.name}-submit-mirrored-cursor`);
        client.evidence.record("campaign-reward-retry-alternative", {
          address: mechanicalBoundary.authority.address,
          rejectedRewardIds: [...rejected],
          targetId,
          navigationSteps: mirroredCursor.steps,
        });
      }
    } else if (driver.name === "reward-target" && mechanicalBoundary != null) {
      const result = await driveRewardPartyTarget(rig, driver, client, mechanicalBoundary);
      if (result.exhausted) {
        const rejected = rewardRetryState.rejectedByAddress.get(result.addressKey) ?? new Set();
        if (result.rewardId != null) {
          rejected.add(result.rewardId);
        }
        rewardRetryState.rejectedByAddress.set(result.addressKey, rejected);
        rewardRetryState.pendingTarget = null;
        resetRewardRetrySurfaceLedger(handledIndex, Object.values(rig.clients));
        client.evidence.record("campaign-reward-target-exhausted", {
          address: result.address,
          rewardId: result.rewardId,
          rejectedRewardIds: [...rejected],
        });
        drivenName = "reward-target-retry";
      } else {
        rewardRetryState.pendingTarget = result;
      }
    } else if (driver.name === "mystery-encounter") {
      await driveMysteryEncounterChoice(rig, client, cursors, driver.preferLastEnabledOption === true);
    } else if (driver.name === "learn-move-confirm" && mechanicalBoundary != null) {
      if (policy.partyMutatingReward.acceptLearnMove) {
        await driveLearnMoveAccept(rig, client, mechanicalBoundary, policy.partyMutatingReward.rewardId);
        rewardRetryState.pendingTarget = null;
      } else {
        await driveLearnMoveDecline(rig, client, mechanicalBoundary);
      }
      const pending = rewardRetryState.pendingTarget;
      const addressKey = authoritativeAddressKey(mechanicalBoundary.authority.address);
      if (
        !policy.partyMutatingReward.acceptLearnMove
        && pending?.rewardId != null
        && pending.addressKey === addressKey
      ) {
        const rejected = rewardRetryState.rejectedByAddress.get(addressKey) ?? new Set();
        rejected.add(pending.rewardId);
        rewardRetryState.rejectedByAddress.set(addressKey, rejected);
        client.evidence.record("campaign-reward-declined", {
          address: pending.address,
          rewardId: pending.rewardId,
          rejectedRewardIds: [...rejected],
        });
      }
      rewardRetryState.pendingTarget = null;
    } else if (driver.mysteryParty) {
      await driveMysteryPartyPicker(rig, client, cursors, stats);
    } else if (driver.abilitySurface && mechanicalBoundary != null) {
      await driveAbilityInteraction(rig, driver, client, mechanicalBoundary);
    } else if (driver.asymmetricSurface === "revival" && mechanicalBoundary != null) {
      await driveRevivalInteraction(rig, client, mechanicalBoundary);
    } else if (driver.stormglassSurfaceKind === "option" && mechanicalBoundary != null) {
      await driveStormglassOption(rig, client, mechanicalBoundary);
    } else if (driver.name === "crossroads" && mechanicalBoundary != null && navigationCoverage != null) {
      const routeIndex = navigationCoverage.crossroads.length;
      const targetId = navigationCoverage.route[routeIndex % navigationCoverage.route.length];
      await selectOptionById(client, {
        surfaceId: "crossroads",
        targetId,
        navKeys: ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"],
        submitKey: "Space",
        timeoutMs: rig.config.timeoutMs,
        fromCursor: mechanicalBoundary.ownerEvent.index,
      });
      const proof = {
        wave: stats.wave,
        address: mechanicalBoundary.authority.address,
        ownerSeat: mechanicalBoundary.authority.ownerSeat,
        ownerLabel: client.label,
        targetId,
        routeIndex,
      };
      navigationCoverage.crossroads.push(proof);
      client.evidence.record("campaign-navigation-crossroads", proof);
    } else if (driver.name === "biome-pick" && mechanicalBoundary != null && navigationCoverage != null) {
      const targetId =
        mechanicalBoundary.authority.selectedOptionId ?? mechanicalBoundary.authority.optionIds?.[0] ?? null;
      if (targetId == null) {
        await client.sequence(driver.keys, `campaign-${driver.name}`);
      } else {
        await selectOptionById(client, {
          surfaceId: "world-map",
          targetId,
          navKeys: ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"],
          submitKey: "Space",
          timeoutMs: rig.config.timeoutMs,
          fromCursor: mechanicalBoundary.ownerEvent.index,
        });
      }
      const proof = {
        wave: stats.wave,
        address: mechanicalBoundary.authority.address,
        ownerSeat: mechanicalBoundary.authority.ownerSeat,
        ownerLabel: client.label,
        targetId,
      };
      navigationCoverage.worldMaps.push(proof);
      client.evidence.record("campaign-navigation-world-map", proof);
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
    const suppressionClients = driver.localPerClientSurface ? [client] : Object.values(rig.clients);
    for (const c of suppressionClients) {
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
    return drivenName;
  }
  return null;
}

/**
 * Drive registered interaction controls that can open after command submission but before the
 * next command/reward frontier. Keep a per-turn appearance ledger so a still-rendered PARTY shell
 * can never receive the same public action twice.
 */
function createBattleRegisteredInteractionDriver(rig, policy, cursors, stats) {
  const revivalDriver = buildDispatchTable(policy).find(driver => driver.name === "revival");
  if (revivalDriver == null) {
    throw new Error("[campaign-revival] registered battle driver is missing from the dispatch table");
  }
  const handledIndex = new Map();
  const rewardRetryState = { rejectedByAddress: new Map(), pendingTarget: null };
  return async () =>
    (await driveOnePendingSurface(
      rig,
      [revivalDriver],
      cursors,
      handledIndex,
      stats,
      policy.mode !== "shakedown",
      rewardRetryState,
      policy,
    )) === "revival";
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

/**
 * An embedded Mystery battle can park the replay browser on its addressed command watcher while the
 * authoritative browser finishes its summon or replacement presentation. On a ~3fps hosted runner this
 * took 56s in campaign 30209490237, so the 20s actionable-frontier confirmation window is not its clock.
 * The watcher has no public input handler and remains known passive progress only while it is the CURRENT
 * semantic surface. A newer surface supersedes it immediately; a genuinely orphaned watcher still fails at
 * the immutable between-wave deadline with exact diagnostics.
 */
export function hasProvisionalCommandWatcherSurface(clients, cursors) {
  return clients.some(client => {
    const cursor = cursors[client.label] ?? 0;
    const event = client.evidence.findLastSemanticSurface(cursor, "command:watcher");
    const latest = client.evidence.findLastSemanticSurface(cursor);
    const observation = event?.observation;
    const replayWait =
      observation?.phase === "CoopReplayTurnPhase"
      && observation.ready?.handlerActive === false
      && observation.ready?.awaitingActionInput === false
      && observation.ready?.inputBlocked === true;
    const partnerCommandWait =
      observation?.phase === "CommandPhase"
      && observation.uiMode === "MESSAGE"
      && observation.seatsWithInput?.length === 1
      && !observation.seatsWithInput.includes(client.publicSeat)
      && observation.ready?.handlerActive === true
      && observation.ready?.inputBlocked !== true;
    return event?.index === latest?.index && (replayWait || partnerCommandWait);
  });
}

/**
 * Whether an exact current Mystery narration prompt is still being installed or acknowledged.
 *
 * The public semantic observer first publishes the replay/engine MESSAGE handler as blocked, then
 * republishes the next prompt generation as actionable after the ordered narration step arrives.
 * On the four-core browser runner that handoff can exceed the short unknown-surface timer even
 * though the paired session is making healthy progress. Keep that known, non-actionable surface
 * under the immutable between-wave deadline; as soon as it becomes actionable the ordinary
 * narration driver owns it, and as soon as another surface supersedes it this exemption vanishes.
 */
export function hasProvisionalMysteryNarrationSurface(clients, cursors) {
  return clients.some(client => {
    const cursor = cursors[client.label] ?? 0;
    const event = client.evidence.findLastSemanticSurface(cursor, "mystery-encounter:message");
    const latest = client.evidence.findLastSemanticSurface(cursor);
    const observation = event?.observation;
    return (
      event?.index === latest?.index
      && observation?.operationClass === "encounter-prompt"
      && observation.ownerModel === "interaction"
      && observation.coop === true
      && INTERACTIVE_MYSTERY_NARRATION_PHASES.has(observation.phase)
      && observation.uiMode === "MESSAGE"
      && observation.ready?.handlerActive === true
      && (observation.ready.awaitingActionInput !== true || observation.ready.inputBlocked === true)
    );
  });
}

/**
 * Whether a browser is currently publishing a known passive battle-progress surface.
 *
 * A low-FPS two-browser runner can remain in NextEncounterPhase's tween (or another battle narration
 * phase) longer than the short unknown-UI budget. `awaitingActionInput !== true` proves there is no key
 * a human could press yet; keep waiting under the immutable outer deadline. Once a prompt arms, this
 * exemption disappears: the ordinary prompt driver must press it, and an authority-frozen prompt still
 * fails loudly instead of being mislabeled as passive.
 */
export function hasPassiveBattleProgressSurface(clients, cursors) {
  return clients.some(client => {
    const cursor = cursors[client.label] ?? 0;
    const event = client.evidence.findLastSemanticSurface(cursor);
    const observation = event?.observation;
    if (
      observation == null
      || observation.operationClass !== "battle-progress"
      || !BATTLE_PROMPT_PHASES.has(observation.surfaceId)
      || observation.ready?.handlerActive !== true
      || observation.ready?.awaitingActionInput === true
    ) {
      return false;
    }
    const phaseEvent = client.evidence.findLast(START_PHASE, cursor);
    const phaseName = phaseEvent == null ? null : START_PHASE.exec(phaseEvent.text ?? "")?.[1];
    // A multi-battler intro legitimately starts the same phase class once per battler. The
    // semantic observer de-duplicates an unchanged, non-actionable MESSAGE surface, so a later
    // `Start Phase SummonPhase` can follow the last surface event while that surface remains the
    // exact current UI. Requiring evidence-index order therefore turns a slow double/triple intro
    // into an UNKNOWN failure. Phase-name equality still rejects a genuinely superseded surface;
    // the address/readiness checks above retain the bounded passive-only exemption.
    return phaseName == null || observation.phase === phaseName;
  });
}

export function currentPairedBattleKind(rig, wave) {
  const observations = Object.values(rig.clients).flatMap(client => {
    const event = client.evidence.findLastSurface("command");
    return event?.observation.wave === wave ? [event.observation] : [];
  });
  // An actionable command owner publishes both the legacy continuation observation and the semantic
  // V2 surface. Its passive peer publishes only command:watcher: it has no interactive Command UI and
  // therefore deliberately emits no legacy continuation observation. The shared-command-frontier proof
  // immediately before this loop already establishes the watcher's exact address and digest. Classify
  // from every current owner observation that exists; requiring a legacy watcher event turns a healthy
  // owner/watcher frontier into a harness-only failure whenever ownership changes between waves.
  if (observations.length === 0) {
    throw new Error(`[campaign-mystery] no current command owner observation for wave ${wave}`);
  }
  const first = observations[0];
  const fields = observation => ({
    battleType: observation.battleType,
    trainerBoss: observation.trainerBoss,
    bossEnemyCount: observation.bossEnemyCount,
    maxBossSegments: observation.maxBossSegments,
  });
  if (
    observations.slice(1).some(observation => JSON.stringify(fields(observation)) !== JSON.stringify(fields(first)))
  ) {
    throw new Error(`[campaign-mystery] battle kind diverged at wave ${wave}: ${JSON.stringify(observations)}`);
  }
  return { wave, ...fields(first) };
}

function latestCommandObservation(client, wave) {
  const event = client.evidence.findLastSemanticSurface();
  const observation = event?.observation;
  return observation?.operationClass === "command" && observation.address?.wave === wave ? observation : null;
}

/**
 * Return the newest exact-address semantic projection that carries party material at/after `minWave`.
 * Prefer a command projection within that newest wave when one exists, but do not require one: on
 * Mystery difficulty the next authoritative surface can legitimately be the wave-N Mystery Encounter
 * before CommandPhase opens. Requiring CommandPhase made a completed reward mutation look unfinished.
 */
function latestPartyMaterialObservation(client, minWave) {
  const candidates = client.evidence.events.filter(event => {
    const observation = event.kind === "browser-surface2" ? event.observation : null;
    return (
      Number.isSafeInteger(observation?.address?.epoch)
      && Number.isSafeInteger(observation.address.wave)
      && observation.address.wave >= minWave
      && Number.isSafeInteger(observation.address.turn)
      && observation.surfaceId !== "unclassified"
      && Array.isArray(observation.partySlots)
    );
  });
  const newestWave = candidates.reduce(
    (wave, event) => Math.max(wave, event.observation.address.wave),
    Number.NEGATIVE_INFINITY,
  );
  const newestWaveCandidates = candidates.filter(event => event.observation.address.wave === newestWave);
  const command = newestWaveCandidates.findLast(event => event.observation.operationClass === "command");
  return (command ?? newestWaveCandidates.at(-1))?.observation ?? null;
}

function assertPairedPartyMaterialFrontier(configuredId, observations) {
  if (observations.some(observation => observation == null)) {
    throw new Error(`[campaign-party-reward] ${configuredId} never exposed both wave-2 party projections`);
  }
  const addresses = observations.map(observation => observation.address);
  if (JSON.stringify(addresses[0]) !== JSON.stringify(addresses[1])) {
    throw new Error(
      `[campaign-party-reward] ${configuredId} party material came from different authority addresses: `
        + JSON.stringify(addresses),
    );
  }
}

/** Prove an exact initial-save fixture produced three level-100, evolution-paused mons per real seat. */
function assertLongitudinalFixtureParty(rig, wave, context, evidenceKind, expectedSpecies) {
  const observations = Object.values(rig.clients).map(client => ({
    label: client.label,
    observation: latestCommandObservation(client, wave),
  }));
  const projections = observations.map(({ label, observation }) => {
    const party = observation?.partySlots;
    if (!Array.isArray(party) || party.length !== 6) {
      throw new Error(`[campaign-${context}] ${label} did not observe the six-mon initial shared party`);
    }
    for (const owner of ["host", "guest"]) {
      const owned = party.filter(slot => slot.coopOwner === owner);
      const species = owned.map(slot => slot.speciesId).toSorted((left, right) => left - right);
      if (
        owned.length !== 3
        || owned.some(slot => slot.level !== 100)
        || owned.some(slot => slot.pauseEvolutions !== true)
        || JSON.stringify(species) !== JSON.stringify(expectedSpecies)
      ) {
        throw new Error(
          `[campaign-${context}] ${label} ${owner} fixture mismatch: ${JSON.stringify(owned.map(slot => ({ speciesId: slot.speciesId, level: slot.level, pauseEvolutions: slot.pauseEvolutions })))}`,
        );
      }
    }
    return party.map(slot => ({
      slot: slot.slot,
      speciesId: slot.speciesId,
      coopOwner: slot.coopOwner,
      level: slot.level,
      pauseEvolutions: slot.pauseEvolutions,
    }));
  });
  if (JSON.stringify(projections[0]) !== JSON.stringify(projections[1])) {
    throw new Error(
      `[campaign-${context}] initial level-100 party projection diverged: ${JSON.stringify(projections)}`,
    );
  }
  const proof = { wave, party: projections[0] };
  for (const client of Object.values(rig.clients)) {
    client.evidence.record(evidenceKind, proof);
  }
  return proof;
}

export function assertNavigationFixtureParty(rig, wave = 1) {
  return assertLongitudinalFixtureParty(rig, wave, "navigation", "campaign-navigation-level100-party", [150, 888, 889]);
}

export function assertMysteryFixtureParty(rig, wave = 1) {
  return assertLongitudinalFixtureParty(rig, wave, "mystery", "campaign-mystery-level100-party", [86, 327, 351]);
}

/** Prove the short depth lane received six point-legal starters without disabling normal progression. */
export function assertDepthFixtureParty(rig, wave = 1) {
  const expectedSpecies = [86, 327, 351];
  const projections = Object.values(rig.clients).map(client => {
    const party = latestCommandObservation(client, wave)?.partySlots;
    if (!Array.isArray(party) || party.length !== 6) {
      throw new Error(`[campaign-depth] ${client.label} did not observe the six-mon initial shared party`);
    }
    for (const owner of ["host", "guest"]) {
      const owned = party.filter(slot => slot.coopOwner === owner);
      const species = owned.map(slot => slot.speciesId).toSorted((left, right) => left - right);
      if (
        owned.length !== 3
        || owned.some(slot => !Number.isSafeInteger(slot.level) || slot.level < 1 || slot.level >= 100)
        || owned.some(slot => slot.pauseEvolutions === true)
        || JSON.stringify(species) !== JSON.stringify(expectedSpecies)
      ) {
        throw new Error(
          `[campaign-depth] ${client.label} ${owner} fixture mismatch: ${JSON.stringify(owned.map(slot => ({ speciesId: slot.speciesId, level: slot.level, pauseEvolutions: slot.pauseEvolutions })))}`,
        );
      }
    }
    return party.map(slot => ({
      slot: slot.slot,
      speciesId: slot.speciesId,
      coopOwner: slot.coopOwner,
      level: slot.level,
      pauseEvolutions: slot.pauseEvolutions,
    }));
  });
  if (JSON.stringify(projections[0]) !== JSON.stringify(projections[1])) {
    throw new Error(`[campaign-depth] initial normal-level party projection diverged: ${JSON.stringify(projections)}`);
  }
  const proof = { wave, party: projections[0] };
  for (const client of Object.values(rig.clients)) {
    client.evidence.record("campaign-depth-normal-level-party", proof);
  }
  return proof;
}

/** Capture the raw arena/presentation view at a paired command frontier; the mechanical digest remains primary. */
export function recordNavigationCommandFrontier(rig, coverage, wave) {
  if (coverage.commandFrontiers.some(frontier => frontier.wave === wave)) {
    return coverage.commandFrontiers.find(frontier => frontier.wave === wave);
  }
  const projections = Object.values(rig.clients).map(client => {
    const observation = latestCommandObservation(client, wave);
    if (observation?.arena == null || observation.presentation == null) {
      throw new Error(`[campaign-navigation] ${client.label} omitted arena/presentation at command wave ${wave}`);
    }
    return {
      label: client.label,
      arena: observation.arena,
      presentation: observation.presentation,
      displayedWave: observation.displayedWave,
    };
  });
  const canonical = projections.map(({ label: _label, presentation, ...projection }) =>
    JSON.stringify({
      ...projection,
      presentation: {
        trainerVisible: presentation.trainerVisible,
        enemyTrainerPresented: presentation.enemyTrainerPresented,
      },
    }),
  );
  if (canonical[0] !== canonical[1]) {
    throw new Error(
      `[campaign-navigation] command arena/presentation diverged at wave ${wave}: ${JSON.stringify(projections)}`,
    );
  }
  const frontier = { wave, ...projections[0] };
  coverage.commandFrontiers.push(frontier);
  for (const client of Object.values(rig.clients)) {
    client.evidence.record("campaign-navigation-command-frontier", frontier);
  }
  return frontier;
}

/** Closed acceptance contract for the navigation-only 30-wave journey. */
export function assertNavigationCoverage(coverage, marketCoverage, battleKinds, targetWaves) {
  const requiredMarketWaves = [10, 20, 30].filter(wave => wave <= targetWaves);
  const marketWaves = marketCoverage.visits.map(visit => visit.address?.wave).filter(Number.isSafeInteger);
  const missingMarkets = requiredMarketWaves.filter(wave => !marketWaves.includes(wave));
  if (missingMarkets.length > 0) {
    throw new Error(`[campaign-navigation] missing biome markets at waves ${missingMarkets.join(",")}`);
  }
  const marketOwners = new Set(marketCoverage.visits.map(visit => visit.ownerSeat));
  if (requiredMarketWaves.length >= 2 && (!marketOwners.has(0) || !marketOwners.has(1))) {
    throw new Error(
      `[campaign-navigation] markets did not exercise both interaction owners: ${JSON.stringify([...marketOwners])}`,
    );
  }
  const crossroadsChoices = new Set(coverage.crossroads.map(event => event.targetId));
  if (!crossroadsChoices.has("stay") || !crossroadsChoices.has("leave")) {
    throw new Error(
      `[campaign-navigation] Crossroads did not prove both Stay and Leave: ${JSON.stringify(coverage.crossroads)}`,
    );
  }
  if (coverage.worldMaps.length === 0) {
    throw new Error("[campaign-navigation] Crossroads Leave never opened and completed the World Map");
  }
  const biomeIds = new Set(coverage.commandFrontiers.map(frontier => frontier.arena.biomeId));
  if (biomeIds.size < 2) {
    throw new Error(`[campaign-navigation] no second biome reached: ${JSON.stringify([...biomeIds])}`);
  }
  const chained = coverage.waveSurfaces.some(({ wave, surfaces }) => {
    const names = surfaces.map(surface => surface.surface);
    const market = names.indexOf("biome-shop");
    const crossroads = names.indexOf("crossroads");
    const worldMap = names.indexOf("biome-pick");
    const choseLeave = coverage.crossroads.some(event => event.wave === wave && event.targetId === "leave");
    const completedWorldMap = coverage.worldMaps.some(event => event.wave === wave);
    return market >= 0 && crossroads > market && worldMap > crossroads && choseLeave && completedWorldMap;
  });
  if (!chained) {
    throw new Error("[campaign-navigation] no ordered market -> Crossroads Leave -> World Map chain completed");
  }
  if (targetWaves >= 20) {
    const wave20 = battleKinds.find(kind => kind.wave === 20);
    if (wave20?.battleType !== "TRAINER" || wave20.trainerBoss !== true) {
      throw new Error(`[campaign-navigation] wave 20 was not the required trainer boss: ${JSON.stringify(wave20)}`);
    }
    const afterGym = coverage.commandFrontiers.find(frontier => frontier.wave === 21);
    if (afterGym == null || afterGym.presentation.trainerVisible !== false) {
      throw new Error(
        `[campaign-navigation] trainer presentation remained visible after wave 20: ${JSON.stringify(afterGym)}`,
      );
    }
  }
  const malformedArena = coverage.commandFrontiers.find(
    frontier =>
      !Number.isSafeInteger(frontier.arena.biomeId)
      || !Number.isSafeInteger(frontier.arena.weather)
      || !Number.isSafeInteger(frontier.arena.terrain),
  );
  if (malformedArena != null) {
    throw new Error(`[campaign-navigation] malformed arena initialization proof: ${JSON.stringify(malformedArena)}`);
  }
  return {
    requiredMarketWaves,
    marketWaves,
    marketOwners: [...marketOwners],
    crossroads: coverage.crossroads,
    worldMaps: coverage.worldMaps,
    biomeIds: [...biomeIds],
    chained,
  };
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
async function advanceToNextWaveCommand(
  rig,
  policy,
  waveOrdinal,
  stats,
  surfaceCursors,
  navigationCoverage = null,
  onProgress = async () => {},
) {
  const clients = Object.values(rig.clients);
  const dispatch = buildDispatchTable(policy);
  const handledIndex = new Map();
  const rewardRetryState = { pendingTarget: null, rejectedByAddress: new Map() };
  // Owner markers for reward/biome/crossroads/etc. are searched from the wave start
  // (surfaceCursors); the next command and terminal are searched from the post-battle
  // cursor so this wave's own commands never read as the next wave.
  const commandCursors = stats._successorWaveCursors ?? fromEach(clients, client => client.evidence.cursor());
  stats._successorWaveCursors = undefined;
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
  const betweenWaveTimeoutMs = rig.config.timeoutMs * 3;
  const fixedDeadline = Date.now() + betweenWaveTimeoutMs;
  // Runs 30205274431 and 30241841635 reached the old ceiling while both real browsers were still
  // advancing ordered presentation, then proved the next shared command 44s and 22s later. Run
  // 30779783513 subsequently proved the turn-only ceiling was still too narrow for one finite chain of
  // reward -> retained evolution -> learn-move -> next-encounter presentation: both clients reached wave 2,
  // but the ceiling expired while one renderer was entering CoopReplayTurnPhase. That is a harness false
  // red, not permission to wait indefinitely. The animations-on chain therefore gets the ordinary
  // between-wave window plus at most one measured dense-presentation ceiling. Only causal phase/stream
  // progress refreshes the sliding deadline, and the sum remains an immutable outer bound. All faster
  // profiles retain the fixed deadline.
  // Party-mutation fixtures deliberately retain the native evolution presentation even when
  // ordinary move animations are skipped. Under the 28-way matrix in run 30795897194 the
  // authoritative evolution and mirrored party material completed, but the finite cutscene was
  // still emitting monotonically advancing stage heartbeats when the fixed 270s deadline fired.
  // Reuse the same causal progress budget as normal presentation qualification, with a smaller
  // immutable ceiling. Keepalives and repeated phase names still cannot extend it.
  const retainedPartyEvolutionExpected = retainedPartyEvolutionNeedsProgressBudget(policy.partyMutatingReward);
  const betweenWaveBudget =
    policy.moveAnimationsExpected || retainedPartyEvolutionExpected
      ? createAnimationProgressBudget(rig, commandCursors, betweenWaveTimeoutMs, {
          hardCeilingMs:
            betweenWaveTimeoutMs
            + (policy.moveAnimationsExpected ? ANIMATIONS_ON_OUTCOME_HARD_CEILING_MS : OUTCOME_HARD_CEILING_MS),
        })
      : null;
  // Mystery difficulty deliberately chains encounters without opening a battle command between them, and the
  // longitudinal navigation profile can encounter the same chain between two geographic frontiers. Give each
  // observer-proven public action one ordinary surface allowance; never refresh from keepalives, phase names, or
  // time alone. The immutable ceiling remains derived from the finite required Mystery surface count.
  const registeredSurfaceProgressBudget =
    policy.mysteryGauntlet.required || policy.navigation.required || policy.registeredInteractions.required
      ? createRegisteredSurfaceProgressBudget(
          betweenWaveTimeoutMs,
          rig.config.timeoutMs,
          policy.mysteryGauntlet.minSurfaces,
        )
      : null;
  const recordRegisteredSurfaceProgress = kind => {
    if (registeredSurfaceProgressBudget == null) {
      return;
    }
    const proof = registeredSurfaceProgressBudget.noteProgress();
    for (const client of clients) {
      client.evidence.record("campaign-mystery-progress-budget", { kind, ...proof });
    }
  };
  let stallSince = 0;
  let lastPhaseProgress = phaseProgressSignature(clients);
  let lastRegisteredSurface = null;
  let drivenSurfacePhaseSignature = null;
  const reportBetweenWaveProgress = (message, detail = {}) =>
    onProgress(message, {
      sourceWave: stats.wave,
      ordinal: waveOrdinal,
      activeWave: rig.activeBattleWave,
      latestMysteryWave: stats.mysteryEvents.at(-1)?.wave ?? null,
      surfaceCount: stats.surfaces.length,
      ...detail,
    });
  const consumeSharedCommandFrontier = async () => {
    if (!allClientsAtCurrentCommandFrontier(clients, commandCursors)) {
      return null;
    }
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
    await reportBetweenWaveProgress("between-wave command frontier reached", {
      destinationWave: boundary.wave,
      destinationTurn: boundary.turn,
    });
    return { status: "continue", boundary };
  };

  while (Date.now() < (betweenWaveBudget?.observe() ?? registeredSurfaceProgressBudget?.deadline() ?? fixedDeadline)) {
    if (
      clients.some(
        client =>
          client.evidence.find(SHARED_SESSION_TERMINAL, commandCursors[client.label])
          || client.evidence.find(GAME_OVER_PHASE, commandCursors[client.label]),
      )
    ) {
      await reportBetweenWaveProgress("between-wave terminal reached");
      return { status: "terminal" };
    }

    const commandFrontier = await consumeSharedCommandFrontier();
    if (commandFrontier != null) {
      return commandFrontier;
    }

    // Loud-fail (strict) unless the explicit shakedown/auto-first ordering opt-in is set: the same
    // gate that permits press-through of an unknown surface also permits the role-default fallback.
    const drove = await driveOnePendingSurface(
      rig,
      dispatch,
      surfaceCursors,
      handledIndex,
      stats,
      !policy.autoFirst,
      rewardRetryState,
      policy,
      navigationCoverage,
    );
    if (drove === "target-reached") {
      rig.activeBattleWave = stats.targetBoundary.wave;
      await reportBetweenWaveProgress("between-wave target frontier reached", {
        destinationWave: stats.targetBoundary.wave,
        destinationTurn: stats.targetBoundary.turn,
      });
      return { status: "continue", boundary: stats.targetBoundary };
    }
    if (drove) {
      recordRegisteredSurfaceProgress(`surface:${drove}`);
      await reportBetweenWaveProgress("between-wave surface driven", { surface: drove });
      stallSince = 0;
      lastRegisteredSurface = drove;
      lastPhaseProgress = phaseProgressSignature(clients);
      drivenSurfacePhaseSignature = drove === "reward-target-retry" ? null : lastPhaseProgress;
      continue;
    }

    if (await advanceBattlePrompt()) {
      recordRegisteredSurfaceProgress("battle-prompt");
      await reportBetweenWaveProgress("between-wave battle prompt advanced");
      stallSince = 0;
      lastRegisteredSurface = null;
      lastPhaseProgress = phaseProgressSignature(clients);
      drivenSurfacePhaseSignature = lastPhaseProgress;
      continue;
    }

    if (await advanceMysteryNarration()) {
      recordRegisteredSurfaceProgress("mystery-narration");
      await reportBetweenWaveProgress("between-wave mystery narration advanced");
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

    if (
      hasPassiveBattleProgressSurface(clients, commandCursors)
      || hasProvisionalCommandWatcherSurface(clients, commandCursors)
      || hasProvisionalMysteryNarrationSurface(clients, commandCursors)
    ) {
      lastRegisteredSurface = "provisional-public-progress";
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

  // Every loop iteration performs asynchronous public-surface work before returning to its deadline
  // guard. A command frontier can therefore become current during the final readiness delay, exactly
  // as market run 30732573521 did 260ms after the last provisional-progress observation. Re-read the
  // append-only evidence once at the immutable deadline; this grants no extra waiting budget and only
  // accepts the same address-exact shared proof used inside the loop.
  const deadlineCommandFrontier = await consumeSharedCommandFrontier();
  if (deadlineCommandFrontier != null) {
    return deadlineCommandFrontier;
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
  const navigationCoverage = {
    route: policy.navigation.crossroadsRoute,
    crossroads: [],
    worldMaps: [],
    commandFrontiers: [],
    waveSurfaces: [],
  };
  const useDepthPartyFixture =
    rig.config.journey === "campaign"
    && policy.renderProfile === "animations-skipped-depth"
    && !rig.config.expectReclaim;
  progress.startHeartbeat(() => campaignLiveSnapshot(rig, clients, policy.targetWaves));
  await progress.note("campaign start", {
    targetWaves: policy.targetWaves,
    rewardMode: policy.rewardMode,
    market: policy.market,
    renderProfile: policy.renderProfile,
    mysteryGauntlet: policy.mysteryGauntlet,
    registeredInteractions: policy.registeredInteractions,
    abilityCapsule: policy.abilityCapsule,
    partyMutatingReward: policy.partyMutatingReward,
    navigation: policy.navigation,
    expectReclaim: rig.config.expectReclaim,
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
    await rig.startFreshRun({
      campaignSurvivalFixture: policy.mysteryGauntlet.required || useDepthPartyFixture,
      // The market-only 20-wave profile uses the same exact level-100 seeded party as the
      // navigation-depth profile. Keeping the selected journey identity reaches the URL gate, but
      // setup must also choose the seeded-team confirmer instead of trying to add default starters.
      navigationFixture: policy.navigation.required || policy.market.requiredPurchases > 0,
      registeredInteractionsFixture: policy.registeredInteractions.required,
      abilityCapsuleFixture: policy.abilityCapsule.required,
      partyRewardFixture: policy.partyMutatingReward.required,
    });
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
  if (policy.navigation.required) {
    assertNavigationFixtureParty(rig, 1);
    recordNavigationCommandFrontier(rig, navigationCoverage, 1);
    await progress.note("navigation fixture level-100 parties and initial arena proven");
  } else if (policy.mysteryGauntlet.required) {
    assertMysteryFixtureParty(rig, 1);
    await progress.note("mystery fixture level-100 parties proven");
  } else if (useDepthPartyFixture) {
    assertDepthFixtureParty(rig, 1);
    await progress.note("depth fixture normal-level six-mon party proven");
  }

  let wavesCleared = 0;
  let battleLoops = 0;
  let status = "continue";
  const marketCoverage = { visits: [], purchases: [] };
  const mysteryCoverage = { events: [], battleKinds: [] };
  const registeredInteractionCoverage = { revival: [], stormglass: [], mysterySuccessor: null };
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
      await progress.note("wave battle started", {
        wave: waveNo,
        ordinal,
        battleKind,
      });
      const battleResult = await driveBattleWave(rig, policy, stats, (message, detail) =>
        progress.note(message, detail),
      );
      await progress.note("wave battle reached post-battle boundary", {
        wave: waveNo,
        ordinal,
        battleResult,
      });
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
      const advanced = await advanceToNextWaveCommand(
        rig,
        policy,
        ordinal,
        stats,
        surfaceCursors,
        policy.navigation.required ? navigationCoverage : null,
        (message, detail) => progress.note(message, detail),
      );
      if (policy.navigation.required) {
        navigationCoverage.waveSurfaces.push({ wave: waveNo, surfaces: [...stats.surfaces] });
        if (advanced.boundary != null) {
          recordNavigationCommandFrontier(rig, navigationCoverage, advanced.boundary.wave);
        }
      }
      if (stats.market != null) {
        marketCoverage.visits.push(stats.market);
        marketCoverage.purchases.push(...stats.market.purchases);
      }
      status = advanced.status;
      if (advanced.boundary != null) {
        wavesCleared = Math.max(wavesCleared, advanced.boundary.wave - 1);
      }
      rig.assertWaveProgressionLedger(waveNo, `campaign-wave-${waveNo}-progression-ledger`, {
        // The dedicated longitudinal, registered-interaction, and party-mutating reward fixtures start
        // both parties above ordinary progression levels, so a completed battle can correctly have no EXP
        // presentation. Keep the complete authority-vs-renderer ledger equality proof above, but reserve
        // the mandatory EXP cue for normal-level journeys that can actually gain EXP.
        requireExp:
          !(
            policy.navigation.required
            || policy.market.requiredPurchases > 0
            || policy.mysteryGauntlet.required
            || policy.registeredInteractions.required
            || policy.partyMutatingReward.required
          )
          && (battleKind.battleType === "WILD" || battleKind.battleType === "TRAINER"),
      });
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
      const trainerPresentationProof = assertTrainerPresentationCoverage(rig, mysteryCoverage.battleKinds);
      if (trainerPresentationProof != null) {
        await progress.note("trainer presentation lifecycle proven on both browsers", {
          proof: trainerPresentationProof,
        });
      }
    }
    assertMarketCoverage(marketCoverage, policy.market);
    if (policy.navigation.required) {
      const navigationProof = assertNavigationCoverage(
        navigationCoverage,
        marketCoverage,
        mysteryCoverage.battleKinds,
        policy.targetWaves,
      );
      for (const client of clients) {
        client.evidence.record("campaign-navigation-coverage", navigationProof);
      }
    }
    if (policy.mysteryGauntlet.required) {
      const expectedEvents = new Map(
        [
          [2, "mystery"],
          [3, "mystery"],
          [4, "mystery"],
          [5, "mystery"],
          [6, "mystery"],
          [9, "bargain"],
          [10, "mystery"],
        ].filter(([wave]) => wave <= policy.targetWaves),
      );
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
          `[campaign-mystery] ordinary encounters were not distinct registry types: ${JSON.stringify(ordinaryMysteryTypes)}`,
        );
      }
      const wildOne = mysteryCoverage.battleKinds.find(kind => kind.wave === 1);
      const ghostSeven = mysteryCoverage.battleKinds.find(kind => kind.wave === 7);
      const bossEight = mysteryCoverage.battleKinds.find(kind => kind.wave === 8);
      if (wildOne?.battleType !== "WILD") {
        throw new Error(`[campaign-mystery] wave 1 kind mismatch: ${JSON.stringify({ wildOne })}`);
      }
      if (policy.targetWaves >= 7 && ghostSeven?.battleType !== "TRAINER") {
        throw new Error(`[campaign-mystery] wave 7 kind mismatch: ${JSON.stringify({ ghostSeven })}`);
      }
      // EncounterPhase intentionally distributes a multi-bar wild boss across every enemy in a double
      // battle. Two generated two-bar bosses therefore become two one-bar bosses before command opens.
      // Prove the retained mechanical invariant (boss identity on the full enemy side), not the discarded
      // pre-balancing segment count.
      if (
        policy.targetWaves >= 8
        && (bossEight?.battleType !== "WILD" || bossEight.bossEnemyCount < 2 || bossEight.maxBossSegments < 1)
      ) {
        throw new Error(
          `[campaign-mystery] wave 8 was not the scripted segmented wild boss: ${JSON.stringify(bossEight)}`,
        );
      }
      // Only the authority selects the ghost. The renderer adopts the resulting trainer carrier;
      // requiring it to run the selector would weaken the authoritative architecture.
      if (policy.targetWaves >= 7) {
        await rig.host.evidence.waitFor(/\[er-ghost\] wave 7: (?:ghost|reusing cached ghost) /u, {
          timeoutMs: rig.config.timeoutMs,
          description: "authority selected the Mystery gauntlet wave 7 ghost team",
        });
      }
      const requiredMysteryEvents = Math.min(policy.mysteryGauntlet.minSurfaces, expectedEvents.size);
      if (mysteryCoverage.events.length < requiredMysteryEvents) {
        throw new Error(
          `[campaign-mystery] observed ${mysteryCoverage.events.length} distinct completed event waves; required ${requiredMysteryEvents}`,
        );
      }
    }
    if (policy.registeredInteractions.required) {
      for (const client of clients) {
        registeredInteractionCoverage.revival.push(
          ...client.evidence.events.filter(event => event.kind === "campaign-revival-choice"),
        );
        registeredInteractionCoverage.stormglass.push(
          ...client.evidence.events.filter(event => event.kind === "campaign-stormglass-choice"),
        );
      }
      const stormglassMysterySuccessor = clients
        .flatMap(client => client.evidence.events)
        .find(
          event =>
            typeof event.text === "string"
            && /\[coop:v2-replica\] apply rev=\d+ kind=INTERACTION_COMMIT .*STORMGLASS.*interactionAddresses:op%3Ame:ME_PRESENT:w2:t0/u.test(
              event.text,
            ),
        );
      const completedMysterySuccessor = mysteryCoverage.events.find(
        event => event.kind === "mystery" && event.wave === 2 && event.terminal?.wave > event.wave,
      );
      registeredInteractionCoverage.mysterySuccessor = completedMysterySuccessor ?? null;
      // The exact-build picker forces Fun and Games (enum value 27). Completing its wave-2 event proves
      // the public driver crossed party selection, three direct combat turns, reward settlement, and the
      // next-wave successor instead of merely completing an arbitrary no-battle Mystery surface.
      if (
        registeredInteractionCoverage.revival.length !== 1
        || registeredInteractionCoverage.stormglass.length !== 1
        || stormglassMysterySuccessor == null
        || completedMysterySuccessor == null
        || completedMysterySuccessor.mysteryEncounterType !== 27
      ) {
        throw new Error(
          "[campaign-registered-interactions] exact fixture did not complete Revival -> Stormglass -> ME_PRESENT(t0) -> Mystery terminal: "
            + JSON.stringify({
              revival: registeredInteractionCoverage.revival,
              stormglass: registeredInteractionCoverage.stormglass,
              stormglassMysterySuccessor: stormglassMysterySuccessor?.text ?? null,
              mysterySuccessor: registeredInteractionCoverage.mysterySuccessor,
              expectedMysteryEncounterType: 27,
            }),
        );
      }
      const proof = {
        revival: registeredInteractionCoverage.revival[0],
        stormglass: registeredInteractionCoverage.stormglass[0],
        stormglassMysterySuccessor: stormglassMysterySuccessor.text,
        mysterySuccessor: registeredInteractionCoverage.mysterySuccessor,
      };
      for (const client of clients) {
        client.evidence.record("campaign-registered-interaction-coverage", proof);
      }
    }
    if (policy.partyMutatingReward.required) {
      const configuredId = policy.partyMutatingReward.rewardId;
      const allEvents = clients.flatMap(client => client.evidence.events);
      const targetActions = allEvents.filter(event => {
        if (event.kind !== "campaign-reward-target-action") {
          return false;
        }
        return event.rewardId === configuredId;
      });
      const learnAccepts = allEvents.filter(
        event => event.kind === "campaign-learn-move-accepted" && event.rewardId === configuredId,
      );
      const abilityChoices = allEvents.filter(event => event.kind === "campaign-ability-choice");
      if (policy.partyMutatingReward.checkTeamReorder) {
        const reorderProofs = allEvents.filter(event => event.kind === "campaign-check-team-reorder");
        const returnProofs = allEvents.filter(event => event.kind === "campaign-check-team-return");
        if (
          reorderProofs.length !== clients.length
          || returnProofs.length !== clients.length
          || JSON.stringify(reorderProofs[0]?.expectedPartyIds ?? null)
            !== JSON.stringify(reorderProofs.at(-1)?.expectedPartyIds ?? null)
          || reorderProofs.some(event =>
            event.fieldIds?.some(
              fieldIds => JSON.stringify(fieldIds) !== JSON.stringify(event.expectedPartyIds.slice(0, fieldIds.length)),
            ),
          )
        ) {
          throw new Error(
            `[campaign-check-team] ${configuredId} did not prove reorder, visible field, and cursor return on both browsers: `
              + JSON.stringify({ reorderProofs, returnProofs }),
          );
        }
      }
      if (policy.partyMutatingReward.direct) {
        const directActions = allEvents.filter(
          event => event.kind === "campaign-direct-party-reward-action" && event.rewardId === configuredId,
        );
        if (directActions.length !== 1 || !Array.isArray(directActions[0].beforePartySlots)) {
          throw new Error(
            `[campaign-party-reward] ${configuredId} did not produce one observable direct mutation: `
              + JSON.stringify(directActions),
          );
        }
        const finalObservations = clients.map(client => latestPartyMaterialObservation(client, 2));
        assertPairedPartyMaterialFrontier(configuredId, finalObservations);
        const finalParties = finalObservations.map(observation => observation.partySlots);
        const finalProjections = finalParties.map(party =>
          party.map(partyRewardMutationProjection).sort((left, right) => left.pokemonId - right.pokemonId),
        );
        if (JSON.stringify(finalProjections[0]) !== JSON.stringify(finalProjections[1])) {
          throw new Error(
            `[campaign-party-reward] ${configuredId} whole-party material diverged at wave 2: `
              + JSON.stringify(finalProjections),
          );
        }
        const beforeSlots = directActions[0].beforePartySlots;
        const afterById = new Map(finalParties[0].map(slot => [slot.pokemonId, slot]));
        if (
          configuredId === "RARER_CANDY"
          && !beforeSlots.every(slot => (afterById.get(slot.pokemonId)?.level ?? slot.level) > slot.level)
        ) {
          throw new Error("[campaign-party-reward] Rarer Candy did not level the whole party");
        }
        if (configuredId === "SACRED_ASH") {
          const faintedBefore = beforeSlots.filter(slot => slot.fainted === true);
          if (
            faintedBefore.length < 2
            || faintedBefore.some(slot => {
              const after = afterById.get(slot.pokemonId);
              return after == null || after.fainted === true || after.hp <= 0;
            })
          ) {
            throw new Error(
              "[campaign-party-reward] Sacred Ash did not revive both prepared reserves: "
                + JSON.stringify({ beforeSlots, after: finalParties[0] }),
            );
          }
        }
        if (configuredId === "ER_DEX_NAV") {
          const dexChoices = abilityChoices.filter(event => event.phase === "ErDexNavPhase");
          const ownerOutcomes = allEvents.filter(
            event => event.kind === "console" && /dexNav OWNER relay OUTCOME .* op=DEX_NAV/u.test(event.text ?? ""),
          );
          const watcherOutcomes = allEvents.filter(
            event =>
              event.kind === "console"
              && /dexNav WATCHER apply OUTCOME .* op=DEX_NAV .* timedOut=false/u.test(event.text ?? ""),
          );
          if (
            dexChoices.length !== 2
            || new Set(dexChoices.map(event => event.targetId)).size !== 2
            || ownerOutcomes.length !== 1
            || watcherOutcomes.length !== 1
          ) {
            throw new Error(
              "[campaign-party-reward] Dex Nav did not complete its two-choice owner/watcher workflow: "
                + JSON.stringify({
                  dexChoices,
                  ownerOutcomes: ownerOutcomes.length,
                  watcherOutcomes: watcherOutcomes.length,
                }),
            );
          }
        }
        const proof = {
          rewardId: configuredId,
          directAction: directActions[0],
          finalAddress: finalObservations[0].address,
          finalParty: finalParties[0],
        };
        for (const client of clients) {
          client.evidence.record("campaign-party-mutating-reward-coverage", proof);
        }
      } else {
        if (targetActions.length !== 1) {
          throw new Error(
            `[campaign-party-reward] ${configuredId} did not produce exactly one public party action: `
              + JSON.stringify(targetActions),
          );
        }
        if (policy.partyMutatingReward.acceptLearnMove && learnAccepts.length !== 1) {
          throw new Error(
            `[campaign-party-reward] ${configuredId} did not accept exactly one full-moveset learn prompt: `
              + JSON.stringify(learnAccepts),
          );
        }
        const targetAction = targetActions[0];
        if (
          targetAction.partySlot !== targetAction.beforePartySlot?.slot
          || targetAction.beforePartySlot?.coopOwner !== "guest"
        ) {
          throw new Error(
            `[campaign-party-reward] ${configuredId} did not target the guest-owned combined party slot: `
              + JSON.stringify(targetAction),
          );
        }
        const targetPokemonId = targetAction.beforePartySlot?.pokemonId;
        if (!Number.isSafeInteger(targetPokemonId)) {
          throw new Error(`[campaign-party-reward] ${configuredId} target exposed no stable Pokemon id`);
        }
        const finalObservations = clients.map(client => latestPartyMaterialObservation(client, 2));
        assertPairedPartyMaterialFrontier(configuredId, finalObservations);
        const finalSlots = finalObservations.map(
          observation => observation.partySlots.find(slot => slot.pokemonId === targetPokemonId) ?? null,
        );
        if (finalSlots.some(slot => slot == null)) {
          throw new Error(
            `[campaign-party-reward] ${configuredId} never exposed the target on both wave-2 party projections`,
          );
        }
        const finalProjections = finalSlots.map(partyRewardMutationProjection);
        if (JSON.stringify(finalProjections[0]) !== JSON.stringify(finalProjections[1])) {
          throw new Error(
            `[campaign-party-reward] ${configuredId} target material diverged at wave 2: `
              + JSON.stringify(finalProjections),
          );
        }
        assertPartyRewardChangedConfiguredMaterial(
          configuredId,
          targetAction.beforePartySlot,
          finalSlots[0],
          abilityChoices,
        );
        assertPartyRewardPresentationParity(
          clients,
          configuredId,
          targetAction.presentationCursors,
          policy.renderProfile,
        );
        const proof = {
          rewardId: configuredId,
          targetAction,
          learnAccept: learnAccepts[0] ?? null,
          abilityChoice: abilityChoices[0] ?? null,
          finalAddress: finalObservations[0].address,
          finalTarget: finalSlots[0],
        };
        for (const client of clients) {
          client.evidence.record("campaign-party-mutating-reward-coverage", proof);
        }
      }
    }
    if (policy.abilityCapsule.required) {
      const events = clients.flatMap(client => client.evidence.events);
      const summaryInspections = events.filter(event => event.kind === "campaign-reward-summary-inspection");
      const capsuleTargets = events.filter(
        event => event.kind === "campaign-reward-target-action" && event.rewardId === "ER_ABILITY_CAPSULE",
      );
      const capsuleChoices = events.filter(
        event => event.kind === "campaign-ability-choice" && event.phase === "ErAbilityCapsulePhase",
      );
      const ownerOutcomes = events.filter(
        event =>
          event.kind === "console" && /capsule OWNER relay OUTCOME .* op=CAP_CYCLE data=\[11\]/u.test(event.text ?? ""),
      );
      const watcherOutcomes = events.filter(
        event =>
          event.kind === "console"
          && /capsule WATCHER apply OUTCOME .* op=CAP_CYCLE data=\[11\] timedOut=false/u.test(event.text ?? ""),
      );
      const cursorMirrors = events.filter(
        event => event.kind === "campaign-reward-cursor-mirror" && event.selectedOptionId === "ER_ABILITY_CAPSULE",
      );
      if (
        summaryInspections.length !== 1
        || capsuleTargets.length !== 1
        || capsuleChoices.length !== 1
        || ownerOutcomes.length !== 1
        || watcherOutcomes.length !== 1
        || cursorMirrors.length !== clients.length
        || cursorMirrors.some(event => event.navigationSteps < 1)
      ) {
        throw new Error(
          "[campaign-ability-capsule] exact journey did not prove mirrored reward navigation, Summary return, "
            + "and capsule application: "
            + JSON.stringify({
              summaryInspections: summaryInspections.length,
              capsuleTargets: capsuleTargets.length,
              capsuleChoices: capsuleChoices.length,
              ownerOutcomes: ownerOutcomes.length,
              watcherOutcomes: watcherOutcomes.length,
              cursorMirrors: cursorMirrors.map(event => ({
                navigationSteps: event.navigationSteps,
                selectedOptionId: event.selectedOptionId,
              })),
            }),
        );
      }
      const proof = {
        cursor: cursorMirrors[0],
        summary: summaryInspections[0],
        target: capsuleTargets[0],
        choice: capsuleChoices[0],
        ownerOutcome: ownerOutcomes[0],
        watcherOutcome: watcherOutcomes[0],
      };
      for (const client of clients) {
        client.evidence.record("campaign-ability-capsule-coverage", proof);
      }
    }
    if (status === "continue" && wavesCleared >= policy.targetWaves) {
      await rig.assertCurrentPresentationLedger(`campaign-final-wave-${wavesCleared}-presentation-ledger`);
      assertRetainedEvolutionPresentationParity(rig, policy);
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
      registeredInteractionCoverage,
      abilityCapsule: policy.abilityCapsule,
      partyMutatingReward: policy.partyMutatingReward,
      navigationCoverage,
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
