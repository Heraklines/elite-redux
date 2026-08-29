import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BattleScene } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { allAbilities, allBiomes, allMoves, allSpecies, modifierTypes } from "#data/data-lists";
import { buildExoticShopStock } from "#data/elite-redux/er-exotic-shop";
import { modifierPool } from "#modifiers/modifier-pools";
import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { initializeGame } from "#init/init";
import { BattleStyle } from "#enums/battle-style";
import { BiomeId } from "#enums/biome-id";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { BattlerTagType } from "#enums/battler-tag-type";
import { GameModes } from "#enums/game-modes";
import { ModifierTier } from "#enums/modifier-tier";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import { PromptHandler } from "#test/helpers/prompt-handler";
import Phaser from "phaser";
import { getTypeDamageMultiplier } from "#data/type";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type AnyRecord = Record<string, any>;
type JsonObject = { [key: string]: JsonValue };

/** A typed, source-addressed gap in the test-only exporter. */
export class M4CaptureGap extends Error {
  public readonly code: string;
  public readonly sourceSeam: string;

  constructor(code: string, sourceSeam: string, detail: string) {
    super(`${code} at ${sourceSeam}: ${detail}`);
    this.name = "M4CaptureGap";
    this.code = code;
    this.sourceSeam = sourceSeam;
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const LEGACY_M4_ORACLE_SHA = "45c89493e7edec9c4da247a98cd7858b1f015c09";
const LEGACY_M3_PARITY_ORACLE_SHA = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
const M4_ORACLE_SHA = process.env.M5_ORACLE_REFRESH_SHA ?? LEGACY_M4_ORACLE_SHA;
const M3_PARITY_ORACLE_SHA = process.env.M5_ORACLE_REFRESH_SHA ?? LEGACY_M3_PARITY_ORACLE_SHA;
const RUN_HASH_DOMAIN = "pokerogue-redux/m4/run-content/v1";
const SAFE_U53_MAX = 9_007_199_254_740_991;

function gap(code: string, sourceSeam: string, detail: string): never {
  throw new M4CaptureGap(code, sourceSeam, detail);
}

function readJson(relativePath: string): AnyRecord {
  try {
    const value = JSON.parse(readFileSync(resolve(REPO_ROOT, relativePath), "utf8")) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      gap("MANIFEST_UNOBSERVABLE", relativePath, "expected a JSON object");
    }
    return value as AnyRecord;
  } catch (error) {
    if (error instanceof M4CaptureGap) {
      throw error;
    }
    gap("MANIFEST_UNOBSERVABLE", relativePath, error instanceof Error ? error.message : String(error));
  }
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    gap("NON_FINITE_LIVE_VALUE", sourceFor(path), `${path} is not finite`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function safeInteger(value: unknown, path: string): number {
  const number = finite(value, path);
  if (!Number.isSafeInteger(number) || Math.abs(number) > SAFE_U53_MAX) {
    gap("UNSAFE_LIVE_INTEGER", sourceFor(path), `${path} is not a safe integer`);
  }
  return number;
}

function sourceFor(path: string): string {
  if (path.startsWith("species")) {
    return "src/data/pokemon-species.ts:PokemonSpecies";
  }
  if (path.startsWith("moves") || path.startsWith("body_slam")) {
    return "src/data/moves/move.ts:Move";
  }
  if (path.startsWith("abilities")) {
    return "src/data/abilities/ability.ts:Ability";
  }
  if (path.startsWith("type_chart")) {
    return "src/data/type.ts:getTypeDamageMultiplier";
  }
  if (path.startsWith("modifierPool")) {
    return "src/modifier/init-modifier-pools.ts:WeightedModifierType";
  }
  if (path.startsWith("exoticShopStock")) {
    return "src/data/elite-redux/er-exotic-shop.ts:buildExoticShopStock";
  }
  if (path.startsWith("modifiers")) {
    return "src/modifier/modifier-type.ts:modifierTypeInitObj";
  }
  if (path.startsWith("biomes")) {
    return "src/init/init-biomes.ts:Biome.biomeLinks";
  }
  if (path.startsWith("progression")) {
    return "src/data/balance/pokemon-level-moves.ts:pokemonSpeciesLevelMoves";
  }
  return "test/kernel-fixtures/m4/export/run-content-capture.ts";
}

function requireRecord(value: unknown, path: string): AnyRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    gap("LIVE_VALUE_MISSING", sourceFor(path), `${path} is not an object`);
  }
  return value as AnyRecord;
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    gap("LIVE_VALUE_MISSING", sourceFor(path), `${path} is not an array`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    gap("LIVE_VALUE_MISSING", sourceFor(path), `${path} is not a non-empty string`);
  }
  return value;
}

function enumName(table: AnyRecord, value: unknown, path: string): string {
  const number = safeInteger(value, path);
  const name = table[number];
  if (typeof name !== "string" || name.length === 0 || /^UNKNOWN$|^STELLAR$/u.test(name)) {
    gap("LIVE_ENUM_UNOBSERVABLE", sourceFor(path), `${path}=${String(value)} has no supported enum name`);
  }
  return name;
}

function typeName(value: unknown, path: string): string {
  return enumName(PokemonType as unknown as AnyRecord, value, path);
}

function enumValue(table: AnyRecord, name: string, path: string): number {
  const value = table[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    gap("CANONICAL_VALUE_UNOBSERVABLE", sourceFor(path), `${name} is not a numeric enum member`);
  }
  return value;
}

function exact<T>(value: unknown, expected: T, path: string): T {
  if (value !== expected) {
    gap("LIVE_VECTOR_MISMATCH", sourceFor(path), `${path}=${String(value)} expected ${String(expected)}`);
  }
  return value as T;
}

function canonicalValue(value: unknown, path = "$", strict = false): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value as JsonValue;
  }
  if (typeof value === "number") {
    finite(value, path);
    if (strict && (!Number.isSafeInteger(value) || Math.abs(value) > SAFE_U53_MAX)) {
      gap("CONTENT_CANONICAL_VALUE", "rust/crates/er-canonical/src/lib.rs:canonical_bytes", `${path} is not a safe integer`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((child, index) => {
      if (child === undefined) {
        gap("CONTENT_CANONICAL_VALUE", "rust/crates/er-canonical/src/lib.rs:canonical_bytes", `${path}[${index}] is undefined`);
      }
      return canonicalValue(child, `${path}[${index}]`, strict);
    });
  }
  if (typeof value === "object") {
    const output: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      if (strict && [...key].some(character => (character.codePointAt(0) ?? 0x80) > 0x7f)) {
        gap("CONTENT_CANONICAL_KEY", "rust/crates/er-canonical/src/lib.rs:canonical_bytes", `${path}.${key}`);
      }
      const child = (value as AnyRecord)[key];
      if (child === undefined) {
        gap("CONTENT_CANONICAL_VALUE", "rust/crates/er-canonical/src/lib.rs:canonical_bytes", `${path}.${key} is undefined`);
      }
      output[key] = canonicalValue(child, `${path}.${key}`, strict);
    }
    return output;
  }
  gap("CONTENT_CANONICAL_VALUE", "rust/crates/er-canonical/src/lib.rs:canonical_bytes", `${path} has unsupported type`);
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(canonicalValue(value, "$", true)), "utf8");
}

