import fs from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
const hash = raw => crypto.createHash("sha256").update(raw).digest("hex");
const path = "src/phase-tree.ts";
const raw = fs.readFileSync(path);
const expected = "2a152ebab21e2d54e72a0655896ece0d731c48aa82d61d8130d2a30f1e895b3c";
if (raw.length !== 9396 || hash(raw) !== expected || process.version !== "v24.9.0") throw new Error("Whole pinned source/runtime required");
const source = raw.toString("utf8").replace(/^import type .*;\n/gm, "").replace("export class PhaseTree", "class PhaseTree");
const PhaseTree = vm.runInNewContext(stripTypeScriptTypes(source) + "\nPhaseTree", {}, { timeout: 1000 });
const alphabet = "adpbnckifgrex";
const rows = [];
for (let seed = 0; seed < 64; seed++) {
  let x = seed + 1;
  let script = "ppanap";
  for (let i = 0; i < 18; i++) { x = (x * 37 + 19) % 997; script += alphabet[x % alphabet.length]; }
  const tree = new PhaseTree();
  let visits = [];
  const trace = [];
  for (let i = 0; i < script.length; i++) {
    visits = [];
    const id = i + 1;
    const phase = { id, phaseName: String(id), is: type => { visits.push(String(id)); return String(id % 3) === type; } };
    const type = String((seed + i) % 4);
    const filtered = i % 2 === 1;
    const filter = p => { visits.push("f" + p.id); return p.id % 2 === 0; };
    let result = "-";
    const op = script[i];
    if (op === "a" || op === "d") tree.addPhase(phase, op === "d");
    else if (op === "p") tree.pushPhase(phase);
    else if (op === "b") tree.addBarrier(phase);
    else if (op === "n") result = tree.getNextPhase()?.phaseName ?? "-";
    else if (op === "c" || op === "k") tree.clear(op === "k");
    else if (op === "i") tree.addAfter(phase, type);
    else if (op === "f") result = tree.find(type, filtered ? filter : undefined)?.phaseName ?? "-";
    else if (op === "g") result = tree.findAll(type, filtered ? filter : undefined).map(p => p.id).join(",") || "_";
    else if (op === "r") result = tree.remove(type, filtered ? filter : undefined) ? "T" : "F";
    else if (op === "e") result = tree.exists(type, filtered ? filter : undefined) ? "T" : "F";
    else if (op === "x") tree.removeAll(type);
    else throw new Error("Unknown operation");
    trace.push([result, visits.join(","), tree.currentLevel, Number(tree.deferredActive), tree.levels.map(level => level.map(p => p.id).join(",")).join("/"), tree.queuedPhaseNames().join(",")].join(":"));
  }
  rows.push([seed, script, trace.join(";")].join("\t"));
}
const output = Buffer.from(rows.join("\n") + "\n");
if (output.length > 65536) throw new Error("Bounded source trace required");
fs.writeFileSync(process.argv[2], output, { flag: "wx" });
console.log(JSON.stringify({ runtime: process.version, source_hashes: {[path]: expected}, cases: 64, whole_class: true, predicate_order_checked: true, output_bytes: output.length, output_sha256: hash(output), phase_execution_qualified: false }));
