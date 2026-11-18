/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// BattleTrace (spec section 4, L2 item 6): the single helper that records everything an ability twin
// test compares, and the plain-language diff of two recordings.
//
// It records: per-attr evaluation events from the env-gated hook in applySingleAbAttrs, damage via
// HP snapshots, stat stages, status, form, types, weather, terrain, arena tags, switches, queued
// messages, ability flyouts, the names of unshifted phases, and every randBattleSeedInt call
// (count AND argument sequence, so a reordered draw is caught even when the count matches).
//
// RNG: GameManager replaces BattleScene.prototype.randBattleSeedInt with a "max roll" stub. Mode
// "max" keeps that behaviour (and counts the calls). Mode "seeded" installs a pinned-seed generator
// instead, so chance atoms come up both ways; the seed also pins Phaser's global stream (damage
// rolls) through the framework's `game.override.seed` and `Overrides.SEED_OVERRIDE`.

import { type AbilityTraceEvent, setAbilityTraceSink } from "#abilities/ability-trace";
import Overrides from "#app/overrides";
import type { Pokemon } from "#field/pokemon";
import type { GameManager } from "#test/framework/game-manager";
import { type MockInstance, vi } from "vitest";

export type { AbilityTraceEvent };

export type RngMode = "max" | "seeded";

export interface BattleTraceOptions {
  readonly rng?: RngMode;
  /** Pinned seed for the "seeded" mode and for Phaser's global stream. */
  readonly seed?: string;
  /** Maps a shadow ability id to the id it stands in for, so twin traces compare equal. */
  readonly aliases?: Readonly<Record<number, number>>;
}

export interface TraceSnapshot {
  readonly label: string;
  readonly data: Record<string, unknown>;
}

export interface TraceData {
  readonly rngCalls: number;
  readonly rngLog: readonly string[];
  readonly attrEvents: readonly string[];
  readonly messages: readonly string[];
  readonly flyouts: readonly string[];
  readonly phases: readonly string[];
  readonly snapshots: readonly TraceSnapshot[];
}

