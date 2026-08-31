#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFileSync(resolve(root, path), "utf8");
const fail = message => {
  throw new Error(`M9-E engineering audit: ${message}`);
};

const productionRoots = [
  "rust/crates/er-kernel/src",
  "rust/crates/er-wasm/src",
  "rust/crates/er-web/src",
  "src/rust-browser/production",
  "src/rust-browser/routes",
];
const productionSource = productionRoots.flatMap(collectFiles).map(read).join("\n");
for (const forbidden of [
  "M9VerticalSliceKernelV1",
  "M9VerticalControlV1",
  "M9ProductionSliceSessionV1",
  "M9VerticalSessionV1",
  "scripted_enemy_policy_for_m9",
  "run_m9_production_slice",
  "rust/fixtures/m9/solo-entry",
]) {
  if (productionSource.includes(forbidden)) {
    fail(`production source still references ${forbidden}`);
  }
}

const host = read("rust/crates/er-web/src/host.rs");
for (const required of ["BrowserKernelHostV1", "GameKernelV6", "PreparedGameContentV1", "GameContentBundleV1"]) {
  if (!host.includes(required)) {
    fail(`generic browser host is missing ${required}`);
  }
}
const worker = read("src/rust-browser/worker/rust-kernel-worker.ts");
if (!worker.includes("BrowserKernelHostV1.create")) {
  fail("browser Worker does not instantiate the generic Rust host");
}

const renderer = read("rust/crates/er-renderer/src/lib.rs");
for (const forbidden of ["KernelInput", "BattlePresentationEventId", "PresentationSettlementOutcome"]) {
  if (renderer.includes(forbidden)) {
    fail(`renderer remains coupled to ${forbidden}`);
  }
}
const adapter = read("rust/crates/er-web/src/renderer_settlement.rs");
if ((adapter.match(/KernelInput::BattlePresentationOutcome/gu) ?? []).length !== 2) {
  fail("renderer settlement translation is not confined to the adapter and its focused test");
}

const v7 = JSON.parse(read("rust/fixtures/m9/m9-engineering-v7-contract.json"));
if (
  v7.schema_version !== 1
  || v7.decision !== "CLEAN_V7_CUTOVER"
  || v7.kernel_schema_version !== 7
  || v7.snapshot_schema_version !== 7
  || v7.content_bundle_schema_version !== 2
  || v7.browser_initialization_schema_version !== 2
  || v7.production_owner !== "GameKernelV7"
  || v7.cutover_rules?.v6_production_fallback !== false
) {
  fail("V7 engineering contract is absent or ambiguous");
}

const coverage = JSON.parse(read("rust/fixtures/m9/m9-browser-control-coverage.json"));
const expectedControls = [
  "TITLE",
  "MODE_SELECT",
  "STARTER_SELECT",
  "BATTLE_COMMAND",
  "BATTLE_MOVE",
  "BATTLE_TARGET",
  "BATTLE_SWITCH",
  "BATTLE_REPLACEMENT",
  "CAPTURE",
  "FULL_PARTY",
  "PROGRESSION",
  "MOVE_LEARN",
  "EVOLUTION",
  "FUSION",
  "REWARD",
  "MARKET",
  "SCENARIO",
  "QUEST",
  "FACTION",
  "BIOME",
  "ROUTE",
  "SAVE",
  "WAITING",
  "COMPLETE",
];
if (
  coverage.schema_version !== 1
  || coverage.control_schema_version !== 2
  || JSON.stringify(coverage.controls.map(control => control.kind)) !== JSON.stringify(expectedControls)
  || coverage.controls.some(control => typeof control.producer !== "string" || control.producer.length === 0)
  || Object.values(coverage.invariants).some(value => value !== true)
) {
  fail("browser control coverage is incomplete or out of order");
}

console.log(
  `M9-E static ownership: V7 cutover frozen, generic BrowserKernelHostV1, ${expectedControls.length} controls, renderer settlement adapter isolated`,
);

function collectFiles(relative) {
  const absolute = resolve(root, relative);
  const entries = statSync(absolute).isDirectory() ? readdirSync(absolute, { withFileTypes: true }) : [];
  if (entries.length === 0) {
    return [relative];
  }
  return entries.flatMap(entry => {
    const child = `${relative}/${entry.name}`;
    return entry.isDirectory() ? collectFiles(child) : /\.(rs|ts)$/u.test(entry.name) ? [child] : [];
  });
}
