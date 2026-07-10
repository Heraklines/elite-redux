/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - social achievement detection (#900): Showdown 1v1 PvP, co-op
// runs, and the Shiny Lab collection feats.
//
// Split into two layers so the whole ruleset is unit-testable WITHOUT a battle
// engine:
//   - PURE evaluators (`evaluate*`) take a plain context + counters and return the
//     achievement KEYS that should fire. No globals, no side effects.
//   - RECORD functions gather the live context from `globalScene` / the showdown +
//     co-op runtime and hand it to the matching evaluator, then unlock via
//     `globalScene.validateAchv`. These are the observer hooks called from the phase
//     sites.
//
// DETECTION IS A PURE OBSERVER. It fires `validateAchv` LOCALLY on whichever client
// runs the hook and NEVER sends anything over the wire, so it can't perturb the
// showdown escrow, the wager barrier, or the co-op sync/relay. Co-op wave + catch
// hooks run on BOTH clients (each client's own VictoryPhase / capture path), so each
// player's own account unlocks independently - the same "credit both accounts"
// pattern the catch path already follows. Every unlock rides the normal system-save
// cycle (like every other achievement); nothing is force-saved here.
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  decodeErShinyLabParams,
  ER_SHINY_LAB_CATEGORIES,
  getErShinyLabOwnedSet,
} from "#data/elite-redux/er-shiny-lab-effects";
import {
  getShowdownMatchId,
  getShowdownOpponentManifest,
  getShowdownOwnManifest,
  isShowdownBattleActive,
} from "#data/elite-redux/showdown/showdown-battle-state";
import type { Pokemon } from "#field/pokemon";
import { type Achv, achvs } from "#system/achv";

/** Unlock every achievement in `ids` (keys of `achvs`). Unknown keys are skipped. */
function fireAchvs(ids: readonly string[]): void {
  const registry = achvs as Record<string, Achv>;
  for (const id of ids) {
    const achv = registry[id];
    if (achv) {
      globalScene.validateAchv(achv);
    }
  }
}

// --- Showdown 1v1 PvP --------------------------------------------------------

/** The negotiated stake of the most recently committed Showdown match (consumed at the result). */
let pendingShowdownStakeShiny = false;
let pendingShowdownStaked = false;
/** Whether any LOCAL player Pokemon Mega Evolved during the active Showdown match (Raw Talent). */
let pendingShowdownOwnMegaUsed = false;

/**
 * Observer for a Mega Evolution during a Showdown match. Called from the form-change phase's
 * mega branch; records only the LOCAL player's megas while a Showdown battle is active. The
 * flag is consumed + cleared at the terminal result. Guarded so it can never disturb the
 * form change.
 */
export function erNoteShowdownPlayerMega(pokemon: Pokemon): void {
  try {
    if (isShowdownBattleActive() && pokemon.isPlayer()) {
      pendingShowdownOwnMegaUsed = true;
    }
  } catch (e) {
    console.warn("[er-social-achv] showdown mega note failed:", e);
  }
}

/** Live match outcome facts read at the terminal Showdown result phase. */
export interface ShowdownResultContext {
  /** The LOCAL player won the duel. */
  won: boolean;
  /** The match voided (no winner) - completes nothing, unlocks nothing. */
  voided: boolean;
  /** A real (escrow) stake was on the line. */
  staked: boolean;
  /** The stake was a shiny Pokemon (implies `staked`). */
  stakeShiny: boolean;
  /** Sum of the LOCAL team's field-legality base costs. */
  ownTeamCost: number;
  /** Sum of the OPPONENT team's field-legality base costs. */
  oppTeamCost: number;
  /** The HIGHEST base starter cost across the LOCAL team (0 when the manifest is unknown). */
  ownTeamMaxCost: number;
  /** At least one of the local player's Pokemon fainted during the match. */
  anyOwnFainted: boolean;
  /** At least one of the local player's Pokemon Mega Evolved during the match. */
  ownMegaUsed: boolean;
}

