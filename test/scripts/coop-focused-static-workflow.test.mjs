/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertFocusedCandidateLimit, categorize, impactLanes } from "../../scripts/run-coop-gate.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflow = readFileSync(resolve(root, ".github/workflows/coop-focused-branch.yml"), "utf8").replaceAll(
  "\r\n",
  "\n",
);
const fullWorkflow = readFileSync(resolve(root, ".github/workflows/coop-gate-sharded.yml"), "utf8").replaceAll(
  "\r\n",
  "\n",
);
const staticGate = readFileSync(resolve(root, "scripts/run-coop-static-gate.mjs"), "utf8").replaceAll("\r\n", "\n");
const planner = readFileSync(resolve(root, "scripts/run-coop-gate.mjs"), "utf8").replaceAll("\r\n", "\n");
const soakDriver = readFileSync(resolve(root, "test/tools/coop-soak-driver.ts"), "utf8").replaceAll("\r\n", "\n");

function job(name, nextName) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  const end = workflow.indexOf(`\n  ${nextName}:\n`, start + 1);
  assert.notEqual(start, -1, `${name} job must exist`);
  assert.notEqual(end, -1, `${nextName} job must follow ${name}`);
  return workflow.slice(start, end);
}

test("focused static checks the planner's exact declared train base", () => {
  assert.match(workflow, /declared_base_sha: \$\{\{ steps\.ownership\.outputs\.base_sha \}\}/u);

  const staticJob = job("static", "gate");
  assert.match(staticJob, /needs: plan/u);
  assert.equal(
    [...staticJob.matchAll(/COOP_BASE_SHA: \$\{\{ needs\.plan\.outputs\.declared_base_sha \}\}/gu)].length,
    2,
  );
  assert.match(staticJob, /git fetch --no-tags --depth=1 origin "\$COOP_BASE_SHA"/u);
  assert.match(staticJob, /node scripts\/run-coop-static-gate\.mjs/u);
  assert.match(staticJob, /if: success\(\)[\s\S]*coop-focused-static-status\.json/u);
  assert.match(staticJob, /if: failure\(\)[\s\S]*coop-focused-static\.log/u);
});

test("focused planner deepens only task/train lineages before its full-history fallback", () => {
  const planJob = job("plan", "static");
  assert.match(planJob, /--filter=blob:none --depth=64 origin "\$train_refspec"/u);
  assert.match(planJob, /for deepen in 32 128 512 2048/u);
  assert.match(planJob, /--filter=blob:none --deepen="\$deepen" origin "\$refspec"/u);
  assert.match(
    planJob,
    /if \[ "\$needs_full_history" -eq 1 \]; then[\s\S]*--unshallow origin "\$\{full_refspecs\[@\]\}"/u,
  );
  assert.equal([...planJob.matchAll(/--unshallow/gu)].length, 1, "full history is one last-resort fallback");
  assert.doesNotMatch(planJob, /--unshallow origin "\$COOP_TASK_BRANCH"/u);
  assert.match(planJob, /git merge-base --is-ancestor "\$COOP_DECLARED_BASE" HEAD/u);
  assert.match(planJob, /git merge-base --is-ancestor "\$COOP_DECLARED_BASE" "\$train_tip"/u);
});

test("focused static accepts ignored-only metadata after the non-vacuous type ratchet", () => {
  assert.match(staticGate, /"biome",\s+"check",\s+"--no-errors-on-unmatched"/u);
  assert.match(staticGate, /"--diagnostic-level=error"/u);
  assert.match(staticGate, /"--max-diagnostics=none"/u);
});

test("focused co-op static does not inherit unchanged Showdown and tournament debt", () => {
  assert.doesNotMatch(staticGate, /file\.startsWith\("src\/data\/elite-redux\/showdown\/"\)/u);
  assert.doesNotMatch(staticGate, /file\.startsWith\("src\/phases\/showdown-"\)/u);
  assert.doesNotMatch(staticGate, /file\.startsWith\("test\/tests\/elite-redux\/showdown\/"\)/u);
  assert.match(
    staticGate,
    /diagnostic => changed\.has\(diagnostic\.file\) \|\| isCoopStaticScope\(diagnostic\.file\)/u,
    "a Showdown file still fails when this checkpoint actually changes it",
  );
});

test("full static checks only the exact candidate delta, never every change since the last all-green gate", () => {
  const start = fullWorkflow.indexOf("\n  static:\n");
  const end = fullWorkflow.indexOf("\n  public-ui-contracts:", start + 1);
  assert.notEqual(start, -1, "full static job must exist");
  assert.notEqual(end, -1, "public UI contract job must follow full static");
  const staticJob = fullWorkflow.slice(start, end);

  assert.match(staticJob, /fetch-depth: 2/u);
  assert.match(staticJob, /PUSH_BASE_SHA: \$\{\{ github\.event\.before \}\}/u);
  assert.match(staticJob, /git rev-parse "\$\{GITHUB_SHA\}\^"/u);
  assert.doesNotMatch(staticJob, /last successful full-gate base|gh api/u);
  assert.match(staticJob, /COOP_BASE_SHA=\$base/u);
});

