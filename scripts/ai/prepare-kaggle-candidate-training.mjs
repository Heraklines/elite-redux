#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import JSZip from "jszip";

const [
  dataArg,
  dictionaryArg,
  outputArg,
  trainingProfile = "large",
  seedsArg = "20260730,20260731,20260732",
  transferArg,
  transferPretrainEpochsArg,
  tokenVocabularyArg,
  initModelArg,
] = process.argv.slice(2);
if (!dataArg || !dictionaryArg || !outputArg) {
  console.error(
    "usage: node scripts/ai/prepare-kaggle-candidate-training.mjs DATA_DIR DICTIONARY_JSON OUTPUT_ZIP [PROFILE] [SEEDS] [TRANSFER_DIR] [TRANSFER_PRETRAIN_EPOCHS] [TOKEN_VOCABULARY_JSON] [INIT_MODEL_DIR]",
  );
  process.exit(1);
}
if (!new Set(["smoke", "baseline", "large"]).has(trainingProfile)) {
  throw new Error(`unknown training profile ${trainingProfile}`);
}
const seeds = seedsArg.split(",").map(value => Number.parseInt(value, 10));
if (seeds.some(seed => !Number.isInteger(seed)) || new Set(seeds).size !== seeds.length) {
  throw new Error(`seeds must be a comma-separated list of unique integers: ${seedsArg}`);
}
const transferPretrainEpochs =
  transferPretrainEpochsArg && transferPretrainEpochsArg !== "-"
    ? Number.parseInt(transferPretrainEpochsArg, 10)
    : trainingProfile === "smoke"
      ? 1
      : trainingProfile === "baseline"
        ? 4
        : 8;
if (!Number.isInteger(transferPretrainEpochs) || transferPretrainEpochs < 0) {
  throw new Error(`transfer pretraining epochs must be a non-negative integer: ${transferPretrainEpochsArg}`);
}

const root = process.cwd();
const dataRoot = resolve(root, dataArg);
const transferRoot = transferArg && transferArg !== "-" ? resolve(root, transferArg) : undefined;
const dictionaryPath = resolve(root, dictionaryArg);
const tokenVocabularyPath =
  tokenVocabularyArg && tokenVocabularyArg !== "-" ? resolve(root, tokenVocabularyArg) : undefined;
