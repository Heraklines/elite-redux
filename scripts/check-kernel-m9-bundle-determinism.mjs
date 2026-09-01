#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const binary = resolve(
  ROOT,
  process.argv[2] ?? "rust/target/debug/m9e-bundle.exe",
);
if (!existsSync(binary)) {
  throw new Error(`bundle compiler binary is missing: ${binary}`);
}
const fixture = relative => resolve(ROOT, "rust/fixtures", relative);
const inputs = [
  fixture("m9/engineering/battle-content-pack-v3.json"),
  fixture("m9/engineering/run-content-pack-v3.json"),
  fixture("m9/engineering/progression-content-pack-v2.json"),
  fixture("m9/engineering/world-content-pack-v2.json"),
  fixture("m9/engineering/scenario-content-pack-v2.json"),
  fixture("m9/engineering/ai-policy-pack-v2.json"),
  fixture("m9/engineering/bootstrap-content-pack-v1.json"),
  fixture("m9/engineering/presentation-content-pack-v1.json"),
  fixture("m7/run-behavior-unit-manifest-v1.json"),
  fixture("m7/m7-behavior-implementation-v2.json"),
];
const committedBundle = fixture("m9/engineering/game-content-bundle-v2.json");
const committedManifest = fixture("m9/engineering/game-content-bundle-v2-manifest.json");
const outputs = [
  [committedBundle + ".first.tmp", committedManifest + ".first.tmp"],
  [committedBundle + ".second.tmp", committedManifest + ".second.tmp"],
];
try {
  for (const output of outputs) {
    execFileSync(binary, [...inputs, ...output], { cwd: ROOT, stdio: "inherit" });
  }
  const firstBundle = readFileSync(outputs[0][0]);
  const secondBundle = readFileSync(outputs[1][0]);
  const firstManifest = readFileSync(outputs[0][1]);
  const secondManifest = readFileSync(outputs[1][1]);
  if (!firstBundle.equals(secondBundle) || !firstManifest.equals(secondManifest)) {
    throw new Error("fresh-process bundle outputs differ");
  }
  if (!firstBundle.equals(readFileSync(committedBundle))) {
    throw new Error("fresh-process bundle differs from the committed artifact");
  }
  if (!firstManifest.equals(readFileSync(committedManifest))) {
    throw new Error("fresh-process manifest differs from the committed artifact");
  }
  console.log("M9 bundle fresh-process determinism: 2/2 byte-identical");
} finally {
  for (const output of outputs.flat()) {
    rmSync(output, { force: true });
  }
}
