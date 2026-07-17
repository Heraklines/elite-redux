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

import { erGauntletActive, erGauntletWaveKind } from "#data/elite-redux/er-mystery-gauntlet";
import { loggedInUser } from "#app/account";
import { globalScene } from "#app/global-scene";
import { bypassLogin } from "#constants/app-constants";
import { ER_GHOST_WAVE_WINDOW } from "#data/elite-redux/er-ghost-constants";
import { type ErDifficulty, getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { ghostWavesForCurrentRun, isErGhostChallengeActive, isErGhostWave } from "#data/elite-redux/er-ghost-waves";
import {
  type GhostDialogueContext,
  type GhostTrainerProfile,
  resolveGhostDialogue,
  sanitizeGhostProfile,
} from "#data/elite-redux/er-ghost-profile";
import {
  decodeErShinyLabLoadout,
  decodeErShinyLabParams,
  encodeErShinyLabPreset,
  type ErShinyLabCategory,
  type ErShinyLabSavedLook,
  getErShinyLabOwnedSet,
  isErShinyLabNameFxUnlocked,
  normalizeErShinyLabSavedLook,
  sanitizeErShinyLabLoadout,
  sanitizeErShinyLabPresetName,
} from "#data/elite-redux/er-shiny-lab-effects";
import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesEggTiers } from "#balance/species-egg-tiers";
import { TrainerPartyTemplate } from "#data/trainers/trainer-party-template";
import { EggTier } from "#enums/egg-type";
import type { Nature } from "#enums/nature";
import { ErRelicModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { TrainerSlot } from "#enums/trainer-slot";
import type { EnemyPokemon } from "#field/pokemon";
import type { Trainer } from "#field/trainer";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { PokemonMove } from "#moves/pokemon-move";
import type { Variant } from "#sprites/variant";
import { sessionIdKey } from "#utils/common";
import { getCookie } from "#utils/cookies";
import { loadLastTeam } from "#utils/data";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export { ghostWavesForCurrentRun, isErGhostWave };

/** A serialised party member — lightweight, JSON-safe, no class instances. */
export interface GhostMember {
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
  /** ER (Graveyard ME): the items this member was holding, as
   * [modifierTypeId, stackCount] pairs. Omitted when none / for legacy
   * snapshots captured before item recording (those fall back to a random
   * Ultra-tier item or berry when a memento is granted). */
  heldItems?: [string, number][] | undefined;
  /**
   * ER Shiny Lab: compact equipped look for cross-player ghosts. The viewer
   * clamps every id before applying so malformed snapshots become plain.
   */
  erShinyLab?: ErShinyLabSavedLook | undefined;
  /**
   * ER Shiny Lab: the owner's equipped preset NAME, shown as a prefix on the ghost's
   * name for other players (e.g. "Glittering Rayquaza"). Omitted when unnamed.
   */
  erShinyLabName?: string | undefined;
}

export interface GhostTeamSnapshot {
  /** Stable-ish id (seed + timestamp), used for de-duplication. */
  id: string;
  /** Display label for the ghost trainer (the uploader's name, best-effort). */
  trainerName: string;
  difficulty: ErDifficulty;
  /**
   * The game mode this run was played in ("classic" / "challenge"; endless/daily are
   * never captured). Lets the shared pool reject endless contamination - an endless
   * team can be hundreds of waves deep with absurd kits, which has no business being
   * fielded as a ghost in a classic run. Optional for back-compat with old snapshots.
   */
  mode?: string | undefined;
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
  /**
   * ER (relics): the run's active ER relics at capture, as [kind, stackCount, chosenWeather]
   * snapshots. RECORDS-ONLY - persisted to the `runs.relics` blob for analytics. Relics are
   * the uploader's own run buffs and are NEVER reconstructed or applied to the fielded ghost.
   */
  relics?: [string, number, number | null][] | undefined;
  /** ER (Colosseum): true when a GHOST trainer dealt the run-ending defeat -
   * the deadliest-ghost leaderboard counts these. Only set on a loss. */
  killedByGhost?: boolean | undefined;
  /** Source player's name for the killer ghost (when killedByGhost). */
  ghostSourceName?: string | undefined;
  /** The killer ghost's source winning-run id (joins back to its exact team). */
  ghostSourceRunId?: string | undefined;
  /**
   * ER Ghost Trainer Editor: the uploader's authored presentation (sprite/name/
   * title/dialogue/FX) at publish time. Absent -> the legacy random-class ghost.
   * Carried verbatim through the worker `runs.presentation` blob; ALWAYS re-run
   * through sanitizeGhostProfile before applying (it arrives from an untrusted peer).
   */
  presentation?: GhostTrainerProfile | undefined;
}

const MAX_PARTY = 6;
/** Local backlog of past runs kept per device (seeds the pool on first login). */
const LOCAL_STORE_CAP = 100;
/** Prefetch this many waves ahead of the run's FIRST ghost wave (#364). */
const PREFETCH_LEAD_WAVES = 15;
/**
 * A ghost team fielded at wave W is preferentially drawn from a run that ended
 * within this many waves of W. Widened 20 -> 40 (#422 follow-up): the high ghost
 * waves (137/163) have only a thin band of runs that ended right there, so a tight
 * 20-wave band missed them constantly and the challenge fell through to fielding a
 * far-deeper team that had to be devolved. A 40-wave band finds a wave-appropriate
 * team far more often.
 */
export { ER_GHOST_WAVE_WINDOW } from "#data/elite-redux/er-ghost-constants";

/**
 * At/after this wave a ghost drawn from a deeper run must NOT be devolved - it is only
 * re-levelled down to the wave (see applyErGhostOverride). By ~wave 50 the player is
 * already strong (level ~50, an evolved roster), so the fairness devolve was
 * over-correcting and fielding BABY teams where it shouldn't - and every scheduled ghost
 * wave (hell starts 63, elite 87) is past this, so they all stay fully evolved. Below it,
 * only the Ghost Trainers CHALLENGE reaches such early trainer waves, where the fairness
 * devolve still applies so an endgame roster can't sweep a wave-5 lead. Lowered 100 -> 50
 * (maintainer): un-evolved ghost teams from ~wave 50 on were the "baby Pokemon at high
 * waves" reports.
 */
export const ER_GHOST_NO_DEVOLVE_WAVE = 50;

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
    // biome-ignore lint/suspicious/noConsole: live diagnostic (#422) - reveals WHY the shared pool was skipped
    console.warn(`[er-ghost] server sample skipped (bypassLogin=${bypassLogin}, base=${!!base}, token=${!!token})`);
    return [];
  }
  try {
    const res = await fetch(
      `${base}/savedata/run/sample?difficulty=${encodeURIComponent(difficulty)}&count=${count}&minWave=${minWave}`,
      { method: "GET", headers: { Accept: "application/json", Authorization: token } },
    );
    if (!res.ok) {
      // biome-ignore lint/suspicious/noConsole: live diagnostic (#422)
      console.warn(`[er-ghost] server sample HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (Array.isArray(data) ? data : (data?.teams ?? [])).filter(isValidSnapshot) as GhostTeamSnapshot[];
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: live diagnostic (#422)
    console.warn("[er-ghost] server sample fetch failed:", err);
    return [];
  }
}

/**
 * Fetch the "deadliest" ghost team(s) - the ones whose ghost trainers ended the
 * most other players' runs - from the shared pool, ranked by kill count. Pass
 * "any" to rank across all difficulties. Returns [] on any failure (offline /
 * guest / sparse pool) so callers fall back to a strong waveReached ghost.
 * Used for the ER Colosseum's climactic final challenger (#439).
 */
export async function fetchDeadliestGhosts(
  difficulty: ErDifficulty | "any",
  count = 1,
  minWave = 0,
): Promise<GhostTeamSnapshot[]> {
  const base = serverBase();
  const token = getCookie(sessionIdKey);
  if (bypassLogin || !base || !token || typeof fetch !== "function") {
    return [];
  }
  try {
    const res = await fetch(
      `${base}/savedata/run/deadliest?difficulty=${encodeURIComponent(difficulty)}&count=${count}&minWave=${minWave}`,
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

/**
 * Sample legal ghost-team snapshots from the shared pool (server first, local
 * fallback), de-duplicated. Not wave-gated like takeGhostForWave - for callers
 * (e.g. the Colosseum gauntlet, #439) that want a batch of ghosts on demand and
 * will filter / re-level them themselves. Empty on any failure.
 */
export async function sampleGhostSnapshots(
  difficulty: ErDifficulty,
  count = 8,
  minWave = 0,
): Promise<GhostTeamSnapshot[]> {
  let pool = await sampleRunsFromServer(difficulty, count, minWave);
  if (pool.length < count) {
    const local = loadLocalGhostTeams().filter(s => !minWave || s.waveReached >= minWave);
    pool = [...pool, ...local];
  }
  const seen = new Set<string>();
  const out: GhostTeamSnapshot[] = [];
  for (const s of pool) {
    if (s && !seen.has(s.id) && isErGhostTeamLegal(s)) {
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
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

/**
 * DEV-ONLY: plant one realistic, NAMED ghost grave into local storage so the
 * Graves of the Fallen test scenario always has a real epitaph (name / difficulty
 * / wave / killer) and real held-item mementos to show - even when the
 * cross-player pool is empty on the test environment (which otherwise falls back
 * to the anonymous synthetic legacy grave). Idempotent via a fixed id, so
 * re-running the scenario never stacks duplicates. Only the dev test suite calls
 * this; no production path references it.
 */
export function seedDevGhostGrave(): void {
  const member = (speciesId: number, level: number, heldItems: [string, number][] = []): GhostMember => ({
    speciesId,
    formIndex: 0,
    abilityIndex: 0,
    ivs: [31, 31, 31, 31, 31, 31],
    nature: 0,
    level,
    gender: -1,
    shiny: false,
    variant: 0,
    passive: true,
    moves: [],
    heldItems,
  });
  saveLocalGhostTeam({
    id: "dev-grave-fixed",
    trainerName: "Veteran Lance",
    difficulty: "hell",
    waveReached: 147,
    isVictory: false,
    timestamp: 0,
    party: [
      member(445 /* Garchomp */, 95, [["LEFTOVERS", 1]]),
      member(248 /* Tyranitar */, 95, [["WIDE_LENS", 1]]),
      member(149 /* Dragonite */, 95, [["WIDE_LENS", 1]]),
    ],
    opponentName: "Champion Cynthia",
  });
}

// -----------------------------------------------------------------------------
// Capture + record.
// -----------------------------------------------------------------------------
function serializeMember(p: any, isPlayer = true): GhostMember {
  const ivs: number[] = Array.isArray(p?.ivs) ? p.ivs.slice(0, 6) : [];
  const moves: number[] = Array.isArray(p?.moveset)
    ? p.moveset.filter(Boolean).map((m: any) => m.moveId ?? m.move ?? 0)
    : [];
  const heldItems = serializeHeldItems(p, isPlayer);
  const erShinyLab = serializeShinyLabLook(p);
  const erShinyLabName = serializeShinyLabName(p);
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
    ...(heldItems.length > 0 ? { heldItems } : {}),
    ...(erShinyLab ? { erShinyLab } : {}),
    ...(erShinyLabName ? { erShinyLabName } : {}),
  };
}

/**
 * The owner's equipped Shiny Lab preset NAME for a member, or undefined. Mirrors
 * {@linkcode serializeShinyLabLook}: a carried name wins, else the species' equipped name -
 * but only when a look is actually equipped, so a stale name never travels onto a bare shiny.
 */
function serializeShinyLabName(p: any): string | undefined {
  const carried = sanitizeErShinyLabPresetName(p?.customPokemonData?.erShinyLabName);
  if (carried) {
    return carried;
  }
  if (!p?.shiny) {
    return undefined;
  }
  const speciesId = p?.species?.speciesId;
  if (typeof speciesId !== "number") {
    return undefined;
  }
  const name = sanitizeErShinyLabPresetName(globalScene.gameData?.getStarterDataEntry(speciesId)?.erShinyLab?.ln);
  return name && serializeShinyLabLook(p) ? name : undefined;
}

function serializeShinyLabLook(p: any): ErShinyLabSavedLook | undefined {
  const carried = normalizeErShinyLabSavedLook(p?.customPokemonData?.erShinyLab);
  if (carried) {
    return carried;
  }
  if (!p?.shiny) {
    return undefined;
  }
  const speciesId = p?.species?.speciesId;
  if (typeof speciesId !== "number") {
    return undefined;
  }
  const save = globalScene.gameData?.getStarterDataEntry(speciesId)?.erShinyLab;
  if (!save) {
    return undefined;
  }
  const owned: Record<ErShinyLabCategory, Set<string>> = {
    palette: getErShinyLabOwnedSet(save, "palette"),
    surface: getErShinyLabOwnedSet(save, "surface"),
    around: getErShinyLabOwnedSet(save, "around"),
  };
  const loadout = sanitizeErShinyLabLoadout(decodeErShinyLabLoadout(save.l), owned);
  if (!loadout.palette && !loadout.surface && !loadout.around) {
    return undefined;
  }
  const params = decodeErShinyLabParams(save.q);
  params.nameFx = params.nameFx && isErShinyLabNameFxUnlocked(save);
  return normalizeErShinyLabSavedLook(encodeErShinyLabPreset({ loadout, params }));
}

/** Serialise a member's held items as [modifierTypeId, stackCount] pairs, or [] when
 * none. Best-effort and never throws - item data is non-essential to the snapshot. */
function serializeHeldItems(p: any, isPlayer: boolean): [string, number][] {
  try {
    const id = p?.id;
    if (id == null) {
      return [];
    }
    return globalScene
      .findModifiers(m => m instanceof PokemonHeldItemModifier && m.pokemonId === id, isPlayer)
      .map(m => [(m as PokemonHeldItemModifier).type.id, (m as PokemonHeldItemModifier).getStackCount()] as [string, number])
      .filter(([typeId]) => !!typeId);
  } catch {
    return [];
  }
}

/** Serialise the run's active ER relics as [kind, stackCount, chosenWeather] snapshots.
 * RECORDS-ONLY: persisted for analytics; NEVER reconstructed or applied to a fielded ghost
 * (markTrainerAsGhost ignores this field entirely). Best-effort and never throws. */
function serializeRelics(): [string, number, number | null][] {
  try {
    return globalScene
      .findModifiers(m => m instanceof ErRelicModifier)
      .map(m => {
        const r = m as ErRelicModifier;
        return [String(r.kind), r.getStackCount(), r.chosenWeather ?? null] as [string, number, number | null];
      });
  } catch {
    return [];
  }
}

/** Snapshot the current player party into a ghost team, or `null` if empty. */
export function captureGhostTeam(isVictory: boolean): GhostTeamSnapshot | null {
  // Co-op (#633, P6): a co-op run's party is a MERGED two-player team (each player
  // brought up to 3 mons), not a single solo team. It must NOT seed the solo ghost
  // pool, which other players face one-vs-one. Exclude co-op runs entirely.
  if (globalScene?.gameMode?.isCoop) {
    return null;
  }
  // Endless/daily runs must NEVER seed the ghost pool. Endless reaches hundreds of
  // waves with over-levelled, over-itemed teams; fielding one as a ghost in a classic
  // run is the "endless contamination" bug. Daily is a separate, throwaway mode. Only
  // classic / classic-challenge teams are valid ghosts. (The worker /sample query
  // ALSO filters these, so already-uploaded endless rows are excluded server-side.)
  if (globalScene?.gameMode?.isEndless || globalScene?.gameMode?.isDaily) {
    return null;
  }
  const party = globalScene?.getPlayerParty?.() ?? [];
  if (party.length === 0) {
    return null;
  }
  const partyData = party.slice(0, MAX_PARTY).map(m => serializeMember(m));
  const waveReached = globalScene?.currentBattle?.waveIndex ?? 0;
  const { name: opponentName, party: opponentParty } = captureOpponent();
  // ER (Colosseum): if THIS defeat was dealt by a fielded ghost, record who it
  // was (and which winning run it came from) so the deadliest-ghost board is
  // exact - the rendered opponent name alone is ambiguous (NPC/wild collisions).
  const killerTrainer = globalScene?.currentBattle?.trainer;
  const killerGhost = !isVictory && killerTrainer ? GHOST_BY_TRAINER.get(killerTrainer) : undefined;
  return {
    id: `${globalScene?.seed ?? "seed"}-${Date.now()}`,
    trainerName: loggedInUser?.username ?? "Trainer",
    difficulty: getErDifficulty(),
    // Only classic / classic-challenge reach here (endless + daily bailed above).
    mode: globalScene?.gameMode?.isChallenge ? "challenge" : "classic",
    waveReached,
    isVictory,
    timestamp: Date.now(),
    party: partyData,
    opponentName,
    opponentParty,
    starters: captureRunStarterLines(),
    challenges: captureRunChallenges(),
    // ER (relics): records-only snapshot of the run's relics; persisted to runs.relics
    // for analytics. NEVER applied to the fielded ghost (markTrainerAsGhost ignores it).
    relics: serializeRelics(),
    killedByGhost: killerGhost != null || undefined,
    ghostSourceName: killerGhost?.trainerName,
    ghostSourceRunId: killerGhost?.id,
    // ER Ghost Trainer Editor: attach the player's authored presentation so other
    // players see their chosen sprite/name/dialogue. Sanitised at capture; absent
    // when the player never opened the editor (legacy random-class ghost).
    presentation: sanitizeGhostProfile(globalScene?.gameData?.ghostProfile) ?? undefined,
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
    const party = enemies.slice(0, MAX_PARTY).map(e => serializeMember(e, false));
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

// =============================================================================
// Co-op ghost-pool sync (#633). The ghost POOL is fetched per-client from the shared
// server pool, so the two clients otherwise download DIFFERENT teams and field
// divergent ghost trainers (high-wave desync). Fix: the HOST broadcasts its fetched
// pool, the GUEST adopts it verbatim + skips its own fetch, so `takeGhostForWave`'s
// seeded pick is deterministic on both. Wired via CALLBACKS (set from coop-runtime)
// so this module stays free of coop value-imports (circular-init hazard, see header).
// All hooks are gated on the LIVE role by the registrar, so role reconciliation is safe.
// =============================================================================

/** Co-op GUEST: when this returns true, skip the local server fetch (use the host's pool). */
let coopGhostFetchSuppressed: (() => boolean) | null = null;
/** Co-op HOST: fired whenever `prefetched` is (re)published, to broadcast it to the guest. */
let onGhostPoolPublished: ((pool: GhostTeamSnapshot[]) => void) | null = null;

/** Register the co-op guest fetch-suppression predicate (null = solo / clear). */
export function setCoopGhostFetchSuppressed(predicate: (() => boolean) | null): void {
  coopGhostFetchSuppressed = predicate;
}

/** Register the co-op host ghost-pool broadcast hook (null = solo / clear). */
export function setGhostPoolPublisher(cb: ((pool: GhostTeamSnapshot[]) => void) | null): void {
  onGhostPoolPublished = cb;
}

/**
 * Co-op GUEST: adopt the host's authoritative ghost pool verbatim (#633). Ignored once
 * picking has started (`ghostByWave` non-empty) - a late pool swap would corrupt the
 * deterministic pick sequence; the host broadcasts eagerly on prefetch-resolve so the
 * pool is virtually always present before the first ghost pick. Order is preserved
 * (no re-sort) so `pickGhost`'s seeded index lands on the same team as the host.
 */
export function setCoopGhostPool(pool: GhostTeamSnapshot[]): void {
  if (ghostByWave.size > 0) {
    return;
  }
  prefetched = pool.filter(isErGhostTeamLegal);
  prefetchStarted = true;
}

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
  // Co-op GUEST (#633): never fetch from the server; the host broadcasts its
  // authoritative pool and the guest adopts it (setCoopGhostPool), so both clients'
  // seeded ghost picks are identical. Mark started so the lazy fetch never fires.
  if (coopGhostFetchSuppressed?.()) {
    prefetchStarted = true;
    return;
  }
  // ER (#422): Ghost Trainers challenge - ghosts can appear from wave 1, so
  // prefetch a full batch immediately (floor 1). The pool endpoint filters by
  // DIFFICULTY, and a difficulty with few stored runs (Ace!) starved the
  // challenge into constant normal-trainer fallbacks - so under the challenge
  // we top up from the OTHER difficulties' pools too (current first, then the
  // deepest pools), de-duped by id.
  // Mystery Gauntlet uses its fixed scripted carrier and must not depend on an external fetch.
  const immediateGhostPool = isErGhostChallengeActive();
  if (immediateGhostPool) {
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
          const batch = await fetchGhostTeams(diff, 20, 1);
          collected.push(...batch);
          // biome-ignore lint/suspicious/noConsole: live diagnostic (#422) - lands in Send Logs captures
          console.log(`[er-ghost] challenge prefetch: +${batch.length} from '${diff}' pool`);
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: live diagnostic (#422)
          console.warn(`[er-ghost] challenge prefetch '${diff}' failed:`, err);
        }
        // Publish INCREMENTALLY: the old code assigned the pool only after
        // ALL (up to 5 sequential) fetches finished, so the first trainer
        // waves raced several network round-trips against an empty pool.
        const byId = new Map(collected.filter(isErGhostTeamLegal).map(t => [t.id, t] as const));
        // Cap teams per UPLOADER (3): one prolific early-dying tester can
        // otherwise own most of the sampled pool and appear every wave.
        const perUploader = new Map<string, number>();
        prefetched = [...byId.values()].filter(t => {
          const k = t.trainerName ?? "";
          const n = perUploader.get(k) ?? 0;
          if (n >= 3) {
            return false;
          }
          perUploader.set(k, n + 1);
          return true;
        });
        // Co-op HOST (#633): broadcast the (incrementally grown) pool so the guest
        // adopts the SAME teams - no-op solo / on the guest.
        onGhostPoolPublished?.(prefetched);
        if (collected.length >= 30) {
          break;
        }
      }
      // biome-ignore lint/suspicious/noConsole: live diagnostic (#422)
      console.log(`[er-ghost] challenge pool ready: ${prefetched?.length ?? 0} team(s) of ${collected.length} fetched`);
      if (!prefetched || prefetched.length === 0) {
        // EVERY source came back empty (auth token not ready at wave 1, a
        // network blip, ...). The old code left the pool empty for the WHOLE
        // run - every trainer stayed a normal trainer. Allow a retry on a
        // later wave instead.
        // biome-ignore lint/suspicious/noConsole: live diagnostic (#422)
        console.warn("[er-ghost] challenge pool EMPTY after prefetch - retrying next wave");
        prefetchStarted = false;
      }
    })().catch(err => {
      // biome-ignore lint/suspicious/noConsole: live diagnostic (#422)
      console.warn("[er-ghost] challenge prefetch crashed - retrying next wave:", err);
      prefetched = prefetched ?? [];
      prefetchStarted = false;
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
      // Co-op HOST (#633): broadcast the authoritative pool to the guest (~15 waves
      // ahead of the first ghost wave) so its seeded pick is deterministic. No-op
      // solo / on the guest.
      onGhostPoolPublished?.(prefetched);
    })
    .catch(() => {
      prefetched = [];
    });
}

/** The uploader of the most recently fielded ghost - the picker avoids
 * fielding the same player twice in a row when alternatives exist (#422). */
let lastGhostUploader: string | null = null;

/**
 * Seeded-random pick among candidate snapshots, preferring an uploader other
 * than the previous ghost's. Deterministic per (run seed, wave) so reloading
 * the same wave fields the same ghost - but DIFFERENT waves and different
 * runs spread across the pool. Replaces the old shallowest-first sort, which
 * deterministically handed every early wave to whichever single player owned
 * the shallow end of the sample ("why is it always Arctic Flame?").
 */
function pickGhost(candidates: GhostTeamSnapshot[], waveIndex: number): GhostTeamSnapshot | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  const fresh = candidates.filter(s => (s.trainerName ?? "") !== lastGhostUploader);
  const pool = fresh.length > 0 ? fresh : candidates;
  const key = `${globalScene.seed}:ghostpick:${waveIndex}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return pool[h % pool.length];
}

/** Fixed carrier for the staging-only Mystery schedule; deliberately independent of network/account pools. */
function mysteryGauntletGhost(): GhostTeamSnapshot {
  const member = (speciesId: number): GhostMember => ({
    speciesId,
    formIndex: 0,
    abilityIndex: 0,
    ivs: [20, 20, 20, 20, 20, 20],
    nature: 0,
    level: 7,
    gender: -1,
    shiny: false,
    variant: 0,
    passive: false,
    moves: [],
  });
  return {
    id: "mystery-gauntlet-scripted-v1",
    trainerName: "Mystery Challenger",
    difficulty: "mystery",
    mode: "classic",
    waveReached: 7,
    isVictory: false,
    timestamp: 0,
    party: [member(SpeciesId.RATTATA), member(SpeciesId.PIDGEY), member(SpeciesId.CATERPIE)],
  };
}

/**
 * The ghost team to field on `waveIndex`, or `null` if none is available yet.
 * Stable within a run: the same wave always yields the same ghost.
 */
export function takeGhostForWave(waveIndex: number, trainerWave = false): GhostTeamSnapshot | null {
  // ER (#422): with the Ghost Trainers challenge active, EVERY trainer wave
  // is a ghost wave (the caller says whether this wave fields a trainer).
  // MYSTERY GAUNTLET (#814): the scripted ghost wave always fields a ghost when one
  // is available, regardless of the endgame wave table or the challenge.
  const gauntletGhost = erGauntletActive() && erGauntletWaveKind(waveIndex) === "ghost";
  if (!gauntletGhost && !isErGhostWave(waveIndex) && !(trainerWave && isErGhostChallengeActive())) {
    if (trainerWave && ghostByWave.size > 0) {
      // Tripwire for the live "silent wave miss" reports: a ghost was already
      // fielded THIS RUN (so it must be a challenge run), yet the challenge
      // read came back false for this trainer wave. Should be impossible -
      // if this ever prints, the gameMode/challenge state mutated mid-run.
      // biome-ignore lint/suspicious/noConsole: live diagnostic (#422)
      console.warn(
        `[er-ghost] wave ${waveIndex}: trainer wave SKIPPED - challenge read false (ghosts already taken: ${ghostByWave.size})`,
      );
    }
    return null;
  }
  const existing = ghostByWave.get(waveIndex);
  if (existing) {
    // biome-ignore lint/suspicious/noConsole: live diagnostic (#422)
    console.log(`[er-ghost] wave ${waveIndex}: reusing cached ghost '${existing.trainerName}'`);
    return existing;
  }
  if (gauntletGhost) {
    // This is a deterministic test fixture, not a sampled-player feature. Always use the same
    // carrier so asymmetric fetch timing cannot make two real browsers cache different trainers.
    const scripted = mysteryGauntletGhost();
    usedGhostIds.add(scripted.id);
    lastGhostUploader = scripted.trainerName ?? "";
    ghostByWave.set(waveIndex, scripted);
    console.log(`[er-ghost] wave ${waveIndex}: ghost '${scripted.trainerName}' (scripted gauntlet carrier)`);
    return scripted;
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
  const windows = challengeMode ? [ER_GHOST_WAVE_WINDOW, 60, 80] : [ER_GHOST_WAVE_WINDOW];
  let next: GhostTeamSnapshot | undefined;
  for (const window of windows) {
    const eligible = legal.filter(s => s.waveReached >= waveIndex && s.waveReached <= waveIndex + window);
    const unused = eligible.filter(s => !usedGhostIds.has(s.id));
    next = pickGhost(unused.length > 0 ? unused : challengeMode ? eligible : [], waveIndex);
    if (next) {
      break;
    }
  }
  // ER (#422): challenge last resort - the pool is dominated by DEEP runs
  // (victories end at 200), so a wave can miss even the widest window and the
  // player kept meeting normal trainers in ghost mode. Take the CLOSEST deeper
  // team instead; applyErGhostOverride re-levels it to the wave (and, below wave
  // 100 only, devolves it by overshoot so an endgame roster can't sweep early).
  if (!next && challengeMode) {
    const anyDeeper = legal.filter(s => s.waveReached >= waveIndex);
    const unused = anyDeeper.filter(s => !usedGhostIds.has(s.id));
    const closest = (unused.length > 0 ? unused : anyDeeper).sort((a, b) => a.waveReached - b.waveReached).slice(0, 3);
    next = pickGhost(closest, waveIndex);
  }
  if (!next) {
    if (challengeMode) {
      // biome-ignore lint/suspicious/noConsole: live diagnostic (#422) - the smoking gun for "normal trainer in ghost mode"
      console.warn(
        `[er-ghost] wave ${waveIndex}: NO ghost - pool=${pool.length} legal=${legal.length} deeper=${legal.filter(s => s.waveReached >= waveIndex).length} prefetch=${prefetched === null ? "PENDING" : "done"}`,
      );
    }
    return null;
  }
  if (challengeMode) {
    // biome-ignore lint/suspicious/noConsole: live diagnostic (#422)
    console.log(`[er-ghost] wave ${waveIndex}: ghost '${next.trainerName}' (run ended at ${next.waveReached})`);
  }
  usedGhostIds.add(next.id);
  lastGhostUploader = next.trainerName ?? "";
  ghostByWave.set(waveIndex, next);
  return next;
}

/** Reset per-run ghost state (call on run start). */
export function resetErGhostRunState(): void {
  prefetched = null;
  prefetchStarted = false;
  usedGhostIds.clear();
  ghostByWave.clear();
  lastGhostUploader = null;
}

/**
 * A frozen capture of the per-run ghost cache quartet (+ the last-uploader picker cursor). These are the
 * ONLY per-run mutable state this module owns; capturing them fully save/restores a client's ghost cache.
 * Arrays/maps are shallow-COPIED so a later mutation of the live cache cannot bleed into a held snapshot
 * (and vice-versa); the {@linkcode GhostTeamSnapshot} elements are treated as immutable.
 */
export interface ErGhostRunStateSnapshot {
  prefetched: GhostTeamSnapshot[] | null;
  prefetchStarted: boolean;
  usedGhostIds: string[];
  ghostByWave: [number, GhostTeamSnapshot][];
  lastGhostUploader: string | null;
}

/**
 * TWO-ENGINE co-op harness (#633 bounded-scope): capture this client's live per-run ghost cache so the
 * cooperative scheduler can SAVE it before swapping to the other engine and RESTORE it on swap-back. Unlike
 * {@linkcode resetErGhostRunState} (which WIPES the cache), this preserves it, so a ghost-bearing ME
 * (colosseum-gauntlet, graves-of-the-fallen) or a ghost WAVE can be duo-tested without one engine inheriting
 * the other's ghost picks. Pure read + shallow copy; never mutates the live cache. Production never calls
 * this (solo/real-peer runs own a single ghost cache); it is the additive seam the harness needs.
 */
export function snapshotErGhostRunState(): ErGhostRunStateSnapshot {
  return {
    prefetched: prefetched == null ? null : [...prefetched],
    prefetchStarted,
    usedGhostIds: [...usedGhostIds],
    ghostByWave: [...ghostByWave.entries()],
    lastGhostUploader,
  };
}

/**
 * TWO-ENGINE co-op harness (#633 bounded-scope): install a previously-{@linkcode snapshotErGhostRunState}d
 * ghost cache as the live per-run state (the inverse of the snapshot). Restores the whole quartet + picker
 * cursor, re-copying so the live cache never aliases the held snapshot. Production never calls this.
 */
export function restoreErGhostRunState(snap: ErGhostRunStateSnapshot): void {
  prefetched = snap.prefetched == null ? null : [...snap.prefetched];
  prefetchStarted = snap.prefetchStarted;
  usedGhostIds.clear();
  for (const id of snap.usedGhostIds) {
    usedGhostIds.add(id);
  }
  ghostByWave.clear();
  for (const [wave, team] of snap.ghostByWave) {
    ghostByWave.set(wave, team);
  }
  lastGhostUploader = snap.lastGhostUploader;
}

/** A CLEAN (empty) ghost-cache snapshot: the per-client starting slate for the duo harness swap. */
export function emptyErGhostRunStateSnapshot(): ErGhostRunStateSnapshot {
  return { prefetched: null, prefetchStarted: false, usedGhostIds: [], ghostByWave: [], lastGhostUploader: null };
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

/**
 * Build the placeholder-token context from the ENCOUNTERING player's side, at the
 * moment a ghost dialogue line is shown. Resolved late so post-battle tokens can use
 * end-of-battle state. {slayer} (the mon that KO'd the most of the ghost's team) needs
 * per-faint attribution that isn't tracked yet, so v1 falls back to the lead.
 */
export function buildGhostDialogueCtx(): GhostDialogueContext {
  const party = globalScene?.getPlayerParty?.() ?? [];
  const nameOf = (p: (typeof party)[number]): string | undefined => p?.getNameToRender?.() || p?.name || undefined;
  const lead = party.length > 0 ? nameOf(party[0]) : undefined;
  let ace: string | undefined;
  let bestLevel = -1;
  for (const p of party) {
    if ((p?.level ?? 0) > bestLevel) {
      bestLevel = p.level ?? 0;
      ace = nameOf(p);
    }
  }
  return {
    player: loggedInUser?.username || undefined,
    lead,
    ace: ace ?? lead,
    slayer: lead, // TODO(P4): exact kill attribution from the battle faint log.
  };
}

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

  // ER Ghost Trainer Editor: apply the uploader's authored presentation. Sprite/class
  // + gender are chosen at construction (createGhostTrainer); here we apply the custom
  // name, title, and battle dialogue. Re-sanitised - it arrives from an untrusted peer.
  applyGhostTrainerPresentation(trainer, sanitizeGhostProfile(snapshot.presentation));
}

/**
 * Apply an authored GHOST-TRAINER {@linkcode GhostTrainerProfile} presentation onto a live
 * `Trainer`: the custom name, the title plate, the three battle-dialogue arrays, and the entrance
 * + aura FX. Sprite/class + gender are NOT set here (they are chosen at CONSTRUCTION - see
 * `createGhostTrainer` / the showdown trainer builder); this covers everything applied to the built
 * instance. `pres` MUST already be sanitized by the caller (`sanitizeGhostProfile`), since it may
 * arrive from an untrusted peer; a null profile is a no-op. Dialogue getters resolve placeholder
 * tokens LAZILY (at display time) via `buildCtx` so post-battle tokens use end-of-battle state.
 * Mapping: intro -> encounter, defeated -> victory (player wins), defeatPlayer/afterWin -> defeat
 * (trainer wins).
 *
 * SHARED by ghost battles ({@linkcode markTrainerAsGhost}) and showdown 1v1 (C7 - the opponent's
 * profile on the enemy trainer, both clients). Extracted verbatim so ghost behavior is byte-identical.
 */
export function applyGhostTrainerPresentation(
  trainer: Trainer,
  pres: GhostTrainerProfile | null,
  buildCtx: () => GhostDialogueContext = buildGhostDialogueCtx,
): void {
  if (!pres) {
    return;
  }
  if (pres.displayName) {
    trainer.name = pres.displayName;
  }
  if (pres.title) {
    const shownName = trainer.name;
    const title = pres.title;
    trainer.getName = (_slot: TrainerSlot = TrainerSlot.NONE, includeTitle = false): string =>
      includeTitle && shownName ? `${title} ${shownName}`.trim() : shownName;
  }
  const d = pres.dialogue;
  if (d?.intro) {
    const intro = d.intro;
    trainer.getEncounterMessages = () => [resolveGhostDialogue(intro, buildCtx())];
  }
  if (d?.defeated) {
    const defeated = d.defeated;
    trainer.getVictoryMessages = () => [resolveGhostDialogue(defeated, buildCtx())];
  }
  const lossLines = [d?.defeatPlayer, d?.afterWin].filter((l): l is string => !!l);
  if (lossLines.length > 0) {
    trainer.getDefeatMessages = () => lossLines.map(l => resolveGhostDialogue(l, buildCtx()));
  }
  // ER Ghost Trainer FX: the equipped entrance + aura. Both arrive already
  // clamped by sanitizeGhostProfile (approach -> known enum, aura -> known
  // AROUND id), so an untrusted peer can't smuggle an arbitrary effect. The
  // entrance is consumed by the per-trainer tween in encounter-phase; the aura
  // overlay is built lazily once the trainer is revealed (applyErGhostAuraFx).
  if (pres.approach && pres.approach !== "default") {
    trainer.erGhostApproach = pres.approach;
  }
  if (pres.aura && pres.showAuraInBattle) {
    trainer.erGhostAura = pres.aura;
  }
  // FX tuning (already clamped to their bands by sanitizeGhostProfile): apply the
  // speed + intensity multipliers to both the entrance tween and the aura overlay.
  if (pres.fxSpeed !== undefined) {
    trainer.erGhostFxSpeed = pres.fxSpeed;
  }
  if (pres.fxIntensity !== undefined) {
    trainer.erGhostFxIntensity = pres.fxIntensity;
  }
}

/** True if this trainer is an ER ghost battle. */
export function hasErGhostOverride(trainer: Trainer): boolean {
  return GHOST_BY_TRAINER.has(trainer);
}

/**
 * The species ids on this ghost trainer's snapshot team, or null when the trainer is
 * not an ER ghost. Used by the achievement layer (IDENTITY_THEFT) to check whether the
 * player fields a species that also appears on the ghost's team. Read-only accessor over
 * the private {@linkcode GHOST_BY_TRAINER} map.
 */
export function getErGhostSnapshotSpecies(trainer: Trainer): number[] | null {
  const snapshot = GHOST_BY_TRAINER.get(trainer);
  if (!snapshot) {
    return null;
  }
  return snapshot.party.map(member => member.speciesId);
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
    const currentWave = battle?.waveIndex ?? snapshot.waveReached;
    // ER (#422): a team fielded from BEYOND the fairness window (challenge widening
    // / last resort) gets its members devolved - one stage per overshoot band, two
    // past +20, base form past +60 - so a deep team's fully evolved mons don't sweep
    // an early-game player. Single-stagers stay.
    // ER (#422 follow-up): ONLY below wave 50 (ER_GHOST_NO_DEVOLVE_WAVE). Past there
    // the player is already strong (level ~50, evolved roster), so a deep ghost is just
    // re-levelled down (level cap below), never devolved - that devolve was the cause of
    // "baby / not-fully-evolved ghost mons" at the scheduled ghost waves (hell 63+).
    const overshoot = Math.max(0, snapshot.waveReached - (currentWave + ER_GHOST_WAVE_WINDOW));
    if (overshoot > 0 && currentWave < ER_GHOST_NO_DEVOLVE_WAVE) {
      const stages = overshoot > 60 ? 3 : overshoot > 20 ? 2 : 1;
      for (let i = 0; i < stages; i++) {
        const prevId = pokemonPrevolutions[species.speciesId as SpeciesId];
        const prev = prevId !== undefined ? getPokemonSpecies(prevId) : undefined;
        if (!prev) {
          break;
        }
        species = prev;
      }
    }
    const level = battle?.enemyLevels?.[index] ?? member.level;
    const trainerSlot = !trainer.isDouble() || !(index % 2) ? TrainerSlot.TRAINER : TrainerSlot.TRAINER_PARTNER;
    const enemy = globalScene.addEnemyPokemon(species, level, trainerSlot);
    // `addEnemyPokemon` runs enforceErEliteBstCurve, which can devolve/SWAP the species
    // AGAIN to fit the wave's BST ceiling (e.g. a low-wave Skarmory -> Clamperl) and
    // then generate a level-appropriate moveset for THAT final species. So restore the
    // stored loadout (form + ability slot + exact moveset) ONLY when the final species
    // still matches the stored member - otherwise the stored data belongs to a different
    // species and the moves are wrong or outright illegal for it (the reported "ghost
    // trainer has the wrong/empty moves" bug). This also subsumes our fairness devolve
    // above; when the species differs we keep the moveset addEnemyPokemon generated.
    const speciesMatchesStored = enemy.species.speciesId === member.speciesId;
    if (member.formIndex >= 0 && speciesMatchesStored && member.formIndex < (enemy.species.forms?.length ?? 0)) {
      enemy.formIndex = member.formIndex;
    }
    if (speciesMatchesStored) {
      enemy.abilityIndex = member.abilityIndex;
    }
    if (member.ivs.length === 6) {
      // Clamp to the legal IV range. A hacked source save can store IVs far above 31
      // (seen: 999 across all six -> ~2000 stats on a wave-199 ghost), which is restored
      // verbatim into an unbeatable ghost. Legit IVs never exceed 31, so clamping is a
      // no-op for honest teams and neutralizes the inflated ones.
      enemy.ivs = member.ivs.map(iv => Math.max(0, Math.min(31, Math.floor(iv) || 0)));
    }
    enemy.nature = member.nature as Nature;
    enemy.gender = member.gender;
    enemy.shiny = member.shiny;
    enemy.variant = member.variant as Variant;
    enemy.passive = member.passive;
    enemy.customPokemonData.erShinyLabSuppressLocal = true;
    enemy.customPokemonData.erShinyLab = member.shiny ? normalizeErShinyLabSavedLook(member.erShinyLab) : undefined;
    enemy.customPokemonData.erShinyLabName =
      member.shiny && member.erShinyLab ? sanitizeErShinyLabPresetName(member.erShinyLabName) || undefined : undefined;
    if (member.moves.length > 0 && speciesMatchesStored) {
      const moves = member.moves.map(id => new PokemonMove(id));
      enemy.moveset = moves;
      enemy.summonData.moveset = moves;
    }
    // else: keep the level-appropriate moveset addEnemyPokemon already generated for the
    // final (devolved or BST-swapped) species.
    enemy.generateName();
    return enemy;
  } catch {
    return null;
  }
}
