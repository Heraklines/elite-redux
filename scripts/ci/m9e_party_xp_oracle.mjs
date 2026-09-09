import fs from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";
import { stripTypeScriptTypes, createRequire } from "node:module";

const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const pins = {
  "src/battle-scene.ts": "0e2c5eff0aa70c45c4ef92a4c279d93d35b6e1fc71719d481603e5d2242ae2af",
  "src/data/balance/starters.ts": "21bd9442711f1f7381f5e7e5c4a51dac43db0584272fd5b4767493f8a68e39ef",
  "src/modifier/modifier.ts": "ce600a1acbe931402679f95832919f8d4ec05ad9e4ff2bce5a9e68b1aaa21b4f",
  "pnpm-lock.yaml": "dcbcaf6df44509c71b28becffdd70b33a7410a0873f5b1297ede84150a6effff",
};
const sources = {};
for (const [path, expected] of Object.entries(pins)) {
  const bytes = fs.readFileSync(path);
  if (hash(bytes) !== expected) throw new Error("Pinned actual source differs: " + path);
  sources[path] = bytes.toString("utf8");
}
if (process.version !== "v24.9.0") throw new Error("Pinned Node required");
const text = sources["src/battle-scene.ts"];
const start = text.indexOf("  applyPartyExp(\n");
const end = text.indexOf("\n  /**\n   * Determine whether a wave should", start);
const original = text.slice(start, end);
if (start < 0 || end <= start || Buffer.byteLength(original) !== 4977 ||
    hash(original) !== "37f19d82a8772ad0edddd7724a70994b0a11aa03b8901bfd10a29ed334d6e96c") {
  throw new Error("Entire pinned source method required");
}
const friendshipMatches = [...sources["src/data/balance/starters.ts"].matchAll(/^export const FRIENDSHIP_GAIN_FROM_BATTLE = ([0-9]+);$/gm)];
if (friendshipMatches.length !== 1) throw new Error("Unique actual friendship constant");
const friendship = Number(friendshipMatches[0][1]);
const require = createRequire(import.meta.url);
const linearPath = require.resolve("phaser/src/math/Linear.js");
const linearBytes = fs.readFileSync(linearPath);
const phaserVersion = require("phaser/package.json").version;
if (phaserVersion !== "3.90.0") throw new Error("Exact locked Phaser dependency required");
const Linear = require(linearPath);
class ExpShareModifier { constructor(n) { this.n = n; } getStackCount() { return this.n; } }
class ExpBalanceModifier { constructor(n) { this.n = n; } getStackCount() { return this.n; } }
class MultipleParticipantExpBonusModifier { constructor(n) { this.n = n; } getStackCount() { return this.n; } }
class PokemonIncrementingStatModifier {}
class PokemonExpBoosterModifier {}
class NumberHolder { constructor(value) { this.value = value; } }
const Overrides = { XP_MULTIPLIER_OVERRIDE: null };
const scope = { ExpShareModifier, ExpBalanceModifier, MultipleParticipantExpBonusModifier,
  PokemonIncrementingStatModifier, PokemonExpBoosterModifier, NumberHolder, Overrides,
  Phaser: { Math: { Linear } }, FRIENDSHIP_GAIN_FROM_BATTLE: friendship,
  BattleType: { TRAINER: "TRAINER" }, MysteryEncounterMode: { TRAINER_BATTLE: "TRAINER_BATTLE" },
  isErSprintMode: mode => { if (mode !== "CLASSIC") throw new Error("Unadmitted mode"); return false; },
};
const executable = stripTypeScriptTypes(`class Oracle {\n${original}\n}`);
const Oracle = vm.runInNewContext(`(${executable})`, scope, { timeout: 1000 });
const patterns = [
  { count: 0, party: [[1, 10, 0], [1, 20, 2]] },
  { count: 1, party: [[1, 10, 5]] },
  { count: 4, party: [[1, 20, 5], [1, 10, 2], [0, 5, 1], [1, 30, 3]] },
  { count: 3, party: [[1, 50, 1], [0, 10, 1], [1, 25, 0], [1, 49, 7]] },
  { count: 2, party: [[0, 10, 1], [1, 50, 1], [1, 51, 0]] },
  { count: 1, party: [[1, 20, 5], [1, 10, 0], [1, 11, 2], [1, 49, 0]] },
];
const modifiers = [
  [null, null, null, null], [0, 0, 0, null], [1, 1, 1, null], [5, 4, 5, null],
  [null, 1, null, null], [5, 3, 2, 0], [0, 2, 5, 1.25], [null, 4, 0, 1.25],
];
const bits = value => { const b = Buffer.alloc(8); b.writeDoubleBE(value); return b.toString("hex"); };
const optional = value => value === null ? "-" : String(value);
const rows = [];
for (const pattern of patterns) for (const [variant, raw] of [7, 101.5, 4294967295].entries()) for (const mods of modifiers) {
  const trainer = variant !== 0;
  const defeated = variant !== 1;
  const friendCalls = [];
  const phases = [];
  const participantIds = new Set();
  const party = pattern.party.map(([hp, level, flags], index) => {
    if (flags & 1) participantIds.add(index);
    return { id: index, hp, level, pokerus: Boolean(flags & 2), isOnField: () => Boolean(flags & 4),
      addFriendship: amount => { if (amount !== friendship) throw new Error("Actual friendship argument"); friendCalls.push(index); },
      getHeldItems: () => [], updateInfo: () => { throw new Error("Excluded Macho Brace call"); },
    };
  });
  while (participantIds.size < pattern.count) participantIds.add(1000 + participantIds.size);
  if (participantIds.size !== pattern.count) throw new Error("Participant input mismatch");
  const activeMods = [ExpShareModifier, ExpBalanceModifier, MultipleParticipantExpBonusModifier]
    .flatMap((Type, index) => mods[index] === null ? [] : [new Type(mods[index])]);
  Overrides.XP_MULTIPLIER_OVERRIDE = mods[3];
  const oracle = new Oracle();
  Object.assign(oracle, {
    getPlayerParty: () => party, findModifier: predicate => activeMods.find(predicate), getMaxExpLevel: () => 50,
    currentBattle: { playerParticipantIds: participantIds, battleType: trainer ? "TRAINER" : "WILD", isBattleMysteryEncounter: () => false },
    gameMode: { modeId: "CLASSIC" },
    applyModifiers: (Type, player, member, holder) => {
      if (Type !== PokemonExpBoosterModifier || player !== true || !party.includes(member) || !(holder instanceof NumberHolder)) throw new Error("Unexpected excluded modifier call");
    },
    updateModifiers: () => { throw new Error("Excluded Macho Brace call"); },
    phaseManager: { create: (kind, index, exp) => {
      if (!["ExpPhase", "ShowPartyExpBarPhase"].includes(kind) || !Number.isFinite(exp)) throw new Error("Unexpected actual phase");
      return [index, kind === "ExpPhase" ? 1 : 0, bits(exp)];
    }, unshiftPhase: phase => phases.push(phase) },
  });
  oracle.applyPartyExp(raw, defeated, false, participantIds);
  rows.push([raw, +trainer, +defeated, 50, pattern.count, ...mods.map(optional),
    pattern.party.map(member => member.join(":")).join(","),
    friendCalls.length ? friendCalls.join(",") : "-",
    phases.length ? phases.map(phase => phase.join(":")).join(",") : "-"].join("\t"));
}
const output = Buffer.from(rows.join("\n") + "\n");
if (rows.length !== 144 || output.length > 65536) throw new Error("Exact bounded source matrix");
fs.writeFileSync(process.argv[2], output, { flag: "wx" });
console.log(JSON.stringify({ source_hashes: pins, function_sha256: hash(original), function_bytes: Buffer.byteLength(original),
  phaser_version: phaserVersion, linear_sha256: hash(linearBytes), linear_bytes: linearBytes.length,
  friendship_argument: friendship, cases: rows.length, output_sha256: hash(output), output_bytes: output.length,
  runtime: process.version, scope: "actual applyPartyExp method; unboosted normal Classic API boundary, no phase execution or pending-owner settlement" }));