function b3sum(bytes: Buffer): string {
  let version: string;
  try {
    version = execFileSync("b3sum", ["--version"], { encoding: "utf8" }).trim();
  } catch (error) {
    gap("CONTENT_HASH_UNAVAILABLE", "b3sum 1.8.6", error instanceof Error ? error.message : String(error));
  }
  if (!/^b3sum\s+1\.8\.6(?:\s|$)/u.test(version)) {
    gap("CONTENT_HASH_UNAVAILABLE", "b3sum 1.8.6", `unexpected b3sum version ${version}`);
  }
  try {
    const output = execFileSync("b3sum", ["-"], { input: bytes, encoding: "utf8" }).trim();
    const digest = output.split(/\s+/u)[0];
    if (!/^[0-9a-f]{64}$/u.test(digest)) {
      gap("CONTENT_HASH_UNAVAILABLE", "b3sum 1.8.6", `invalid digest ${output}`);
    }
    return digest;
  } catch (error) {
    gap("CONTENT_HASH_UNAVAILABLE", "b3sum 1.8.6", error instanceof Error ? error.message : String(error));
  }
}

function hashContent(value: unknown): string {
  return b3sum(canonicalBytes(value));
}

function hashRunContent(value: unknown): string {
  const preimage = Buffer.concat([Buffer.from(RUN_HASH_DOMAIN, "utf8"), Buffer.from([0]), canonicalBytes(value)]);
  return b3sum(preimage);
}

function ensureLiveRegistries(): void {
  const battleManifest = readJson("rust/fixtures/m3/m3-slice-manifest.json");
  const selectedSpecies = requireArray(battleManifest.species_definitions, "species_definitions");
  const selectedMoves = requireArray(battleManifest.move_definitions, "move_definitions");
  const selectedAbilities = requireArray(battleManifest.ability_definitions, "ability_definitions");
  const speciesIds = selectedSpecies.map(entry => safeInteger(requireRecord(entry, "species_definitions[]").id, "species.id"));
  const moveIds = selectedMoves.map(entry => safeInteger(requireRecord(entry, "move_definitions[]").id, "moves.id"));
  const abilityIds = selectedAbilities.map(entry => safeInteger(requireRecord(entry, "ability_definitions[]").id, "abilities.id"));
  const modifierPoolInitialized =
    Array.isArray((modifierPool as AnyRecord)[ModifierTier.COMMON])
    && (modifierPool as AnyRecord)[ModifierTier.COMMON].length > 0
    && Array.isArray((modifierPool as AnyRecord)[ModifierTier.MASTER])
    && (modifierPool as AnyRecord)[ModifierTier.MASTER].length > 0;
  const initialized =
    speciesIds.every(id => allSpecies.some(entry => Number((entry as AnyRecord).speciesId) === id))
    && [...moveIds, 34].every(id => allMoves.some(entry => Number((entry as AnyRecord).id) === id))
    && abilityIds.every(id => allAbilities.some(entry => Number((entry as AnyRecord).id) === id))
    && [0, 1, 2, 4, 9, 50].every(id => allBiomes.has(id as never))
    && ["AMULET_COIN", "CANDY_JAR", "POTION", "POKEBALL"].every(key => typeof (modifierTypes as AnyRecord)[key] === "function")
    && modifierPoolInitialized;
  if (!initialized) {
    try {
      initializeGame();
    } catch (error) {
      gap("CONTENT_REGISTRY_UNINITIALIZED", "src/init/init.ts:initializeGame", error instanceof Error ? error.message : String(error));
    }
  }
  if (
    !speciesIds.every(id => allSpecies.some(entry => Number((entry as AnyRecord).speciesId) === id))
    || ![...moveIds, 34].every(id => allMoves.some(entry => Number((entry as AnyRecord).id) === id))
    || !abilityIds.every(id => allAbilities.some(entry => Number((entry as AnyRecord).id) === id))
  ) {
    gap("CONTENT_REGISTRY_INCOMPLETE", "src/init/init.ts:initializeGame", "selected live registries are incomplete after initialization");
  }
}

function sourceSpecies(id: number, path: string): AnyRecord {
  const species = allSpecies.find(entry => Number((entry as AnyRecord).speciesId) === id);
  if (species == null) {
    gap("CONTENT_REGISTRY_INCOMPLETE", "src/data/pokemon-species.ts:allSpecies", `${path} species ${id} is absent`);
  }
  return species as AnyRecord;
}

function sourceMove(id: number, path: string): AnyRecord {
  const move = allMoves.find(entry => Number((entry as AnyRecord).id) === id);
  if (move == null) {
    gap("CONTENT_REGISTRY_INCOMPLETE", "src/data/moves/move.ts:allMoves", `${path} move ${id} is absent`);
  }
  return move as AnyRecord;
}

function sourceAbility(id: number, path: string): AnyRecord {
  const ability = allAbilities.find(entry => Number((entry as AnyRecord).id) === id);
  if (ability == null) {
    gap("CONTENT_REGISTRY_INCOMPLETE", "src/data/abilities/ability.ts:allAbilities", `${path} ability ${id} is absent`);
  }
  return ability as AnyRecord;
}

function statusName(value: unknown, path: string): string {
  const status = safeInteger(value, path);
  const names: Record<number, string> = { 1: "POISON", 3: "PARALYSIS", 6: "BURN" };
  const name = names[status];
  if (name == null) {
    gap("CONTENT_CANONICAL_VALUE", "src/data/moves/move.ts:StatusEffectAttr", `${path}=${status} is unsupported`);
  }
  return name;
}

function moveFlags(move: AnyRecord, path: string): string[] {
  if (typeof move.hasFlag !== "function") {
    gap("POST_INITIALIZATION_MOVE_UNOBSERVABLE", "src/data/moves/move.ts:Move.hasFlag", `${path} has no live hasFlag method`);
  }
  const canonicalFlag: Record<string, string> = {
    MAKES_CONTACT: "CONTACT",
    POWDER_MOVE: "POWDER",
    REFLECTABLE: "REFLECTABLE",
    IGNORE_SUBSTITUTE: "IGNORE_SUBSTITUTE",
  };
  const flags: string[] = [];
  for (const key of Object.keys(MoveFlags).filter(key => Number.isNaN(Number(key)))) {
    if (key === "NONE") {
      continue;
    }
    const flag = (MoveFlags as unknown as AnyRecord)[key];
    if (typeof flag !== "number") {
      continue;
    }
    let active: unknown;
    try {
      active = move.hasFlag(flag);
    } catch (error) {
      gap("POST_INITIALIZATION_MOVE_UNOBSERVABLE", "src/data/moves/move.ts:Move.hasFlag", `${path}.${key}: ${String(error)}`);
    }
    if (typeof active !== "boolean") {
      gap("POST_INITIALIZATION_MOVE_UNOBSERVABLE", "src/data/moves/move.ts:Move.hasFlag", `${path}.${key} did not return boolean`);
    }
    if (active) {
      const value = canonicalFlag[key];
      if (value == null) {
        gap("CONTENT_CANONICAL_VALUE", "rust/crates/er-types/src/battle_model.rs:MoveFlag", `${path}.${key} has no canonical MoveFlag mapping`);
      }
      flags.push(value);
    }
  }
  return flags;
}

