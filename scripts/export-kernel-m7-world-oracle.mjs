#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const requireFrom = process.env.M7_TYPESCRIPT_ROOT
  ? createRequire(resolve(process.env.M7_TYPESCRIPT_ROOT, "package.json"))
  : createRequire(import.meta.url);
const ts = requireFrom("typescript");

function fail(message) {
  throw new Error(`M7 world oracle: ${message}`);
}

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const oracleRoot = resolve(args.get("--oracle-root") ?? "");
const output = resolve(args.get("--output") ?? "");
const oracleSha = args.get("--oracle-sha");
if (!oracleRoot || !output || !oracleSha) fail("missing required arguments");
const head = execFileSync("git", ["-C", oracleRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== oracleSha) fail("oracle HEAD mismatch");

function source(path) {
  const absolute = resolve(oracleRoot, path);
  return ts.createSourceFile(
    absolute,
    readFileSync(absolute, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

const enums = new Map();
function loadEnum(path, enumName) {
  const file = source(path);
  let declaration;
  let object;
  file.forEachChild(node => {
    if (ts.isEnumDeclaration(node) && node.name.text === enumName) declaration = node;
    if (ts.isVariableStatement(node)) {
      for (const item of node.declarationList.declarations) {
        if (
          item.name.getText(file) === enumName
          && item.initializer
          && (ts.isObjectLiteralExpression(item.initializer)
            || (ts.isAsExpression(item.initializer)
              && ts.isObjectLiteralExpression(item.initializer.expression)))
        ) {
          object = ts.isAsExpression(item.initializer)
            ? item.initializer.expression
            : item.initializer;
        }
      }
    }
  });
  const values = new Map();
  if (object) {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isNumericLiteral(property.initializer)) {
        fail(`non-numeric ${enumName} property`);
      }
      values.set(property.name.getText(file), Number(property.initializer.text));
    }
  } else if (declaration) {
    let next = 0;
    for (const member of declaration.members) {
      const name = member.name.getText(file);
      if (member.initializer) {
        if (ts.isNumericLiteral(member.initializer)) {
          next = Number(member.initializer.text);
        } else if (
          ts.isPrefixUnaryExpression(member.initializer)
          && member.initializer.operator === ts.SyntaxKind.MinusToken
          && ts.isNumericLiteral(member.initializer.operand)
        ) {
          next = -Number(member.initializer.operand.text);
        } else {
          fail(`non-numeric ${enumName}.${name}`);
        }
      }
      values.set(name, next);
      next += 1;
    }
  } else {
    fail(`missing enum ${enumName}`);
  }
  enums.set(enumName, values);
}

loadEnum("src/enums/biome-id.ts", "BiomeId");
loadEnum("src/enums/weather-type.ts", "WeatherType");
loadEnum("src/data/terrain.ts", "TerrainType");
loadEnum("src/enums/pokemon-type.ts", "PokemonType");
loadEnum("src/enums/trainer-type.ts", "TrainerType");
loadEnum("src/enums/fixed-boss-waves.ts", "ClassicFixedBossWaves");

function evaluate(node, file) {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return -evaluate(node.operand, file);
  }
  if (ts.isBinaryExpression(node)) {
    const left = evaluate(node.left, file);
    const right = evaluate(node.right, file);
    if (node.operatorToken.kind === ts.SyntaxKind.SlashToken) return left / right;
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
    fail(`unsupported binary ${node.getText(file)}`);
  }
  if (ts.isPropertyAccessExpression(node)) {
    const owner = node.expression.getText(file);
    const values = enums.get(owner);
    if (!values?.has(node.name.text)) fail(`unknown enum ${node.getText(file)}`);
    return values.get(node.name.text);
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(value => evaluate(value, file));
  if (ts.isObjectLiteralExpression(node)) {
    const value = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) fail(`unsupported property ${property.getText(file)}`);
      const key = ts.isComputedPropertyName(property.name)
        ? String(evaluate(property.name.expression, file))
        : property.name.getText(file).replace(/^['"]|['"]$/gu, "");
      value[key] = evaluate(property.initializer, file);
    }
    return value;
  }
  fail(`unsupported expression ${node.getText(file)}`);
}

function variable(path, name) {
  const file = source(path);
  let initializer;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!initializer) fail(`missing variable ${name}`);
  return evaluate(initializer, file);
}

function identifierArray(path, name) {
  const file = source(path);
  let values;
  const visit = node => {
    if (
      ts.isVariableDeclaration(node)
      && node.name.getText(file) === name
      && node.initializer
      && ts.isArrayLiteralExpression(node.initializer)
    ) {
      values = node.initializer.elements.map(element => element.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!values) fail(`missing identifier array ${name}`);
  return values;
}

const encounters = variable(
  "src/data/elite-redux/er-biome-encounters.ts",
  "ER_BIOME_ENCOUNTERS",
);
const rules = variable("src/data/elite-redux/er-biome-rules.ts", "ER_BIOME_RULES");
const normalExtraRivals = variable(
  "src/data/elite-redux/er-battle-frequency.ts",
  "ER_EXTRA_RIVAL_WAVES",
);
const sprintExtraRivals = variable(
  "src/data/elite-redux/er-battle-frequency.ts",
  "ER_SPRINT_EXTRA_RIVAL_WAVES",
);
const normalCanonicalRivals = variable(
  "src/data/elite-redux/er-battle-frequency.ts",
  "ER_CANONICAL_RIVAL_WAVES",
);
const sprintCanonicalRivals = variable(
  "src/data/elite-redux/er-battle-frequency.ts",
  "ER_SPRINT_CANONICAL_RIVAL_WAVES",
);
const forcedBattleRules = Object.fromEntries(
  Object.entries(rules)
    .map(([biome, rule]) => [
      biome,
      {
        weather: rule.weather ?? null,
        terrain: rule.terrain ?? null,
      },
    ])
    .filter(([, rule]) => rule.weather !== null || rule.terrain !== null),
);

const registeredBiomes = identifierArray("src/init/init-biomes.ts", "rawAllBiomes");

const document = {
  schema_version: 1,
  oracle_sha: oracleSha,
  biome_encounters: encounters,
  forced_battle_rules: forcedBattleRules,
  rival_waves: {
    normal: { canonical: normalCanonicalRivals, extra: normalExtraRivals },
    sprint: { canonical: sprintCanonicalRivals, extra: sprintExtraRivals },
  },
  registered_biomes: registeredBiomes,
};
writeFileSync(output, `${JSON.stringify(document)}\n`);
console.log(`M7 world oracle: ${Object.keys(encounters).length} encounter profiles, ${Object.keys(rules).length} battle rules`);
