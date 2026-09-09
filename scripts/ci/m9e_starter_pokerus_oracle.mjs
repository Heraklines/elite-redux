import fs from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
const hash = value => createHash("sha256").update(value).digest("hex");
const pins = {
  "src/field/pokemon.ts": "4074ff23323ec01f92422b5666ad0b397a0c73cafd11f158637346b5a35af8fa",
  "src/phases/select-starter-phase.ts": "818c060ada86e24a31a0bb0095e75dd915604d2812e9edf865bd5a17b647fe57",
};
const texts = {};
for (const [path, expected] of Object.entries(pins)) {
  const bytes = fs.readFileSync(path);
  if (hash(bytes) !== expected) throw Error(`Source changed: ${path}`);
  texts[path] = bytes.toString("utf8");
}
const fresh = "this.pokerus = false;";
const selected = "if (starter.pokerus) {\n        starterPokemon.pokerus = true;\n      }";
for (const [path, snippet] of [["src/field/pokemon.ts", fresh], ["src/phases/select-starter-phase.ts", selected]]) {
  if (texts[path].split(snippet).length !== 2) throw Error("Unique actual assignment required");
}
function execute(flag) {
  const target = {};
  const context = vm.createContext({ starter: { pokerus: flag }, starterPokemon: target });
  new vm.Script(`(function(){${fresh}}).call(starterPokemon);${selected}`).runInContext(context, { timeout: 1000 });
  if (typeof target.pokerus !== "boolean") throw Error("Boolean result required");
  return target.pokerus;
}
const rows = [];
for (const left of [false, true]) for (const right of [false, true]) {
  rows.push([left, right, execute(left), execute(right)].join("\t"));
}
const output = Buffer.from(rows.join("\n") + "\n");
if (output.length > 4096) throw Error("Bounded cases required");
fs.writeFileSync(process.argv[2], output, { flag: "wx" });
process.stdout.write(JSON.stringify({runtime:process.version,cases:4,source_hashes:pins,
  fresh_assignment_sha256:hash(fresh),selected_assignment_sha256:hash(selected),
  whole_constructor:false,whole_starter_phase:false,profile_eligibility_qualified:false,
  output_bytes:output.length,output_sha256:hash(output)}) + "\n");
