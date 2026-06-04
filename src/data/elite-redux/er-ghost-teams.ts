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
import { type ErDifficulty, getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { ghostWavesForCurrentRun, isErGhostWave } from "#data/elite-redux/er-ghost-waves";
import { TrainerPartyTemplate } from "#data/trainers/trainer-party-template";
import type { Nature } from "#enums/nature";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { TrainerSlot } from "#enums/trainer-slot";
import type { EnemyPokemon } from "#field/pokemon";
import type { Trainer } from "#field/trainer";
import { PokemonMove } from "#moves/pokemon-move";
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
}

const MAX_PARTY = 6;
const LOCAL_STORE_CAP = 25;
const MIN_RECORD_WAVE = 100;
const PREFETCH_WAVE = 150;

// -----------------------------------------------------------------------------
// Env + local storage helpers.
// -----------------------------------------------------------------------------
function endpoint(): string {
  const value = (import.meta.env as Record<string, unknown> | undefined)?.VITE_GHOST_ENDPOINT;
  return typeof value === "string" ? value : "";
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
  return {
    id: `${globalScene?.seed ?? "seed"}-${Date.now()}`,
    trainerName: loggedInUser?.username ?? "Trainer",
    difficulty: getErDifficulty(),
    waveReached,
    isVictory,
    timestamp: Date.now(),
    party: partyData,
  };
}

async function uploadGhostTeam(snapshot: GhostTeamSnapshot): Promise<boolean> {
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
 * Record the just-finished run as a ghost team: store it locally (so the player
 * always has a self-seeded pool) and upload it to the shared API when one is
 * configured. Only records victories or sufficiently deep runs. Never throws.
 */
export function recordGhostTeamOnGameOver(isVictory: boolean): void {
  try {
    const wave = globalScene?.currentBattle?.waveIndex ?? 0;
    if (!isVictory && wave < MIN_RECORD_WAVE) {
      return;
    }
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

async function fetchGhostTeams(difficulty: ErDifficulty, count: number): Promise<GhostTeamSnapshot[]> {
  const url = endpoint();
  if (url && typeof fetch === "function") {
    try {
      const sep = url.includes("?") ? "&" : "?";
      const res = await fetch(`${url}${sep}difficulty=${encodeURIComponent(difficulty)}&count=${count}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
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
  // Local fallback: the player's own stored teams (prefer the right difficulty),
  // most-recent first.
  const local = loadLocalGhostTeams().filter(isValidSnapshot);
  const matched = local.filter(s => s.difficulty === difficulty);
  return (matched.length > 0 ? matched : local).slice().reverse();
}

/**
 * Kick off (once, lazily) pre-fetching enough ghost teams for the run's
 * difficulty. Safe to call every wave — it only fires once, around wave 150.
 */
export function maybePrefetchGhostTeams(waveIndex: number): void {
  if (prefetchStarted || waveIndex < PREFETCH_WAVE) {
    return;
  }
  const waves = ghostWavesForCurrentRun();
  if (waves.length === 0) {
    return;
  }
  prefetchStarted = true;
  void fetchGhostTeams(getErDifficulty(), waves.length)
    .then(teams => {
      prefetched = teams;
    })
    .catch(() => {
      prefetched = [];
    });
}

/**
 * The ghost team to field on `waveIndex`, or `null` if none is available yet.
 * Stable within a run: the same wave always yields the same ghost.
 */
export function takeGhostForWave(waveIndex: number): GhostTeamSnapshot | null {
  if (!isErGhostWave(waveIndex)) {
    return null;
  }
  const existing = ghostByWave.get(waveIndex);
  if (existing) {
    return existing;
  }
  const pool = prefetched ?? [];
  const next = pool.find(s => !usedGhostIds.has(s.id));
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
    const species = getPokemonSpecies(member.speciesId);
    if (!species) {
      return null;
    }
    const battle = globalScene.currentBattle;
    const level = battle?.enemyLevels?.[index] ?? member.level;
    const trainerSlot = !trainer.isDouble() || !(index % 2) ? TrainerSlot.TRAINER : TrainerSlot.TRAINER_PARTNER;
    const enemy = globalScene.addEnemyPokemon(species, level, trainerSlot);
    if (member.formIndex >= 0) {
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
    if (member.moves.length > 0) {
      const moves = member.moves.map(id => new PokemonMove(id));
      enemy.moveset = moves;
      enemy.summonData.moveset = moves;
    }
    enemy.generateName();
    return enemy;
  } catch {
    return null;
  }
}
