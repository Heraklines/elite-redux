#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requireFrom = process.env.M5_TYPESCRIPT_ROOT
  ? createRequire(resolve(process.env.M5_TYPESCRIPT_ROOT, "package.json"))
  : createRequire(import.meta.url);
const ts = requireFrom("typescript");
const CATALOG_SCHEMA_VERSION = 1;
const ENUM_CATALOGS = new Map([
  ["MoveId", "moves"],
  ["ErMoveId", "moves"],
  ["AbilityId", "abilities"],
  ["ErAbilityId", "abilities"],
  ["StatusEffect", "statuses"],
  ["WeatherType", "weather"],
  ["TerrainType", "terrain"],
  ["BattlerTagType", "battler_tags"],
  ["ArenaTagType", "arena_tags"],
  ["PositionalTagType", "positional_tags"],
]);
const RNG_CALL_NAMES = new Set([
  "integerInRange",
  "randBattleSeedInt",
  "randSeedInt",
  "randSeedItem",
  "randSeedShuffle",
  "random",
  "realInRange",
]);
const DISPATCH_CALL_NAMES = new Set([
  "applyAbAttrs",
  "applyFilteredAbAttrs",
  "applyMoveAttrs",
  "applyFilteredMoveAttrs",
  "applyModifiers",
  "applyModifier",
  "applyArenaTags",
  "applyBattlerTags",
]);
const MECHANICS_ROOTS = [
  "src/data/abilities",
  "src/data/arena-tag.ts",
  "src/data/battler-tags.ts",
  "src/data/damage-nullification.ts",
  "src/data/elite-redux",
  "src/data/moves",
  "src/data/positional-tags",
  "src/data/status-effect.ts",
  "src/data/terrain.ts",
  "src/data/weather.ts",
  "src/data/trainers",
  "src/field",
  "src/modifier",
];

function fail(message) {
  console.error(`M5 source catalog exporter: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    fail(`git ${args.join(" ")} failed in ${root}: ${result.error?.message ?? result.stderr ?? result.status}`);
  }
  return result.stdout.trim();
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("usage: node scripts/export-kernel-m5-source-catalog.mjs --oracle-root <absolute-directory> --oracle-sha <40-hex> --output <absolute-json-path>");
    }
    values.set(key, value);
  }
  if (values.size !== 3 || !values.has("--oracle-root") || !values.has("--oracle-sha") || !values.has("--output")) {
    fail("usage: node scripts/export-kernel-m5-source-catalog.mjs --oracle-root <absolute-directory> --oracle-sha <40-hex> --output <absolute-json-path>");
  }
  const oracleRoot = resolve(values.get("--oracle-root"));
  const oracleSha = values.get("--oracle-sha");
  const output = resolve(values.get("--output"));
  if (!isAbsolute(values.get("--oracle-root")) || !isAbsolute(values.get("--output"))) {
    fail("--oracle-root and --output must be absolute");
  }
  if (!/^[0-9a-f]{40}$/u.test(oracleSha)) {
    fail("--oracle-sha must be lowercase 40-hex");
  }
  if (!statSync(oracleRoot).isDirectory()) {
    fail("--oracle-root must name a directory");
  }
  return { oracleRoot, oracleSha, output };
}

function isWithin(root, path) {
  const pathFromRoot = relative(realpathSync(root), resolve(path));
  return pathFromRoot === "" || (!isAbsolute(pathFromRoot) && !pathFromRoot.startsWith(".."));
}

function assertInputs({ oracleRoot, oracleSha, output }) {
  const actualSha = git(oracleRoot, "rev-parse", "HEAD");
  if (actualSha !== oracleSha) {
    fail(`oracle checkout HEAD ${actualSha} does not match ${oracleSha}`);
  }
  if (git(oracleRoot, "status", "--porcelain", "--untracked-files=all") !== "") {
    fail("oracle checkout must be clean");
  }
  if (isWithin(oracleRoot, output) || isWithin(REPO_ROOT, output)) {
    fail("--output must be outside both the oracle checkout and exporter checkout");
  }
  for (const required of ["src/enums/move-id.ts", "src/enums/ability-id.ts", "src/data/moves/move.ts"]) {
    if (!existsSync(resolve(oracleRoot, required))) {
      fail(`oracle checkout is missing ${required}`);
    }
  }
}

function canonicalize(value, path = "$") {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      fail(`catalog contains non-safe integer at ${path}`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalize(entry, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) {
        fail(`catalog contains undefined at ${path}.${key}`);
      }
      result[key] = canonicalize(value[key], `${path}.${key}`);
    }
    return result;
  }
  fail(`catalog contains unsupported value at ${path}`);
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalize(value))}\n`, "utf8");
}