/** Persistent Showdown tallies (mirrors `gameData.gameStats`), post-increment. */
export interface ShowdownCounters {
  matchesPlayed: number;
  wins: number;
}

/**
 * PURE: the Showdown achievements a completed match unlocks. `counters` are the
 * ALREADY-incremented tallies (matches always ++ on a non-void; wins ++ on a win).
 * A void completes nothing.
 */
export function evaluateShowdownResult(ctx: ShowdownResultContext, counters: ShowdownCounters): string[] {
  if (ctx.voided) {
    return [];
  }
  const ids: string[] = [];
  // Participation: friendly OR staked, win OR lose - all count toward Good Sport.
  if (counters.matchesPlayed >= 10) {
    ids.push("GOOD_SPORT");
  }
  // The House Remembers: LOSE a match where you staked a shiny (settlement transfers it away).
  // A loss-side feat (gambler's consolation), so it sits outside the win-only block below.
  if (!ctx.won && ctx.staked && ctx.stakeShiny) {
    ids.push("THE_HOUSE_REMEMBERS");
  }
  if (ctx.won) {
    ids.push("FIRST_BLOOD");
    // Lifetime win-count records (renamed from RIVAL_RECORD_N to the Duelist ranks).
    if (counters.wins >= 5) {
      ids.push("DUELIST");
    }
    if (counters.wins >= 25) {
      ids.push("VETERAN_DUELIST");
    }
    if (counters.wins >= 100) {
      ids.push("LEGENDARY_DUELIST");
    }
    if (ctx.staked) {
      ids.push("HIGH_ROLLER");
    }
    if (ctx.staked && ctx.stakeShiny) {
      ids.push("ALL_IN");
    }
    if (!ctx.anyOwnFainted) {
      ids.push("FLAWLESS_DUEL");
    }
    if (ctx.ownTeamCost > 0 && ctx.oppTeamCost > 0 && ctx.ownTeamCost < ctx.oppTeamCost) {
      ids.push("DAVID_AND_GOLIATH");
    }
    // Raw Talent: win without Mega Evolving any of your own Pokemon.
    if (!ctx.ownMegaUsed) {
      ids.push("RAW_TALENT");
    }
    // Budget feats: every LOCAL mon's base starter cost at or below the bracket (harder = lower).
    if (ctx.ownTeamMaxCost > 0 && ctx.ownTeamMaxCost <= 3) {
      ids.push("BUDGET_CHAMPION");
    }
    if (ctx.ownTeamMaxCost > 0 && ctx.ownTeamMaxCost <= 2) {
      ids.push("RAGS_TO_RICHES");
    }
    // Apex Predator: >= 80% lifetime win rate over >= 25 matches (event-gated, no back-pay).
    if (counters.matchesPlayed >= 25 && counters.wins / counters.matchesPlayed >= 0.8) {
      ids.push("APEX_PREDATOR");
    }
  }
  return ids;
}

/**
 * Stash the committed match's stake so the terminal result phase can award All In /
 * High Roller (the win/loss isn't known until the match resolves). Called from the
 * wager `onCommit` hook on each client with ITS OWN offer (both sides must match
 * tier, so the local offer's shiny-ness is the match stake). `staked` is whether the
 * commit produced a real escrow match id.
 */
export function erRecordShowdownStakeCommit(staked: boolean, stakeShiny: boolean): void {
  pendingShowdownStaked = staked;
  pendingShowdownStakeShiny = stakeShiny;
}

/** Sum of a manifest team's field-legality base costs (David and Goliath). */
function manifestTeamCost(manifest: { baseCost: number }[] | null): number {
  if (!manifest) {
    return 0;
  }
  let total = 0;
  for (const mon of manifest) {
    total += mon.baseCost ?? 0;
  }
  return total;
}

/** Highest base starter cost across a manifest team (Budget feats; 0 when unknown/empty). */
function manifestTeamMaxCost(manifest: { baseCost: number }[] | null): number {
  if (!manifest || manifest.length === 0) {
    return 0;
  }
  let max = 0;
  for (const mon of manifest) {
    max = Math.max(max, mon.baseCost ?? 0);
  }
  return max;
}

