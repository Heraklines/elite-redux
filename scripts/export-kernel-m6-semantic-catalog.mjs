#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requireFrom = process.env.M6_TYPESCRIPT_ROOT
  ? createRequire(resolve(process.env.M6_TYPESCRIPT_ROOT, "package.json"))
  : createRequire(import.meta.url);
const ts = requireFrom("typescript");

const SOURCE_KIND_ORDER = [
  "MOVE",
  "ACTIVE_ABILITY",
  "PASSIVE_ABILITY",
  "HELD_ITEM",
  "MAJOR_STATUS",
  "VOLATILE_STATUS",
  "WEATHER",
  "TERRAIN",
  "SIDE_CONDITION",
  "ARENA_TAG",
  "BATTLER_TAG",
  "POSITIONAL_TAG",
  "SPECIES",
  "FORM",
  "BESPOKE",
];
const BEHAVIOR_KIND_ORDER = [
  "INTRINSIC_MOVE_RULE",
  "MOVE_ATTRIBUTE",
  "CONDITIONAL_MOVE_ATTRIBUTE",
  "ABILITY_ATTRIBUTE",
  "PASSIVE_ATTRIBUTE",
  "MODIFIER_BEHAVIOR",
  "STATUS_BEHAVIOR",
  "WEATHER_BEHAVIOR",
  "TERRAIN_BEHAVIOR",
  "BATTLER_TAG_BEHAVIOR",
  "ARENA_TAG_BEHAVIOR",
  "POSITIONAL_TAG_BEHAVIOR",
  "FIXED_DISPATCH_BEHAVIOR",
  "SPECIES_FORM_BEHAVIOR",
];

function fail(message) {
  throw new Error(`M6 semantic exporter: ${message}`);
}

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) fail(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] == null) fail("invalid arguments");
    values.set(argv[index], argv[index + 1]);
  }
  for (const key of ["--oracle-root", "--oracle-sha", "--raw-catalog", "--output-root"]) {
    if (!values.has(key)) fail(`missing ${key}`);
  }
  const outputRoot = resolve(values.get("--output-root"));
  if (!isAbsolute(values.get("--oracle-root")) || !isAbsolute(values.get("--raw-catalog")) || !isAbsolute(outputRoot)) {
    fail("paths must be absolute");
  }
  return {
    oracleRoot: resolve(values.get("--oracle-root")),
    oracleSha: values.get("--oracle-sha"),
    rawCatalog: resolve(values.get("--raw-catalog")),
    outputRoot,
  };
}

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(canonical);
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = canonical(value[key]);
  return output;
}

