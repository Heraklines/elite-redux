/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");

function jobBlock(workflow, job) {
  const lines = workflow.split(/\r?\n/gu);
  const start = lines.indexOf(`  ${job}:`);
  assert.notEqual(start, -1, `workflow contains the ${job} job`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^ {2}[a-z0-9-]+:\s*$/iu.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

const workflows = [
  {
    file: ".github/workflows/coop-public-ui-journey.yml",
    fanout: ["primary-journey", "reverse-journey"],
  },
  {
    file: ".github/workflows/coop-public-ui-campaign.yml",
    fanout: ["solo-nav", "campaign"],
  },
];

for (const { file, fanout } of workflows) {
  test(`${file} checks out assets only in its once-built bundle job`, async () => {
    const workflow = await readFile(resolve(root, file), "utf8");
    assert.match(jobBlock(workflow, "browser-build"), /submodules: recursive/u);
    for (const job of fanout) {
      const block = jobBlock(workflow, job);
      assert.match(block, /fetch-depth: 1/u, `${job} uses a shallow harness checkout`);
      assert.match(block, /submodules: false/u, `${job} never repeats the asset checkout`);
      assert.doesNotMatch(block, /submodules: recursive/u, `${job} consumes the sealed bundle instead`);
      assert.match(
        block,
        /COOP_UI_ASSET_DIR: \.coop-no-local-asset-fallback/u,
        `${job} cannot consume stale assets from a reused runner`,
      );
    }
  });
}
