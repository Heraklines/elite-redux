import fs from "node:fs";
import crypto from "node:crypto";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const hash = raw => crypto.createHash("sha256").update(raw).digest("hex");
const sourcePath = "src/phase-tree.ts";
const raw = fs.readFileSync(sourcePath);
const expected = "2a152ebab21e2d54e72a0655896ece0d731c48aa82d61d8130d2a30f1e895b3c";
if (raw.length !== 9396 || hash(raw) !== expected || process.version !== "v24.9.0") throw new Error("Pinned whole source and runtime required");
const source = raw.toString("utf8").replace(/^import type .*;\n/gm, "").replace("export class PhaseTree", "class PhaseTree");
const PhaseTree = vm.runInNewContext(stripTypeScriptTypes(source) + "\nPhaseTree", {}, { timeout: 1000 });
const scripts = ["ppa anban nnnnnnnn".replaceAll(" ", ""), "ppdnanknnnnnnnnn", "dpncdnannnnnnnnn"];
const alphabet = "adpbnckaannn";
for (let seed = 0; seed < 61; seed++) {
  let x = seed + 1;
  let script = "ppanb";
  for (let i = 0; i < 11; i++) {
    x = (x * 37 + 19) % 997;
    script += alphabet[x % alphabet.length];
  }
  scripts.push(script);
}
const rows = [];
for (let caseId = 0; caseId < scripts.length; caseId++) {
  const tree = new PhaseTree();
  const steps = [];
  for (let i = 0; i < scripts[caseId].length; i++) {
    const op = scripts[caseId][i];
    const phase = { phaseName: String(i + 1) };
    let popped = "-";
    if (op === "a" || op === "d") tree.addPhase(phase, op === "d");
    else if (op === "p") tree.pushPhase(phase);
    else if (op === "b") tree.addBarrier(phase);
    else if (op === "n") popped = tree.getNextPhase()?.phaseName ?? "-";
    else if (op === "c" || op === "k") tree.clear(op === "k");
    else throw new Error("Unknown source operation");
    const levels = tree.levels.map(level => level.map(p => p.phaseName).join(",")).join("/");
    steps.push([popped, tree.currentLevel, Number(tree.deferredActive), levels, tree.queuedPhaseNames().join(",")].join(":"));
  }
  rows.push([caseId, scripts[caseId], steps.join(";")].join("\t"));
}
const output = Buffer.from(rows.join("\n") + "\n");
if (output.length > 65536) throw new Error("Bounded actual queue traces");
fs.writeFileSync(process.argv[2], output, { flag: "wx" });
console.log(JSON.stringify({runtime: process.version, source_hashes: {[sourcePath]: expected}, cases: rows.length, whole_class: true, operations: "addPhase,deferred addPhase,pushPhase,addBarrier,getNextPhase,clear,clear(true),queuedPhaseNames", output_bytes: output.length, output_sha256: hash(output), phase_execution_qualified: false}));
