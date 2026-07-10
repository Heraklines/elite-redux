/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// REPLAY TRACE schema (#record-replay, Phase 1 - SCHEMA ONLY, no production capture).
//
// A `ReplayTrace` is a DETERMINISTIC, serializable record of a run: a run HEADER (seed +
// game mode + difficulty + challenges + the starting roster) plus an ordered EVENT list
// (every player command + every interaction pick). Because the engine's run-start is
// seed-pinned and every player decision is captured, seed + roster + events FULLY determine
// the run - so a trace can be replayed headlessly (in the two-engine co-op harness now; in a
// single-engine GameManager loader later) to REPRODUCE a reported bug and re-run it to verify
// a fix.
//
// DESIGN GOAL - GENERAL, NOT CO-OP-LOCKED. The header + event list are mode-agnostic so a
// future SINGLE-PLAYER loader is a thin add:
//   - For SINGLE-PLAYER the roster is just the one player's party; there is NO `coop` layer and
//     every interaction is owner=local (parity is irrelevant).
//   - For CO-OP the roster is the MERGED party (both players' mons, each tagged via
//     `PokemonData.coopOwner`), and the optional `coop` layer carries the `CoopRunConfig` the
//     host decided (seed / difficulty / challenges / netcodeMode) that the guest mirrors.
//
// The OWNER of each interaction is DERIVABLE from the interaction-counter parity
// (`CoopInteractionTurn.ownerOf`: even -> host, odd -> guest), so owners are NOT stored - see
// the `coop` doc below. This keeps the trace minimal and impossible to desync from the engine's
// own alternation rule.
//
// This module is PURE TYPES + a tiny validate/normalize helper. It has NO production behavior
// and is imported by BOTH production (Phase 2 capture) and the test harness (Phase 1 replay).
// =============================================================================

import type { CoopRunConfig } from "#data/elite-redux/coop/coop-session-controller";
import type { GameModes } from "#enums/game-modes";
import type { ModifierData as PersistentModifierData } from "#system/modifier-data";
import type { PokemonData } from "#system/pokemon-data";

/**
 * Bump when the wire shape changes incompatibly so a loader can reject an unreadable trace.
 *
 * v1 -> v2 (#record-replay, single-player): ADDITIVE growth only - a new OPTIONAL {@linkcode
 * ReplayTrace.endState} summary (captured by the single-player recorder for the loader's deterministic
 * end-state assert) plus new single-player interaction `kind`s ("biome" / "crossroads" / "me" / ...).
 * Nothing removed or reshaped, so v1 traces stay readable: {@linkcode validateReplayTrace} accepts every
 * version in {@linkcode SUPPORTED_REPLAY_TRACE_VERSIONS} (a stored v1 co-op trace still validates).
 */
export const REPLAY_TRACE_VERSION = 2;

/**
 * Every trace-schema version a loader can still read. v2 only GREW the schema additively over v1 (an
 * optional end-state + new interaction kinds), so both validate - a v1 co-op trace captured before the
 * single-player add is still replayable. New captures stamp {@linkcode REPLAY_TRACE_VERSION}.
 */
export const SUPPORTED_REPLAY_TRACE_VERSIONS: readonly number[] = [1, 2];

/**
 * One serialized player COMMAND (a battle decision), mode-agnostic. Mirrors the engine's command
 * path: a FIGHT carries the move slot + resolved target; a SWITCH the party slot; a BALL the ball
 * slot; RUN none. Indices (not ids) so it stays loader-agnostic - the loader maps `moveIndex` to the
 * mon's live moveset slot at replay time (the same slot the host committed), exactly like
 * {@linkcode SerializedCommand}'s `cursor`/`moveId` pair. Kept deliberately small + explicit so a
 * single-player loader (`game.move.select`) and the co-op loader (`game.move.select` on the host)
 * both feed it without translation.
 */
