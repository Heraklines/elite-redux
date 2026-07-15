/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { buildIdPlugin, resolveBuildIdentity } from "../../plugins/vite/build-id-plugin";

const GITHUB_SHA = "a".repeat(40);
const CLOUDFLARE_SHA = "b".repeat(40);

describe("exact build identity", () => {
  it("prefers GITHUB_SHA and remains stable for the same workflow run", () => {
    const env = {
      GITHUB_SHA,
      GITHUB_RUN_ID: "29390000001",
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_WORKFLOW: "Deploy Staging\n",
      GITHUB_JOB: "build",
      GITHUB_REPOSITORY: "Heraklines/elite-redux",
      GITHUB_REF_NAME: "ci/coop/p33-closure-codex",
      CF_PAGES_COMMIT_SHA: CLOUDFLARE_SHA,
      GH_TOKEN: "must-never-appear",
    };
    const first = resolveBuildIdentity({ env, now: () => 1, entropy: () => "one" });
    const second = resolveBuildIdentity({ env, now: () => 999, entropy: () => "two" });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      source: "github",
      sha: GITHUB_SHA,
      id: `github:${GITHUB_SHA}:run-29390000001.2`,
      workflow: { runId: "29390000001", runAttempt: 2, workflow: "Deploy Staging" },
    });
    expect(JSON.stringify(first)).not.toContain("must-never-appear");
  });

  it("uses Cloudflare commit/deployment coordinates and retains only a public URL origin", () => {
    const identity = resolveBuildIdentity({
      env: {
        CF_PAGES_COMMIT_SHA: CLOUDFLARE_SHA.toUpperCase(),
        CF_PAGES_BRANCH: "staging",
        CF_PAGES_URL: "https://user:secret@abc.pages.dev/deploy?token=hidden#fragment",
      },
    });

    expect(identity.source).toBe("cloudflare");
    expect(identity.sha).toBe(CLOUDFLARE_SHA);
    expect(identity.id).toMatch(new RegExp(`^cloudflare:${CLOUDFLARE_SHA}:deploy-[0-9a-f]{12}$`, "u"));
    expect(identity.deployment).toEqual({
      provider: "cloudflare-pages",
      branch: "staging",
      url: "https://abc.pages.dev",
    });
    expect(JSON.stringify(identity)).not.toMatch(/secret|hidden|token/u);
  });

  it.each(["abcdef0", `${GITHUB_SHA}0`, `${"c".repeat(64)}0`, `${"d".repeat(20)}\n${"d".repeat(20)}`])(
    "rejects a non-exact source revision %s",
    malformedSha => {
      const identity = resolveBuildIdentity({
        env: { GITHUB_SHA: malformedSha },
        now: () => 1234,
        entropy: () => "malformed-sha",
      });

      expect(identity).toMatchObject({ source: "local", sha: null });
    },
  );

  it("keeps a unique, safe fallback for local builds", () => {
    const first = resolveBuildIdentity({ env: {}, now: () => 1234, entropy: () => "local-A!" });
    const second = resolveBuildIdentity({ env: {}, now: () => 1234, entropy: () => "local-B!" });

    expect(first.source).toBe("local");
    expect(first.id).toMatch(/^local:[a-z0-9]+:local-A$/u);
    expect(second.id).not.toBe(first.id);
  });

  it("emits the same exact identity into defines and version.json", () => {
    const plugin = buildIdPlugin({
      env: { GITHUB_SHA, GITHUB_RUN_ID: "42", GITHUB_RUN_ATTEMPT: "1" },
    });
    const config = (plugin.config as () => { define: Record<string, string> })();
    const emitted: { fileName?: string; source?: string | Uint8Array }[] = [];
    (plugin.generateBundle as (this: { emitFile: (asset: unknown) => void }) => void).call({
      emitFile: asset => emitted.push(asset as (typeof emitted)[number]),
    });

    const definedIdentity = JSON.parse(config.define.__BUILD_IDENTITY__);
    const version = JSON.parse(String(emitted.find(asset => asset.fileName === "version.json")?.source));
    expect(JSON.parse(config.define.__BUILD_ID__)).toBe(definedIdentity.id);
    expect(version).toEqual({ build: definedIdentity.id, identity: definedIdentity });
  });
});
