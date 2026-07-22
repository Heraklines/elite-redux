/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT bracket engine — PURE domain (Showdown Tournament P1).
// Zero Cloudflare deps and zero client deps: a single-elimination bracket over
// plain records, so it imports cleanly into a plain vitest (the worker-test
// pattern from showdown-escrow) AND its SHAPE is re-declared client-side for
// rendering (the worker cannot import client code, the client cannot import the
// worker build — see showdown-stakes ↔ showdown-escrow). ALL decision logic
// lives HERE so it is exhaustively unit-testable.
//
// FORMAT (locked, design doc 2026-07-14): SINGLE ELIMINATION, byes for
// non-power-of-2 fields. Seeds place #1 and #2 on opposite halves (standard
// bracket ordering); byes go to the TOP seeds. The bracket ADVANCE is
// server-authoritative — clients render what the worker says.
//
// PARTICIPANT identity is a stable string (the account USERNAME, the token `u`)
// — the same key escrow uses. `null` in a slot means BYE / TBD.
//
// ATTESTATION (design doc "result report ... same attestation the escrow flow
// uses"): a match result settles ONLY from AGREEING reports by BOTH paired
// accounts, or an organizer override. A lone report stays pending (P1 resolves a
// stalled match via the organizer route; P2 adds presence-based activity wins).
// =============================================================================

/** A participant is an account username (the token `u`) — mirrors escrow's `Participant`. */
export type Participant = string;

/** How a match's winner was decided. */
export type MatchResolution =
  | "pending" // no winner yet
  | "bye" // auto-advanced (single real player, opponent was a bye)
  | "reported" // settled by AGREEING dual attestation from both paired accounts
  | "manual" // settled by an organizer override
  | "walkover" // opponent auto-advanced because the other player was KICKED (admin, P3)
  | "activity" // P2 deadline auto-resolution: the ONLY player present in the lobby during the window advances
  | "seed"; // P2 deadline auto-resolution: neither (or both) present -> the higher seed advances

/** One player's attestation of a match outcome, with the epoch-ms it first arrived. */
export interface MatchReport {
  reporter: Participant;
  winner: Participant;
  /** Epoch ms of the FIRST report from this reporter (re-reports keep this fixed). */
  at: number;
}

/**
 * One settled game within a SERIES (best-of-3 / best-of-5) match. Each game is its own
 * dual-attested result; the game's winner is recorded here once both paired players agree.
 * Absent/empty on a single-game match (backward compatible).
 */
export interface SeriesGame {
  /** 0-based game number within the series. */
  gameIndex: number;
  /** The dual-attested winner of this game (one of the match's paired players). */
  winner: Participant;
}

/** Pending dual-attestation reports for ONE not-yet-settled game of a series, keyed by gameIndex. */
export interface SeriesGameReports {
  gameIndex: number;
  reports: MatchReport[];
}

/** One bracket match. `a`/`b` are participants or null (bye/TBD). */
export interface BracketMatch {
  /** Stable id: `${tournamentId}-r${round}-m${slot}` (round + slot both 0-based). */
  id: string;
  /** 0-based round index (0 = first round). */
  round: number;
  /** 0-based slot within the round. */
  slot: number;
  a: Participant | null;
  b: Participant | null;
  /** The winner's participant id, or null while undecided. */
  winner: Participant | null;
  resolution: MatchResolution;
  /** Epoch ms this match must be played by (per-round window), or null. */
  deadline: number | null;
  /** Dual-attestation reports (at most one per paired account). */
  reports: MatchReport[];
  /** True once the two reports CONFLICT — needs an organizer manual resolve. */
  disputed: boolean;
  /**
   * P2 activity-win aggregate: the paired players who were PRESENT in the tournament lobby DURING
   * this match's window (recorded per presence ping while now <= deadline). The deadline resolver
   * reads it to award an activity win to a lone-present player. Additive (absent on P1 brackets).
   */
  present?: Participant[];
  /**
   * SERIES (bo3/bo5): the settled per-game results, in report order. A player CLINCHES the match
   * (and it advances) once their game-win tally reaches the series' wins-to-clinch. Additive:
   * absent/empty on a single-game match, so old brackets deserialize unchanged.
   */
  games?: SeriesGame[];
  /**
   * SERIES (bo3/bo5): pending dual-attestation reports for each not-yet-settled game. A game moves
   * from here into {@linkcode games} once both paired players agree its winner. Additive.
   */
  gameReports?: SeriesGameReports[];
}