function moveEffects(move: AnyRecord, id: number, path: string): JsonValue[] {
  const effects: JsonValue[] = [];
  const category = enumName(MoveCategory as unknown as AnyRecord, move.category, `${path}.category`);
  const power = safeInteger(move.power, `${path}.power`);
  if (category !== "STATUS" && power >= 0) {
    effects.push({ kind: "DAMAGE" });
  }
  const attrs = requireArray(move.attrs, `${path}.attrs`);
  for (const rawAttr of attrs) {
    const attr = requireRecord(rawAttr, `${path}.attrs[]`);
    const constructorName = requireString(attr.constructor?.name, `${path}.attrs.constructor.name`);
    if (constructorName === "StatusEffectAttr") {
      effects.push({ kind: "APPLY_STATUS", value: statusName(attr.effect, `${path}.attrs.${constructorName}.effect`) });
      continue;
    }
    if (constructorName === "StatStageChangeAttr") {
      const stats = requireArray(attr.stats, `${path}.attrs.${constructorName}.stats`);
      if (stats.length !== 1 || enumName(Stat as unknown as AnyRecord, stats[0], `${path}.attrs.${constructorName}.stats[0]`) !== "ATK") {
        gap("CONTENT_CANONICAL_VALUE", "src/data/moves/move.ts:StatStageChangeAttr", `${path} has unsupported stat-stage target`);
      }
      effects.push({ kind: "CHANGE_STAT_STAGE", value: { stat: "ATTACK", delta: safeInteger(attr.stages, `${path}.attrs.${constructorName}.stages`) } });
      continue;
    }
    if (constructorName === "HealStatusEffectAttr") {
      if (typeName(move.type, `${path}.type`) !== "FIRE") {
        gap(
          "CONTENT_CANONICAL_VALUE",
          "src/data/moves/move.ts:HealStatusEffectAttr",
          `${path} has a status-heal attribute outside the Fire-type thaw contract`,
        );
      }
      continue;
    }
    if (constructorName === "AlwaysHitMinimizeAttr" || constructorName === "HitsTagForDoubleDamageAttr") {
      continue;
    }
    gap("CONTENT_CANONICAL_VALUE", "src/data/moves/move.ts:Move.attrs", `${path} has unmapped effect attribute ${constructorName}`);
  }
  if (id === 34) {
    const names = attrs.map(attr => requireString(requireRecord(attr, `${path}.attrs[]`).constructor?.name, `${path}.attrs[].constructor.name`));
    if (!names.includes("AlwaysHitMinimizeAttr") || !names.includes("HitsTagForDoubleDamageAttr") || !names.includes("StatusEffectAttr")) {
      gap("BODY_SLAM_MECHANICS_UNOBSERVABLE", "src/data/moves/move.ts:Body Slam", "Body Slam is missing a required live attribute");
    }
    const doubleDamage = attrs.find(attr => requireRecord(attr, `${path}.attrs[]`).constructor?.name === "HitsTagForDoubleDamageAttr") as AnyRecord | undefined;
    if (
      doubleDamage == null
      || doubleDamage.doubleDamage !== true
      || requireString(doubleDamage.tagType, `${path}.doubleDamage.tagType`) !== "MINIMIZED"
    ) {
      gap(
        "BODY_SLAM_MECHANICS_UNOBSERVABLE",
        "src/data/moves/move.ts:HitsTagForDoubleDamageAttr",
        "Body Slam minimize-doubling metadata is not observable",
      );
    }
  }
  return effects;
}

function battleSpecies(slice: AnyRecord): JsonValue[] {
  const entries = requireArray(slice.species_definitions, "species_definitions");
  return entries.map((raw, index) => {
    const entry = requireRecord(raw, `species_definitions[${index}]`);
    const id = safeInteger(entry.id, `species_definitions[${index}].id`);
    const source = sourceSpecies(id, `species_definitions[${index}]`);
    const stats = requireArray(source.baseStats, `species.${id}.baseStats`);
    if (stats.length !== 6) {
      gap("POST_INITIALIZATION_SPECIES_UNOBSERVABLE", "src/data/pokemon-species.ts:PokemonSpecies.baseStats", `species ${id} has ${stats.length} stats`);
    }
    const runtimeTypes = requireArray(entry.runtime_types, `species_definitions[${index}].runtime_types`);
    const primary = typeName(source.type1, `species.${id}.type1`);
    const secondary = source.type2 == null ? null : typeName(source.type2, `species.${id}.type2`);
    if (runtimeTypes[0] !== primary || (runtimeTypes[1] ?? null) !== secondary) {
      gap("LIVE_VECTOR_MISMATCH", "src/data/pokemon-species.ts:PokemonSpecies", `species ${id} typing differs from the selected source closure`);
    }
    return {
      id,
      base_types: { primary, secondary },
      base_stats: {
        hp: safeInteger(stats[0], `species.${id}.baseStats.hp`),
        attack: safeInteger(stats[1], `species.${id}.baseStats.attack`),
        defense: safeInteger(stats[2], `species.${id}.baseStats.defense`),
        special_attack: safeInteger(stats[3], `species.${id}.baseStats.special_attack`),
        special_defense: safeInteger(stats[4], `species.${id}.baseStats.special_defense`),
        speed: safeInteger(stats[5], `species.${id}.baseStats.speed`),
      },
      capability: { kind: "SUPPORTED" },
    };
  });
}

function battleMoves(slice: AnyRecord): JsonValue[] {
  const entries = requireArray(slice.move_definitions, "move_definitions");
  const output = entries.map((raw, index) => {
    const entry = requireRecord(raw, `move_definitions[${index}]`);
    const id = safeInteger(entry.id, `move_definitions[${index}].id`);
    const move = sourceMove(id, `move_definitions[${index}]`);
    return {
      id,
      category: enumName(MoveCategory as unknown as AnyRecord, move.category, `moves.${id}.category`),
      move_type: typeName(move.type, `moves.${id}.type`),
      power: safeInteger(move.power, `moves.${id}.power`) < 0 ? { kind: "NONE" } : { kind: "VALUE", value: safeInteger(move.power, `moves.${id}.power`) },
      accuracy: safeInteger(move.accuracy, `moves.${id}.accuracy`) < 0 ? { kind: "ALWAYS_HITS" } : { kind: "PERCENT", value: safeInteger(move.accuracy, `moves.${id}.accuracy`) },
      base_pp: safeInteger(move.pp, `moves.${id}.pp`),
      effect_chance: safeInteger(move.chance, `moves.${id}.chance`) < 0 ? { kind: "NONE" } : { kind: "PERCENT", value: safeInteger(move.chance, `moves.${id}.chance`) },
      priority: safeInteger(move.priority, `moves.${id}.priority`),
      target: enumName(MoveTarget as unknown as AnyRecord, move.moveTarget, `moves.${id}.moveTarget`),
      flags: moveFlags(move, `moves.${id}`),
      effects: moveEffects(move, id, `moves.${id}`),
      capability: { kind: "SUPPORTED" },
    };
  });
  const body = sourceMove(34, "body_slam");
  const bodyCategory = enumName(MoveCategory as unknown as AnyRecord, body.category, "body_slam.category");
  const bodyType = typeName(body.type, "body_slam.type");
  exact(bodyCategory, "PHYSICAL", "body_slam.category");
  exact(bodyType, "NORMAL", "body_slam.type");
  exact(safeInteger(body.power, "body_slam.power"), 85, "body_slam.power");
  exact(safeInteger(body.accuracy, "body_slam.accuracy"), 100, "body_slam.accuracy");
  exact(safeInteger(body.pp, "body_slam.pp"), 15, "body_slam.pp");
  exact(safeInteger(body.chance, "body_slam.chance"), 30, "body_slam.chance");
  exact(safeInteger(body.priority, "body_slam.priority"), 0, "body_slam.priority");
  const bodyDefinition = {
    id: 34,
    category: bodyCategory,
    move_type: bodyType,
    power: { kind: "VALUE", value: safeInteger(body.power, "body_slam.power") },
    accuracy: { kind: "PERCENT", value: safeInteger(body.accuracy, "body_slam.accuracy") },
    base_pp: safeInteger(body.pp, "body_slam.pp"),
    effect_chance: { kind: "PERCENT", value: safeInteger(body.chance, "body_slam.chance") },
    priority: safeInteger(body.priority, "body_slam.priority"),
    target: enumName(MoveTarget as unknown as AnyRecord, body.moveTarget, "body_slam.moveTarget"),
    flags: moveFlags(body, "body_slam"),
    effects: moveEffects(body, 34, "body_slam"),
    capability: { kind: "SUPPORTED" },
  };
  const insertion = output.findIndex(move => requireRecord(move, "moves[]").id > 34);
  output.splice(insertion < 0 ? output.length : insertion, 0, bodyDefinition);
  return output;
}

