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
import {
  advanceErEndlessGhostRoute,
  beginErEndlessGhostEncounter,
  beginErEndlessGhostRoute,
  canUseErEndlessGhost,
  finalizeErEndlessGhostEncounter,
  getErEndlessEquivalentDepth,
  getErEndlessGhostRoute,
  getErEndlessNemesisRank,
  getErEndlessReturningNemesisId,
  hasErEndlessRift,
  isErEndlessContinuationActive,
  recordErEndlessGhost,
} from "#data/elite-redux/er-endless-continuation";
import { loggedInUser } from "#app/account";
import { globalScene } from "#app/global-scene";
import { bypassLogin } from "#constants/app-constants";
import { ER_BLACK_SHINY_ABILITY_POOL } from "#data/elite-redux/er-black-shinies";
import { ER_GHOST_WAVE_WINDOW } from "#data/elite-redux/er-ghost-constants";
import { type ErDifficulty, getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { ghostWavesForCurrentRun, isErGhostChallengeActive, isErGhostWave } from "#data/elite-redux/er-ghost-waves";
import { getErProgressionWave, isErSprintRun } from "#data/elite-redux/er-run-pacing";
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
import { allAbilities, modifierTypes } from "#data/data-lists";
import { TrainerPartyTemplate } from "#data/trainers/trainer-party-template";
import { EggTier } from "#enums/egg-type";
import { AbilityId } from "#enums/ability-id";
import type { Nature } from "#enums/nature";
import { BaseStatModifier, ErRelicModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { BaseStatBoosterModifierType } from "#modifiers/modifier-type";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { TrainerSlot } from "#enums/trainer-slot";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import type { Trainer } from "#field/trainer";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, Stat, type PermanentStat } from "#enums/stat";
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
  /**
   * Run-scoped Ability Randomizer overrides for active + innate slots 1-3.
   * `-1` means that slot still uses its species/form-derived ability.
   */
  abilityOverrides?: [number, number, number, number] | undefined;
  /** Whether the stored overrides remain active on form-derived Mega/G-max forms. */
  abilityOverridesForm?: boolean | undefined;
  /** ER Black Shiny: t4 identity is distinct from the ordinary red/t3 variant. */
  erBlackShiny?: boolean | undefined;
  /** The owner's three curated GIFT choices, preserved without rerolling. */
  erGiftAbilities?: number[] | undefined;
  /** Active entry in {@linkcode erGiftAbilities}. */
  erGiftIndex?: number | undefined;
  /** ER (Graveyard ME): the items this member was holding, as
   * [modifierTypeId, stackCount, generatedTypeArgs?] tuples. Omitted when none / for legacy
   * snapshots captured before item recording (those fall back to a random
   * Ultra-tier item or berry when a memento is granted). */
  heldItems?: [string, number, unknown[]?][] | undefined;
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

/** JSON-safe CustomPokemonData fields carried by a reconstructed ghost member. */
export interface ErGhostMemberCustomData {
  ability: AbilityId | -1;
  passive: AbilityId | -1;
  passive2: AbilityId | -1;
  passive3: AbilityId | -1;
  abilityOverridesForm: boolean;
  erBlackShiny: boolean;
  erGiftAbilities: number[];
  erGiftIndex: number;
  erShinyLab?: ErShinyLabSavedLook | undefined;
  erShinyLabName?: string | undefined;
  erShinyLabSuppressLocal: true;
}

function sanitizeGhostAbilityOverride(value: unknown): AbilityId | -1 {
  return Number.isSafeInteger(value)
      && (value as number) > AbilityId.NONE
      && allAbilities[value as number]?.id === value
    ? value as AbilityId
    : -1;
}

function getSanitizedGhostAbilityOverrides(member: GhostMember): [AbilityId | -1, AbilityId | -1, AbilityId | -1, AbilityId | -1] {
  const values = Array.isArray(member.abilityOverrides) ? member.abilityOverrides : [];
  return [
    sanitizeGhostAbilityOverride(values[0]),
    sanitizeGhostAbilityOverride(values[1]),
    sanitizeGhostAbilityOverride(values[2]),
    sanitizeGhostAbilityOverride(values[3]),
  ];
}

/**
 * Sanitize the persistent custom state of an untrusted cross-player member.
 * Ability overrides must resolve to live abilities. Black is accepted only with
 * the same shiny+variant invariant used locally; GIFT ids are restricted to the
 * approved pool and never rerolled for ghosts.
 */
export function getErGhostMemberCustomData(member: GhostMember): ErGhostMemberCustomData {
  const [ability, passive, passive2, passive3] = getSanitizedGhostAbilityOverrides(member);
  const hasAbilityOverride = ability !== -1 || passive !== -1 || passive2 !== -1 || passive3 !== -1;
  const erBlackShiny = member.erBlackShiny === true && member.shiny === true && member.variant === 2;
  const erGiftAbilities = erBlackShiny && Array.isArray(member.erGiftAbilities)
    ? [...new Set(member.erGiftAbilities)]
      .filter(id => Number.isInteger(id) && ER_BLACK_SHINY_ABILITY_POOL.includes(id))
      .slice(0, 3)
    : [];
  const requestedGiftIndex = Number.isInteger(member.erGiftIndex) ? member.erGiftIndex! : 0;
  const erGiftIndex = erGiftAbilities.length > 0
    ? Math.max(0, Math.min(erGiftAbilities.length - 1, requestedGiftIndex))
    : 0;
  const erShinyLab = member.shiny ? normalizeErShinyLabSavedLook(member.erShinyLab) : undefined;
  const erShinyLabName = erShinyLab
    ? sanitizeErShinyLabPresetName(member.erShinyLabName) || undefined
    : undefined;

  return {
    ability,
    passive,
    passive2,
    passive3,
    abilityOverridesForm: hasAbilityOverride && member.abilityOverridesForm === true,
    erBlackShiny,
    erGiftAbilities,
    erGiftIndex,
    erShinyLab,
    erShinyLabName,
    erShinyLabSuppressLocal: true,
  };
}

export interface GhostTeamSnapshot {
  /** Stable-ish id (seed + timestamp), used for de-duplication. */
  id: string;
  /** Stable source-account key supplied by the shared API (never displayed). */
  sourceUserId?: string | undefined;
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
   * snapshots. Persisted to the `runs.relics` blob and restored on fielded ghosts.
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
  /** Transient Endless route metadata; never uploaded as part of a completed run. */
  endlessEchoStage?: 1 | 2 | 3 | undefined;
  /** Aggregate, anonymized battle performance attached by the run-history worker. */
  endlessPerformance?: {
    appearances: number;
    wins: number;
    averagePlayerKos: number;
    averagePlayerHpRemoved: number;
    averageTurnsSurvived: number;
    dangerScore: number;
    topPerformer?: boolean | undefined;
  } | undefined;
  /** Hidden per-save relationship level; intentionally never rendered. */
  endlessNemesisRank?: number | undefined;
}

const MAX_PARTY = 6;
/** Local backlog of past runs kept per device (seeds the pool on first login). */
const LOCAL_STORE_CAP = 100;
/** Cross-player samples retained for network-loss fallback. */
const SHARED_CACHE_CAP = 240;
const ENDLESS_GHOST_SAMPLE_SIZE = 240;
const ENDLESS_GHOST_REFILL_INTERVAL = 40;
const ENDLESS_GHOST_POOL_CAP = 600;
/** Preferred source-run proximity; +40 is used only when this band is empty. */
const GHOST_PRIMARY_WAVE_WINDOW = 20;
/** Prefetch this many waves ahead of the run's FIRST ghost wave (#364). */
const PREFETCH_LEAD_WAVES = 15;
/** Late Hell runs replace half of ordinary trainer encounters with ghosts. */
const LATE_HELL_GHOST_RATE_DENOMINATOR = 2;
const LATE_HELL_GHOST_START_WAVE: Readonly<Record<"normal" | "sprint", number>> = {
  normal: 100,
  sprint: 50,
};
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

/** Late-Hell ghosts must carry real saved held items, not a legacy bare roster. */
export function hasErGhostSavedItems(snapshot: GhostTeamSnapshot): boolean {
  return snapshot.party.some(member =>
    (member.heldItems ?? []).some(
      ([typeId, stack]) => typeof typeId === "string" && typeId.length > 0 && Number.isFinite(stack) && stack > 0,
    ),
  );
}

type ErGhostHeldItem = [string, number, unknown[]?];

function heldItemStackTotal(items: readonly ErGhostHeldItem[]): number {
  return items.reduce((sum, [, rawStack]) => {
    const stack = Math.floor(Number(rawStack));
    return sum + (Number.isFinite(stack) && stack > 0 ? stack : 0);
  }, 0);
}

function stableGhostItemIndex(key: string, length: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193) >>> 0;
  }
  return length > 0 ? hash % length : 0;
}

