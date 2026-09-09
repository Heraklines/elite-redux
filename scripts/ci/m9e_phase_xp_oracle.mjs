import fs from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const pins = {
  "src/phases/exp-phase.ts": "e51cceaae1dd3d5ecc635a170908c42bde678f49e71a7f78f1c633d347196b1c",
  "src/phases/show-party-exp-bar-phase.ts": "03e9e81b2caa3e219709f4a7b27932caa6e573b46a5c75d10647999e09ddb11c",
  "src/modifier/modifier.ts": "ce600a1acbe931402679f95832919f8d4ec05ad9e4ff2bce5a9e68b1aaa21b4f",
};
const sources = {};
for (const [path, expected] of Object.entries(pins)) {
  const raw = fs.readFileSync(path);
  if (hash(raw) !== expected) throw new Error("Whole pinned source differs: " + path);
  sources[path] = raw.toString("utf8");
}
if (process.version !== "v24.9.0") throw new Error("Pinned Node required");
const modifier = sources["src/modifier/modifier.ts"];
const begin = modifier.indexOf("export class ExpBoosterModifier extends PersistentModifier {");
const end = modifier.indexOf("export class ", begin + 20);
if (begin < 0 || end <= begin) throw new Error("Unique actual modifier boundary");
const modifierClass = modifier.slice(begin, end).trimEnd();
let active;
class NumberHolder { constructor(value) { this.value = value; } }
class PersistentModifier {
  constructor(type, stackCount) { this.type = type; this.stackCount = stackCount; }
  getStackCount() { return this.stackCount; }
}
class PlayerPartyMemberPokemonPhase {
  constructor(index) { this.partyMemberIndex = index; }
  getPokemon() { return active.pokemon; }
  start() { active.events.push("start"); }
  end() { active.events.push("end"); }
}
const scope = {
  NumberHolder, PersistentModifier, PlayerPartyMemberPokemonPhase,
  getPokemonNameWithAffix: () => "controlled source boundary",
  getExperienceGainMultiplier: () => { active.events.push("ability"); return active.factors[0]; },
  getMoodyExperienceMultiplier: () => { active.events.push("moody"); return active.factors[1]; },
  notifyMoodyCoordinatorExperience: () => { active.events.push("coordinator"); return active.factors[2]; },
  notifyMoodyCoordinatorExperienceApplied: (pokemon, gap) => {
    if (pokemon !== active.pokemon || gap !== 8) throw new Error("Actual previous level gap");
    active.events.push("applied");
  },
  recordCoopWaveProgressionPresentation: value => {
    const p = active.pokemon;
    if (value.k !== "exp" || value.partySlot !== 2 || value.pokemonId !== p.id ||
        value.display !== (active.field ? "field" : "party") || value.expGain !== active.amount ||
        value.fromLevel !== 12 || value.toLevel !== p.level || value.fromExp !== 100 || value.toExp !== p.exp) {
      throw new Error("Actual phase presentation arguments");
    }
    active.events.push("presentation");
  },
  i18next: { t: () => "source UI callback" },
  ExpNotification: { SKIP: 2, ONLY_LEVEL_UP: 1 }, ExpGainsSpeed: { SKIP: 3 },
  setTimeout: () => { throw new Error("Excluded presentation dwell"); },
};
function compile(source, name) {
  // Remove only import declarations; retain the entire executable class body.
  const text = source.replace(/^import\s+[\s\S]*?;\n/gm, "").replace("export class " + name, "class " + name);
  const js = stripTypeScriptTypes(text);
  return vm.runInNewContext(js + "\n" + name, scope, { timeout: 1000 });
}
const ExpBoosterModifier = compile(modifierClass, "ExpBoosterModifier");
scope.ExpBoosterModifier = ExpBoosterModifier;
scope.globalScene = {
  gameMode: { isCoop: true }, moveAnimations: false, expParty: 2, expGainsSpeed: 3,
  getPlayerParty: () => [active.pokemon, { level: 20 }],
  applyModifiers: (Type, player, holder) => {
    if (Type !== ExpBoosterModifier || player !== true || !(holder instanceof NumberHolder)) throw new Error("Source global modifier boundary");
    active.events.push("boosters");
    for (const [percent, stacks] of active.boosters) {
      const booster = new Type({}, percent, stacks);
      if (stacks > booster.getMaxStackCount()) throw new Error("Actual source stack limit");
      if (booster.apply(holder) !== true) throw new Error("Actual source modifier application");
    }
  },
  ui: { showText: (_message, delay, callback) => {
    if (delay !== 0) throw new Error("Controlled pacing input");
    active.events.push("text"); callback();
  } },
  phaseManager: { unshiftNew: (kind, ...args) => {
    if (kind === "LevelUpPhase") {
      if (JSON.stringify(args) !== "[2,12,13]") throw new Error("Source level-up arguments");
    } else if (kind !== "HidePartyExpBarPhase" || args.length) throw new Error("Unexpected phase insertion");
    active.events.push(kind);
  } },
};
const Field = compile(sources["src/phases/exp-phase.ts"], "ExpPhase");
const Party = compile(sources["src/phases/show-party-exp-bar-phase.ts"], "ShowPartyExpBarPhase");
const boosts = [[], [[20, 1]], [[20, 1], [60, 2]], [[60, 2], [20, 1]], [[10, 99], [100, 10]], [[60, 0]]];
const profiles = [[1, 1, 1], [1.5, 0.75, 1.25], [0.1, 2, 3], [0, 4, 9]];
const rows = [];
for (const raw of [0, 0.9, 1, 7.5, 101.5, 4294967295, 1000000000000]) for (const boosters of boosts) for (const factors of profiles) for (const field of [false, true]) {
  active = { boosters, factors, field, events: [], amount: null };
  active.pokemon = {
    id: 456, level: 12, exp: 100,
    // Controlled addExp API boundary; this oracle qualifies its argument and
    // surrounding phase calls, not Pokemon.addExp or actual level thresholds.
    addExp(amount) {
      if (active.amount !== null || !Number.isSafeInteger(amount) || amount < 0) throw new Error("Actual addExp argument");
      active.events.push("add"); active.amount = amount;
      this.exp += amount;
      if (amount >= 10) this.level = 13;
    },
    updateInfo: () => { active.events.push("update"); return Promise.resolve(); },
  };
  new (field ? Field : Party)(2, raw).start();
  await Promise.resolve();
  const expected = field ? ["start", "coordinator", "boosters", "ability", "moody", "text", "add", "applied", "presentation"] : ["start", "boosters", "ability", "add", "presentation"];
  if (active.pokemon.level > 12) expected.push("LevelUpPhase");
  if (!field) expected.push("HidePartyExpBarPhase");
  expected.push("update", "end");
  if (JSON.stringify(active.events) !== JSON.stringify(expected)) throw new Error("Actual phase callback order: " + active.events);
  rows.push([raw, +field, ...factors, boosters.length ? boosters.map(pair => pair.join(":" )).join(",") : "-", active.amount].join("\t"));
}
const output = Buffer.from(rows.join("\n") + "\n");
if (rows.length !== 336 || output.length > 65536) throw new Error("Bounded whole phase matrix");
fs.writeFileSync(process.argv[2], output, { flag: "wx" });
console.log(JSON.stringify({ source_hashes: pins, runtime: process.version, cases: rows.length,
  modifier_class_bytes: Buffer.byteLength(modifierClass), modifier_class_sha256: hash(modifierClass),
  output_bytes: output.length, output_sha256: hash(output), phase_call_order_checked: true,
  scope: "whole actual field/bench phase classes and ExpBoosterModifier; controlled consumers/addExp/presentation boundaries, no pending ownership settlement" }));
