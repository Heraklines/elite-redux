import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SCHEMA_VERSION = 1;
export const PROJECT_NAME = "PokéRogue Redux";
export const ORACLE_GAME_SHA = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
export const ORACLE_PROTOCOL_VERSION = "er-coop-47";
export const ACTIVE_PROTOCOL_VERSION = "er-coop-48";
export const EXPECTED_PROTOCOL_VERSION = ACTIVE_PROTOCOL_VERSION;
export const FIXTURE_DIGEST_KIND = "fixture-content-sha256-v1";
export const FIXTURE_DIGEST_DESCRIPTION =
  "SHA-256 over UTF-8 bytes of stable JSON.stringify(stableValue(payload)); object keys are code-point lexicographic and no trailing newline is included.";
export const FIXTURE_DIRECTORY = "test/kernel-fixtures/v1";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const SOURCE_FILES = Object.freeze({
  buttons: "src/enums/buttons.ts",
  gameModes: "src/enums/game-modes.ts",
  appConstants: "src/constants/app-constants.ts",
  inputController: "src/inputs-controller.ts",
  uiInputs: "src/ui-inputs.ts",
  coopTransport: "src/data/elite-redux/coop/coop-transport.ts",
  authorityContract: "src/data/elite-redux/coop/authority-v2/contract.ts",
  authorityEntry: "src/data/elite-redux/coop/authority-v2/authority-entry.ts",
  nextControl: "src/data/elite-redux/coop/authority-v2/next-control.ts",
  frameCodec: "src/data/elite-redux/coop/authority-v2/frame-codec.ts",
  protocolValidator: "src/data/elite-redux/coop/authority-v2/protocol-validator.ts",
  frameContext: "src/data/elite-redux/coop/authority-v2/frame-context.ts",
  checkpoint: "src/data/elite-redux/coop/coop-battle-checkpoint.ts",
  replayTrace: "src/data/elite-redux/replay-trace.ts",
  keyboardConfig: "src/configs/inputs/cfg-keyboard-qwerty.ts",
  genericPadConfig: "src/configs/inputs/pad-generic.ts",
  dualshockPadConfig: "src/configs/inputs/pad-dualshock.ts",
  proconPadConfig: "src/configs/inputs/pad-procon.ts",
  snesPadConfig: "src/configs/inputs/pad-unlicensed-snes.ts",
  xboxPadConfig: "src/configs/inputs/pad-xbox360.ts",
});

/**
 * Active M3 protocol sources are intentionally allowed to advance beyond the
 * immutable oracle tree. Their extracted values are still checked by the
 * schema builder and committed fixtures, while all other consumed sources
 * remain byte-pinned to the oracle.
 */
export const ACTIVE_M3_SOURCE_FILES = Object.freeze([
  SOURCE_FILES.coopTransport,
  SOURCE_FILES.nextControl,
  SOURCE_FILES.frameCodec,
  SOURCE_FILES.protocolValidator,
]);

const INPUT_CONFIGS = Object.freeze([
  ["keyboard", SOURCE_FILES.keyboardConfig, "CFG_KEYBOARD_QWERTY"],
  ["pad-dualshock", SOURCE_FILES.dualshockPadConfig, "PAD_DUALSHOCK"],
  ["pad-generic", SOURCE_FILES.genericPadConfig, "PAD_GENERIC"],
  ["pad-procon", SOURCE_FILES.proconPadConfig, "PAD_PROCON"],
  ["pad-unlicensed-snes", SOURCE_FILES.snesPadConfig, "PAD_UNLICENSED_SNES"],
  ["pad-xbox360", SOURCE_FILES.xboxPadConfig, "PAD_XBOX360"],
]);

function fail(message) {
  throw new Error(`[kernel-fixtures] ${message}`);
}

export function normalizeSourcePath(value) {
  return value.replaceAll("\\", "/");
}

export function sourcePath(root, value) {
  return normalizeSourcePath(relative(root, value));
}