/**
 * Pick a large real ghost inventory for an Endless raid boss. Individual
 * 10-stack members are preferred; a qualifying team's combined inventory is
 * the fallback for old snapshots that spread their items across all six mons.
 */
export function selectErEndlessBossHeldItems(
  snapshots: readonly GhostTeamSnapshot[],
  selectionKey: string,
  minimumStacks = 10,
): ErGhostHeldItem[] {
  const legalVictories = snapshots.filter(
    snapshot => snapshot.isVictory && hasErGhostSavedItems(snapshot) && isErGhostTeamLegal(snapshot),
  );
  const memberLoadouts = legalVictories.flatMap(snapshot =>
    snapshot.party
      .map(member => member.heldItems ?? [])
      .filter(items => heldItemStackTotal(items) >= minimumStacks),
  );
  const teamLoadouts = legalVictories
    .map(snapshot => snapshot.party.flatMap(member => member.heldItems ?? []))
    .filter(items => heldItemStackTotal(items) >= minimumStacks);
  const candidates = memberLoadouts.length > 0 ? memberLoadouts : teamLoadouts;
  const selected = candidates[stableGhostItemIndex(selectionKey, candidates.length)] ?? [];
  return selected.map(([typeId, stack, args]): ErGhostHeldItem =>
    Array.isArray(args) ? [typeId, stack, structuredClone(args)] : [typeId, stack]
  );
}

/** Saved ghost loadout for one Endless raid party slot. */
export function getErEndlessBossHeldItems(waveIndex: number, partyIndex: number): ErGhostHeldItem[] {
  seedGhostPoolFromSharedCache();
  return selectErEndlessBossHeldItems(
    prefetched ?? [],
    `${globalScene.seed}:${waveIndex}:${partyIndex}:endless-raid-items`,
  );
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
  maxWave = 200,
  requireSavedItems = false,
  victoriesOnly = false,
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
      `${base}/savedata/run/sample?difficulty=${encodeURIComponent(difficulty)}&count=${count}&minWave=${minWave}&maxWave=${maxWave}${requireSavedItems ? "&requireSavedItems=1" : ""}${victoriesOnly ? "&victoriesOnly=1" : ""}`,
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

const endlessLineageRequests = new Set<string>();

async function fetchEndlessLineage(sourceRunId: string, count = 4): Promise<GhostTeamSnapshot[]> {
  const base = serverBase();
  const token = getCookie(sessionIdKey);
  if (bypassLogin || !base || !token || typeof fetch !== "function" || endlessLineageRequests.has(sourceRunId)) {
    return [];
  }
  endlessLineageRequests.add(sourceRunId);
  try {
    const response = await fetch(
      `${base}/savedata/run/lineage?sourceRunId=${encodeURIComponent(sourceRunId)}&count=${count}`,
      { method: "GET", headers: { Accept: "application/json", Authorization: token } },
    );
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return (Array.isArray(data) ? data : (data?.teams ?? []))
      .filter(isValidSnapshot)
      .filter(snapshot => snapshot.isVictory && hasErGhostSavedItems(snapshot) && isErGhostTeamLegal(snapshot));
  } catch {
    return [];
  }
}

export function reportErEndlessGhostEncounter(result: "player-win" | "ghost-win"): void {
  const report = finalizeErEndlessGhostEncounter(result, globalScene.currentBattle?.turn ?? 0);
  if (!report) {
    return;
  }
  const base = serverBase();
  const token = getCookie(sessionIdKey);
  if (bypassLogin || !base || !token || typeof fetch !== "function") {
    return;
  }
  void fetch(`${base}/savedata/run/ghost-result`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify(report),
  }).catch(() => undefined);
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

function sharedCacheKey(): string {
  return `er-ghost-shared-cache-v1_${loggedInUser?.username ?? "guest"}`;
}

function loadSharedGhostCache(): GhostTeamSnapshot[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(sharedCacheKey()) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isValidSnapshot) : [];
  } catch {
    return [];
  }
}

