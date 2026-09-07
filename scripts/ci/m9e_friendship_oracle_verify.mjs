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
  keys(row, ["mode_id", "classic", "fun", "fun_source_type", "fun_debug", "moody", "timed_events_disabled_by_harness",
    "active_event", "classic_multiplier", "fusions_boosted", "reward_rates", "cap_registry", "sources", "held_boosters"], "context");
  integer(row.mode_id, 0, 100, "mode ID");
  same(row.fun_source_type, "undefined", "actual optional Classic flag");
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
// Literal-only projection of the 203 gated definitions in pinned source
// 399d src/data/elite-redux/er-shiny-lab-effects.ts (whole SHA256 pinned by producer).
// Category-local indices are intentional: preserve every decoded alias.
const COSMETIC_CATALOG = [{"id":"aurum","index":1,"category":"palette","achievement":"FRESH_START"},{"id":"obsidian","index":2,"category":"palette","achievement":"MONO_DARK"},{"id":"amethyst","index":4,"category":"palette","achievement":"MONO_PSYCHIC"},{"id":"inferno","index":5,"category":"palette","achievement":"MONO_FIRE"},{"id":"toxic","index":6,"category":"palette","achievement":"MONO_POISON"},{"id":"verdigris","index":8,"category":"palette","achievement":"MONO_STEEL"},{"id":"spectral","index":9,"category":"palette","achievement":"MONO_GHOST"},{"id":"void","index":11,"category":"palette","achievement":"PERMADEATH"},{"id":"shadowflame","index":12,"category":"palette","achievement":"DEVILS_BARGAIN"},{"id":"synthwave","index":20,"category":"palette","achievement":"MONO_ELECTRIC"},{"id":"onyxgold","index":21,"category":"palette","achievement":"_10K_MONEY"},{"id":"acid","index":23,"category":"palette","achievement":"MONO_BUG"},{"id":"bubblegum","index":24,"category":"palette","achievement":"MONO_FAIRY"},{"id":"blood","index":25,"category":"palette","achievement":"BACK_IN_BLOOD"},{"id":"antique","index":27,"category":"palette","achievement":"RELIC_HUNTER"},{"id":"camo","index":29,"category":"palette","achievement":"DAVID_AND_GOLIATH"},{"id":"rosegold","index":31,"category":"palette","achievement":"HIGH_ROLLER"},{"id":"mono","index":32,"category":"palette","achievement":"MASTER_OF_ALL"},{"id":"prismarine","index":33,"category":"palette","achievement":"MONO_WATER"},{"id":"nebula","index":34,"category":"palette","achievement":"CATCH_LEGENDARY"},{"id":"venom","index":35,"category":"palette","achievement":"SNAKES_ON_A_PLANE"},{"id":"solarflare","index":36,"category":"palette","achievement":"GIGANTAMAX"},{"id":"royal","index":37,"category":"palette","achievement":"CLASSIC_VICTORY"},{"id":"deepsea","index":38,"category":"palette","achievement":"CATCH_SUB_LEGENDARY"},{"id":"sakura","index":39,"category":"palette","achievement":"MAX_FRIENDSHIP"},{"id":"mythril","index":40,"category":"palette","achievement":"MEGA_EVOLVE"},{"id":"cursed","index":41,"category":"palette","achievement":"PRIMAL_CASCOON"},{"id":"moonstone","index":44,"category":"palette","achievement":"LEGENDARY_DUELIST"},{"id":"duoblood","index":50,"category":"palette","achievement":"MONO_FIGHTING"},{"id":"duomint","index":51,"category":"palette","achievement":"MONO_GRASS"},{"id":"duosunset","index":52,"category":"palette","achievement":"DYNAMIC_DUO"},{"id":"pentacandy","index":57,"category":"palette","achievement":"FULL_ON_MEGA_POWER"},{"id":"pentajewel","index":58,"category":"palette","achievement":"ALL_SHINY_TIERS"},{"id":"gameboy","index":61,"category":"palette","achievement":"MONO_GEN_ONE_VICTORY"},{"id":"retro","index":62,"category":"palette","achievement":"MONO_GEN_TWO_VICTORY"},{"id":"blueprint","index":63,"category":"palette","achievement":"RANKED_AND_FILED"},{"id":"whosthat","index":64,"category":"palette","achievement":"FINAL_ANSWER"},{"id":"lavender","index":65,"category":"palette","achievement":"EVICTION_NOTICE"},{"id":"popart","index":68,"category":"palette","achievement":"STRANGER_THAN_FICTION"},{"id":"platinum","index":69,"category":"palette","achievement":"CHAMPION_MATERIAL"},{"id":"brass","index":70,"category":"palette","achievement":"HOUSE_MONEY"},{"id":"agedbronze","index":71,"category":"palette","achievement":"RAGS_TO_RICHES"},{"id":"ivory","index":72,"category":"palette","achievement":"PURE_VANILLA"},{"id":"emberash","index":73,"category":"palette","achievement":"ONE_HP_AND_A_DREAM"},{"id":"honeyamber","index":78,"category":"palette","achievement":"NUMBER_GO_UP"},{"id":"stormcloud","index":79,"category":"palette","achievement":"CHARGE_IT_TO_THE_GAME"},{"id":"cyberpunk","index":82,"category":"palette","achievement":"MONO_GEN_REDUX_VICTORY"},{"id":"matrixgreen","index":83,"category":"palette","achievement":"THE_LONGEST_TURN"},{"id":"opal","index":84,"category":"palette","achievement":"PRODIGAL_MON"},{"id":"lagoon","index":86,"category":"palette","achievement":"BIOME_TOURIST"},{"id":"eclipse","index":88,"category":"palette","achievement":"HELL_HOUSE"},{"id":"midnightoil","index":89,"category":"palette","achievement":"BLACK_FRIDAY"},{"id":"terracotta","index":90,"category":"palette","achievement":"ARE_YOU_NOT_ENTERTAINED"},{"id":"voidfire","index":94,"category":"palette","achievement":"ZERO_SUM_HERO"},{"id":"duststorm","index":96,"category":"palette","achievement":"DELVE_TOO_DEEP"},{"id":"arcticnight","index":104,"category":"palette","achievement":"HELL_AND_BACK"},{"id":"blackice","index":105,"category":"palette","achievement":"GIUDECCA"},{"id":"meadow","index":106,"category":"palette","achievement":"BIOME_TOURIST"},{"id":"complement","index":107,"category":"palette","achievement":"HOUSE_OF_MIRRORS"},{"id":"hueplus","index":108,"category":"palette","achievement":"FORM_VOLTRON"},{"id":"xenoswap","index":110,"category":"palette","achievement":"PRODIGAL_MON"},{"id":"splitroyal","index":112,"category":"palette","achievement":"MASTER_PLAN"},{"id":"noir","index":114,"category":"palette","achievement":"META_BREAKER"},{"id":"infraredfilm","index":115,"category":"palette","achievement":"OPPOSITION_RESEARCH"},{"id":"glassbody","index":119,"category":"palette","achievement":"TWO_LEGENDS_ONE_SLOT"},{"id":"phantom","index":120,"category":"palette","achievement":"IDENTITY_THEFT"},{"id":"heatmap","index":121,"category":"palette","achievement":"SETUP_PAYOFF"},{"id":"hueglide","index":122,"category":"palette","achievement":"FIVE_ALARM_STREAK"},{"id":"duoice","index":124,"category":"palette","achievement":"GREAT_EXPECTATIONS"},{"id":"duoviolet","index":126,"category":"palette","achievement":"HELL_IS_OTHER_PEOPLE"},{"id":"duogold","index":127,"category":"palette","achievement":"NO_I_IN_TEAM"},{"id":"bumblebee","index":128,"category":"palette","achievement":"ULTRA_INSTINCT"},{"id":"duosakura","index":129,"category":"palette","achievement":"LEFT_RIGHT_GOODNIGHT"},{"id":"trinebula","index":130,"category":"palette","achievement":"PARALLEL_PLAY"},{"id":"triocean","index":131,"category":"palette","achievement":"NATURAL_SELECTION_BIAS"},{"id":"triember","index":132,"category":"palette","achievement":"THREE_PIECE_COMBO"},{"id":"quadautumn","index":134,"category":"palette","achievement":"TRINITY_TEST"},{"id":"pentagalaxy","index":137,"category":"palette","achievement":"CHAMPION_MATERIAL"},{"id":"holofoil","index":2,"category":"surface","achievement":"SEE_SHINY"},{"id":"prismatic","index":3,"category":"surface","achievement":"ALL_SHINY_TIERS"},{"id":"frostbite","index":4,"category":"surface","achievement":"MONO_ICE"},{"id":"galaxy","index":7,"category":"surface","achievement":"CATCH_LEGENDARY"},{"id":"molten","index":9,"category":"surface","achievement":"MONO_FIRE"},{"id":"electric","index":10,"category":"surface","achievement":"MONO_ELECTRIC"},{"id":"dissolve","index":11,"category":"surface","achievement":"SPLICE"},{"id":"lavacracks","index":13,"category":"surface","achievement":"TRIAD_OF_HELL"},{"id":"crystalfacets","index":15,"category":"surface","achievement":"TERASTALLIZE"},{"id":"stainedglass","index":16,"category":"surface","achievement":"TERASTALLIZE"},{"id":"marble","index":17,"category":"surface","achievement":"FLAWLESS_DUEL"},{"id":"bioluminescent","index":18,"category":"surface","achievement":"MONO_BUG"},{"id":"constellation","index":19,"category":"surface","achievement":"STELLAR_TERASTALLIZE"},{"id":"aurorawings","index":20,"category":"surface","achievement":"MONO_FLYING"},{"id":"gildededges","index":21,"category":"surface","achievement":"_1M_MONEY"},{"id":"vaporwave","index":23,"category":"surface","achievement":"FASHIONISTA"},{"id":"sparkle","index":25,"category":"surface","achievement":"ALL_IN"},{"id":"lightningveins","index":26,"category":"surface","achievement":"SORRY_FOR_THE_WAIT"},{"id":"dripgold","index":27,"category":"surface","achievement":"_10M_MONEY"},{"id":"spectrumsplit","index":28,"category":"surface","achievement":"MASTER_OF_ALL"},{"id":"circuit","index":30,"category":"surface","achievement":"AUTO_COUNTER"},{"id":"scansweep","index":33,"category":"surface","achievement":"BEAM_SPAM"},{"id":"poison","index":34,"category":"surface","achievement":"MONO_POISON"},{"id":"wormhole","index":37,"category":"surface","achievement":"BREEDERS_IN_SPACE"},{"id":"shatter","index":38,"category":"surface","achievement":"SHIELD_BREAK"},{"id":"heatshimmer","index":39,"category":"surface","achievement":"CENTURY_OF_TROUBLE"},{"id":"caustics","index":40,"category":"surface","achievement":"MONO_WATER"},{"id":"pixelpulse","index":42,"category":"surface","achievement":"CCC_COMBO"},{"id":"neonwire","index":43,"category":"surface","achievement":"ONE_TURN_CLEAR"},{"id":"starmap","index":44,"category":"surface","achievement":"SHARED_TRIUMPH"},{"id":"synthscan","index":45,"category":"surface","achievement":"WEAVE_NATION_CERTIFIED"},{"id":"neonsign","index":50,"category":"surface","achievement":"NAME_RECOGNITION"},{"id":"bloom","index":53,"category":"surface","achievement":"LIFELINE_SUBSCRIPTION"},{"id":"softshade","index":54,"category":"surface","achievement":"PURE_VANILLA"},{"id":"glasswarp","index":55,"category":"surface","achievement":"TWO_LEGENDS_ONE_SLOT"},{"id":"unlined","index":56,"category":"surface","achievement":"META_BREAKER"},{"id":"sundered","index":57,"category":"surface","achievement":"FUSION_DANCE"},{"id":"livingshadow","index":58,"category":"surface","achievement":"IDENTITY_THEFT"},{"id":"firecreep","index":60,"category":"surface","achievement":"ZERO_TO_HERO"},{"id":"discoball","index":62,"category":"surface","achievement":"GOLDEN_TICKET"},{"id":"lensflare","index":63,"category":"surface","achievement":"CHECKMATE_IN_ONE"},{"id":"oldfilm","index":64,"category":"surface","achievement":"STRANGER_THAN_FICTION"},{"id":"vhs","index":65,"category":"surface","achievement":"GENERATION_GAP"},{"id":"moire","index":67,"category":"surface","achievement":"HOUSE_OF_MIRRORS"},{"id":"contours","index":68,"category":"surface","achievement":"PARALLEL_PLAY"},{"id":"coderain","index":69,"category":"surface","achievement":"THE_LONGEST_TURN"},{"id":"carbonweave","index":71,"category":"surface","achievement":"NO_SELL"},{"id":"xray","index":75,"category":"surface","achievement":"DEAD_RINGER"},{"id":"blueprintscan","index":76,"category":"surface","achievement":"TECHNICAL_DIFFICULTIES"},{"id":"stitchwork","index":77,"category":"surface","achievement":"NO_I_IN_TEAM"},{"id":"mosaictile","index":78,"category":"surface","achievement":"MUSEUM_QUALITY"},{"id":"papercut","index":79,"category":"surface","achievement":"CAP_SPACE"},{"id":"goldleaf","index":81,"category":"surface","achievement":"HOUSE_MONEY"},{"id":"astral","index":92,"category":"surface","achievement":"TRIPLE_EXORCISM"},{"id":"smolder","index":93,"category":"surface","achievement":"ONE_HP_AND_A_DREAM"},{"id":"shockwave","index":95,"category":"surface","achievement":"FORMATION_BREAKER"},{"id":"runes","index":96,"category":"surface","achievement":"IMMORTAL_OBJECT"},{"id":"staticcharge","index":97,"category":"surface","achievement":"ULTRA_INSTINCT"},{"id":"cmykprint","index":98,"category":"surface","achievement":"FOUR_MACHINES_ONE_DREAM"},{"id":"crackleglaze","index":101,"category":"surface","achievement":"GLASS_CANNON"},{"id":"kintsugi","index":102,"category":"surface","achievement":"WE_BOTH_LIVED"},{"id":"datacorrupt","index":106,"category":"surface","achievement":"CROSS_VERSION_COMPATIBILITY"},{"id":"doubleexposure","index":107,"category":"surface","achievement":"PRODIGAL_MON"},{"id":"paperburn","index":108,"category":"surface","achievement":"SEVEN_DEADLY_CHECKBOXES"},{"id":"mossgrow","index":109,"category":"surface","achievement":"STATUS_QUO"},{"id":"gemplate","index":110,"category":"surface","achievement":"FORM_VOLTRON"},{"id":"tiedye","index":111,"category":"surface","achievement":"PRESET_JET_SET"},{"id":"checkerflip","index":112,"category":"surface","achievement":"DOUBLE_OR_NOTHING"},{"id":"polkadot","index":113,"category":"surface","achievement":"LAB_RAT"},{"id":"innerstorm","index":115,"category":"surface","achievement":"SETUP_PAYOFF"},{"id":"tvbars","index":118,"category":"surface","achievement":"DEAD_CHANNEL"},{"id":"revealscan","index":119,"category":"surface","achievement":"FINAL_ANSWER"},{"id":"spotlight","index":120,"category":"surface","achievement":"LAST_MON_STANDING"},{"id":"genone","index":122,"category":"surface","achievement":"MONOCHROME_REQUIEM"},{"id":"marchingants","index":123,"category":"surface","achievement":"WAR_OF_ATTRITION"},{"id":"flame","index":2,"category":"around","achievement":"FRESH_START"},{"id":"shadowfire","index":3,"category":"around","achievement":"ENDLESS_NIGHT"},{"id":"frost","index":4,"category":"around","achievement":"MONO_ICE"},{"id":"efield","index":5,"category":"around","achievement":"MONO_ELECTRIC"},{"id":"holyrays","index":9,"category":"around","achievement":"_10000_HEAL"},{"id":"cosmos","index":10,"category":"around","achievement":"EXORCIST"},{"id":"embers","index":13,"category":"around","achievement":"FIRST_BLOOD"},{"id":"wingflame","index":16,"category":"around","achievement":"SCORCHED_EARTH"},{"id":"crown","index":18,"category":"around","achievement":"CLASSIC_VICTORY"},{"id":"underlight","index":19,"category":"around","achievement":"LIMBO"},{"id":"uprising","index":20,"category":"around","achievement":"I_JUST_GOT_HERE"},{"id":"topbeam","index":21,"category":"around","achievement":"BEAM_SPAM"},{"id":"sideaura","index":22,"category":"around","achievement":"YO"},{"id":"magiccircle","index":23,"category":"around","achievement":"MONO_PSYCHIC"},{"id":"vortex","index":24,"category":"around","achievement":"GHOST_TRIAD"},{"id":"galaxyspiral","index":25,"category":"around","achievement":"CATCH_LEGENDARY"},{"id":"sparkstorm","index":29,"category":"around","achievement":"TEMPEST"},{"id":"prismburst","index":30,"category":"around","achievement":"STELLAR_TERASTALLIZE"},{"id":"icespikes","index":31,"category":"around","achievement":"ABSOLUTE_ZERO"},{"id":"rainbowglitter","index":32,"category":"around","achievement":"SHINY_PARTY"},{"id":"luminous","index":33,"category":"around","achievement":"CENTER_STAGE"},{"id":"cursedaura","index":34,"category":"around","achievement":"INFERNO"},{"id":"goldenglow","index":35,"category":"around","achievement":"FRESH_START"},{"id":"shadowaura","index":36,"category":"around","achievement":"EXORCIST"},{"id":"rainbowoutline","index":37,"category":"around","achievement":"ALL_SHINY_TIERS"},{"id":"hearts","index":40,"category":"around","achievement":"MAX_FRIENDSHIP"},{"id":"nuclearwinter","index":44,"category":"around","achievement":"COCYTUS"},{"id":"sinistersun","index":45,"category":"around","achievement":"SEVEN_DEADLY_CHECKBOXES"},{"id":"echoes","index":47,"category":"around","achievement":"PHANTOM_FORMATION"},{"id":"triecho","index":48,"category":"around","achievement":"COCYTUS"},{"id":"meteors","index":50,"category":"around","achievement":"HELL_AND_BACK"},{"id":"stormstrikes","index":51,"category":"around","achievement":"TRINITY_TEST"},{"id":"rainbowarc","index":52,"category":"around","achievement":"GOLDEN_TICKET"},{"id":"moonrise","index":57,"category":"around","achievement":"GROUNDHOG_WEEK"},{"id":"ribbonloop","index":61,"category":"around","achievement":"FIVE_ALARM_STREAK"},{"id":"lightcage","index":68,"category":"around","achievement":"HELL_IS_OTHER_PEOPLE"},{"id":"featherfall","index":70,"category":"around","achievement":"WE_BOTH_LIVED"},{"id":"eventhorizon","index":72,"category":"around","achievement":"ZERO_SUM_HERO"},{"id":"cardstorm","index":73,"category":"around","achievement":"DOUBLE_OR_NOTHING"},{"id":"coinrain","index":74,"category":"around","achievement":"HOUSE_MONEY"},{"id":"hellsigil","index":78,"category":"around","achievement":"HELL_HOUSE"},{"id":"creepingshadow","index":82,"category":"around","achievement":"APEX_PREDATOR"},{"id":"portal","index":86,"category":"around","achievement":"READ_THE_FINE_PRINT"},{"id":"speedlines","index":87,"category":"around","achievement":"CHECKMATE_IN_ONE"},{"id":"hexdome","index":89,"category":"around","achievement":"MASTER_PLAN"},{"id":"guardianwings","index":90,"category":"around","achievement":"WE_BOTH_LIVED"},{"id":"starcircle","index":93,"category":"around","achievement":"CHAMPION_MATERIAL"},{"id":"shockpulse","index":96,"category":"around","achievement":"FORMATION_BREAKER"},{"id":"fogbank","index":97,"category":"around","achievement":"TRIPLE_EXORCISM"},{"id":"cometorbit","index":98,"category":"around","achievement":"PARALLEL_PLAY"}];
const LEGACY_FACT = { bytes: 21428, sha256: "8182bb42b37ade8fd26bf9885b26c08d9a5c6b8ce028b6261fa369077d3e0e00" };
const EFFECT_IDS = [...IDS.slice(0, 10), "setup_splice", ...IDS.slice(10)];
const SEMANTIC_COUNTS = [0, 0, 0, 0, 2, 0, 1, 1, 1, 0, 2, 1, 1, 1, 1, 1];
const effectDefinition = ({ id, index, category }) => ({ id, index, category });
function validateEffects(data, legacy) {
  keys(data, ["schema_version", "oracle_sha", "legacy", "scope", "recipes", "cosmetic_states", "boundaries", "scopes", "semantic_calls"], "sidecar root");
  same(data.schema_version, 1, "sidecar schema"); same(data.oracle_sha, PIN, "sidecar source");
  same(data.legacy, LEGACY_FACT, "immutable legacy identity");
  same(data.scope, "synchronous action boundaries and actual call-through candy calls; no profile transaction claim", "sidecar scope");
  same(data.recipes, ["MAX_FRIENDSHIP", "SPLICE"].map(id => ({ id, recipe: { kind: "candyTeam", perMon: 10 },
    effects: COSMETIC_CATALOG.filter(def => def.achievement === id).map(effectDefinition) })), "actual recipe and full mapped effects");
  assert(Array.isArray(data.cosmetic_states) && data.cosmetic_states.length > 0 && data.cosmetic_states.length <= 8, "cosmetic state bound");
  same(new Set(data.cosmetic_states.map(row => JSON.stringify(row))).size, data.cosmetic_states.length, "deduplicated cosmetic states");
  for (const row of data.cosmetic_states) {
    keys(row, ["source_type", "bits", "available"], "cosmetic state");
    if (row.source_type === "undefined") same(row.bits, null, "raw absent cosmetic bits");
    else {
      same(row.source_type, "object", "raw array type");
      assert(Array.isArray(row.bits) && row.bits.length <= 64, "raw cosmetic bitset bound");
      row.bits.forEach(byte => integer(byte, 0, 255, "raw cosmetic byte"));
    }
    same(row.available, COSMETIC_CATALOG.filter(def => ((row.bits?.[Math.floor(def.index / 8)] ?? 0)
      & (1 << (def.index % 8))) !== 0).map(effectDefinition), "complete actual cosmetic decode including aliases");
  }
  assert(Array.isArray(data.boundaries) && data.boundaries.length > 0 && data.boundaries.length <= 32, "boundary bound");
  same(new Set(data.boundaries.map(row => JSON.stringify(row))).size, data.boundaries.length, "deduplicated boundaries");
  const boundary = index => { integer(index, 0, data.boundaries.length - 1, "boundary reference"); return data.boundaries[index]; };
  for (const row of data.boundaries) {
    keys(row, ["difficulty", "team", "unlocked", "reunlock", "reunlock_source_type", "cosmetics", "bar_shown", "bar_species_source_type"], "action boundary");
    same([row.difficulty, row.reunlock, row.reunlock_source_type, row.bar_species_source_type], ["ace", false, "boolean", "undefined"], "resolved reward and UI context");
    assert(Array.isArray(row.team) && row.team.length >= 1 && row.team.length <= 2, "actual team bound");
    same(row.team, Array.from({ length: row.team.length }, (_, object) => ({ object, species: legacy.setup.source_root,
      source_root: legacy.setup.source_root, candy_root: legacy.setup.candy_root })), "ordered distinct object identities and actual roots");
    assert(Array.isArray(row.unlocked) && row.unlocked.length === 2, "unlock vector"); row.unlocked.forEach(value => boolean(value, "prior actual unlock"));
    integer(row.cosmetics, 0, data.cosmetic_states.length - 1, "cosmetic state reference"); boolean(row.bar_shown, "actual bar state");
  }
  assert(Array.isArray(data.scopes), "scope array"); same(data.scopes.map(row => row.id), EFFECT_IDS, "all legacy scopes and actual SPLICE setup");
  assert(Array.isArray(data.semantic_calls) && data.semantic_calls.length === 12, "exact twelve actual semantic calls");
  let frontier = 0;
  const usedBoundaries = new Set();
  const usedCosmetics = new Set();
  for (const [ordinal, scope] of data.scopes.entries()) {
    keys(scope, ["id", "start", "before", "end", "after"], "scope");
    same(scope.start, frontier, "no omitted semantic calls"); frontier += SEMANTIC_COUNTS[ordinal]; same(scope.end, frontier, "exact source call count per action");
    const before = boundary(scope.before), after = boundary(scope.after);
    usedBoundaries.add(scope.before); usedBoundaries.add(scope.after);
    usedCosmetics.add(before.cosmetics); usedCosmetics.add(after.cosmetics);
    same(before.team.length, ordinal <= 10 ? 2 : 1, "party at action entry");
    same(after.team.length, ordinal < 10 ? 2 : 1, "party at action return");
    same(before.unlocked, [ordinal > 4, ordinal > 10], "prior unlock and repeated max distinction");
    same(after.unlocked, [ordinal >= 4, ordinal >= 10], "actual first unlock progression");
    const legacyRow = legacy.cases.find(row => row.id === scope.id);
    if (legacyRow) {
      same(before.unlocked[0], legacyRow.before.max_friendship_unlocked, "legacy before unlock conserved");
      same(after.unlocked[0], legacyRow.after.max_friendship_unlocked, "legacy after unlock conserved");
    }
    const oldBits = data.cosmetic_states[before.cosmetics].bits ?? [];
    const newBits = data.cosmetic_states[after.cosmetics].bits ?? [];
    const recipe = ordinal === 4 ? data.recipes[0] : ordinal === 10 ? data.recipes[1] : null;
    if (!recipe) same(after.cosmetics, before.cosmetics, "no unrelated cosmetic mutation");
    else {
      const expected = [...oldBits];
      for (const def of recipe.effects) {
        const byte = Math.floor(def.index / 8);
        while (expected.length <= byte) expected.push(0);
        expected[byte] |= 1 << (def.index % 8);
      }
      same(newBits, expected, "exact observed mapped cosmetic bit mutation");
    }
    for (let index = scope.start; index < scope.end; index++) {
      const call = data.semantic_calls[index];
      keys(call, ["index", "scope", "arity", "species", "count", "from_egg", "from_egg_source_type", "show_bar", "show_bar_source_type", "returned"], "semantic call");
      same([call.index, call.scope, call.species], [index, scope.id, legacy.setup.source_root], "correlated semantic identity");
      boolean(call.returned, "actual semantic return");
      const reward = ordinal === 4 || ordinal === 10;
      const direct = ordinal >= 12;
      const expectedCount = reward ? 15 : direct ? CANDY_INPUTS[ordinal - 12][1] : 1;
      same(f64(call.count, "actual semantic count"), expectedCount, "actual request witness, not fabricated output");
      same(call.arity, reward ? 3 : direct ? 4 : 2, "source request arity");
      same([call.from_egg, call.from_egg_source_type], reward ? [true, "boolean"]
        : direct ? [CANDY_INPUTS[ordinal - 12][2], "boolean"] : [null, "undefined"], "raw optional egg argument");
      same([call.show_bar, call.show_bar_source_type], direct ? [true, "boolean"] : [null, "undefined"], "raw optional UI argument");
      same(call.returned, ordinal !== 7, "saturated false return retained");
      if (direct) same(call.returned, legacyRow.returned, "direct legacy return conserved");
    }
  }
  same(frontier, 12, "complete semantic frontier");
  same(usedBoundaries.size, data.boundaries.length, "no orphan boundary"); same(usedCosmetics.size, data.cosmetic_states.length, "no orphan cosmetic state");
  return { semantic_calls: 12, legacy_cases: 15, setup_scopes: 1, cosmetic_catalog_rows: COSMETIC_CATALOG.length,
    exact_legacy_bytes_required: true, source_call_arity_checked: true, cosmetic_aliases_checked: true,
    scope: "actual source calls and observation conservation; no Rust parity or persistent profile transaction" };
}
function read(file, bound = 32768) {
  assert(path.isAbsolute(file) && realpathSync(file) === file, "absolute nonredirected data path");
  const st = lstatSync(file); assert(st.isFile() && !st.isSymbolicLink() && st.size > 0 && st.size <= bound, "data bound");
  const bytes = readFileSync(file); assert(bytes.length === st.size, "data changed during read");
  return { bytes, fact: { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, data: JSON.parse(bytes.toString("utf8")) };
}
assert(process.argv.length === 7, "exact verifier arguments");
const [onePath, twoPath, effectsOnePath, effectsTwoPath, output] = process.argv.slice(2);
same(new Set(process.argv.slice(2)).size, 5, "distinct owned output paths");
const one = read(onePath); const two = read(twoPath);
same(one.fact, LEGACY_FACT, "first frozen legacy bytes"); same(two.fact, LEGACY_FACT, "second frozen legacy bytes");
const effectsOne = read(effectsOnePath, 12288); const effectsTwo = read(effectsTwoPath, 12288);
assert(effectsOne.bytes.equals(effectsTwo.bytes), "two fresh effects sidecars differ");
const effectFacts = validateEffects(effectsOne.data, one.data);
same(validateEffects(effectsTwo.data, two.data), effectFacts, "second effects validation");
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
const effectNegatives = [
  ["changed_legacy_binding", data => { data.legacy.bytes--; }],
  ["omitted_setup_grant", data => { data.semantic_calls.splice(5, 1); }],
  ["wrong_semantic_scope", data => { data.semantic_calls[0].scope = "repeated_max"; }],
  ["lost_raw_egg_argument", data => { data.semantic_calls[0].from_egg = null; }],
  ["wrong_call_arity", data => { data.semantic_calls[0].arity = 4; }],
  ["lost_saturated_false", data => { data.semantic_calls.find(row => row.scope === "candy_saturated").returned = true; }],
  ["species_deduped_team", data => { data.boundaries[data.scopes[4].before].team.pop(); }],
  ["hidden_prior_unlock", data => { data.boundaries[data.scopes[4].before].unlocked[0] = true; }],
  ["enabled_reunlock", data => { data.boundaries[0].reunlock = true; }],
  ["changed_reward_recipe", data => { data.recipes[0].recipe.perMon = 0; }],
  ["missing_cosmetic_alias", data => { data.cosmetic_states[data.boundaries[data.scopes[4].after].cosmetics].available.pop(); }],
  ["changed_cosmetic_bit", data => { const state = data.cosmetic_states[data.boundaries[data.scopes[4].after].cosmetics]; state.bits[0] ^= 1; }],
];
for (const [name, mutate] of effectNegatives) {
  const changed = structuredClone(effectsOne.data); mutate(changed);
  assert.throws(() => validateEffects(changed, one.data), undefined, `required sidecar negative rejected: ${name}`);
}
const encoded = `${JSON.stringify({ schema_version: 2, status: "passed", exports: [one.fact, two.fact],
  sidecars: [effectsOne.fact, effectsTwo.fact], effects: effectFacts,
  rejected_effect_mutations: effectNegatives.map(([name]) => name),
  ...facts, rejected_mutations: negatives.map(([name]) => name) })}\n`;
assert(Buffer.byteLength(encoded) <= 8192 && path.isAbsolute(output), "validation output bound/path");
writeFileSync(output, encoded, { encoding: "utf8", flag: "wx" });
