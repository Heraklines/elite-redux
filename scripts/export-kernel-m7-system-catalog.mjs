#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";

const requireFrom = process.env.M7_TYPESCRIPT_ROOT
  ? createRequire(resolve(process.env.M7_TYPESCRIPT_ROOT, "package.json"))
  : createRequire(import.meta.url);
const ts = requireFrom("typescript");

const DOMAIN_RULES = [
  ["M6_PROTOCOL", ["coop", "authority", "protocol"]],
  [
    "PLATFORM",
    [
      "account",
      "api",
      "cookies",
      "dev",
      "director",
      "fetch",
      "llm",
      "auth",
      "cloud",
      "network",
      "online",
      "plugin",
      "plugins",
      "service-worker",
      "telemetry",
      "notifications",
      "test-suite",
      "tools",
      "webrtc",
      "indexeddb",
    ],
  ],
  [
    "PRESENTATION",
    [
      "animation",
      "audio",
      "camera",
      "message",
      "phase",
      "phases",
      "render",
      "renderer",
      "scene",
      "scenes",
      "shader",
      "sound",
      "sprite",
      "sprites",
      "ui",
    ],
  ],
  ["SAVE_REPLAY_PROFILE", ["save", "saves", "replay", "profile", "session", "storage", "dex-data", "game-stats"]],
  ["CAPTURE_PARTY", ["capture", "pokeball", "poke-ball", "party", "pokemon-storage", "release-pokemon"]],
  [
    "PROGRESSION",
    [
      "evolution",
      "evolutions",
      "evolve",
      "fusion",
      "level",
      "experience",
      "growth",
      "nature",
      "friendship",
      "learnset",
      "move-reminder",
      "tm",
      "form-change",
    ],
  ],
  [
    "INVENTORY_ECONOMY",
    [
      "modifier",
      "modifiers",
      "item",
      "items",
      "reward",
      "rewards",
      "shop",
      "market",
      "money",
      "voucher",
      "relic",
      "reroll",
    ],
  ],
  ["SCENARIO", ["mystery", "scenario", "scenarios", "scripted-event", "encounter-event"]],
  ["QUEST_FACTION", ["quest", "quests", "faction", "factions", "domain", "domains", "standing"]],
  [
    "AI_MODES",
    ["ai", "moody", "ghost", "showdown", "trainer", "trainers", "boss", "game-mode", "challenge", "daily", "endless"],
  ],
  [
    "WORLD",
    ["biome", "biomes", "encounter", "encounters", "notoriety", "route", "routes", "wave", "waves", "world", "spawn"],
  ],
  [
    "BATTLE",
    [
      "ability",
      "abilities",
      "arena",
      "archetype",
      "archetypes",
      "battle",
      "battler",
      "damage",
      "field",
      "move",
      "moves",
      "pokemon",
      "positional",
      "status",
      "tag",
      "tags",
      "terrain",
      "weather",
    ],
  ],
  ["CONTROL", ["command", "control", "controls", "input", "inputs", "menu", "menus", "navigation"]],
];
const CANONICAL_DOMAINS = new Set([
  "CONTROL",
  "SAVE_REPLAY_PROFILE",
  "CAPTURE_PARTY",
  "PROGRESSION",
  "INVENTORY_ECONOMY",
  "SCENARIO",
  "QUEST_FACTION",
  "AI_MODES",
  "WORLD",
  "BATTLE",
  "RUN_META",
]);
const CALLBACK_CONTEXT_NAMES = new Set([
  "map",
  "filter",
  "flatMap",
  "forEach",
  "reduce",
  "sort",
  "find",
  "findIndex",
  "some",
  "every",
  "add",
  "attr",
  "register",
  "set",
]);