function abilityEffect(ability: AnyRecord, id: number): JsonObject {
  const attrs = requireArray(ability.attrs, `abilities.${id}.attrs`);
  if (id === 0) {
    if (attrs.length !== 0) {
      gap("ABILITY_MECHANICS_UNOBSERVABLE", "src/data/abilities/ability.ts:Ability", "NONE has live attributes");
    }
    return { kind: "NONE" };
  }
  if (id === 22) {
    if (attrs.length !== 1) {
      gap("ABILITY_MECHANICS_UNOBSERVABLE", "src/data/abilities/ab-attrs.ts:PostSummonStatStageChangeAbAttr", "INTIMIDATE attr closure is not exact");
    }
    const attr = requireRecord(attrs[0], `abilities.${id}.attrs[0]`);
    exact(requireString(attr.constructor?.name, `abilities.${id}.attrs[0].constructor.name`), "PostSummonStatStageChangeAbAttr", `abilities.${id}.attr`);
    const stats = requireArray(attr.stats, `abilities.${id}.stats`);
    if (stats.length !== 1 || enumName(Stat as unknown as AnyRecord, stats[0], `abilities.${id}.stats[0]`) !== "ATK" || safeInteger(attr.stages, `abilities.${id}.stages`) !== -1 || attr.selfTarget !== false || attr.intimidate !== true) {
      gap("ABILITY_MECHANICS_UNOBSERVABLE", "src/data/abilities/ab-attrs.ts:PostSummonStatStageChangeAbAttr", "INTIMIDATE live parameters differ");
    }
    return { kind: "POST_SUMMON_ADJACENT_OPPONENT_ATTACK_MINUS_ONE" };
  }
  if (id === 25) {
    const mechanicalAttrs = attrs.filter((raw, index) => {
      const attr = requireRecord(raw, `abilities.${id}.attrs[${index}]`);
      const name = requireString(attr.constructor?.name, `abilities.${id}.attrs[${index}].constructor.name`);
      return name !== "AbilityStudioRuntimeCapabilityAbAttr" && name !== "AbilityStudioSourceAbilityAbAttr";
    });
    if (mechanicalAttrs.length !== 1) {
      gap("ABILITY_MECHANICS_UNOBSERVABLE", "src/data/abilities/ab-attrs.ts:NonSuperEffectiveImmunityAbAttr", "WONDER GUARD mechanical attr closure is not exact");
    }
    exact(requireString(requireRecord(mechanicalAttrs[0], `abilities.${id}.mechanicalAttrs[0]`).constructor?.name, `abilities.${id}.mechanicalAttrs[0].constructor.name`), "NonSuperEffectiveImmunityAbAttr", `abilities.${id}.attr`);
    return { kind: "NON_SUPER_EFFECTIVE_ATTACK_IMMUNITY" };
  }
  gap("CONTENT_CANONICAL_VALUE", "src/data/abilities/ability.ts:Ability", `unmapped ability ${id}`);
}

function battleAbilities(slice: AnyRecord): JsonValue[] {
  const entries = requireArray(slice.ability_definitions, "ability_definitions");
  return entries.map((raw, index) => {
    const entry = requireRecord(raw, `ability_definitions[${index}]`);
    const id = safeInteger(entry.id, `ability_definitions[${index}].id`);
    const source = sourceAbility(id, `ability_definitions[${index}]`);

    return { id, effect: abilityEffect(source, id), capability: { kind: "SUPPORTED" } };
  });
}
/**
 * Both the production multiplier and exotic shop pricing read globalScene, so
 * those observations must share a real initialized Classic battle frontier.
 */
let livePhaserGame: Phaser.Game | null = null;
let liveGame: GameManager | null = null;
let priorBattleRng: BattleScene["randBattleSeedInt"] | null = null;

async function launchLiveClassicBattle(): Promise<void> {
  try {
    priorBattleRng = BattleScene.prototype.randBattleSeedInt;
    if (priorBattleRng == null) {
      gap("TYPE_CHART_UNOBSERVABLE", "src/battle-scene.ts:BattleScene.randBattleSeedInt", "production battle RNG method is unavailable");
    }
    livePhaserGame = new Phaser.Game({ type: Phaser.HEADLESS, seed: ["m4-oracle-anchor"] });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    liveGame = new GameManager(livePhaserGame);
    (BattleScene.prototype as AnyRecord).randBattleSeedInt = priorBattleRng;
    liveGame.override
      .battleStyle(BattleStyle.SET)
      .moveset(MoveId.SPLASH)
      .enemyMoveset(MoveId.SPLASH)
      .startingBiome(BiomeId.TOWN)
      .startingWave(1)
      .seed("m4-content-exotic-stock");
    await liveGame.classicMode.startBattle(SpeciesId.SQUIRTLE);
  } catch (error) {
    if (error instanceof M4CaptureGap) {
      throw error;
    }
    gap(
      "TYPE_CHART_UNOBSERVABLE",
      "test/framework/game-manager.ts:GameManager.classicMode.startBattle",
      `failed to initialize the live Classic scene: ${String(error)}`,
    );
  }
}

function ensureLiveTypeChartScene(): void {
  const scene = globalScene;
  if (
    liveGame == null
    || scene == null
    || liveGame.scene !== scene
    || scene.gameMode?.modeId !== GameModes.CLASSIC
    || !Array.isArray(scene.gameMode?.challenges)
    || scene.currentBattle == null
    || !Number.isInteger(scene.currentBattle.waveIndex)
  ) {
    gap(
      "TYPE_CHART_UNOBSERVABLE",
      "test/framework/game-manager.ts:GameManager.classicMode.startBattle",
      "the live scene does not expose an initialized Classic battle with a wave index",
    );
  }
}

function teardownLiveClassicBattle(): void {
  liveGame?.promptHandler.clearPrompts();
  if (priorBattleRng != null) {
    BattleScene.prototype.randBattleSeedInt = priorBattleRng;
    priorBattleRng = null;
  }
  if (PromptHandler.runInterval != null) {
    clearInterval(PromptHandler.runInterval);
    PromptHandler.runInterval = undefined;
  }
  livePhaserGame?.destroy(true);
  liveGame = null;
  livePhaserGame = null;
}