/** A single-elimination bracket: rounds[0] is the first round. */
export interface Bracket {
  /** 2^k slots (the padded field size). */
  size: number;
  /** rounds[r] holds the matches of round r; the last round is the final (1 match). */
  rounds: BracketMatch[][];
  /**
   * P3: participants KICKED mid-tournament (admin walkover). Their opponent auto-advances
   * (resolution "walkover"); a kicked player who was WAITING for a not-yet-decided opponent
   * sits in a pending match until the feeder resolves, then that opponent walks over. The
   * board renders a kicked participant as eliminated/kicked. Additive (absent on P1 brackets).
   */
  kicked?: Participant[];
}

/** The result of applying a report / resolve to a match. */
export type ReportResolution = "pending" | "settled" | "disputed";

export interface ApplyReportResult {
  bracket: Bracket;
  resolution: ReportResolution;
  /** The match id that was affected (echo for the caller/persistence). */
  matchId: string;
}

/** Smallest power of two >= n (min 1). */
export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) {
    p *= 2;
  }
  return p;
}

/**
 * Standard single-elimination SEED ORDER for a bracket of `size` slots. Returns an
 * array of seed NUMBERS (1-based): the seed that occupies each slot 0..size-1, so
 * that seed 1 and seed 2 can only meet in the final and higher seeds are spread
 * across the halves. E.g. size 4 -> [1,4,2,3]; size 8 -> [1,8,4,5,2,7,3,6].
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    const next: number[] = [];
    for (const s of order) {
      next.push(s);
      next.push(n + 1 - s);
    }
    order = next;
  }
  return order;
}

/** The parent (next-round) match a given match feeds, plus which slot it fills. */
function parentOf(round: number, slot: number): { round: number; slot: number; side: "a" | "b" } {
  return { round: round + 1, slot: Math.floor(slot / 2), side: slot % 2 === 0 ? "a" : "b" };
}

function matchId(tournamentId: string, round: number, slot: number): string {
  return `${tournamentId}-r${round}-m${slot}`;
}

/**
 * Generate a fresh single-elimination bracket. `entrants` MUST already carry a
 * unique 1-based `seed` (1 = top). Byes are assigned to the top seeds. Round-1
 * bye matches auto-advance their single real player; deadlines are per-round
 * windows off `startAt`.
 */
export function generateBracket(
  tournamentId: string,
  entrants: { participant: Participant; seed: number }[],
  roundWindowMs: number,
  startAt: number,
): Bracket {
  const n = entrants.length;
  const size = Math.max(2, nextPowerOfTwo(n));
  const rounds = Math.log2(size);

  // seed number -> participant (seeds beyond n are byes / undefined)
  const bySeed = new Map<number, Participant>();
  for (const e of entrants) {
    bySeed.set(e.seed, e.participant);
  }
  const order = seedOrder(size);
  const slotParticipant = order.map(seed => bySeed.get(seed) ?? null);

  const bracket: Bracket = { size, rounds: [] };
  for (let r = 0; r < rounds; r++) {
    const count = size / 2 ** (r + 1);
    const roundMatches: BracketMatch[] = [];
    for (let m = 0; m < count; m++) {
      roundMatches.push({
        id: matchId(tournamentId, r, m),
        round: r,
        slot: m,
        a: r === 0 ? slotParticipant[m * 2] : null,
        b: r === 0 ? slotParticipant[m * 2 + 1] : null,
        winner: null,
        resolution: "pending",
        deadline: startAt + (r + 1) * roundWindowMs,
        reports: [],
        disputed: false,
      });
    }
    bracket.rounds.push(roundMatches);
  }

  // Resolve round-0 byes and propagate the auto-advances forward.
  for (const match of bracket.rounds[0]) {
    const aReal = match.a !== null;
    const bReal = match.b !== null;
    if (aReal !== bReal) {
      // exactly one real player -> bye advance
      setWinner(bracket, match, (aReal ? match.a : match.b) as Participant, "bye");
    }
  }
  return bracket;
}

/** Internal: set a match winner, mark resolution, and feed the parent slot. */
function setWinner(bracket: Bracket, match: BracketMatch, winner: Participant, resolution: MatchResolution): void {
  match.winner = winner;
  match.resolution = resolution;
  const last = bracket.rounds.length - 1;
  if (match.round >= last) {
    return; // final — nothing to feed
  }
  const p = parentOf(match.round, match.slot);
  const parent = bracket.rounds[p.round][p.slot];
  if (p.side === "a") {
    parent.a = winner;
  } else {
    parent.b = winner;
  }
}