test("focused aggregate requires static and isolated shard evidence", () => {
  assert.match(workflow, /group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/u);

  const gateJob = job("gate", "focused-required");
  assert.match(gateJob, /fail-fast: false/u);

  const requiredStart = workflow.indexOf("\n  focused-required:\n");
  assert.notEqual(requiredStart, -1, "focused-required job must exist");
  const requiredJob = workflow.slice(requiredStart);
  assert.match(requiredJob, /needs: \[plan, static, contracts, browser-build, browser, gate\]/u);
  assert.match(requiredJob, /STATIC_RESULT: \$\{\{ needs\.static\.result \}\}/u);
  assert.match(requiredJob, /test "\$STATIC_RESULT" = success/u);
  assert.match(requiredJob, /CONTRACT_RESULT: \$\{\{ needs\.contracts\.result \}\}/u);
  assert.match(requiredJob, /test "\$CONTRACT_RESULT" = success/u);
  assert.match(requiredJob, /BROWSER_SCOPE: \$\{\{ needs\.plan\.outputs\.browser_transport \}\}/u);
  assert.match(requiredJob, /test "\$BROWSER_BUILD_RESULT" = success/u);
  assert.match(requiredJob, /test "\$BROWSER_RESULT" = success/u);
});

test("full and focused gates run every co-op source and node-pure contract", () => {
  const fullStart = fullWorkflow.indexOf("\n  public-ui-contracts:\n");
  const fullEnd = fullWorkflow.indexOf("\n  gate:\n", fullStart + 1);
  assert.notEqual(fullStart, -1, "full public-ui-contracts job must exist");
  assert.notEqual(fullEnd, -1, "full gate job must follow public-ui-contracts");
  const fullContractsJob = fullWorkflow.slice(fullStart, fullEnd);

  const focusedContractsJob = job("contracts", "browser-build");
  for (const contractJob of [fullContractsJob, focusedContractsJob]) {
    assert.match(contractJob, /node --test test\/scripts\/coop-\*\.test\.mjs/u);
    assert.match(contractJob, /pnpm exec vitest run --config test\/node\/vitest\.config\.ts/u);
    assert.match(contractJob, /test\/node\/authority-v2-\*\.test\.ts/u);
    assert.match(contractJob, /test\/node\/coop-\*\.test\.ts/u);
    assert.match(contractJob, /--pool=forks --isolate --no-file-parallelism/u);
  }

  assert.match(focusedContractsJob, /needs: plan/u);
  assert.match(focusedContractsJob, /timeout-minutes: 10/u);
});

test("focused engine shards qualify the complete Authority V2 graph", () => {
  const gateJob = job("gate", "focused-required");
  for (const surface of ["TURN", "REPLACEMENT", "WAVE", "INTERACTION", "RECOVERY"]) {
    assert.match(
      gateJob,
      new RegExp(`COOP_AUTHORITY_V2_${surface}: "on"`, "u"),
      `focused shards must enable Authority V2 ${surface.toLowerCase()}`,
    );
  }
});

test("production mechanics regressions exposed by co-op soaks remain in the engine gate", () => {
  const lanes = categorize();
  assert.equal(
    lanes.B.includes("test/tests/elite-redux/er-mental-pollution-suppress.test.ts"),
    true,
    "the exact two-holder recursion regression must execute with ER_SCENARIO=1",
  );
  assert.equal(
    lanes.B.includes("test/tests/test-framework/phase-interceptor/unit.test.ts"),
    true,
    "the co-op soak interceptor contract remains engine-gating",
  );
});

test("focused planner runs every six-lane representative and fails closed beyond six shards", () => {
  const impacted = [...impactLanes(["scripts/run-coop-gate.mjs"])].sort();
  assert.deepEqual(impacted, ["A", "B", "C", "P", "S", "T"]);
  assert.deepEqual(
    assertFocusedCandidateLimit(
      impacted.map(lane => `${lane}:1/1`),
      6,
    ),
    impacted.map(lane => `${lane}:1/1`).sort(),
    "a shared harness or planner change must use all six available representative runners",
  );
  assert.throws(
    () => assertFocusedCandidateLimit([...impacted.map(lane => `${lane}:1/1`), "B:2/2"], 6),
    error =>
      error instanceof Error
      && impacted.every(lane => error.message.includes(`${lane}:1/1`))
      && error.message.includes("B:2/2")
      && /refusing to silently omit coverage/u.test(error.message),
  );
  assert.deepEqual(
    assertFocusedCandidateLimit(["B:2/4", "A:1/3", "B:2/4", "P:1/2"], 6),
    ["A:1/3", "B:2/4", "P:1/2"],
    "every unique candidate is preserved when the cap is not exceeded",
  );
  assert.match(planner, /assertFocusedCandidateLimit\(chosen\.keys\(\), maxShards\)/u);
  assert.match(workflow, /--max-shards 6/u);
  assert.match(planner, /Run the complete sharded co-op gate; refusing to silently omit coverage\./u);
  assert.doesNotMatch(planner, /\.slice\(0, maxShards\)/u);
});

