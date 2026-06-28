import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canPublishUsageTiers, hasPublishableUsageTierSample } from "../../../workers/er-save-api/src/index";

describe("ER usage-tier publishing guard", () => {
  it("allows only the explicitly marked production worker to publish shared usage tiers", () => {
    expect(
      canPublishUsageTiers({
        PUBLISH_USAGE_TIERS: "1",
        USAGE_TIER_SOURCE: "prod",
        ER_ASSETS_TOKEN: "token",
      }),
    ).toBe(true);

    expect(
      canPublishUsageTiers({
        PUBLISH_USAGE_TIERS: "1",
        USAGE_TIER_SOURCE: "staging",
        ER_ASSETS_TOKEN: "token",
      }),
    ).toBe(false);
    expect(
      canPublishUsageTiers({
        PUBLISH_USAGE_TIERS: "0",
        USAGE_TIER_SOURCE: "prod",
        ER_ASSETS_TOKEN: "token",
      }),
    ).toBe(false);
    expect(
      canPublishUsageTiers({
        PUBLISH_USAGE_TIERS: "1",
        USAGE_TIER_SOURCE: "prod",
      }),
    ).toBe(false);
  });

  it("rejects staging-sized samples even if a publisher is otherwise enabled", () => {
    const env = { USAGE_TIER_MIN_PLAYERS: "500", USAGE_TIER_MIN_RUNS: "5000" };

    expect(hasPublishableUsageTierSample(env, 543, 9967)).toBe(true);
    expect(hasPublishableUsageTierSample(env, 314, 1850)).toBe(false);
  });

  it("keeps the checked-in wrangler configs on the intended publisher roles", () => {
    const repo = process.cwd();
    const prod = fs.readFileSync(path.join(repo, "workers/er-save-api/wrangler.toml"), "utf8");
    const staging = fs.readFileSync(path.join(repo, "workers/er-save-api/wrangler.staging.toml"), "utf8");

    expect(prod).toContain('PUBLISH_USAGE_TIERS = "1"');
    expect(prod).toContain('USAGE_TIER_SOURCE = "prod"');
    expect(staging).toContain('PUBLISH_USAGE_TIERS = "0"');
    expect(staging).toContain('USAGE_TIER_SOURCE = "staging"');
  });

  it("keeps the nightly stats dump pointed at the production D1 dataset", () => {
    const repo = process.cwd();
    const workflow = fs.readFileSync(path.join(repo, ".github/workflows/stats-nightly.yml"), "utf8");

    expect(workflow).toContain("wrangler d1 execute er-saves --remote --json");
    expect(workflow).toContain("--config workers/er-save-api/wrangler.toml");
    expect(workflow).not.toContain("wrangler.staging.toml");
    expect(workflow).not.toContain("er-saves-staging");
  });
});
