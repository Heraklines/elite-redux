import fs from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const hash = raw => crypto.createHash("sha256").update(raw).digest("hex");
const pins = {
  "src/field/pokemon.ts": "4074ff23323ec01f92422b5666ad0b397a0c73cafd11f158637346b5a35af8fa",
  "src/data/moves/move-utils.ts": "6f296e67ba9be531ba12dd1455cbebd04b7fdedfe6ec8cadb2d3df73743d50eb",
  "src/data/battle-format.ts": "7619f84967643acc73a39c9e45f76c6a3ff4944b1f1794254bf37c279e9bffe8",
  "src/enums/move-target.ts": "dd9272781d53e85b051fe071bb12d23d54c3625892bc973f535f4f14cd68cd80",
  "src/enums/battler-index.ts": "a2b1c976090f93826ecf89fc5571a501ef89fd0d1e91263946288a9307c8bd02",
  "src/enums/pokemon-type.ts": "4f5a8989b5a3e732c98130316ac72944c32bce851d2e397832a06afe0fa47c82",
  "src/enums/move-flags.ts": "ad4f5357dc7a3d42c956269d41a3b4677cc363142df25afa258e6f6225073fa5",
};
const sources = {};
for (const [path, expected] of Object.entries(pins)) {
  const raw = fs.readFileSync(path);
  if (hash(raw) !== expected) throw new Error("Whole source changed: " + path);
  sources[path] = raw.toString("utf8");
}
if (process.version !== "v24.9.0") throw new Error("Pinned runtime required");
const transpile = source => stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, "").replace(/\bexport /g, ""), { mode: "transform" });
const sandbox = { globalScene: {}, allMoves: {}, ValueHolder: class { constructor(value) { this.value = value; } }, isFogWeather: value => value === "FOG" };
vm.createContext(sandbox);
for (const name of ["MoveTarget", "BattlerIndex", "PokemonType", "MoveFlags"]) {
  const path = "src/enums/" + name.replace(/[A-Z]/g, (c, index) => (index ? "-" : "") + c.toLowerCase()) + ".ts";
  vm.runInContext(transpile(sources[path]) + `\nglobalThis.${name} = ${name};`, sandbox, { timeout: 1000 });
}
const format = sources["src/data/battle-format.ts"];
const start = format.indexOf("export function lineAdjacency(");
const end = format.indexOf("\nconst teamOf", start);
if (start < 0 || end < start) throw new Error("Unique complete adjacency function required");
vm.runInContext(transpile(format.slice(start, end)), sandbox, { timeout: 1000 });
vm.runInContext(transpile(sources["src/data/moves/move-utils.ts"]), sandbox, { timeout: 1000 });
// Execute the complete current enumeration methods too; their downstream
// allowance/on-field owners are explicit resolved inputs rather than substitutes.
const pokemon = sources["src/field/pokemon.ts"];
const methods = ["public isActive(onField = false): boolean", "getOpponents(onField = true): Pokemon[]", "getAllies(): Pokemon[]"].map(signature => {
  const marker = "  " + signature + " {";
  const start = pokemon.indexOf(marker);
  const end = pokemon.indexOf("\n  }", start);
  if (start < 0 || end < start || pokemon.indexOf(marker, start + 1) !== -1) throw new Error("Unique source owner method");
  return pokemon.slice(start, end + 4);
});
vm.runInContext(transpile("class SourcePokemon {\n" + methods.join("\n") + "\n}\nglobalThis.SourcePokemon = SourcePokemon;"), sandbox, { timeout: 1000 });
const kinds = Object.keys(sandbox.MoveTarget).filter(key => Number.isNaN(Number(key)));
if (kinds.length !== 20 || sandbox.BattlerIndex.ATTACKER !== -1) throw new Error("Exact source target domain");
const cases = [];
for (let variant = 0; variant < 10; variant++) {
  for (const target of kinds) {
    const capacities = variant === 0 ? [1, 1] : variant === 1 ? [2, 2] : variant === 9 ? [2, 3] : [3, 3];
    const user = variant % 2 ? 3 : 0;
    const active = Array.from({ length: 6 }, (_, i) => i % 3 < capacities[Math.floor(i / 3)]);
    const allowed = [...active];
    if (variant === 2) { active[3] = false; active[4] = false; }
    if (variant === 3) { active[1] = false; active[2] = false; }
    if (variant === 4) { active[1] = false; active[2] = false; active[3] = false; active[4] = false; }
    if (variant === 8) active[user] = false;
    if (variant === 9) { allowed[0] = false; active[0] = false; }
    const opponentCount = allowed.slice(user < 3 ? 3 : 0, user < 3 ? 6 : 3).filter(Boolean).length;
    const variable = Array(opponentCount).fill(null);
    if (variant === 9) variable[opponentCount - 1] = target;
    const input = { capacities, allowed, active, user, target, replacement: variant === 9 ? "USER" : null, variable,
      spread_flag: variant === 5 || variant === 6, multi_hit: variant === 6,
      ghost: variant === 2, fog: variant === 3 || variant === 4, fog_suppressed: variant === 4,
      flying: variant === 7, pulse: variant === 8, arrangement: variant !== 0,
      random_index: target === "RANDOM_NEAR_ENEMY" ? variant % opponentCount : null };
    const visits = [], draws = [];
    const mons = Array.from({ length: 6 }, (_, index) => Object.assign(new sandbox.SourcePokemon(), {
      getBattlerIndex: () => index,
      isPlayer: () => index < 3,
      isAllowedInBattle: () => allowed[index],
      isOnField: () => active[index],
      isOfType: type => type === sandbox.PokemonType.GHOST && input.ghost,
      hasAbilityWithAttr: () => input.spread_flag,
      getAbilityAttrs: () => input.spread_flag ? [{ flag: 999 }] : [],
    }));
    const player = mons.slice(0, capacities[0]), enemy = mons.slice(3, 3 + capacities[1]);
    const actor = mons[user];
    actor.randBattleSeedInt = bound => { draws.push(bound); return input.random_index; };
    sandbox.applyMoveAttrs = (_attr, _user, opponent, _move, holder) => {
      visits.push(opponent.getBattlerIndex());
      const value = input.variable[visits.length - 1];
      if (value !== null) holder.value = sandbox.MoveTarget[value];
    };
    sandbox.allMoves[0] = {
      moveTarget: sandbox.MoveTarget[target], type: input.flying ? sandbox.PokemonType.FLYING : sandbox.PokemonType.NORMAL,
      hasAttr: name => name === "MultiHitAttr" && input.multi_hit,
      hasFlag: flag => flag === 999 ? input.spread_flag : flag === sandbox.MoveFlags.PULSE_MOVE && input.pulse,
    };
    const sides = capacities.map((capacity, side) => ({ capacity, mirrored: side === 1 }));
    const adjacency = sandbox.lineAdjacency(sides);
    const arrangement = { locate: index => ({ side: Math.floor(index / 3), position: index % 3 }), capacityOf: side => capacities[side], isAdjacent: adjacency.reaches };
    sandbox.globalScene.currentBattle = { arrangement: input.arrangement ? arrangement : undefined };
    sandbox.globalScene.getPlayerField = () => player;
    sandbox.globalScene.getEnemyField = () => enemy;
    sandbox.globalScene.arena = { weather: { weatherType: input.fog ? "FOG" : "NONE", isEffectSuppressed: () => input.fog_suppressed } };
    const result = sandbox.getMoveTargets(actor, 0, input.replacement === null ? undefined : sandbox.MoveTarget[input.replacement]);
    cases.push({ input, expected: { ...result, variable_visits: visits, random_bounds: draws } });
  }
}
const output = Buffer.from(cases.map(value => JSON.stringify(value)).join("\n") + "\n");
if (output.length > 262144) throw new Error("Bounded complete source observations");
fs.writeFileSync(process.argv[2], output, { flag: "wx" });
console.log(JSON.stringify({ runtime: process.version, source_hashes: pins, cases: cases.length, whole_target_function: true, whole_line_adjacency: true, whole_enumeration_methods: true, resolved_owner_inputs_only: true, battle_execution_qualified: false, output_bytes: output.length, output_sha256: hash(output) }));