/**
 * Observer for the terminal Showdown result. MUST be called BEFORE `endShowdownBattle`
 * drops the match id + manifests (i.e. at the top of ShowdownResultPhase.start). Reads
 * the outcome live, bumps the persistent match/win tallies, and unlocks. Fully guarded:
 * an error here can never strand the return to title.
 */
export function erRecordShowdownResult(won: boolean, voided: boolean): void {
  try {
    // Consume the stashed stake (one match at a time; clear so it can't leak forward).
    const staked = pendingShowdownStaked || getShowdownMatchId() != null;
    const stakeShiny = pendingShowdownStakeShiny;
    // Consume the per-match mega flag alongside the stake (cleared so it can't leak forward).
    const ownMegaUsed = pendingShowdownOwnMegaUsed;
    pendingShowdownStaked = false;
    pendingShowdownStakeShiny = false;
    pendingShowdownOwnMegaUsed = false;

    const stats = globalScene.gameData.gameStats;
    if (!voided) {
      stats.showdownMatchesPlayed = (stats.showdownMatchesPlayed ?? 0) + 1;
      if (won) {
        stats.showdownWins = (stats.showdownWins ?? 0) + 1;
      }
    }

    const ownManifest = getShowdownOwnManifest();
    const ctx: ShowdownResultContext = {
      won,
      voided,
      staked,
      stakeShiny,
      ownTeamCost: manifestTeamCost(ownManifest),
      oppTeamCost: manifestTeamCost(getShowdownOpponentManifest()),
      ownTeamMaxCost: manifestTeamMaxCost(ownManifest),
      anyOwnFainted: globalScene.getPlayerParty().some(mon => mon.isFainted()),
      ownMegaUsed,
    };
    fireAchvs(
      evaluateShowdownResult(ctx, {
        matchesPlayed: stats.showdownMatchesPlayed ?? 0,
        wins: stats.showdownWins ?? 0,
      }),
    );
  } catch (e) {
    console.warn("[er-social-achv] showdown result detection failed:", e);
  }
}

// --- Co-op runs --------------------------------------------------------------

/** Facts read at a co-op wave clear (the VictoryPhase win branch, both clients). */
export interface CoopWaveContext {
  isCoop: boolean;
  waveIndex: number;
  isWaveFinal: boolean;
  difficultyHell: boolean;
}

/** PURE: the co-op wave-milestone achievements a co-op wave clear unlocks. */
export function evaluateCoopWaveWon(ctx: CoopWaveContext): string[] {
  if (!ctx.isCoop) {
    return [];
  }
  // First co-op win of all time (validateAchv dedupes, so this only ever fires once).
  const ids: string[] = ["CO_OP_INITIATE"];
  if (ctx.waveIndex >= 10) {
    ids.push("BETTER_TOGETHER");
  }
  if (ctx.waveIndex >= 50) {
    ids.push("PARTNERS_IN_CRIME");
  }
  if (ctx.waveIndex >= 100) {
    ids.push("LONG_HAUL_DUO");
  }
  if (ctx.waveIndex >= 150) {
    ids.push("THE_LONG_ROAD");
  }
  if (ctx.isWaveFinal) {
    ids.push("DYNAMIC_DUO");
  }
  // Century of Trouble: reach wave 100 in co-op on Hell (retuned up from the old wave-25 gate,
  // which was not reward-worthy).
  if (ctx.waveIndex >= 100 && ctx.difficultyHell) {
    ids.push("CENTURY_OF_TROUBLE");
  }
  return ids;
}

