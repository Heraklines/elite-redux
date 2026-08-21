/*
 * M4A test-only oracle exporter.
 *
 * This module is deliberately a composition harness, not a mechanics
 * implementation. It reads canonical raw helper output from isolated Vitest
 * processes, validates the pinned runtime envelope, and refuses publication
 * when a required value is behind an unavailable live fixture seam. No
 * fixture is synthesized from a contract manifest or from an M3 JSON stream.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Phaser from "phaser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  requirePhysicalKeys = false,
): JsonObject {
  const initial = exactFrontier(evidence.initial, `${fixtureId}.initial`, evidence.provenance);
  const final = exactFrontier(evidence.final, `${fixtureId}.final`, evidence.provenance);
  const rawKeyTape = evidence.raw_key_tape;
  if (rawKeyTape === undefined && requirePhysicalKeys) {
    fail(fixtureId, "RAW_KEY_TAPE_UNOBSERVABLE", "test/kernel-fixtures/m4/export-run-oracle.test.ts:strictEnvelope", "physical keydown/keyup tape is required");
  }
  if (rawKeyTape !== undefined) {
    validateRawKeyTape(rawKeyTape, `${fixtureId}.raw_key_tape`);
  }
  validateNextControl(evidence.next_control, `${fixtureId}.next_control`);
  return {
    schema_version: 1,
    fixture_id: fixtureId,
    provenance: evidence.provenance,
    initial,
    decisions: requireArray(evidence.decisions, `${fixtureId}.decisions`),
    rng_draws: requireArray(evidence.rng_draws, `${fixtureId}.rng_draws`),
    ordered_transitions: requireArray(evidence.ordered_transitions, `${fixtureId}.ordered_transitions`),
    mutations: requireArray(evidence.mutations, `${fixtureId}.mutations`),
    presentation: requireArray(evidence.presentation, `${fixtureId}.presentation`),
    final,
    next_control: evidence.next_control,
    ...(rawKeyTape === undefined ? {} : { raw_key_tape: rawKeyTape }),
    gaps: [],
  };
}

function requireArray(value: unknown, path: string): JsonValue[] {
  if (!Array.isArray(value)) {
    fail(path, "CAPTURE_TRACE_INCOMPLETE", "M4_CAPTURE_OUTPUT", "required observed array is missing");
  }
  return value;
}

function exactFrontier(value: unknown, path: string, sharedProvenance: JsonObject): JsonObject {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "JOIN_FRONTIER_UNOBSERVABLE", "M4_JOIN_FRONTIER", "frontier must be an object");
  }
  const frontier = value as AnyRecord;
  const canonical = frontier.canonical;
  if (canonical == null || typeof canonical !== "object" || Array.isArray(canonical)) {
    fail(path, "CANONICAL_STATE_UNOBSERVABLE", "M4_JOIN_FRONTIER.canonical", "complete canonical GameStateV2 projection is missing");
  }
  const canonicalRecord = canonical as AnyRecord;
  if (
    canonicalRecord.schema_version !== 2
    || canonicalRecord.kind !== "GAME_STATE_V2"
    || canonicalRecord.save_data == null
    || typeof canonicalRecord.save_data !== "object"
    || canonicalRecord.runtime == null
    || typeof canonicalRecord.runtime !== "object"
  ) {
    fail(path, "CANONICAL_STATE_INCOMPLETE", "GameData.getSessionSaveData+BattleScene.runtime", "frontier is not a complete GameStateV2-equivalent projection");
  }
  const battleHash = frontier.battle_content_hash;
  const runHash = frontier.run_content_hash;
  if (battleHash !== sharedProvenance.battle_content_hash || runHash !== sharedProvenance.run_content_hash) {
    fail(path, "CONTENT_HASH_JOIN_MISMATCH", "src/init/init.ts:initializeGame", "frontier content identity differs from the exact published content hashes");
  }
  if (
    typeof battleHash !== "string" || !/^blake3-v1:[0-9a-f]{64}$/u.test(battleHash)
    || typeof runHash !== "string" || !/^blake3-v1:[0-9a-f]{64}$/u.test(runHash)
  ) {
    fail(path, "CONTENT_HASH_UNOBSERVABLE", "src/init/init.ts:initializeGame", "frontier content hashes are not exact canonical hashes");
  }
  const rng = frontier.rng;
  if (rng == null || typeof rng !== "object" || Array.isArray(rng)) {
    fail(path, "RNG_FRONTIER_UNOBSERVABLE", "Phaser.Math.RND+BattleScene.battleSeedState", "complete RNG frontier is missing");
  }
  const rngRecord = rng as AnyRecord;
  if (
    rngRecord.run == null || typeof rngRecord.run !== "object" || Array.isArray(rngRecord.run)
    || !Object.hasOwn(rngRecord, "seed_offset")
    || !Object.hasOwn(rngRecord, "battle")
    || (rngRecord.battle !== null && (typeof rngRecord.battle !== "object" || Array.isArray(rngRecord.battle)))
  ) {
    fail(path, "RNG_FRONTIER_INCOMPLETE", "Phaser.Math.RND+BattleScene.battleSeedState", "run, seed_offset, and nullable battle RNG state are all required");
  }
  if (Object.keys(rngRecord.run).length === 0 || (rngRecord.battle !== null && Object.keys(rngRecord.battle).length === 0)) {
    fail(path, "RNG_FRONTIER_INCOMPLETE", "Phaser.Math.RND+BattleScene.battleSeedState", "present RNG state is empty");
  }
  return {
    canonical: canonicalValue(canonical, `${path}.canonical`) as JsonObject,
    battle_content_hash: battleHash,
    run_content_hash: runHash,
    rng: canonicalValue(rng, `${path}.rng`) as JsonObject,
  };
}

function validateNextControl(value: unknown, path: string): void {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "NEXT_CONTROL_UNOBSERVABLE", "PhaseManager.currentPhase+queue", "actual successor control is missing");
  }
  const record = value as AnyRecord;
  if (record.kind !== "LIVE_SUCCESSOR" || typeof record.phase !== "string" || record.phase.length === 0 || !Array.isArray(record.queued_phases)) {
    fail(path, "NEXT_CONTROL_UNOBSERVABLE", "PhaseManager.currentPhase+queue", "next_control is not an observed successor frontier");
  }
}

function validateRawKeyTape(value: JsonValue[], path: string): void {
  const physicalKeyKind: Record<string, true> = {
    ARROW_UP: true,
    ARROW_DOWN: true,
    ARROW_LEFT: true,
    ARROW_RIGHT: true,
    ENTER: true,
    SPACE: true,
    ESCAPE: true,
    BACKSPACE: true,
    KEY_A: true,
    KEY_B: true,
    KEY_C: true,
    KEY_D: true,
    KEY_E: true,
    KEY_F: true,
    KEY_N: true,
    KEY_R: true,
    KEY_T: true,
  };
  for (let index = 0; index < value.length; index += 2) {
    const down = value[index];
    const up = value[index + 1];
    if (down == null || up == null || typeof down !== "object" || typeof up !== "object" || Array.isArray(down) || Array.isArray(up)) {
      fail(path, "RAW_KEY_TAPE_INVALID", "InputsController.keyboardKeyDown/keyboardKeyUp", `entry ${index} is not a complete keydown/keyup pair`);
    }
    const downRecord = down as AnyRecord;
    const upRecord = up as AnyRecord;
    if (downRecord.sequence !== index || upRecord.sequence !== index + 1) {
      fail(path, "RAW_KEY_TAPE_INVALID", "InputsController.keyboardKeyDown/keyboardKeyUp", `entry ${index} has a non-contiguous sequence`);
    }
    const downEvent = downRecord.event as AnyRecord;
    const upEvent = upRecord.event as AnyRecord;
    const downData = downEvent?.data as AnyRecord;
    const upData = upEvent?.data as AnyRecord;
    const downCode = downData?.code as AnyRecord;
    const upCode = upData?.code as AnyRecord;
    if (
      downEvent?.kind !== "KEY_DOWN"
      || upEvent?.kind !== "KEY_UP"
      || downCode == null || typeof downCode.kind !== "string" || physicalKeyKind[downCode.kind] !== true
      || upCode == null || upCode.kind !== downCode.kind
      || downData.printable !== (downCode.kind === "SPACE" || downCode.kind.startsWith("KEY_"))
      || downData.browser_repeat !== false
      || downData.focus !== "GAME"
    ) {
      fail(path, "RAW_KEY_TAPE_INVALID", "InputsController.keyboardKeyDown/keyboardKeyUp", `entry ${index} is not a serde-compatible physical key pair`);
    }
  }
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

function firstDifference(left: unknown, right: unknown, path = "$"): string | null {
  if (Object.is(left, right)) {
    return null;
  }
  if (typeof left !== typeof right || left == null || right == null) {
    return path;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return path;
    }
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (difference != null) {
        return difference;
      }
    }
    return null;
  }
  if (typeof left === "object" && typeof right === "object") {
    const leftRecord = left as AnyRecord;
    const rightRecord = right as AnyRecord;
    const keysByName: Record<string, true> = {};
    for (const key of Object.keys(leftRecord)) {
      keysByName[key] = true;
    }
    for (const key of Object.keys(rightRecord)) {
      keysByName[key] = true;
    }
    const keys = Object.keys(keysByName).sort();
    for (const key of keys) {
      if (!Object.hasOwn(leftRecord, key) || !Object.hasOwn(rightRecord, key)) {
        return `${path}.${key}`;
      }
      const difference = firstDifference(leftRecord[key], rightRecord[key], `${path}.${key}`);
      if (difference != null) {
        return difference;
      }
    }
  }
  return path;
}

function assertJoin(
  left: JsonObject,
  right: JsonObject,
  join: string,
  sharedProvenance: JsonObject,
): void {
  const leftFrontier = exactFrontier(left, `${join}.left`, sharedProvenance);
  const rightFrontier = exactFrontier(right, `${join}.right`, sharedProvenance);
  for (const dimension of ["battle_content_hash", "run_content_hash"] as const) {
    if (leftFrontier[dimension] !== rightFrontier[dimension]) {
      fail(join, "JOIN_DIMENSION_MISMATCH", `M4_JOIN_FRONTIER.${dimension}`, `${dimension} differs at ${join}`);
    }
  }
  const canonicalDifference = firstDifference(leftFrontier.canonical, rightFrontier.canonical, "canonical");
  if (canonicalDifference != null) {
    fail(join, "JOIN_CANONICAL_MISMATCH", "M4_JOIN_FRONTIER.canonical", `canonical state differs at ${canonicalDifference}`);
  }
  const rngDifference = firstDifference(leftFrontier.rng, rightFrontier.rng, "rng");
  if (rngDifference != null) {
    fail(join, "JOIN_RNG_MISMATCH", "M4_JOIN_FRONTIER.rng", `RNG frontier differs at ${rngDifference}`);
  }
}

function captureComposedSegment(value: JsonObject, sharedProvenance: JsonObject): JsonObject {
  const vector = "run-segments/classic-composed-wave-9-through-11-v1";
  if (value.artifact_id !== "run-segment-composed-v1" || value.schema_version !== 1 || value.kind !== "oracle-composed") {
    fail(vector, "COMPOSED_CAPTURE_SHAPE_INVALID", "test/kernel-fixtures/m4/export/composed-capture.ts:captureComposedSegment", "dedicated live composed artifact header is invalid");
  }
  if (value.natural_single_seed_claim !== false) {
    fail(vector, "NATURAL_SINGLE_SEED_FORBIDDEN", "test/kernel-fixtures/m4/export/composed-capture.ts:captureComposedSegment", "composed evidence must not claim a natural single seed");
  }
  if (
    value.fixture_address == null
    || typeof value.fixture_address !== "object"
    || Array.isArray(value.fixture_address)
    || value.content_identity == null
    || typeof value.content_identity !== "object"
    || Array.isArray(value.content_identity)
  ) {
    fail(vector, "COMPOSED_PROVENANCE_INCOMPLETE", "test/kernel-fixtures/m4/export/composed-capture.ts:fixture address", "fixture address and content identity are required");
  }
  const contentIdentity = value.content_identity as AnyRecord;
  if (contentIdentity.battle_content_hash !== sharedProvenance.battle_content_hash || contentIdentity.run_content_hash !== sharedProvenance.run_content_hash) {
    fail(vector, "CONTENT_HASH_JOIN_MISMATCH", "src/init/init.ts:initializeGame", "composed content identity differs from the exact published hashes");
  }
  const expectedControls = ["BATTLE", "MOVE_LEARN", "REWARD_SHOP", "BATTLE", "BIOME_MARKET", "CROSSROADS", "BIOME_SELECT", "BATTLE"];
  if (JSON.stringify(value.control_order) !== JSON.stringify(expectedControls)) {
    fail(vector, "CONTROL_ORDER_MISMATCH", "test/kernel-fixtures/m4/export/composed-capture.ts:control transitions", "composed control spine is not the frozen wave-9-through-11 order");
  }
  const segments = value.segments;
  if (!Array.isArray(segments) || segments.length !== 5) {
    fail(vector, "COMPOSED_SEGMENTS_INCOMPLETE", "test/kernel-fixtures/m4/export/composed-capture.ts:captureComposedSegment", "exactly five live causal segments are required");
  }
  const ids = ["progression", "reward", "market", "biome", "encounter"];
  for (const [index, id] of ids.entries()) {
    const segment = segments[index];
    if (segment == null || typeof segment !== "object" || Array.isArray(segment)) {
      fail(vector, "COMPOSED_SEGMENT_INVALID", "test/kernel-fixtures/m4/export/composed-capture.ts:captureComposedSegment", `${id} segment is not an object`);
    }
    const record = segment as JsonObject;
    if (record.id !== id) {
      fail(vector, "COMPOSED_SEGMENT_ORDER_INVALID", "test/kernel-fixtures/m4/export/composed-capture.ts:captureComposedSegment", `segment ${index} is not ${id}`);
    }
    exactFrontier(record.initial, `${vector}.${id}.initial`, sharedProvenance);
    exactFrontier(record.final, `${vector}.${id}.final`, sharedProvenance);
    if (!Array.isArray(record.raw_key_tape)) {
      fail(vector, "RAW_KEY_TAPE_UNOBSERVABLE", "InputsController.keyboardKeyDown/keyboardKeyUp", `${id} has no physical tape`);
    }
    validateRawKeyTape(record.raw_key_tape, `${vector}.${id}.raw_key_tape`);
  }
  const joins = ["J1 progression→reward", "J2 reward→market", "J3 market→biome", "J4 biome→encounter"];
  for (let index = 0; index < joins.length; index += 1) {
    assertJoin(
      (segments[index] as JsonObject).final as JsonObject,
      (segments[index + 1] as JsonObject).initial as JsonObject,
      joins[index],
      sharedProvenance,
    );
  }
  const initial = exactFrontier(value.initial, `${vector}.initial`, sharedProvenance);
  const final = exactFrontier(value.final, `${vector}.final`, sharedProvenance);
  const firstInitial = (segments[0] as JsonObject).initial as JsonObject;
  const lastFinal = (segments[4] as JsonObject).final as JsonObject;
  assertJoin(initial, firstInitial, "J0 composed→progression", sharedProvenance);
  assertJoin(lastFinal, final, "J5 encounter→composed", sharedProvenance);
  if (!Array.isArray(value.raw_key_tape)) {
    fail(vector, "RAW_KEY_TAPE_UNOBSERVABLE", "InputsController.keyboardKeyDown/keyboardKeyUp", "composed physical tape is missing");
  }
  validateRawKeyTape(value.raw_key_tape, `${vector}.raw_key_tape`);
  const envelope = strictEnvelope(vector, {
    provenance: sharedProvenance,
    initial,
    decisions: Array.isArray(value.decisions) ? value.decisions : fail(vector, "COMPOSED_DECISIONS_UNOBSERVABLE", "composed-capture.ts", "decisions are missing"),
    rng_draws: Array.isArray(value.rng_draws) ? value.rng_draws : fail(vector, "COMPOSED_RNG_DRAWS_UNOBSERVABLE", "composed-capture.ts", "RNG draw trace is missing"),
    ordered_transitions: Array.isArray(value.ordered_transitions) ? value.ordered_transitions : fail(vector, "COMPOSED_TRANSITIONS_UNOBSERVABLE", "composed-capture.ts", "ordered transitions are missing"),
    mutations: Array.isArray(value.mutations) ? value.mutations : fail(vector, "COMPOSED_MUTATIONS_UNOBSERVABLE", "composed-capture.ts", "mutation trace is missing"),
    presentation: Array.isArray(value.presentation) ? value.presentation : fail(vector, "COMPOSED_PRESENTATION_UNOBSERVABLE", "composed-capture.ts", "presentation trace is missing"),
    final,
    next_control: value.next_control as JsonObject,
    raw_key_tape: value.raw_key_tape,
  }, true);
  return {
    ...envelope,
    kind: "oracle-composed",
    natural_single_seed_claim: false,
    fixture_address: value.fixture_address,
    control_order: value.control_order,
    segments,
    content_identity: value.content_identity,
  };
}

function outputRoot(): string {
  if (typeof REQUIRED_OUTPUT_ROOT !== "string" || REQUIRED_OUTPUT_ROOT.length === 0) {
    throw new Error("EXPORT_CONFIGURATION:M4_ORACLE_OUTPUT_ROOT is required");
  }
  return REQUIRED_OUTPUT_ROOT;
}

function collectGap(capture: () => unknown, gaps: OracleGap[]): void {
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




function rawRoot(): string {
  const value = process.env.M4_ORACLE_RAW_ROOT;
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value)) {
    throw new Error("EXPORT_CONFIGURATION:M4_ORACLE_RAW_ROOT must be an absolute directory");
  }
  return resolve(value);
}

function rawCapture(
  kind: CaptureKind,
  vector: string,
  gaps: OracleGap[],
): JsonObject | null {
  const path = resolve(rawRoot(), RAW_CAPTURE_FILES[kind]);
  if (!existsSync(path)) {
    gaps.push(new OracleGap(vector, "CAPTURE_OUTPUT_MISSING", `M4_CAPTURE_OUTPUT:${kind}`, `raw helper output is missing at ${path}`));
    return null;
  }
  try {
    const bytes = readFileSync(path);
    const parsed = JSON.parse(bytes.toString("utf8")) as AnyRecord;
    if (!bytes.equals(canonicalBytes(parsed))) {
      gaps.push(new OracleGap(vector, "CAPTURE_OUTPUT_NONCANONICAL", `M4_CAPTURE_OUTPUT:${kind}`, `raw helper output is not canonical at ${path}`));
      return null;
    }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      gaps.push(new OracleGap(vector, "CAPTURE_OUTPUT_SHAPE_INVALID", `M4_CAPTURE_OUTPUT:${kind}`, `raw helper output is not an object at ${path}`));
      return null;
    }
    const gap = parsed.m4_capture_gap;
    if (gap != null) {
      if (
        typeof gap !== "object"
        || Array.isArray(gap)
        || typeof (gap as AnyRecord).code !== "string"
        || typeof (gap as AnyRecord).source_seam !== "string"
        || typeof (gap as AnyRecord).message !== "string"
      ) {
        gaps.push(new OracleGap(vector, "CAPTURE_GAP_INVALID", `M4_CAPTURE_OUTPUT:${kind}`, `typed gap is malformed at ${path}`));
      } else {
        gaps.push(
          new OracleGap(
            vector,
            String((gap as AnyRecord).code),
            String((gap as AnyRecord).source_seam),
            String((gap as AnyRecord).message),
          ),
        );
      }
      return null;
    }
    return parsed;
  } catch (error) {
    gaps.push(
      new OracleGap(
        vector,
        "CAPTURE_OUTPUT_INVALID",
        `M4_CAPTURE_OUTPUT:${kind}`,
        error instanceof Error ? error.message : String(error),
      ),
    );
    return null;
  }
}

function captureShape(
  value: JsonObject,
  vector: string,
  sourceSeam: string,
  keys: readonly string[],
  gaps: OracleGap[],
): boolean {
  for (const key of keys) {
    const entry = value[key];
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      gaps.push(new OracleGap(vector, "CAPTURE_SHAPE_INVALID", sourceSeam, `helper output is missing record ${key}`));
      return false;
    }
  }
  return true;
}
function envelopeFromCapture(
  fixtureId: string,
  value: JsonObject,
  sharedProvenance: JsonObject,
): JsonObject {
  const requiredObject = (key: string): JsonObject => {
    const entry = value[key];
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      fail(fixtureId, "CAPTURE_FRONTIER_INCOMPLETE", `M4_CAPTURE_OUTPUT:${fixtureId}`, `${key} is not an observed object`);
    }
    return entry as JsonObject;
  };
  const requiredArray = (key: string): JsonValue[] => {
    const entry = value[key];
    if (!Array.isArray(entry)) {
      fail(fixtureId, "CAPTURE_TRACE_INCOMPLETE", `M4_CAPTURE_OUTPUT:${fixtureId}`, `${key} is not an observed array`);
    }
    return entry;
  };
  return strictEnvelope(fixtureId, {
    provenance: sharedProvenance,
    initial: requiredObject("initial"),
    decisions: requiredArray("decisions"),
    rng_draws: requiredArray("rng_draws"),
    ordered_transitions: requiredArray("ordered_transitions"),
    mutations: requiredArray("mutations"),
    presentation: requiredArray("presentation"),
    final: requiredObject("final"),
    next_control: requiredObject("next_control"),
  });
}

const RAW_CAPTURE_FILES = {
  content: "content.json",
  "reward-market": "reward-market.json",
  progression: "progression.json",
  biome: "biome.json",
  encounter: "encounter.json",
  migration: "migration.json",
  composed: "composed.json",
} as const;

type CaptureKind = keyof typeof RAW_CAPTURE_FILES;

describe("M4A fresh run oracle export", () => {
  beforeAll(() => {
    if (process.env.M4_ORACLE_SHA !== M4_ORACLE_SHA) {
      throw new Error("EXPORT_CONFIGURATION:the exporter did not pin the exact M4 oracle SHA");
    }
    if (process.platform !== "linux" || process.arch !== "x64") {
      throw new Error(`ORACLE_RUNTIME:expected hosted linux/x64, got ${process.platform}/${process.arch}`);
    }
  });

  it("composes raw helper outputs or fails closed with typed gaps", () => {
    const gaps: OracleGap[] = [];
    const generated = new Map<string, JsonObject>();
    const contentPacks = rawCapture("content", "content-packs", gaps);
    if (contentPacks != null && captureShape(
      contentPacks,
      "content-packs",
      "test/kernel-fixtures/m4/export/run-content-capture.ts:captureRunContent",
      ["battle_content_pack", "run_content_pack"],
      gaps,
    )) {
      generated.set("battle-content-pack-v1.json", contentPacks.battle_content_pack as JsonObject);
      generated.set("run-content-pack-v1.json", contentPacks.run_content_pack as JsonObject);
    }

    try {
      generated.set("rng-vectors-v1.json", captureRngVectors());
    } catch (error) {
      gaps.push(
        new OracleGap(
          "rng-vectors",
          "RNG_CAPTURE_FAILED",
          "test/kernel-fixtures/m4/export-run-oracle.test.ts:captureRngVectors",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }

    const rewardMarket = rawCapture(
      "reward-market",
      "rewards/regular-reroll-lock-v1+markets/town-wave-10-v1",
      gaps,
    );
    if (rewardMarket != null && captureShape(
      rewardMarket,
      "rewards/regular-reroll-lock-v1+markets/town-wave-10-v1",
      "test/kernel-fixtures/m4/export/reward-market-capture.ts:captureRewardMarket",
      ["reward", "market"],
      gaps,
    )) {
      generated.set("rewards/regular-reroll-lock-v1.json", rewardMarket.reward as JsonObject);
      generated.set("markets/town-wave-10-v1.json", rewardMarket.market as JsonObject);
    }

    const progression = rawCapture("progression", "progression/nacli-medium-slow-level-17-v1", gaps);
    if (progression != null) {
      generated.set("progression/nacli-medium-slow-level-17-v1.json", progression);
    }

    const biome = rawCapture(
      "biome",
      "biomes/town-crossroads-route-v1",
      gaps,
    );
    if (biome != null) {
      generated.set("biomes/town-crossroads-route-v1.json", biome);
    }

    const encounter = rawCapture(
      "encounter",
      "encounters/plains-wave-11-captured-v1",
      gaps,
    );
    if (encounter != null) {
      generated.set("encounters/plains-wave-11-captured-v1.json", encounter);
    }

    const migration = rawCapture("migration", "migration/m3-to-m4-companions-v1", gaps);
    if (migration != null) {
      generated.set("migration/m3-to-m4-companions-v1.json", migration);
    }

    const battlePack = generated.get("battle-content-pack-v1.json");
    const battleHash = String(battlePack?.hash ?? "");
    const runPack = generated.get("run-content-pack-v1.json");
    const runHash = String(runPack?.run_content_hash ?? "");
    let sharedProvenance: JsonObject | null = null;
    try {
      sharedProvenance = provenance(battleHash, runHash);
    } catch (error) {
      if (error instanceof OracleGap) {
        gaps.push(error);
      } else {
        throw error;
      }
    }

    const composed = rawCapture(
      "composed",
      "run-segments/classic-composed-wave-9-through-11-v1",
      gaps,
    );
    if (composed != null && sharedProvenance != null) {
      collectGap(
        () => generated.set(
          "run-segments/classic-composed-wave-9-through-11-v1.json",
          captureComposedSegment(composed, sharedProvenance as JsonObject),
        ),
        gaps,
      );
    }

    const prepared = new Map<string, JsonObject>();
    if (sharedProvenance != null) {
      for (const [path, value] of generated) {
        if (
          path === "rng-vectors-v1.json"
          || path === "run-content-pack-v1.json"
          || path === "battle-content-pack-v1.json"
          || path.startsWith("migration/")
          || path.startsWith("run-segments/")
        ) {
          prepared.set(path, value);
        } else {
          collectGap(
            () => prepared.set(path, envelopeFromCapture(path.replace(/\.json$/u, ""), value, sharedProvenance as JsonObject)),
            gaps,
          );
        }
      }
    }

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

    if (sharedProvenance == null) {
      throw new Error("M4_ORACLE_GAP:PROVENANCE_UNOBSERVABLE");
    }
    const root = outputRoot();
    mkdirSync(root, { recursive: true });
    for (const [path, value] of prepared) {
      writeCanonical(resolve(root, path), value);
    }
    expect(generated.size).toBeGreaterThan(0);
  }, 2_700_000);
});
