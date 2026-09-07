/** Independent bounded observation/schema verifier; does not implement award arithmetic. */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const PIN = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";
const IDS = ["negative_loss", "zero", "rare_cap", "above_rare_cap", "max", "repeated_max",
  "threshold", "candy_saturated", "boosted_threshold", "boosted_capped", "shared_fusion_threshold",
  "direct_saturation", "direct_egg", "direct_zero", "direct_negative"];
const FRIENDSHIP_INPUTS = [[5, -5, false], [5, 0, false], [199, 6, true], [240, 6, true],
  [254, 3, false], [255, 3, false], [50, 3, false], [50, 3, false], [50, 3, false],
  [199, 3, true], [50, 3, false]];
const CANDY_INPUTS = [[9998, 2, false], [1, 2, true], [5, 0, false], [5, -2, false]];
const same = (a, b, label) => assert.deepStrictEqual(a, b, label);
function keys(value, names, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label}: object required`);
  same(Object.keys(value).sort(), [...names].sort(), `${label}: exact keys`);
}
function integer(value, min, max, label) {
  assert(Number.isSafeInteger(value) && value >= min && value <= max, `${label}: bounded integer`);
}
function finite(value, min, max, label) {
  assert(typeof value === "number" && Number.isFinite(value) && value >= min && value <= max, `${label}: finite range`);
}
function boolean(value, label) { assert(typeof value === "boolean", `${label}: boolean`); }
function text(value, label) { assert(typeof value === "string" && value.length > 0 && value.length <= 128, `${label}: text`); }
function f64(row, label) {
  keys(row, ["value", "bits_be"], label);
  finite(row.value, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, label);
  assert(typeof row.bits_be === "string" && /^[0-9a-f]{16}$/.test(row.bits_be), `${label}: bits`);
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleBE(row.value);
  same(bytes.toString("hex"), row.bits_be, `${label}: exact binary64`);
  return row.value;
}
function sortedIds(ids, label) {
  assert(Array.isArray(ids) && ids.length <= 18, `${label}: bounded IDs`);
  ids.forEach(id => integer(id, 1, 1000000, label));
  same(ids, [...new Set(ids)].sort((a, b) => a - b), `${label}: sorted unique`);
}
function snapshot(row, label) {
  keys(row, ["friendship", "accounts", "ribbons", "max_friendship_unlocked"], label);
  finite(f64(row.friendship, label), 0, 255, label);
  assert(Array.isArray(row.accounts), `${label}: account array`);
  sortedIds(row.accounts.map(entry => entry.id), label);
  for (const entry of row.accounts) {
    keys(entry, ["id", "friendship", "candy"], label);
    if (entry.friendship !== null) finite(entry.friendship, 0, Number.MAX_SAFE_INTEGER, label);
    finite(entry.candy, -Number.MAX_SAFE_INTEGER, 9999, label);
  }
  assert(Array.isArray(row.ribbons) && row.ribbons.length >= 1 && row.ribbons.length <= 8, `${label}: ribbon lineage`);
  assert(new Set(row.ribbons.map(entry => entry.id)).size === row.ribbons.length, `${label}: distinct ribbons`);
  for (const entry of row.ribbons) {
    keys(entry, ["id", "friendship"], label);
    integer(entry.id, 1, 1000000, label);
    boolean(entry.friendship, label);
  }
  boolean(row.max_friendship_unlocked, label);
}
function rates(row) {
  keys(row, ["difficulty", "equivalentWave", "tier", "baseShiny", "baseCandy", "baseVoucher",
    "favourMultiplier", "endlessBonus", "totalCap", "totalShiny", "totalCandy", "totalVoucher"], "rates");
  assert(["youngster", "ace", "elite", "hell", "mystery"].includes(row.difficulty), "closed difficulty");
  for (const [key, value] of Object.entries(row)) if (key !== "difficulty") integer(value, 0, 1000000, `rate ${key}`);
  integer(row.tier, 1, 10, "tier");
  integer(row.equivalentWave, 1, 1000000, "equivalent wave");
}
function context(row, index, setup) {
  keys(row, ["mode_id", "classic", "fun", "fun_debug", "moody", "timed_events_disabled_by_harness",
    "active_event", "classic_multiplier", "fusions_boosted", "reward_rates", "cap_registry", "sources", "held_boosters"], "context");
  integer(row.mode_id, 0, 100, "mode ID");
  same([row.classic, row.fun, row.fun_debug, row.moody, row.timed_events_disabled_by_harness, row.active_event,
    row.fusions_boosted], [true, false, false, null, true, null, false], "explicit admitted harness context");
  finite(f64(row.classic_multiplier, "classic multiplier"), Number.MIN_VALUE, 10000, "positive Classic scope");
  rates(row.reward_rates);
  assert(Array.isArray(row.cap_registry) && row.cap_registry.length === 10, "exact cap registry cardinality");
  row.cap_registry.forEach((cap, i) => { integer(cap, 1, 10000, "cap"); if (i) assert(cap >= row.cap_registry[i - 1], "nondecreasing caps"); });
  assert(Array.isArray(row.sources) && row.sources.length === (index < 10 ? 1 : 2), "actual pre/post fusion sources");
  for (const source of row.sources) {
    keys(source, ["species", "source_root", "candy_root", "cost", "cap"], "source mapping");
    same([source.species, source.source_root, source.candy_root], [setup.source_root, setup.source_root, setup.candy_root], "same actual root source fixture");
    integer(source.cost, 1, 10, "supported fixture cost");
    same(source.cap, row.cap_registry[source.cost - 1], "source cap registry correspondence");
  }
  same(row.held_boosters, index < 8 ? [] : [{ type: "SOOTHE_BELL", stack: 1, belongs_to_probe: true }], "actual installed held stack");
}
function validate(data) {
  keys(data, ["schema_version", "oracle_sha", "requested_seed", "actual_scene_seed", "qualification", "setup", "cases"], "root");
  same(data.schema_version, 1, "schema"); same(data.oracle_sha, PIN, "source SHA");
  same(data.requested_seed, "m9-source-friendship-candy-v1", "requested seed"); text(data.actual_scene_seed, "actual source scene seed");
  same(data.qualification, "actual source methods on controlled GameManager objects; remote execution required", "scope");
  const setup = data.setup;
  keys(setup, ["source_root", "candy_root", "account_existed", "distinct_pokemon_before_fusion", "same_source_root_fusion",
    "friendship_booster_probe_reexecuted", "captured_boosted_holder", "side_effect_spies", "timestamps_exported"], "setup");
  integer(setup.source_root, 1, 1000000, "source root"); same(setup.candy_root, setup.source_root, "fixture root correspondence");
  boolean(setup.account_existed, "account initialization");
  same([setup.distinct_pokemon_before_fusion, setup.same_source_root_fusion, setup.friendship_booster_probe_reexecuted,
    setup.captured_boosted_holder, setup.side_effect_spies, setup.timestamps_exported],
    [true, true, false, false, "default call-through only", false], "honest method/setup scope");
  assert(Array.isArray(data.cases), "cases array"); same(data.cases.map(row => row.id), IDS, "complete ordered actual cases");
  for (const [index, row] of data.cases.entries()) {
    const label = IDS[index];
    keys(row, ["id", "request", "context", "before", "after", "account_inventory_count_before", "account_inventory_count_after",
      "changed_account_ids", "returned", "achievements", "candy_bar_calls", "candy_bar_shown_after"], label);
    context(row.context, index, setup); snapshot(row.before, label); snapshot(row.after, label);
    for (const key of ["account_inventory_count_before", "account_inventory_count_after"]) integer(row[key], 1, 100000, key);
    sortedIds(row.changed_account_ids, label); assert(row.changed_account_ids.length <= 16, "changed account cap");
    const before = new Map(row.before.accounts.map(entry => [entry.id, entry]));
    const after = new Map(row.after.accounts.map(entry => [entry.id, entry]));
    const changed = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b)
      .filter(id => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)));
    same(changed, row.changed_account_ids, "complete emitted changed-account correspondence");
    assert(before.has(setup.source_root) && after.has(setup.source_root), "real root account present");
    same([...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b),
      [...new Set([setup.source_root, setup.candy_root, ...changed])].sort((a, b) => a - b), "exact compact account projection");
    assert(row.before.accounts.length <= row.account_inventory_count_before && row.after.accounts.length <= row.account_inventory_count_after, "inventory cardinality");
    if (index < 11) {
      keys(row.request, ["kind", "amount", "capped"], label);
      const [friendship, amount, capped] = FRIENDSHIP_INPUTS[index];
      same(row.request.kind, "friendship", label); same(f64(row.request.amount, label), amount, label);
      same(row.request.capped, capped, label); same(row.before.friendship.value, friendship, label); same(row.returned, null, label);
      const expectedProgress = [6, 7, 8, 10].includes(index) ? row.context.sources[0].cap - 1 : 0;
      same(before.get(setup.source_root).friendship, expectedProgress, "controlled threshold input");
      same(before.get(setup.source_root).candy, index === 7 ? 9999 : 0, "controlled candy input");
    } else {
      keys(row.request, ["kind", "species", "count", "from_egg", "show_bar"], label);
      const [candy, count, egg] = CANDY_INPUTS[index - 11];
      same([row.request.kind, row.request.species, row.request.from_egg, row.request.show_bar],
        ["candy", setup.source_root, egg, true], label);
      same(f64(row.request.count, label), count, label); same(before.get(setup.source_root).candy, candy, label); boolean(row.returned, label);
    }
    assert(Array.isArray(row.achievements) && row.achievements.length <= 16, "achievement calls");
    for (const call of row.achievements) {
      keys(call, ["id", "is_max_friendship", "returned"], label);
      text(call.id, label); boolean(call.is_max_friendship, label); boolean(call.returned, label);
    }
    if (index === 4 || index === 5) assert(row.achievements.some(call => call.is_max_friendship), "actual max friendship intent required");
    assert(Array.isArray(row.candy_bar_calls) && row.candy_bar_calls.length <= 16, "candy-bar calls");
    for (const call of row.candy_bar_calls) {
      keys(call, ["root", "count"], label); integer(call.root, 1, 1000000, label); f64(call.count, label);
    }
    boolean(row.candy_bar_shown_after, label);
    if (index < 2) {
      same(row.achievements, [], "nonpositive early-return achievements"); same(row.candy_bar_calls, [], "nonpositive early-return candy");
      same(row.before.accounts, row.after.accounts, "nonpositive account conservation");
      same(row.before.ribbons, row.after.ribbons, "nonpositive ribbon conservation");
    }
  }
  return { case_ids: IDS, case_count: IDS.length, source_sha: PIN, scope: "source observation integrity only; no award formula or Rust parity",
    actual_booster_inventory_required: true, actual_same_root_fusion_required: true, modes: "Classic; Moody null; timed events disabled",
    binary64_checked: true, exact_inputs_checked: true, changed_account_projection_checked: true };
}
function read(file) {
  assert(path.isAbsolute(file) && realpathSync(file) === file, "absolute nonredirected data path");
  const st = lstatSync(file); assert(st.isFile() && !st.isSymbolicLink() && st.size > 0 && st.size <= 32768, "data bound");
  const bytes = readFileSync(file); assert(bytes.length === st.size, "data changed during read");
  return { bytes, fact: { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, data: JSON.parse(bytes.toString("utf8")) };
}
assert(process.argv.length === 5, "exact verifier arguments");
const [onePath, twoPath, output] = process.argv.slice(2);
assert(onePath !== twoPath && output !== onePath && output !== twoPath, "distinct owned output paths");
const one = read(onePath); const two = read(twoPath);
assert(one.bytes.equals(two.bytes), "two actual fresh exports differ");
const facts = validate(one.data); same(validate(two.data), facts, "independent second validation");
// Negative integrity witnesses mutate only in-memory copies of actual validated data.
// They neither generate a passing oracle nor repeat friendship/candy arithmetic.
const negatives = [
  ["wrong_source_pin", data => { data.oracle_sha = "0".repeat(40); }],
  ["missing_case", data => { data.cases.pop(); }],
  ["duplicate_case", data => { data.cases[1].id = data.cases[0].id; }],
  ["unadmitted_moody", data => { data.cases[0].context.moody = {}; }],
  ["unadmitted_event", data => { data.cases[0].context.active_event = {}; }],
  ["changed_request", data => { data.cases[0].request.amount.value = -4; }],
  ["invalid_float_bits", data => { data.cases[0].before.friendship.bits_be = "0".repeat(16); }],
  ["missing_actual_booster", data => { data.cases[8].context.held_boosters = []; }],
  ["missing_fusion_source", data => { data.cases[10].context.sources.pop(); }],
  ["changed_source_root", data => { data.cases[0].context.sources[0].source_root += 1; }],
  ["incomplete_account_delta", data => { data.cases[0].changed_account_ids = [data.setup.source_root]; }],
  ["invalid_direct_return", data => { data.cases[11].returned = null; }],
  ["lost_max_intent", data => { data.cases[4].achievements = []; }],
  ["false_threshold_input", data => { data.cases[6].before.accounts.find(entry => entry.id === data.setup.source_root).friendship = 0; }],
];
for (const [name, mutate] of negatives) {
  const changed = structuredClone(one.data);
  mutate(changed);
  assert.throws(() => validate(changed), undefined, `required negative rejected: ${name}`);
}
const encoded = `${JSON.stringify({ schema_version: 1, status: "passed", exports: [one.fact, two.fact],
  ...facts, rejected_mutations: negatives.map(([name]) => name) })}\n`;
assert(Buffer.byteLength(encoded) <= 32768 && path.isAbsolute(output), "validation output bound/path");
writeFileSync(output, encoded, { encoding: "utf8", flag: "wx" });