function battleTypeChart(slice: AnyRecord): JsonObject {
  ensureLiveTypeChartScene();
  const chart = requireRecord(slice.type_chart, "type_chart");
  const entries = requireArray(chart.non_neutral_entries, "type_chart.non_neutral_entries").map((raw, index) => {
    const entry = requireRecord(raw, `type_chart.non_neutral_entries[${index}]`);
    const attack = requireString(entry.attack_type, `type_chart.non_neutral_entries[${index}].attack_type`);
    const defense = requireString(entry.defense_type, `type_chart.non_neutral_entries[${index}].defense_type`);
    const attackValue = enumValue(PokemonType as unknown as AnyRecord, attack, `type_chart.${attack}`);
    const defenseValue = enumValue(PokemonType as unknown as AnyRecord, defense, `type_chart.${defense}`);
    let live: number;
    try {
      live = getTypeDamageMultiplier(attackValue, defenseValue);
    } catch (error) {
      gap("TYPE_CHART_UNOBSERVABLE", "src/data/type.ts:getTypeDamageMultiplier", `${attack}/${defense}: ${String(error)}`);
    }
    const multiplier = live === 0 ? "ZERO" : live === 0.5 ? "HALF" : live === 2 ? "TWO" : undefined;
    if (multiplier == null) {
      gap("TYPE_CHART_UNOBSERVABLE", "src/data/type.ts:getTypeDamageMultiplier", `${attack}/${defense}=${String(live)}`);
    }
    const expected = entry.multiplier;
    const expectedName = expected === "0" ? "ZERO" : expected === "1/2" ? "HALF" : expected === "2" ? "TWO" : undefined;
    if (expectedName !== multiplier) {
      gap("TYPE_CHART_MISMATCH", "rust/fixtures/m3/m3-slice-manifest.json:type_chart", `${attack}/${defense} differs from the live chart`);
    }
    return { attack, defense, multiplier };
  });
  return { entries };
}

function battleCapability(capability: AnyRecord, moves: readonly JsonValue[], abilities: readonly JsonValue[]): JsonObject {
  exact(safeInteger(capability.schema_version, "battle_capability.schema_version"), 1, "battle_capability.schema_version");
  exact(requireString(capability.oracle_game_sha, "battle_capability.oracle_game_sha"), LEGACY_M3_PARITY_ORACLE_SHA, "battle_capability.oracle_game_sha");
  const entries = requireArray(capability.entries, "battle_capability.entries").map((raw, index) => {
    const entry = requireRecord(raw, `battle_capability.entries[${index}]`);
    const kind = requireString(entry.subject_kind, `battle_capability.entries[${index}].subject_kind`);
    const id = safeInteger(entry.subject_id, `battle_capability.entries[${index}].subject_id`);
    let value: number | string;
    if (kind === "STATUS") {
      value = statusName(id, `battle_capability.entries[${index}].subject_id`);
    } else if (kind === "WEATHER" || kind === "TERRAIN") {
      exact(id, 0, `battle_capability.entries[${index}].subject_id`);
      value = "NONE";
    } else {
      value = id;
    }
    if (kind === "MOVE" && !moves.some(move => requireRecord(move, "moves[]").id === id)) {
      gap("CAPABILITY_CLOSURE_INCOMPLETE", "rust/fixtures/m3/m3-capability-manifest.json", `move ${id} capability has no selected definition`);
    }
    if (kind === "ABILITY" && !abilities.some(ability => requireRecord(ability, "abilities[]").id === id)) {
      gap("CAPABILITY_CLOSURE_INCOMPLETE", "rust/fixtures/m3/m3-capability-manifest.json", `ability ${id} capability has no selected definition`);
    }
    return {
      subject: { kind, value },
      status: { kind: exact(requireString(entry.status, `battle_capability.entries[${index}].status`), "SUPPORTED", `battle_capability.entries[${index}].status`) },
      required_positive_cases: requireArray(entry.positive_cases, `battle_capability.entries[${index}].positive_cases`).map((value, caseIndex) => requireString(value, `battle_capability.entries[${index}].positive_cases[${caseIndex}]`)),
      required_edge_cases: requireArray(entry.edge_cases, `battle_capability.entries[${index}].edge_cases`).map((value, caseIndex) => requireString(value, `battle_capability.entries[${index}].edge_cases[${caseIndex}]`)),
    };
  });
  entries.splice(1, 0, {
    subject: { kind: "MOVE", value: 34 },
    status: { kind: "SUPPORTED" },
    required_positive_cases: ["physical-hit", "paralysis-application"],
    required_edge_cases: ["always-hit", "paralysis-full-stop", "paralysis-speed-order"],
  });
  return { schema_version: 1, oracle_game_sha: M4_ORACLE_SHA, entries };
}

type ModifierDefinition = AnyRecord & { tier: string | null };

const MODIFIERS: readonly ModifierDefinition[] = [
  { id: 1, key: "AMULET_COIN", tier: "ULTRA", maximum_stack: 5, target: "RUN", effect: { kind: "MONEY_MULTIPLIER", percent: 20 }, constructor: "ModifierType" },
  { id: 2, key: "CANDY_JAR", tier: "ULTRA", maximum_stack: 99, target: "RUN", effect: { kind: "LEVEL_INCREMENT_BOOSTER", levels_per_stack: 1 }, constructor: "ModifierType" },
  { id: 3, key: "EXP_CHARM", tier: "ULTRA", maximum_stack: 99, target: "RUN", effect: { kind: "EXPERIENCE_MULTIPLIER", percent: 25 }, constructor: "ExpBoosterModifierType" },
  { id: 4, key: "SUPER_EXP_CHARM", tier: "ROGUE", maximum_stack: 30, target: "RUN", effect: { kind: "EXPERIENCE_MULTIPLIER", percent: 60 }, constructor: "ExpBoosterModifierType" },
  { id: 5, key: "GOLDEN_EXP_CHARM", tier: null, maximum_stack: 10, target: "RUN", effect: { kind: "EXPERIENCE_MULTIPLIER", percent: 100 }, constructor: "ExpBoosterModifierType" },
  { id: 6, key: "HEALING_CHARM", tier: "MASTER", maximum_stack: 5, target: "RUN", effect: { kind: "HEALING_MULTIPLIER", percent: 110 }, constructor: "ModifierType" },
  { id: 7, key: "LOCK_CAPSULE", tier: "ROGUE", maximum_stack: 1, target: "RUN", effect: { kind: "LOCK_CAPSULE" }, constructor: "ModifierType" },
  { id: 100, key: "POTION", tier: "COMMON", maximum_stack: 1, target: "ONE_POKEMON", effect: { kind: "HP_RESTORE", points: 20, percent: 10 }, constructor: "PokemonHpRestoreModifierType" },
  { id: 101, key: "SUPER_POTION", tier: "COMMON", maximum_stack: 1, target: "ONE_POKEMON", effect: { kind: "HP_RESTORE", points: 50, percent: 25 }, constructor: "PokemonHpRestoreModifierType" },
  { id: 102, key: "HYPER_POTION", tier: "GREAT", maximum_stack: 1, target: "ONE_POKEMON", effect: { kind: "HP_RESTORE", points: 200, percent: 50 }, constructor: "PokemonHpRestoreModifierType" },
  { id: 103, key: "MAX_POTION", tier: "GREAT", maximum_stack: 1, target: "ONE_POKEMON", effect: { kind: "HP_RESTORE", points: 0, percent: 100 }, constructor: "PokemonHpRestoreModifierType" },
  { id: 200, key: "NUGGET", tier: "GREAT", maximum_stack: 1, target: "RUN", effect: { kind: "MONEY_REWARD", multiplier_milli: 1000 }, constructor: "MoneyRewardModifierType" },
  { id: 201, key: "BIG_NUGGET", tier: "ULTRA", maximum_stack: 1, target: "RUN", effect: { kind: "MONEY_REWARD", multiplier_milli: 2500 }, constructor: "MoneyRewardModifierType" },
  { id: 202, key: "RELIC_GOLD", tier: "ROGUE", maximum_stack: 1, target: "RUN", effect: { kind: "MONEY_REWARD", multiplier_milli: 10000 }, constructor: "MoneyRewardModifierType" },
  { id: 300, key: "RARE_CANDY", tier: "COMMON", maximum_stack: 1, target: "ONE_POKEMON", effect: { kind: "LEVEL_INCREMENT", levels: 1 }, constructor: "PokemonLevelIncrementModifierType" },
  { id: 301, key: "RARER_CANDY", tier: "ULTRA", maximum_stack: 1, target: "WHOLE_PARTY", effect: { kind: "LEVEL_INCREMENT", levels: 1 }, constructor: "AllPokemonLevelIncrementModifierType" },
  { id: 400, key: "POKEBALL", tier: "COMMON", maximum_stack: 1, target: "INVENTORY", effect: { kind: "INVENTORY_ITEM", key: "POKEBALL" }, constructor: "AddPokeballModifierType" },
  { id: 401, key: "GREAT_BALL", tier: "GREAT", maximum_stack: 1, target: "INVENTORY", effect: { kind: "INVENTORY_ITEM", key: "GREAT_BALL" }, constructor: "AddPokeballModifierType" },
];