function normalizedPath(root, path) {
  return relative(root, path).replaceAll("\\", "/");
}

function location(sourceFile, node, oracleRoot) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    path: normalizedPath(oracleRoot, sourceFile.fileName),
    line: position.line + 1,
    column: position.character + 1,
  };
}

function nodeName(node, sourceFile) {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
    return node.text;
  }
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return node.getText(sourceFile);
}

function enumReference(expression) {
  if (!expression || !ts.isPropertyAccessExpression(expression) || !ts.isIdentifier(expression.expression)) {
    return null;
  }
  const catalog = ENUM_CATALOGS.get(expression.expression.text);
  if (!catalog) {
    return null;
  }
  return { catalog, enum_name: expression.expression.text, member: expression.name.text };
}

function evaluateEnumExpression(expression, values, sourceFile) {
  if (ts.isNumericLiteral(expression)) {
    const value = Number(expression.text);
    return Number.isSafeInteger(value) ? value : null;
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    const operand = evaluateEnumExpression(expression.operand, values, sourceFile);
    if (operand === null) {
      return null;
    }
    if (expression.operator === ts.SyntaxKind.MinusToken) {
      return -operand;
    }
    if (expression.operator === ts.SyntaxKind.PlusToken) {
      return operand;
    }
    return null;
  }
  if (ts.isIdentifier(expression)) {
    return values.get(expression.text) ?? null;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return values.get(expression.name.text) ?? null;
  }
  if (ts.isBinaryExpression(expression)) {
    const left = evaluateEnumExpression(expression.left, values, sourceFile);
    const right = evaluateEnumExpression(expression.right, values, sourceFile);
    if (left === null || right === null) {
      return null;
    }
    switch (expression.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken:
        return left + right;
      case ts.SyntaxKind.MinusToken:
        return left - right;
      case ts.SyntaxKind.AsteriskToken:
        return left * right;
      case ts.SyntaxKind.SlashToken:
        return right === 0 ? null : left / right;
      case ts.SyntaxKind.LessThanLessThanToken:
        return left << right;
      case ts.SyntaxKind.BarToken:
        return left | right;
      default:
        return null;
    }
  }
  void sourceFile;
  return null;
}

function catalogEnums(sourceFile, oracleRoot, output) {
  for (const statement of sourceFile.statements) {
    if (!ts.isEnumDeclaration(statement)) {
      continue;
    }
    const catalogName = ENUM_CATALOGS.get(statement.name.text);
    if (!catalogName) {
      continue;
    }
    const values = new Map();
    let previous = -1;
    statement.members.forEach((member, ordinal) => {
      const name = nodeName(member.name, sourceFile);
      let value = member.initializer ? evaluateEnumExpression(member.initializer, values, sourceFile) : previous + 1;
      if (!Number.isSafeInteger(value)) {
        value = null;
      }
      if (value !== null) {
        values.set(name, value);
        previous = value;
      }
      output[catalogName].push({
        enum_name: statement.name.text,
        member: name,
        numeric_id: value,
        initializer: member.initializer?.getText(sourceFile) ?? null,
        ordinal,
        source: location(sourceFile, member, oracleRoot),
      });
    });
  }
}

function heritageName(node, sourceFile) {
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types.length > 0) {
      return clause.types[0].expression.getText(sourceFile);
    }
  }
  return null;
}

function classFamily(name, path) {
  if (name.endsWith("AbAttr") || path.includes("/abilities/")) {
    return "ABILITY_ATTRIBUTE";
  }
  if (name.endsWith("MoveAttr") || path.includes("/moves/")) {
    return "MOVE_ATTRIBUTE";
  }
  if (name.endsWith("Modifier") || name.endsWith("ModifierType") || path.includes("/modifier/")) {
    return "MODIFIER";
  }
  if (name.endsWith("BattlerTag") || path.endsWith("/battler-tags.ts")) {
    return "BATTLER_TAG";
  }
  if (name.endsWith("ArenaTag") || path.endsWith("/arena-tag.ts")) {
    return "ARENA_TAG";
  }
  if (name.endsWith("PositionalTag") || path.includes("/positional-tags/")) {
    return "POSITIONAL_TAG";
  }
  return "OTHER_MECHANIC";
}