export type ReplayCommandKind =
  /** FIGHT: use move at `moveIndex` (slot into the mon's moveset), optionally at `target` (BattlerIndex). */
  | { kind: "move"; moveIndex: number; target?: number }
  /** SWITCH (Command.POKEMON): bring in the party mon at `partyIndex`. */
  | { kind: "switch"; partyIndex: number }
  /** BALL (Command.BALL): throw the ball at `ballIndex` (PokeballType). */
  | { kind: "ball"; ballIndex: number }
  /** RUN (Command.RUN): flee the battle. */
  | { kind: "run" };

/**
 * A captured battle command for one field slot on one turn. `wave`/`turn` anchor it to the run so a
 * loader can assert it is feeding the command at the RIGHT point (and detect a drifted replay). For
 * co-op, `slotFieldIndex` is the player field index (0 = host lead, 1 = guest lead); for single-player
 * it is just the active slot (0, or 1 in a double).
 */
export interface ReplayCommandEvent {
  type: "command";
  /** The wave this command was committed on. */
  wave: number;
  /** The 0-based turn within the wave this command was committed on. */
  turn: number;
  /** The player field slot the command is for (co-op: 0 = host, 1 = guest; single-player: active slot). */
  slotFieldIndex: number;
  /** The decision itself. */
  command: ReplayCommandKind;
}

/**
 * A captured interaction pick (reward shop / mystery-encounter option / sub-pick / leave sentinel),
 * mode-agnostic. Mirrors {@linkcode CoopInteractionRelay.sendInteractionChoice}'s args EXACTLY
 * (`seq`, `kind`, `choice`, optional `data`) so the co-op loader can relay it verbatim, and a
 * single-player loader can apply it as the local choice. `seq` is the interaction counter at
 * screen-open; the OWNER is derivable from its parity (see the module + `coop` docs) so no owner
 * field is needed. `kind` is the routing tag; `choice` is the index or sentinel (e.g.
 * `COOP_INTERACTION_LEAVE` = -1, an ME option index, a reward row); `data` carries the extra payload
 * some picks need (e.g. a reward's resolved party slot + sub-index).
 *
 * Known `kind`s (co-op today + single-player, additive - a loader ignores an unknown kind loudly):
 *  - "reward"     reward-shop pick (`choice` = the option row index)
 *  - "skip"       left the reward shop without picking (`choice` = -1)
 *  - "reroll" / "transfer" / "lock" / "check"   reward-shop sub-actions (co-op relay + single-player tap)
 *  - "learnMove"  a level-up move-learn RESULT (`choice` = the forgotten moveset slot, or the mon's
 *                 move cap = "declined / did not learn")
 *  - "biome"      a World-Map / biome pick (`choice` = the chosen `BiomeId`)
 *  - "crossroads" the ER every-5-waves Stay/Leave choice (`choice` = 0 stay / 1 leave)
 *  - "me" / "meSub"   a mystery-encounter option / sub-option index
 * For single-player the `seq` is a monotonic per-recording counter (owner parity is irrelevant), so the
 * loader consumes interactions in the trace's event ORDER (not by parity) - see the single-player loader.
 */
export interface ReplayInteractionEvent {
  type: "interaction";
  /** The interaction counter (seq) this pick was made on - keys the owner parity + the relay seq. */
  seq: number;
  /** Routing/kind tag (mirrors sendInteractionChoice's `kind`): "reward" | "me" | "meSub" | "skip" | ... */
  kind: string;
  /** The chosen index or sentinel (mirrors sendInteractionChoice's `choice`). */
  choice: number;
  /** Optional extra payload (mirrors sendInteractionChoice's `data`): e.g. [act, slot, subIndex]. */
  data?: number[];
}

/** One ordered event in a replay trace: a battle command OR an interaction pick. */
export type ReplayEvent = ReplayCommandEvent | ReplayInteractionEvent;