/** Find a match by id, or null. */
export function findMatch(bracket: Bracket, id: string): BracketMatch | null {
  for (const round of bracket.rounds) {
    for (const match of round) {
      if (match.id === id) {
        return match;
      }
    }
  }
  return null;
}

/** True once both feeder participants of a match are known (ready to play). */
export function isPlayable(match: BracketMatch): boolean {
  return match.a !== null && match.b !== null && match.winner === null;
}

/** The final match (last round, slot 0). */
export function finalMatch(bracket: Bracket): BracketMatch {
  const lastRound = bracket.rounds.at(-1);
  if (lastRound === undefined) {
    throw new Error("bracket has no rounds");
  }
  return lastRound[0];
}

/** The champion once the final is decided, else null. */
export function champion(bracket: Bracket): Participant | null {
  return finalMatch(bracket).winner;
}

/** True once the whole bracket is decided. */
export function isComplete(bracket: Bracket): boolean {
  return champion(bracket) !== null;
}

/**
 * Apply one player's result report (dual attestation, escrow discipline). Rules:
 *  - match must exist, be PLAYABLE (both players known, undecided) — else no-op pending.
 *  - reporter must be one of the two paired players; winner must be one of them.
 *  - FIRST report from a player is canonical (a re-report keeps the first `winner`/`at`).
 *  - BOTH players reported AND AGREE -> settle ("reported") + advance.
 *  - BOTH reported but CONFLICT -> `disputed` (stays pending; organizer must resolve).
 *  - ONE report -> pending (P1: peer must agree, or the organizer resolves the deadline).
 * Mutates the passed bracket in place and returns it.
 */
export function applyResultReport(
  bracket: Bracket,
  id: string,
  reporter: Participant,
  winner: Participant,
  now: number,
): ApplyReportResult {
  const match = findMatch(bracket, id);
  if (match === null || match.winner !== null || match.a === null || match.b === null) {
    return { bracket, resolution: match?.winner ? "settled" : "pending", matchId: id };
  }
  const isPlayer = reporter === match.a || reporter === match.b;
  const winnerIsPlayer = winner === match.a || winner === match.b;
  if (!isPlayer || !winnerIsPlayer) {
    return { bracket, resolution: "pending", matchId: id };
  }

  // Record the report (first from this reporter is canonical).
  if (!match.reports.some(r => r.reporter === reporter)) {
    match.reports.push({ reporter, winner, at: now });
  }

  const reportA = match.reports.find(r => r.reporter === match.a);
  const reportB = match.reports.find(r => r.reporter === match.b);
  if (reportA && reportB) {
    if (reportA.winner === reportB.winner) {
      setWinner(bracket, match, reportA.winner, "reported");
      return { bracket, resolution: "settled", matchId: id };
    }
    match.disputed = true;
    return { bracket, resolution: "disputed", matchId: id };
  }
  return { bracket, resolution: "pending", matchId: id };
}

/**
 * The per-participant game-win tally of a SERIES match (for the board's "1-0" score). Counts the
 * settled {@linkcode BracketMatch.games} by winner. Zero-zero for a single-game / unplayed match.
 */
export function seriesScore(match: BracketMatch): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const g of match.games ?? []) {
    if (g.winner === match.a) {
      a++;
    } else if (g.winner === match.b) {
      b++;
    }
  }
  return { a, b };
}

/**
 * Apply one player's SERIES (bo3/bo5) game report. Same dual-attestation discipline as
 * {@linkcode applyResultReport}, but at GAME granularity: each game of the series is dual-attested
 * independently, and the MATCH only settles (and advances) once a player's game-win tally reaches
 * `winsToClinch` (bo3 -> 2, bo5 -> 3). Rules:
 *  - match must exist, be PLAYABLE (both players known, undecided) — else no-op.
 *  - reporter + winner must be paired players.
 *  - a game already recorded in {@linkcode BracketMatch.games} ignores further reports for that index
 *    (idempotent; a stale/duplicate report can't double-count).
 *  - FIRST report from a player for a given game is canonical; both AGREE -> the game settles (pushed
 *    to `games`, its pending bucket cleared) and the winner's tally is checked for a clinch.
 *  - both reported but CONFLICT on a game -> `disputed` (organizer must resolve the whole match).
 *  - a settled game that does NOT clinch -> pending (the series continues into the next game).
 * Mutates + returns the bracket. `winsToClinch` is supplied by the caller from the tournament's
 * seriesFormat (keeps this engine agnostic of the format vocabulary).
 */