function fail(message) {
  throw new Error(`M7 system catalog exporter: ${message}`);
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
  for (const key of ["--oracle-root", "--oracle-sha", "--output-root"]) {
    if (!values.has(key)) {
      fail(`missing ${key}`);
    }
  }
  const oracleRoot = resolve(values.get("--oracle-root"));
  const outputRoot = resolve(values.get("--output-root"));
  const oracleSha = values.get("--oracle-sha");
  if (!isAbsolute(values.get("--oracle-root")) || !isAbsolute(values.get("--output-root"))) {
    fail("oracle and output roots must be absolute");
  }
  if (!/^[0-9a-f]{40}$/u.test(oracleSha) || !existsSync(resolve(oracleRoot, "src"))) {
    fail("oracle identity or source tree is invalid");
  }
  const exporterRoot = resolve(import.meta.dirname, "..");
  const inside = (root, candidate) => {
    const path = relative(root, candidate);
    return path === "" || (!path.startsWith("..") && !isAbsolute(path));
  };
  if (inside(oracleRoot, outputRoot) || inside(exporterRoot, outputRoot)) {
    fail("output root must be outside oracle and exporter worktrees");
  }
  return { oracleRoot, oracleSha, outputRoot };
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareText)
        .map(key => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function writeJson(root, name, value) {
  mkdirSync(root, { recursive: true });
  writeFileSync(resolve(root, name), `${JSON.stringify(canonicalize(value))}\n`);
}

function normalizedPath(root, path) {
  return relative(root, path).replaceAll("\\", "/");
}

function sourceLocation(sourceFile, node, oracleRoot) {
  const point = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    path: normalizedPath(oracleRoot, sourceFile.fileName),
    line: point.line + 1,
    column: point.character + 1,
  };
}
function astText(node, sourceFile) {
  return node.getText(sourceFile).replace(/\r\n?/gu, "\n");
}

function declarationName(node, sourceFile) {
  if (node.name) {
    return astText(node.name, sourceFile);
  }
  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && parent.name) {
    return astText(parent.name, sourceFile);
  }
  if (ts.isPropertyAssignment(parent) && parent.name) {
    return astText(parent.name, sourceFile);
  }
  if (ts.isCallExpression(parent)) {
    const expression = parent.expression;
    const call = ts.isPropertyAccessExpression(expression) ? expression.name.text : astText(expression, sourceFile);
    const argument = parent.arguments.indexOf(node);
    return `${call}[${argument}]`;
  }
  return "anonymous";
}

function ownerName(node, sourceFile) {
  let current = node.parent;
  while (current) {
    if (
      (ts.isClassDeclaration(current) || ts.isInterfaceDeclaration(current) || ts.isTypeAliasDeclaration(current))
      && current.name
    ) {
      return astText(current.name, sourceFile);
    }
    current = current.parent;
  }
  return null;
}

function declarationKind(node) {
  if (ts.isFunctionDeclaration(node)) {
    return "FUNCTION";
  }
  if (ts.isMethodDeclaration(node)) {
    return "METHOD";
  }
  if (ts.isConstructorDeclaration(node)) {
    return "CONSTRUCTOR";
  }
  if (ts.isGetAccessorDeclaration(node)) {
    return "GETTER";
  }
  if (ts.isSetAccessorDeclaration(node)) {
    return "SETTER";
  }
  if (ts.isArrowFunction(node)) {
    return "ARROW_CALLBACK";
  }
  if (ts.isFunctionExpression(node)) {
    return "FUNCTION_CALLBACK";
  }
  return null;
}

function callbackIsBehavior(node) {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) {
    return true;
  }
  if (!ts.isCallExpression(parent)) {
    return false;
  }
  const expression = parent.expression;
  const name = ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : astText(expression, expression.getSourceFile());
  return (
    CALLBACK_CONTEXT_NAMES.has(name)
    || /(?:callback|handler|predicate|selector|factory|builder|effect|condition|policy)/iu.test(name)
  );
}
function isBehaviorDeclaration(node, kind) {
  if (!kind) {
    return false;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return callbackIsBehavior(node);
  }
  return true;
}

