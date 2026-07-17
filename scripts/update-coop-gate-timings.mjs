#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const outputIndex = args.indexOf("--output");
const inputPath = inputIndex < 0 ? null : resolve(args[inputIndex + 1] ?? "");
const outputPath = resolve(
  outputIndex < 0 ? fileURLToPath(new URL("./coop-gate-timings.json", import.meta.url)) : (args[outputIndex + 1] ?? ""),
);

if (inputPath == null) {
  throw new Error(
    "usage: node scripts/update-coop-gate-timings.mjs --input observations.json [--output manifest.json]",
  );
}

const manifest = JSON.parse(readFileSync(outputPath, "utf8"));
const input = JSON.parse(readFileSync(inputPath, "utf8"));
if (!Array.isArray(input.observations) || input.observations.length === 0) {
  throw new Error("timing input must contain a non-empty observations array");
}

const grouped = new Map();
for (const observation of input.observations) {
  const { lane, file, seconds } = observation;
  if (!manifest.lanes?.[lane] || typeof file !== "string" || !(seconds > 0) || !Number.isFinite(seconds)) {
    throw new Error(`invalid timing observation: ${JSON.stringify(observation)}`);
  }
  const key = `${lane}\0${file.replaceAll("\\", "/")}`;
  const values = grouped.get(key) ?? [];
  values.push(seconds);
  grouped.set(key, values);
}

for (const [key, samples] of grouped) {
  const [lane, file] = key.split("\0");
  const sorted = [...samples].sort((a, b) => a - b);
  const p90 = sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)];
  manifest.lanes[lane].files[file] = {
    p90Seconds: Number(p90.toFixed(3)),
    sampleCount: sorted.length,
    updatedFrom: input.source ?? "committed timing observations",
  };
}

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`updated ${grouped.size} timing entries in ${outputPath}\n`);
