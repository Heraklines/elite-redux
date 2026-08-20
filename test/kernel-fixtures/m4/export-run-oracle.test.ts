/*
 * M4A test-only oracle exporter.
 *
 * This module is deliberately a capture harness, not a mechanics implementation.
 * It observes the pinned TypeScript runtime and refuses publication when a
 * required value is behind a callback, renderer, asset, or unavailable live
 * fixture seam. No fixture is synthesized from a contract manifest or from an
 * M3 JSON byte stream.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureBiomeEncounter } from "./export/biome-encounter-capture";
import { captureMigrationCompanions } from "./export/migration-companion-capture";
import { captureProgression } from "./export/progression-capture";
import { captureRunContent } from "./export/run-content-capture";
import { captureRewardMarket } from "./export/reward-market-capture";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const M3_PARITY_ORACLE_SHA = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
const M4_ORACLE_SHA = "45c89493e7edec9c4da247a98cd7858b1f015c09";
const SAFE_U53_MAX = 9_007_199_254_740_991;
const REQUIRED_OUTPUT_ROOT = process.env.M4_ORACLE_OUTPUT_ROOT;
const REQUIRED_EXPORTER_SHA = process.env.M4_ORACLE_EXPORTER_SHA;

interface JsonObject {
  [key: string]: JsonValue;
}
type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type AnyRecord = Record<string, any>;

interface RngState {
  state_string: string;
  s0_bits: string;
  s1_bits: string;
  s2_bits: string;
  carry: number;
}

interface RngDraw {
  sequence: number;
  stream: "RUN" | "SEED_OFFSET";
  reason: string;
  public_api: string;
  callsite_id: string;
  arguments: JsonValue;
  result: JsonValue;
  consumed: boolean;
  before_state: RngState;
  after_state: RngState;
}

interface RngTrace {
  fixture_id: string;
  draws: RngDraw[];
  state_changes: AnyRecord[];
  next_sequence: number;
}

class OracleGap extends Error {
  readonly code: string;
  readonly source_seam: string;
  readonly vector: string;

  constructor(vector: string, code: string, sourceSeam: string, detail: string) {
    super(`M4_ORACLE_GAP:${code}:${sourceSeam}: ${detail}`);
    this.name = "OracleGap";
    this.vector = vector;
    this.code = code;
    this.source_seam = sourceSeam;
  }
}

const RNG_REASON_BY_SOURCE: readonly [string, string][] = [
  ["src/data/elite-redux/er-biome-structure.ts", "BIOME_LENGTH"],
  ["src/data/elite-redux/er-biome-routing.ts", "ROUTE_EXTRA"],
  ["src/modifier/modifier-type.ts", "REWARD_POOL"],
  ["src/phases/select-modifier-phase.ts", "REWARD_REROLL"],
  ["src/phases/biome-shop-phase.ts", "MARKET_STOCK"],
  ["src/field/arena.ts", "ENCOUNTER_SELECTION"],
  ["src/phases/encounter-phase.ts", "ENCOUNTER_MATERIALIZATION"],
  ["src/battle-scene.ts", "ENCOUNTER_MATERIALIZATION"],
  ["src/battle.ts", "ENCOUNTER_MATERIALIZATION"],
  ["src/field/pokemon.ts", "GROWTH_STATS"],
];

const RNG_METHODS = [
  "integerInRange",
  "integer",
  "frac",
  "realInRange",
  "pick",
  "shuffle",
  "sow",
  "state",
  "angle",
  "between",
  "normal",
  "weightedPick",
  "sign",
] as const;

type RngMethod = (typeof RNG_METHODS)[number];

let activeRngTrace: RngTrace | null = null;
let rngStateReadInProgress = false;
const restoreRngHooks: (() => void)[] = [];

function fail(vector: string, code: string, sourceSeam: string, detail: string): never {
  throw new OracleGap(vector, code, sourceSeam, detail);
}

function assertFinite(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`NONFINITE_ORACLE_VALUE:${path}`);
  }
}

function canonicalValue(value: unknown, path = "$"): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value as JsonValue;
  }
  if (typeof value === "number") {
    assertFinite(value, path);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (entry === undefined) {
        throw new Error(`UNDEFINED_ORACLE_VALUE:${path}[${index}]`);
      }
      return canonicalValue(entry, `${path}[${index}]`);
    });
  }
  if (typeof value === "object") {
    const output: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as AnyRecord)[key];
      if (entry === undefined) {
        throw new Error(`UNDEFINED_ORACLE_VALUE:${path}.${key}`);
      }
      output[key] = canonicalValue(entry, `${path}.${key}`);
    }
    return output;
  }
  throw new Error(`UNSUPPORTED_ORACLE_VALUE:${path}`);
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonicalValue(value))}\n`, "utf8");
}

function writeCanonical(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canonicalBytes(value));
}

function readJson(relativePath: string): AnyRecord {
  return JSON.parse(readFileSync(resolve(REPO_ROOT, relativePath), "utf8")) as AnyRecord;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function f64Bits(value: number): string {
  const bytes = new ArrayBuffer(8);
  new DataView(bytes).setFloat64(0, value, false);
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function rawRngState(rng: Phaser.Math.RandomDataGenerator): RngState {
  rngStateReadInProgress = true;
  let state: string;
  try {
    state = rng.state();
  } finally {
    rngStateReadInProgress = false;
  }
  const parts = state.split(",");
  if (parts.length !== 5 || parts[0] !== "!rnd") {
    throw new Error(`RNG_STATE_UNOBSERVABLE:${state}`);
  }
  const carry = Number(parts[1]);
  const values = parts.slice(2).map(Number);
  if (
    !Number.isSafeInteger(carry)
    || carry < 0
    || carry > 0xffffffff
    || values.some(value => !Number.isFinite(value) || value < 0 || value >= 1)
  ) {
    throw new Error(`RNG_STATE_UNOBSERVABLE:${state}`);
  }
  return {
    state_string: state,
    s0_bits: f64Bits(values[0]),
    s1_bits: f64Bits(values[1]),
    s2_bits: f64Bits(values[2]),
    carry,
  };
}

function stackCallsites(stack: string): string[] {
  const callsites: string[] = [];
  for (const line of stack.split("\n")) {
    const match = line.match(/((?:src|test|scripts)[\\/][^()\s]+?\.ts):\d+(?::\d+)?/u);
    if (match != null) {
      const path = match[1].replaceAll("\\", "/");
      if (!callsites.includes(path)) {
        callsites.push(path);
      }
    }
  }
  return callsites;
}

function callsiteAndReason(stack: string): { callsite: string; reason: string } {
  const callsites = stackCallsites(stack);
  for (const [source, reason] of RNG_REASON_BY_SOURCE) {
    const callsite = callsites.find(candidate => candidate.startsWith(source));
    if (callsite != null) {
      return { callsite, reason };
    }
  }
  fail(
    activeRngTrace?.fixture_id ?? "rng",
    "UNMAPPED_RNG_REASON",
    callsites.find(callsite => callsite.startsWith("src/")) ?? "unknown-callsite",
    `Phaser RNG call has no exporter-owned closed reason; stack=${callsites.join("|")}`,
  );
}

function jsonResult(value: unknown, path: string): JsonValue {
  if (typeof value === "number") {
    assertFinite(value, path);
    return value;
  }
  if (typeof value === "string" || value === null || typeof value === "boolean") {
    return value;
  }
  throw new Error(`RNG_RESULT_UNOBSERVABLE:${path}`);
}

function installRngObservation(): void {
  const random = Phaser.Math.RND as AnyRecord;
  for (const methodName of RNG_METHODS) {
    const original = random[methodName] as ((...args: any[]) => any) | undefined;
    if (typeof original !== "function") {
      fail("instrumentation", "OBSERVATION_SEAM_MISSING", `Phaser.Math.RND.${methodName}`, "method is not callable");
    }
    random[methodName] = function (this: AnyRecord, ...args: any[]): any {
      if (activeRngTrace == null || rngStateReadInProgress) {
        return original.apply(this, args);
      }
      const before = rawRngState(Phaser.Math.RND);
      const stack = new Error(`M4 Phaser RNG ${methodName}`).stack ?? "";
      const previousSequence = activeRngTrace.next_sequence;
      const result = original.apply(this, args);
      const after = rawRngState(Phaser.Math.RND);
      const changed = before.state_string !== after.state_string;
      const isBoundary = methodName === "sow" || methodName === "state";
      if (isBoundary) {
        if (changed) {
          activeRngTrace.state_changes.push({
            kind: methodName === "sow" ? "SEED_RESET" : "STATE_SET",
            sequence: previousSequence,
            before,
            after,
          });
        }
        return result;
      }
      const { callsite, reason } = callsiteAndReason(stack);
      activeRngTrace.draws.push({
        sequence: activeRngTrace.next_sequence++,
        stream: "RUN",
        reason,
        public_api: methodName.toUpperCase(),
        callsite_id: callsite,
        arguments: canonicalValue(args),
        result: jsonResult(result, `${activeRngTrace.fixture_id}/${methodName}`),
        consumed: changed,
        before_state: before,
        after_state: after,
      });
      return result;
    };
    restoreRngHooks.push(() => {
      random[methodName] = original;
    });
  }
}

function beginRngTrace(fixtureId: string): RngTrace {
  if (activeRngTrace != null) {
    throw new Error(`RNG_TRACE_NESTED:${fixtureId}`);
  }
  const trace: RngTrace = { fixture_id: fixtureId, draws: [], state_changes: [], next_sequence: 0 };
  activeRngTrace = trace;
  return trace;
}

function endRngTrace(trace: RngTrace): RngTrace {
  if (activeRngTrace !== trace) {
    throw new Error(`RNG_TRACE_FRONTIER_MISMATCH:${trace.fixture_id}`);
  }
  activeRngTrace = null;
  return trace;
}

function provenance(battleContentHash: string, runContentHash: string): JsonObject {
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail("provenance", "ORACLE_RUNTIME", "process", `${process.platform}/${process.arch} is not hosted linux/x64`);
  }
  if (process.env.LC_ALL !== "C" || process.env.LANG !== "C" || process.env.TZ !== "UTC") {
    fail("provenance", "ORACLE_RUNTIME", "environment", "locale/timezone must be C/UTC");
  }
  if (typeof REQUIRED_EXPORTER_SHA !== "string" || !/^[0-9a-f]{40}$/u.test(REQUIRED_EXPORTER_SHA)) {
    fail("provenance", "EXPORT_CONFIGURATION", "M4_ORACLE_EXPORTER_SHA", "exact exporter commit SHA is required");
  }
  if (!/^blake3-v1:[0-9a-f]{64}$/u.test(battleContentHash) || !/^blake3-v1:[0-9a-f]{64}$/u.test(runContentHash)) {
    fail("provenance", "CONTENT_HASH_UNOBSERVABLE", "src/init/init.ts:initializeGame", "content hashes are not exact canonical values");
  }
  return {
    m3_parity_oracle_sha: M3_PARITY_ORACLE_SHA,
    m4_oracle_sha: M4_ORACLE_SHA,
    oracle_tree_sha: git("rev-parse", `${M4_ORACLE_SHA}^{tree}`),
    exporter_commit_sha: REQUIRED_EXPORTER_SHA,
    node_version: process.version,
    phaser_version: readJson("node_modules/phaser/package.json").version,
    os: "linux",
    arch: "x64",
    locale: "C",
    timezone: "UTC",
    battle_content_hash: battleContentHash,
    run_content_hash: runContentHash,
  };
}

function strictEnvelope(
  fixtureId: string,
  evidence: {
    provenance: JsonObject;
    initial: JsonObject;
    decisions: JsonValue[];
    rng_draws: JsonValue[];
    ordered_transitions: JsonValue[];
    mutations: JsonValue[];
    presentation: JsonValue[];
    final: JsonObject;
    next_control: JsonObject;
    raw_key_tape?: JsonValue[];
  },
): JsonObject {
  return {
    schema_version: 1,
    fixture_id: fixtureId,
    provenance: evidence.provenance,
    initial: evidence.initial,
    decisions: evidence.decisions,
    rng_draws: evidence.rng_draws,
    ordered_transitions: evidence.ordered_transitions,
    mutations: evidence.mutations,
    presentation: evidence.presentation,
    final: evidence.final,
    next_control: evidence.next_control,
    ...(evidence.raw_key_tape === undefined ? {} : { raw_key_tape: evidence.raw_key_tape }),
    gaps: [],
  };
}

function captureRngVectors(): JsonObject {
  const seeds = ["m4-rng-seed-a", "m4-rng-seed-b", "m4-rng-seed-c", "m4-rng-seed-d"];
  const vectors: JsonValue[] = [];
  for (const seed of seeds) {
    const rng = new Phaser.Math.RandomDataGenerator([seed]);
    for (let index = 0; index < 250; index++) {
      const before = rawRngState(rng);
      const operation = index % 5;
      let api: string;
      let result: unknown;
      let minimum = 0;
      let cardinality = 1;
      if (operation === 0) {
        api = "INTEGER";
        result = rng.integer();
        cardinality = 0x100000000;
      } else if (operation === 1) {
        api = "FRAC";
        result = rng.frac();
      } else if (operation === 2) {
        api = "REAL_IN_RANGE";
        minimum = -3;
        cardinality = 17;
        result = rng.realInRange(-3, 14);
      } else if (operation === 3) {
        api = "INTEGER_IN_RANGE";
        minimum = index % 7;
        cardinality = 1 + (index % 13);
        result = rng.integerInRange(minimum, minimum + cardinality - 1);
      } else {
        api = "PICK";
        result = rng.pick(["zero", "one", "two", "three", "four"]);
        cardinality = 5;
      }
      const after = rawRngState(rng);
      vectors.push({
        sequence: vectors.length,
        seed,
        operation: api,
        minimum,
        cardinality,
        result: jsonResult(result, `${seed}/${index}/${api}`),
        before,
        after,
      });
    }
  }
  return { artifact_id: "rng-vectors-v1", schema_version: 1, m3_parity_oracle_sha: M3_PARITY_ORACLE_SHA, m4_oracle_sha: M4_ORACLE_SHA, vectors };
}




function captureComposedSegment(): never {
  fail(
    "run-segments/classic-composed-wave-9-through-11-v1",
    "COMPOSED_JOIN_FRONTIERS_UNOBSERVABLE",
    "test/kernel-fixtures/m4/export-run-oracle.test.ts:independent vector joins",
    "the raw-key segment cannot be published until every independently captured vector has identical canonical state, content hash, and RNG frontier",
  );
}

function outputRoot(): string {
  if (typeof REQUIRED_OUTPUT_ROOT !== "string" || REQUIRED_OUTPUT_ROOT.length === 0) {
    throw new Error("EXPORT_CONFIGURATION:M4_ORACLE_OUTPUT_ROOT is required");
  }
  return REQUIRED_OUTPUT_ROOT;
}

function collectGap(capture: () => never, gaps: OracleGap[]): void {
  try {
    capture();
  } catch (error) {
    if (error instanceof OracleGap) {
      gaps.push(error);
      return;
    }
    throw error;
  }
}

async function collectLiveCapture(
  vector: string,
  capture: () => Promise<Record<string, unknown>>,
  gaps: OracleGap[],
): Promise<JsonObject | null> {
  try {
    return canonicalValue(await capture(), vector) as JsonObject;
  } catch (error) {
    if (
      error instanceof Error
      && typeof (error as AnyRecord).code === "string"
      && typeof (error as AnyRecord).sourceSeam === "string"
    ) {
      gaps.push(
        new OracleGap(
          vector,
          String((error as AnyRecord).code),
          String((error as AnyRecord).sourceSeam),
          error.message,
        ),
      );
      return null;
    }
    throw error;
  }
}

function envelopeFromCapture(
  fixtureId: string,
  value: JsonObject,
  sharedProvenance: JsonObject,
): JsonObject {
  const initial = value.initial;
  const final = value.final;
  const decisions = value.decisions;
  const transitions = value.ordered_transitions;
  const observations = value.observations;
  const rawKeyTape = value.raw_key_tape
    ?? ((value.progression as JsonObject | undefined)?.menu_inputs);
  return strictEnvelope(fixtureId, {
    provenance: sharedProvenance,
    initial: initial != null && typeof initial === "object" && !Array.isArray(initial)
      ? initial as JsonObject
      : { canonical: value, rng: { draws: [] } },
    decisions: Array.isArray(decisions)
      ? decisions
      : value.progression == null ? [] : [value.progression],
    rng_draws: Array.isArray(value.rng_draws) ? value.rng_draws : [],
    ordered_transitions: Array.isArray(transitions)
      ? transitions
      : observations == null ? [] : [observations],
    mutations: Array.isArray(value.mutations) ? value.mutations : [],
    presentation: Array.isArray(value.presentation) ? value.presentation : [],
    final: final != null && typeof final === "object" && !Array.isArray(final)
      ? final as JsonObject
      : { canonical: value, rng: { draws: [] } },
    next_control: value.next_control != null
      && typeof value.next_control === "object"
      && !Array.isArray(value.next_control)
      ? value.next_control as JsonObject
      : { kind: "CAPTURED_BOUNDARY" },
    ...(Array.isArray(rawKeyTape) ? { raw_key_tape: rawKeyTape } : {}),
  });
}

describe("M4A fresh run oracle export", () => {
  beforeAll(() => {
    if (process.env.M4_ORACLE_SHA !== M4_ORACLE_SHA) {
      throw new Error("EXPORT_CONFIGURATION:the exporter did not pin the exact M4 oracle SHA");
    }
    if (process.platform !== "linux" || process.arch !== "x64") {
      throw new Error(`ORACLE_RUNTIME:expected hosted linux/x64, got ${process.platform}/${process.arch}`);
    }
  });

  afterAll(() => {
    activeRngTrace = null;
    for (const restore of restoreRngHooks.splice(0).reverse()) {
      restore();
    }
  });

  it("captures every required vector or fails closed with typed gaps", async () => {
    const gaps: OracleGap[] = [];
    const generated = new Map<string, JsonObject>();

    const contentPacks = await collectLiveCapture("content-packs", captureRunContent, gaps);
    if (contentPacks != null) {
      if (
        contentPacks.battle_content_pack == null
        || typeof contentPacks.battle_content_pack !== "object"
        || Array.isArray(contentPacks.battle_content_pack)
        || contentPacks.run_content_pack == null
        || typeof contentPacks.run_content_pack !== "object"
        || Array.isArray(contentPacks.run_content_pack)
      ) {
        gaps.push(
          new OracleGap(
            "content-packs",
            "CAPTURE_SHAPE_INVALID",
            "test/kernel-fixtures/m4/export/run-content-capture.ts:captureRunContent",
            "helper did not return separate battle and run content packs",
          ),
        );
      } else {
        generated.set("battle-content-pack-v1.json", contentPacks.battle_content_pack as JsonObject);
        generated.set("run-content-pack-v1.json", contentPacks.run_content_pack as JsonObject);
      }
    }

    if (Phaser.Math.RND == null) {
      gaps.push(
        new OracleGap(
          "instrumentation",
          "GLOBAL_RNG_UNINITIALIZED",
          "src/init/init.ts:initializeGame",
          "content initialization did not install Phaser.Math.RND",
        ),
      );
    } else {
      installRngObservation();
      generated.set("rng-vectors-v1.json", captureRngVectors());
    }

    const progression = await collectLiveCapture(
      "progression/nacli-medium-slow-level-17-v1",
      captureProgression,
      gaps,
    );
    if (progression != null) {
      generated.set("progression/nacli-medium-slow-level-17-v1.json", progression);
    }

    const rewardMarket = await collectLiveCapture(
      "rewards/regular-reroll-lock-v1+markets/town-wave-10-v1",
      captureRewardMarket,
      gaps,
    );
    if (rewardMarket != null) {
      if (
        rewardMarket.reward == null
        || typeof rewardMarket.reward !== "object"
        || Array.isArray(rewardMarket.reward)
        || rewardMarket.market == null
        || typeof rewardMarket.market !== "object"
        || Array.isArray(rewardMarket.market)
      ) {
        gaps.push(
          new OracleGap(
            "rewards/regular-reroll-lock-v1+markets/town-wave-10-v1",
            "CAPTURE_SHAPE_INVALID",
            "test/kernel-fixtures/m4/export/reward-market-capture.ts:captureRewardMarket",
            "helper did not return separate reward and market records",
          ),
        );
      } else {
        generated.set("rewards/regular-reroll-lock-v1.json", rewardMarket.reward as JsonObject);
        generated.set("markets/town-wave-10-v1.json", rewardMarket.market as JsonObject);
      }
    }

    const biomeEncounter = await collectLiveCapture(
      "biomes/town-crossroads-route-v1+encounters/plains-wave-11-captured-v1",
      captureBiomeEncounter,
      gaps,
    );
    if (biomeEncounter != null) {
      if (
        biomeEncounter.biome == null
        || typeof biomeEncounter.biome !== "object"
        || Array.isArray(biomeEncounter.biome)
        || biomeEncounter.encounter == null
        || typeof biomeEncounter.encounter !== "object"
        || Array.isArray(biomeEncounter.encounter)
      ) {
        gaps.push(
          new OracleGap(
            "biomes/town-crossroads-route-v1+encounters/plains-wave-11-captured-v1",
            "CAPTURE_SHAPE_INVALID",
            "test/kernel-fixtures/m4/export/biome-encounter-capture.ts:captureBiomeEncounter",
            "helper did not return separate biome and encounter records",
          ),
        );
      } else {
        generated.set("biomes/town-crossroads-route-v1.json", biomeEncounter.biome as JsonObject);
        generated.set("encounters/plains-wave-11-captured-v1.json", biomeEncounter.encounter as JsonObject);
      }
    }

    const migration = await collectLiveCapture(
      "migration/m3-to-m4-companions-v1",
      captureMigrationCompanions,
      gaps,
    );
    if (migration != null) {
      generated.set("migration/m3-to-m4-companions-v1.json", migration);
    }

    collectGap(captureComposedSegment, gaps);

    if (gaps.length > 0) {
      const reportPath = process.env.M4_ORACLE_GAP_REPORT;
      if (typeof reportPath === "string" && reportPath.length > 0) {
        writeCanonical(reportPath, {
          schema_version: 1,
          m3_parity_oracle_sha: M3_PARITY_ORACLE_SHA,
          m4_oracle_sha: M4_ORACLE_SHA,
          gaps: gaps.map(gap => ({
            vector: gap.vector,
            code: gap.code,
            source_seam: gap.source_seam,
            message: gap.message,
          })),
        });
      }
      throw new Error(gaps.map(gap => gap.message).join("\n"));
    }

    const battlePack = generated.get("battle-content-pack-v1.json") as AnyRecord | undefined;
    const battleHash = String(battlePack?.hash ?? "");
    const runPack = generated.get("run-content-pack-v1.json") as AnyRecord | undefined;
    const runHash = String(runPack?.run_content_hash ?? "");
    const sharedProvenance = provenance(battleHash, runHash);
    const root = outputRoot();
    for (const [path, value] of generated) {
      if (
        path === "rng-vectors-v1.json"
        || path === "run-content-pack-v1.json"
        || path === "battle-content-pack-v1.json"
        || path.startsWith("migration/")
      ) {
        writeCanonical(resolve(root, path), value);
      } else {
        writeCanonical(
          resolve(root, path),
          envelopeFromCapture(path.replace(/\.json$/u, ""), value, sharedProvenance),
        );
      }
    }
    expect(generated.size).toBeGreaterThan(0);
  }, 2_700_000);
});