/** Observer for a co-op wave clear (called from the tracker's wave-won hook, both clients). */
export function erRecordCoopWaveWon(): void {
  try {
    const gameMode = globalScene.gameMode;
    if (!gameMode.isCoop) {
      return;
    }
    const waveIndex = globalScene.currentBattle.waveIndex;
    fireAchvs(
      evaluateCoopWaveWon({
        isCoop: true,
        waveIndex,
        isWaveFinal: gameMode.isWaveFinal(waveIndex),
        difficultyHell: getErDifficulty() === "hell",
      }),
    );
  } catch (e) {
    console.warn("[er-social-achv] coop wave detection failed:", e);
  }
}

/**
 * Observer for handing a Pokemon to a co-op partner (Generous Soul). Called from the
 * party UI on a successful give (co-op only). Fires on the GIVER's client.
 */
export function erRecordCoopGiveToPartner(): void {
  try {
    if (globalScene.gameMode.isCoop) {
      fireAchvs(["GENEROUS_SOUL"]);
    }
  } catch (e) {
    console.warn("[er-social-achv] coop give detection failed:", e);
  }
}

/**
 * Observer for reviving a fainted Pokemon (Guardian Angel). Fires only when the revived
 * mon belongs to the co-op PARTNER (its `coopOwner` differs from this client's role).
 */
export function erRecordCoopRevivePartnerMon(pokemon: Pokemon): void {
  try {
    if (!globalScene.gameMode.isCoop) {
      return;
    }
    // `coopOwner` lives on PlayerPokemon; narrow off the base Pokemon type (same idiom as
    // pokemon.ts's data-source read) since the revive apply hands us a base Pokemon.
    const monOwner = (pokemon as { coopOwner?: CoopRole }).coopOwner;
    if (monOwner == null) {
      return;
    }
    // The local role lives on the (heavy) co-op runtime; import it LAZILY so this module's
    // static graph never pulls the co-op engine (which would cycle back through modifier /
    // pokemon class init). Fire-and-forget: the unlock need not be synchronous with the revive.
    void import("#data/elite-redux/coop/coop-runtime")
      .then(m => {
        const localRole = m.getCoopController()?.role;
        if (localRole != null && monOwner !== localRole) {
          fireAchvs(["GUARDIAN_ANGEL"]);
        }
      })
      .catch(() => {});
  } catch (e) {
    console.warn("[er-social-achv] coop revive detection failed:", e);
  }
}

/**
 * Observer for catching a legendary during a co-op run (Shared Triumph). Called from
 * the existing catch hook. Runs on both clients (each credits its own account).
 */
export function erRecordCoopLegendaryCatch(pokemon: Pokemon): void {
  try {
    if (globalScene.gameMode.isCoop && pokemon.species.legendary) {
      fireAchvs(["SHARED_TRIUMPH"]);
    }
  } catch (e) {
    console.warn("[er-social-achv] coop legendary detection failed:", e);
  }
}

// --- Triple Battles ----------------------------------------------------------

/** Facts read at a Triple Battle win (populated by the tracker's per-battle KO maps). */
export interface TripleWaveContext {
  /** The just-won wave was a triple-format battle. */
  isTriple: boolean;
  /** The persistent triple-win tally, AFTER this win's increment. */
  tripleWins: number;
  /** Any of the player's Pokemon fainted during this battle. */
  playerFainted: boolean;
  /** The battle was against a ghost trainer. */
  ghostTrainer: boolean;
  /** The run is on Hell difficulty. */
  difficultyHell: boolean;
  /** The same center-slot player mon personally KO'd all three foes. */
  centerMonSweptAll: boolean;
  /** All three foes were knocked out on a single turn. */
  oneTurnClear: boolean;
}

/** PURE: the Triple Battle achievements a triple win unlocks. */
export function evaluateTripleWaveWon(ctx: TripleWaveContext): string[] {
  if (!ctx.isTriple) {
    return [];
  }
  // First triple win of all time (validateAchv dedupes, so it only fires once).
  const ids: string[] = ["THREES_COMPANY"];
  if (ctx.tripleWins >= 10) {
    ids.push("TRIPLE_THREAT");
  }
  if (ctx.tripleWins >= 25) {
    ids.push("TRIPLE_DOWN");
  }
  if (!ctx.playerFainted) {
    ids.push("HOLD_THE_LINE");
  }
  if (ctx.ghostTrainer) {
    ids.push("GHOST_TRIAD");
  }
  if (ctx.difficultyHell) {
    ids.push("TRIAD_OF_HELL");
  }
  if (ctx.centerMonSweptAll) {
    ids.push("CENTER_STAGE");
  }
  if (ctx.oneTurnClear) {
    ids.push("ONE_TURN_CLEAR");
  }
  return ids;
}