/**
 * The CO-OP layer (optional). Present only for a co-op trace; absent for single-player. Carries the
 * authoritative {@linkcode CoopRunConfig} the host decided and the guest mirrors (seed / difficulty /
 * challenges / netcodeMode). The interaction-OWNER alternation is NOT stored here: it is fully
 * derivable from each interaction's `seq` parity (`CoopInteractionTurn.ownerOf`: even -> host, odd ->
 * guest), so a loader recomputes it and there is no second source of truth to desync. (Verified
 * against `coop-session.ts` `ownerOf` + `coop-session-controller.ts` `isLocalOwnerAtCounter`.)
 */
export interface ReplayCoopLayer {
  runConfig: CoopRunConfig;
}

/**
 * A compact SESSION-SAVE-GRADE state CHECKPOINT captured at the ring-buffer WINDOW START (#record-replay,
 * checkpoint). The event ring only keeps the last {@linkcode REPLAY_RECORDER_WAVE_WINDOW} waves and the
 * header's `roster` is the ORIGINAL starting party - so a run mutated by catches / releases / rewards /
 * evolutions cannot be rebuilt from the header alone once the offending wave is older than the earliest
 * retained event. This checkpoint fills that gap: it is the run's actual state at the START of the oldest
 * retained wave (re-captured on wave boundaries as the window slides, so it is always cheap and always
 * paired with the retained events), letting a loader BOOT from it and replay the retained events forward.
 *
 * Mirrors the fields a session save persists (see `game-data.ts` `getSessionSaveData`): the live party as
 * serialized `PokemonData`, the player's persistent modifiers, money, the pokeball inventory, and the
 * wave / seed cursor to boot at. Optional + additive: a trace without a checkpoint (e.g. a recording begun
 * mid-flow) still replays from the header roster (backward compatible).
 */
export interface ReplayCheckpoint {
  /** The wave whose START this checkpoint snapshots (the ring-buffer window start; the boot wave). */
  wave: number;
  /** The run RNG seed at capture (`globalScene.seed`) - pins RNG from the checkpoint wave onward. */
  seed: string;
  /** The player party at the window start as serialized `PokemonData` (post catch/release/evolution). */
  party: PokemonData[];
  /** The player's persistent modifiers at the window start (session-save-grade `ModifierData`). */
  modifiers: PersistentModifierData[];
  /** The player's money at the window start. */
  money: number;
  /** The pokeball inventory at the window start (keyed by `PokeballType`, as `globalScene.pokeballCounts`). */
  pokeballCounts: Record<string, number>;
}

/** One party mon in a {@linkcode ReplayEndState} summary (the minimal state a replay asserts on). */
export interface ReplayEndPartyMon {
  /** The {@linkcode SpeciesId} value (a number so it round-trips through JSON). */
  species: number;
  level: number;
  hp: number;
  maxHp: number;
}

/**
 * An optional END-STATE summary of the recorded run (v2+, #record-replay single-player). Captured by the
 * single-player recorder at trace-emit time (via an injected provider, so the recorder stays
 * globalScene-free) so the single-engine loader can assert the replay reproduced the run 1:1 (same final
 * `waveIndex` / `money` / party species+level+hp). Absent for a co-op trace (the duo harness asserts
 * convergence differently) and for a v1 trace - a loader treats a missing `endState` as "derive from the
 * last events / do not assert".
 */
export interface ReplayEndState {
  /** The run's final `currentBattle.waveIndex` at capture time. */
  waveIndex: number;
  /** The player's money at capture time. */
  money: number;
  /** The player party's species/level/hp at capture time (the deterministic reproduction target). */
  party: ReplayEndPartyMon[];
}