function catalogClass(sourceFile, node, oracleRoot, output) {
  if (!node.name) {
    return;
  }
  const name = node.name.text;
  const path = normalizedPath(oracleRoot, sourceFile.fileName);
  const base = heritageName(node, sourceFile);
  const mechanicLike = /(?:AbAttr|MoveAttr|Modifier|ModifierType|BattlerTag|ArenaTag|PositionalTag)$/u.test(name)
    || /(?:^|\/)(?:abilities|moves|modifier|positional-tags)(?:\/|$)/u.test(path);
  if (!mechanicLike) {
    return;
  }
  const methods = node.members
    .filter(ts.isMethodDeclaration)
    .map(method => nodeName(method.name, sourceFile))
    .sort();
  output.mechanic_classes.push({
    name,
    base,
    family: classFamily(name, path),
    abstract: node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AbstractKeyword) ?? false,
    methods,
    source: location(sourceFile, node, oracleRoot),
  });
}

function catalogNewExpression(sourceFile, node, oracleRoot, output) {
  const reference = enumReference(node.arguments?.[0]);
  if (!reference || (reference.catalog !== "moves" && reference.catalog !== "abilities")) {
    return;
  }
  output.registrations.push({
    catalog: reference.catalog,
    enum_name: reference.enum_name,
    member: reference.member,
    constructor: node.expression.getText(sourceFile),
    source: location(sourceFile, node, oracleRoot),
  });
}

function catalogAttributeAttachment(sourceFile, node, oracleRoot, output) {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return;
  }
  const method = node.expression.name.text;
  if (method !== "attr" && method !== "conditionalAttr") {
    return;
  }
  const attributeIndex = method === "conditionalAttr" ? 1 : 0;
  const attribute = node.arguments[attributeIndex];
  if (!attribute) {
    return;
  }
  output.attribute_attachments.push({
    method,
    attribute: attribute.getText(sourceFile),
    argument_count: Math.max(0, node.arguments.length - attributeIndex - 1),
    source: location(sourceFile, node, oracleRoot),
  });
}
function callName(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return null;
}

function catalogDispatchAndRngSite(sourceFile, node, oracleRoot, output) {
  const name = callName(node.expression);
  if (!name) {
    return;
  }
  if (RNG_CALL_NAMES.has(name)) {
    output.rng_sites.push({
      call: node.expression.getText(sourceFile),
      arguments: node.arguments.map(argument => argument.getText(sourceFile)),
      source: location(sourceFile, node, oracleRoot),
    });
  }
  if (DISPATCH_CALL_NAMES.has(name)) {
    const first = node.arguments[0];
    output.dispatch_sites.push({
      call: node.expression.getText(sourceFile),
      hook: first && ts.isStringLiteralLike(first) ? first.text : null,
      arguments: node.arguments.length,
      source: location(sourceFile, node, oracleRoot),
    });
  }
}

function unwrapObjectLiteral(initializer) {
  if (ts.isObjectLiteralExpression(initializer)) {
    return initializer;
  }
  if (
    ts.isCallExpression(initializer)
    && ts.isPropertyAccessExpression(initializer.expression)
    && initializer.expression.expression.getText() === "Object"
    && initializer.expression.name.text === "freeze"
    && initializer.arguments.length === 1
    && ts.isObjectLiteralExpression(initializer.arguments[0])
  ) {
    return initializer.arguments[0];
  }
  return null;
}

function catalogModifierRegistry(sourceFile, node, oracleRoot, output) {
  if (!ts.isIdentifier(node.name) || node.name.text !== "modifierTypeInitObj" || !node.initializer) {
    return;
  }
  const object = unwrapObjectLiteral(node.initializer);
  if (!object) {
    fail(`modifierTypeInitObj is not a static object at ${normalizedPath(oracleRoot, sourceFile.fileName)}`);
  }
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isMethodDeclaration(property) && !ts.isShorthandPropertyAssignment(property)) {
      fail(`unsupported modifierTypeInitObj member ${property.getText(sourceFile)}`);
    }
    output.modifier_types.push({
      key: nodeName(property.name, sourceFile),
      initializer: ts.isPropertyAssignment(property) ? property.initializer.getText(sourceFile) : property.getText(sourceFile),
      source: location(sourceFile, property, oracleRoot),
    });
  }
}