function saveSharedGhostCache(snapshots: GhostTeamSnapshot[]): void {
  try {
    const merged = [...loadSharedGhostCache(), ...snapshots];
    const seenIds = new Set<string>();
    const seenTeams = new Set<string>();
    const unique: GhostTeamSnapshot[] = [];
    for (const snapshot of merged) {
      if (!isErGhostTeamLegal(snapshot)) {
        continue;
      }
      const fingerprint = ghostTeamFingerprint(snapshot);
      if (seenIds.has(snapshot.id) || seenTeams.has(fingerprint)) {
        continue;
      }
      seenIds.add(snapshot.id);
      seenTeams.add(fingerprint);
      unique.push(snapshot);
    }
    localStorage.setItem(sharedCacheKey(), JSON.stringify(unique.slice(-SHARED_CACHE_CAP)));
  } catch {
    // Cache persistence is optional; a full/quota-disabled store must not block play.
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
  const erBlackShiny = p?.customPokemonData?.erBlackShiny === true && p?.shiny === true && p?.variant === 2;
  const erGiftAbilities = erBlackShiny && Array.isArray(p?.customPokemonData?.erGiftAbilities)
    ? [...new Set<number>(p.customPokemonData.erGiftAbilities)]
      .filter(id => Number.isInteger(id) && ER_BLACK_SHINY_ABILITY_POOL.includes(id))
      .slice(0, 3)
    : [];
  const requestedGiftIndex = Number.isInteger(p?.customPokemonData?.erGiftIndex)
    ? p.customPokemonData.erGiftIndex
    : 0;
  const erGiftIndex = erGiftAbilities.length > 0
    ? Math.max(0, Math.min(erGiftAbilities.length - 1, requestedGiftIndex))
    : 0;
  const abilityOverrides = [
    sanitizeGhostAbilityOverride(p?.customPokemonData?.ability),
    sanitizeGhostAbilityOverride(p?.customPokemonData?.passive),
    sanitizeGhostAbilityOverride(p?.customPokemonData?.passive2),
    sanitizeGhostAbilityOverride(p?.customPokemonData?.passive3),
  ] as [AbilityId | -1, AbilityId | -1, AbilityId | -1, AbilityId | -1];
  const hasAbilityOverride = abilityOverrides.some(abilityId => abilityId !== -1);
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
    ...(hasAbilityOverride ? {
      abilityOverrides,
      abilityOverridesForm: p?.customPokemonData?.abilityOverridesForm === true,
    } : {}),
    ...(erBlackShiny ? { erBlackShiny: true } : {}),
    ...(erGiftAbilities.length > 0 ? { erGiftAbilities, erGiftIndex } : {}),
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

/** Serialise a member's held items, including generated-type arguments when needed. */
function serializeHeldItems(p: any, isPlayer: boolean): [string, number, unknown[]?][] {
  try {
    const id = p?.id;
    if (id == null) {
      return [];
    }
    return globalScene
      .findModifiers(m => m instanceof PokemonHeldItemModifier && m.pokemonId === id, isPlayer)
      .map(m => {
        const modifier = m as PokemonHeldItemModifier;
        const type = modifier.type as { id: string; getPregenArgs?: () => unknown[] };
        const generatedTypeArgs = typeof type.getPregenArgs === "function" ? type.getPregenArgs() : undefined;
        return Array.isArray(generatedTypeArgs) && generatedTypeArgs.length > 0
          ? ([type.id, modifier.getStackCount(), generatedTypeArgs] as [string, number, unknown[]])
          : ([type.id, modifier.getStackCount()] as [string, number]);
      })
      .filter(([typeId]) => !!typeId);
  } catch {
    return [];
  }
}

/** Serialise active ER relics as [kind, stackCount, chosenWeather] snapshots. */
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
  if (
    globalScene?.gameMode?.isEndless
    || globalScene?.gameMode?.isDaily
    || isErEndlessContinuationActive()
  ) {
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
    // Fielded ghosts restore these relics in addition to normal encounter buffs.
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
let endlessGhostPoolFetch: Promise<void> | null = null;
let endlessGhostPoolRetryAfter = 0;
let endlessGhostPicksSinceRefill = 0;
const usedGhostIds = new Set<string>();
const usedGhostUploaders = new Set<string>();
const usedGhostTeamFingerprints = new Set<string>();
const ghostByWave = new Map<number, GhostTeamSnapshot>();
const requestedGhostBands = new Set<string>();
const ghostBandRetryAfter = new Map<string, number>();
let sharedCacheSeeded = false;

function ghostUploaderKey(snapshot: GhostTeamSnapshot): string {
  const sourceId = typeof snapshot.sourceUserId === "string" ? snapshot.sourceUserId.trim() : "";
  const trainerName = typeof snapshot.trainerName === "string" ? snapshot.trainerName : "Trainer";
  return sourceId ? `id:${sourceId}` : `name:${trainerName.trim().toLocaleLowerCase()}`;
}

/** Stable semantic team hash: cosmetic variants do not make an otherwise identical team new. */
export function ghostTeamFingerprint(snapshot: GhostTeamSnapshot): string {
  const semanticParty = snapshot.party
    .map(member => {
      const abilityOverrides = getSanitizedGhostAbilityOverrides(member);
      const hasAbilityOverride = abilityOverrides.some(abilityId => abilityId !== -1);
      return JSON.stringify([
        member.speciesId,
        member.formIndex,
        member.abilityIndex,
        member.nature,
        member.passive,
        abilityOverrides,
        hasAbilityOverride && member.abilityOverridesForm === true,
        Array.isArray(member.ivs) ? member.ivs : [],
        Array.isArray(member.moves) ? member.moves.slice().sort((a, b) => a - b) : [],
        Array.isArray(member.heldItems)
          ? member.heldItems.slice().sort((a, b) => String(a[0]).localeCompare(String(b[0])))
          : [],
      ]);
    })
    .sort();
  const value = JSON.stringify(semanticParty);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = (Math.imul(b ^ code, 33) + i) >>> 0;
  }
  return `${a.toString(36)}:${b.toString(36)}`;
}

function mergeGhostPool(teams: GhostTeamSnapshot[], persist = false): void {
  if (persist && teams.length > 0) {
    saveSharedGhostCache(teams);
  }
  const merged = [...(prefetched ?? []), ...teams].filter(isErGhostTeamLegal);
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  prefetched = merged.filter(team => {
    const fingerprint = ghostTeamFingerprint(team);
    if (ids.has(team.id) || fingerprints.has(fingerprint)) {
      return false;
    }
    ids.add(team.id);
    fingerprints.add(fingerprint);
    return true;
  });
  onGhostPoolPublished?.(prefetched);
}

function requestErEndlessGhostPool(): Promise<void> {
  if (coopGhostFetchSuppressed?.()) {
    prefetchStarted = true;
    return Promise.resolve();
  }
  if ((prefetched?.length ?? 0) >= ENDLESS_GHOST_POOL_CAP || endlessGhostPoolRetryAfter > Date.now()) {
    return Promise.resolve();
  }
  if (endlessGhostPoolFetch) {
    return endlessGhostPoolFetch;
  }
  prefetchStarted = true;
  endlessGhostPoolFetch = fetchGhostTeams(
    getErDifficulty(),
    ENDLESS_GHOST_SAMPLE_SIZE,
    0,
    200,
    true,
    true,
  )
    .then(teams => {
      if (teams.length === 0) {
        endlessGhostPoolRetryAfter = Date.now() + 15_000;
        return;
      }
      endlessGhostPoolRetryAfter = 0;
      const remaining = Math.max(0, ENDLESS_GHOST_POOL_CAP - (prefetched?.length ?? 0));
      mergeGhostPool(teams.slice(0, remaining), true);
    })
    .catch(error => {
      endlessGhostPoolRetryAfter = Date.now() + 15_000;
      // biome-ignore lint/suspicious/noConsole: included in Send Logs diagnostics.
      console.warn("[er-ghost] Endless pool refresh failed:", error);
    })
    .finally(() => {
      endlessGhostPoolFetch = null;
    });
  return endlessGhostPoolFetch;
}

function seedGhostPoolFromSharedCache(): void {
  if (sharedCacheSeeded) {
    return;
  }
  sharedCacheSeeded = true;
  mergeGhostPool(loadSharedGhostCache());
}

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
  const legal = pool.filter(isErGhostTeamLegal);
  const currentIds = (prefetched ?? []).map(team => team.id);
  const isAppendOnly = currentIds.every((id, index) => legal[index]?.id === id);
  if (ghostByWave.size > 0 && !isAppendOnly) {
    return;
  }
  prefetched = legal;
  prefetchStarted = true;
}

// -----------------------------------------------------------------------------
// Difficulty gating (#345/#difficulty-pools): a run must NEVER field a ghost of a
// HARDER difficulty than its own tier. Youngster/Ace are pure vanilla and have NO
// scheduled ghost waves (er-ghost-waves), so the only way they meet a ghost is the
// explicit Ghost Trainers CHALLENGE opt-in - and even then the reported bug was a
// Youngster run drawing Hell-scaled evolved rosters, because the challenge pool
// topped up from the deepest (Hell/Elite) pools to avoid starvation. Constrain the
// top-up to the run's tier and EASIER only, so an easy run never faces a harder team.
// -----------------------------------------------------------------------------
const GHOST_DIFFICULTY_RANK: Record<string, number> = {
  youngster: 0,
  ace: 1,
  elite: 2,
  hell: 3,
  mystery: 3, // dev gauntlet, hell-equivalent (uses its own scripted carrier anyway)
};

/** Rank of a difficulty label; unknown/legacy snapshots default to Ace (the historical era). */
function ghostDifficultyRank(d: string | undefined): number {
  return GHOST_DIFFICULTY_RANK[d ?? ""] ?? GHOST_DIFFICULTY_RANK.ace;
}

/**
 * The difficulty pools the Ghost Trainers CHALLENGE may draw from for a `run` tier:
 * the run's own tier first (for pool depth), then progressively EASIER tiers to fight
 * starvation - but NEVER a harder tier. So a Youngster challenge draws only Youngster
 * teams, Ace draws Ace+Youngster, and only Hell draws the full ladder.
 */
export function ghostChallengePoolOrder(run: ErDifficulty): ErDifficulty[] {
  const easierFirst: ErDifficulty[] = ["hell", "elite", "ace", "youngster"]; // descending rank
  const runRank = ghostDifficultyRank(run);
  const rest = easierFirst.filter(d => d !== run && ghostDifficultyRank(d) <= runRank);
  return [run, ...rest];
}

function isValidSnapshot(s: unknown): s is GhostTeamSnapshot {
  return (
    !!s
    && typeof s === "object"
    && Array.isArray((s as GhostTeamSnapshot).party)
    && (s as GhostTeamSnapshot).party.length > 0
  );
}

async function fetchGhostTeams(
  difficulty: ErDifficulty,
  count: number,
  minWave: number,
  maxWave = 200,
  requireSavedItems = false,
  victoriesOnly = false,
): Promise<GhostTeamSnapshot[]> {
  // Preferred: the authenticated shared pool (other players' runs that got deep
  // enough — `minWave` keeps shallow runs out of late ghost waves).
  const fromServer = (await sampleRunsFromServer(
    difficulty,
    count,
    minWave,
    maxWave,
    requireSavedItems,
    victoriesOnly,
  )).filter(snapshot =>
    (!requireSavedItems || hasErGhostSavedItems(snapshot)) && (!victoriesOnly || snapshot.isVictory),
  );
  if (fromServer.length > 0) {
    saveSharedGhostCache(fromServer);
    return fromServer;
  }
  const url = endpoint();
  if (url && typeof fetch === "function") {
    try {
      const sep = url.includes("?") ? "&" : "?";
      const res = await fetch(
        `${url}${sep}difficulty=${encodeURIComponent(difficulty)}&count=${count}&minWave=${minWave}&maxWave=${maxWave}${requireSavedItems ? "&requireSavedItems=1" : ""}${victoriesOnly ? "&victoriesOnly=1" : ""}`,
        { method: "GET", headers: { Accept: "application/json" } },
      );
      if (res.ok) {
        const data = await res.json();
        const list = (Array.isArray(data) ? data : (data?.teams ?? []))
          .filter(isValidSnapshot)
          .filter(snapshot =>
            (!requireSavedItems || hasErGhostSavedItems(snapshot)) && (!victoriesOnly || snapshot.isVictory),
          );
        if (list.length > 0) {
          saveSharedGhostCache(list as GhostTeamSnapshot[]);
          return list as GhostTeamSnapshot[];
        }
      }
    } catch {
      // Fall through to the local pool.
    }
  }
  // Network loss: use only previously fetched cross-player snapshots that still
  // fit this exact request. No fitting cache means a normal trainer, never an
  // out-of-range team or the current player's own uploaded run.
  const cached = loadSharedGhostCache().filter(
    snapshot =>
      snapshot.waveReached >= minWave
      && snapshot.waveReached <= maxWave
      && (victoriesOnly || ghostDifficultyRank(snapshot.difficulty) <= ghostDifficultyRank(difficulty))
      && (!requireSavedItems || hasErGhostSavedItems(snapshot))
      && (!victoriesOnly || snapshot.isVictory),
  );
  return cached.slice(-count);
}

/** Preload the all-difficulty victorious-item pool before Endless enters its first encounter. */
export async function prepareErEndlessGhostPool(): Promise<void> {
  seedGhostPoolFromSharedCache();
  const local = loadLocalGhostTeams().filter(
    snapshot => snapshot.isVictory && hasErGhostSavedItems(snapshot) && isErGhostTeamLegal(snapshot),
  );
  mergeGhostPool(local);
  await requestErEndlessGhostPool();
}

/**
 * Kick off (once, lazily) pre-fetching enough ghost teams for the run's
 * difficulty. Safe to call every wave — it only fires once, around wave 150.
 */
function requestGhostBand(
  difficulty: ErDifficulty,
  minWave: number,
  maxWave: number,
  count: number,
  requireSavedItems = false,
): void {
  if (minWave > maxWave) {
    return;
  }
  const key = `${difficulty}:${minWave}:${maxWave}:${requireSavedItems ? "saved-items" : "any"}`;
  if (requestedGhostBands.has(key) || (ghostBandRetryAfter.get(key) ?? 0) > Date.now()) {
    return;
  }
  requestedGhostBands.add(key);
  void fetchGhostTeams(difficulty, count, minWave, maxWave, requireSavedItems)
    .then(teams => {
      if (teams.length === 0) {
        requestedGhostBands.delete(key);
        ghostBandRetryAfter.set(key, Date.now() + 15_000);
        return;
      }
      ghostBandRetryAfter.delete(key);
      mergeGhostPool(teams, true);
    })
    .catch(error => {
      requestedGhostBands.delete(key);
      ghostBandRetryAfter.set(key, Date.now() + 15_000);
      // biome-ignore lint/suspicious/noConsole: included in Send Logs diagnostics.
      console.warn(`[er-ghost] rolling prefetch ${key} failed:`, error);
    });
}

/**
 * Keep a wave-targeted pool warm without ever blocking battle creation. Challenge
 * runs refresh two ten-wave buckets ahead; scheduled runs fetch their next exact
 * ghost wave fifteen waves early. Each bucket has a +20 primary and +40 fallback.
 */
export function maybePrefetchGhostTeams(waveIndex: number): void {
  // The host owns all network sampling in co-op and publishes append-only pools.
  if (coopGhostFetchSuppressed?.()) {
    prefetchStarted = true;
    return;
  }
  seedGhostPoolFromSharedCache();

  if (isErEndlessContinuationActive()) {
    if (!prefetchStarted || endlessGhostPoolRetryAfter > 0) {
      void requestErEndlessGhostPool();
    }
    if (hasErEndlessRift("parallel-lives") || hasErEndlessRift("echo-hunt")) {
      const source = (prefetched ?? []).find(snapshot =>
        snapshot.isVictory
        && hasErGhostSavedItems(snapshot)
        && !endlessLineageRequests.has(snapshot.id),
      );
      if (source) {
        void fetchEndlessLineage(source.id).then(teams => mergeGhostPool(teams, true));
      }
    }
    return;
  }

  const targets: number[] = [];
  const eligibilityWave = isErSprintRun() ? getErProgressionWave(waveIndex) : waveIndex;
  const pacing = isErSprintRun() ? "sprint" : "normal";
  const lateHellPrefetch =
    getErDifficulty() === "hell" && waveIndex > LATE_HELL_GHOST_START_WAVE[pacing] - PREFETCH_LEAD_WAVES;
  if (isErGhostChallengeActive() || lateHellPrefetch) {
    const currentBucket = Math.floor((Math.max(1, eligibilityWave) - 1) / 10) * 10 + 1;
    targets.push(currentBucket);
    if (currentBucket + 10 <= 200) {
      targets.push(currentBucket + 10);
    }
  } else {
    const next = ghostWavesForCurrentRun().find(
      ghostWave => ghostWave >= waveIndex && ghostWave - waveIndex <= PREFETCH_LEAD_WAVES,
    );
    if (next != null) {
      targets.push(isErSprintRun() ? getErProgressionWave(next) : next);
    }
  }

  if (targets.length === 0) {
    return;
  }

  prefetchStarted = true;
  const difficulty = getErDifficulty();
  for (const target of targets) {
    const primaryEnd = Math.min(200, target + GHOST_PRIMARY_WAVE_WINDOW);
    const fallbackEnd = Math.min(200, target + ER_GHOST_WAVE_WINDOW);
    requestGhostBand(difficulty, target, primaryEnd, 20, lateHellPrefetch);
    requestGhostBand(difficulty, primaryEnd + 1, fallbackEnd, 10, lateHellPrefetch);
  }
}

/**
 * Deterministic late-Hell replacement roll. Ordinary trainer encounters after
 * wave 100 (normal) or 50 (Sprint) become ghosts half the time. The explicit
 * Ghost Trainers challenge bypasses this helper because it already replaces
 * every trainer encounter.
 */
export function shouldUseLateHellGhostTrainer(
  waveIndex: number,
  seed: string = String(globalScene?.seed ?? ""),
): boolean {
  if (getErDifficulty() !== "hell") {
    return false;
  }
  const pacing = isErSprintRun() ? "sprint" : "normal";
  if (waveIndex <= LATE_HELL_GHOST_START_WAVE[pacing]) {
    return false;
  }
  const key = `${seed}:late-hell-ghost:${waveIndex}:${pacing}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % LATE_HELL_GHOST_RATE_DENOMINATOR === 0;
}

/** Whether every ghost considered for this wave must have saved held items. */
export function shouldRequireLateHellGhostItems(waveIndex: number): boolean {
  if (getErDifficulty() !== "hell") {
    return false;
  }
  const pacing = isErSprintRun() ? "sprint" : "normal";
  return waveIndex > LATE_HELL_GHOST_START_WAVE[pacing];
}

/**
 * Saved player inventories are a second-half ghost power layer. Before the
 * midpoint, ghosts keep only the ordinary trainer items generated for their
 * encounter; their source player's held items and relics are not restored.
 */
export function shouldRestoreErGhostSavedInventory(waveIndex: number): boolean {
  return getErProgressionWave(waveIndex) > LATE_HELL_GHOST_START_WAVE.normal;
}

/** The uploader of the most recently fielded ghost - the picker avoids
 * fielding the same player twice in a row when alternatives exist (#422). */
let lastGhostUploader: string | null = null;

/** How many recently-fielded ghost waves the picker avoids re-fielding the same
 * uploader from (the "same ghost N waves in a row" report, #ghost-repeat). */
const GHOST_RECENT_UPLOADER_WINDOW = 3;

/**
 * The uploaders fielded in the {@linkcode GHOST_RECENT_UPLOADER_WINDOW} waves just
 * before `waveIndex`, read from the already-recorded {@linkcode ghostByWave} cache
 * (so this needs no new per-run state and stays co-op-deterministic + save/restore
 * safe). Most-recent first, `lastGhostUploader` folded in so the immediately previous
 * pick counts even on a non-contiguous ghost-wave schedule.
 */
function recentGhostUploaders(waveIndex: number): string[] {
  const out: string[] = [];
  if (lastGhostUploader) {
    out.push(lastGhostUploader);
  }
  for (let w = waveIndex - 1; w >= waveIndex - GHOST_RECENT_UPLOADER_WINDOW && w >= 0; w--) {
    const name = ghostByWave.get(w)?.trainerName;
    if (name && !out.includes(name)) {
      out.push(name);
    }
  }
  return out;
}

/**
 * Seeded-random pick among candidate snapshots, preferring an uploader NOT fielded in
 * the recent-wave window - so the same player's ghost can't appear several waves in a
 * row (the "same ghost 4x in a row" report). The window relaxes step by step when a
 * strict filter would empty the pool, so a one-uploader-dominated sample still fields
 * something rather than nothing. Deterministic per (run seed, wave) so reloading the
 * same wave fields the same ghost - but DIFFERENT waves and different runs spread across
 * the pool. Replaces the old shallowest-first sort, which deterministically handed every
 * early wave to whichever single player owned the shallow end of the sample.
 */
function pickGhost(candidates: GhostTeamSnapshot[], waveIndex: number): GhostTeamSnapshot | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  const recent = recentGhostUploaders(waveIndex);
  // Relax the recent window one uploader at a time until some candidate survives.
  let pool = candidates;
  for (let depth = recent.length; depth >= 1; depth--) {
    const banned = new Set(recent.slice(0, depth));
    const filtered = candidates.filter(s => !banned.has(s.trainerName ?? ""));
    if (filtered.length > 0) {
      pool = filtered;
      break;
    }
  }
  const key = `${globalScene.seed}:ghostpick:${waveIndex}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  if (isErEndlessContinuationActive()) {
    const depth = getErEndlessEquivalentDepth(waveIndex);
    const weights = pool.map(snapshot =>
      1 + Math.min(1, depth / 500) * 2 * Math.max(0, Math.min(1, snapshot.endlessPerformance?.dangerScore ?? 0)),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = (h / 0x1_0000_0000) * total;
    for (let index = 0; index < pool.length; index++) {
      roll -= weights[index];
      if (roll < 0) {
        return pool[index];
      }
    }
  }
  return pool[h % pool.length];
}

function augmentErEndlessGhost(
  snapshot: GhostTeamSnapshot,
  waveIndex: number,
  echoStage?: 1 | 2 | 3,
): GhostTeamSnapshot {
  const donorCount = hasErEndlessRift("full-procession")
    ? 2
    : hasErEndlessRift("seventh-shadow") || echoStage === 3 || (snapshot.endlessNemesisRank ?? 0) >= 2
      ? 1
      : 0;
  const nemesisRank = snapshot.endlessNemesisRank ?? 0;
  const totalDonors = nemesisRank >= 3 ? Math.max(2, donorCount) : donorCount;
  const replaceOne = hasErEndlessRift("counter-draft") || nemesisRank >= 3;
  if (totalDonors === 0 && !replaceOne && echoStage == null && nemesisRank === 0) {
    return snapshot;
  }
  const result = structuredClone(snapshot);
  result.endlessEchoStage = echoStage;
  const donorTeams = (prefetched ?? []).filter(candidate =>
    candidate.id !== snapshot.id
    && candidate.isVictory
    && hasErGhostSavedItems(candidate)
    && isErGhostTeamLegal(candidate),
  );
  const donorMembers = donorTeams.flatMap(candidate => candidate.party);
  if (donorMembers.length === 0) {
    return result;
  }
  const usedSpecies = new Set(result.party.map(member => member.speciesId));
  const chooseDonor = (slot: number): GhostMember => {
    const distinct = donorMembers.filter(member => !usedSpecies.has(member.speciesId));
    const pool = distinct.length > 0 ? distinct : donorMembers;
    const key = `${globalScene.seed}:endless-donor:${waveIndex}:${snapshot.id}:${slot}`;
    let hash = 2166136261;
    for (const char of key) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    }
    const donor = structuredClone(pool[(hash >>> 0) % pool.length]);
    usedSpecies.add(donor.speciesId);
    return donor;
  };
  if (replaceOne && result.party.length > 0) {
    let replaceIndex = 0;
    let lowestBst = Number.POSITIVE_INFINITY;
    result.party.forEach((member, index) => {
      const bst = getPokemonSpecies(member.speciesId)?.baseTotal ?? 0;
      if (bst < lowestBst) {
        lowestBst = bst;
        replaceIndex = index;
      }
    });
    result.party[replaceIndex] = chooseDonor(10);
  }
  for (let slot = 0; slot < totalDonors && result.party.length < 8; slot++) {
    result.party.push(chooseDonor(slot));
  }
  return result;
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
  if (isErEndlessContinuationActive()) {
    if (!trainerWave) {
      return null;
    }
    const existing = ghostByWave.get(waveIndex);
    if (existing) {
      return existing;
    }
    const allEligible = (prefetched ?? []).filter(snapshot => {
      const uploader = ghostUploaderKey(snapshot);
      const fingerprint = ghostTeamFingerprint(snapshot);
      return snapshot.isVictory
        && hasErGhostSavedItems(snapshot)
        && isErGhostTeamLegal(snapshot)
        && canUseErEndlessGhost(snapshot.id, uploader, fingerprint);
    });
    const returningNemesisId = getErEndlessReturningNemesisId();
    const returningNemesis = returningNemesisId == null
      ? undefined
      : (prefetched ?? []).find(snapshot =>
          snapshot.id === returningNemesisId
          && snapshot.isVictory
          && hasErGhostSavedItems(snapshot)
          && isErGhostTeamLegal(snapshot),
        );
    let route = getErEndlessGhostRoute();
    if (route == null && hasErEndlessRift("parallel-lives")) {
      const byUploader = new Map<string, GhostTeamSnapshot[]>();
      for (const snapshot of allEligible) {
        const key = ghostUploaderKey(snapshot);
        const group = byUploader.get(key) ?? [];
        group.push(snapshot);
        byUploader.set(key, group);
      }
      const candidates = [...byUploader.entries()].filter(([, snapshots]) => snapshots.length >= 3);
      if (candidates.length > 0) {
        const [sourceUserId, snapshots] = candidates[waveIndex % candidates.length];
        beginErEndlessGhostRoute({
          riftId: "parallel-lives",
          sourceUserId,
          sourceSnapshotId: snapshots[0].id,
          snapshotIds: snapshots.slice(0, 3).map(snapshot => snapshot.id),
        });
        route = getErEndlessGhostRoute();
      }
    }
    if (route == null && hasErEndlessRift("echo-hunt")) {
      const source = pickGhost(allEligible, waveIndex);
      if (source) {
        beginErEndlessGhostRoute({
          riftId: "echo-hunt",
          sourceUserId: ghostUploaderKey(source),
          sourceSnapshotId: source.id,
          snapshotIds: [source.id, source.id, source.id],
        });
        route = getErEndlessGhostRoute();
      }
    }
    const routeSnapshotId = route?.snapshotIds[route.encounterIndex];
    const routed = routeSnapshotId == null
      ? undefined
      : (prefetched ?? []).find(snapshot => snapshot.id === routeSnapshotId);
    const next = returningNemesis ?? routed ?? pickGhost(allEligible, waveIndex);
    if (!next) {
      return null;
    }
    const uploader = ghostUploaderKey(next);
    const fingerprint = ghostTeamFingerprint(next);
    recordErEndlessGhost(next.id, uploader, fingerprint);
    endlessGhostPicksSinceRefill++;
    if (endlessGhostPicksSinceRefill >= ENDLESS_GHOST_REFILL_INTERVAL) {
      endlessGhostPicksSinceRefill = 0;
      void requestErEndlessGhostPool();
    }
    const echoStage = route?.riftId === "echo-hunt"
      ? (Math.min(3, route.encounterIndex + 1) as 1 | 2 | 3)
      : undefined;
    const ranked = structuredClone(next);
    ranked.endlessNemesisRank = getErEndlessNemesisRank(next.id);
    const augmented = augmentErEndlessGhost(ranked, waveIndex, echoStage);
    if (route != null) {
      advanceErEndlessGhostRoute();
    }
    ghostByWave.set(waveIndex, augmented);
    lastGhostUploader = next.trainerName ?? "";
    beginErEndlessGhostEncounter(
      next.id,
      globalScene.getPlayerParty().reduce((sum, pokemon) => sum + pokemon.getMaxHp(), 0),
      next.endlessPerformance?.topPerformer === true,
    );
    return augmented;
  }
  // ER (#422): with the Ghost Trainers challenge active, EVERY trainer wave
  // is a ghost wave (the caller says whether this wave fields a trainer).
  // MYSTERY GAUNTLET (#814): the scripted ghost wave always fields a ghost when one
  // is available, regardless of the endgame wave table or the challenge.
  const gauntletGhost = erGauntletActive() && erGauntletWaveKind(waveIndex) === "ghost";
  const challengeGhost = trainerWave && isErGhostChallengeActive();
  const lateHellGhost = trainerWave && !challengeGhost && shouldUseLateHellGhostTrainer(waveIndex);
  if (!gauntletGhost && !isErGhostWave(waveIndex) && !challengeGhost && !lateHellGhost) {
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
    usedGhostUploaders.add(ghostUploaderKey(scripted));
    usedGhostTeamFingerprints.add(ghostTeamFingerprint(scripted));
    lastGhostUploader = scripted.trainerName ?? "";
    ghostByWave.set(waveIndex, scripted);
    console.log(`[er-ghost] wave ${waveIndex}: ghost '${scripted.trainerName}' (scripted gauntlet carrier)`);
    return scripted;
  }
  const pool = prefetched ?? [];
  const eligibilityWave = isErSprintRun() ? getErProgressionWave(waveIndex) : waveIndex;
  // A source run must have ended at or after this wave. Prefer an unseen source
  // within +20; allow +40 only when primary is empty. Snapshot ids, source
  // accounts, and semantic team hashes are never recycled during a run. If both
  // bands are empty, the caller fields a normal trainer.
  const challengeMode = isErGhostChallengeActive();
  const requireSavedItems = shouldRequireLateHellGhostItems(waveIndex);
  const legal = pool.filter(
    snapshot => isErGhostTeamLegal(snapshot) && (!requireSavedItems || hasErGhostSavedItems(snapshot)),
  );
  const unseen = legal.filter(snapshot => {
    return (
      !usedGhostIds.has(snapshot.id)
      && !usedGhostUploaders.has(ghostUploaderKey(snapshot))
      && !usedGhostTeamFingerprints.has(ghostTeamFingerprint(snapshot))
    );
  });
  const primary = unseen.filter(
    snapshot =>
      snapshot.waveReached >= eligibilityWave
      && snapshot.waveReached <= eligibilityWave + GHOST_PRIMARY_WAVE_WINDOW,
  );
  const fallback = unseen.filter(
    snapshot =>
      snapshot.waveReached >= eligibilityWave
      && snapshot.waveReached <= eligibilityWave + ER_GHOST_WAVE_WINDOW,
  );
  const next = pickGhost(primary.length > 0 ? primary : fallback, waveIndex);
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
  usedGhostUploaders.add(ghostUploaderKey(next));
  usedGhostTeamFingerprints.add(ghostTeamFingerprint(next));
  lastGhostUploader = next.trainerName ?? "";
  ghostByWave.set(waveIndex, next);
  return next;
}

/** Reset per-run ghost state (call on run start). */
export function resetErGhostRunState(): void {
  prefetched = null;
  prefetchStarted = false;
  endlessGhostPoolFetch = null;
  endlessGhostPoolRetryAfter = 0;
  endlessGhostPicksSinceRefill = 0;
  usedGhostIds.clear();
  usedGhostUploaders.clear();
  usedGhostTeamFingerprints.clear();
  ghostByWave.clear();
  requestedGhostBands.clear();
  ghostBandRetryAfter.clear();
  sharedCacheSeeded = false;
  lastGhostUploader = null;
}

export interface ErGhostRepeatLedgerSaveData {
  version: 1;
  snapshotIds: string[];
  uploaderKeys: string[];
  teamFingerprints: string[];
}

/** Compact run-save ledger; the shared candidate cache remains device-local. */
export function getErGhostRepeatLedger(): ErGhostRepeatLedgerSaveData {
  return {
    version: 1,
    snapshotIds: [...usedGhostIds],
    uploaderKeys: [...usedGhostUploaders],
    teamFingerprints: [...usedGhostTeamFingerprints],
  };
}

export function restoreErGhostRepeatLedger(data: ErGhostRepeatLedgerSaveData | undefined): void {
  prefetched = null;
  prefetchStarted = false;
  endlessGhostPoolFetch = null;
  endlessGhostPoolRetryAfter = 0;
  endlessGhostPicksSinceRefill = 0;
  ghostByWave.clear();
  requestedGhostBands.clear();
  ghostBandRetryAfter.clear();
  sharedCacheSeeded = false;
  lastGhostUploader = null;
  usedGhostIds.clear();
  usedGhostUploaders.clear();
  usedGhostTeamFingerprints.clear();
  if (data?.version !== 1) {
    return;
  }
  for (const id of data.snapshotIds ?? []) {
    if (typeof id === "string" && id.length <= 160) {
      usedGhostIds.add(id);
    }
  }
  for (const key of data.uploaderKeys ?? []) {
    if (typeof key === "string" && key.length <= 160) {
      usedGhostUploaders.add(key);
    }
  }
  for (const fingerprint of data.teamFingerprints ?? []) {
    if (typeof fingerprint === "string" && fingerprint.length <= 80) {
      usedGhostTeamFingerprints.add(fingerprint);
    }
  }
}

/**
 * A frozen capture of all per-run ghost cache and picker state. Capturing it fully
 * save/restores a client's ghost context in the two-engine harness.
 * Arrays/maps are shallow-COPIED so a later mutation of the live cache cannot bleed into a held snapshot
 * (and vice-versa); the {@linkcode GhostTeamSnapshot} elements are treated as immutable.
 */
export interface ErGhostRunStateSnapshot {
  prefetched: GhostTeamSnapshot[] | null;
  prefetchStarted: boolean;
  usedGhostIds: string[];
  usedGhostUploaders: string[];
  usedGhostTeamFingerprints: string[];
  ghostByWave: [number, GhostTeamSnapshot][];
  requestedGhostBands: string[];
  ghostBandRetryAfter: [string, number][];
  sharedCacheSeeded: boolean;
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
    usedGhostUploaders: [...usedGhostUploaders],
    usedGhostTeamFingerprints: [...usedGhostTeamFingerprints],
    ghostByWave: [...ghostByWave.entries()],
    requestedGhostBands: [...requestedGhostBands],
    ghostBandRetryAfter: [...ghostBandRetryAfter.entries()],
    sharedCacheSeeded,
    lastGhostUploader,
  };
}