function domainFor(path, symbol, owner) {
  const evidence = `${path} ${symbol} ${owner ?? ""}`.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase();
  const tokens = new Set(evidence.split(/[^a-z0-9]+/gu).filter(Boolean));
  for (const [domain, names] of DOMAIN_RULES) {
    if (names.some(name => tokens.has(name))) {
      return domain;
    }
  }
  return "RUN_META";
}

function implementationStatus(domain) {
  if (domain === "PLATFORM") {
    return "PLATFORM_EFFECT";
  }
  if (domain === "PRESENTATION") {
    return "PRESENTATION_ONLY";
  }
  if (domain === "BATTLE") {
    return "M6_IMPLEMENTED";
  }
  if (domain === "M6_PROTOCOL") {
    return "M6_IMPLEMENTED";
  }
  return "REQUIRES_M7";
}

function behaviorId(oracleSha, source, kind, owner, symbol) {
  const identity = `${oracleSha}\0${source.path}\0${source.line}\0${source.column}\0${kind}\0${owner ?? ""}\0${symbol}`;
  return createHash("sha256").update(identity).digest("hex");
}

function propertyType(node, sourceFile) {
  return node.type ? astText(node.type, sourceFile) : "unknown";
}

function inventorySourceFile(sourceFile, oracleRoot, oracleSha, catalog) {
  const path = normalizedPath(oracleRoot, sourceFile.fileName);
  const visit = node => {
    const kind = declarationKind(node);
    if (isBehaviorDeclaration(node, kind)) {
      const source = sourceLocation(sourceFile, node, oracleRoot);
      const symbol = declarationName(node, sourceFile);
      const owner = ownerName(node, sourceFile);
      const domain = domainFor(path, symbol, owner);
      const unit = {
        id: behaviorId(oracleSha, source, kind, owner, symbol),
        source,
        declaration_kind: kind,
        owner,
        symbol,
        domain,
        implementation_status: implementationStatus(domain),
        async: node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
        parameter_count: node.parameters?.length ?? 0,
      };
      catalog.behaviors.push(unit);
    }
    if (
      (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node))
      && /(?:save|profile|replay|session|runstate|run_state|snapshot)/iu.test(
        `${path} ${ownerName(node, sourceFile) ?? ""}`,
      )
    ) {
      const source = sourceLocation(sourceFile, node, oracleRoot);
      const owner = ownerName(node, sourceFile);
      const field = node.name ? astText(node.name, sourceFile) : "anonymous";
      const type = propertyType(node, sourceFile);
      catalog.saveFields.push({
        id: createHash("sha256")
          .update(`${oracleSha}\0${path}\0${source.line}\0${source.column}\0${owner ?? ""}\0${field}\0${type}`)
          .digest("hex"),
        source,
        owner,
        field,
        type,
        optional: Boolean(node.questionToken),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

const input = parseArgs(process.argv.slice(2));
if (git(input.oracleRoot, "rev-parse", "HEAD") !== input.oracleSha) {
  fail("oracle worktree HEAD does not match --oracle-sha");
}
const oracleTreeSha = git(input.oracleRoot, "rev-parse", `${input.oracleSha}^{tree}`);
const files = ts.sys
  .readDirectory(resolve(input.oracleRoot, "src"), [".ts", ".tsx"], ["**/*.d.ts"], undefined)
  .sort((left, right) => compareText(normalizedPath(input.oracleRoot, left), normalizedPath(input.oracleRoot, right)));
const output = { behaviors: [], saveFields: [], sourceFiles: [] };
for (const file of files) {
  const bytes = readFileSync(file);
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, bytes.toString("utf8"), ts.ScriptTarget.Latest, true, scriptKind);
  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostic = sourceFile.parseDiagnostics[0];
    fail(
      `TypeScript parse failure in ${normalizedPath(input.oracleRoot, file)} at ${diagnostic.start ?? 0}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
    );
  }
  inventorySourceFile(sourceFile, input.oracleRoot, input.oracleSha, output);
  output.sourceFiles.push({
    path: normalizedPath(input.oracleRoot, file),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
output.behaviors.sort((left, right) => compareText(left.id, right.id));
output.saveFields.sort((left, right) => compareText(left.id, right.id));
const uniqueIds = new Set(output.behaviors.map(unit => unit.id));
if (uniqueIds.size !== output.behaviors.length) {
  fail("duplicate behavior identities");
}
const domainCounts = Object.fromEntries(
  [...new Set(output.behaviors.map(unit => unit.domain))]
    .sort(compareText)
    .map(domain => [domain, output.behaviors.filter(unit => unit.domain === domain).length]),
);
const canonicalBehaviors = output.behaviors.filter(unit => CANONICAL_DOMAINS.has(unit.domain));
const runBehaviors = canonicalBehaviors.filter(unit => unit.domain !== "BATTLE");
const scenarioBehaviors = canonicalBehaviors.filter(
  unit => unit.domain === "SCENARIO" || unit.domain === "QUEST_FACTION",
);
const aiBehaviors = canonicalBehaviors.filter(unit => unit.domain === "AI_MODES");
const platformBoundaries = output.behaviors.filter(unit => unit.domain === "PLATFORM");
const presentationBoundaries = output.behaviors.filter(unit => unit.domain === "PRESENTATION");
const gaps = runBehaviors.filter(unit => unit.implementation_status === "REQUIRES_M7");
const byDomain = new Map();
for (const unit of gaps) {
  const cluster = byDomain.get(unit.domain) ?? [];
  cluster.push(unit.id);
  byDomain.set(unit.domain, cluster);
}
const provenance = {
  schema_version: 1,
  oracle_sha: input.oracleSha,
  oracle_tree_sha: oracleTreeSha,
};
writeJson(input.outputRoot, "game-system-catalog-v1.json", {
  ...provenance,
  source_file_count: files.length,
  behavior_count: output.behaviors.length,
  domain_counts: domainCounts,
  behaviors: output.behaviors,
  presentation_boundaries: presentationBoundaries,
});
writeJson(input.outputRoot, "run-behavior-unit-manifest-v1.json", {
  ...provenance,
  behavior_count: runBehaviors.length,
  behaviors: runBehaviors,
});
writeJson(input.outputRoot, "scenario-catalog-v1.json", {
  ...provenance,
  behavior_count: scenarioBehaviors.length,
  behaviors: scenarioBehaviors,
});
writeJson(input.outputRoot, "ai-policy-catalog-v1.json", {
  ...provenance,
  behavior_count: aiBehaviors.length,
  behaviors: aiBehaviors,
});
writeJson(input.outputRoot, "save-field-catalog-v1.json", {
  ...provenance,
  field_count: output.saveFields.length,
  fields: output.saveFields,
});
writeJson(input.outputRoot, "platform-boundary-manifest-v1.json", {
  ...provenance,
  boundary_count: platformBoundaries.length,
  boundaries: platformBoundaries,
});
writeJson(input.outputRoot, "m7-gap-clusters-v1.json", {
  ...provenance,
  gap_count: gaps.length,
  clusters: [...byDomain]
    .sort(([left], [right]) => compareText(left, right))
    .map(([domain, behavior_units]) => ({ domain, behavior_units })),
});
writeJson(input.outputRoot, "m7-oracle-witness-plan-v1.json", {
  ...provenance,
  witness_count: canonicalBehaviors.length,
  witnesses: canonicalBehaviors.map(unit => ({
    behavior_unit: unit.id,
    source: unit.source,
    positive_assertions: ["SOURCE_REACHED", "DETERMINISTIC_RESULT"],
    negative_assertions: ["NO_HIDDEN_RNG", "NO_PLATFORM_SEMANTICS"],
  })),
});
console.log(
  `M7 system catalog exporter: ${files.length} source files, ${output.behaviors.length} behaviors, ${runBehaviors.length} run behaviors, ${gaps.length} M7 gaps`,
);
