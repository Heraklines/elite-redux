#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Per-batch runner for the ability decomposition harness (spec section 4, "Per-batch runner").
//
//   node scripts/decomp/run-batch.mjs --batch B05               L0 + L1 for everything, L2 for the abilities using B05's classes
//   node scripts/decomp/run-batch.mjs --classes A,B --l2 all     the same for an explicit class list
//   node scripts/decomp/run-batch.mjs --all                      everything, no class filter (nightly / merge captain)
//
// Options
//   --batch Bnn          reads test/tests/elite-redux/decomp/batches/Bnn.json: {"classes": [...]} or a list of
//                        class names or of {"type": "ClassName"} entries (the shape of attr-inventory.json)
//   --inventory <file>   with --files: take the class list from an attr-inventory.json whose `file` matches
//   --files a.ts,b.ts    (substring match on the inventory's `file` field)
//   --classes A,B        explicit class names
//   --l2 signatures|all|off   signatures (default): one ability per distinct param signature of each class,
//                        the proof rule; all: every ability that uses a class of the batch; off: skip L2
//   --l3                 also run the L3 suites (compile matrix, metamorphic, round trip, fuzz, recipes)
//   --shard i/n          contiguous slice of the L2 ability list (sharded nightly runs)
//   --strict             every class of the GAME must be declared (merge captain, after the last batch)
//   --only l0,l1,l2,l3   run only these levels
//
// Vitest runs one process at a time (the machine is shared), and each level's wall-clock time is
// printed at the end together with the DECOMP_* summary lines the suites log.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);

function flag(name) {
  return args.includes(`--${name}`);
}
function value(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function classNamesFrom(raw) {
  const list = Array.isArray(raw) ? raw : (raw.classes ?? []);
  return list.map(entry => (typeof entry === "string" ? entry : (entry.type ?? entry.className))).filter(Boolean);
}

let classes;
if (value("classes")) {
  classes = value("classes")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
} else if (value("batch")) {
  const file = resolve(root, "test/tests/elite-redux/decomp/batches", `${value("batch")}.json`);
  if (!existsSync(file)) {
    console.error(
      `No worklist at ${file}. A batch worklist is {"classes": ["ClassName", ...]}; the librarian emits it.`,
    );
    process.exit(2);
  }
  classes = classNamesFrom(JSON.parse(readFileSync(file, "utf8")));
} else if (value("files")) {
  const inventoryFile = resolve(value("inventory") ?? `${process.env.HOME}/er-probe/attr-inventory.json`);
  const wanted = value("files")
    .split(",")
    .map(s => s.trim());
  const inventory = JSON.parse(readFileSync(inventoryFile, "utf8"));
  classes = inventory.filter(entry => entry.file && wanted.some(w => entry.file.includes(w))).map(entry => entry.type);
}

if (!flag("all") && classes === undefined) {
  console.error("Give --batch Bnn, --classes A,B, --files path (with --inventory) or --all.");
  process.exit(2);
}

const l2mode = value("l2") ?? "signatures";
const only = value("only")?.split(",");
const wants = level => (only === undefined ? level !== "l3" || flag("l3") : only.includes(level));

const dir = "test/tests/elite-redux/decomp/harness";
const levels = [
  { id: "l0", name: "L0 static lint + coverage gate", files: [`${dir}/l0-lint.test.ts`, `${dir}/coverage.test.ts`] },
  { id: "l1", name: "L1 identity + predicate differential", files: [`${dir}/l1.test.ts`] },
  ...(l2mode === "off" ? [] : [{ id: "l2", name: `L2 battle twins (${l2mode})`, files: [`${dir}/l2-twin.test.ts`] }]),
  {
    id: "l3",
    name: "L3 compile matrix, metamorphic, round trip, fuzz, golden recipes",
    files: [
      `${dir}/l3-compile.test.ts`,
      `${dir}/l3-metamorphic.test.ts`,
      `${dir}/l3-roundtrip-fuzz.test.ts`,
      `${dir}/l3-recipes.test.ts`,
    ],
  },
];

const env = {
  ...process.env,
  ...(classes === undefined ? {} : { DECOMP_CLASSES: classes.join(",") }),
  DECOMP_L2_MODE: l2mode === "all" ? "all" : "signatures",
  ...(value("shard") ? { DECOMP_SHARD: value("shard") } : {}),
  ...(flag("strict") ? { DECOMP_STRICT: "1" } : {}),
};

console.log(
  classes === undefined
    ? "Batch: the whole game (no class filter)"
    : `Batch: ${classes.length} classes${classes.length <= 8 ? ` (${classes.join(", ")})` : ""}`,
);

const timings = [];
let failed = false;
for (const level of levels) {
  if (!wants(level.id)) {
    continue;
  }
  const started = Date.now();
  const result = spawnSync("npx", ["vitest", "run", ...level.files], {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  const seconds = (Date.now() - started) / 1000;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colour codes from vitest output
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
  const summary = text.split("\n").filter(line => /^DECOMP_|Test Files|Tests /.test(line.trim()));
  console.log(`\n== ${level.name}: ${result.status === 0 ? "PASS" : "FAIL"} in ${seconds.toFixed(1)}s`);
  for (const line of summary) {
    console.log(`   ${line.trim()}`);
  }
  if (result.status !== 0) {
    failed = true;
    const failures = text
      .split("\n")
      .filter(line => /FAIL|AssertionError|Error:/.test(line))
      .slice(0, 12);
    for (const line of failures) {
      console.log(`   ! ${line.trim()}`);
    }
  }
  timings.push({ level: level.id, seconds });
}

console.log(`\nRuntime: ${timings.map(t => `${t.level.toUpperCase()} ${t.seconds.toFixed(1)}s`).join(" | ")}`);
process.exit(failed ? 1 : 0);
