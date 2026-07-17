/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflow = readFileSync(resolve(root, ".github/workflows/nightly-coop-soak.yml"), "utf8").replaceAll(
  "\r\n",
  "\n",
);

function job(name, nextName) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  const end = nextName == null ? workflow.length : workflow.indexOf(`\n  ${nextName}:\n`, start + 1);
  assert.notEqual(start, -1, `${name} job must exist`);
  assert.notEqual(end, -1, `${nextName} job must follow ${name}`);
  return workflow.slice(start, end);
}

test("nightly planner freezes one checkpoint SHA and base seed before matrix fan-out", () => {
  assert.match(workflow, /run_mode:[\s\S]*calibrated-release[\s\S]*diagnostic/u);
  assert.match(workflow, /checkpoint_sha:[\s\S]*exact 40-character checkpoint SHA/u);
  assert.match(workflow, /base_seed:[\s\S]*matrix base seed/u);
  assert.match(
    workflow,
    /calibrated-release forbids soak_waves overrides; use run_mode=diagnostic/u,
  );

  const plan = job("plan", "soak");
  assert.match(plan, /candidate="\$GITHUB_SHA"/u);
  assert.match(plan, /git ls-remote origin refs\/heads\/feat\/elite-redux-port/u);
  assert.match(plan, /\^\[0-9a-fA-F\]\{40\}\$/u);
  assert.match(plan, /git fetch --no-tags --depth=1 origin "\$candidate"/u);
  assert.match(plan, /base_seed must be <= 4294757536/u);
  assert.match(plan, /target_sha=\$target_sha/u);
  assert.match(plan, /base_seed=\$base_seed/u);
  assert.match(
    job("soak", "release-attestation"),
    /BASE_SEED: \$\{\{ needs\.plan\.outputs\.base_seed \}\}/u,
    "the matrix must consume the planner's one base seed",
  );
});