type ModifierAcquisitionSource = "PLAYER_REWARD_POOL" | "EXOTIC_SHOP";

type ModifierPoolObservation = {
  tierValue: number | null;
  tierName: string | null;
  acquisitionSource: ModifierAcquisitionSource;
};

const GOLDEN_EXP_CHARM = "GOLDEN_EXP_CHARM";
const MODIFIER_POOL_SOURCE = "src/modifier/init-modifier-pools.ts:modifierPool";
const EXOTIC_SHOP_SOURCE = "src/data/elite-redux/er-exotic-shop.ts:buildExoticShopStock";

/**
 * The exotic stock options are generated from modifier factories without the
 * ordinary pool identity fix-up. Match the returned type by its production
 * identity fields and constructed effect, while accepting an explicitly
 * populated id when the production seam supplies one.
 */
function isSameModifierType(candidate: AnyRecord, expected: AnyRecord, path: string): boolean {
  if (candidate.id === GOLDEN_EXP_CHARM) {
    return true;
  }
  if (
    candidate.constructor?.name !== expected.constructor?.name
    || candidate.localeKey !== expected.localeKey
    || candidate.iconImage !== expected.iconImage
    || typeof candidate.newModifier !== "function"
    || typeof expected.newModifier !== "function"
  ) {
    return false;
  }
  try {
    const candidateModifier = requireRecord(candidate.newModifier({ id: 0 }), `${path}.newModifier`);
    const expectedModifier = requireRecord(expected.newModifier({ id: 0 }), `${path}.expectedModifier`);
    const candidateArgs = requireArray(candidateModifier.getArgs?.(), `${path}.modifier.getArgs`);
    const expectedArgs = requireArray(expectedModifier.getArgs?.(), `${path}.expectedModifier.getArgs`);
    return candidateArgs.length === expectedArgs.length && candidateArgs.every((value, index) => value === expectedArgs[index]);
  } catch {
    return false;
  }
}

function observeGoldenExoticStock(definition: AnyRecord, expectedType: AnyRecord): ModifierPoolObservation {
  let rawStock: readonly unknown[];
  try {
    ensureLiveTypeChartScene();
    rawStock = buildExoticShopStock();
  } catch (error) {
    if (error instanceof M4CaptureGap) {
      throw error;
    }
    gap("MODIFIER_EXOTIC_STOCK_UNOBSERVABLE", EXOTIC_SHOP_SOURCE, `${definition.key}: ${String(error)}`);
  }
  const stock = requireArray(rawStock, "exoticShopStock");
  const present = stock.some((rawEntry, index) => {
    const option = requireRecord(rawEntry, `exoticShopStock[${index}]`);
    const candidate = requireRecord(option.type, `exoticShopStock[${index}].type`);
    return isSameModifierType(candidate, expectedType, `exoticShopStock[${index}].type`);
  });
  if (!present) {
    gap(
      "MODIFIER_EXOTIC_STOCK_UNOBSERVABLE",
      EXOTIC_SHOP_SOURCE,
      `${definition.key} is absent from production exotic shop stock`,
    );
  }
  return { tierValue: null, tierName: null, acquisitionSource: "EXOTIC_SHOP" };
}

function observeModifierPool(definition: AnyRecord, expectedType: AnyRecord): ModifierPoolObservation {
  const pool = modifierPool as AnyRecord;
  for (const tierValue of Object.values(ModifierTier)) {
    if (typeof tierValue !== "number") {
      continue;
    }
    const rawEntries = pool[tierValue];
    if (rawEntries == null) {
      continue;
    }
    const entries = requireArray(rawEntries, `modifierPool[${tierValue}]`);
    for (const [index, rawEntry] of entries.entries()) {
      const weighted = requireRecord(rawEntry, `modifierPool[${tierValue}][${index}]`);
      const modifierType = requireRecord(
        weighted.modifierType,
        `modifierPool[${tierValue}][${index}].modifierType`,
      );
      if (modifierType.id !== definition.key) {
        continue;
      }
      if (definition.key === GOLDEN_EXP_CHARM) {
        gap(
          "MODIFIER_EXOTIC_POOL_UNEXPECTED",
          MODIFIER_POOL_SOURCE,
          `${definition.key} unexpectedly appears in ordinary player reward tier ${tierValue}`,
        );
      }
      const weight = weighted.weight;
      if (typeof weight !== "number" && typeof weight !== "function") {
        gap(
          "MODIFIER_POOL_SOURCE_UNOBSERVABLE",
          "src/modifier/init-modifier-pools.ts:WeightedModifierType",
          `${definition.key} has no weight capability`,
        );
      }
      if (typeof weight === "number") {
        finite(weight, `modifierPool[${tierValue}][${index}].weight`);
      }
      const maxWeight = weighted.maxWeight;
      if (typeof maxWeight !== "number" && typeof maxWeight !== "function") {
        gap(
          "MODIFIER_POOL_SOURCE_UNOBSERVABLE",
          "src/modifier/init-modifier-pools.ts:WeightedModifierType",
          `${definition.key} has no max-weight capability`,
        );
      }
      if (typeof maxWeight === "number") {
        finite(maxWeight, `modifierPool[${tierValue}][${index}].maxWeight`);
      }
      const tierName = enumName(
        ModifierTier as unknown as AnyRecord,
        tierValue,
        `modifierPool[${tierValue}].tier`,
      );
      return { tierValue, tierName, acquisitionSource: "PLAYER_REWARD_POOL" };
    }
  }
  if (definition.key === GOLDEN_EXP_CHARM) {
    return observeGoldenExoticStock(definition, expectedType);
  }
  gap(
    "MODIFIER_TIER_UNOBSERVABLE",
    MODIFIER_POOL_SOURCE,
    `${definition.key} has no player reward-pool entry`,
  );
}