export function readSource(root, relativePath) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) {
    fail(`required source file is missing: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

/**
 * Prove that this checkout is a descendant of the pinned oracle and that every
 * non-active production source consumed by the exporter is byte-identical to
 * that oracle tree. The active M3 protocol inputs are validated by extraction
 * and committed fixtures; unrelated source drift or an unrelated base is a
 * closed failure.
 */
export function verifyOracleSha(root = ROOT) {
  let actual;
  try {
    actual = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    fail(`cannot verify git HEAD: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    execFileSync("git", ["-C", root, "cat-file", "-e", `${ORACLE_GAME_SHA}^{commit}`], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    fail(
      `oracle commit ${ORACLE_GAME_SHA} is not available: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", ORACLE_GAME_SHA, actual], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    fail(
      `HEAD ${actual} is not a descendant of oracle ${ORACLE_GAME_SHA}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const relativePath of Object.values(SOURCE_FILES)) {
    try {
      execFileSync("git", ["-C", root, "cat-file", "-e", `${ORACLE_GAME_SHA}:${relativePath}`], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      if (!ACTIVE_M3_SOURCE_FILES.includes(relativePath)) {
        execFileSync(
          "git",
          ["-C", root, "diff", "--quiet", "--no-ext-diff", ORACLE_GAME_SHA, "--", relativePath],
          { stdio: ["ignore", "ignore", "pipe"] },
        );
      }
    } catch {
      fail(
        `consumed source is unavailable or unexpectedly drifted from oracle ${ORACLE_GAME_SHA}: ${relativePath}`,
      );
    }
  }
  return actual;
}

/** Return the contents enclosed by the first matching pair after marker. */
function balancedContents(source, marker, open, close) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    fail(`could not find source marker ${JSON.stringify(marker)}`);
  }
  const openIndex = source.indexOf(open, markerIndex + marker.length);
  if (openIndex < 0) {
    fail(`could not find ${open} after source marker ${JSON.stringify(marker)}`);
  }

  return balancedContentsAt(source, openIndex, open, close);
}

function balancedContentsAt(source, openIndex, open, close, label = "source") {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, index);
      }
    }
  }
  fail(`unclosed ${open}${close} block after ${label}`);
}

function objectContents(source, marker) {
  return balancedContents(source, marker, "{", "}");
}

function arrayContents(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    fail(`could not find source marker ${JSON.stringify(marker)}`);
  }
  // A typed const such as `readonly CoopFrameTypeV2[] = [` contains a type
  // annotation array before the value array. Start after the assignment so
  // extraction cannot accidentally return the `[]` from the type.
  const lineEnd = source.indexOf("\n", markerIndex + marker.length);
  const assignmentIndex = source.indexOf("=", markerIndex + marker.length);
  const hasSameLineAssignment = assignmentIndex >= 0 && (lineEnd < 0 || assignmentIndex < lineEnd);
  const valueIndex = source.indexOf("[", hasSameLineAssignment ? assignmentIndex + 1 : markerIndex + marker.length);
  if (valueIndex < 0) {
    fail(`could not find value array after source marker ${JSON.stringify(marker)}`);
  }
  return balancedContentsAt(source, valueIndex, "[", "]", `source marker ${JSON.stringify(marker)}`);
}

function stripLineComments(source) {
  return source.replace(/\/\/.*$/gmu, "");
}