function canonicalText(value) {
  return JSON.stringify(canonical(value));
}

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalText(value)).digest("hex");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function writeJson(root, name, value) {
  const path = resolve(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${canonicalText(value)}\n`);
}

function sourceLocation(sourceFile, node, oracleRoot) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    path: relative(oracleRoot, sourceFile.fileName).replaceAll("\\", "/"),
    line: position.line + 1,
    column: position.character + 1,
  };
}

function sourceIdentity(kind, numericId = null, registryKey = null) {
  return { kind, numeric_id: numericId, registry_key: registryKey };
}

function identityKey(source) {
  return `${source.kind}:${source.numeric_id ?? ""}:${source.registry_key ?? ""}`;
}

function reference(node) {
  if (!node) return null;
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const owner = node.expression.text;
    const kind = owner === "MoveId" || owner === "ErMoveId" ? "MOVE"
      : owner === "AbilityId" || owner === "ErAbilityId" ? "ABILITY"
      : null;
    if (kind) return { kind, owner, member: node.name.text };
  }
  let found = null;
  ts.forEachChild(node, child => {
    if (found == null) found = reference(child);
  });
  return found;
}

function operand(node, sourceFile) {
  if (ts.isNumericLiteral(node)) return { kind: "INTEGER", value: Number(node.text) };
  if (ts.isStringLiteralLike(node)) return { kind: "STRING", value: node.text };
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: "BOOLEAN", value: node.kind === ts.SyntaxKind.TrueKeyword };
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: "NULL" };
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    const value = Number(node.operand.text);
    return { kind: "INTEGER", value: node.operator === ts.SyntaxKind.MinusToken ? -value : value };
  }
  if (ts.isPropertyAccessExpression(node)) {
    return { kind: "ENUM", owner: node.expression.getText(sourceFile), member: node.name.text };
  }
  if (ts.isArrayLiteralExpression(node)) {
    return { kind: "ARRAY", values: node.elements.map(value => operand(value, sourceFile)) };
  }
  if (ts.isObjectLiteralExpression(node)) {
    const entries = [];
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) return callbackOperand(node, sourceFile);
      entries.push({ key: property.name.getText(sourceFile), value: operand(property.initializer, sourceFile) });
    }
    return { kind: "OBJECT", entries };
  }
  return callbackOperand(node, sourceFile);
}

function callbackOperand(node, sourceFile) {
  const location = sourceLocation(sourceFile, node, input.oracleRoot);
  return {
    kind: "CALLBACK_PROVENANCE",
    syntax_kind: ts.SyntaxKind[node.kind],
    provenance_hash: hash(`${location.path}:${location.line}:${location.column}:${node.getText(sourceFile)}`),
    source: location,
  };
}

function inferHook(attribute) {
  const value = attribute.toUpperCase();
  if (value.includes("POSTSUMMON") || value.includes("SWITCHIN")) return "AFTER_SUMMON";
  if (value.includes("PRESWITCH") || value.includes("LEAVEFIELD")) return "BEFORE_SWITCH_OUT";
  if (value.includes("POSTATTACK") || value.includes("AFTERMOVE")) return "AFTER_MOVE";
  if (value.includes("PREATTACK") || value.includes("MOVEPOWER") || value.includes("VARIABLEPOWER")) return "MOVE_POWER_QUERY";
  if (value.includes("PREDEFEND") || value.includes("DAMAGE")) return "DAMAGE_QUERY";
  if (value.includes("ACCURACY") || value.includes("ALWAYSHIT")) return "ACCURACY_QUERY";
  if (value.includes("CRIT")) return "CRITICAL_QUERY";
  if (value.includes("PRIORITY")) return "PRIORITY_QUERY";
  if (value.includes("STAT")) return "STAT_QUERY_OR_CHANGE";
  if (value.includes("STATUS")) return "STATUS_CHANGED";
  if (value.includes("FAINT") || value.includes("KNOCKOUT")) return "AFTER_FAINT";
  if (value.includes("TURN")) return "TURN_END";
  if (value.includes("WEATHER")) return "WEATHER_CHANGED";
  if (value.includes("TERRAIN")) return "TERRAIN_CHANGED";
  return "UNRESOLVED_HOOK";
}

function inferEffect(attribute) {
  const value = attribute.toUpperCase();
  if (value.includes("DAMAGE")) return "MODIFY_OR_APPLY_DAMAGE";
  if (value.includes("STATUS")) return "APPLY_OR_BLOCK_STATUS";
  if (value.includes("STAT")) return "MODIFY_STAT_OR_STAGE";
  if (value.includes("TYPE")) return "MODIFY_TYPE";
  if (value.includes("TARGET") || value.includes("REDIRECT")) return "MODIFY_TARGET";
  if (value.includes("SWITCH")) return "SWITCH_OR_TRAP";
  if (value.includes("TAG")) return "MODIFY_TAG";
  if (value.includes("WEATHER")) return "MODIFY_WEATHER";
  if (value.includes("TERRAIN")) return "MODIFY_TERRAIN";
  if (value.includes("HEAL")) return "HEAL";
  return "UNRESOLVED_EFFECT";
}

function callbackPresent(operands) {
  return operands.some(value => value.kind === "CALLBACK_PROVENANCE"
    || value.kind === "ARRAY" && callbackPresent(value.values)
    || value.kind === "OBJECT" && callbackPresent(value.entries.map(entry => entry.value)));
}

function enumMembers(path, enumName) {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = file.statements.find(statement => ts.isEnumDeclaration(statement) && statement.name.text === enumName);
  if (!declaration) return [];
  let next = 0;
  return declaration.members.map((member, ordinal) => {
    let id = next;
    if (member.initializer && ts.isNumericLiteral(member.initializer)) id = Number(member.initializer.text);
    const key = member.name.getText(file).replace(/^['"]|['"]$/gu, "");
    if (member.initializer && ts.isStringLiteralLike(member.initializer)) id = member.initializer.text;
    if (typeof id === "number") next = id + 1;
    return { id, key, ordinal, source: sourceLocation(file, member, input.oracleRoot) };
  });
}

const input = parseArgs(process.argv.slice(2));
if (!/^[0-9a-f]{40}$/u.test(input.oracleSha)) fail("oracle SHA is invalid");
if (!statSync(input.oracleRoot).isDirectory() || git(input.oracleRoot, "rev-parse", "HEAD") !== input.oracleSha) {
  fail("oracle checkout mismatch");
}
if (git(input.oracleRoot, "status", "--porcelain", "--untracked-files=all") !== "") fail("oracle checkout must be clean");
if (existsSync(input.outputRoot) && !statSync(input.outputRoot).isDirectory()) fail("output root is not a directory");
mkdirSync(input.outputRoot, { recursive: true });
const raw = JSON.parse(readFileSync(input.rawCatalog, "utf8"));
if (raw.schema_version !== 1 || raw.oracle_sha !== input.oracleSha) fail("raw catalog mismatch");

const memberIds = new Map();
for (const kind of ["moves", "abilities"]) {
  for (const entry of raw[kind]) memberIds.set(`${entry.enum_name}/${entry.member}`, entry.numeric_id);
}
const units = [];
const ordinals = new Map();
function addUnit(source, unitKind, provenance, semantic) {
  const ordinalKey = `${identityKey(source)}:${unitKind}`;
  const ordinal = ordinals.get(ordinalKey) ?? 0;
  ordinals.set(ordinalKey, ordinal + 1);
  const id = {
    source,
    unit_kind: unitKind,
    ordinal,
    provenance_hash: hash(provenance),
  };
  units.push({ id, provenance, semantic });
}

function addIntrinsic(kind, entries, unitKind, registry = false) {
  for (const entry of entries) {
    const source = registry || entry.numeric_id == null
      ? sourceIdentity(kind, null, entry.key ?? entry.member)
      : sourceIdentity(kind, entry.numeric_id, null);
    addUnit(source, unitKind, entry.source, {
      hook: "CONTENT_LOAD",
      target: { kind: "SOURCE" },
      effect: { kind: "INTRINSIC_DEFINITION" },
      operands: [],
      resolution: "RESOLVED_INTRINSIC",
    });
  }
}

addIntrinsic("MOVE", raw.moves, "INTRINSIC_MOVE_RULE");
for (const role of ["ACTIVE_ABILITY", "PASSIVE_ABILITY"]) addIntrinsic(role, raw.abilities, role === "ACTIVE_ABILITY" ? "ABILITY_ATTRIBUTE" : "PASSIVE_ATTRIBUTE");
addIntrinsic("HELD_ITEM", raw.modifier_types, "MODIFIER_BEHAVIOR", true);
addIntrinsic("MAJOR_STATUS", raw.statuses, "STATUS_BEHAVIOR");
addIntrinsic("WEATHER", raw.weather, "WEATHER_BEHAVIOR");
addIntrinsic("TERRAIN", raw.terrain, "TERRAIN_BEHAVIOR");
addIntrinsic("BATTLER_TAG", raw.battler_tags, "BATTLER_TAG_BEHAVIOR", true);
addIntrinsic("ARENA_TAG", raw.arena_tags, "ARENA_TAG_BEHAVIOR", true);
addIntrinsic("POSITIONAL_TAG", raw.positional_tags, "POSITIONAL_TAG_BEHAVIOR", true);

const speciesEnum = enumMembers(resolve(input.oracleRoot, "src/enums/species-id.ts"), "SpeciesId");
const speciesIdByMember = new Map(speciesEnum.map(entry => [entry.key, entry.id]));
const speciesDescriptors = new Map();
const formDescriptors = [];
const files = [...new Set([
  ...raw.source_files.map(entry => resolve(input.oracleRoot, entry.path)),
  resolve(input.oracleRoot, "src/data/balance/pokemon-species.ts"),
  resolve(input.oracleRoot, "src/data/pokemon-species.ts"),
  resolve(input.oracleRoot, "src/init/init-species.ts"),
])].filter(path => existsSync(path)).sort();
for (const path of files) {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = node => {
    if (
      ts.isNewExpression(node)
      && node.expression.getText(sourceFile).endsWith("PokemonSpecies")
      && node.arguments?.[0]
      && ts.isPropertyAccessExpression(node.arguments[0])
    ) {
      const member = node.arguments[0].name.text;
      const speciesId = speciesIdByMember.get(member);
      if (Number.isSafeInteger(speciesId)) {
        const values = node.arguments.map(value => operand(value, sourceFile));
        const location = sourceLocation(sourceFile, node, input.oracleRoot);
        const descriptor = {
          id: speciesId,
          key: member,
          generation: values[1] ?? null,
          typing: { primary: values[6] ?? null, secondary: values[7] ?? null },
          height: values[8] ?? null,
          weight: values[9] ?? null,
          ability_slots: values.slice(10, 13),
          base_stat_total: values[13] ?? null,
          base_stats: {
            hp: values[14] ?? null,
            attack: values[15] ?? null,
            defense: values[16] ?? null,
            special_attack: values[17] ?? null,
            special_defense: values[18] ?? null,
            speed: values[19] ?? null,
          },
          source: location,
          provenance_hash: hash(`${location.path}:${location.line}:${node.getText(sourceFile)}`),
        };
        speciesDescriptors.set(speciesId, descriptor);
        addUnit(
          sourceIdentity("SPECIES", speciesId, null),
          "SPECIES_FORM_BEHAVIOR",
          location,
          {
            hook: "BATTLE_LOAD",
            target: { kind: "SOURCE" },
            effect: { kind: "SPECIES_DEFINITION" },
            operands: values,
            resolution: callbackPresent(values) ? "BESPOKE_GAP" : "RESOLVED_OPERANDS",
          },
        );
        let formIndex = 0;
        const collectForms = value => {
          if (
            ts.isNewExpression(value)
            && value.expression.getText(sourceFile).endsWith("PokemonForm")
          ) {
            const formValues = (value.arguments ?? []).map(argument => operand(argument, sourceFile));
            const formLocation = sourceLocation(sourceFile, value, input.oracleRoot);
            const formKey = formValues[1]?.kind === "STRING"
              ? formValues[1].value
              : formValues[1]?.kind === "ENUM"
                ? `${formValues[1].owner}.${formValues[1].member}`
                : `FORM_${formIndex}`;
            const form = {
              id: `${speciesId}:${formIndex}:${formKey}`,
              species_id: speciesId,
              form_index: formIndex,
              form_key: formKey,
              typing: { primary: formValues[2] ?? null, secondary: formValues[3] ?? null },
              height: formValues[4] ?? null,
              weight: formValues[5] ?? null,
              ability_slots: formValues.slice(6, 9),
              base_stat_total: formValues[9] ?? null,
              base_stats: {
                hp: formValues[10] ?? null,
                attack: formValues[11] ?? null,
                defense: formValues[12] ?? null,
                special_attack: formValues[13] ?? null,
                special_defense: formValues[14] ?? null,
                speed: formValues[15] ?? null,
              },
              source: formLocation,
              provenance_hash: hash(`${formLocation.path}:${formLocation.line}:${value.getText(sourceFile)}`),
            };
            formDescriptors.push(form);
            addUnit(
              sourceIdentity("FORM", null, form.id),
              "SPECIES_FORM_BEHAVIOR",
              formLocation,
              {
                hook: "BATTLE_LOAD",
                target: { kind: "SOURCE" },
                effect: { kind: "FORM_DEFINITION" },
                operands: formValues,
                resolution: callbackPresent(formValues) ? "BESPOKE_GAP" : "RESOLVED_OPERANDS",
              },
            );
            formIndex += 1;
          }
          ts.forEachChild(value, collectForms);
        };
        for (const argument of node.arguments) collectForms(argument);
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method === "attr" || method === "conditionalAttr") {
        const ref = reference(node.expression.expression);
        const attributeIndex = method === "conditionalAttr" ? 1 : 0;
        const attribute = node.arguments[attributeIndex];
        if (ref && attribute) {
          const numericId = memberIds.get(`${ref.owner}/${ref.member}`);
          if (Number.isSafeInteger(numericId)) {
            const operands = node.arguments.slice(attributeIndex + 1).map(value => operand(value, sourceFile));
            const location = sourceLocation(sourceFile, node, input.oracleRoot);
            const attributeName = attribute.getText(sourceFile);
            const conditional = method === "conditionalAttr";
            const roles = ref.kind === "ABILITY" ? ["ACTIVE_ABILITY", "PASSIVE_ABILITY"] : ["MOVE"];
            for (const role of roles) {
              addUnit(
                sourceIdentity(role, numericId, null),
                role === "MOVE" ? (conditional ? "CONDITIONAL_MOVE_ATTRIBUTE" : "MOVE_ATTRIBUTE") : role === "ACTIVE_ABILITY" ? "ABILITY_ATTRIBUTE" : "PASSIVE_ATTRIBUTE",
                { ...location, attribute: attributeName, method },
                {
                  hook: inferHook(attributeName),
                  target: { kind: "SOURCE_DEFINED" },
                  effect: { kind: inferEffect(attributeName), attribute: attributeName },
                  operands,
                  resolution: callbackPresent(operands) ? "BESPOKE_GAP" : "RESOLVED_OPERANDS",
                },
              );
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

for (const site of raw.dispatch_sites) {
  const source = sourceIdentity("BESPOKE", null, `${site.source.path}:${site.source.line}:${site.call}`);
  addUnit(source, "FIXED_DISPATCH_BEHAVIOR", site.source, {
    hook: site.hook ?? "FIXED_DISPATCH",
    target: { kind: "CALLSITE_DEFINED" },
    effect: { kind: "FIXED_DISPATCH", call: site.call },
    operands: [{ kind: "INTEGER", value: site.arguments }],
    resolution: "BESPOKE_GAP",
  });
}

for (const entry of speciesEnum) {
  if (!speciesDescriptors.has(entry.id)) {
    speciesDescriptors.set(entry.id, {
      id: entry.id,
      key: entry.key,
      generation: null,
      typing: { primary: null, secondary: null },
      height: null,
      weight: null,
      ability_slots: [],
      base_stat_total: null,
      base_stats: null,
      source: entry.source,
      provenance_hash: hash(entry.source),
      extraction_gap: "NO_STATIC_POKEMON_SPECIES_CONSTRUCTOR",
    });
    addUnit(
      sourceIdentity("SPECIES", typeof entry.id === "number" ? entry.id : null, typeof entry.id === "string" ? entry.id : null),
      "SPECIES_FORM_BEHAVIOR",
      entry.source,
      {
        hook: "BATTLE_LOAD",
        target: { kind: "SOURCE" },
        effect: { kind: "SPECIES_DEFINITION" },
        operands: [],
        resolution: "BESPOKE_GAP",
      },
    );
  }
}
const species = [...speciesDescriptors.values()].sort((left, right) => left.id - right.id);
const forms = formDescriptors.sort((left, right) =>
  left.species_id - right.species_id || left.form_index - right.form_index
);

const sourceRank = new Map(SOURCE_KIND_ORDER.map((kind, rank) => [kind, rank]));
const behaviorRank = new Map(BEHAVIOR_KIND_ORDER.map((kind, rank) => [kind, rank]));
units.sort((left, right) => {
  const a = left.id.source;
  const b = right.id.source;
  return sourceRank.get(a.kind) - sourceRank.get(b.kind)
    || (a.numeric_id ?? -1) - (b.numeric_id ?? -1)
    || compareText(a.registry_key ?? "", b.registry_key ?? "")
    || behaviorRank.get(left.id.unit_kind) - behaviorRank.get(right.id.unit_kind)
    || left.id.ordinal - right.id.ordinal;
});

const gaps = units.filter(unit => unit.semantic.resolution === "BESPOKE_GAP");
const clusters = new Map();
for (const unit of gaps) {
  const effect = unit.semantic.effect.kind;
  const cluster = effect.includes("SWITCH") || effect.includes("TARGET") ? "SWITCH_TRAP_REDIRECT"
    : effect.includes("DAMAGE") ? "SPECIAL_DAMAGE"
    : effect.includes("STATUS") || effect.includes("TAG") ? "STATUS_TAG_STATE"
    : effect.includes("TYPE") || effect.includes("FORM") ? "TRANSFORM_FORM_COPY"
    : unit.id.unit_kind === "MODIFIER_BEHAVIOR" ? "ITEM_BERRY_LIFECYCLE"
    : "CUSTOM_DISPATCH";
  const values = clusters.get(cluster) ?? [];
  values.push(unit.id);
  clusters.set(cluster, values);
}

const resolvedSources = [];
for (const unit of units) {
  const key = identityKey(unit.id.source);
  if (!resolvedSources.some(entry => identityKey(entry.source) === key)) {
    resolvedSources.push({ source: unit.id.source, behavior_unit_count: 0 });
  }
  resolvedSources.find(entry => identityKey(entry.source) === key).behavior_unit_count += 1;
}
const rawV2 = {
  ...raw,
  schema_version: 2,
  species,
  forms,
  behavior_units: units.map(unit => ({ id: unit.id, provenance: unit.provenance })),
};
const semantic = {
  schema_version: 1,
  oracle_sha: input.oracleSha,
  raw_catalog_hash: hash(rawV2),
  sources: resolvedSources,
  behavior_units: units,
  trigger_order: { authority: "M6_ORACLE_EXTRACTED", evidence: "docs/plans/rust-kernel/m6-trigger-order.md" },
  query_order: { authority: "M6_ORACLE_EXTRACTED", evidence: "docs/plans/rust-kernel/m6-query-order.md" },
  targeting_contract: { authority: "M6_ORACLE_EXTRACTED", evidence: "docs/plans/rust-kernel/m6-targeting.md" },
};
const witnessPlans = units.map(unit => ({
  behavior_unit: unit.id,
  expected_hook: unit.semantic.hook,
  expected_source: unit.id.source,
  positive_assertions: [{ kind: "SOURCE_REACHED" }],
  negative_assertions: [{ kind: "FALSE_CONDITION_DOES_NOT_MUTATE" }],
  rng_contract: [],
}));
writeJson(input.outputRoot, "raw-source-catalog-v2.json", rawV2);
writeJson(input.outputRoot, "semantic-catalog-v1.json", semantic);
writeJson(input.outputRoot, "behavior-unit-manifest-v1.json", { schema_version: 1, oracle_sha: input.oracleSha, behavior_units: units.map(unit => unit.id) });
writeJson(input.outputRoot, "primitive-gap-manifest-v1.json", { schema_version: 1, oracle_sha: input.oracleSha, gap_count: gaps.length, gaps: gaps.map(unit => ({ id: unit.id, semantic: unit.semantic })) });
writeJson(input.outputRoot, "bespoke-clusters-v1.json", { schema_version: 1, oracle_sha: input.oracleSha, clusters: [...clusters].sort(([left], [right]) => compareText(left, right)).map(([cluster, behavior_units]) => ({ cluster, behavior_units })) });
writeJson(input.outputRoot, "oracle-witness-plan-v1.json", { schema_version: 1, oracle_sha: input.oracleSha, witness_count: witnessPlans.length, witnesses: witnessPlans });
console.log(`M6 semantic exporter: ${resolvedSources.length} sources, ${units.length} behavior units, ${gaps.length} gaps, ${clusters.size} bespoke clusters`);