export function applySeriesGameReport(
  bracket: Bracket,
  id: string,
  reporter: Participant,
  winner: Participant,
  gameIndex: number,
  winsToClinch: number,
  now: number,
): ApplyReportResult {
  const match = findMatch(bracket, id);
  if (match === null || match.winner !== null || match.a === null || match.b === null) {
    return { bracket, resolution: match?.winner ? "settled" : "pending", matchId: id };
  }
  const isPlayer = reporter === match.a || reporter === match.b;
  const winnerIsPlayer = winner === match.a || winner === match.b;
  if (!isPlayer || !winnerIsPlayer) {
    return { bracket, resolution: "pending", matchId: id };
  }
  if (match.games === undefined) {
    match.games = [];
  }
  if (match.gameReports === undefined) {
    match.gameReports = [];
  }
  // A game whose winner is already settled ignores late/duplicate reports for that index.
  if (match.games.some(g => g.gameIndex === gameIndex)) {
    return { bracket, resolution: "pending", matchId: id };
  }
  let bucket = match.gameReports.find(gr => gr.gameIndex === gameIndex);
  if (bucket === undefined) {
    bucket = { gameIndex, reports: [] };
    match.gameReports.push(bucket);
  }
  // First report from this reporter for this game is canonical (a re-report keeps the first winner/at).
  if (!bucket.reports.some(r => r.reporter === reporter)) {
    bucket.reports.push({ reporter, winner, at: now });
  }
  const reportA = bucket.reports.find(r => r.reporter === match.a);
  const reportB = bucket.reports.find(r => r.reporter === match.b);
  if (!reportA || !reportB) {
    return { bracket, resolution: "pending", matchId: id };
  }
  if (reportA.winner !== reportB.winner) {
    match.disputed = true;
    return { bracket, resolution: "disputed", matchId: id };
  }
  // The game is settled: record it and clear its pending bucket.
  match.games.push({ gameIndex, winner: reportA.winner });
  match.gameReports = match.gameReports.filter(gr => gr.gameIndex !== gameIndex);
  // Clinch check: has the game winner reached the series' wins-to-clinch?
  const score = seriesScore(match);
  const winnerTally = reportA.winner === match.a ? score.a : score.b;
  if (winnerTally >= Math.max(1, winsToClinch)) {
    setWinner(bracket, match, reportA.winner, "reported");
    return { bracket, resolution: "settled", matchId: id };
  }
  // Game settled but the series continues into the next game.
  return { bracket, resolution: "pending", matchId: id };
}

/**
 * Organizer manual resolve (disputes, deadline no-shows). Sets the winner
 * directly and advances, regardless of reports. `winner` MUST be one of the two
 * paired players. Mutates + returns the bracket.
 */
export function manualResolve(bracket: Bracket, id: string, winner: Participant): ApplyReportResult {
  const match = findMatch(bracket, id);
  if (match === null || match.winner !== null || match.a === null || match.b === null) {
    return { bracket, resolution: match?.winner ? "settled" : "pending", matchId: id };
  }
  if (winner !== match.a && winner !== match.b) {
    return { bracket, resolution: "pending", matchId: id };
  }
  match.disputed = false;
  setWinner(bracket, match, winner, "manual");
  return { bracket, resolution: "settled", matchId: id };
}

// =============================================================================
// P3 — ADMIN OPS helpers (kick/walkover, progress guard, placements). PURE.
// =============================================================================

/** The "played" resolutions — a real contested result, an override, a walkover, or a deadline auto-resolution. */
const PLAYED_RESOLUTIONS: ReadonlySet<MatchResolution> = new Set<MatchResolution>([
  "reported",
  "manual",
  "walkover",
  "activity",
  "seed",
]);

/** Count of matches that have been PLAYED (contested result, manual resolve, or walkover). Byes excluded. */
export function matchesPlayedCount(bracket: Bracket): number {
  let n = 0;
  for (const round of bracket.rounds) {
    for (const match of round) {
      if (PLAYED_RESOLUTIONS.has(match.resolution)) {
        n++;
      }
    }
  }
  return n;
}

/**
 * True once ANY real progress exists (a played/overridden/walkover result). Byes are structural,
 * not progress. RE-SEED and reopen-on-kick are only permitted while this is false (design doc:
 * "regenerate while no match has been played yet").
 */
