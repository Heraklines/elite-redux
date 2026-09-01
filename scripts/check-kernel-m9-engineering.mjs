#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = path => readFileSync(resolve(root, path), "utf8");
const fail = message => {
  throw new Error(`M9-E engineering audit: ${message}`);
};

const productionEntries = [
  "rust/crates/er-game/src/m9e_content_v2.rs",
  "rust/crates/er-game/src/m9e_internal_event_v2.rs",
  "rust/crates/er-game/src/m9e_material_v6.rs",
  "rust/crates/er-game/src/m9e_new_run_v6.rs",
  "rust/crates/er-game/src/m9e_runtime_v6.rs",
  "rust/crates/er-kernel/src/game_kernel_v7.rs",
  "rust/crates/er-kernel/src/snapshot_v7.rs",
  "rust/crates/er-web/src/contracts_v2.rs",
  "rust/crates/er-web/src/host_v2.rs",
  "src/rust-browser/contracts/browser-contracts-v2.ts",
  "src/rust-browser/routes/browser-effects-v2.ts",
];
const productionSource = productionEntries.map(read).join("\n");
for (const forbidden of [
  "GameKernelV6",
  "GameRuntimeV5",
  "GameContentBundleV1",
  "PreparedGameContentV1",
  "BrowserKernelHostV1",
  "M9VerticalSliceKernelV1",
  "M9ProductionSliceSessionV1",
  "scripted_enemy_policy_for_m9",
  "rust/fixtures/m9/solo-entry",
]) {
  if (productionSource.includes(forbidden)) {
    fail(`production source still references ${forbidden}`);
  }
}

const host = read("rust/crates/er-web/src/host_v2.rs");
for (const required of ["BrowserKernelHostV2", "GameKernelV7", "PreparedGameContentV2", "GameContentBundleV2"]) {
  if (!host.includes(required)) {
    fail(`V2 browser host is missing ${required}`);
  }
}
const webRoot = read("rust/crates/er-web/src/lib.rs");
if (!webRoot.includes('#[cfg(feature = "legacy-browser-host")]') || !webRoot.includes("pub mod host_v2")) {
  fail("legacy browser host is not compatibility-gated behind the V2 entry");
}
const browserAdapter = read("src/rust-browser/routes/browser-effects-v2.ts");
for (const family of [
  "UI_CHANGED",
  "PRESENTATION",
  "PRESENTATION_SCENE_CHANGED",
  "SEND_NETWORK_FRAME",
  "STORAGE_REQUEST",
  "ASSET_REQUEST",
  "AUDIO_CUE",
  "TERMINAL",
  "TELEMETRY",
  "REPRO_READY",
]) {
  if (!browserAdapter.includes(`case "${family}"`)) {
    fail(`browser V2 adapter is missing ${family}`);
  }
}

const renderer = read("rust/crates/er-renderer/src/lib.rs");
for (const forbidden of ["KernelInput", "BattlePresentationEventId", "PresentationSettlementOutcome"]) {
  if (renderer.includes(forbidden)) {
    fail(`renderer remains coupled to ${forbidden}`);
  }
}

const v7 = JSON.parse(read("rust/fixtures/m9/m9-engineering-v7-contract.json"));
if (
  v7.schema_version !== 1
  || v7.decision !== "CLEAN_V7_CUTOVER"
  || v7.kernel_schema_version !== 7
  || v7.snapshot_schema_version !== 7
  || v7.game_state_schema_version !== 6
  || v7.material_schema_version !== 6
  || v7.save_schema_version !== 2
  || v7.content_bundle_schema_version !== 2
  || v7.progression_content_schema_version !== 2
  || v7.world_content_schema_version !== 2
  || v7.scenario_content_schema_version !== 2
  || v7.ai_content_schema_version !== 2
  || v7.browser_initialization_schema_version !== 2
  || v7.production_owner !== "GameKernelV7"
  || v7.cutover_rules?.v6_production_fallback !== false
  || v7.cutover_rules?.domain_v1_production_fallback !== false
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
  `M9-E static ownership: V7 cutover frozen, BrowserKernelHostV2, ${expectedControls.length} controls, 10 typed browser adapters`,
);