// --- Shiny Lab collection ----------------------------------------------------

/** PURE: the "own N effects across species" milestones for a total owned count. */
export function evaluateLookCollector(ownedCount: number): string[] {
  const ids: string[] = [];
  if (ownedCount >= 10) {
    ids.push("LOOK_COLLECTOR_10");
  }
  if (ownedCount >= 25) {
    ids.push("LOOK_COLLECTOR_25");
  }
  if (ownedCount >= 50) {
    ids.push("LOOK_COLLECTOR_50");
  }
  if (ownedCount >= 100) {
    ids.push("LOOK_COLLECTOR_100");
  }
  return ids;
}

/** PURE: Fashionista (a full three-slot look) + Curator (five named presets on one mon). */
export function evaluateShinyLabLoadout(
  loadout: { palette: string | null; surface: string | null; around: string | null },
  namedPresetCount: number,
): string[] {
  const ids: string[] = [];
  if (loadout.palette && loadout.surface && loadout.around) {
    ids.push("FASHIONISTA");
  }
  if (namedPresetCount >= 5) {
    ids.push("PRESET_CURATOR");
  }
  return ids;
}

/** Total Shiny Lab effects owned across EVERY species' starter data (live count). */
function totalOwnedShinyLabEffects(): number {
  let total = 0;
  for (const entry of Object.values(globalScene.gameData.starterData)) {
    const save = entry?.erShinyLab;
    if (!save) {
      continue;
    }
    for (const category of ER_SHINY_LAB_CATEGORIES) {
      total += getErShinyLabOwnedSet(save, category).size;
    }
  }
  return total;
}

/** Observer for a Shiny Lab effect purchase (the Look Collector milestones). */
export function erRecordShinyLabEffectPurchased(): void {
  try {
    fireAchvs(evaluateLookCollector(totalOwnedShinyLabEffects()));
  } catch (e) {
    console.warn("[er-social-achv] shiny lab collection detection failed:", e);
  }
}

/** Observer for a Shiny Lab loadout / preset change (Fashionista + Curator). */
export function erRecordShinyLabLoadout(
  loadout: { palette: string | null; surface: string | null; around: string | null },
  namedPresetCount: number,
): void {
  try {
    fireAchvs(evaluateShinyLabLoadout(loadout, namedPresetCount));
  } catch (e) {
    console.warn("[er-social-achv] shiny lab loadout detection failed:", e);
  }
}

/**
 * Observer for Signature Style: winning a BOSS wave with a Pokemon that wears a named
 * Shiny Lab preset AND the name effect. Called from the wave-won hook; gated to boss
 * waves (every 10th). Reads each party mon's persisted Shiny Lab save directly.
 */
export function erRecordSignatureStyleBossWin(): void {
  try {
    if (globalScene.currentBattle.waveIndex % 10 !== 0) {
      return;
    }
    const gameData = globalScene.gameData;
    for (const mon of globalScene.getPlayerParty()) {
      const rootId = gameData.getRootStarterSpeciesId(mon.species.speciesId);
      const save = gameData.starterData[rootId]?.erShinyLab;
      if (!save) {
        continue;
      }
      const named = typeof save.ln === "string" && save.ln.length > 0;
      const nameFx = decodeErShinyLabParams(save.q).nameFx;
      if (named && nameFx) {
        fireAchvs(["SIGNATURE_STYLE"]);
        return;
      }
    }
  } catch (e) {
    console.warn("[er-social-achv] signature style detection failed:", e);
  }
}