test("ownership metadata does not manufacture a six-lane runtime impact", () => {
  const impacted = [
    ...impactLanes([
      ".github/coop-task-ownership/v2-example.json",
      "src/data/elite-redux/coop/authority-v2/next-control.ts",
      "test/tests/elite-redux/showdown/showdown-versus-doubles.test.ts",
      "test/tools/repro-triple-battle-bugs-3.test.ts",
    ]),
  ].sort();
  assert.deepEqual(impacted, ["A", "B", "P", "S", "T"]);
  assert.deepEqual(
    [...impactLanes([".github/workflows/coop-focused-branch.yml"])].sort(),
    ["A", "B", "C", "P", "S", "T"],
    "executable GitHub workflow changes still require every representative lane",
  );
});

test("retired authoritative Showdown specs stay loud without vetoing the active lockstep mode", () => {
  const lanes = categorize();
  const retired = [
    "test/tests/elite-redux/showdown/showdown-versus-doubles.test.ts",
    "test/tests/elite-redux/showdown/showdown-versus-faint.test.ts",
  ];
  for (const file of retired) {
    assert.equal(lanes.S.includes(file), false, `${file} must not gate the lockstep Showdown route`);
    assert.equal(lanes.Q.includes(file), true, `${file} must remain visible in non-gating evidence`);
  }
  assert.equal(
    lanes.S.includes("test/tests/elite-redux/showdown/showdown-sync-duo.test.ts"),
    true,
    "the real dual-engine lockstep replacement/command suite remains gating",
  );
});

test("a directly assigned co-op integration test does not manufacture cross-lane representatives", () => {
  assert.deepEqual(
    [...impactLanes(["test/tests/elite-redux/coop/coop-duo-fault.test.ts"])].sort(),
    [],
    "the exact B shard already covers a directly changed B test",
  );
  assert.deepEqual(
    [...impactLanes(["test/tests/elite-redux/coop/coop-transition-t2-biome.test.ts"])].sort(),
    [],
    "a production-fidelity test keeps its explicit P assignment",
  );
  assert.deepEqual(
    [...impactLanes(["test/tests/elite-redux/coop/coop-soak-me.test.ts"])].sort(),
    [],
    "a soak test keeps its explicit C assignment",
  );
});

test("representative soak partitions command actionability from the post-delivery authoritative frontier", () => {
  assert.doesNotMatch(soakDriver, /rendezvous\.reannounce\(point\)/u);
  const commandCrossing = soakDriver.slice(
    soakDriver.indexOf("const crossCommandBoundaryWithReplayGuest = async"),
    soakDriver.indexOf("/** Play ONE host wave"),
  );
  const hostCommandIndex = commandCrossing.indexOf("let hostCommand:");
  const hostStartIndex = commandCrossing.indexOf("current.start();", hostCommandIndex);
  const deliveryIndex = commandCrossing.indexOf("await pumpDuoDestinations(rig, 2);", hostStartIndex);
  const spectatorDecisionIndex = commandCrossing.indexOf("const guestCommandRequired =", deliveryIndex);
  const guestDriveIndex = commandCrossing.indexOf("let guestCommand:", spectatorDecisionIndex);
  assert.ok(
    hostStartIndex >= 0
      && deliveryIndex > hostStartIndex
      && spectatorDecisionIndex > deliveryIndex
      && spectatorDecisionIndex < guestDriveIndex,
    "seat actionability is sampled only after the authority starts and delivers its command commit",
  );
  const spectatorDecision = commandCrossing.slice(deliveryIndex, guestDriveIndex);
  assert.match(
    spectatorDecision,
    /captureCoopAuthoritativeBattleState[\s\S]*resolveCoopV2CommandFrontier\(commandState\)[\s\S]*command\.ownerSeatId === guestSeatId/u,
  );
  assert.doesNotMatch(
    spectatorDecision,
    /isClassicFinalBoss/u,
    "seat actionability comes from the committed frontier, never a local presentation heuristic",
  );
  assert.match(soakDriver, /guestCommand!\.start\(\)[\s\S]*phaseInterceptor\.to\("CommandPhase"\)/u);
});