/**
 * A deterministic, serializable record of a run for headless RECORD -> REPLAY reproduction.
 *
 * GENERAL header (mode-agnostic):
 *  - `seed` pins the run RNG (the deterministic run-start #658 pins the co-op guest to this seed too).
 *  - `gameModeId` is the {@linkcode GameModes} the run uses (CLASSIC / COOP / CHALLENGE / ...).
 *  - `difficulty` / `challenges` are the run modifiers (mirror `CoopRunConfig`'s fields so the two
 *    are trivially convertible; for single-player they describe the local run).
 *  - `roster` is the starting party as `PokemonData[]` - one player's party for single-player, the
 *    MERGED party (each mon tagged via `PokemonData.coopOwner`) for co-op.
 *  - `events` is the ordered command + interaction list that, with seed + roster, fully determines the run.
 *
 * Optional `coop` layer for a co-op trace (see {@linkcode ReplayCoopLayer}). A single-player loader
 * ignores it entirely.
 */
export interface ReplayTrace {
  /** Schema version (see {@linkcode REPLAY_TRACE_VERSION}); a loader rejects an unknown major. */
  version: number;
  /** The run RNG seed (string, as `globalScene.seed`). Pins enemy rolls / RNG on every engine. */
  seed: string;
  /** The {@linkcode GameModes} value the run uses. */
  gameModeId: GameModes;
  /** ER difficulty: "youngster" | "ace" | "elite" | "hell" (mirrors `CoopRunConfig.difficulty`). */
  difficulty: string;
  /** Active challenges (empty for a plain run; mirrors `CoopRunConfig.challenges`). */
  challenges: CoopRunConfig["challenges"];
  /** The starting roster as serialized `PokemonData` (merged + coopOwner-tagged for co-op). */
  roster: PokemonData[];
  /** The ordered command + interaction events that reproduce the run. */
  events: ReplayEvent[];
  /** Optional co-op layer (the host `CoopRunConfig`); absent for single-player. */
  coop?: ReplayCoopLayer;
  /**
   * Optional end-state summary (v2+): the recorded run's final `waveIndex` / `money` / party, so a
   * single-engine loader can assert it reproduced the run deterministically. Absent for co-op / v1 traces.
   */
  endState?: ReplayEndState;
  /**
   * Optional window-start CHECKPOINT (v2+, additive; see {@linkcode ReplayCheckpoint}): the run's actual
   * session-save-grade state at the START of the oldest retained wave, so a loader can BOOT from it and
   * replay the retained events forward even when the run diverged from the header roster (catches /
   * releases / rewards / evolutions). A loader PREFERS this over the header roster when present; a trace
   * without it (recording begun mid-flow) still replays from the header roster (backward compatible).
   */
  checkpoint?: ReplayCheckpoint;
}

/** Narrowing guard: is this event a battle command? */
export function isReplayCommandEvent(e: ReplayEvent): e is ReplayCommandEvent {
  return e.type === "command";
}

/** Narrowing guard: is this event an interaction pick? */
export function isReplayInteractionEvent(e: ReplayEvent): e is ReplayInteractionEvent {
  return e.type === "interaction";
}

/** The shape a trace must minimally satisfy to be replayable (each item is a human-readable reason). */
export interface ReplayTraceValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a {@linkcode ReplayTrace} for replayability WITHOUT mutating it. Pure: returns the list of
 * structural problems (an unknown version, a missing/empty roster, a malformed event) so a loader can
 * reject a bad trace with a precise reason instead of crashing mid-replay. Does NOT validate run
 * semantics (that a move slot is legal etc.) - that surfaces when the loader feeds the engine.
 */
