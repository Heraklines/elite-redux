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

const START_PHASE = /Start Phase (\w+)/u;
const GUEST_FAINT_PICKER = /guest own-faint picker OPEN/u;
const HOST_SWITCH_PHASE = /Start Phase SwitchPhase/u;
const TURN_PROGRESS = /Start Phase TurnStartPhase|host recorder: begin turn=/u;
const EXP_PHASE = /Start Phase ExpPhase/u;

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
    // Drive Title -> Settings -> Game Speed 10x -> back through the real menus. The sequence
    // itself resets the Title cursor to New Game; Settings is an overlay so TitlePhase does
    // not re-log, and a wrong sequence fails loudly at the subsequent pairing (which re-waits
    // Title). A trailing settle lets the last menu transition land before pairing.
    await client.sequence(keys, "raise-game-speed-to-10x");
    await delay(client.config.settleDelayMs);
    client.evidence.record("campaign-speed", { status: "applied", keys });
    await client.checkpoint("speed-raised");
  }
  await progress.note("speed-raise applied (Game Speed -> 10x via Settings UI)", { keys });
}

/** Clients whose submitted command has not yet opened the real turn/replay path. */
export function clientsAwaitingTurnProgress(rig, from) {
  return Object.values(rig.clients).filter(client => !client.evidence.find(TURN_PROGRESS, from[client.label] ?? 0));
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

/**
 * Public-input driver for the authority's repeated post-battle EXP messages.
 *
 * ExpPhase is one prompt per party member. It logs a fresh phase instance immediately before
 * opening the human-action message, so one exact marker authorizes one Space press. The renderer
 * remains in CoopReplayTurnPhase until all authority-side EXP phases finish and the retained turn
 * commit is published; it must never receive these presses.
 */
export function createPostBattleExpAdvancer(rig, from, stats, purpose) {
  const authority = rig.host;
  if (!authority) {
    throw new Error(`${purpose}: post-battle EXP advancement requires the authenticated public host`);
  }
  let cursor = from[authority.label] ?? 0;
  return async () => {
    const phaseEvent = authority.evidence.find(EXP_PHASE, cursor);
    if (!phaseEvent) {
      return false;
    }
    cursor = phaseEvent.index + 1;
    stats.postBattleExpPrompts += 1;
    authority.evidence.record("campaign-post-battle-advance", {
      phase: "ExpPhase",
      phaseEventIndex: phaseEvent.index,
      promptOrdinal: stats.postBattleExpPrompts,
      authoritySeat: authority.label,
    });
    await authority.press("Space", `${purpose}-exp-${stats.postBattleExpPrompts}`);
    return true;
  };
}

/** Poll the post-turn outcome markers for a bounded window; null on timeout (no throw). */
export async function waitForOutcomeBounded(
  rig,
  from,
  timeoutMs,
  { stopOnTurnProgress = false, advancePostBattleExp = null } = {},
) {
  const clients = Object.values(rig.clients);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
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
    if (stopOnTurnProgress && clientsAwaitingTurnProgress(rig, from).length === 0) {
      return { kind: "turn-progress" };
    }
    if (advancePostBattleExp && (await advancePostBattleExp())) {
      continue;
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
  let cursors = fromEach(clients, client => client.evidence.findLast(LOCAL_COMMAND)?.index ?? 0);
  const fallbackWindow = Math.min(rig.config.timeoutMs, 15_000);
  for (let turn = 1; turn <= rig.config.maxTurns; turn++) {
    await Promise.all(clients.map(client => client.waitForLocalCommand(cursors[client.label])));
    stats.turns = turn;
    await Promise.all(clients.map(client => client.checkpoint(`wave-${stats.wave}-turn-${turn}-command`)));
    const from = fromEach(clients, client => client.evidence.cursor());
    const purpose = `wave-${stats.wave}-turn-${turn}`;
    const advancePostBattleExp = createPostBattleExpAdvancer(rig, from, stats, purpose);
    await Promise.all(clients.map(client => client.sequence(policy.keys.battle, `${purpose}-attack-first`)));
    let outcome = await waitForOutcomeBounded(rig, from, fallbackWindow, { stopOnTurnProgress: true });
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
      outcome = await waitForOutcomeBounded(rig, from, rig.config.timeoutMs, { advancePostBattleExp });
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
      outcome = await waitForOutcomeBounded(rig, from, rig.config.timeoutMs, { advancePostBattleExp });
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
  throw new Error(`[campaign-softlock] wave ${stats.wave} did not reach rewards in ${rig.config.maxTurns} rounds`);
}

/**
 * The client that reports ITSELF as owner of `surfaceId` in the v2 semantic mirror
 * (ownerSeat === its own localSeat), or null. Evidence-derived ownership - never rig.host.
 */
function findSemanticOwnerClient(rig, surfaceId, cursors) {
  for (const client of Object.values(rig.clients)) {
    const event = client.evidence.findLastSemanticSurface(cursors[client.label] ?? 0, surfaceId);
    const observation = event?.observation;
    if (observation && observation.ownerSeat != null && observation.ownerSeat === observation.localSeat) {
      return client;
    }
  }
  return null;
}

/**
 * Find the OWNER client + the evidence event that identifies this appearance, or null.
 *
 * `strict` (every loud-fail run - gating + nightly; false only under the explicit
 * shakedown/auto-first ordering opt-in) forbids the role-default fallback: a surface that
 * declares a v2 semantic mirror (`v2SurfaceId`) but whose mirror never reports an owner is a
 * MISSING/MALFORMED marker, and drops the run loudly rather than silently assuming `rig.host`.
 */
function resolveSurfaceOwner(rig, driver, cursors, handledIndex, strict) {
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
  // Prefer the evidence-derived v2 owner (ownerSeat === localSeat) over any role assumption.
  if (driver.v2SurfaceId) {
    const v2Owner = findSemanticOwnerClient(rig, driver.v2SurfaceId, cursors);
    if (v2Owner) {
      return { client: v2Owner, markerEvent: presence.markerEvent };
    }
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
  if (strict && driver.v2SurfaceId) {
    throw new Error(
      `[campaign-owner-evidence] surface "${driver.name}" is up but its v2 semantic mirror `
        + `(${driver.v2SurfaceId}) never reported an owner (ownerSeat === localSeat); refusing to `
        + "assume the role default. Fix the surface's marker or run the explicit shakedown opt-in.",
    );
  }
  const owner = driver.owner.role ? rig[driver.owner.role] : null;
  if (!owner) {
    return null;
  }
  return { client: owner, markerEvent: presence.markerEvent };
}

/** Drive at most one pending between-wave surface. Returns the surface name driven, or null. */
async function driveOnePendingSurface(rig, dispatch, cursors, handledIndex, stats, strict) {
  for (const driver of dispatch) {
    const resolved = resolveSurfaceOwner(rig, driver, cursors, handledIndex, strict);
    if (!resolved) {
      continue;
    }
    const { client } = resolved;
    await client.checkpoint(`wave-${stats.wave}-${driver.name}-owner`);
    await client.sequence(driver.keys, `campaign-${driver.name}`);
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
  const deadline = Date.now() + rig.config.timeoutMs * 3;
  let stallSince = 0;
  let lastPhaseProgress = phaseProgressSignature(clients);

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

    if (clients.every(client => client.evidence.find(LOCAL_COMMAND, commandCursors[client.label]))) {
      await Promise.all(clients.map(client => client.waitForLocalCommand(commandCursors[client.label])));
      const boundary = await rig.assertSharedSurface("command", commandCursors, `wave-${waveOrdinal}-advance`, {
        allowAddressRepeat: true,
      });
      rig.activeBattleWave = boundary.wave;
      return { status: "continue" };
    }

    // Loud-fail (strict) unless the explicit shakedown/auto-first ordering opt-in is set: the same
    // gate that permits press-through of an unknown surface also permits the role-default fallback.
    const drove = await driveOnePendingSurface(rig, dispatch, surfaceCursors, handledIndex, stats, !policy.autoFirst);
    if (drove) {
      stallSince = 0;
      lastPhaseProgress = phaseProgressSignature(clients);
      continue;
    }

    const phaseSignature = phaseProgressSignature(clients);
    if (phaseSignature !== lastPhaseProgress) {
      lastPhaseProgress = phaseSignature;
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
  // Verify the layer-8 passive-digest fix did not disable ER innates (maintainer-directed invariant).
  assertInnatesLive(rig);
  await progress.note("innate-activation invariant checked at wave-1 command surface");

  let wavesCleared = 0;
  let status = "continue";
  try {
    for (let ordinal = 1; ordinal <= policy.targetWaves; ordinal++) {
      const waveNo = rig.activeBattleWave;
      const stats = {
        wave: waveNo,
        ordinal,
        turns: 0,
        faints: 0,
        fallbackTurns: 0,
        postBattleExpPrompts: 0,
        surfaces: [],
        autoFirst: [],
      };
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
    throw new Error(`Campaign reached ${wavesCleared} cleared waves; target was ${policy.targetWaves}`);
  }
}