/**
 * TWO-ENGINE co-op harness (#633 bounded-scope): install a previously-{@linkcode snapshotErGhostRunState}d
 * ghost cache as the live per-run state (the inverse of the snapshot). Re-copies
 * collections so the live cache never aliases the held snapshot. Production never calls this.
 */
export function restoreErGhostRunState(snap: ErGhostRunStateSnapshot): void {
  prefetched = snap.prefetched == null ? null : [...snap.prefetched];
  prefetchStarted = snap.prefetchStarted;
  usedGhostIds.clear();
  for (const id of snap.usedGhostIds) {
    usedGhostIds.add(id);
  }
  usedGhostUploaders.clear();
  for (const key of snap.usedGhostUploaders ?? []) {
    usedGhostUploaders.add(key);
  }
  usedGhostTeamFingerprints.clear();
  for (const fingerprint of snap.usedGhostTeamFingerprints ?? []) {
    usedGhostTeamFingerprints.add(fingerprint);
  }
  ghostByWave.clear();
  for (const [wave, team] of snap.ghostByWave) {
    ghostByWave.set(wave, team);
  }
  requestedGhostBands.clear();
  for (const key of snap.requestedGhostBands ?? []) {
    requestedGhostBands.add(key);
  }
  ghostBandRetryAfter.clear();
  for (const [key, retryAt] of snap.ghostBandRetryAfter ?? []) {
    ghostBandRetryAfter.set(key, retryAt);
  }
  sharedCacheSeeded = snap.sharedCacheSeeded ?? false;
  lastGhostUploader = snap.lastGhostUploader;
}