function validateModifierSource(definition: AnyRecord): ModifierPoolObservation {
  const factory = (modifierTypes as AnyRecord)[definition.key];
  if (typeof factory !== "function") {
    gap("MODIFIER_REGISTRY_UNINITIALIZED", "src/modifier/modifier-type.ts:initModifierTypes", `${definition.key} is absent`);
  }
  let type: AnyRecord;
  try {
    type = requireRecord(factory(), `modifiers.${definition.key}`);
    if (typeof type.withIdFromFunc !== "function" || typeof type.withTierFromPool !== "function") {
      gap("MODIFIER_SOURCE_UNOBSERVABLE", "src/modifier/modifier-type.ts:ModifierType", `${definition.key} has no identity/tier API`);
    }
    type.withIdFromFunc(factory);
    type.withTierFromPool();
  } catch (error) {
    gap("MODIFIER_SOURCE_UNOBSERVABLE", "src/modifier/modifier-type.ts:ModifierType", `${definition.key}: ${String(error)}`);
  }
  exact(type.id, definition.key, `modifiers.${definition.key}.id`);
  const constructorName = requireString(type.constructor?.name, `modifiers.${definition.key}.constructor.name`);
  exact(constructorName, definition.constructor, `modifiers.${definition.key}.constructor.name`);
  const poolObservation = observeModifierPool(definition, type);
  const tierName = poolObservation.tierName;
  if (tierName !== definition.tier) {
    gap("MODIFIER_SOURCE_MISMATCH", MODIFIER_POOL_SOURCE, `${definition.key} tier ${tierName} expected ${definition.tier}`);
  }
  if (typeof type.newModifier !== "function") {
    gap("MODIFIER_SOURCE_UNOBSERVABLE", "src/modifier/modifier-type.ts:ModifierType.newModifier", `${definition.key} cannot construct its effect`);
  }
  let modifier: AnyRecord | null;
  try {
    modifier = type.newModifier({ id: 0 }) as AnyRecord | null;
  } catch (error) {
    gap("MODIFIER_SOURCE_UNOBSERVABLE", "src/modifier/modifier-type.ts:ModifierType.newModifier", `${definition.key}: ${String(error)}`);
  }
  if (modifier == null) {
    gap("MODIFIER_SOURCE_UNOBSERVABLE", "src/modifier/modifier-type.ts:ModifierType.newModifier", `${definition.key} produced no modifier`);
  }
  if (typeof modifier.getMaxStackCount === "function") {
    exact(safeInteger(modifier.getMaxStackCount(), `modifiers.${definition.key}.maxStackCount`), definition.maximum_stack, `modifiers.${definition.key}.maxStackCount`);
  } else if (definition.maximum_stack !== 1) {
    gap("MODIFIER_SOURCE_UNOBSERVABLE", "src/modifier/modifier.ts:PersistentModifier.getMaxStackCount", `${definition.key} has no max-stack accessor`);
  }
  const effect = definition.effect as AnyRecord;
  if (constructorName === "PokemonHpRestoreModifierType") {
    exact(safeInteger(type.restorePoints, `modifiers.${definition.key}.restorePoints`), effect.points, `modifiers.${definition.key}.restorePoints`);
    exact(safeInteger(type.restorePercent, `modifiers.${definition.key}.restorePercent`), effect.percent, `modifiers.${definition.key}.restorePercent`);
  }
  if (constructorName === "ExpBoosterModifierType") {
    const args = requireArray(modifier.getArgs?.(), `modifiers.${definition.key}.getArgs`);
    exact(safeInteger(args[0], `modifiers.${definition.key}.boostPercent`), effect.percent, `modifiers.${definition.key}.boostPercent`);
  }
  if (constructorName === "MoneyRewardModifierType") {
    const multiplier = safeInteger((type as AnyRecord).moneyMultiplier * 1000, `modifiers.${definition.key}.multiplier`);
    exact(multiplier, effect.multiplier_milli, `modifiers.${definition.key}.multiplier_milli`);
  }
  return poolObservation;
}

function selectedModifiers(slice: AnyRecord): JsonValue[] {
  const selected = requireArray(slice.modifier_ids, "modifier_ids");
  if (selected.length !== MODIFIERS.length) {
    gap("RUN_CONTENT_DEFINITION_MISMATCH", "rust/crates/er-run/src/content.rs:selected_modifier_definitions", "modifier count differs from Rust closure");
  }
  const observations: Record<string, ModifierPoolObservation> = {};
  for (const definition of MODIFIERS) {
    const entry = selected.find(raw => requireRecord(raw, "modifier_ids[]").key === definition.key);
    if (entry == null || safeInteger(requireRecord(entry, "modifier_ids[]").id, `modifier.${definition.key}.id`) !== definition.id) {
      gap("RUN_CONTENT_DEFINITION_MISMATCH", "rust/fixtures/m4/m4-slice-manifest.json:modifier_ids", `${definition.key} ID differs from Rust closure`);
    }
    observations[definition.key] = validateModifierSource(definition);
  }
  const slots: JsonValue[] = Array.from({ length: 402 }, () => null);
  for (const definition of MODIFIERS) {
    const observation = observations[definition.key];
    if (observation == null) {
      gap(
        "MODIFIER_TIER_UNOBSERVABLE",
        "src/modifier/init-modifier-pools.ts:modifierPool",
        `${definition.key} validation did not produce a pool observation`,
      );
    }
    slots[definition.id] = {
      id: definition.id,
      oracle_registry_key: definition.key,
      tier: observation.tierName,
      maximum_stack: definition.maximum_stack,
      target: definition.target,
      effect: definition.effect,
    };
  }
  return slots;
}

function selectedBiomes(slice: AnyRecord): JsonValue[] {
  const selected = requireArray(slice.biomes, "biomes");
  const expected: Record<number, { key: string; routes: number[] }> = {
    0: { key: "TOWN", routes: [1] },
    1: { key: "PLAINS", routes: [2, 4, 9] },
    2: { key: "GRASS", routes: [3] },
    4: { key: "METROPOLIS", routes: [30] },
    9: { key: "LAKE", routes: [8, 7, 26] },
    50: { key: "END", routes: [] },
  };
  const slots: JsonValue[] = Array.from({ length: 51 }, () => null);
  for (const raw of selected) {
    const entry = requireRecord(raw, "biomes[]");
    const id = safeInteger(entry.id, "biomes[].id");
    const expectedEntry = expected[id];
    if (expectedEntry == null) {
      gap("RUN_CONTENT_DEFINITION_MISMATCH", "rust/fixtures/m4/m4-slice-manifest.json:biomes", `unknown selected biome ${id}`);
    }
    const biome = allBiomes.get(id as never) as unknown;
    if (biome == null) {
      gap("BIOME_REGISTRY_UNINITIALIZED", "src/init/init-biomes.ts:allBiomes", `biome ${id} is absent`);
    }
    const live = requireRecord(biome, `biomes.${id}`);
    const key = requireString(entry.key, `biomes.${id}.key`);
    exact(key, expectedEntry.key, `biomes.${id}.key`);
    const links = requireArray(live.biomeLinks, `biomes.${id}.biomeLinks`).map((link, index) => {
      if (Array.isArray(link)) {
        return safeInteger(link[0], `biomes.${id}.biomeLinks[${index}][0]`);
      }
      return safeInteger(link, `biomes.${id}.biomeLinks[${index}]`);
    });
    if (links.length !== expectedEntry.routes.length || links.some((link, index) => link !== expectedEntry.routes[index])) {
      gap("BIOME_ROUTE_MISMATCH", "src/init/init-biomes.ts:Biome.biomeLinks", `biome ${id} routes differ from Rust closure`);
    }
    slots[id] = { id, key, base_routes: expectedEntry.routes };
  }
  return slots;
}

