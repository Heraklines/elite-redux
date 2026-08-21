/*
 * M4A test-only helper runner.
 *
 * The exporter launches this file in a fresh Vitest process for exactly one
 * capture kind. Keeping the helper import inside the selected branch prevents
 * Phaser/GameManager module state from crossing capture boundaries.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import Phaser from "phaser";
import { describe, it } from "vitest";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type AnyRecord = Record<string, unknown>;
type CaptureKind = "content" | "reward-market" | "progression" | "biome" | "encounter" | "migration" | "composed";
type CaptureModule = { [exportName: string]: unknown };

const CAPTURES: Readonly<Record<CaptureKind, { module: string; exportName: string }>> = {
  content: { module: "./export/run-content-capture", exportName: "captureRunContent" },
  "reward-market": { module: "./export/reward-market-capture", exportName: "captureRewardMarket" },
  progression: { module: "./export/progression-capture", exportName: "captureProgression" },
  biome: { module: "./export/biome-encounter-capture", exportName: "captureBiome" },
  encounter: { module: "./export/biome-encounter-capture", exportName: "captureEncounter" },
  migration: { module: "./export/migration-companion-capture", exportName: "captureMigrationCompanions" },
  composed: { module: "./export/composed-capture", exportName: "captureComposedSegment" },
};

function canonicalValue(value: unknown, path = "$"): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value as JsonValue;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`NONFINITE_ORACLE_VALUE:${path}`);
    }
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
    const output: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value as AnyRecord).sort()) {
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

function writeCanonical(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(canonicalValue(value))}\n`, "utf8");
}

function captureKind(): CaptureKind {
  const value = process.env.M4_CAPTURE_KIND;
  if (value == null || !(value in CAPTURES)) {
    throw new Error(`EXPORT_CONFIGURATION:M4_CAPTURE_KIND must be one of ${Object.keys(CAPTURES).join(",")}`);
  }
  return value as CaptureKind;
}

function captureOutput(): string {
  const value = process.env.M4_CAPTURE_OUTPUT;
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value)) {
    throw new Error("EXPORT_CONFIGURATION:M4_CAPTURE_OUTPUT must be an absolute file path");
  }
  return resolve(value);
}

function typedGap(error: unknown, kind: CaptureKind): JsonValue {
  const record = error != null && typeof error === "object" ? error as AnyRecord : undefined;
  const code = typeof record?.code === "string" ? record.code : "CAPTURE_PROCESS_FAILED";
  const sourceSeam = typeof record?.sourceSeam === "string"
    ? record.sourceSeam
    : typeof record?.source_seam === "string"
      ? record.source_seam
      : `test/kernel-fixtures/m4/export-helper-runner.test.ts:${kind}`;
  const message = error instanceof Error ? error.message : String(error);
  return {
    m4_capture_gap: {
      code,
      source_seam: sourceSeam,
      message,
    },
  };
}

async function runCapture(kind: CaptureKind, output: string): Promise<void> {
  if (Phaser.Math.RND == null) {
    (Phaser.Math as unknown as Record<string, unknown>).RND = new Phaser.Math.RandomDataGenerator();
  }
  // Module initialization and GameManager construction consume the ambient
  // Phaser stream before each scenario installs its run seed.
  Phaser.Math.RND.sow([`m4-oracle-helper:${kind}`]);
  try {
    const selected = CAPTURES[kind];
    // The selected kind is runtime configuration; static imports would load every Phaser/GameManager helper.
    const module = await import(selected.module) as CaptureModule;
    const capture = module[selected.exportName];
    if (typeof capture !== "function") {
      throw new Error(`EXPORT_CONFIGURATION:${selected.exportName} is not callable`);
    }
    const value = await (capture as () => Promise<unknown>)();
    writeCanonical(output, value);
  } catch (error) {
    writeCanonical(output, typedGap(error, kind));
  }
}

describe("M4A isolated helper capture", () => {
  it("captures exactly the selected helper into canonical raw output", async () => {
    const kind = captureKind();
    const output = captureOutput();
    await runCapture(kind, output);
  }, 2_700_000);
});
