#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const CORE_CRATES = new Set([
  "er-battle",
  "er-canonical",
  "er-content",
  "er-game",
  "er-kernel",
  "er-mechanics",
  "er-protocol",
  "er-rng",
  "er-run",
  "er-state",
  "er-types",
]);
const RULES = [
  { id: "WALL_CLOCK", pattern: /\b(?:Instant|SystemTime)\b|std::time/u, severity: "ERROR" },
  { id: "FILESYSTEM", pattern: /std::fs|\bPathBuf\b|\bFile::/u, severity: "ERROR" },
  { id: "NETWORK", pattern: /std::net|TcpStream|UdpSocket|WebSocket/u, severity: "ERROR" },
  { id: "THREADING", pattern: /std::thread|thread::spawn|tokio::spawn/u, severity: "ERROR" },
  { id: "ASYNC_RUNTIME", pattern: /\btokio\b|async_std/u, severity: "ERROR" },
  { id: "UNSAFE", pattern: /\bunsafe\b/u, severity: "ERROR" },
  { id: "NONDETERMINISTIC_MAP", pattern: /\bHashMap\b|\bHashSet\b/u, severity: "ERROR" },
  { id: "ARBITRARY_JSON", pattern: /serde_json::Value/u, severity: "ERROR" },
  { id: "DYNAMIC_TRAIT_OBJECT", pattern: /\b(?:Box|Arc|Rc)<dyn\b|&dyn\b/u, severity: "ERROR" },
  { id: "FUNCTION_POINTER", pattern: /\bfn\s*\(/u, severity: "REVIEW" },
  { id: "UNBOUNDED_LOOP", pattern: /\bloop\s*\{/u, severity: "REVIEW" },
  { id: "SATURATING_FALLBACK", pattern: /saturating_(?:add|sub|mul)/u, severity: "REVIEW" },
];

function fail(message) {
  throw new Error(`M7 architecture audit: ${message}`);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("invalid arguments");
    }
    values.set(key, value);
  }
  for (const key of ["--root", "--output"]) {
    if (!values.has(key)) {
      fail(`missing ${key}`);
    }
  }
  if (!isAbsolute(values.get("--root")) || !isAbsolute(values.get("--output"))) {
    fail("root and output paths must be absolute");
  }
  return { root: resolve(values.get("--root")), output: resolve(values.get("--output")) };
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function filesBelow(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && entry.name.endsWith(".rs")) {
        files.push(path);
      }
    }
  }
  return files;
}

const input = parseArgs(process.argv.slice(2));
const cratesRoot = join(input.root, "rust", "crates");
const findings = [];
for (const crate of readdirSync(cratesRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
  if (!CORE_CRATES.has(crate.name)) {
    continue;
  }
  for (const path of filesBelow(join(cratesRoot, crate.name, "src"))) {
    const lines = readFileSync(path, "utf8").replace(/\r\n?/gu, "\n").split("\n");
    for (const [index, line] of lines.entries()) {
      const code = line.replace(/\/\/.*$/u, "");
      for (const rule of RULES) {
        if (!rule.pattern.test(code)) {
          continue;
        }
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          crate: crate.name,
          path: relative(input.root, path).replaceAll("\\", "/"),
          line: index + 1,
          line_sha256: createHash("sha256").update(code.trim()).digest("hex"),
        });
      }
    }
  }
}
findings.sort(
  (left, right) => compareText(left.rule, right.rule) || compareText(left.path, right.path) || left.line - right.line,
);
const counts = {};
for (const rule of RULES) {
  counts[rule.id] = findings.filter(finding => finding.rule === rule.id).length;
}
const report = {
  schema_version: 1,
  scope: [...CORE_CRATES].sort(compareText),
  rules: RULES.map(rule => ({ id: rule.id, severity: rule.severity })),
  finding_count: findings.length,
  error_count: findings.filter(finding => finding.severity === "ERROR").length,
  review_count: findings.filter(finding => finding.severity === "REVIEW").length,
  counts,
  findings,
};
mkdirSync(dirname(input.output), { recursive: true });
writeFileSync(input.output, `${JSON.stringify(report)}\n`);
console.log(
  `M7 architecture audit: ${report.error_count} deterministic-core errors and ${report.review_count} review findings`,
);
