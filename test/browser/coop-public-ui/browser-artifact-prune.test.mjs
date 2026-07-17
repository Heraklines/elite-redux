/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");
const prepareScript = resolve(root, "scripts", "prepare-coop-browser-artifact.mjs");
const redirectedFiles = [
  "images/pokemon/test.png",
  "audio/bgm/test.ogg",
  "battle-anims/test.json",
  "battle-anims-er/test.json",
  "fonts/test.woff2",
  "starter-colors.json",
  "exp-sprites.json",
  "biome-bgm-loop-points.json",
  "logo128.png",
  "logo512.png",
];

async function put(directory, relativePath, contents = relativePath) {
  const path = resolve(directory, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

test("the sealed public-UI artifact excludes only production-CDN redirect paths", async context => {
  const dist = await mkdtemp(resolve(tmpdir(), "coop-browser-prune-"));
  context.after(() => rm(dist, { recursive: true, force: true }));
  await put(dist, "index.html", "<!doctype html><title>sealed</title>");
  await put(dist, "assets/app.js", "console.info('kept application chunk');");
  await put(dist, "locales/en/menu.json", '{"newGame":"New Game"}');
  await Promise.all(redirectedFiles.map(path => put(dist, path)));

  const env = {
    ...process.env,
    COOP_BROWSER_DIST: dist,
    COOP_BROWSER_ASSET_SHA: "a".repeat(40),
    COOP_BROWSER_ENTRY_CONTRACT: "public-ui-v1",
    GITHUB_SHA: "b".repeat(40),
  };
  const prepared = spawnSync(process.execPath, [prepareScript], { cwd: root, env, encoding: "utf8" });
  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  assert.match(prepared.stdout, /pruned 10 production-CDN path/u);

  await Promise.all(redirectedFiles.map(path => assert.rejects(access(resolve(dist, path)))));
  await access(resolve(dist, "assets", "app.js"));
  await access(resolve(dist, "locales", "en", "menu.json"));
  const manifest = JSON.parse(await readFile(resolve(dist, "coop-browser-artifact.json"), "utf8"));
  assert.equal(
    manifest.files.some(file => redirectedFiles.includes(file.path)),
    false,
  );
  assert.equal(
    manifest.files.some(file => file.path === "assets/app.js"),
    true,
  );

  const verified = spawnSync(process.execPath, [prepareScript, "--verify"], { cwd: root, env, encoding: "utf8" });
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);
  assert.match(verified.stdout, /verified immutable co-op browser artifact/u);
});
