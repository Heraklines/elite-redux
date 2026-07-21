import { execFileSync, spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workRoot = mkdtempSync(join(tmpdir(), "er-bgm-direct-test-"));
const assetsDir = join(workRoot, "assets");
const catalogPath = join(workRoot, "bgm.json");
const sourcePath = join(workRoot, "fixture.mp4");
let cleanupRequested = false;

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

async function runImporter(uploadUrl) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/import-bgm.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ASSETS_DIR: assetsDir,
        CATALOG_PATH: catalogPath,
        UPLOAD_URL: uploadUrl,
        UPLOAD_NAME: "battle-theme.mp4",
        UPLOAD_TITLE: "Direct Upload Test",
        UPLOAD_ARTIST: "ER Test Suite",
        UPLOAD_LICENSE: "original",
        UPLOAD_ATTRIBUTION: "Direct Upload Test by ER Test Suite",
        UPLOAD_SOURCE_URL: "https://example.test/source",
        IMPORT_AUTHOR: "headless-test",
        KEY_PREFIX: "direct_test",
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`direct importer exited with code ${code}`));
      }
    });
  });
}

try {
  mkdirSync(join(assetsDir, "audio", "bgm"), { recursive: true });
  writeFileSync(catalogPath, "[]\n");

  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=160x90:r=1:d=9",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=9",
    "-shortest",
    "-c:v",
    "mpeg4",
    "-c:a",
    "aac",
    sourcePath,
  ]);

  const server = createServer((request, response) => {
    if (request.url !== "/upload?token=headless") {
      response.writeHead(404).end();
      return;
    }
    if (request.method === "GET") {
      response.writeHead(200, {
        "Content-Type": "video/mp4",
        "Content-Length": statSync(sourcePath).size,
      });
      createReadStream(sourcePath).pipe(response);
      return;
    }
    if (request.method === "DELETE") {
      cleanupRequested = true;
      response.writeHead(204).end();
      return;
    }
    response.writeHead(405).end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("fixture server did not expose a TCP port");
    }
    await runImporter(`http://127.0.0.1:${address.port}/upload?token=headless`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  if (catalog.length !== 1) {
    throw new Error(`expected one catalog entry, received ${catalog.length}`);
  }
  const [track] = catalog;
  if (
    track.sourceType !== "direct-upload"
    || track.sourceFileName !== "battle-theme.mp4"
    || track.title !== "Direct Upload Test"
    || track.artist !== "ER Test Suite"
    || track.license !== "original"
    || track.importedBy !== "headless-test"
    || !/^[a-f0-9]{64}$/.test(track.sourceFileSha256)
  ) {
    throw new Error(`unexpected direct-upload catalog metadata: ${JSON.stringify(track)}`);
  }

  const output = join(assetsDir, "audio", "bgm", `${track.key}.mp3`);
  if (!existsSync(output) || statSync(output).size === 0) {
    throw new Error("normalized MP3 was not created");
  }
  const streams = JSON.parse(
    run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", output]),
  ).streams;
  if (streams.length !== 1 || streams[0].codec_type !== "audio" || streams[0].codec_name !== "mp3") {
    throw new Error(`normalized output was not audio-only MP3: ${JSON.stringify(streams)}`);
  }
  if (!cleanupRequested) {
    throw new Error("temporary upload DELETE was not requested");
  }

  console.log("Direct media importer headless test passed.");
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}