function parseQuotedString(value, context) {
  const match = value.trim().match(/^(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)')$/u);
  if (!match) {
    fail(`expected a quoted string for ${context}, got ${JSON.stringify(value.trim())}`);
  }
  return JSON.parse(match[1] === undefined ? `"${match[2]}"` : `"${match[1]}"`);
}

function parseConstString(source, name) {
  const pattern = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(["'])([^"']+)\\1`, "u");
  const match = source.match(pattern);
  if (!match) {
    fail(`could not extract string constant ${name}`);
  }
  return match[2];
}

function parseConstExpression(source, name) {
  const pattern = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*([^;\\r\\n]+)`, "u");
  const match = source.match(pattern);
  if (!match) {
    fail(`could not extract expression constant ${name}`);
  }
  return match[1].trim();
}

function parseConstNumber(source, name) {
  const pattern = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(-?\\d+)`, "u");
  const match = source.match(pattern);
  if (!match) {
    fail(`could not extract numeric constant ${name}`);
  }
  return Number(match[1]);
}

function parseStringArray(source, name) {
  const body = arrayContents(source, `export const ${name}`);
  return [...body.matchAll(/(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)')/gu)].map(match =>
    JSON.parse(match[1] === undefined ? `"${match[2]}"` : `"${match[1]}"`),
  );
}

function parseNumberArray(source, name) {
  const body = arrayContents(source, `export const ${name}`);
  return [...body.matchAll(/-?\d+/gu)].map(match => Number(match[0]));
}

function parseStringEnum(source, enumName) {
  const body = balancedContents(source, `enum ${enumName}`, "{", "}");
  const members = [];
  let nextValue = 0;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\/\/.*$/u, "").trim();
    if (!line) {
      continue;
    }
    const member = line.match(/^([A-Z][A-Z0-9_]*)\s*(?:=\s*([^,]+))?,?$/u);
    if (!member) {
      continue;
    }
    let value;
    if (member[2] === undefined) {
      value = nextValue;
    } else if (/^-?\d+$/u.test(member[2].trim())) {
      value = Number(member[2].trim());
    } else {
      value = parseQuotedString(member[2].trim(), `${enumName}.${member[1]}`);
    }
    members.push({ name: member[1], value });
    if (typeof value === "number") {
      nextValue = value + 1;
    }
  }
  if (members.length === 0) {
    fail(`enum ${enumName} had no extractable members`);
  }
  return members;
}

function parseAuthorityEntryKinds(contractSource) {
  const typeStart = contractSource.indexOf("export type CoopAuthorityEntryKind");
  if (typeStart < 0) {
    fail("could not find CoopAuthorityEntryKind union");
  }
  const typeEnd = contractSource.indexOf(";", typeStart);
  if (typeEnd < 0) {
    fail("CoopAuthorityEntryKind union has no terminator");
  }
  return [...contractSource.slice(typeStart, typeEnd).matchAll(/"([A-Z][A-Z_]*)"/gu)].map(match => match[1]);
}

function parseNextControlKinds(contractSource) {
  const typeStart = contractSource.indexOf("export type CoopNextControl");
  const typeEnd = contractSource.indexOf(";", contractSource.indexOf("export type CoopRecoveryNextControl", typeStart));
  if (typeStart < 0 || typeEnd < 0) {
    fail("could not bound CoopNextControl union");
  }
  return [...contractSource.slice(typeStart, typeEnd).matchAll(/readonly kind:\s*"([A-Z_]+)"/gu)].map(
    match => match[1],
  );
}

function parseNextControlAuthorityKinds(nextControlSource) {
  const body = arrayContents(nextControlSource, "const AUTHORITY_ENTRY_KINDS");
  return [...body.matchAll(/"([A-Z][A-Z_]*)"/gu)].map(match => match[1]);
}

function parseObjectEntries(source, marker) {
  const body = stripLineComments(objectContents(source, marker));
  const entries = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("...")) {
      continue;
    }
    const match = line.match(/^(?:\[\s*([^\]]+)\s*\]|([A-Z][A-Z0-9_]*))\s*:\s*(.*?)(?:,\s*)?$/u);
    if (!match) {
      continue;
    }
    entries.push({ keyExpression: match[1] ?? match[2], valueExpression: match[3].trim() });
  }
  return entries;
}

function parseComputedSettings(source, marker) {
  const body = stripLineComments(objectContents(source, marker));
  return [
    ...body.matchAll(
      /\[\s*(?:SettingKeyboard|SettingGamepad)\.([A-Z][A-Z0-9_]*)\s*\]\s*:\s*Button\.([A-Z][A-Z0-9_]*)/gu,
    ),
  ].map(match => ({ setting: match[1], button: match[2] }));
}