export function hasProgress(bracket: Bracket): boolean {
  return matchesPlayedCount(bracket) > 0;
}

/** Placement buckets for reward granting (design doc: champion / runner-up / semifinalists). */
export interface Placements {
  champion: Participant | null;
  runnerUp: Participant | null;
  /** Losers of the semifinal round (the round before the final); empty for a 2-slot bracket. */
  semifinalists: Participant[];
}

/** The loser of a decided match (the non-winner real participant), or null (undecided / bye / walkover-empty). */
function loserOf(match: BracketMatch): Participant | null {
  if (match.winner === null) {
    return null;
  }
  if (match.a !== null && match.a !== match.winner) {
    return match.a;
  }
  if (match.b !== null && match.b !== match.winner) {
    return match.b;
  }
  return null;
}

/**
 * Compute podium placements from the (decided or partial) bracket. Champion = final winner;
 * runner-up = final loser; semifinalists = the losers of the second-to-last round. Undecided
 * slots yield null / are omitted. Pure — used to map the reward pool onto real accounts.
 */
export function computePlacements(bracket: Bracket): Placements {
  const final = finalMatch(bracket);
  const champion = final.winner;
  const runnerUp = loserOf(final);
  const semis = bracket.rounds.length >= 2 ? (bracket.rounds.at(-2) ?? []) : [];
  const semifinalists: Participant[] = [];
  for (const m of semis) {
    const l = loserOf(m);
    if (l !== null) {
      semifinalists.push(l);
    }
  }
  return { champion, runnerUp, semifinalists };
}

/**
 * Apply an admin KICK mid-tournament as a WALKOVER (design doc scenario 3). Adds `participant`
 * to the bracket's kicked list, then repeatedly advances any undecided match where a KICKED
 * player faces a KNOWN non-kicked opponent — the opponent wins by "walkover" and advances. A
 * kicked player whose opponent is still TBD sits in a pending match until the feeder resolves,
 * at which point a subsequent call (or the same fixpoint loop) advances the arriving opponent.
 * If BOTH slots are kicked, the match resolves with no winner (neither advances). Mutates + returns.
 */
export function applyKickWalkover(bracket: Bracket, participant: Participant, now: number): Bracket {
  if (bracket.kicked === undefined) {
    bracket.kicked = [];
  }
  if (!bracket.kicked.includes(participant)) {
    bracket.kicked.push(participant);
  }
  const kicked = new Set(bracket.kicked);
  // Fixpoint: keep advancing walkovers until no undecided match changes.
  let changed = true;
  while (changed) {
    changed = false;
    for (const round of bracket.rounds) {
      for (const match of round) {
        if (match.winner !== null) {
          continue;
        }
        const aKicked = match.a !== null && kicked.has(match.a);
        const bKicked = match.b !== null && kicked.has(match.b);
        if (!aKicked && !bKicked) {
          continue;
        }
        const aReal = match.a !== null && !aKicked;
        const bReal = match.b !== null && !bKicked;
        if (aKicked && bReal) {
          setWinner(bracket, match, match.b as Participant, "walkover");
          match.deadline = now;
          changed = true;
        } else if (bKicked && aReal) {
          setWinner(bracket, match, match.a as Participant, "walkover");
          match.deadline = now;
          changed = true;
        } else if (aKicked && bKicked) {
          // Both kicked: no one advances. Mark resolved (winner stays null) so it isn't pending forever.
          match.resolution = "walkover";
          match.deadline = now;
          // Does NOT feed the parent (setWinner needs a winner); parent stays TBD (rare edge).
        }
        // else: a kicked player vs a null (TBD) opponent — leave pending until the feeder fills it.
      }
    }
  }
  return bracket;
}

/** True if `participant` was kicked from this bracket (board renders them as kicked/eliminated). */
export function isKicked(bracket: Bracket, participant: Participant): boolean {
  return bracket.kicked?.includes(participant) ?? false;
}

// =============================================================================
// P2 — DEADLINE AUTO-RESOLUTION (presence-based activity wins, seed fallback). PURE.
// Presence is aggregated PER MATCH (per window) so a stale global last_seen can't
// misattribute activity: a ping stamps the pinger onto every undecided match they're
// in whose window is still open (now <= deadline). At/after the deadline the resolver
// awards the match without organizer action — LAZILY on any read (the scheduled-close
// pattern, no cron) and IDEMPOTENTLY (a decided match is never re-resolved).
// =============================================================================

