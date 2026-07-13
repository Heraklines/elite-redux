/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildDispatchTable,
  GAME_OVER_PHASE,
  LOCAL_COMMAND,
  loadCampaignPolicy,
  REWARD_PHASE,
  SHARED_SESSION_TERMINAL,
} from "./campaign-policy.mjs";
import { delay } from "./evidence.mjs";

const TITLE_PHASE = /Start Phase TitlePhase/u;
const START_PHASE = /Start Phase (\w+)/u;
const GUEST_FAINT_PICKER = /guest own-faint picker OPEN/u;
const HOST_SWITCH_PHASE = /Start Phase SwitchPhase/u;

function fromEach(clients, fn) {
  return Object.fromEntries(clients.map(client => [client.label, fn(client)]));
}

/** Structured per-wave campaign progress log written next to the harness evidence. */
class CampaignProgress {
  constructor(artifactDir) {
    this.path = resolve(artifactDir, "campaign-progress.jsonl");
    this.tail = Promise.resolve();
  }

  append(row) {
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`;
    this.tail = this.tail.then(() => appendFile(this.path, line));
    return this.tail;
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

/**
 * Best-effort early speed raise through the visible Settings UI. The exact Title ->
 * Settings -> Game Speed navigation cannot be verified blind, so a run drives it only
 * when the maintainer supplies a verified `COOP_UI_SPEED_KEYS` sequence; otherwise it
 * records a skip and leans on the workflow's fast input cadence. Bounded and never
 * hangs: any residual submenu is closed with Cancel presses, and the subsequent lobby
 * pairing re-asserts Title, so a wrong sequence fails loudly at pairing rather than here.
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
    const cursor = client.evidence.cursor();
    await client.sequence(keys, "raise-game-speed");
    // Close any residual submenu so we return to the Title surface (Cancel = Backspace).
    for (let i = 0; i < 6 && !client.evidence.find(TITLE_PHASE, cursor); i++) {
      await client.press("Backspace", `speed-return-to-title-${i + 1}`);
      await delay(client.config.settleDelayMs);
    }
    client.evidence.record("campaign-speed", { status: "applied", keys });
    await client.checkpoint("speed-raised");
  }
  await progress.note("speed-raise applied", { keys });
}

/** Poll the post-turn outcome markers for a bounded window; null on timeout (no throw). */
async function waitForOutcomeBounded(rig, from, timeoutMs) {
  const clients = Object.values(rig.clients);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (clients.every(client => client.evidence.find(REWARD_PHASE, from[client.label]))) {
      return { kind: "reward" };
    }
    for (const client of clients) {
      if (client.evidence.find(GUEST_FAINT_PICKER, from[client.label])) {
        return { kind: "faint", client };
      }
      if (client.label === rig.config.faintOwnerSeat && client.evidence.find(HOST_SWITCH_PHASE, from[client.label])) {
        return { kind: "faint", client };
      }
    }
    if (clients.every(client => client.evidence.find(LOCAL_COMMAND, from[client.label]))) {
      return { kind: "command" };
    }
    await delay(100);
  }
  return null;
}

/** Drive one battle wave to its reward shop: attack-first per turn, one fallback cycle, faints handled. */
async function driveBattleWave(rig, policy, stats) {
  const clients = Object.values(rig.clients);
  let cursors = fromEach(clients, client => client.evidence.findLast(LOCAL_COMMAND)?.index ?? 0);
  const fallbackWindow = Math.min(rig.config.timeoutMs, 15_000);
  for (let turn = 1; turn <= rig.config.maxTurns; turn++) {
    await Promise.all(clients.map(client => client.waitForLocalCommand(cursors[client.label])));
    stats.turns = turn;
    await Promise.all(clients.map(client => client.checkpoint(`wave-${stats.wave}-turn-${turn}-command`)));
    const from = fromEach(clients, client => client.evidence.cursor());
    await Promise.all(
      clients.map(client => client.sequence(policy.keys.battle, `wave-${stats.wave}-turn-${turn}-attack-first`)),
    );
    let outcome = await waitForOutcomeBounded(rig, from, fallbackWindow);
    if (!outcome) {
      // Attack-first did not resolve the turn (no PP / disabled / wrong target). Cycle to
      // the next move and let the full-budget outcome wait surface a genuine stall.
      stats.fallbackTurns += 1;
      await Promise.all(
        clients.map(client => client.sequence(policy.keys.battleFallback, `wave-${stats.wave}-turn-${turn}-fallback`)),
      );
      outcome = await rig.waitForPostTurnOutcome(from);
    }
    if (outcome.kind === "reward") {
      await rig.assertSharedSurface("reward", from, `wave-${stats.wave}-turn-${turn}-reward`, {
        expectedWave: rig.activeBattleWave,
      });
      await rig.assertRetainedContinuation(from, `wave-${stats.wave}-turn-${turn}-reward`);
      return;
    }
    if (outcome.kind === "faint") {
      stats.faints += 1;
      await rig.driveReplacement(outcome.client);
    }
    if (outcome.kind === "command") {
      await rig.assertSharedSurface("command", from, `wave-${stats.wave}-turn-${turn}-next-command`, {
        expectedWave: rig.activeBattleWave,
      });
      await rig.assertRetainedContinuation(from, `wave-${stats.wave}-turn-${turn}-next-command`);
    }
    cursors = from;
  }
  throw new Error(`Wave ${stats.wave} did not reach rewards in ${rig.config.maxTurns} public command rounds`);
}

/** Find the OWNER client + the evidence event that identifies this appearance, or null. */
function resolveSurfaceOwner(rig, driver, cursors, handledIndex) {
  const clients = Object.values(rig.clients);
  const notYetHandled = (client, event) =>
    event != null && event.index > (handledIndex.get(`${driver.name}:${client.label}`) ?? -1);

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
        return { client: guest, markerEvent: presence.markerEvent, ownerClient: guest };
      }
    }
  }
  const owner = driver.owner.role ? rig[driver.owner.role] : null;
  if (!owner) {
    return null;
  }
  return { client: owner, markerEvent: presence.markerEvent };
}

/** Drive at most one pending between-wave surface. Returns the surface name driven, or null. */
async function driveOnePendingSurface(rig, dispatch, cursors, handledIndex, stats) {
  for (const driver of dispatch) {
    const resolved = resolveSurfaceOwner(rig, driver, cursors, handledIndex);
    if (!resolved) {
      continue;
    }
    const { client, markerEvent } = resolved;
    await client.checkpoint(`wave-${stats.wave}-${driver.name}-owner`);
    await client.sequence(driver.keys, `campaign-${driver.name}`);
    client.evidence.record("campaign-surface", { surface: driver.name, ownerSeat: client.label });
    stats.surfaces.push({ surface: driver.name, ownerSeat: client.label });
    // Mark this appearance handled on every client so the same marker index cannot re-fire.
    for (const c of Object.values(rig.clients)) {
      handledIndex.set(`${driver.name}:${c.label}`, markerEvent.index);
    }
    handledIndex.set(`${driver.name}:${client.label}`, markerEvent.index);
    return driver.name;
  }
  return null;
}

function latestStartPhase(clients) {
  let best = null;
  for (const client of clients) {
    const event = client.evidence.findLast(START_PHASE);
    if (event && (best == null || event.index > best.index || best.client !== client)) {
      const match = START_PHASE.exec(event.text ?? "");
      if (match) {
        best = { name: match[1], index: event.index, client };
      }
    }
  }
  return best;
}

function maxStartPhaseIndex(clients) {
  let max = -1;
  for (const client of clients) {
    const event = client.evidence.findLast(START_PHASE);
    if (event && event.index > max) {
      max = event.index;
    }
  }
  return max;
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
async function advanceToNextWaveCommand(rig, policy, waveOrdinal, stats) {
  const clients = Object.values(rig.clients);
  const dispatch = buildDispatchTable(policy);
  const handledIndex = new Map();
  const betweenCursors = fromEach(clients, client => client.evidence.cursor());
  const deadline = Date.now() + rig.config.timeoutMs * 3;
  let stallSince = 0;
  let lastPhaseProgress = maxStartPhaseIndex(clients);

  while (Date.now() < deadline) {
    if (
      clients.some(
        client =>
          client.evidence.find(SHARED_SESSION_TERMINAL, betweenCursors[client.label])
          || client.evidence.find(GAME_OVER_PHASE, betweenCursors[client.label]),
      )
    ) {
      return { status: "terminal" };
    }

    if (clients.every(client => client.evidence.find(LOCAL_COMMAND, betweenCursors[client.label]))) {
      await Promise.all(clients.map(client => client.waitForLocalCommand(betweenCursors[client.label])));
      const boundary = await rig.assertSharedSurface("command", betweenCursors, `wave-${waveOrdinal}-advance`, {
        allowAddressRepeat: true,
      });
      rig.activeBattleWave = boundary.wave;
      return { status: "continue" };
    }

    const drove = await driveOnePendingSurface(rig, dispatch, betweenCursors, handledIndex, stats);
    if (drove) {
      stallSince = 0;
      lastPhaseProgress = maxStartPhaseIndex(clients);
      continue;
    }

    const phaseIndex = maxStartPhaseIndex(clients);
    if (phaseIndex > lastPhaseProgress) {
      lastPhaseProgress = phaseIndex;
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
  throw new Error(
    `wave ${waveOrdinal}: clients never reached the next command surface before the between-wave deadline; `
      + `latest phase=${parked?.name ?? "unknown"}`,
  );
}

/** The 30-wave (default) co-op campaign, driven end to end through public UI only. */
export async function runCampaign(rig) {
  const policy = loadCampaignPolicy();
  const progress = new CampaignProgress(rig.config.artifactDir);
  const clients = Object.values(rig.clients);
  await progress.note("campaign start", { targetWaves: policy.targetWaves, rewardMode: policy.rewardMode });

  await rig.loginBoth();
  if (policy.raiseSpeed) {
    await raiseGameSpeed(rig, policy, progress);
  }
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun();

  let wavesCleared = 0;
  let status = "continue";
  try {
    for (let ordinal = 1; ordinal <= policy.targetWaves; ordinal++) {
      const waveNo = rig.activeBattleWave;
      const stats = { wave: waveNo, ordinal, turns: 0, faints: 0, fallbackTurns: 0, surfaces: [], autoFirst: [] };
      const startMs = Date.now();
      await driveBattleWave(rig, policy, stats);
      const advanced = await advanceToNextWaveCommand(rig, policy, ordinal, stats);
      status = advanced.status;
      wavesCleared += 1;
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
  } finally {
    await progress.summary({
      targetWaves: policy.targetWaves,
      wavesCleared,
      finalWave: rig.activeBattleWave,
      lastStatus: status,
      replacementCount: rig.replacementCount,
    });
    await progress.flush();
  }

  if (status === "terminal") {
    throw new Error(
      `Campaign shared session terminated after ${wavesCleared} cleared waves (target ${policy.targetWaves})`,
    );
  }
  if (wavesCleared < policy.targetWaves) {
    throw new Error(`Campaign reached ${wavesCleared} cleared waves; target was ${policy.targetWaves}`);
  }
}