/** mulberry32 over an FNV-1a hash of the seed string. Deterministic and tiny. */
export function seededGenerator(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pokemonState(mon: Pokemon | undefined): Record<string, unknown> | null {
  if (mon === undefined) {
    return null;
  }
  return {
    species: mon.species.speciesId,
    form: mon.formIndex,
    hp: mon.hp,
    maxHp: mon.getMaxHp(),
    stages: [...mon.summonData.statStages],
    status: mon.status?.effect ?? 0,
    types: mon.getTypes(),
    tags: mon.summonData.tags.map(tag => String(tag.tagType)).sort(),
    fainted: mon.isFainted(),
  };
}

export class BattleTrace {
  private readonly attrEvents: string[] = [];
  private readonly rngLog: string[] = [];
  private readonly snapshots: TraceSnapshot[] = [];
  private readonly spies: Record<"message" | "flyout" | "phase" | "rng", MockInstance>;
  private next: () => number;
  private readonly rngMode: RngMode;
  private readonly seed: string;
  private readonly aliases: Readonly<Record<number, number>>;
  private attached = true;
  private readonly game: GameManager;

  private constructor(game: GameManager, options: BattleTraceOptions) {
    this.game = game;
    this.rngMode = options.rng ?? "max";
    this.seed = options.seed ?? "decomp-harness";
    this.aliases = options.aliases ?? {};
    this.next = seededGenerator(this.seed);
    const scene = game.scene;
    // Same deterministic world for both twins: the framework's seed override pins Phaser's global stream.
    vi.spyOn(Overrides, "SEED_OVERRIDE", "get").mockReturnValue(this.seed);
    game.override.seed(this.seed);
    this.spies = {
      rng: vi.spyOn(scene, "randBattleSeedInt").mockImplementation((range: number, min = 0) => {
        this.rngLog.push(`${range}+${min}`);
        if (this.rngMode === "max") {
          return min + range - 1;
        }
        return range <= 1 ? min : min + Math.floor(this.next() * range);
      }),
      message: vi.spyOn(scene.phaseManager, "queueMessage"),
      flyout: vi.spyOn(scene.phaseManager, "queueAbilityDisplay"),
      phase: vi.spyOn(scene.phaseManager, "unshiftPhase"),
    };
    setAbilityTraceSink({
      record: event => {
        const flags = `${event.condition === null ? "-" : event.condition ? "c1" : "c0"}${
          event.canApply === null ? "-" : event.canApply ? "a1" : "a0"
        }${event.applied ? "!" : "."}`;
        this.attrEvents.push(
          `${this.alias(event.ability)}#${event.attrIndex} ${event.attrClass} via ${event.dispatchKey}`
            + `${event.passive ? ` passive${event.passiveSlot}` : ""}${event.simulated ? " sim" : ""} ${flags}`,
        );
      },
    });
  }

  /**
   * Starts recording. Call BEFORE `startBattle` so entry effects are traced too, and call `detach()`
   * when done (a test's `afterEach`).
   */
  static attach(game: GameManager, options: BattleTraceOptions = {}): BattleTrace {
    return new BattleTrace(game, options);
  }

  private alias(id: number): number {
    return this.aliases[id] ?? id;
  }

  /** Restarts the pinned generator (for a second run on the same trace object). */
  reseed(): void {
    this.next = seededGenerator(this.seed);
  }

  /** Records the whole observable field right now. */
  snapshot(label: string): void {
    const scene = this.game.scene;
    const arena = scene.arena;
    this.snapshots.push({
      label,
      data: {
        player: scene.getPlayerField().map(pokemonState),
        enemy: scene.getEnemyField().map(pokemonState),
        // Switches show up as a change of the active species / party order.
        party: scene.getPlayerParty().map(mon => `${mon.species.speciesId}:${mon.hp}`),
        weather: arena.weather?.weatherType ?? 0,
        terrain: arena.terrain?.terrainType ?? 0,
        arenaTags: arena.tags.map(tag => `${tag.tagType}@${tag.side}`).sort(),
        turn: scene.currentBattle?.turn ?? 0,
      },
    });
  }

  detach(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;
    setAbilityTraceSink(null);
    for (const spy of Object.values(this.spies)) {
      spy.mockRestore();
    }
  }

  /** The recording so far, as plain JSON-safe data. */
  data(): TraceData {
    const aliasOf = (id: number | undefined): number | string => (id === undefined ? "-" : this.alias(id));
    return {
      rngCalls: this.rngLog.length,
      rngLog: [...this.rngLog],
      attrEvents: [...this.attrEvents],
      messages: this.spies.message.mock.calls.map(call => String(call[0])),
      flyouts: this.spies.flyout.mock.calls.map(
        ([pokemon, passive, show, slot, resolved]) =>
          `${pokemon.getBattlerIndex()}|${passive ? "passive" : "active"}${slot ?? 0}|${show ? "show" : "hide"}|${aliasOf(resolved)}`,
      ),
      phases: this.spies.phase.mock.calls.flatMap(call => (call as { phaseName: string }[]).map(p => p.phaseName)),
      snapshots: this.snapshots.map(s => ({ label: s.label, data: JSON.parse(JSON.stringify(s.data)) })),
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Diff

export interface TraceDifference {
  /** Which part of the trace differs. */
  readonly part: string;
  /** One plain sentence a reviewer can read without knowing the code. */
  readonly message: string;
}

function firstListDifference(
  part: string,
  what: string,
  a: readonly string[],
  b: readonly string[],
): TraceDifference[] {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) {
      return [
        {
          part,
          message:
            `${what} differ at entry ${i + 1} (original has ${a.length}, rebuild has ${b.length}): `
            + `original "${a[i] ?? "(nothing)"}" vs rebuild "${b[i] ?? "(nothing)"}"`,
        },
      ];
    }
  }
  return [];
}

function flatten(value: unknown, path: string, out: Map<string, string>): void {
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      flatten(item, path === "" ? key : `${path}.${key}`, out);
    }
    return;
  }
  out.set(path, JSON.stringify(value));
}

/** Compares two recordings. An empty result means the twins behaved identically on everything recorded. */
export function diffTraces(original: TraceData, rebuild: TraceData): TraceDifference[] {
  const diffs: TraceDifference[] = [];
  if (original.rngCalls === rebuild.rngCalls) {
    diffs.push(...firstListDifference("rng-order", "random draws", original.rngLog, rebuild.rngLog));
  } else {
    diffs.push({
      part: "rng-count",
      message: `random draws differ: the original drew ${original.rngCalls} times, the rebuild ${rebuild.rngCalls} times`,
    });
  }
  diffs.push(
    ...firstListDifference("attr-events", "ability attr evaluations", original.attrEvents, rebuild.attrEvents),
  );
  diffs.push(...firstListDifference("messages", "battle messages", original.messages, rebuild.messages));
  diffs.push(...firstListDifference("flyouts", "ability flyouts", original.flyouts, rebuild.flyouts));
  diffs.push(...firstListDifference("phases", "queued phases", original.phases, rebuild.phases));
  if (original.snapshots.length !== rebuild.snapshots.length) {
    diffs.push({
      part: "snapshots",
      message: `the runs took ${original.snapshots.length} and ${rebuild.snapshots.length} snapshots`,
    });
  }
  for (let i = 0; i < Math.min(original.snapshots.length, rebuild.snapshots.length); i++) {
    const a = new Map<string, string>();
    const b = new Map<string, string>();
    flatten(original.snapshots[i].data, "", a);
    flatten(rebuild.snapshots[i].data, "", b);
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      if (a.get(key) !== b.get(key)) {
        diffs.push({
          part: `snapshot:${original.snapshots[i].label}`,
          message: `at "${original.snapshots[i].label}" ${key} is ${a.get(key) ?? "missing"} in the original but ${b.get(key) ?? "missing"} in the rebuild`,
        });
      }
    }
  }
  return diffs;
}
