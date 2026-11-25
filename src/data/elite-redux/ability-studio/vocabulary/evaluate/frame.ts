/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// EVALUATE (game) side of the vocabulary: the runtime frame that IF and DO blocks read.
// The pure registries (../*.ts) only name slots; this file fills them from real engine parameters.

import { effectiveDamageAfterMultiHit } from "#abilities/ab-attrs";
import type { BattlerTag } from "#data/battler-tags";
import type { TerrainType } from "#data/terrain";
import type { HitResult } from "#enums/hit-result";
import type { StatusEffect } from "#enums/status-effect";
import type { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { WHEN_MOVE_USER } from "../when-registry";

export interface HitCounters {
  /** How many hits the move will deal in total. */
  readonly count: number;
  /** The 1-based number of the current hit. */
  readonly index: number;
}

/** The typed frame: one optional field per slot of vocabulary/slots.ts. */
export interface Frame {
  readonly holder: Pokemon;
  readonly other?: Pokemon | undefined;
  readonly move?: Move | undefined;
  readonly moveUser?: Pokemon | undefined;
  /** The effective damage (for after-taking-damage this already includes the multi-hit rewrite). */
  readonly damage?: number | undefined;
  readonly hitResult?: HitResult | undefined;
  readonly stat?: number | undefined;
  readonly stages?: number | undefined;
  readonly weather?: WeatherType | undefined;
  readonly terrain?: TerrainType | undefined;
  readonly status?: StatusEffect | undefined;
  readonly tag?: BattlerTag | undefined;
  readonly ally?: Pokemon | undefined;
  readonly simulated: boolean;
  readonly hits?: HitCounters | undefined;
  /** The running type-chart multiplier (calc.move-immunity and calc.type-matchup), read when the frame is built. */
  readonly typeMultiplier?: number | undefined;
  /**
   * Memory writes (time.once-per, time.nth-use) wait here while the IF list is read, and the carrier
   * runs them in apply(), after every IF and the chance roll passed. Absent when a condition is
   * evaluated on its own: the write then happens at once.
   */
  commits?: (() => void)[] | undefined;
  /**
   * nth-use count writes wait here until the IF list was evaluated; the carrier runs them then, pass or fail.
   * Absent when a condition is evaluated on its own: the write then happens at once.
   */
  counts?: (() => void)[] | undefined;
}

/** A compiled IF: built once, then called with a frame. Never interpreted per call. */
export type Condition = (frame: Frame) => boolean;

interface HolderLike {
  readonly value: number;
}

function numberOf(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (
    typeof value === "object"
    && value !== null
    && "value" in value
    && typeof (value as HolderLike).value === "number"
  ) {
    return (value as HolderLike).value;
  }
  return;
}

function firstPokemon(...candidates: unknown[]): Pokemon | undefined {
  return candidates.find(candidate => typeof candidate === "object" && candidate !== null) as Pokemon | undefined;
}

/**
 * Builds the frame for a WHEN from the parameter object the engine passed to an AbAttr.
 * `whenId` decides whose type/flags the `moveUser` slot reads (WHEN_MOVE_USER).
 */
export function frameFromAttrParams(whenId: string, params: object): Frame {
  const raw = params as Record<string, unknown>;
  const holder = raw.pokemon as Pokemon;
  const other = firstPokemon(raw.opponent, raw.attacker, raw.victim, raw.target, raw.sourcePokemon, raw.source);
  const rawMove = raw.move as (Move & { getMove?: () => Move }) | undefined;
  const move = rawMove !== undefined && typeof rawMove.getMove === "function" ? rawMove.getMove() : rawMove;
  const moveUserIs = WHEN_MOVE_USER[whenId];
  const stats = (raw.stats ?? raw.incomingStats) as readonly number[] | undefined;
  const weatherRaw = raw.weather as { weatherType?: WeatherType } | WeatherType | null | undefined;
  const hitCount = numberOf(raw.hitCount);
  const damage =
    whenId === "event.after-taking-damage" && typeof raw.damage === "number"
      ? effectiveDamageAfterMultiHit(holder, raw.source as Pokemon | undefined, raw.damage)
      : numberOf(raw.damage);
  let ally: Pokemon | undefined;
  let allyResolved = false;
  return {
    holder,
    other,
    move,
    moveUser: moveUserIs === "other" ? other : moveUserIs === "holder" ? holder : undefined,
    damage,
    hitResult: raw.hitResult as HitResult | undefined,
    stat: (raw.stat as number | undefined) ?? stats?.[0],
    stages: numberOf(raw.stages) ?? numberOf(raw.incomingStages) ?? numberOf(raw.numStages),
    weather:
      typeof weatherRaw === "object" && weatherRaw !== null
        ? weatherRaw.weatherType
        : (weatherRaw as WeatherType | undefined),
    terrain: raw.terrain as TerrainType | undefined,
    status: (raw.effect ?? raw.statusEffect) as StatusEffect | undefined,
    tag: raw.tag as BattlerTag | undefined,
    // Lazy: resolving the ally on every damage calculation would be wasted work.
    get ally() {
      if (!allyResolved) {
        ally = holder.getAlly();
        allyResolved = true;
      }
      return ally;
    },
    simulated: raw.simulated === true,
    hits: hitCount === undefined ? undefined : { count: hitCount, index: 1 },
    typeMultiplier: numberOf(raw.typeMultiplier),
  };
}

export { effectiveDamageAfterMultiHit };

export function holderLikeOf(frame: Frame, who: string): Pokemon | undefined {
  switch (who) {
    case "holder":
      return frame.holder;
    case "other":
      return frame.other;
    case "ally":
      return frame.ally;
    default:
      return;
  }
}