/** A CLEAN (empty) ghost-cache snapshot: the per-client starting slate for the duo harness swap. */
export function emptyErGhostRunStateSnapshot(): ErGhostRunStateSnapshot {
  return {
    prefetched: null,
    prefetchStarted: false,
    usedGhostIds: [],
    usedGhostUploaders: [],
    usedGhostTeamFingerprints: [],
    ghostByWave: [],
    requestedGhostBands: [],
    ghostBandRetryAfter: [],
    sharedCacheSeeded: false,
    lastGhostUploader: null,
  };
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
const ENDLESS_GHOST_VITAMINS = new WeakMap<Trainer, number[][]>();

function getRoleVector(stats: readonly number[]): readonly [number, number, number] {
  const total = Math.max(1, stats.reduce((sum, value) => sum + value, 0));
  const offense = Math.max(1, stats[Stat.ATK] + stats[Stat.SPATK]);
  return [
    (stats[Stat.ATK] - stats[Stat.SPATK]) / offense,
    stats[Stat.SPD] / total,
    (stats[Stat.HP] + stats[Stat.DEF] + stats[Stat.SPDEF]) / total,
  ];
}

function roleDistance(left: readonly number[], right: readonly number[]): number {
  return left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);
}

function distributeVitamins(member: GhostMember, total: number): number[] {
  const species = getPokemonSpecies(member.speciesId);
  const result = PERMANENT_STATS.map(() => 0);
  if (!species || total <= 0) {
    return result;
  }
  const weights = species.baseStats.map(value => Math.max(1, value));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const credit = PERMANENT_STATS.map(() => 0);
  let remaining = total;
  while (remaining > 0 && PERMANENT_STATS.some(stat => result[stat] < Math.max(0, member.ivs[stat] ?? 0))) {
    let chosen: PermanentStat | null = null;
    for (const stat of PERMANENT_STATS) {
      if (result[stat] >= Math.max(0, member.ivs[stat] ?? 0)) {
        continue;
      }
      credit[stat] += weights[stat];
      if (chosen == null || credit[stat] > credit[chosen]) {
        chosen = stat;
      }
    }
    if (chosen == null) {
      break;
    }
    result[chosen]++;
    credit[chosen] -= weightTotal;
    remaining--;
  }
  return result;
}

