#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

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
  "ml/policy/serve_candidate_transformer.py",
  "ml/policy/build_candidate_ensemble.py",
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
    const source = createReadStream(path);
    const stream = path.endsWith(".gz") || path.endsWith(".gzpack") ? source.pipe(createGunzip()) : source;
    stream.setEncoding("utf8");
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

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function runStreamingZip(specPath) {
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const helperPath = resolve(root, "scripts/ai/stream_zip_bundle.py");
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(python, [helperPath, specPath], { stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`streaming ZIP helper failed with ${signal ?? `exit code ${code}`}`));
      }
    });
  });
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
const decisionPaths = (await walk(dataRoot)).filter(
  path => path.endsWith(".jsonl") || path.endsWith(".jsonl.gz") || path.endsWith(".jsonl.gzpack"),
);
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

const manifestFiles = [];
const archiveEntries = [];

async function addArchiveFile(path, archivePath) {
  const fileStat = await stat(path);
  if (!fileStat.isFile()) {
    throw new Error(`training bundle input is not a file: ${path}`);
  }
  archiveEntries.push({ source: path, archivePath });
  manifestFiles.push({ path: archivePath, bytes: fileStat.size, sha256: await sha256File(path) });
}

for (const path of decisionPaths) {
  const archivePath = `data/${portableRelative(dataRoot, path)}`;
  await addArchiveFile(path, archivePath);
}
for (const path of transferPaths) {
  const archivePath = `transfer-data/${transferIsFile ? basename(path) : portableRelative(transferRoot, path)}`;
  await addArchiveFile(path, archivePath);
}
await addArchiveFile(dictionaryPath, "dictionary/er-combat-data-dictionary.json");
if (hasDictionarySupplement) {
  await addArchiveFile(supplementPath, "dictionary/runtime-item-dictionary-supplement.json");
}
if (tokenVocabularyPath) {
  await addArchiveFile(tokenVocabularyPath, "vocabulary/token-vocabulary.json");
}
for (const path of initModelPaths) {
  const archivePath = `initial-model/${basename(path)}`;
  await addArchiveFile(path, archivePath);
}
for (const path of sourcePaths) {
  const archivePath = portableRelative(root, path);
  await addArchiveFile(path, archivePath);
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
await mkdir(dirname(outputPath), { recursive: true });
const temporaryManifestPath = `${outputPath}.manifest-${process.pid}.json`;
const temporarySpecPath = `${outputPath}.spec-${process.pid}.json`;
await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
archiveEntries.push({ source: temporaryManifestPath, archivePath: "bundle-manifest.json" });
await writeFile(
  temporarySpecPath,
  `${JSON.stringify({ output: outputPath, compressionLevel: 9, entries: archiveEntries }, null, 2)}\n`,
);
try {
  await runStreamingZip(temporarySpecPath);
} finally {
  await Promise.all([rm(temporaryManifestPath, { force: true }), rm(temporarySpecPath, { force: true })]);
}
const outputStat = await stat(outputPath);
console.log(
  JSON.stringify({
    output: outputPath,
    bytes: outputStat.size,
    decisionShards: decisionPaths.length,
    transferShards: transferPaths.length,
    files: manifest.files.length,
  }),
);
