/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CampaignLifecycleTimeoutError,
  forceKillBrowsers,
  loadCampaignLifecyclePolicy,
  withinDeadline,
} from "./campaign-lifecycle.mjs";

test("campaign lifecycle has a finite outer deadline independent of per-wave waits", () => {
  const saved = {
    campaign: process.env.COOP_UI_CAMPAIGN_HARD_TIMEOUT_MS,
    setup: process.env.COOP_UI_SETUP_HARD_TIMEOUT_MS,
  };
  delete process.env.COOP_UI_CAMPAIGN_HARD_TIMEOUT_MS;
  delete process.env.COOP_UI_SETUP_HARD_TIMEOUT_MS;
  try {
    assert.equal(loadCampaignLifecyclePolicy().campaignTimeoutMs, 45 * 60_000);
    assert.equal(loadCampaignLifecyclePolicy().setupTimeoutMs, 12 * 60_000);
  } finally {
    if (saved.campaign == null) {
      delete process.env.COOP_UI_CAMPAIGN_HARD_TIMEOUT_MS;
    } else {
      process.env.COOP_UI_CAMPAIGN_HARD_TIMEOUT_MS = saved.campaign;
    }
    if (saved.setup == null) {
      delete process.env.COOP_UI_SETUP_HARD_TIMEOUT_MS;
    } else {
      process.env.COOP_UI_SETUP_HARD_TIMEOUT_MS = saved.setup;
    }
  }
});

test("outer deadline rejects a Puppeteer operation that never settles", async () => {
  await assert.rejects(withinDeadline(new Promise(() => {}), 20, "test campaign"), error => {
    assert.ok(error instanceof CampaignLifecycleTimeoutError);
    assert.equal(error.operation, "test campaign");
    assert.equal(error.timeoutMs, 20);
    return true;
  });
});

test("invalid lifecycle timeout cannot silently disable the guard", () => {
  const saved = process.env.COOP_UI_CAMPAIGN_HARD_TIMEOUT_MS;
  process.env.COOP_UI_CAMPAIGN_HARD_TIMEOUT_MS = "0";
  try {
    assert.throws(() => loadCampaignLifecyclePolicy(), /must be a positive integer/u);
  } finally {
    if (saved == null) {
      delete process.env.COOP_UI_CAMPAIGN_HARD_TIMEOUT_MS;
    } else {
      process.env.COOP_UI_CAMPAIGN_HARD_TIMEOUT_MS = saved;
    }
  }
});

test("failed graceful cleanup force-kills every remaining browser process", () => {
  const killed = [];
  const browser = label => ({ process: () => ({ kill: signal => killed.push([label, signal]) }) });
  forceKillBrowsers({ browsers: [browser("host"), browser("guest")] });
  assert.deepEqual(killed, [
    ["host", "SIGKILL"],
    ["guest", "SIGKILL"],
  ]);
});

test("workflow reserves artifact-upload headroom after both lifecycle backstops", async () => {
  const workflow = await readFile(
    new URL("../../../.github/workflows/coop-public-ui-campaign.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /timeout-minutes: 55/u);
  assert.match(workflow, /COOP_UI_CAMPAIGN_HARD_TIMEOUT_MS: "2700000"/u);
  assert.match(workflow, /COOP_UI_SETUP_HARD_TIMEOUT_MS: "720000"/u);
  assert.match(workflow, /timeout --signal=INT --kill-after=3m 48m/u);
  assert.match(workflow, /if: always\(\)[\s\S]*Upload compact campaign diagnosis first/u);
});

test("campaign setup has a causal first-command deadline and progress marker", async () => {
  const campaign = await readFile(new URL("campaign.mjs", import.meta.url), "utf8");
  assert.match(
    campaign,
    /withinDeadline\(setup, lifecycle\.setupTimeoutMs, "public setup through first shared command surface"\)/u,
  );
  assert.match(campaign, /setup stage failed before first shared command surface/u);
  assert.match(campaign, /setup stage completed within immutable deadline/u);
});