export function validateReplayTrace(trace: ReplayTrace): ReplayTraceValidation {
  const errors: string[] = [];
  if (!SUPPORTED_REPLAY_TRACE_VERSIONS.includes(trace.version)) {
    errors.push(
      `unsupported trace version ${trace.version} (loader supports ${SUPPORTED_REPLAY_TRACE_VERSIONS.join("/")})`,
    );
  }
  if (typeof trace.seed !== "string" || trace.seed.length === 0) {
    errors.push("missing run seed (a replay needs the seed to pin RNG)");
  }
  if (!Array.isArray(trace.roster) || trace.roster.length === 0) {
    errors.push("empty roster (a replay needs at least one starting mon)");
  }
  if (Array.isArray(trace.events)) {
    trace.events.forEach((e, i) => {
      if (e.type === "command") {
        if (!Number.isInteger(e.wave) || !Number.isInteger(e.turn) || !Number.isInteger(e.slotFieldIndex)) {
          errors.push(`event[${i}] command: wave/turn/slotFieldIndex must be integers`);
        }
        if (!isValidCommandKind(e.command)) {
          errors.push(`event[${i}] command: malformed command kind`);
        }
      } else if (e.type === "interaction") {
        if (!Number.isInteger(e.seq) || typeof e.kind !== "string" || !Number.isInteger(e.choice)) {
          errors.push(`event[${i}] interaction: seq/kind/choice malformed`);
        }
      } else {
        errors.push(`event[${i}]: unknown event type ${(e as { type: string }).type}`);
      }
    });
  } else {
    errors.push("missing events array");
  }
  if (trace.coop != null && trace.coop.runConfig == null) {
    errors.push("coop layer present but missing runConfig");
  }
  // The checkpoint is OPTIONAL + additive; validate it only when present (a boot needs a wave, a seed,
  // and a non-empty party). A structurally-broken checkpoint is rejected so a loader never boots from junk.
  if (trace.checkpoint != null) {
    const cp = trace.checkpoint;
    if (!Number.isInteger(cp.wave) || typeof cp.seed !== "string" || cp.seed.length === 0) {
      errors.push("checkpoint present but missing a valid wave/seed cursor");
    }
    if (!Array.isArray(cp.party) || cp.party.length === 0) {
      errors.push("checkpoint present but has an empty party (a boot needs at least one mon)");
    }
  }
  return { ok: errors.length === 0, errors };
}

function isValidCommandKind(c: ReplayCommandKind): boolean {
  switch (c.kind) {
    case "move":
      return Number.isInteger(c.moveIndex) && (c.target === undefined || Number.isInteger(c.target));
    case "switch":
      return Number.isInteger(c.partyIndex);
    case "ball":
      return Number.isInteger(c.ballIndex);
    case "run":
      return true;
    default:
      return false;
  }
}

/**
 * Convenience: build a {@linkcode ReplayTrace} from its parts, filling `version` and (for co-op)
 * deriving the general header fields from the {@linkcode CoopRunConfig} so the header + coop layer
 * never disagree. Pure helper for capture (Phase 2) + tests (Phase 1 synthetic traces).
 */
export function makeReplayTrace(args: {
  seed: string;
  gameModeId: GameModes;
  roster: PokemonData[];
  events: ReplayEvent[];
  coopRunConfig?: CoopRunConfig;
  difficulty?: string;
  challenges?: CoopRunConfig["challenges"];
  /** Optional v2+ end-state summary (single-player); omitted for a co-op trace. */
  endState?: ReplayEndState;
  /** Optional v2+ window-start checkpoint (both modes); omitted when nothing was captured. */
  checkpoint?: ReplayCheckpoint;
}): ReplayTrace {
  const difficulty = args.difficulty ?? args.coopRunConfig?.difficulty ?? "youngster";
  const challenges = args.challenges ?? args.coopRunConfig?.challenges ?? [];
  return {
    version: REPLAY_TRACE_VERSION,
    seed: args.seed,
    gameModeId: args.gameModeId,
    difficulty,
    challenges,
    roster: args.roster,
    events: args.events,
    ...(args.coopRunConfig == null ? {} : { coop: { runConfig: args.coopRunConfig } }),
    ...(args.endState == null ? {} : { endState: args.endState }),
    ...(args.checkpoint == null ? {} : { checkpoint: args.checkpoint }),
  };
}
