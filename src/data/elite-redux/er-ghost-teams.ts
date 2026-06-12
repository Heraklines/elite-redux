/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — cross-player "ghost team" trainers (#217).
//
// When a player finishes a run (especially a victory), their team is snapshotted
// and uploaded to a shared ghost-team API (a tiny free Cloudflare Worker; see
// workers/er-ghost-api/). In the endgame of *other* players' runs, a handful of
// these ghost trainers are spawned as a gauntlet — Ace 1 / Elite 3 / Hell 8.
//
// Backend wiring is optional: when VITE_GHOST_ENDPOINT is unset (e.g. a purely
// offline build) everything degrades to the player's own locally-stored winning
// teams, so the feature still works single-player. Never throws.
//
// NOTE: this module deliberately avoids importing `#system/pokemon-data` /
// `#field/pokemon` as VALUES — doing so roots the heavy pokemon→ability-archetype
// import chain prematurely (circular-init hazard). Like er-trainer-runtime-hook,
// it serialises/rebuilds team members by hand via lightweight fields.
//
// Spawn integration:
//   - BattleScene.handleNonFixedBattle  → spawns a ghost Trainer on ghost waves
//   - Trainer.genPartyMember            → applyErGhostOverride builds the team
//   - GameOverPhase.handleGameOver      → recordGhostTeamOnGameOver (capture/upload)
// =============================================================================

import { loggedInUser } from "#app/account";
import { globalScene } from "#app/global-scene";
import { bypassLogin } from "#constants/app-constants";
import { type ErDifficulty, getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { ghostWavesForCurrentRun, isErGhostChallengeActive, isErGhostWave } from "#data/elite-redux/er-ghost-waves";
import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { TrainerPartyTemplate } from "#data/trainers/trainer-party-template";
import { EggTier } from "#enums/egg-type";
import type { Nature } from "#enums/nature";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { TrainerSlot } from "#enums/trainer-slot";
import type { EnemyPokemon } from "#field/pokemon";
import type { Trainer } from "#field/trainer";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { PokemonMove } from "#moves/pokemon-move";
import { sessionIdKey } from "#utils/common";
import { getCookie } from "#utils/cookies";
import { loadLastTeam } from "#utils/data";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export { ghostWavesForCurrentRun, isErGhostWave };

/** A serialised party member — lightweight, JSON-safe, no class instances. */
interface GhostMember {
  speciesId: number;
  formIndex: number;
  abilityIndex: number;
  ivs: number[];
  nature: number;
  level: number;
  gender: number;
  shiny: boolean;
  variant: number;
  passive: boolean;
  moves: number[];
}

export interface GhostTeamSnapshot {
  /** Stable-ish id (seed + timestamp), used for de-duplication. */
  id: string;
  /** Display label for the ghost trainer (the uploader's name, best-effort). */
  trainerName: string;
  difficulty: ErDifficulty;
  waveReached: number;
  isVictory: boolean;
  timestamp: number;
  /** Up to 6 serialised members. */
  party: GhostMember[];
  /** The opponent that ended the run (trainer/rival/ghost name, or wild species). */
  opponentName?: string | undefined;
  /** The opponent's serialised party (for "who beat whom" + future rematches). */
  opponentParty?: GhostMember[] | undefined;
  /** ER (#384): the run's STARTER lines as ROOT species ids (usage tiers). */
  starters?: number[] | undefined;
  /** ER (#384): active challenges at run end, as [id, value] pairs. */
  challenges?: [number, number][] | undefined;
}

const MAX_PARTY = 6;
/** Local backlog of past runs kept per device (seeds the pool on first login). */
const LOCAL_STORE_CAP = 100;
/** Prefetch this many waves ahead of the run's FIRST ghost wave (#364). */
const PREFETCH_LEAD_WAVES = 15;
/**
 * A ghost team fielded at wave W may only come from a run that ended at most
 * this many waves past W — no endgame teams crushing players at wave 87.
 */
export const ER_GHOST_WAVE_WINDOW = 20;

// -----------------------------------------------------------------------------
// Pool integrity — hacked/impossible teams must never reach other players.
// -----------------------------------------------------------------------------
/**
 * Maintainer ban list: a snapshot containing ANY of these is excluded from the
 * ghost pool (a player was found injecting impossible teams; cost checks can't
 * distinguish hacks from legit mid-run catches, so these forms are banned
 * outright). Standalone ER-custom species ids — covers members recorded as
 * their own dex entry.
 */
const BANNED_GHOST_SPECIES_IDS: ReadonlySet<number> = new Set([
  ErSpeciesId.ETERNATUS_ETERNAMAX,
  ErSpeciesId.KARTANA_FALLEN,
  ErSpeciesId.KECLEONG,
  ErSpeciesId.VICTINI_PRIMAL,
  ErSpeciesId.YVELTAL_MEGA,
  ErSpeciesId.ZACIAN_CROWNED_SWORD,
  ErSpeciesId.DIALGA_ORIGIN,
  ErSpeciesId.PALKIA_ORIGIN,
  ErSpeciesId.CASCOON_PRIMAL,
  ErSpeciesId.CALYREX_SHADOW_RIDER,
  ErSpeciesId.DARKRAI_NIGHTMARE,
]);

/**
 * The same bans for members recorded as a FORM of a vanilla species (vanilla
 * battle forms like Eternamax/Crowned/Origin, and ER-injected forms like
 * Victini Primal / Mega Yveltal). Matched against the member's formKey.
 */
const BANNED_GHOST_FORMS: ReadonlyMap<number, RegExp> = new Map([
  [SpeciesId.ETERNATUS, /eternamax/],
  [SpeciesId.ZACIAN, /crowned/],
  [SpeciesId.CALYREX, /shadow/],
  [SpeciesId.DIALGA, /origin/],
  [SpeciesId.PALKIA, /origin/],
  [SpeciesId.YVELTAL, /mega/],
  [SpeciesId.VICTINI, /primal/],
  [SpeciesId.DARKRAI, /nightmare/],
  [SpeciesId.KARTANA, /fallen/],
  [SpeciesId.CASCOON, /primal/],
]);

function isBannedGhostMember(member: GhostMember): boolean {
  if (BANNED_GHOST_SPECIES_IDS.has(member.speciesId)) {
    return true;
  }
  const pattern = BANNED_GHOST_FORMS.get(member.speciesId);
  if (!pattern) {
    return false;
  }
  try {
    const formKey = getPokemonSpecies(member.speciesId)?.forms?.[member.formIndex]?.formKey ?? "";
    return pattern.test(formKey.toLowerCase());
  } catch {
    // Species data unavailable — keep the suspicious member out of the pool.
    return true;
  }
}

/**
 * Anti-hack heuristic (#371): a species LINE whose starter hatches only from a
 * LEGENDARY egg. One on a team is plausible (a lucky egg or a late catch);
 * two or more is the signature of injected/hacked saves, so such teams are
 * excluded from the ghost pool entirely.
 */
function isLegendaryEggLine(speciesId: number): boolean {
  try {
    const root = getPokemonSpecies(speciesId)?.getRootSpeciesId();
    return root !== undefined && speciesEggTiers[root] === EggTier.LEGENDARY;
  } catch {
    return false;
  }
}

/** True when every member of the snapshot's party is pool-legal. */
export function isErGhostTeamLegal(snapshot: GhostTeamSnapshot): boolean {
  try {
    if (snapshot.party.some(m => isBannedGhostMember(m))) {
      return false;
    }
    // #371: ban teams fielding 2+ mons from legendary-egg-only lines.
    return snapshot.party.filter(m => isLegendaryEggLine(m.speciesId)).length < 2;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Env + local storage helpers.
// -----------------------------------------------------------------------------
function endpoint(): string {
  return import.meta.env.VITE_GHOST_ENDPOINT ?? "";
}

/** The cloud save/account Worker base URL (run history lives there, per-account). */
function serverBase(): string {
  return import.meta.env.VITE_SERVER_URL ?? "";
}

/** Authenticated POST of one run to the shared pool. Returns false (never throws)
 * when offline / guest / unauthenticated, so callers can fall back. */
async function postRunToServer(snapshot: GhostTeamSnapshot): Promise<boolean> {
  const base = serverBase();
  const token = getCookie(sessionIdKey);
  if (bypassLogin || !base || !token || typeof fetch !== "function") {
    return false;
  }
  try {
    const res = await fetch(`${base}/savedata/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify(snapshot),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Sample winning runs from the shared pool (other players). Empty on any failure. */
async function sampleRunsFromServer(
  difficulty: ErDifficulty,
  count: number,
  minWave: number,
): Promise<GhostTeamSnapshot[]> {
  const base = serverBase();
  const token = getCookie(sessionIdKey);
  if (bypassLogin || !base || !token || typeof fetch !== "function") {
    return [];
  }
  try {
    const res = await fetch(
      `${base}/savedata/run/sample?difficulty=${encodeURIComponent(difficulty)}&count=${count}&minWave=${minWave}`,
      { method: "GET", headers: { Accept: "application/json", Authorization: token } },
    );
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    return (Array.isArray(data) ? data : (data?.teams ?? [])).filter(isValidSnapshot) as GhostTeamSnapshot[];
  } catch {
    return [];
  }
}

function localStoreKey(): string {
  return `er-ghost-teams_${loggedInUser?.username ?? "guest"}`;
}

function loadLocalGhostTeams(): GhostTeamSnapshot[] {
  try {
    const raw = localStorage.getItem(localStoreKey());
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GhostTeamSnapshot[]) : [];
  } catch {
    return [];
  }
}

function saveLocalGhostTeam(snapshot: GhostTeamSnapshot): void {
  try {
    const list = loadLocalGhostTeams().filter(s => s.id !== snapshot.id);
    list.push(snapshot);
    localStorage.setItem(localStoreKey(), JSON.stringify(list.slice(-LOCAL_STORE_CAP)));
  } catch {
    // Storage may be unavailable / full — non-fatal.
  }
}

// -----------------------------------------------------------------------------
// Capture + record.
// -----------------------------------------------------------------------------
function serializeMember(p: any): GhostMember {
  const ivs: number[] = Array.isArray(p?.ivs) ? p.ivs.slice(0, 6) : [];
  const moves: number[] = Array.isArray(p?.moveset)
    ? p.moveset.filter(Boolean).map((m: any) => m.moveId ?? m.move ?? 0)
    : [];
  return {
    speciesId: p?.species?.speciesId ?? 0,
    formIndex: p?.formIndex ?? 0,
    abilityIndex: p?.abilityIndex ?? 0,
    ivs,
    nature: p?.nature ?? 0,
    level: p?.level ?? 1,
    gender: p?.gender ?? -1,
    shiny: !!p?.shiny,
    variant: p?.variant ?? 0,
    passive: !!p?.passive,
    moves,
  };
}

/** Snapshot the current player party into a ghost team, or `null` if empty. */
export function captureGhostTeam(isVictory: boolean): GhostTeamSnapshot | null {
  const party = globalScene?.getPlayerParty?.() ?? [];
  if (party.length === 0) {
    return null;
  }
  const partyData = party.slice(0, MAX_PARTY).map(serializeMember);
  const waveReached = globalScene?.currentBattle?.waveIndex ?? 0;
  const { name: opponentName, party: opponentParty } = captureOpponent();
  return {
    id: `${globalScene?.seed ?? "seed"}-${Date.now()}`,
    trainerName: loggedInUser?.username ?? "Trainer",
    difficulty: getErDifficulty(),
    waveReached,
    isVictory,
    timestamp: Date.now(),
    party: partyData,
    opponentName,
    opponentParty,
    starters: captureRunStarterLines(),
    challenges: captureRunChallenges(),
  };
}

/**
 * ER (#384): the run's starter LINES as root species ids, for the usage-tier
 * stats. Source: the last-team store written at run start (the final party
 * can differ after catches). Best-effort - absent when unavailable.
 */
function captureRunStarterLines(): number[] | undefined {
  try {
    const team = loadLastTeam();
    if (!team?.length) {
      return undefined;
    }
    const roots = new Set<number>();
    for (const starter of team) {
      const species = getPokemonSpecies(starter.speciesId);
      const root = species?.getRootSpeciesId?.();
      if (typeof root === "number") {
        roots.add(root);
      }
    }
    return roots.size > 0 ? [...roots] : undefined;
  } catch {
    return undefined;
  }
}

/** ER (#384): the run's ACTIVE challenges as [id, value] pairs. */
function captureRunChallenges(): [number, number][] | undefined {
  try {
    const active = (globalScene?.gameMode?.challenges ?? []).filter(c => c.value !== 0).map(c => [c.id, c.value] as [number, number]);
    return active.length > 0 ? active : undefined;
  } catch {
    return undefined;
  }
}

/** Snapshot the enemy that ended the run: trainer/rival name + their party, or the
 * wild Pokémon's name. Best-effort and never throws. */
function captureOpponent(): { name?: string | undefined; party?: GhostMember[] | undefined } {
  try {
    const battle = globalScene?.currentBattle;
    const enemies = battle?.enemyParty ?? [];
    if (enemies.length === 0) {
      return {};
    }
    const party = enemies.slice(0, MAX_PARTY).map(serializeMember);
    const trainer = battle?.trainer;
    const name = trainer
      ? trainer.getName(TrainerSlot.TRAINER, true)
      : ((enemies[0] as { species?: { name?: string } })?.species?.name ?? undefined);
    return { name, party };
  } catch {
    // Opponent capture is non-essential; never let it break the game-over flow.
    return {};
  }
}

async function uploadGhostTeam(snapshot: GhostTeamSnapshot): Promise<boolean> {
  // Preferred: the authenticated shared run-history pool on the cloud Worker.
  if (await postRunToServer(snapshot)) {
    return true;
  }
  // Fallback: optional standalone ghost endpoint (legacy / guest builds).
  const url = endpoint();
  if (!url || typeof fetch !== "function") {
    return false;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Upload every locally-stored run-history snapshot to the shared pool. Called on
 * first-login import (#229) so an existing player's accumulated local history
 * seeds the cross-player ghost pool. Idempotent server-side (dedup by snapshot id).
 * Best-effort: never throws, no-op under guest mode. Returns the number attempted.
 */
export async function uploadLocalRunHistory(): Promise<number> {
  if (bypassLogin || typeof localStorage === "undefined") {
    return 0;
  }
  let attempted = 0;
  try {
    const seen = new Set<string>();
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("er-ghost-teams_")) {
        continue;
      }
      let list: unknown;
      try {
        list = JSON.parse(localStorage.getItem(key) ?? "[]");
      } catch {
        continue;
      }
      if (!Array.isArray(list)) {
        continue;
      }
      for (const snap of list) {
        if (!isValidSnapshot(snap) || seen.has(snap.id)) {
          continue;
        }
        seen.add(snap.id);
        attempted++;
        await postRunToServer(snap);
      }
    }
  } catch {
    // Seeding run history is best-effort; never let it break the import flow.
  }
  return attempted;
}

/**
 * Record the just-finished run as a ghost team: store it locally (so the player
 * always has a self-seeded pool) and upload it to the shared API when one is
 * configured. Only records victories or sufficiently deep runs. Never throws.
 */
export function recordGhostTeamOnGameOver(isVictory: boolean): void {
  try {
    // Record EVERY finished run — wins AND losses, at any wave — for the shared
    // run-history pool (#217 ghost teams + balancing data). captureGhostTeam bails
    // on an empty party, so a trivial wave-0 state is skipped automatically.
    const snapshot = captureGhostTeam(isVictory);
    if (!snapshot) {
      return;
    }
    saveLocalGhostTeam(snapshot);
    void uploadGhostTeam(snapshot);
  } catch {
    // Recording must never interfere with the game-over flow.
  }
}

// -----------------------------------------------------------------------------
// Fetch + prefetch for the endgame gauntlet.
// -----------------------------------------------------------------------------
let prefetched: GhostTeamSnapshot[] | null = null;
let prefetchStarted = false;
const usedGhostIds = new Set<string>();
const ghostByWave = new Map<number, GhostTeamSnapshot>();

function isValidSnapshot(s: unknown): s is GhostTeamSnapshot {
  return (
    !!s
    && typeof s === "object"
    && Array.isArray((s as GhostTeamSnapshot).party)
    && (s as GhostTeamSnapshot).party.length > 0
  );
}

async function fetchGhostTeams(difficulty: ErDifficulty, count: number, minWave: number): Promise<GhostTeamSnapshot[]> {
  // Preferred: the authenticated shared pool (other players' runs that got deep
  // enough — `minWave` keeps shallow runs out of late ghost waves).
  const fromServer = await sampleRunsFromServer(difficulty, count, minWave);
  if (fromServer.length > 0) {
    return fromServer;
  }
  const url = endpoint();
  if (url && typeof fetch === "function") {
    try {
      const sep = url.includes("?") ? "&" : "?";
      const res = await fetch(
        `${url}${sep}difficulty=${encodeURIComponent(difficulty)}&count=${count}&minWave=${minWave}`,
        { method: "GET", headers: { Accept: "application/json" } },
      );
      if (res.ok) {
        const data = await res.json();
        const list = (Array.isArray(data) ? data : (data?.teams ?? [])).filter(isValidSnapshot);
        if (list.length > 0) {
          return list as GhostTeamSnapshot[];
        }
      }
    } catch {
      // Fall through to the local pool.
    }
  }
  // Local fallback: the player's own stored teams that reached at least minWave
  // (prefer the right difficulty), most-recent first.
  const local = loadLocalGhostTeams().filter(s => isValidSnapshot(s) && s.waveReached >= minWave);
  const matched = local.filter(s => s.difficulty === difficulty);
  return (matched.length > 0 ? matched : local).slice().reverse();
}

/**
 * Kick off (once, lazily) pre-fetching enough ghost teams for the run's
 * difficulty. Safe to call every wave — it only fires once, around wave 150.
 */
export function maybePrefetchGhostTeams(waveIndex: number): void {
  if (prefetchStarted) {
    return;
  }
  // ER (#422): Ghost Trainers challenge - ghosts can appear from wave 1, so
  // prefetch a full batch immediately (floor 1). The pool endpoint filters by
  // DIFFICULTY, and a difficulty with few stored runs (Ace!) starved the
  // challenge into constant normal-trainer fallbacks - so under the challenge
  // we top up from the OTHER difficulties' pools too (current first, then the
  // deepest pools), de-duped by id.
  if (isErGhostChallengeActive()) {
    prefetchStarted = true;
    void (async () => {
      const collected: GhostTeamSnapshot[] = [];
      const order: ErDifficulty[] = [getErDifficulty(), "hell", "elite", "ace", "youngster"];
      const tried = new Set<string>();
      for (const diff of order) {
        if (tried.has(diff)) {
          continue;
        }
        tried.add(diff);
        try {
          collected.push(...(await fetchGhostTeams(diff, 20, 1)));
        } catch {
          // Per-difficulty fetch is best-effort.
        }
        if (collected.length >= 30) {
          break;
        }
      }
      const byId = new Map(collected.filter(isErGhostTeamLegal).map(t => [t.id, t] as const));
      prefetched = [...byId.values()];
    })().catch(() => {
      prefetched = [];
    });
    return;
  }
  const waves = ghostWavesForCurrentRun();
  if (waves.length === 0 || waveIndex < Math.min(...waves) - PREFETCH_LEAD_WAVES) {
    return;
  }
  prefetchStarted = true;
  // Pool floor = the earliest ghost wave; takeGhostForWave then assigns each
  // fetched team only to waves at/below how far that run actually reached.
  // Over-fetch (2x, capped at the worker's 20/request) so the per-wave
  // eligibility window (>= wave, <= wave + ER_GHOST_WAVE_WINDOW) still finds
  // matches for the early ghost waves.
  const minWave = Math.min(...waves);
  void fetchGhostTeams(getErDifficulty(), Math.min(20, waves.length * 2), minWave)
    .then(teams => {
      // Single choke point for pool integrity: hacked/banned teams are dropped
      // here no matter which source (server pool / legacy endpoint / local)
      // they came from.
      prefetched = teams.filter(isErGhostTeamLegal);
    })
    .catch(() => {
      prefetched = [];
    });
}

/**
 * The ghost team to field on `waveIndex`, or `null` if none is available yet.
 * Stable within a run: the same wave always yields the same ghost.
 */
export function takeGhostForWave(waveIndex: number, trainerWave = false): GhostTeamSnapshot | null {
  // ER (#422): with the Ghost Trainers challenge active, EVERY trainer wave
  // is a ghost wave (the caller says whether this wave fields a trainer).
  if (!isErGhostWave(waveIndex) && !(trainerWave && isErGhostChallengeActive())) {
    return null;
  }
  const existing = ghostByWave.get(waveIndex);
  if (existing) {
    return existing;
  }
  const pool = prefetched ?? [];
  // A run that ended at wave W can only be fielded at waves <= W (its team is
  // only proven viable up to where it died) AND at waves >= W - 20
  // (ER_GHOST_WAVE_WINDOW: an endgame team must not appear at an early ghost
  // wave where players aren't that strong yet). Prefer the shallowest
  // still-eligible team so deeper teams stay available for later ghost waves.
  // The ban filter runs again here as defense-in-depth (covers test-injected
  // pools and any stale prefetch).
  // ER (#422): the Ghost Trainers challenge needs ghosts on every trainer
  // wave, but the 20-wave fairness window stays PRIMARY (maintainer: never
  // field full endgame teams early). Only when a window comes up empty does
  // the search widen step by step (30/40/60 waves past the current wave) -
  // and a team taken from BEYOND the 20-wave window has its members DEVOLVED
  // on build (see applyErGhostOverride) so the player is not swept. If even
  // the widest window is empty, the wave falls back to a normal trainer.
  // Pool exhaustion recycles used teams (within the same windows) before
  // giving up. Scheduled ghost waves on normal runs keep the strict window.
  const challengeMode = isErGhostChallengeActive();
  const legal = pool.filter(s => isErGhostTeamLegal(s));
  const windows = challengeMode ? [ER_GHOST_WAVE_WINDOW, 30, 40, 60] : [ER_GHOST_WAVE_WINDOW];
  let next: GhostTeamSnapshot | undefined;
  for (const window of windows) {
    const eligible = legal.filter(s => s.waveReached >= waveIndex && s.waveReached <= waveIndex + window);
    const unused = eligible.filter(s => !usedGhostIds.has(s.id));
    next = (unused.length > 0 ? unused : challengeMode ? eligible : []).sort(
      (a, b) => a.waveReached - b.waveReached,
    )[0];
    if (next) {
      break;
    }
  }
  // ER (#422): challenge last resort - the pool is dominated by DEEP runs
  // (victories end at 200), so early waves can miss even the widest window
  // and the player kept meeting normal trainers in ghost mode. Take the
  // CLOSEST deeper team instead; applyErGhostOverride devolves its members
  // by overshoot (up to base form past 60 waves) and re-levels them to the
  // wave, so an endgame roster arrives as its early-game self.
  if (!next && challengeMode) {
    const anyDeeper = legal.filter(s => s.waveReached >= waveIndex);
    const unused = anyDeeper.filter(s => !usedGhostIds.has(s.id));
    next = (unused.length > 0 ? unused : anyDeeper).sort((a, b) => a.waveReached - b.waveReached)[0];
  }
  if (!next) {
    return null;
  }
  usedGhostIds.add(next.id);
  ghostByWave.set(waveIndex, next);
  return next;
}

/** Reset per-run ghost state (call on run start). */
export function resetErGhostRunState(): void {
  prefetched = null;
  prefetchStarted = false;
  usedGhostIds.clear();
  ghostByWave.clear();
}

/**
 * TEST HOOK (#350): inject a ready-made ghost pool so the full-run audit can
 * exercise the ghost-wave spawn path deterministically (no network/local pool).
 */
export function setPrefetchedGhostTeamsForTests(teams: GhostTeamSnapshot[]): void {
  prefetched = teams;
  prefetchStarted = true;
}

// -----------------------------------------------------------------------------
// Spawn — build a ghost Trainer + its team.
// -----------------------------------------------------------------------------
const GHOST_BY_TRAINER = new WeakMap<Trainer, GhostTeamSnapshot>();

/** Flag a freshly-built Trainer as a ghost, and size its party to the snapshot. */
export function markTrainerAsGhost(trainer: Trainer, snapshot: GhostTeamSnapshot): void {
  GHOST_BY_TRAINER.set(trainer, snapshot);
  const size = Math.min(snapshot.party.length, MAX_PARTY);
  // Shadow the instance method so getPartyLevels / genParty field exactly the
  // ghost's team size (the shared trainer config is left untouched).
  trainer.getPartyTemplate = () => new TrainerPartyTemplate(size, PartyMemberStrength.STRONGER);
  // ER (#363): the ghost battles a REAL player's team — show that player's
  // account name as the trainer's name ("Veteran <username>") instead of a
  // random NPC name. Skip the anonymous fallbacks so guests keep an NPC name.
  const uploader = snapshot.trainerName?.trim();
  if (uploader && uploader !== "Trainer" && uploader !== "guest") {
    trainer.name = uploader.slice(0, 16);
  }
  // ER (#365/#403): ghost battles get their own theme ("The Piano Before
  // Cynthia"). The track ships in the er-assets repo
  // (audio/bgm/battle_ghost_piano.mp3, served via the jsDelivr redirect -
  // zero Cloudflare quota); playBgm lazily loads unknown keys from
  // audio/bgm/<key>.mp3, so shadowing the getters is the whole wiring.
  // BOTH getters: getBattleBgm only serves the GEN-5 music preference -
  // the DEFAULT preference routes through getMixedBattleBgm, so most
  // players never heard the theme (#403 report).
  trainer.getBattleBgm = () => "battle_ghost_piano";
  trainer.getMixedBattleBgm = () => "battle_ghost_piano";
}

/** True if this trainer is an ER ghost battle. */
export function hasErGhostOverride(trainer: Trainer): boolean {
  return GHOST_BY_TRAINER.has(trainer);
}

/**
 * Build the ghost team's EnemyPokemon for `index` from the stored snapshot, or
 * `null` if this isn't a ghost trainer / the index is beyond the team. The mon
 * keeps its species/form/ability/IVs/nature/moveset but is re-levelled to the
 * wave's enemy level so it scales to the endgame. Mirrors buildErEnemyFromMember.
 */
export function applyErGhostOverride(trainer: Trainer, index: number): EnemyPokemon | null {
  const snapshot = GHOST_BY_TRAINER.get(trainer);
  if (!snapshot || index >= snapshot.party.length) {
    return null;
  }
  try {
    const member = snapshot.party[index];
    let species = getPokemonSpecies(member.speciesId);
    if (!species) {
      return null;
    }
    const battle = globalScene.currentBattle;
    // ER (#422): a team fielded from BEYOND the 20-wave fairness window
    // (challenge widening / last resort) gets its members devolved - one stage
    // for up to 20 waves of overshoot, two past that, all the way to the BASE
    // form past 60 - so a deep team's fully evolved mons don't sweep an
    // early-game player. Single-stagers stay.
    const overshoot = Math.max(0, snapshot.waveReached - ((battle?.waveIndex ?? snapshot.waveReached) + ER_GHOST_WAVE_WINDOW));
    let devolved = false;
    if (overshoot > 0) {
      const stages = overshoot > 60 ? 3 : overshoot > 20 ? 2 : 1;
      for (let i = 0; i < stages; i++) {
        const prevId = pokemonPrevolutions[species.speciesId as SpeciesId];
        const prev = prevId !== undefined ? getPokemonSpecies(prevId) : undefined;
        if (!prev) {
          break;
        }
        species = prev;
        devolved = true;
      }
    }
    const level = battle?.enemyLevels?.[index] ?? member.level;
    const trainerSlot = !trainer.isDouble() || !(index % 2) ? TrainerSlot.TRAINER : TrainerSlot.TRAINER_PARTNER;
    const enemy = globalScene.addEnemyPokemon(species, level, trainerSlot);
    if (member.formIndex >= 0 && !devolved && member.formIndex < (species.forms?.length ?? 0)) {
      enemy.formIndex = member.formIndex;
    }
    enemy.abilityIndex = member.abilityIndex;
    if (member.ivs.length === 6) {
      enemy.ivs = member.ivs.slice();
    }
    enemy.nature = member.nature as Nature;
    enemy.gender = member.gender;
    enemy.shiny = member.shiny;
    enemy.variant = member.variant;
    enemy.passive = member.passive;
    if (member.moves.length > 0 && !devolved) {
      const moves = member.moves.map(id => new PokemonMove(id));
      enemy.moveset = moves;
      enemy.summonData.moveset = moves;
    } else if (devolved) {
      // A devolved stage rolls its own level-appropriate moveset.
      enemy.generateAndPopulateMoveset();
    }
    enemy.generateName();
    return enemy;
  } catch {
    return null;
  }
}