function parseBlacklist(source) {
  if (!source.includes("blacklist:")) {
    return [];
  }
  const body = stripLineComments(arrayContents(source, "blacklist:"));
  return [...body.matchAll(/(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)')/gu)].map(match =>
    JSON.parse(match[1] === undefined ? `"${match[2]}"` : `"${match[1]}"`),
  );
}

function parseLiteralValue(expression, context) {
  const value = expression.trim();
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return Number(value);
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return parseQuotedString(value, context);
  }
  return value;
}

function settingButton(setting, buttonMembers, context) {
  if (setting === "UNBOUND") {
    return { buttonName: "UNBOUND", buttonValue: -1 };
  }
  const base = setting.replace(/^ALT_/u, "");
  if (!base.startsWith("BUTTON_")) {
    fail(`unsupported input setting ${setting} in ${context}`);
  }
  const buttonName = base.slice("BUTTON_".length);
  const button = buttonMembers.find(member => member.name === buttonName);
  if (!button) {
    fail(`input setting ${setting} refers to missing Button.${buttonName} in ${context}`);
  }
  return { buttonName, buttonValue: button.value };
}

function parseInputConfig(root, id, relativePath, exportName, buttonMembers) {
  const source = readSource(root, relativePath);
  const sourceFile = normalizeSourcePath(relativePath);
  const padIdMatch = source.match(/\bpadID:\s*(["'])(.*?)\1/u);
  const padTypeMatch = source.match(/\bpadType:\s*(["'])(.*?)\1/u);
  if (!padIdMatch || !padTypeMatch) {
    fail(`input config ${exportName} is missing padID/padType`);
  }

  const deviceEntries = parseObjectEntries(source, "deviceMapping:");
  const deviceMapping = {};
  for (const entry of deviceEntries) {
    const expression = entry.valueExpression;
    const phaser = expression.match(/^Phaser\.Input\.Keyboard\.KeyCodes\.([A-Z0-9_]+)$/u);
    if (phaser) {
      deviceMapping[entry.keyExpression] = {
        keycode: null,
        keycode_status: "unresolved-phaser-constant",
        source_expression: expression,
        source_constant: phaser[1],
      };
      continue;
    }
    const keycode = parseLiteralValue(expression, `${sourceFile}:${entry.keyExpression}`);
    if (typeof keycode !== "number" || !Number.isSafeInteger(keycode)) {
      fail(`input device mapping ${sourceFile}:${entry.keyExpression} is not a source integer`);
    }
    deviceMapping[entry.keyExpression] = {
      keycode,
      keycode_status: "resolved-source-literal",
      source_expression: expression,
    };
  }

  const icons = {};
  for (const entry of parseObjectEntries(source, "icons:")) {
    icons[entry.keyExpression] = parseQuotedString(entry.valueExpression, `${sourceFile}:${entry.keyExpression}`);
  }

  const settingEntries = parseComputedSettings(source, "settings:");
  const settingsByMode = {};
  for (const mode of ["production", "development"]) {
    const settings = {};
    for (const entry of settingEntries) {
      // CFG_KEYBOARD_QWERTY conditionally adds this setting under isDev; the
      // two mode variants keep the source's conditional behavior explicit.
      if (entry.setting === "BUTTON_DEV_CUSTOM" && mode !== "development") {
        continue;
      }
      settingButton(entry.setting, buttonMembers, `${sourceFile}:settings`);
      settings[entry.setting] = {
        button_name: entry.button,
        button_value: buttonMembers.find(member => member.name === entry.button)?.value,
        source_expression: `Button.${entry.button}`,
      };
      if (settings[entry.setting].button_value === undefined) {
        fail(`settings entry ${entry.setting} refers to missing Button.${entry.button} in ${sourceFile}`);
      }
    }
    settingsByMode[mode] = settings;
  }

  const defaultEntries = parseObjectEntries(source, "default:");
  const defaultsByMode = {};
  for (const mode of ["production", "development"]) {
    const defaults = {};
    for (const entry of defaultEntries) {
      const conditional = entry.valueExpression.match(
        /^isDev\s*\?\s*(?:SettingKeyboard|SettingGamepad)\.([A-Z][A-Z0-9_]*)\s*:\s*(-?\d+)$/u,
      );
      let setting;
      const sourceExpression = entry.valueExpression;
      if (conditional) {
        setting = mode === "development" ? conditional[1] : "UNBOUND";
      } else {
        const settingMatch = entry.valueExpression.match(/(?:SettingKeyboard|SettingGamepad)\.([A-Z][A-Z0-9_]*)/u);
        setting = settingMatch ? settingMatch[1] : "UNBOUND";
        if (setting === "UNBOUND" && !/^-?1$/u.test(entry.valueExpression)) {
          fail(`unresolved default mapping ${sourceFile}:${entry.keyExpression} = ${entry.valueExpression}`);
        }
      }
      const resolved = settingButton(setting, buttonMembers, `${sourceFile}:${entry.keyExpression}`);
      defaults[entry.keyExpression] = {
        setting,
        button_name: resolved.buttonName,
        button_value: resolved.buttonValue,
        source_expression: sourceExpression,
      };
    }
    defaultsByMode[mode] = defaults;
  }

  const blacklist = parseBlacklist(source);
  return {
    id,
    export_name: exportName,
    source_file: sourceFile,
    pad_id: padIdMatch[2],
    pad_type: padTypeMatch[2],
    device_mapping: deviceMapping,
    icons,
    settings_by_mode: settingsByMode,
    defaults_by_mode: defaultsByMode,
    blacklist,
  };
}

function assertEqualArrays(label, left, right) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    fail(`${label} differs between pinned source declarations: ${JSON.stringify(left)} vs ${JSON.stringify(right)}`);
  }
}

export function buildSchema(root = ROOT) {
  verifyOracleSha(root);
  const source = Object.fromEntries(
    Object.entries(SOURCE_FILES).map(([key, relativePath]) => [key, readSource(root, relativePath)]),
  );

  const buttons = parseStringEnum(source.buttons, "Button");
  const gameModes = parseStringEnum(source.gameModes, "GameModes");
  const devModeExpression = parseConstExpression(source.appConstants, "isDev");
  const fallbackConfigMatches = [
    ...source.inputController.matchAll(/return\s+(PAD_[A-Z0-9_]+)\s+as\s+InterfaceConfig;/gu),
  ];
  const fallbackConfig = fallbackConfigMatches.at(-1)?.[1];
  if (fallbackConfig === undefined) {
    fail("could not extract the gamepad fallback config from inputs-controller.ts");
  }
  const pairingProtocolVersion = parseConstString(source.coopTransport, "COOP_PROTOCOL_VERSION");
  if (pairingProtocolVersion !== EXPECTED_PROTOCOL_VERSION) {
    fail(`pinned source protocol is ${pairingProtocolVersion}, expected ${EXPECTED_PROTOCOL_VERSION}`);
  }
  const authorityFrameProtocolVersion = parseConstNumber(source.frameCodec, "COOP_FRAME_PROTOCOL_VERSION");
  const authorityFrameTypes = parseStringArray(source.frameCodec, "COOP_FRAME_TYPES_V2");
  const authorityEntryKinds = parseAuthorityEntryKinds(source.authorityContract);
  const authorityEntryKindsFromNextControl = parseNextControlAuthorityKinds(source.nextControl);
  assertEqualArrays("authority entry kinds", authorityEntryKinds, authorityEntryKindsFromNextControl);
  const ackStages = (() => {
    const start = source.authorityContract.indexOf("export type CoopAckStage");
    const end = source.authorityContract.indexOf(";", start);
    return [...source.authorityContract.slice(start, end).matchAll(/"([a-zA-Z]+)"/gu)].map(match => match[1]);
  })();
  const nextControlKinds = parseNextControlKinds(source.authorityContract);
  const replayTraceVersion = parseConstNumber(source.replayTrace, "REPLAY_TRACE_VERSION");
  const supportedReplayTraceVersions = parseNumberArray(source.replayTrace, "SUPPORTED_REPLAY_TRACE_VERSIONS");
  const interactionSurfaces = (() => {
    const body = objectContents(source.nextControl, "const V2_INTERACTION_SURFACES");
    return [...body.matchAll(/"(op:[a-zA-Z]+)"\s*:\s*true/gu)].map(match => match[1]);
  })();
  const interactionOperationSurfaces = (() => {
    const body = objectContents(source.nextControl, "const V2_INTERACTION_OPERATION_SURFACES");
    const result = {};
    for (const line of body.split("\n")) {
      const match = line.trim().match(/^([A-Z][A-Z0-9_]*)\s*:\s*\[([^\]]*)\]/u);
      if (!match) {
        continue;
      }
      result[match[1]] = [...match[2].matchAll(/"(op:[a-zA-Z]+)"/gu)].map(item => item[1]);
    }
    return result;
  })();
  const inputConfigs = INPUT_CONFIGS.map(([id, relativePath, exportName]) =>
    parseInputConfig(root, id, relativePath, exportName, buttons),
  );

  return {
    source_files: Object.fromEntries(
      Object.entries(SOURCE_FILES).map(([key, relativePath]) => [key, normalizeSourcePath(relativePath)]),
    ),
    buttons: {
      enum: "Button",
      members: buttons,
    },
    game_modes: {
      enum: "GameModes",
      members: gameModes,
    },
    protocol: {
      pairing_version: pairingProtocolVersion,
      authority_frame_protocol_version: authorityFrameProtocolVersion,
      authority_frame_types: authorityFrameTypes,
    },
    authority_v2: {
      entry_kinds: authorityEntryKinds,
      ack_stages: ackStages,
      next_control_kinds: nextControlKinds,
      interaction_surfaces: interactionSurfaces,
      interaction_operation_surfaces: interactionOperationSurfaces,
    },
    replay_trace: {
      version: replayTraceVersion,
      supported_versions: supportedReplayTraceVersions,
    },
    input_maps: {
      configs: inputConfigs,
      dev_mode_expression: `${normalizeSourcePath(SOURCE_FILES.appConstants)}: isDev = ${devModeExpression}`,
      fallback_config: fallbackConfig,
    },
  };
}

export function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
        .map(key => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

export function fixtureContentDigest(payload) {
  const canonical = JSON.stringify(stableValue(payload));
  return createHash("sha256").update(Buffer.from(canonical, "utf8")).digest("hex");
}

export function makeEnvelope(payload, sourceFile, digestKind = FIXTURE_DIGEST_KIND) {
  return {
    schema_version: SCHEMA_VERSION,
    project_name: PROJECT_NAME,
    oracle_game_sha: ORACLE_GAME_SHA,
    protocol_version: EXPECTED_PROTOCOL_VERSION,
    source_file: normalizeSourcePath(sourceFile),
    digest_kind: digestKind,
    digest_definition: FIXTURE_DIGEST_DESCRIPTION,
    canonical_digest: fixtureContentDigest(payload),
    payload,
  };
}

export function writeJson(root, relativePath, value) {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const content = stableJson(value);
  if (!existsSync(absolutePath) || readFileSync(absolutePath, "utf8") !== content) {
    writeFileSync(absolutePath, content, "utf8");
  }
  return relativePath;
}

function schemaEnvelope(schema) {
  return makeEnvelope(schema, "scripts/export-kernel-schema.mjs");
}

export function exportSchema(root = ROOT) {
  const schema = buildSchema(root);
  writeJson(root, join(FIXTURE_DIRECTORY, "schema.json"), schemaEnvelope(schema));
  return schema;
}

function isMainModule() {
  return process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  exportSchema(ROOT);
}