function runCapability(manifest: AnyRecord): JsonObject {
  exact(safeInteger(manifest.schema_version, "m4_capability.schema_version"), 1, "m4_capability.schema_version");
  exact(requireString(manifest.m4_oracle_sha, "m4_capability.m4_oracle_sha"), LEGACY_M4_ORACLE_SHA, "m4_capability.m4_oracle_sha");
  const supported = requireRecord(manifest.supported, "m4_capability.supported");
  const unsupported = requireArray(manifest.unsupported, "m4_capability.unsupported").map((entry, index) => requireString(requireRecord(entry, `m4_capability.unsupported[${index}]`).code, `m4_capability.unsupported[${index}].code`));
  return {
    schema_version: 1,
    oracle_game_sha: M4_ORACLE_SHA,
    fail_closed: true,
    supported_modes: [0, 1],
    supported_growth_rates: [3],
    supported_natures: [0, 3, 10, 15],
    modifier_registry_keys: requireArray(supported.modifier_registry_keys, "m4_capability.supported.modifier_registry_keys").map((value, index) => requireString(value, `m4_capability.supported.modifier_registry_keys[${index}]`)),
    supported_modifier_ids: [1, 2, 3, 4, 5, 6, 7, 100, 101, 102, 103, 200, 201, 202, 300, 301, 400, 401],
    regular_reward_actions: requireArray(supported.regular_reward_actions, "m4_capability.supported.regular_reward_actions").map((value, index) => requireString(value, `m4_capability.supported.regular_reward_actions[${index}]`)),
    biome_market_actions: requireArray(supported.biome_market_actions, "m4_capability.supported.biome_market_actions").map((value, index) => requireString(value, `m4_capability.supported.biome_market_actions[${index}]`)),
    biome_ids: [0, 1, 2, 4, 9, 50],
    route_rng_domains: requireArray(supported.route_rng_domains, "m4_capability.supported.route_rng_domains").map((value, index) => requireString(value, `m4_capability.supported.route_rng_domains[${index}]`)),
    encounter_sources: requireArray(supported.encounter_sources, "m4_capability.supported.encounter_sources").map((value, index) => requireString(value, `m4_capability.supported.encounter_sources[${index}]`)),
    enemy_policies: requireArray(supported.enemy_policies, "m4_capability.supported.enemy_policies").map((value, index) => requireString(value, `m4_capability.supported.enemy_policies[${index}]`)),
    unsupported,
    replica_generation_forbidden: true,
    production_typescript_changes_forbidden: true,
  };
}

function progressionDefinition(_slice: AnyRecord): JsonValue[] {
  const id = 932;
  const species = sourceSpecies(id, "progression.species");
  exact(safeInteger(species.baseExp, `progression.species.${id}.baseExp`), 56, `progression.species.${id}.baseExp`);
  exact(safeInteger(species.growthRate, `progression.species.${id}.growthRate`), 3, `progression.species.${id}.growthRate`);
  const levelMoves = [{ level: 17, move_id: 34 }];
  const currentMoves = [1, 52, 77, 78];
  for (const moveId of [...levelMoves.map(entry => entry.move_id), ...currentMoves]) {
    sourceMove(moveId, `progression.moves.${moveId}`);
  }
  const table = (pokemonSpeciesLevelMoves as AnyRecord)[id];
  if (!Array.isArray(table)) {
    gap("PROGRESSION_SOURCE_UNOBSERVABLE", "src/data/balance/pokemon-level-moves.ts:pokemonSpeciesLevelMoves", `species ${id} level move table is absent`);
  }
  sourceSpecies(933, "progression.evolution.target_species_id");
  const slots: JsonValue[] = Array.from({ length: 933 }, () => null);
  slots[id] = {
    species_id: 932,
    parity_level_before: 16,
    parity_level_after: 17,
    key: "NACLI",
    growth_rate: 3,
    base_experience: 56,
    level_moves: levelMoves,
    current_moves: currentMoves,
    evolutions: [{ target_species_id: 933, minimum_level: 23 }],
  };
  return slots;
}
function buildRunPack(slice: AnyRecord, battleHash: string): JsonObject {
  const capabilityManifest = runCapability(readJson("rust/fixtures/m4/m4-capability-manifest.json"));
  const growthRates: JsonValue[] = [null, null, null, { id: 3, key: "MEDIUM_SLOW", kind: "MEDIUM_SLOW" }];
  const natures: JsonValue[] = Array.from({ length: 16 }, () => null);
  natures[0] = { id: 0, key: "HARDY", raised_stat: null, lowered_stat: null };
  natures[3] = { id: 3, key: "ADAMANT", raised_stat: "ATTACK", lowered_stat: "SPECIAL_ATTACK" };
  natures[10] = { id: 10, key: "TIMID", raised_stat: "SPEED", lowered_stat: "ATTACK" };
  natures[15] = { id: 15, key: "MODEST", raised_stat: "SPECIAL_ATTACK", lowered_stat: "ATTACK" };
  const speciesProgression = progressionDefinition(slice);
  const modifiers = selectedModifiers(slice);
  const biomes = selectedBiomes(slice);
  const encounterPlans = [{ id: 1, biome_id: 1, source: "ORACLE_CAPTURE_REQUIRED", generation_mode: "STATIC_CAPTURED_VECTOR", enemy_policy: "SCRIPTED_ENEMY_POLICY_V1", captured_vector_key: "plains-wave-11-captured-v1" }];
  const rewardRules = { supports_reroll: true, supports_locks: true, reroll_base_cost: 250, lock_cost_tiers: [50, 125, 300, 750, 2000], selected_modifier_keys: ["LOCK_CAPSULE", "POTION", "NUGGET", "RARE_CANDY"] };
  const marketRules = { supports_reroll: false, supports_locks: false, maximum_stock_entries: 16, selected_modifier_keys: ["POKEBALL", "GREAT_BALL"] };
  const withoutHash: JsonObject = {
    schema_version: 1,
    m4_oracle_sha: M4_ORACLE_SHA,
    m3_parity_oracle_sha: M3_PARITY_ORACLE_SHA,
    battle_content_hash: `blake3-v1:${battleHash}`,
    growth_rates: growthRates,
    natures,
    species_progression: speciesProgression,
    modifiers,
    biomes,
    encounter_plans: encounterPlans,
    reward_rules: rewardRules,
    market_rules: marketRules,
    capability_manifest: capabilityManifest,
  };
  const runHash = hashRunContent(withoutHash);
  return { ...withoutHash, run_content_hash: `blake3-v1:${runHash}` };
}

/** Capture the M4 battle ContentPack and its domain-separated RunContentPack. */
export async function captureRunContent(): Promise<Record<string, JsonValue>> {
  try {
    ensureLiveRegistries();
    await launchLiveClassicBattle();
    const slice = readJson("rust/fixtures/m4/m4-slice-manifest.json");
    exact(requireString(slice.m4_oracle_sha, "m4_slice.m4_oracle_sha"), LEGACY_M4_ORACLE_SHA, "m4_slice.m4_oracle_sha");
    const battleSlice = readJson("rust/fixtures/m3/m3-slice-manifest.json");
    const capability = readJson("rust/fixtures/m3/m3-capability-manifest.json");
    const species = battleSpecies(battleSlice);
    const moves = battleMoves(battleSlice);
    const abilities = battleAbilities(battleSlice);
    const typeChart = battleTypeChart(battleSlice);
    const capabilityManifest = battleCapability(capability, moves, abilities);
    const battleWithoutHash: JsonObject = {
      schema_version: 1,
      oracle_game_sha: M4_ORACLE_SHA,
      species,
      moves,
      abilities,
      type_chart: typeChart,
      capability_manifest: capabilityManifest,
    };
    const battleHash = hashContent(battleWithoutHash);
    const runPack = buildRunPack(slice, battleHash);
    const battlePack: JsonObject = { ...battleWithoutHash, hash: `blake3-v1:${battleHash}` };
    return { battle_content_pack: battlePack, run_content_pack: runPack };
  } finally {
    teardownLiveClassicBattle();
  }
}
