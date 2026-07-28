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
    assert.equal(loadCampaignLifecyclePolicy().setupTimeoutMs, 20 * 60_000);
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

test("workflow reserves artifact-upload headroom and budgets the real-animation surface independently", async () => {
  const workflow = await readFile(
    new URL("../../../.github/workflows/coop-public-ui-campaign.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /timeout-minutes: \$\{\{ matrix\.job_timeout_minutes \}\}/u);
  assert.match(
    workflow,
    /profile: "animations-on-surface", artifact: "surface", waves: \$surfaceWaves,[\s\S]*campaign_timeout_ms: "3120000",[\s\S]*process_timeout: "55m", job_timeout_minutes: 65/u,
  );
  assert.match(workflow, /profile: "animations-skipped-depth"[\s\S]*campaign_timeout_ms: "2700000"/u);
  assert.match(
    workflow,
    /profile: "animations-skipped-depth", artifact: "depth"[\s\S]*difficulty: "youngster", difficulty_option: "youngster"/u,
    "the long depth lane measures sustained co-op on the survivable real difficulty",
  );
  assert.match(
    workflow,
    /artifact: "dirty"[\s\S]*difficulty: "ace", difficulty_option: "ace"/u,
    "the short dirty-account lane retains hard-combat coverage",
  );
  assert.match(
    workflow,
    /artifact: "mystery"[\s\S]*campaign_timeout_ms: "4800000"[\s\S]*process_timeout: "83m", job_timeout_minutes: 90/u,
    "the exact ten-wave mystery lane is not killed by the old five-wave hosted-runner ceiling",
  );
  assert.match(
    workflow,
    /SELECTED_PROFILE:[\s\S]*jq -c --arg selected "\$SELECTED_PROFILE" '\[\.\[\] \| select\(\.artifact == \$selected\)\]'/u,
    "manual iteration can isolate one expensive campaign profile without weakening full/nightly qualification",
  );
  assert.match(
    workflow,
    /group: coop-public-ui-campaign-\$\{\{ github\.ref \}\}-\$\{\{ \(github\.event_name == 'workflow_dispatch' && inputs\.campaign_profile\) \|\| github\.event_name \}\}/u,
    "different targeted profile runs can occupy separate hosted machines instead of queueing behind one ref-wide lock",
  );
  assert.match(workflow, /COOP_UI_CAMPAIGN_HARD_TIMEOUT_MS: \$\{\{ matrix\.campaign_timeout_ms \}\}/u);
  assert.match(workflow, /COOP_UI_SETUP_HARD_TIMEOUT_MS: "1200000"/u);
  assert.match(workflow, /timeout --signal=INT --kill-after=3m \$\{\{ matrix\.process_timeout \}\}/u);
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

test("cold journeys preserve simultaneous disconnect while staggering renderer boot per virtual device", async () => {
  const harness = await readFile(new URL("public-ui-harness.mjs", import.meta.url), "utf8");
  const journeys = await readFile(new URL("journeys.mjs", import.meta.url), "utf8");
  assert.match(
    harness,
    /async coldReopenClients\(\)[\s\S]*Promise\.all\(clients\.map\(client => client\.prepareReopen\(\)\)\)[\s\S]*for \(const client of clients\)[\s\S]*await client\.open\(\)/u,
    "both old pages close together but CPU-heavy Phaser boots do not compete on one CI machine",
  );
  assert.match(
    harness,
    /async coldReplaceContextsAndLogin\(\)[\s\S]*Promise\.all\(clients\.map\(client => client\.prepareEmptyContext\(\)\)\)[\s\S]*for \(const client of clients\)[\s\S]*await client\.open\(\)/u,
    "brand-new contexts use the same per-device boot discipline",
  );
  assert.doesNotMatch(
    journeys,
    /Promise\.all\(Object\.values\(rig\.clients\)\.map\(client => client\.reopen\(\)\)\)/u,
    "no journey bypasses the contention-safe rig boundary",
  );
});