function visitSourceFile(sourceFile, oracleRoot, output) {
  catalogEnums(sourceFile, oracleRoot, output);
  const visit = node => {
    if (ts.isClassDeclaration(node)) {
      catalogClass(sourceFile, node, oracleRoot, output);
    } else if (ts.isNewExpression(node)) {
      catalogNewExpression(sourceFile, node, oracleRoot, output);
    } else if (ts.isCallExpression(node)) {
      catalogAttributeAttachment(sourceFile, node, oracleRoot, output);
      catalogDispatchAndRngSite(sourceFile, node, oracleRoot, output);
    } else if (ts.isVariableDeclaration(node)) {
      catalogModifierRegistry(sourceFile, node, oracleRoot, output);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function sourceFiles(oracleRoot) {
  const enumFiles = ts.sys.readDirectory(resolve(oracleRoot, "src/enums"), [".ts"], undefined, undefined);
  const mechanicsFiles = MECHANICS_ROOTS.flatMap(root => {
    const path = resolve(oracleRoot, root);
    if (!existsSync(path)) {
      return [];
    }
    return statSync(path).isDirectory() ? ts.sys.readDirectory(path, [".ts"], undefined, undefined) : [path];
  });
  return [...new Set([...enumFiles, ...mechanicsFiles])].sort((left, right) => normalizedPath(oracleRoot, left).localeCompare(normalizedPath(oracleRoot, right), "en"));
}

function sortCatalog(output) {
  const byEnum = (left, right) => left.enum_name.localeCompare(right.enum_name, "en") || left.ordinal - right.ordinal;
  for (const key of ["moves", "abilities", "statuses", "weather", "terrain", "battler_tags", "arena_tags", "positional_tags"]) {
    output[key].sort(byEnum);
  }
  output.modifier_types.sort((left, right) => left.key.localeCompare(right.key, "en"));
  output.mechanic_classes.sort((left, right) => left.family.localeCompare(right.family, "en") || left.name.localeCompare(right.name, "en") || left.source.path.localeCompare(right.source.path, "en") || left.source.line - right.source.line);
  output.registrations.sort((left, right) => left.catalog.localeCompare(right.catalog, "en") || left.enum_name.localeCompare(right.enum_name, "en") || left.member.localeCompare(right.member, "en") || left.source.path.localeCompare(right.source.path, "en") || left.source.line - right.source.line);
  output.attribute_attachments.sort((left, right) => left.attribute.localeCompare(right.attribute, "en") || left.source.path.localeCompare(right.source.path, "en") || left.source.line - right.source.line);
  output.dispatch_sites.sort((left, right) => (left.hook ?? "").localeCompare(right.hook ?? "", "en") || left.call.localeCompare(right.call, "en") || left.source.path.localeCompare(right.source.path, "en") || left.source.line - right.source.line);
  output.rng_sites.sort((left, right) => left.call.localeCompare(right.call, "en") || left.source.path.localeCompare(right.source.path, "en") || left.source.line - right.source.line);
  output.source_files.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

const args = parseArgs(process.argv.slice(2));
assertInputs(args);
const files = sourceFiles(args.oracleRoot);
const output = {
  schema_version: CATALOG_SCHEMA_VERSION,
  oracle_sha: args.oracleSha,
  oracle_tree_sha: git(args.oracleRoot, "rev-parse", `${args.oracleSha}^{tree}`),
  moves: [],
  abilities: [],
  modifier_types: [],
  statuses: [],
  weather: [],
  terrain: [],
  battler_tags: [],
  arena_tags: [],
  positional_tags: [],
  mechanic_classes: [],
  registrations: [],
  attribute_attachments: [],
  dispatch_sites: [],
  rng_sites: [],
  source_files: [],
};
for (const file of files) {
  const bytes = readFileSync(file);
  const sourceFile = ts.createSourceFile(file, bytes.toString("utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) {
    const first = sourceFile.parseDiagnostics[0];
    fail(`TypeScript parse failure in ${normalizedPath(args.oracleRoot, file)} at ${first.start ?? 0}: ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`);
  }
  visitSourceFile(sourceFile, args.oracleRoot, output);
  output.source_files.push({
    path: normalizedPath(args.oracleRoot, file),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
sortCatalog(output);
mkdirSync(dirname(args.output), { recursive: true });
writeFileSync(args.output, canonicalBytes(output));
console.log(`M5 source catalog exporter: wrote ${files.length} source files, ${output.moves.length} moves, ${output.abilities.length} abilities, ${output.modifier_types.length} modifier types, and ${output.mechanic_classes.length} mechanic classes to ${args.output}`);