function buildEndlessGhostVitaminPlan(snapshot: GhostTeamSnapshot): number[][] {
  const playerParty = globalScene.getPlayerParty();
  const vitaminByPokemon = new Map<number, number[]>();
  for (const pokemon of playerParty) {
    vitaminByPokemon.set(pokemon.id, PERMANENT_STATS.map(() => 0));
  }
  for (const modifier of globalScene.findModifiers(candidate => candidate instanceof BaseStatModifier, true)) {
    const vitamin = modifier as BaseStatModifier;
    const profile = vitaminByPokemon.get(vitamin.pokemonId);
    if (profile) {
      profile[vitamin.getStat()] += vitamin.getStackCount();
    }
  }
  const players = playerParty.map(pokemon => ({
    role: getRoleVector(pokemon.getSpeciesForm().baseStats),
    total: (vitaminByPokemon.get(pokemon.id) ?? []).reduce((sum, value) => sum + value, 0),
  }));
  const unused = new Set(players.map((_player, index) => index));
  return snapshot.party.map(member => {
    if (players.length === 0) {
      return PERMANENT_STATS.map(() => 0);
    }
    const species = getPokemonSpecies(member.speciesId);
    const role = getRoleVector(species?.baseStats ?? [1, 1, 1, 1, 1, 1]);
    const candidates = unused.size > 0 ? [...unused] : players.map((_player, index) => index);
    const match = candidates.reduce((best, index) =>
      roleDistance(role, players[index].role) < roleDistance(role, players[best].role) ? index : best,
    candidates[0]);
    unused.delete(match);
    return distributeVitamins(member, players[match].total);
  });
}