const initModelRoot = initModelArg && initModelArg !== "-" ? resolve(root, initModelArg) : undefined;
const outputPath = resolve(root, outputArg);
if (basename(outputPath) !== "er-ai-training-bundle.zip") {
  throw new Error(`Kaggle training bundle must be named er-ai-training-bundle.zip: ${outputPath}`);
}
const sourcePaths = [
  "ml/policy/candidate_transformer.py",
  "ml/policy/train_candidate_transformer.py",
  "ml/policy/build_candidate_ensemble.py",
  "ml/policy/convert_metamon_transfer.py",
  "ml/policy/kaggle_train_entrypoint.py",
  "ml/baselines/train_candidate_baselines.py",
].map(path => resolve(root, path));

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function readCombatContractIdentity(paths) {
  const ordered = [...paths].sort((left, right) => {
    const leftPolicy = basename(left).includes("policy") ? 0 : 1;
    const rightPolicy = basename(right).includes("policy") ? 0 : 1;
    return leftPolicy - rightPolicy || left.localeCompare(right);
  });
  for (const path of ordered) {
    const stream = createReadStream(path, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    try {
      for await (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const record = JSON.parse(line);
        if (record.kind !== "combat_decision") {
          continue;
        }
        const contractSchemaVersion = Number(record.schemaVersion);
        const featureSchemaVersion = Number(record.featureSchemaVersion);
        if (!Number.isInteger(contractSchemaVersion) || !Number.isInteger(featureSchemaVersion)) {
          throw new Error(`combat decision has an invalid contract identity in ${path}`);
        }
        return { contractSchemaVersion, featureSchemaVersion };
      }
    } finally {
      lines.close();
      stream.destroy();
    }
  }
  throw new Error(`no combat_decision record found under ${dataRoot}`);
}

function portableRelative(parent, child) {
  return relative(parent, child).split(sep).join("/");
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

if (!(await stat(dictionaryPath)).isFile()) {
  throw new Error(`dictionary is not a file: ${dictionaryPath}`);
}
if (tokenVocabularyPath && !(await stat(tokenVocabularyPath)).isFile()) {
  throw new Error(`token vocabulary is not a file: ${tokenVocabularyPath}`);
}
let initModelPaths = [];
if (initModelRoot) {
  if (!(await stat(initModelRoot)).isDirectory()) {
    throw new Error(`initial model is not a directory: ${initModelRoot}`);
  }
  const configPath = resolve(initModelRoot, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const weightsName = config.weights;
  if (config.schemaVersion !== 4 || typeof weightsName !== "string" || basename(weightsName) !== weightsName) {
    throw new Error("initial model must be a schema-v4 config with one local weights filename");
  }
  const weightsPath = resolve(initModelRoot, weightsName);
  if (!(await stat(weightsPath)).isFile()) {
    throw new Error(`initial model weights are missing: ${weightsPath}`);
  }
  initModelPaths = [configPath, weightsPath];
}
const decisionPaths = (await walk(dataRoot)).filter(path => path.endsWith(".jsonl"));
if (decisionPaths.length === 0) {
  throw new Error(`no JSONL decision shards found under ${dataRoot}`);
}
const transferIsFile = transferRoot ? (await stat(transferRoot)).isFile() : false;
const transferPaths = transferRoot
  ? transferIsFile
    ? [transferRoot].filter(
        path => path.endsWith(".jsonl") || path.endsWith(".jsonl.gz") || path.endsWith(".jsonl.gzpack"),
      )
    : (await walk(transferRoot)).filter(
        path => path.endsWith(".jsonl") || path.endsWith(".jsonl.gz") || path.endsWith(".jsonl.gzpack"),
      )
  : [];
if (transferRoot && transferPaths.length === 0) {
  throw new Error(`no JSONL transfer shards found under ${transferRoot}`);
}
const contractIdentity = await readCombatContractIdentity(decisionPaths);
const parsedDictionary = JSON.parse(await readFile(dictionaryPath, "utf8"));
if (parsedDictionary?.features?.schemaVersion !== contractIdentity.featureSchemaVersion) {
  throw new Error(
    `dictionary feature schema ${parsedDictionary?.features?.schemaVersion} does not match `
      + `combat data ${contractIdentity.featureSchemaVersion}`,
  );
}
const supplementPath = resolve(dataRoot, "runtime-item-dictionary-supplement.json");
const hasDictionarySupplement = await stat(supplementPath)
  .then(entry => entry.isFile())
  .catch(() => false);

const zip = new JSZip();
const manifestFiles = [];
for (const path of decisionPaths) {
  const content = await readFile(path);
  const archivePath = `data/${portableRelative(dataRoot, path)}`;
  zip.file(archivePath, content);
  manifestFiles.push({ path: archivePath, bytes: content.length, sha256: sha256(content) });
}
for (const path of transferPaths) {
  const content = await readFile(path);
  const archivePath = `transfer-data/${transferIsFile ? basename(path) : portableRelative(transferRoot, path)}`;
  zip.file(archivePath, content);
  manifestFiles.push({ path: archivePath, bytes: content.length, sha256: sha256(content) });
}
const dictionary = await readFile(dictionaryPath);
zip.file("dictionary/er-combat-data-dictionary.json", dictionary);
manifestFiles.push({
  path: "dictionary/er-combat-data-dictionary.json",
  bytes: dictionary.length,
  sha256: sha256(dictionary),
});
if (hasDictionarySupplement) {
  const supplement = await readFile(supplementPath);
  zip.file("dictionary/runtime-item-dictionary-supplement.json", supplement);
  manifestFiles.push({
    path: "dictionary/runtime-item-dictionary-supplement.json",
    bytes: supplement.length,
    sha256: sha256(supplement),
  });
}
if (tokenVocabularyPath) {
  const vocabulary = await readFile(tokenVocabularyPath);
  zip.file("vocabulary/token-vocabulary.json", vocabulary);
  manifestFiles.push({
    path: "vocabulary/token-vocabulary.json",
    bytes: vocabulary.length,
    sha256: sha256(vocabulary),
  });
}
for (const path of initModelPaths) {
  const content = await readFile(path);
  const archivePath = `initial-model/${basename(path)}`;
  zip.file(archivePath, content);
  manifestFiles.push({ path: archivePath, bytes: content.length, sha256: sha256(content) });
}
for (const path of sourcePaths) {
  const content = await readFile(path);
  const archivePath = portableRelative(root, path);
  zip.file(archivePath, content);
  manifestFiles.push({ path: archivePath, bytes: content.length, sha256: sha256(content) });
}
const manifest = {
  schemaVersion: 1,
  ...contractIdentity,
  dictionarySchemaVersion: 3,
  neuralArtifactSchemaVersion: 4,
  trainingProfile,
  seeds,
  dataRoot: basename(dataRoot),
  transferDataRoot: transferRoot ? basename(transferRoot) : null,
  decisionShards: decisionPaths.length,
  transferShards: transferPaths.length,
  transferPretrainEpochs: transferPaths.length > 0 ? transferPretrainEpochs : 0,
  fixedTokenVocabulary: tokenVocabularyPath ? basename(tokenVocabularyPath) : null,
  initialModel: initModelRoot ? basename(initModelRoot) : null,
  dictionarySupplement: hasDictionarySupplement ? "runtime-item-dictionary-supplement.json" : null,
  files: manifestFiles.sort((a, b) => a.path.localeCompare(b.path)),
};
zip.file("bundle-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
const payload = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, payload);
console.log(
  JSON.stringify({
    output: outputPath,
    bytes: payload.length,
    decisionShards: decisionPaths.length,
    transferShards: transferPaths.length,
    files: manifest.files.length,
  }),
);