/**
 * Record a presence ping: stamp `participant` onto every UNDECIDED match they are a paired player of
 * whose window is still OPEN (deadline set and now <= deadline). Returns true if anything changed (the
 * caller persists the bracket only then). Idempotent — a participant is added to a match's `present`
 * list at most once. This is the per-window aggregate the deadline resolver consumes.
 */
export function recordPresence(bracket: Bracket, participant: Participant, now: number): boolean {
  let changed = false;
  for (const round of bracket.rounds) {
    for (const match of round) {
      if (match.winner !== null || match.deadline === null || now > match.deadline) {
        continue;
      }
      if (match.a !== participant && match.b !== participant) {
        continue;
      }
      if (match.present === undefined) {
        match.present = [];
      }
      if (!match.present.includes(participant)) {
        match.present.push(participant);
        changed = true;
      }
    }
  }
  return changed;
}

/** True if `participant` was recorded present during `match`'s window. */
export function wasPresent(match: BracketMatch, participant: Participant | null): boolean {
  return participant !== null && (match.present?.includes(participant) ?? false);
}

/** One match auto-resolved at its deadline (echoed for board labels / advance notifications). */
export interface ExpiredResolution {
  matchId: string;
  round: number;
  slot: number;
  winner: Participant | null;
  /** "activity" (a lone-present player) or "seed" (neither/both present -> higher seed). */
  kind: "activity" | "seed" | "walkover";
  /** The player who advanced without playing (== winner), for the "you advanced" notification. */
  advanced: Participant | null;
  /** The player who was eliminated without playing (the non-winner real player), or null. */
  eliminated: Participant | null;
  /** True when BOTH players were present but neither reported (contested no-show, resolved by seed). */
  contested: boolean;
}

/**
 * LAZILY auto-resolve every match whose round window has EXPIRED (now > deadline) without a result
 * (design doc step 6). Processed in ascending round order so an advance feeds the next round in the
 * same pass (a long-abandoned tournament resolves multiple rounds at once). Per expired, playable,
 * undecided match:
 *   - a KICKED player present -> the opponent walks over (safety net for a kick whose opponent
 *     arrived from a later feeder);
 *   - exactly ONE player present in the lobby during the window -> that player wins by "activity";
 *   - NEITHER or BOTH present -> the HIGHER seed (lower seed number) advances by "seed" (both-present
 *     is flagged `contested`).
 * IDEMPOTENT: a decided match is skipped, so repeated reads never re-resolve. Mutates + returns the
 * bracket plus the list of resolutions applied (empty when nothing expired).
 */
export function resolveExpiredMatches(
  bracket: Bracket,
  seedOf: (participant: Participant) => number | null,
  now: number,
): { bracket: Bracket; resolved: ExpiredResolution[] } {
  const kicked = new Set(bracket.kicked ?? []);
  const resolved: ExpiredResolution[] = [];
  const seedRank = (p: Participant | null): number =>
    p === null ? Number.POSITIVE_INFINITY : (seedOf(p) ?? Number.POSITIVE_INFINITY);
  for (const round of bracket.rounds) {
    for (const match of round) {
      if (match.winner !== null || match.a === null || match.b === null) {
        continue; // decided, or a feeder is still pending (not playable)
      }
      if (match.deadline === null || now <= match.deadline) {
        continue; // window still open
      }
      const a = match.a;
      const b = match.b;
      const aKicked = kicked.has(a);
      const bKicked = kicked.has(b);
      let winner: Participant;
      let kind: ExpiredResolution["kind"];
      let contested = false;
      if (aKicked && !bKicked) {
        winner = b;
        kind = "walkover";
      } else if (bKicked && !aKicked) {
        winner = a;
        kind = "walkover";
      } else {
        const aPresent = wasPresent(match, a);
        const bPresent = wasPresent(match, b);
        if (aPresent && !bPresent) {
          winner = a;
          kind = "activity";
        } else if (bPresent && !aPresent) {
          winner = b;
          kind = "activity";
        } else {
          // neither present, or BOTH present with no result -> higher seed advances (contested if both).
          contested = aPresent && bPresent;
          winner = seedRank(a) <= seedRank(b) ? a : b;
          kind = "seed";
        }
      }
      setWinner(bracket, match, winner, kind);
      match.deadline = now;
      resolved.push({
        matchId: match.id,
        round: match.round,
        slot: match.slot,
        winner,
        kind,
        advanced: winner,
        eliminated: winner === a ? b : a,
        contested,
      });
    }
  }
  return { bracket, resolved };
}
