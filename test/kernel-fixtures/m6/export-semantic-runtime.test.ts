import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { allAbilities, allMoves, allSpecies, modifierTypes } from "#data/data-lists";
import { initializeGame } from "#init/init";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { PositionalTagType } from "#enums/positional-tag-type";
import { StatusEffect } from "#enums/status-effect";
import { TerrainType } from "#data/terrain";
import { WeatherType } from "#enums/weather-type";
import Phaser from "phaser";
import { describe, it } from "vitest";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RecordValue = Record<string, unknown>;

const ORACLE_SHA = "3bb6d49c924293ef79e3ab2f11e10cf4f5b9c6c7";

function callbackHash(value: Function): string {
  return createHash("sha256").update(Function.prototype.toString.call(value)).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function reflect(value: unknown, seen: WeakSet<object>, depth = 0): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NONFINITE_RUNTIME_SEMANTIC_VALUE");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "function") {
    return { kind: "CALLBACK_PROVENANCE", hash: callbackHash(value), name: value.name || "anonymous" };
  }
  if (typeof value !== "object") return { kind: "UNREPRESENTABLE", type: typeof value };
  if (seen.has(value)) return { kind: "CIRCULAR_REFERENCE", class: value.constructor?.name ?? "Object" };
  if (depth >= 6) return { kind: "DEPTH_LIMIT", class: value.constructor?.name ?? "Object" };
  seen.add(value);
  if (Array.isArray(value)) return value.map(entry => reflect(entry, seen, depth + 1));
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entry]) => [reflect(key, seen, depth + 1), reflect(entry, seen, depth + 1)] as Json[])
      .sort((left, right) => compareText(JSON.stringify(left[0]), JSON.stringify(right[0])));
  }
  if (value instanceof Set) {
    return [...value].map(entry => reflect(entry, seen, depth + 1)).sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
  }
  const output: RecordValue = { class: value.constructor?.name ?? "Object" };
  for (const key of Object.keys(value as RecordValue).sort()) {
    const entry = (value as RecordValue)[key];
    if (entry !== undefined) output[key] = reflect(entry, seen, depth + 1);
  }
  return output as Json;
}

function descriptor(value: unknown): Json {
  return reflect(value, new WeakSet());
}

function enumEntries(value: Record<string, string | number>): Json[] {
  return Object.entries(value)
    .filter(([key]) => Number.isNaN(Number(key)))
    .map(([key, id]) => ({ key, id }))
    .sort((left, right) => compareText(String(left.key), String(right.key)));
}

function outputPath(): string {
  const value = process.env.M6_SEMANTIC_RUNTIME_OUTPUT;
  if (!value || !isAbsolute(value)) throw new Error("M6_SEMANTIC_RUNTIME_OUTPUT must be absolute");
  return resolve(value);
}

function writeCanonical(path: string, value: Json): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

function capture(): Json {
  if (Phaser.Math.RND == null) {
    (Phaser.Math as unknown as RecordValue).RND = new Phaser.Math.RandomDataGenerator();
  }
  Phaser.Math.RND.sow(["m6-semantic-runtime"]);
  if (allSpecies.length === 0 || allMoves.length === 0 || allAbilities.length === 0) initializeGame();
  const species = [...allSpecies]
    .filter(entry => entry != null)
    .map(entry => ({ id: Number((entry as unknown as RecordValue).speciesId), definition: descriptor(entry) }))
    .sort((left, right) => left.id - right.id);
  const moves = [...allMoves]
    .filter(entry => entry != null)
    .map(entry => ({ id: Number((entry as unknown as RecordValue).id), definition: descriptor(entry) }))
    .sort((left, right) => left.id - right.id);
  const abilities = [...allAbilities]
    .filter(entry => entry != null)
    .map(entry => ({ id: Number((entry as unknown as RecordValue).id), definition: descriptor(entry) }))
    .sort((left, right) => left.id - right.id);
  const modifiers = Object.keys(modifierTypes).sort().map(key => {
    const builder = (modifierTypes as unknown as Record<string, unknown>)[key];
    if (typeof builder !== "function") return { key, builder: descriptor(builder), instance: null };
    try {
      return { key, builder: descriptor(builder), instance: descriptor(builder()) };
    } catch (error) {
      return {
        key,
        builder: descriptor(builder),
        instance: { kind: "CONSTRUCTION_GAP", message: error instanceof Error ? error.message : String(error) },
      };
    }
  });
  return {
    schema_version: 1,
    oracle_sha: ORACLE_SHA,
    species,
    moves,
    abilities,
    modifiers,
    statuses: enumEntries(StatusEffect),
    weather: enumEntries(WeatherType),
    terrain: enumEntries(TerrainType),
    battler_tags: enumEntries(BattlerTagType),
    arena_tags: enumEntries(ArenaTagType),
    positional_tags: enumEntries(PositionalTagType),
  };
}

describe("M6 runtime semantic catalog", () => {
  it("captures final post-initialization definitions", () => {
    if (process.env.M6_ORACLE_SHA !== ORACLE_SHA) throw new Error("M6 oracle SHA mismatch");
    writeCanonical(outputPath(), capture());
  }, 2_700_000);
});