test("all six profiles checkout and verify the planner's immutable SHA", () => {
  const soak = job("soak", "release-attestation");
  assert.match(soak, /needs: plan/u);
  assert.match(soak, /fail-fast: false/u);
  assert.match(soak, /max-parallel: 6/u);
  assert.equal([...soak.matchAll(/^\s+- profile: /gmu)].length, 6);
  for (const profile of ["god-a", "god-b", "god-c", "level", "me-asym", "journey"]) {
    assert.match(soak, new RegExp(`- profile: ${profile}\\n`, "u"));
  }
  assert.match(soak, /ref: \$\{\{ needs\.plan\.outputs\.target_sha \}\}/u);
  assert.doesNotMatch(soak, /ref: \$\{\{ github\.event_name/u);
  assert.match(soak, /actual_sha="\$\(git rev-parse HEAD\)"/u);
  assert.match(soak, /test "\$actual_sha" = "\$EXPECTED_SHA"/u);
  assert.match(soak, /git submodule status --recursive/u);
});

test("calibrated profile contracts are explicit and diagnostic overrides cannot taint fixed scenarios", () => {
  const soak = job("soak", "release-attestation");
  assert.equal([...soak.matchAll(/calibration_id: god-200/gu)].length, 3);
  assert.match(soak, /waves_default: "55"[\s\S]*calibration_id: level-55-faint/u);
  assert.match(
    soak,
    /profile: me-asym[\s\S]*waves_default: "fixed"[\s\S]*accepts_wave_override: false[\s\S]*accepts_seed: false[\s\S]*calibration_id: me-host-guest-plus-asym-six-turn/u,
  );
  assert.match(
    soak,
    /profile: journey[\s\S]*waves_default: "45"[\s\S]*accepts_wave_override: false[\s\S]*accepts_seed: false[\s\S]*calibration_id: journey-45-thirteen-event/u,
  );
  assert.match(
    soak,
    /if \[ "\$ACCEPTS_WAVE_OVERRIDE" = "true" \]; then[\s\S]*REQUESTED_SOAK_WAVES[\s\S]*else[\s\S]*PROFILE_SOAK_WAVES/u,
  );
});

test("each matrix leg emits a structured SHA-bound attestation", () => {
  const soak = job("soak", "release-attestation");
  assert.match(soak, /name: Write structured profile attestation/u);
  for (const field of [
    "profile",
    "targetSha",
    "checkedOutSha",
    "checkoutVerified",
    "baseSeed",
    "campaignSeed",
    "runMode",
    "calibrated",
    "calibrationId",
    "configuredWaves",
    "testPaths",
    "coverageLedger",
    "soakExit",
    "passed",
    "runId",
  ]) {
    assert.match(soak, new RegExp(`\\b${field}:`, "u"), `attestation must record ${field}`);
  }
  assert.match(soak, /name: coop-soak-attestation-\$\{\{ matrix\.profile \}\}-\$\{\{ github\.run_id \}\}/u);
  assert.match(soak, /if-no-files-found: error/u);
  assert.equal(
    [...soak.matchAll(/coverage_ledger: dev-logs\/coop-soak\/coverage-ledger\.json/gu)].length,
    3,
  );
  assert.match(soak, /coverage_ledger: dev-logs\/coop-soak\/coverage-ledger-level\.json/u);
  assert.match(soak, /name: Upload required checkpoint coverage ledger/u);
  assert.match(soak, /name: coop-soak-coverage-\$\{\{ matrix\.profile \}\}-\$\{\{ github\.run_id \}\}/u);
});

test("release aggregate requires exactly six calibrated passing profiles at one SHA", () => {
  const aggregate = job("release-attestation", null);
  assert.match(aggregate, /if: always\(\)/u);
  assert.match(aggregate, /needs: \[plan, soak\]/u);
  assert.match(aggregate, /pattern: coop-soak-attestation-\*-\$\{\{ github\.run_id \}\}/u);
  assert.match(aggregate, /pattern: coop-soak-coverage-\*-\$\{\{ github\.run_id \}\}/u);
  assert.match(aggregate, /expected \$\{expected\.size\} profile attestations/u);
  assert.match(aggregate, /run_mode=\$\{process\.env\.EXPECTED_RUN_MODE \|\| "missing"\} is diagnostic-only/u);
  assert.match(aggregate, /item\.targetSha !== process\.env\.EXPECTED_SHA/u);
  assert.match(aggregate, /item\.checkedOutSha !== process\.env\.EXPECTED_SHA/u);
  assert.match(aggregate, /item\.baseSeed !== process\.env\.EXPECTED_BASE_SEED/u);
  assert.match(aggregate, /item\.campaignSeed !== expectedCampaignSeed/u);
  assert.match(aggregate, /JSON\.stringify\(item\.testPaths\) !== JSON\.stringify\(contract\.testPaths\)/u);
  assert.match(aggregate, /item\.runMode !== "calibrated-release"/u);
  assert.match(aggregate, /item\.soakExit !== 0/u);
  assert.match(aggregate, /String\(item\.runId\) !== process\.env\.GITHUB_RUN_ID/u);
  assert.match(aggregate, /expected \$\{coverageProfiles\.length\} required coverage ledgers/u);
  assert.match(aggregate, /profileAttestation\?\.coverageLedger\?\.sha256 !== digest/u);
  assert.match(aggregate, /entry\.seed === campaignSeed/u);
  for (const surface of [
    "situation:trainerRandom",
    "situation:hostHalfExhausted",
    "situation:doublePlayerFaint",
    "operation:op:faintSwitch",
  ]) {
    assert.match(aggregate, new RegExp(`"${surface}"`, "u"));
  }
  assert.match(aggregate, /current-checkpoint probabilistic union missed/u);
  assert.match(aggregate, /coop-soak-release-attestation\.json/u);
  assert.match(aggregate, /if-no-files-found: error/u);
});
