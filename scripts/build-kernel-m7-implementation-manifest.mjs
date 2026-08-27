#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CATALOG = resolve(ROOT, "rust/fixtures/m7/game-system-catalog-v1.json");
const OUTPUT = resolve(ROOT, "rust/fixtures/m7/m7-behavior-implementation-v1.json");
const WORLD_PROOF = {
  kind: "RUST_TEST",
  path: "rust/crates/er-testkit/tests/m7_system_proof.rs",
  test: "branching_routes_and_biome_structure_are_canonical_state",
};

const routing = "src/data/elite-redux/er-biome-routing.ts";
const structure = "src/data/elite-redux/er-biome-structure.ts";
const implemented = [
  [routing, 53, "erBiomeRoutingActive", "er_world::runtime::roll_next_biome_nodes"],
  [routing, 77, "erRecordBiomeEntry", "er_world::runtime::record_biome_entry"],
  [routing, 94, "loopbackExcluded", "er_world::runtime::loopback_exclusions"],
  [routing, 103, "restoreErRecentBiomes", "er_world::runtime::restore_routing_state"],
  [routing, 108, "getErPrevBiome", "er_state::m7_state::WorldStateV1::previous_biome"],
  [routing, 123, "setErPendingNodes", "er_world::runtime::set_pending_route_nodes"],
  [routing, 134, "erPendingNodesReady", "er_state::m7_state::WorldStateV1::pending_nodes_ready"],
  [routing, 139, "getErPendingNodes", "er_state::m7_state::WorldStateV1::pending_nodes"],
  [routing, 159, "revealAllErPendingNodes", "er_world::runtime::reveal_all_pending_nodes"],
  [routing, 178, "revealNextHiddenErPendingNode", "er_world::runtime::reveal_next_pending_node"],
  [routing, 179, "find[0]", "er_world::runtime::reveal_next_pending_node"],
  [routing, 200, "addErEventRevealedNode", "er_world::runtime::add_event_revealed_biome"],
  [routing, 210, "some[0]", "er_world::runtime::add_event_revealed_biome"],
  [routing, 216, "resetErRouting", "er_world::runtime::reset_routing_state"],
  [routing, 225, "getErRoutingState", "er_state::m7_state::WorldStateV1::previous_biome"],
  [routing, 230, "restoreErRouting", "er_world::runtime::restore_routing_state"],
  [routing, 235, "erMapUpgradeTier", "er_world::runtime::map_upgrade_tier"],
  [routing, 238, "reduce[0]", "er_world::runtime::map_upgrade_tier"],
  [routing, 242, "getErVisibleNodeCount", "er_world::runtime::visible_route_node_count"],
  [routing, 253, "baseLinks", "er_world::runtime::collect_base_links"],
  [routing, 256, "filter[0]", "er_world::runtime::collect_base_links"],
  [routing, 257, "map[0]", "er_world::runtime::collect_base_links"],
  [routing, 286, "rollErNextBiomeNodes", "er_world::runtime::roll_next_biome_nodes"],
  [routing, 329, "find[0]", "er_world::runtime::roll_next_biome_nodes"],
  [routing, 339, "map[0]", "er_world::runtime::roll_next_biome_nodes"],
  [routing, 347, "some[0]", "er_world::runtime::roll_next_biome_nodes"],
  [structure, 80, "resetErBiomeStructure", "er_world::runtime::restore_biome_structure"],
  [structure, 95, "lateGameThreshold", "er_world::runtime::in_late_game_zone"],
  [structure, 100, "erInLateGameZone", "er_world::runtime::in_late_game_zone"],
  [structure, 116, "erRollBiomeLength", "er_world::runtime::plan_biome_structure"],
  [structure, 127, "planErBiomeStructure", "er_world::runtime::plan_biome_structure"],
  [structure, 156, "roll", "er_world::runtime::plan_biome_structure"],
  [structure, 165, "restoreErBiomeStructure", "er_world::runtime::restore_biome_structure"],
  [structure, 182, "erMarkBiomeStay", "er_world::runtime::mark_biome_stay"],
  [structure, 192, "erBiomeOverstayAnchor", "er_state::m7_state::WorldStateV1::overstay_anchor_wave"],
  [structure, 203, "setErBiomeOverstayAnchor", "er_world::runtime::set_biome_overstay_anchor"],
  [structure, 217, "setErBiomeStructureExtent", "er_world::runtime::set_biome_structure_extent"],
  [structure, 225, "getErBiomeLength", "er_state::m7_state::WorldStateV1::biome_length"],
  [structure, 230, "getErBiomeStartWave", "er_state::m7_state::WorldStateV1::biome_start_wave"],
  [structure, 249, "erBiomeJustEnteredAfterWave", "er_world::runtime::biome_just_entered_after_wave"],
  [structure, 254, "wavesSinceEnteredBiome", "er_world::runtime::waves_in_current_biome"],
  [structure, 259, "setErLeaveBiomeNow", "er_world::runtime::mark_leave_biome"],
  [structure, 264, "getErLeaveBiomeNow", "er_state::m7_state::WorldStateV1::leave_biome_now"],
  [structure, 273, "erIsBiomeEnd", "er_world::runtime::biome_end_rule"],
  [structure, 292, "erShouldRaiseCrossroads", "er_world::runtime::should_raise_crossroads"],
];

function fail(message) {
  throw new Error(`M7 implementation manifest: ${message}`);
}

const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
const entries = implemented.map(([path, line, symbol, rustSymbol]) => {
  const matches = catalog.behaviors.filter(behavior =>
    behavior.source.path === path
    && behavior.source.line === line
    && behavior.symbol === symbol,
  );
  if (matches.length !== 1) {
    fail(`${path}:${line} ${symbol} matched ${matches.length} behavior units`);
  }
  const [behavior] = matches;
  if (behavior.implementation_status !== "REQUIRES_M7") {
    fail(`${path}:${line} ${symbol} is ${behavior.implementation_status}, not REQUIRES_M7`);
  }
  return {
    behavior_unit: behavior.id,
    status: "BESPOKE_IMPLEMENTED",
    source: behavior.source,
    rust_symbol: rustSymbol,
    proof: WORLD_PROOF,
  };
});
entries.sort((left, right) => left.behavior_unit.localeCompare(right.behavior_unit));
if (new Set(entries.map(entry => entry.behavior_unit)).size !== entries.length) {
  fail("one behavior unit received duplicate implementation evidence");
}
const document = {
  schema_version: 1,
  oracle_sha: catalog.oracle_sha,
  oracle_tree_sha: catalog.oracle_tree_sha,
  implementation_count: entries.length,
  implementations: entries,
};
writeFileSync(OUTPUT, `${JSON.stringify(document)}\n`);
console.log(`M7 implementation manifest: ${entries.length} exact behavior units`);
