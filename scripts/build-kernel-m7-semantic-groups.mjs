#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";

const requireFrom = process.env.M7_TYPESCRIPT_ROOT
  ? createRequire(resolve(process.env.M7_TYPESCRIPT_ROOT, "package.json"))
  : createRequire(import.meta.url);
const ts = requireFrom("typescript");
const ROOT = resolve(import.meta.dirname, "..");

function fail(message) {
  throw new Error(`M7 semantic groups: ${message}`);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("arguments must be --name value pairs");
    }
    values.set(key, value);
  }
  const oracleRoot = resolve(values.get("--oracle-root") ?? "");
  const catalogPath = resolve(
    values.get("--catalog") ?? resolve(ROOT, "rust/fixtures/m7/game-system-catalog-v1.json"),
  );
  const implementationPath = resolve(
    values.get("--implementation")
      ?? resolve(ROOT, "rust/fixtures/m7/m7-behavior-implementation-v1.json"),
  );
  const outputRoot = resolve(values.get("--output-root") ?? resolve(ROOT, "rust/fixtures/m7"));
  if (!values.has("--oracle-root")) {
    fail("missing --oracle-root");
  }
  return { oracleRoot, catalogPath, implementationPath, outputRoot };
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

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(canonicalize(value))}\n`);
}

function normalizedPath(root, path) {
  return relative(root, path).replaceAll("\\", "/");
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
    const call = ts.isPropertyAccessExpression(expression)
      ? expression.name.text
      : astText(expression, sourceFile);
    return `${call}[${parent.arguments.indexOf(node)}]`;
  }
  return "anonymous";
}

function ownerName(node, sourceFile) {
  let current = node.parent;
  while (current) {
    if (
      (ts.isClassDeclaration(current)
        || ts.isInterfaceDeclaration(current)
        || ts.isTypeAliasDeclaration(current))
      && current.name
    ) {
      return astText(current.name, sourceFile);
    }
    current = current.parent;
  }
  return null;
}

function declarationKind(node) {
  if (ts.isFunctionDeclaration(node)) return "FUNCTION";
  if (ts.isMethodDeclaration(node)) return "METHOD";
  if (ts.isConstructorDeclaration(node)) return "CONSTRUCTOR";
  if (ts.isGetAccessorDeclaration(node)) return "GETTER";
  if (ts.isSetAccessorDeclaration(node)) return "SETTER";
  if (ts.isArrowFunction(node)) return "ARROW_CALLBACK";
  if (ts.isFunctionExpression(node)) return "FUNCTION_CALLBACK";
  return null;
}

function sourceKey(source, kind, owner, symbol) {
  return [source.path, source.line, source.column, kind, owner ?? "", symbol].join("\0");
}

function groupId(domain, rootId, memberIds) {
  return `m7g-${createHash("sha256")
    .update(`${domain}\0${rootId}\0${memberIds.join("\0")}`)
    .digest("hex")}`;
}

const input = parseArgs(process.argv.slice(2));
const catalog = JSON.parse(readFileSync(input.catalogPath, "utf8"));
const implementation = JSON.parse(readFileSync(input.implementationPath, "utf8"));
if (git(input.oracleRoot, "rev-parse", "HEAD") !== catalog.oracle_sha) {
  fail("oracle worktree HEAD differs from catalog oracle_sha");
}
const runUnits = catalog.behaviors.filter(unit =>
  !["BATTLE", "PLATFORM", "PRESENTATION", "M6_PROTOCOL"].includes(unit.domain),
);
const unitsByKey = new Map(
  runUnits.map(unit => [
    sourceKey(unit.source, unit.declaration_kind, unit.owner, unit.symbol),
    unit,
  ]),
);
const unitById = new Map(runUnits.map(unit => [unit.id, unit]));
const assigned = new Map();
const groupMembers = new Map();
const roots = new Map();
const dependencyRoots = new Map();
const ownerRoots = new Map();

for (const file of catalog.behaviors
  .map(unit => unit.source.path)
  .filter((path, index, paths) => paths.indexOf(path) === index)
  .sort(compareText)) {
  const absolute = resolve(input.oracleRoot, file);
  const bytes = readFileSync(absolute, "utf8");
  const sourceFile = ts.createSourceFile(
    absolute,
    bytes,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    fail(`TypeScript parse failure in ${file}`);
  }
  const stack = [];
  const visit = node => {
    const kind = declarationKind(node);
    let pushed = false;
    if (kind) {
      const point = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const source = { path: file, line: point.line + 1, column: point.character + 1 };
      const symbol = declarationName(node, sourceFile);
      const owner = ownerName(node, sourceFile);
      const unit = unitsByKey.get(sourceKey(source, kind, owner, symbol));
      if (unit) {
        const parent = stack.at(-1) ?? null;
        const parentRoot = parent ? unitById.get(parent.root) : null;
        const ownerKey = unit.owner ? `${unit.source.path}\0${unit.owner}\0${unit.domain}` : null;
        let root;
        if (parentRoot && parentRoot.domain === unit.domain) {
          root = parent.root;
        } else if (ownerKey) {
          root = ownerRoots.get(ownerKey) ?? unit.id;
          ownerRoots.set(ownerKey, root);
        } else {
          root = unit.id;
        }
        stack.push({ id: unit.id, root });
        pushed = true;
        assigned.set(unit.id, root);
        if (!groupMembers.has(root)) groupMembers.set(root, []);
        groupMembers.get(root).push(unit.id);
        if (root === unit.id) roots.set(root, unit.id);
        if (parent && parent.root !== root) {
          if (!dependencyRoots.has(parent.root)) dependencyRoots.set(parent.root, new Set());
          dependencyRoots.get(parent.root).add(root);
        }
      }
    }
    ts.forEachChild(node, visit);
    if (pushed) stack.pop();
  };
  visit(sourceFile);
}

for (const unit of runUnits) {
  if (!assigned.has(unit.id)) {
    fail(`behavior ${unit.id} was not recovered from the pinned oracle AST`);
  }
}
if (assigned.size !== runUnits.length) {
  fail("semantic assignment count differs from run behavior count");
}

const implementationById = new Map(
  implementation.implementations.map(entry => [entry.behavior_unit, entry]),
);
const groups = [...groupMembers.entries()].map(([rootId, memberIds]) => {
  memberIds.sort(compareText);
  const root = unitById.get(roots.get(rootId));
  if (!root) fail(`semantic root ${rootId} is absent from the run catalog`);
  const members = memberIds.map(id => unitById.get(id));
  if (members.some(unit => unit.domain !== root.domain)) {
    fail(`semantic group rooted at ${rootId} crosses behavior domains`);
  }
  const implemented = memberIds.filter(id => implementationById.has(id));
  const rootBehaviorIds = memberIds.filter(id => {
    const kind = unitById.get(id).declaration_kind;
    return kind !== "ARROW_CALLBACK" && kind !== "FUNCTION_CALLBACK";
  });
  if (rootBehaviorIds.length === 0) rootBehaviorIds.push(rootId);
  rootBehaviorIds.sort(compareText);
  const proofTests = [...new Set(
    implemented.map(id => implementationById.get(id).proof.test),
  )].sort(compareText);
  const implementationKind = implemented.length === 0
    ? "UNPLANNED"
    : implemented.length === memberIds.length
      ? "BESPOKE_RUST"
      : "PARTIAL_EXISTING";
  return {
    group_id: groupId(root.domain, rootId, memberIds),
    domain: root.domain,
    root_behaviors: rootBehaviorIds,
    helper_behaviors: memberIds.filter(id => !rootBehaviorIds.includes(id)),
    source_files: [root.source.path],
    semantic_owner: root.owner
      ? `${root.source.path}::${root.owner}`
      : `${root.source.path}::${root.symbol}`,
    implementation_kind: implementationKind,
    dependencies: [...(dependencyRoots.get(rootId) ?? [])]
      .map(dependencyRoot => {
        const dependency = unitById.get(dependencyRoot);
        const dependencyMembers = [...(groupMembers.get(dependencyRoot) ?? [])].sort(compareText);
        if (!dependency || dependencyMembers.length === 0) {
          fail(`semantic dependency ${dependencyRoot} is unresolved`);
        }
        return groupId(dependency.domain, dependencyRoot, dependencyMembers);
      })
      .sort(compareText),
    required_positive_witnesses: ["SOURCE_REACHED", "DETERMINISTIC_RESULT"],
    required_negative_witnesses: ["NO_HIDDEN_RNG", "NO_PLATFORM_SEMANTICS"],
    existing_proof_tests: proofTests,
  };
});
groups.sort((left, right) => compareText(left.group_id, right.group_id));
const groupedIds = groups.flatMap(group => [...group.root_behaviors, ...group.helper_behaviors]);
if (new Set(groupedIds).size !== groupedIds.length || groupedIds.length !== runUnits.length) {
  fail("semantic group union is not an exact partition of the run catalog");
}

const domains = [...new Set(runUnits.map(unit => unit.domain))].sort(compareText);
const closure = domains.map(domain => {
  const requiredIds = runUnits.filter(unit => unit.domain === domain).map(unit => unit.id);
  const implementedIds = requiredIds.filter(id => implementationById.has(id));
  return {
    domain,
    required_behaviors: requiredIds.length,
    implemented_behaviors: implementedIds.length,
    unresolved_behaviors: requiredIds.length - implementedIds.length,
    semantic_groups: groups.filter(group => group.domain === domain).length,
    closed: implementedIds.length === requiredIds.length,
  };
});
const provenance = {
  schema_version: 1,
  oracle_sha: catalog.oracle_sha,
  oracle_tree_sha: catalog.oracle_tree_sha,
};
writeJson(resolve(input.outputRoot, "m7-semantic-groups-v1.json"), {
  ...provenance,
  behavior_count: runUnits.length,
  group_count: groups.length,
  groups,
});
writeJson(resolve(input.outputRoot, "m7-domain-closure-v1.json"), {
  ...provenance,
  required_behavior_count: runUnits.length,
  implemented_behavior_count: implementation.implementation_count,
  unresolved_behavior_count: runUnits.length - implementation.implementation_count,
  domains: closure,
});
console.log(
  `M7 semantic groups: ${runUnits.length} behaviors in ${groups.length} groups; ${implementation.implementation_count} implemented`,
);