function applyEndlessGhostVitamins(trainer: Trainer, enemy: EnemyPokemon, memberIndex: number): void {
  const snapshot = GHOST_BY_TRAINER.get(trainer);
  if (!snapshot || !isErEndlessContinuationActive()) {
    return;
  }
  let plan = ENDLESS_GHOST_VITAMINS.get(trainer);
  if (!plan) {
    plan = buildEndlessGhostVitaminPlan(snapshot);
    ENDLESS_GHOST_VITAMINS.set(trainer, plan);
  }
  for (const stat of PERMANENT_STATS) {
    const count = plan[memberIndex]?.[stat] ?? 0;
    if (count <= 0) {
      continue;
    }
    const type = new BaseStatBoosterModifierType(stat).withIdFromFunc(modifierTypes.BASE_STAT_BOOSTER);
    const modifier = type.newModifier(enemy) as BaseStatModifier | null;
    if (modifier) {
      modifier.stackCount = count;
      globalScene.addEnemyModifier(modifier, true, true);
    }
  }
  enemy.calculateStats();
}

function getEndlessGhostLevel(fallback: number, runWave: number): number {
  if (!isErEndlessContinuationActive()) {
    return fallback;
  }
  const playerTopLevel = globalScene.getPlayerParty().reduce(
    (highest, pokemon) => pokemon.isAllowedInBattle() ? Math.max(highest, pokemon.level) : highest,
    0,
  );
  if (playerTopLevel <= 0) {
    return fallback;
  }
  const baseOffset = getErDifficulty() === "youngster" ? 2 : getErDifficulty() === "ace" ? 1 : 0;
  const depth = getErEndlessEquivalentDepth(runWave);
  const offset = Math.ceil(baseOffset * Math.max(0, 20 - depth) / 20);
  return Math.max(1, playerTopLevel - offset);
}

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
  const size = Math.min(snapshot.party.length, isErEndlessContinuationActive() ? 8 : MAX_PARTY);
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

/** Whether a Pokemon belongs to the enemy side of the active ghost battle. */
export function isErGhostEnemyPokemon(pokemon: Pokemon | null | undefined): boolean {
  const trainer = globalScene?.currentBattle?.trainer;
  return !!pokemon?.isEnemy() && !!trainer && GHOST_BY_TRAINER.has(trainer);
}

/**
 * The full ghost snapshot backing this trainer, or `null` when it is not an ER ghost.
 * The ghost identity lives ONLY in the in-memory {@linkcode GHOST_BY_TRAINER} WeakMap,
 * which a save/reload wipes - so {@linkcode TrainerData} persists this snapshot and
 * re-applies it via {@linkcode markTrainerAsGhost} on reconstruction, restoring the
 * ghost's name, BGM, and authored presentation mid-battle (#ghost-identity).
 */
export function getErGhostSnapshot(trainer: Trainer): GhostTeamSnapshot | null {
  return GHOST_BY_TRAINER.get(trainer) ?? null;
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
    const runWave = battle?.waveIndex ?? snapshot.waveReached;
    const currentWave = isErSprintRun() ? getErProgressionWave(runWave) : runWave;
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
    const level = getEndlessGhostLevel(battle?.enemyLevels?.[index] ?? member.level, runWave);
    const trainerSlot = !trainer.isDouble() || !(index % 2) ? TrainerSlot.TRAINER : TrainerSlot.TRAINER_PARTNER;
    // addEnemyPokemon runs the universal BST gate. Ghost selection's +40-wave
    // window is not sufficient on its own: the uploader may already own a
    // legendary or mega. Over-cap members are therefore devolved/replaced here.
    const enemy = globalScene.addEnemyPokemon(species, level, trainerSlot);
    // Restore the stored loadout only when the species survived the gate. A second
    // gate pass after party construction validates the restored form itself, so a
    // stored mega cannot bypass the cap through a legal base species.
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
    Object.assign(enemy.customPokemonData, getErGhostMemberCustomData(member));
    if (member.moves.length > 0 && speciesMatchesStored) {
      const moves = member.moves.map(id => new PokemonMove(id));
      enemy.moveset = moves;
      enemy.summonData.moveset = moves;
    }
    // else: keep the level-appropriate moveset addEnemyPokemon already generated for the
    // final (devolved or BST-swapped) species.
    enemy.generateName();
    applyEndlessGhostVitamins(trainer, enemy, index);
    return enemy;
  } catch {
    return null;
  }
}
