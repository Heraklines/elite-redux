/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync as readFileRaw } from "node:fs";
import { test } from "node:test";

// These contracts slice product source by structural markers ("\n}\n", "\n/**\n * ...").
// Read every file as LF so the pins resolve identically on CI (LF checkout) and on a
// CRLF (Windows autocrlf) working tree; normalization changes no assertion, only the
// line-ending bytes the boundary markers scan across.
const readFileSync = (path, encoding) => readFileRaw(path, encoding).replace(/\r\n/gu, "\n");

const root = new URL("../../../", import.meta.url);
const gateWorkflow = readFileSync(new URL(".github/workflows/coop-gate-sharded.yml", root), "utf8");
const campaignWorkflow = readFileSync(new URL(".github/workflows/coop-public-ui-campaign.yml", root), "utf8");
const journeyWorkflow = readFileSync(new URL(".github/workflows/coop-public-ui-journey.yml", root), "utf8");
const focusedSoakWorkflow = readFileSync(new URL(".github/workflows/coop-soak-focused.yml", root), "utf8");
const nightlySoakWorkflow = readFileSync(new URL(".github/workflows/nightly-coop-soak.yml", root), "utf8");
const stagingWorkflow = readFileSync(new URL(".github/workflows/deploy-staging.yml", root), "utf8");
const coopRuntime = readFileSync(new URL("src/data/elite-redux/coop/coop-runtime.ts", root), "utf8");
const coopBattleEngine = readFileSync(new URL("src/data/elite-redux/coop/coop-battle-engine.ts", root), "utf8");
const battleStream = readFileSync(new URL("src/data/elite-redux/coop/coop-battle-stream.ts", root), "utf8");
const turnRecorder = readFileSync(new URL("src/data/elite-redux/coop/coop-turn-recorder.ts", root), "utf8");
const turnCutover = readFileSync(new URL("src/data/elite-redux/coop/authority-v2/cutover-turn.ts", root), "utf8");
const meOperation = readFileSync(new URL("src/data/elite-redux/coop/coop-me-operation.ts", root), "utf8");
const mePresentation = readFileSync(new URL("src/data/elite-redux/coop/coop-me-presentation.ts", root), "utf8");
const operationSurfaceRegistry = readFileSync(
  new URL("src/data/elite-redux/coop/coop-operation-surface-registry.ts", root),
  "utf8",
);
const sessionController = readFileSync(new URL("src/data/elite-redux/coop/coop-session-controller.ts", root), "utf8");
const duoHarness = readFileSync(new URL("test/tools/coop-duo-harness.ts", root), "utf8");
const publicUiHarness = readFileSync(new URL("test/browser/coop-public-ui/public-ui-harness.mjs", root), "utf8");
const browserEntry = readFileSync(new URL("scripts/coop-browser-entry.ts", root), "utf8");
const soloClassic = readFileSync(new URL("test/browser/coop-public-ui/solo-classic.mjs", root), "utf8");
const campaignDriver = readFileSync(new URL("test/browser/coop-public-ui/campaign.mjs", root), "utf8");
const phaseManager = readFileSync(new URL("src/phase-manager.ts", root), "utf8");
const commandPhase = readFileSync(new URL("src/phases/command-phase.ts", root), "utf8");
const turnInitPhase = readFileSync(new URL("src/phases/turn-init-phase.ts", root), "utf8");
const battleEndPhase = readFileSync(new URL("src/phases/battle-end-phase.ts", root), "utf8");
const learnMovePhase = readFileSync(new URL("src/phases/learn-move-phase.ts", root), "utf8");
const encounterPhase = readFileSync(new URL("src/phases/encounter-phase.ts", root), "utf8");
const battleScene = readFileSync(new URL("src/battle-scene.ts", root), "utf8");
const victoryPhase = readFileSync(new URL("src/phases/victory-phase.ts", root), "utf8");
const mysteryEncounterPhases = readFileSync(new URL("src/phases/mystery-encounter-phases.ts", root), "utf8");
const mysteryEncounterUiHandler = readFileSync(
  new URL("src/ui/handlers/mystery-encounter-ui-handler.ts", root),
  "utf8",
);
const erQuizPhase = readFileSync(new URL("src/phases/er-quiz-phase.ts", root), "utf8");
const guestFaintSwitchPhase = readFileSync(new URL("src/phases/coop-guest-faint-switch-phase.ts", root), "utf8");
const pushReplacementCheckpointPhase = readFileSync(
  new URL("src/phases/coop-push-replacement-checkpoint-phase.ts", root),
  "utf8",
);
const replayPhases = readFileSync(new URL("src/phases/coop-replay-phases.ts", root), "utf8");
const replayTurnPhase = readFileSync(new URL("src/phases/coop-replay-turn-phase.ts", root), "utf8");
const controlOpenAdapter = readFileSync(
  new URL("src/data/elite-redux/coop/authority-v2/adapters/control-open.ts", root),
  "utf8",
);
const replayMePhase = readFileSync(new URL("src/phases/coop-replay-me-phase.ts", root), "utf8");
const crossroadsPhase = readFileSync(new URL("src/phases/er-crossroads-phase.ts", root), "utf8");
const selectBiomePhase = readFileSync(new URL("src/phases/select-biome-phase.ts", root), "utf8");
const biomeShopPhase = readFileSync(new URL("src/phases/biome-shop-phase.ts", root), "utf8");
const soakDriver = readFileSync(new URL("test/tools/coop-soak-driver.ts", root), "utf8");
const hostFaintSoak = readFileSync(new URL("test/tests/elite-redux/coop/coop-soak-host-faint.test.ts", root), "utf8");
const switchPhase = readFileSync(new URL("src/phases/switch-phase.ts", root), "utf8");
const titlePhase = readFileSync(new URL("src/phases/title-phase.ts", root), "utf8");
const gameData = readFileSync(new URL("src/system/game-data.ts", root), "utf8");
const shadow = readFileSync(new URL("src/data/elite-redux/coop/authority-v2/shadow.ts", root), "utf8");
const authorityLog = readFileSync(new URL("src/data/elite-redux/coop/authority-v2/authority-log.ts", root), "utf8");
const waveAdapter = readFileSync(
  new URL("src/data/elite-redux/coop/authority-v2/adapters/wave-terminal.ts", root),
  "utf8",
);
const replacementAdapter = readFileSync(
  new URL("src/data/elite-redux/coop/authority-v2/adapters/faint-replacement.ts", root),
  "utf8",
);
const interactionCutover = readFileSync(
  new URL("src/data/elite-redux/coop/authority-v2/cutover-interaction.ts", root),
  "utf8",
);
const nextControl = readFileSync(new URL("src/data/elite-redux/coop/authority-v2/next-control.ts", root), "utf8");
const controlLedger = readFileSync(new URL("src/data/elite-redux/coop/authority-v2/control-ledger.ts", root), "utf8");
const interactionProjection = readFileSync(
  new URL("src/data/elite-redux/coop/authority-v2/interaction-projection.ts", root),
  "utf8",
);
const proposalAdmission = readFileSync(
  new URL("src/data/elite-redux/coop/authority-v2/proposal-admission.ts", root),
  "utf8",
);
const interactionRelay = readFileSync(new URL("src/data/elite-redux/coop/coop-interaction-relay.ts", root), "utf8");
const coopDurability = readFileSync(new URL("src/data/elite-redux/coop/coop-durability.ts", root), "utf8");
const coopUi = readFileSync(new URL("src/ui/ui.ts", root), "utf8");
const rewardOperation = readFileSync(new URL("src/data/elite-redux/coop/coop-reward-operation.ts", root), "utf8");
const authorityStateHooks = readFileSync(
  new URL("src/data/elite-redux/coop/coop-authority-state-hooks.ts", root),
  "utf8",
);
const biomeOperation = readFileSync(new URL("src/data/elite-redux/coop/coop-biome-operation.ts", root), "utf8");
const selectModifierPhase = readFileSync(new URL("src/phases/select-modifier-phase.ts", root), "utf8");
const theBargainPhase = readFileSync(new URL("src/phases/the-bargain-phase.ts", root), "utf8");
const rendererGate = readFileSync(new URL("src/data/elite-redux/coop/coop-renderer-gate.ts", root), "utf8");
const switchBiomePhase = readFileSync(new URL("src/phases/switch-biome-phase.ts", root), "utf8");
const newBattlePhase = readFileSync(new URL("src/phases/new-battle-phase.ts", root), "utf8");

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

test("every real-engine shard qualifies Authority V2 instead of hiding behind legacy", () => {
  const gate = jobBlock(gateWorkflow, "gate");
  assert.match(gate, /COOP_AUTHORITY_V2_TURN:\s*"on"/u);
  assert.match(gate, /COOP_AUTHORITY_V2_REPLACEMENT:\s*"on"/u);
  assert.match(gate, /COOP_AUTHORITY_V2_WAVE:\s*"on"/u);
  assert.match(gate, /COOP_AUTHORITY_V2_INTERACTION:\s*"on"/u);
  assert.match(gate, /COOP_AUTHORITY_V2_RECOVERY:\s*"on"/u);
  assert.match(gate, /node scripts\/run-coop-gate\.mjs/u);
  assert.doesNotMatch(
    gate,
    /COOP_AUTHORITY_V2_(?:TURN|REPLACEMENT|WAVE|INTERACTION|RECOVERY):\s*"(?:off|false|0)"/u,
    "the exhaustive gameplay matrix may never downgrade the production architecture",
  );
});

test("nested reward successors consume exact immutable modifier follow-up metadata", () => {
  const rewardCaseStart = interactionCutover.indexOf('case "REWARD":');
  const rewardCaseEnd = interactionCutover.indexOf('case "SHOP_BUY":', rewardCaseStart);
  assert.ok(rewardCaseStart >= 0 && rewardCaseEnd > rewardCaseStart, "the closed reward successor arm exists");
  const rewardCase = interactionCutover.slice(rewardCaseStart, rewardCaseEnd);
  assert.match(rewardCase, /payload\.result\.nextInteraction/u);
  assert.match(rewardCase, /interactionAddressOf\(payload\.result\.nextInteraction\)/u);
  assert.match(
    interactionCutover,
    /case "learn-move":\s*return \{[\s\S]*?surfaceClass: "op:learnMove",[\s\S]*?operationKind: "LEARN_MOVE"/u,
  );
  assert.match(
    interactionCutover,
    /case "ability":\s*return \{[\s\S]*?surfaceClass: "op:ability",[\s\S]*?operationKind: "ABILITY_PRESENT"/u,
  );
  assert.match(
    interactionCutover,
    /case "mystery-terminal":\s*return \{[\s\S]*?surfaceClass: "op:me",[\s\S]*?operationKind: "ME_TERMINAL"/u,
  );
});

test("a reward pool reopened after a nested picker cannot recommit its stale presentation image", () => {
  assert.match(
    rewardOperation,
    /export function coopRewardPresentationActionSlot[\s\S]*generation === 0[\s\S]*reroll[\s\S]*generation - 1/u,
    "each nested reopen owns a distinct operation-id slot while generation zero keeps the original address",
  );
  assert.match(
    rewardOperation,
    /generation === 0 && reroll >= COOP_REWARD_PRESENTATION_REOPEN_BASE/u,
    "generation-zero addresses cannot overlap the ordered-reopen operation-id band",
  );
  assert.match(
    selectModifierPhase,
    /copied\.coopRewardPresentationGeneration = this\.coopRewardPresentationGeneration \+ 1/u,
    "the real continuation phase advances the presentation generation",
  );
  assert.match(
    selectModifierPhase,
    /sendRewardOptions\([\s\S]*this\.coopRewardPresentationGeneration/u,
    "the public reward phase publishes that generation at the production relay edge",
  );
  assert.match(
    coopRuntime,
    /coopRewardPresentationActionSlot\(payload\.pinned, payload\.reroll, payload\.generation, payload\.rewardSurface\)[\s\S]*!== parsed\.pinnedSeq/u,
    "the replica rejects a presentation whose immutable generation does not match its operation address",
  );
  assert.match(interactionCutover, /!integer\(value\.generation\)/u);
  assert.match(interactionCutover, /surface === "market" && value\.generation !== 0/u);
});

test("a deterministic biome transition cannot wait for a picker terminal that does not exist", () => {
  assert.match(
    interactionCutover,
    /operation\.kind === "BIOME_PICK"[\s\S]*operation\.payload\.nodeIndex === -1/u,
    "the no-input deterministic biome result must release its ordered successor without a UI terminal proof",
  );
});

test("the stall watchdog preserves an exact V2 human-input lease", () => {
  assert.match(coopRuntime, /function hasCoopV2HumanDeliberationLease\(runtime: CoopRuntime\): boolean/u);
  assert.match(
    coopRuntime,
    /control\.ownerSeatId === runtime\.controller\.localSeatId[\s\S]*!isCoopV2InteractionHumanInputFrozen\(runtime\)/u,
  );
  assert.match(
    coopRuntime,
    /const projection = projectCoopV2InteractionControl\(runtime, control\);[\s\S]*projection\.kind === "installed" \|\| projection\.kind === "already-installed"/u,
  );
  const watchdogStart = coopRuntime.indexOf("export function wireCoopStallWatchdog");
  const watchdogEnd = coopRuntime.indexOf("function wireCoopDisconnectReaction", watchdogStart);
  assert.ok(watchdogStart >= 0 && watchdogEnd > watchdogStart, "the complete stall watchdog source exists");
  const watchdog = coopRuntime.slice(watchdogStart, watchdogEnd);
  assert.match(watchdog, /hasCoopV2HumanDeliberationLease\(runtime\)/u);
  assert.match(
    watchdog,
    /const clearLocalStallClaim = \(\) => \{[\s\S]*waitingMs: 0[\s\S]*localStallClaimOpen = false/u,
    "a resolved local wait explicitly retracts its positive peer-visible stall claim",
  );
  assert.match(
    watchdog,
    /mutualStallCandidateAt == null[\s\S]*mutualStallCandidateAt = Date\.now\(\)[\s\S]*Date\.now\(\) - mutualStallCandidateAt >= COOP_STALL_TICK_MS/u,
    "mutual recovery requires the same condition on two watchdog samples",
  );
});

test("operation state transactions cross one engine-free composition seam", () => {
  assert.doesNotMatch(rewardOperation, /from "#data\/elite-redux\/coop\/coop-battle-engine"/u);
  assert.match(rewardOperation, /captureCoopOperationAuthorityState/u);
  assert.match(authorityStateHooks, /let installedHooks: CoopAuthorityStateHooks \| null = null/u);
  assert.match(coopRuntime, /setCoopAuthorityStateHooks\(\{/u);
  assert.match(coopRuntime, /apply: state => applyCoopAuthoritativeBattleState\(state, true\)/u);
  assert.match(coopRuntime, /reapply: state => reapplyAcceptedCoopAuthoritativeBattleState\(state, true\)/u);
});

test("an N+1 replacement command resets every turn-local presentation watermark", () => {
  const pivotStart = replayTurnPhase.indexOf("const commandTurn = globalScene.currentBattle.turn;");
  const pivotEnd = replayTurnPhase.indexOf("if (!hasLocalCommandSlot)", pivotStart);
  assert.ok(pivotStart >= 0 && pivotEnd > pivotStart, "the replacement-to-command replay pivot exists");
  const pivot = replayTurnPhase.slice(pivotStart, pivotEnd);
  assert.match(pivot, /const continuesSameTurn = commandTurn === this\.turn/u);
  assert.match(pivot, /continuesSameTurn \? this\.rendered : 0/u);
  assert.match(pivot, /continuesSameTurn \? \[\.\.\.this\.fromHpByBi\.entries\(\)\] : undefined/u);
  assert.match(pivot, /continuesSameTurn \? this\.presentationOutcomeTokens : undefined/u);
});

test("replacement command control cannot overtake retained post-summon presentation", () => {
  assert.match(
    pushReplacementCheckpointPhase,
    /const recordedPresentation = snapshotCoopRecordedPresentation\(\)[\s\S]*recordedPresentation == null && !this\.noSummonExpected[\s\S]*fatal\([\s\S]*const entryPresentation = recordedPresentation \?\? \[\][\s\S]*entryPresentation,/u,
    "a real post-summon checkpoint fails closed without its recording, while an explicit no-summon result carries an empty immutable prefix",
  );
  assert.match(
    turnRecorder,
    /function snapshotCoopRecordedPresentation\(\)[\s\S]*recording\.events\.slice\(\)/u,
    "chained replacements retain a cumulative prefix instead of freezing the first summon's boundary",
  );
  assert.match(
    replacementAdapter,
    /interface ReplacementAuthorityCarrier[\s\S]*entryPresentation\?: readonly CoopBattleEvent\[\]/u,
    "the immutable replacement material carries the ordered post-summon prefix",
  );
  assert.match(
    coopRuntime,
    /isStrictCoopEntryPresentation\(carrier\.entryPresentation\)[\s\S]*ingestAuthoritativeV2Replacement\([\s\S]*replacement\.entryPresentation/u,
    "replica admission validates and forwards the retained prefix through the V2 replacement transaction",
  );
  assert.match(
    battleStream,
    /replacementEntryPresentation\?: readonly CoopBattleEvent\[\][\s\S]*mechanicalCheckpointEnvelope/u,
    "the prefix is local V2 projection material rather than a second legacy checkpoint identity",
  );
  const prefixFence = replayTurnPhase.indexOf("private queueReplacementEntryPresentation(");
  const applyReplacement = replayTurnPhase.indexOf("private applyReplacementTransaction(");
  assert.ok(prefixFence >= 0 && applyReplacement > prefixFence, "replacement replay exposes a bounded prefix fence");
  const prefix = replayTurnPhase.slice(prefixFence, applyReplacement);
  assert.match(prefix, /renderedThroughForTurn\(envelope\.turn, envelope\.wave\)/u);
  assert.match(prefix, /"CoopFinalizeEntryPresentationPhase"/u);
  assert.match(prefix, /"CoopReplayTurnPhase"/u);
  const queuePrefix = replayTurnPhase.indexOf("this.queueReplacementEntryPresentation(streamer, envelope)");
  const applyFrame = replayTurnPhase.indexOf("this.applyReplacementTransaction(envelope)", queuePrefix);
  assert.ok(
    queuePrefix >= 0 && applyFrame > queuePrefix,
    "the complete renderer proof fence runs before replacement state and command control can install",
  );
});

test("command fallback rejects a dominated split carrier by its retained party provenance", () => {
  assert.match(
    battleStream,
    /const bufferedParty = this\.lastEnemyParty\?\.wave === wave \? this\.lastEnemyParty : null;[\s\S]*partyStateTick: bufferedParty\?\.stateTick/u,
    "consuming the state projection cannot erase the party manifest's immutable source tick",
  );
  assert.match(
    commandPhase,
    /const carrierTick = carrier\.partyStateTick \?\? carrier\.state\?\.tick;[\s\S]*carrierTick <= coopAppliedStateTick\(\)/u,
    "CommandPhase discards lower or equal compatibility material before it can rebuild complete V2 state",
  );
  assert.doesNotMatch(
    coopRuntime,
    /runtime\.battleStream\.retireEnemyPartyAuthorityThrough\(material\.wave, material\.authoritativeState\.tick\)/u,
    "CONTROL_COMMIT must not globally delete the raw encounter permit before NextEncounterPhase consumes it",
  );
});

test("a stale BGM loop callback cannot abort an authoritative encounter", () => {
  assert.match(
    battleScene,
    /const startedBgm = this\.sound\.add\(bgmName, \{ loop: true \}\)[\s\S]*this\.bgm = startedBgm[\s\S]*startedBgm\.on\("looped", \(\) => \{[\s\S]*this\.bgm !== startedBgm \|\| startedBgm\.pendingRemove[\s\S]*try \{[\s\S]*startedBgm\.play\(\{ seek: loopPoint \}\)[\s\S]*catch/u,
    "an obsolete or failed sound is presentation-only and cannot strand EncounterPhase before V2 command-open",
  );
});

test("every release soak and focused replay executes the complete Authority V2 graph", () => {
  const nightlySoak = jobBlock(nightlySoakWorkflow, "soak");
  const focusedSoak = jobBlock(focusedSoakWorkflow, "replay");
  const gameOverPrerequisiteStart = journeyWorkflow.indexOf(
    "      - name: Verify retained GameOver two-engine operation regression",
  );
  const gameOverPrerequisiteEnd = journeyWorkflow.indexOf(
    "      - name: Enforce public-driver boundary",
    gameOverPrerequisiteStart,
  );
  assert.notEqual(gameOverPrerequisiteStart, -1, "the public journey owns its two-engine prerequisite");
  assert.ok(gameOverPrerequisiteEnd > gameOverPrerequisiteStart, "the prerequisite step has a bounded source block");
  const gameOverPrerequisite = journeyWorkflow.slice(gameOverPrerequisiteStart, gameOverPrerequisiteEnd);

  for (const [label, block] of [
    ["nightly release soak", nightlySoak],
    ["focused soak replay", focusedSoak],
    ["GameOver two-engine prerequisite", gameOverPrerequisite],
  ]) {
    assert.match(block, /COOP_AUTHORITY_V2_TURN:\s*"on"/u, `${label} enables V2 turn authority`);
    assert.match(block, /COOP_AUTHORITY_V2_REPLACEMENT:\s*"on"/u, `${label} enables V2 replacement authority`);
    assert.match(block, /COOP_AUTHORITY_V2_WAVE:\s*"on"/u, `${label} enables V2 wave authority`);
    assert.match(block, /COOP_AUTHORITY_V2_INTERACTION:\s*"on"/u, `${label} enables V2 interaction authority`);
    assert.match(block, /COOP_AUTHORITY_V2_RECOVERY:\s*"on"/u, `${label} enables V2 recovery authority`);
    assert.doesNotMatch(
      block,
      /COOP_AUTHORITY_V2_(?:TURN|REPLACEMENT|WAVE|INTERACTION|RECOVERY):\s*"(?:off|false|0)"/u,
      `${label} may not downgrade the release architecture`,
    );
  }
});

test("solo public-browser navigation uses the stable command identity", () => {
  assert.match(
    soloClassic,
    /surfaceId: COMMAND_SURFACE,\s+targetId: "command:fight"/u,
    "the live command mirror exposes command:fight rather than the retired numeric cursor identity",
  );
  assert.doesNotMatch(soloClassic, /surfaceId: COMMAND_SURFACE,\s+targetId: "cursor:0"/u);
});

test("public co-op launch waits for an actionable save decision and chooses semantically", () => {
  assert.match(publicUiHarness, /waitForActionableCoopLaunchMessage/u);
  assert.equal(
    [
      ...publicUiHarness.matchAll(
        /this\.pairRoleCursors\?\.\[this\.host\.label\] \?\? this\.host\.evidence\.cursor\(\)/gu,
      ),
    ].length,
    2,
    "fresh and resume launch scan from before pairing so an already-installed stable prompt is not missed",
  );
  assert.match(
    browserEntry,
    /phase === "TitlePhase"\s*&& uiMode === "MESSAGE"\s*&& \(runtime == null \|\| runtime\.controller\.sessionEpoch <= 0\)/u,
    "the semantic observer suppresses only unbound title narration, not the live co-op launch handler",
  );
  assert.match(
    publicUiHarness,
    /async startFreshRun[\s\S]*?waitForActionableCoopLaunchMessage[\s\S]*?targetId: "no"/u,
    "fresh launch waits for completed save discovery and explicitly chooses New Game when a resume exists",
  );
  assert.match(
    publicUiHarness,
    /async resumeRun[\s\S]*?waitForActionableCoopLaunchMessage[\s\S]*?targetId: "yes"/u,
    "resume waits for completed save discovery and explicitly accepts the retained run",
  );
  assert.doesNotMatch(
    publicUiHarness,
    /pulseActionUntil/u,
    "save decisions may not regress to fixed blind input bursts",
  );
});

test("public-browser campaign and staging bundle qualify the same V2 cutover", () => {
  const browserBuild = jobBlock(gateWorkflow, "browser-build");
  assert.match(browserBuild, /VITE_COOP_AUTHORITY_V2_TURN:\s*"on"/u);
  assert.match(browserBuild, /VITE_COOP_AUTHORITY_V2_REPLACEMENT:\s*"on"/u);
  assert.match(browserBuild, /VITE_COOP_AUTHORITY_V2_WAVE:\s*"on"/u);
  assert.match(browserBuild, /VITE_COOP_AUTHORITY_V2_INTERACTION:\s*"on"/u);
  assert.match(browserBuild, /VITE_COOP_AUTHORITY_V2_RECOVERY:\s*"on"/u);
  assert.match(campaignWorkflow, /VITE_COOP_AUTHORITY_V2_TURN:\s*"on"/u);
  assert.match(campaignWorkflow, /VITE_COOP_AUTHORITY_V2_REPLACEMENT:\s*"on"/u);
  assert.match(campaignWorkflow, /VITE_COOP_AUTHORITY_V2_WAVE:\s*"on"/u);
  assert.match(campaignWorkflow, /VITE_COOP_AUTHORITY_V2_INTERACTION:\s*"on"/u);
  assert.match(campaignWorkflow, /VITE_COOP_AUTHORITY_V2_RECOVERY:\s*"on"/u);
  assert.match(journeyWorkflow, /VITE_COOP_AUTHORITY_V2_TURN:\s*"on"/u);
  assert.match(journeyWorkflow, /VITE_COOP_AUTHORITY_V2_REPLACEMENT:\s*"on"/u);
  assert.match(journeyWorkflow, /VITE_COOP_AUTHORITY_V2_WAVE:\s*"on"/u);
  assert.match(journeyWorkflow, /VITE_COOP_AUTHORITY_V2_INTERACTION:\s*"on"/u);
  assert.match(journeyWorkflow, /VITE_COOP_AUTHORITY_V2_RECOVERY:\s*"on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_TURN=on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_REPLACEMENT=on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_WAVE=on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_INTERACTION=on"/u);
  assert.match(stagingWorkflow, /echo "VITE_COOP_AUTHORITY_V2_RECOVERY=on"/u);
});

test("Showdown cannot skip the shared epoch/run/binding boundary when it skips save discovery", () => {
  const branchStart = titlePhase.indexOf('if (sessionKind === "versus") {');
  const firstCompatibility = titlePhase.indexOf(".awaitPartnerCompatibility()", branchStart);
  const branchEnd = titlePhase.indexOf(".awaitPartnerCompatibility()", firstCompatibility + 1);
  assert.notEqual(branchStart, -1, "title phase owns an explicit versus launch path");
  assert.ok(branchEnd > branchStart, "the versus branch ends before ordinary co-op save discovery");
  const versus = titlePhase.slice(branchStart, branchEnd);
  const checksCompatibility = versus.indexOf(".awaitPartnerCompatibility()");
  const commitsFreshIdentity = versus.indexOf(".sendResumeStartNew()");
  const waitsForBinding = versus.indexOf("controller.awaitGameplayBinding()");
  const entersRun = versus.indexOf("startNewRun()");
  assert.ok(checksCompatibility >= 0, "versus proves the opponent build before launch");
  assert.ok(commitsFreshIdentity > checksCompatibility, "the authority commits one shared fresh run/epoch");
  assert.ok(waitsForBinding > checksCompatibility, "both seats wait for the exact gameplay binding");
  assert.ok(entersRun > waitsForBinding, "battle entry is reachable only after binding proof");
  assert.doesNotMatch(versus, /getCoopResumeLobbySnapshot|findCoopResumeCandidate|loadSaveSlot/u);

  const waitStart = sessionController.indexOf("awaitGameplayBinding(");
  const waitEnd = sessionController.indexOf("\n  /** Tear down:", waitStart);
  assert.notEqual(waitStart, -1, "the controller exposes a bounded gameplay-binding barrier");
  assert.ok(waitEnd > waitStart, "the gameplay-binding barrier has a bounded source block");
  const wait = sessionController.slice(waitStart, waitEnd);
  assert.match(wait, /this\.exactP33BindingAxes\(\)/u);
  assert.match(wait, /this\.sessionEpochValue > 0 && isCoopRunId\(this\.runIdValue\)/u);
  assert.match(wait, /this\.p33BindingRejected \|\| this\.authenticatedProtocolViolation/u);
});

test("wave/terminal cutover carries full settled state and retires every legacy wave authority", () => {
  assert.match(waveAdapter, /interface CoopWaveTerminalAuthorityCarrierV2[\s\S]*authoritativeState: unknown/u);
  assert.match(waveAdapter, /interface CoopWaveTerminalAuthorityCarrierV2[\s\S]*transition: unknown/u);
  assert.match(coopRuntime, /entry\.kind === "WAVE_ADVANCE" \|\| entry\.kind === "TERMINAL_COMMIT"/u);
  assert.match(
    coopRuntime,
    /if \(entry\.kind === "WAVE_ADVANCE" \|\| entry\.kind === "TERMINAL_COMMIT"\)[\s\S]*?applyCoopV2WaveEntry\(runtime, entry\)[\s\S]*?markCoopV2ControlMaterialApplied\(runtime, entry\)/u,
  );
  assert.match(coopRuntime, /if \(isCoopV2WaveCutoverActive\(\)\)[\s\S]*commitCoopV2SettledWaveAdvance/u);
  assert.match(
    coopRuntime,
    /if \(isCoopV2WaveCutoverActive\(\)\)[\s\S]*\}\s*else\s*\{[\s\S]*commitWaveAdvanceOwnerIntent/u,
  );
  assert.match(replayPhases, /if \(!isCoopV2WaveCutoverActive\(\)\)[\s\S]*adoptWaveAdvanceWatcherChoice/u);
  assert.match(battleEndPhase, /getCoopPendingRetainedWaveBoundary\(\)/u);
  assert.match(shadow, /waveBoundarySubsumes\(this\.log\.retained\(\), input\.transition\.wave\)/u);
  assert.match(shadow, /terminalSubsumes\(this\.log\.retained\(\)\)/u);

  const boundaryStart = coopRuntime.indexOf("function tryApplyCoopSettledWaveData(");
  const legacyStart = coopRuntime.indexOf("  const staged = getCoopStagedWaveAdvanceTransaction", boundaryStart);
  assert.notEqual(boundaryStart, -1, "the V2 wave DATA boundary has an executable integration edge");
  assert.ok(legacyStart > boundaryStart, "the V2 edge is bounded before the legacy fallback");
  const v2Boundary = coopRuntime.slice(boundaryStart, legacyStart);
  const appliesData = v2Boundary.indexOf("applyCoopV2WaveDataAtBoundary(runtime, transaction)");
  const completesEntry = v2Boundary.indexOf("retryPendingReplicaEntries()");
  assert.ok(appliesData >= 0, "the boundary first applies the complete immutable V2 wave image");
  assert.ok(
    completesEntry > appliesData,
    "the same boundary then installs AWAIT_SUCCESSOR before a later interaction presentation can deadlock it",
  );
});

test("wave DATA waits for the exact started BattleEnd boundary instead of trusting a queued phase name", () => {
  const applyStart = coopRuntime.indexOf("function applyCoopV2WaveDataAtBoundary(");
  const applyEnd = coopRuntime.indexOf("\n/**\n * Adopt the ordered settlement cursor", applyStart);
  assert.notEqual(applyStart, -1, "the runtime exposes one retained V2 wave material boundary");
  assert.ok(applyEnd > applyStart, "the retained V2 wave material boundary has a bounded source block");
  const apply = coopRuntime.slice(applyStart, applyEnd);
  const phaseProof = apply.indexOf('phaseName === "BattleEndPhase"');
  const callbackProof = apply.indexOf("isCoopSettledWaveBoundaryPending(sourceWave)");
  const applyState = apply.indexOf("applyCoopAuthoritativeBattleState(immutableState, true)");
  assert.ok(phaseProof >= 0, "wave material still requires the real BattleEnd phase");
  assert.ok(
    callbackProof > phaseProof && applyState > callbackProof,
    "wave material cannot retire before BattleEnd.start installs its exact source-wave release callback",
  );
  assert.match(
    apply,
    /if \(!exactBattleEnd && !exactTerminalFinalizer\) \{\s*return false;/u,
    "a merely queued BattleEnd remains deferred until its runtime-owned boundary is actionable",
  );
});

test("the post-victory seal accepts the exact completed V2 wave transaction after successor installation", () => {
  const helperStart = coopRuntime.indexOf("function settledCoopV2WaveTransaction(");
  const helperEnd = coopRuntime.indexOf("\n}", helperStart);
  assert.notEqual(helperStart, -1, "runtime keeps one bounded read-only settled-wave evidence resolver");
  assert.ok(helperEnd > helperStart, "the settled-wave resolver has a bounded source block");
  const helper = coopRuntime.slice(helperStart, helperEnd);
  assert.match(helper, /v2WaveTransactions\.get\(wave\)/u);
  assert.match(helper, /v2CompletedWaveTransactions\.get\(wave\)/u);

  const sealStart = coopRuntime.indexOf("export function sealCoopAutomaticVictoryBoundary(");
  const sealEnd = coopRuntime.indexOf("\nexport function ", sealStart + 1);
  assert.notEqual(sealStart, -1, "runtime exposes the automatic victory seal");
  assert.ok(sealEnd > sealStart, "the automatic victory seal has a bounded source block");
  const seal = coopRuntime.slice(sealStart, sealEnd);
  assert.match(
    seal,
    /const staged = settledCoopV2WaveTransaction\(runtime, identity\.wave\)/u,
    "successor installation may retire the live transaction before the later victory seal proves it",
  );
});

test("a projected terminal reward parks on its signed N+1 wait until CONTROL_COMMIT installs the battle", () => {
  assert.match(
    coopRuntime,
    /requiresCoopV2InteractionTerminalProof[\s\S]*?prepareCoopV2InteractionTerminalSuccessor\(runtime, entry, material\.surfaceClass, material\.envelope\)/u,
    "terminal interaction DATA arms its stated successor before the operation applier can end the phase",
  );
  assert.match(
    coopRuntime,
    /requiresTerminalProof[\s\S]*?!runtime\.v2SettledInteractionOperations\.has\(entry\.operationId\)[\s\S]*?!prepareCoopV2InteractionTerminalSuccessor/u,
    "a monotonic terminal proof survives phase teardown and makes later redelivery independent of the old phase",
  );
  assert.match(
    coopRuntime,
    /const settleExactRuntime[\s\S]*?return settleCoopV2InteractionOperation\(entry\.operationId, runtime\)[\s\S]*?installCoopV2TerminalSuccessor\?\.\([\s\S]*?settleExactRuntime/u,
    "the terminal phase is bound to the exact replica runtime that admitted its immutable result",
  );
  const settlementStart = coopRuntime.indexOf("export function settleCoopV2InteractionOperation(");
  const settlementEnd = coopRuntime.indexOf("\n/**", settlementStart);
  assert.ok(settlementStart >= 0 && settlementEnd > settlementStart, "the terminal proof helper is bounded");
  const settlement = coopRuntime.slice(settlementStart, settlementEnd);
  const recordsProof = settlement.indexOf("v2SettledInteractionOperations.add(operationId)");
  const rebindsRetry = settlement.indexOf("runWhenCoopRuntimeActive(runtime");
  const retriesReplica = settlement.indexOf("retryPendingReplicaEntries()", rebindsRetry);
  assert.ok(recordsProof >= 0, "the exact runtime ledger records the terminal proof");
  assert.ok(
    rebindsRetry > recordsProof && retriesReplica > rebindsRetry,
    "only scene-mutating replica/projector retries wait for the owning runtime to become ambient",
  );
  assert.match(
    selectModifierPhase,
    /queueCoopV2NextWaveAwait\(operationId\)[\s\S]*?terminalSettlement\?\.operationId === operationId[\s\S]*?terminalSettlement\.settle\(\)/u,
    "the real terminal proof queues the signed structural wait before it settles and tears down",
  );
  const projectedRewardStart = selectModifierPhase.indexOf("if (act === COOP_ACT_REWARD)");
  const projectedRewardEnd = selectModifierPhase.indexOf("if (act === COOP_ACT_SHOP)", projectedRewardStart);
  assert.ok(projectedRewardStart >= 0 && projectedRewardEnd > projectedRewardStart, "the reward action is bounded");
  const projectedReward = selectModifierPhase.slice(projectedRewardStart, projectedRewardEnd);
  assert.ok(
    projectedReward.indexOf("this.coopProveV2RewardOperationComplete(decision?.operationId)")
      < projectedReward.indexOf('this.coopEndOwningPhaseIfCurrent("projected reward terminal")'),
    "a projected picked item records its signed terminal before ending its exact parent phase",
  );
  assert.match(
    projectedReward,
    /this\.coopResumeAfterOwningUiTransition\(messageReady, \(\) => \{[\s\S]*?this\.coopEndOwningPhaseIfCurrent\("projected reward terminal"\)/u,
    "a projected picked item resumes and retires only in its owning browser realm",
  );
  const projectedRerollStart = selectModifierPhase.indexOf(
    "if (projectionOnly) {",
    selectModifierPhase.indexOf("COOP_INTERACTION_REROLL"),
  );
  const projectedRerollEnd = selectModifierPhase.indexOf("} else {", projectedRerollStart);
  assert.ok(projectedRerollStart >= 0 && projectedRerollEnd > projectedRerollStart, "the projected reroll is bounded");
  assert.match(
    selectModifierPhase.slice(projectedRerollStart, projectedRerollEnd),
    /this\.coopResumeAfterOwningUiTransition\(messageReady, \(\) => \{[\s\S]*?this\.coopEndOwningPhaseIfCurrent\("projected reroll terminal"\)/u,
    "a projected reroll cannot let its late parent callback shift the new reward phase",
  );
  assert.match(
    selectModifierPhase,
    /const messageReady = this\.coopOwningScene\.ui\.setMode\(UiMode\.MESSAGE\);\s*this\.coopResumeAfterOwningUiTransition\(messageReady, finish\)/u,
    "an asynchronous picked-item close ends only its construction-time browser phase tree",
  );
  assert.match(
    selectModifierPhase,
    /const finish = \(\): void => \{[\s\S]*?this\.coopCommitPendingAuthorityResult\(operationId\)[\s\S]*?this\.coopEndOwningPhaseIfCurrent\("free reward terminal"\)/u,
    "a retained reward terminal cannot let its late parent callback shift an already-current sub-picker",
  );
  const uiResumeStart = selectModifierPhase.indexOf("private coopResumeAfterOwningUiTransition(");
  const uiResumeEnd = selectModifierPhase.indexOf("\n  /**", uiResumeStart + 1);
  assert.ok(uiResumeStart >= 0 && uiResumeEnd > uiResumeStart, "the phase-owned UI completion helper is bounded");
  assert.match(
    selectModifierPhase.slice(uiResumeStart, uiResumeEnd),
    /Promise\.resolve\(transition\)\.then\(\(\) => this\.coopResumeOnOwningRuntime\(callback\)\)/u,
    "a resolved UI promise cannot mutate whichever browser happens to be ambient",
  );
  const phaseEndStart = selectModifierPhase.indexOf("private coopEndOwningPhaseIfCurrent(");
  const phaseEndEnd = selectModifierPhase.indexOf("\n  /**", phaseEndStart + 1);
  assert.ok(phaseEndStart >= 0 && phaseEndEnd > phaseEndStart, "the phase-owned terminal helper is bounded");
  const phaseEnd = selectModifierPhase.slice(phaseEndStart, phaseEndEnd);
  assert.match(phaseEnd, /getCurrentPhase\(\)[\s\S]*?current !== this[\s\S]*?return false/u);
  assert.match(phaseEnd, /super\.end\(\);\s*return true/u);
  assert.match(
    selectModifierPhase,
    /removeAllPhasesOfType\("NewBattlePhase"\);[\s\S]*?pushNew\("NewBattlePhase", \{[\s\S]*?afterOperationId: wait\.afterOperationId,[\s\S]*?epoch: wait\.epoch,[\s\S]*?wave: wait\.wave,[\s\S]*?turn: wait\.turn/u,
    "the bridge replaces every unsigned local tail and preserves the immutable AWAIT_SUCCESSOR address",
  );
  const terminalSuccessorStart = selectModifierPhase.indexOf("public installCoopV2TerminalSuccessor(");
  const terminalSuccessorEnd = selectModifierPhase.indexOf("\n  /**", terminalSuccessorStart + 1);
  const terminalSuccessor = selectModifierPhase.slice(terminalSuccessorStart, terminalSuccessorEnd);
  assert.doesNotMatch(
    terminalSuccessor,
    /!this\.coopV2DestructivelyProjected/u,
    "a recovery-restored ordinary reward receives the same signed wait as a destructively projected reward",
  );
  assert.match(
    newBattlePhase,
    /canReleaseForCoopV2Control[\s\S]*?successor\.kind === "CONTROL_COMMIT"[\s\S]*?destinationWave === wait\.wave \+ 1[\s\S]*?destinationTurn === 1/u,
    "the projected NewBattle shell accepts an exact next-wave command carrier",
  );
  assert.match(
    newBattlePhase,
    /successor\.kind === "REPLACEMENT_COMMIT"[\s\S]*?command\.kind === "AWAIT_SUCCESSOR"[\s\S]*?command\.afterOperationId === successor\.operationId[\s\S]*?command\.allowedKinds\.includes\("CONTROL_COMMIT"\)/u,
    "a complete pre-encounter replacement is the only other mechanical entry allowed to create the shell",
  );
  const prepare = newBattlePhase.slice(
    newBattlePhase.indexOf("public prepareForCoopV2ControlMaterial"),
    newBattlePhase.indexOf("public releaseForCoopV2Control"),
  );
  assert.match(prepare, /globalScene\.newCoopV2ProjectedBattle\(\)/u);
  assert.doesNotMatch(prepare, /globalScene\.newBattle\(\)/u);
  const interactionPrepare = newBattlePhase.slice(
    newBattlePhase.indexOf("public canPrepareForCoopV2InteractionMaterial"),
    newBattlePhase.indexOf("public releaseForCoopV2Control"),
  );
  assert.match(
    interactionPrepare,
    /successor\.kind === "INTERACTION_COMMIT"[\s\S]*?control\.kind === "SHARED_INTERACTION"[\s\S]*?material\.wave === wait\.wave \+ 1/u,
    "the same signed bridge admits an exact non-battle interaction only at wave N+1",
  );
  assert.match(interactionPrepare, /globalScene\.newCoopV2ProjectedBattle\(\)/u);
  assert.match(
    coopRuntime,
    /prepareCoopV2InteractionStateMaterialConsumer\(entry\)[\s\S]*?const stateApplied =/u,
    "cross-wave interaction DATA cannot apply before its exact destination Battle shell exists",
  );
  const release = newBattlePhase.slice(
    newBattlePhase.indexOf("public releaseForCoopV2Control"),
    newBattlePhase.indexOf("start()"),
  );
  assert.match(
    release,
    /successor\.kind === "REPLACEMENT_COMMIT"[\s\S]*?"CoopReplayTurnPhase"[\s\S]*?"next-encounter"[\s\S]*?this\.end\(\)/u,
    "a future-wave replacement is replayed before its encounter instead of leaving NewBattle parked",
  );
  assert.match(release, /pushNew\("NextEncounterPhase"\)[\s\S]*?this\.end\(\)/u);
  assert.match(
    replayTurnPhase,
    /replacementContinuation === "next-encounter"[\s\S]*?acknowledgeReplacement\(envelope, "continuationReady"\)[\s\S]*?unshiftNew\("NextEncounterPhase"\)/u,
    "the retained replacement transaction releases the encounter only after its presentation and checksum proof",
  );
});

test("a repeated Mystery checksum waits for the ordered V2 presentation before requesting recovery", () => {
  const checksumStart = coopRuntime.indexOf("function wireCoopMeChecksumCheck");
  const checksumEnd = coopRuntime.indexOf("/**\n * Co-op AUTHORITATIVE move-learn forward listener", checksumStart);
  assert.ok(checksumStart >= 0 && checksumEnd > checksumStart, "the Mystery checksum verifier exists");
  const checksumVerifier = coopRuntime.slice(checksumStart, checksumEnd);
  assert.match(
    checksumVerifier,
    /const acceptedTickAtReceipt = coopAppliedStateTick\(\)[\s\S]*?isCoopV2InteractionCutoverActive\(runtime\.durability\)[\s\S]*?coopAppliedStateTick\(\) <= acceptedTickAtReceipt/u,
    "the legacy checksum cannot outrun the globally ordered presentation state tick",
  );
  assert.match(
    checksumVerifier,
    /setTimeout\(verifyAfterOrderedPresentation,[\s\S]*?queueMicrotask\(verifyAfterOrderedPresentation\)/u,
    "verification retries across renderer frames instead of treating one microtask as an ordering proof",
  );
  const warning = checksumVerifier.indexOf("me-entry MISMATCH");
  const grace = checksumVerifier.indexOf("setTimeout(verifyAfterOrderedPresentation");
  assert.ok(grace >= 0 && warning > grace, "bounded ordered-presentation grace precedes recovery escalation");
});

test("a remote replacement result releases an AWAIT_SUCCESSOR turn through its ordered control-open bridge", () => {
  const finalizerStart = replayPhases.indexOf("private acceptsCoopV2ControlSuccessor(");
  const finalizerEnd = replayPhases.indexOf("\n  private completeCoopV2ControlRelease(", finalizerStart);
  assert.ok(finalizerStart >= 0 && finalizerEnd > finalizerStart, "the finalizer successor bridge is bounded");
  const finalizer = replayPhases.slice(finalizerStart, finalizerEnd);
  assert.match(
    finalizer,
    /authorityRemoteReplacementOpen[\s\S]*?successor\.revision === remoteReplacementOpen\.revision \+ 1[\s\S]*?successor\.kind === "REPLACEMENT_COMMIT"[\s\S]*?successor\.operationId === remoteReplacementOpen\.nextControl\.operationId/u,
    "the immutable result must be consecutive and match the exact replacement operation",
  );
  assert.match(
    finalizer,
    /successor\.kind === "CONTROL_COMMIT"[\s\S]*?successor\.kind === "TURN_COMMIT"[\s\S]*?replacement\.ownerSeatId !== getCoopController\(\)\?\.localSeatId[\s\S]*?authorityRemoteReplacementOpen \?\?= successor[\s\S]*?return true/u,
    "a renderer without the replacement picker retains both control-open shapes instead of ending into an empty queue",
  );
  assert.match(
    coopRuntime,
    /entry\.nextControl\.ownerSeatId !== runtime\.controller\.localSeatId[\s\S]*?releaseCoopV2ParkedTurnBoundary\(runtime, entry\)/u,
    "the replica material path presents the remote control-open to the parked finalizer",
  );
});

test("a legacy enemy manifest cannot overwrite a newer V2 wave image", () => {
  const adoptStart = encounterPhase.indexOf("private async adoptCoopHostEnemyParty(");
  const adoptEnd = encounterPhase.indexOf("\n  /**", adoptStart + 1);
  assert.ok(adoptStart >= 0 && adoptEnd > adoptStart, "the enemy adoption boundary is bounded");
  const adoption = encounterPhase.slice(adoptStart, adoptEnd);
  const snapshot = adoption.indexOf("const preDescriptorEnemyParty = battle.enemyParty.slice()");
  const descriptorReset = adoption.indexOf("applyCoopEncounterAuthority(battle, encounter)");
  assert.ok(
    snapshot >= 0 && descriptorReset > snapshot,
    "the exact preprojected V2 objects are retained before the compatibility descriptor clears the party",
  );
  assert.match(
    adoption,
    /isCoopV2ControlCutoverActive\(\)[\s\S]*?coopAppliedStateTick\(\) >= rawState\.tick/u,
    "preservation requires complete V2 cutover and a dominating state tick",
  );
  assert.match(
    adoption,
    /preDescriptorEnemyParty\.entries\(\)[\s\S]*?enemies\.find\(candidate => candidate\.fieldIndex === fieldIndex\)[\s\S]*?current\.id !== id >>> 0[\s\S]*?current\.species\.speciesId !== speciesId/u,
    "every already-materialized V2 object must match the carrier's exact field, id, and species",
  );
  assert.match(
    adoption,
    /reusableV2Enemies\.get\(entry\.fieldIndex\)[\s\S]*?\?\? buildCoopEnemy/u,
    "matching active V2 objects survive while manifest-only bench members are reconstructed",
  );
  assert.match(
    adoption,
    /battle\.enemyParty = rebuilt;[\s\S]*?this\.coopEnemyAuthority =[\s\S]*?enemies\.filter\(entry => !reusableV2Enemies\.has\(entry\.fieldIndex\)\)[\s\S]*?if \(reusableV2Enemies\.size > 0/u,
    "the complete hybrid party is installed and the final legacy corrector excludes every reused V2 object",
  );
  assert.match(
    encounterPhase,
    /enemyPokemon\.fieldSetup\(!this\.coopV2PreservedEnemyFields\.has\(e\)\)/u,
    "encounter presentation cannot reset summonData on an exact enemy object preserved from newer V2 state",
  );
});

test("post-battle continuation identity follows the active V2 wave into completed evidence", () => {
  const resolverStart = coopRuntime.indexOf("export function resolveCoopRetainedWaveContinuationIdentity(");
  const resolverEnd = coopRuntime.indexOf("\nexport function ", resolverStart + 1);
  assert.notEqual(resolverStart, -1, "runtime exposes the retained continuation resolver");
  assert.ok(resolverEnd > resolverStart, "the retained continuation resolver has a bounded source block");
  const resolver = coopRuntime.slice(resolverStart, resolverEnd);
  assert.match(
    resolver,
    /settledCoopV2WaveTransaction\(runtime, activeGuestWaveTransition\.wave\)/u,
    "a completed current wave remains the exact source for TrainerVictory/reward/map tails",
  );
  assert.doesNotMatch(
    resolver,
    /\.\.\.runtime\.v2CompletedWaveTransactions\.values\(\)/u,
    "historical completed waves never become competing continuation candidates",
  );
});

test("ability result materialization credits the destination runtime even when another client is ambient", () => {
  const start = coopRuntime.indexOf("function materializeCoopAbilityOutcomeFromOp(");
  const end = coopRuntime.indexOf("\n/**", start + 1);
  assert.ok(start >= 0 && end > start, "the ability materializer has a bounded source block");
  const materializer = coopRuntime.slice(start, end);
  assert.match(
    materializer,
    /const abilityBinding = \{\s*opState: runtime\.opState,\s*durability: runtime\.durability \?\? null,\s*\}/u,
  );
  assert.match(materializer, /isCoopAbilityOperationSettled\(operation\.id, abilityBinding\)/u);
  assert.match(materializer, /armCoopAbilityJournalMaterialization\(operation\.id, abilityBinding\)/u);
});

test("correlated recovery is wired through all four production progression fences", () => {
  assert.match(commandPhase, /isCoopV2CommandAdmissionFrozen\(\)/u);
  assert.match(phaseManager, /replaceWithCoopRecoveryPhase/u);
  assert.match(phaseManager, /coopRecoveryProgressionFrozen\(\)/u);
  assert.match(shadow, /isMaterializationFrozen\(\).*"deferred"/su);
  assert.match(coopRuntime, /isAuthorityWaitCreationFrozen:\s*\(\)\s*=>/u);
  assert.match(coopRuntime, /queueCoopV2AtomicSnapshotApply/u);
  assert.match(coopRuntime, /retainUntilReleased/u);
});

test("recovery rebuilds wave terminals and installs a multi-target command supervisor without a fence cycle", () => {
  const waveStart = coopRuntime.indexOf("function prepareCoopV2RecoveryWaveTransaction(");
  const waveEnd = coopRuntime.indexOf("\n/**\n * Complete recovery integration", waveStart);
  assert.notEqual(waveStart, -1, "recovery has a dedicated immutable wave-frontier rebuilder");
  assert.ok(waveEnd > waveStart, "the wave-frontier rebuilder has a bounded source block");
  const waveRecovery = coopRuntime.slice(waveStart, waveEnd);
  assert.match(waveRecovery, /decodeCoopV2WaveTransaction\(entry\)/u);
  assert.match(waveRecovery, /transaction\.bootstrapProjected = true/u);
  assert.match(waveRecovery, /transaction\.dataApplied = true/u);
  assert.match(waveRecovery, /runtime\.v2WaveTransactions\.set/u);
  assert.doesNotMatch(
    waveRecovery,
    /pendingWaveAdvance|bootstrapCoopV2WaveTransaction/u,
    "snapshot recovery must not replay BattleEnd or consult an obsolete local wave latch",
  );

  const surfaceStart = coopRuntime.indexOf("function prepareCoopV2RecoveryControlSurface(");
  const surfaceEnd = coopRuntime.indexOf("\n/**\n * Rebuild the runtime-owned wave/terminal transaction", surfaceStart);
  assert.notEqual(surfaceStart, -1, "recovery exposes one exact control-surface constructor");
  assert.ok(surfaceEnd > surfaceStart, "the recovery surface constructor has a bounded source block");
  const surface = coopRuntime.slice(surfaceStart, surfaceEnd);
  assert.match(
    surface,
    /control\.kind === "TERMINAL"[\s\S]*matchingCoopV2WaveTransaction[\s\S]*pushNew\("GameOverPhase"/u,
    "terminal recovery reconstructs the runtime transaction and a real GameOver phase",
  );
  assert.match(surface, /runtime\.v2RecoveryCommandBootstrap = \{/u);
  assert.match(surface, /localTargetIds: localCommands\.map/u);
  assert.match(surface, /pushNew\("CommandPhase", fieldIndex\)/u);

  const proofStart = coopRuntime.indexOf("function isCoopV2RecoveryCommandBootstrapInstalled(");
  const proofEnd = coopRuntime.indexOf("\n/**", proofStart + 1);
  assert.notEqual(proofStart, -1, "recovery has an address-exact command bootstrap proof");
  assert.ok(proofEnd > proofStart, "the recovery command proof has a bounded source block");
  const proof = coopRuntime.slice(proofStart, proofEnd);
  assert.match(proof, /localTargetIds\.length !== bootstrap\.localTargetIds\.length/u);
  assert.match(proof, /runtime\.v2InstalledCommandTargets\.has\(firstTargetId\)/u);

  const liveProjectStart = coopRuntime.indexOf("projectControl: (");
  const liveProjectEnd = coopRuntime.indexOf("\n  };\n  return seams;", liveProjectStart);
  assert.ok(liveProjectStart >= 0 && liveProjectEnd > liveProjectStart, "live control projection is bounded");
  const liveProject = coopRuntime.slice(liveProjectStart, liveProjectEnd);
  assert.match(
    liveProject,
    /missing\.length > 0 && !isCoopV2RecoveryCommandBootstrapInstalled/u,
    "only an exact recovery bootstrap bypasses the ordinary all-target-live wait",
  );
  const retainedSource = liveProject.indexOf("v2ControlLedger.sourceEntryOf(control)");
  const requiresControlCommit = liveProject.indexOf('sourceEntry?.kind === "CONTROL_COMMIT"', retainedSource);
  const requiresAppliedMaterial = liveProject.indexOf("v2ControlLedger.isMaterialApplied(control)", retainedSource);
  const releasesExactConsumer = liveProject.indexOf(
    "releaseCoopV2ParkedTurnBoundary(runtime, sourceEntry)",
    retainedSource,
  );
  const waitsForCommandProofs = liveProject.indexOf("const missing = localCommands.filter", retainedSource);
  assert.ok(retainedSource >= 0, "command projection retains the immutable source entry");
  assert.ok(
    requiresControlCommit > retainedSource
      && requiresAppliedMaterial > requiresControlCommit
      && releasesExactConsumer > requiresAppliedMaterial,
    "only a materially applied CONTROL_COMMIT is re-presented to its exact current consumer",
  );
  assert.ok(
    waitsForCommandProofs > releasesExactConsumer,
    "the retained presentation handoff occurs before command proof can leave the entry pending",
  );
});

test("an existing Authority V2 runtime rebinds only after the replacement channel is authenticated", () => {
  const start = coopRuntime.indexOf("export function getCoopV2Shadow(");
  const end = coopRuntime.indexOf("\nexport function ", start + 1);
  assert.notEqual(start, -1, "runtime exposes the Authority V2 harness resolver");
  assert.notEqual(end, -1, "runtime resolver has a bounded source block");
  const resolver = coopRuntime.slice(start, end);
  const identity = resolver.indexOf("const identity = resolveCoopV2ShadowIdentity(runtime);");
  const unavailable = resolver.indexOf("if (identity == null)");
  const existing = resolver.indexOf("const existing = coopV2ShadowHarnesses.get(runtime);");
  const rebind = resolver.indexOf("existing.rebindIdentity(identity);");
  assert.ok(identity >= 0 && unavailable > identity, "replacement identity is resolved and required");
  assert.ok(existing > unavailable && rebind > existing, "a retained harness is rebound only after identity proof");
  assert.match(resolver, /reasonCode:\s*"binding-mismatch"/u, "a rejected rebind fails the shared session closed");
});

test("a cold-resume or new-run epoch boundary replaces the V2 log instead of hot-rebinding it", () => {
  const start = coopRuntime.indexOf("const applyOperationEpoch = (epoch: number): void => {");
  const end = coopRuntime.indexOf("\n  };", start);
  assert.notEqual(start, -1, "runtime owns one epoch-boundary callback");
  assert.notEqual(end, -1, "epoch-boundary callback has a bounded source block");
  const callback = coopRuntime.slice(start, end);
  const detectsAdvance = callback.indexOf("authorityV2Epoch !== epoch");
  const disposes = callback.indexOf("disposeCoopV2Shadow(runtime);");
  const publishesEpoch = callback.indexOf("authorityV2Epoch = epoch;");
  const appliesEpoch = callback.indexOf("applyCoopOperationEpoch(epoch, waveOperationBinding)");
  assert.ok(detectsAdvance >= 0, "the callback distinguishes a hard epoch advance from same-epoch hot rejoin");
  assert.ok(disposes > detectsAdvance, "the prior epoch log is retired at the hard boundary");
  assert.ok(
    publishesEpoch > disposes && appliesEpoch > publishesEpoch,
    "the replacement epoch is published only after the old V2 authority is gone",
  );
});

test("the real command proof edge eagerly completes V2 and the duo fixture creates both browser controls", () => {
  const proofStart = coopRuntime.indexOf("export function recordCoopV2CommandControlStarted(");
  const proofEnd = coopRuntime.indexOf("\nexport function ", proofStart + 1);
  assert.notEqual(proofStart, -1, "runtime exposes the real CommandPhase proof chokepoint");
  assert.notEqual(proofEnd, -1, "command proof chokepoint has a bounded source block");
  const proof = coopRuntime.slice(proofStart, proofEnd);
  const records = proof.indexOf("v2InstalledCommandTargets.add");
  const schedulesRetry = proof.indexOf("scheduleCoopV2CommandProofRetry");
  assert.ok(records >= 0, "the real phase records its exact command target");
  assert.ok(schedulesRetry > records, "the real proof schedules replica completion after projection");

  const retryStart = coopRuntime.indexOf("function scheduleCoopV2CommandProofRetry(");
  const retryEnd = coopRuntime.indexOf("\n}\n", retryStart) + 2;
  assert.notEqual(retryStart, -1, "runtime exposes a coalesced command-proof retry helper");
  assert.ok(retryEnd > retryStart, "command-proof retry helper has a bounded source block");
  const retry = coopRuntime.slice(retryStart, retryEnd);
  const defersRetry = retry.indexOf("queueMicrotask");
  const waitsForRuntime = retry.indexOf("runWhenCoopRuntimeActive");
  const retriesReplica = retry.indexOf("retryPendingReplicaEntries");
  assert.ok(
    defersRetry >= 0 && waitsForRuntime > defersRetry && retriesReplica > waitsForRuntime,
    "replica completion is coalesced after the in-flight apply stack and runs under its destination runtime",
  );

  const buildStart = duoHarness.indexOf("export async function buildDuo(");
  const buildEnd = duoHarness.indexOf("\nexport async function remirrorWave(", buildStart);
  assert.notEqual(buildStart, -1, "duo harness exposes its shared builder");
  assert.notEqual(buildEnd, -1, "duo builder has a bounded source block");
  const build = duoHarness.slice(buildStart, buildEnd);
  const adoptsHost = build.indexOf("adoptAlreadyOpenHostCommandBoundary");
  const materializesGuest = build.indexOf("materializeMirroredGuestInputTurn");
  const startsGuest = build.indexOf("guestOwnCommand.start()");
  const permitsGuestReentry = build.indexOf("adoptedCommandReentryPermits.add(guestOwnCommand)");
  const marksGuest = build.indexOf("markRealGuestCommandBoundary");
  const restartsHost = build.indexOf("hostCommand.start()");
  const permitsHostReentry = build.indexOf("adoptedCommandReentryPermits.add(hostCommand)");
  assert.ok(adoptsHost >= 0, "the already-real host control is adopted");
  assert.ok(
    materializesGuest > adoptsHost
      && marksGuest > materializesGuest
      && startsGuest > marksGuest
      && permitsGuestReentry > startsGuest
      && restartsHost > permitsGuestReentry
      && permitsHostReentry > restartsHost,
    "the synthetic second browser proves the real TurnInit/Command boundary before execution can synchronously advance it",
  );

  const startHelperStart = duoHarness.indexOf("function startDuoCommandPhaseIfNeeded(");
  const startHelperEnd = duoHarness.indexOf("\n}\n", startHelperStart) + 2;
  assert.notEqual(startHelperStart, -1, "duo harness exposes one command-start lifecycle helper");
  assert.ok(startHelperEnd > startHelperStart, "command-start lifecycle helper has a bounded source block");
  const startHelper = duoHarness.slice(startHelperStart, startHelperEnd);
  assert.match(startHelper, /manuallyStartedDuoPhases\.has\(phase\)/u);
  assert.match(startHelper, /adoptedCommandReentryPermits\.has\(phase\)/u);
  assert.match(
    startHelper,
    /if \(uiActionable\) \{\s*manuallyStartedDuoPhases\.add\(phase\);\s*adoptedCommandReentryPermits\.delete\(phase\);\s*return;/u,
    "an exact command phase already opened by a production V2 resume is adopted, never started twice",
  );
  assert.match(startHelper, /if \(alreadyStarted && !permittedBootstrapReentry\) \{\s*return;/u);
  assert.match(startHelper, /adoptedCommandReentryPermits\.delete\(phase\)/u);
  assert.match(startHelper, /phase\.start\(\)/u);
});

test("the reciprocal command continuation resumes only in its captured runtime and exact phase", () => {
  assert.match(commandPhase, /const barrierRuntime = getCoopRuntime\(\);\s*const barrierScene = globalScene;/u);
  assert.match(
    commandPhase,
    /pendingBarrier\.then\(crossed => \{[\s\S]*?barrierScene\.phaseManager\.getCurrentPhase\(\) !== this[\s\S]*?runWhenCoopRuntimeActive\(barrierRuntime, openOwnedSurface\)/u,
    "a peer arrival cannot resume a host CommandPhase against the guest phase tree or a superseding phase",
  );
});

test("an exact Authority V2 guest command control arrives without waiting on a later sequential slot", () => {
  const barrierStart = commandPhase.indexOf("private coopNextCommandBarrier");
  const barrierEnd = commandPhase.indexOf("private queueFightErrorMessage", barrierStart);
  assert.ok(barrierStart >= 0 && barrierEnd > barrierStart, "the command rendezvous source slice is present");
  const barrier = commandPhase.slice(barrierStart, barrierEnd);
  assert.match(
    barrier,
    /if \(isCoopAuthoritativeGuest\(\) && isCoopV2ControlCutoverActive\(\)\) \{\s*coopLog\([\s\S]*?rendezvous\.arrive\(point\);\s*return null;\s*\}/u,
    "the authoritative guest still announces its exact command point but cannot deadlock on host arrival",
  );
  assert.ok(
    barrier.indexOf("isCoopAuthoritativeGuest() && isCoopV2ControlCutoverActive()")
      < barrier.indexOf("rendezvous.hasPartnerArrived(point)"),
    "the V2 guest arrive-only release must run before every reciprocal await path",
  );
});

test("interaction DATA cannot wait on a successor phase that ordinary V2 projection must create", () => {
  const materialStart = coopRuntime.indexOf("function materializeCoopMeOperationFromOp(");
  const materialEnd = coopRuntime.indexOf("\ntype CoopV2InteractionLiveMaterializer", materialStart);
  assert.notEqual(materialStart, -1, "runtime exposes the registered Mystery materializer");
  assert.ok(materialEnd > materialStart, "Mystery materializer has a bounded source block");
  const materializer = coopRuntime.slice(materialStart, materialEnd);
  assert.match(materializer, /setCoopMeInteractionStart\(pinned\)/u);
  assert.match(
    materializer,
    /materializeCommittedInteractionOutcome\(seq,\s*payload\.presentation,\s*op\.id\)/u,
    "DATA installs the exact immutable presentation into the addressed relay",
  );
  assert.doesNotMatch(
    materializer,
    /installCoopV2MePresentation/u,
    "DATA must not require the successor phase before materialApplied",
  );

  const projectionStart = coopRuntime.indexOf("function prepareCoopV2OrdinaryInteractionControlSurface(");
  const projectionEnd = coopRuntime.indexOf(
    "\n/**\n * Construct the exact engine generation recovery",
    projectionStart,
  );
  assert.notEqual(projectionStart, -1, "runtime exposes the ordinary immutable interaction projector");
  assert.ok(projectionEnd > projectionStart, "ordinary interaction projector has a bounded source block");
  const projector = coopRuntime.slice(projectionStart, projectionEnd);
  assert.match(projector, /materializeCoopV2InteractionProjection\(runtime, control, plan\)/u);
  for (const kind of [
    "ability",
    "catch-full",
    "colosseum",
    "learn-move",
    "learn-move-batch",
    "revival",
    "stormglass",
  ]) {
    assert.match(
      projector,
      new RegExp(`plan\\.kind === "${kind}"`, "u"),
      `ordinary delivery reconstructs the ${kind} modal from the same immutable plan as recovery`,
    );
  }
  for (const kind of ["bargain", "biome", "crossroads", "mystery", "reward", "market"]) {
    assert.match(
      projector,
      new RegExp(`plan\\.kind !== "${kind}"`, "u"),
      `ordinary delivery closes the ${kind} sequential successor over obsolete local progression`,
    );
  }
  assert.match(
    projector,
    /phaseManager\.replaceWithCoopAuthoritativeModal\(current, phase\)/u,
    "a suppressed legacy prompt or occupied generic override slot cannot block an authoritative modal",
  );
  assert.doesNotMatch(projector, /phaseManager\.overridePhase\(phase\)/u);
  assert.match(projector, /phaseManager\.replaceWithCoopAuthoritativePhase\(current, phase\)/u);
  assert.doesNotMatch(
    projector,
    /current\.end\(\)/u,
    "the obsolete local phase must not derive a successor after the ordered log did",
  );
  assert.match(
    projector,
    /`projected exact \$\{plan\.kind\} generation/u,
    "every authenticated sequential successor reports its destructive projection",
  );

  const bindReward = projector.indexOf("bound exact reward generation");
  const bindCrossroads = projector.indexOf("bound exact crossroads generation");
  const bindBiome = projector.indexOf("bound exact biome generation");
  const retainMarket = projector.indexOf("retained live market shell");
  const bindMarket = projector.indexOf("bound exact market generation");
  const destructiveSequentialProjection = projector.indexOf(
    "phaseManager.replaceWithCoopAuthoritativePhase(current, phase)",
  );
  assert.ok(bindReward >= 0, "an exact already-live reward generation is bound in place");
  assert.ok(bindCrossroads >= 0, "an exact already-live Crossroads generation is bound in place");
  assert.ok(bindBiome >= 0, "an exact already-live World Map generation is bound in place");
  assert.ok(retainMarket >= 0, "a later market operation retains the one live FIFO consumer");
  assert.ok(bindMarket >= 0, "an exact already-live market generation is bound in place");
  assert.ok(
    bindReward < destructiveSequentialProjection
      && retainMarket < bindMarket
      && bindMarket < destructiveSequentialProjection,
    "live reward and market continuations are preserved before obsolete predecessors are replaced",
  );
  assert.match(
    projector,
    /currentMarket\.retainsCoopV2MarketProjectionBoundary\?\.\(plan\.projection\) === true[\s\S]*?retained live market shell/u,
    "later market buy/terminal generations retain the already-armed phase without relabelling it",
  );
  assert.match(
    projector,
    /current\.is\("SelectModifierPhase"\)[\s\S]*?installCoopV2RewardProjection\(plan\.operationId, plan\.projection\)/u,
    "the reward fast path validates the existing constructor generation before binding it",
  );
  assert.match(
    projector,
    /current\.is\("ErCrossroadsPhase"\)[\s\S]*?installCoopV2CrossroadsProjection\(plan\.operationId, plan\.sourceWave, control\.turn\)/u,
    "the Crossroads fast path validates the existing captured source boundary before binding it",
  );
  const crossroadsStart = crossroadsPhase.indexOf("private async coopStart(");
  const crossroadsContinue = crossroadsPhase.indexOf("private continueCoopStart(", crossroadsStart);
  assert.ok(
    crossroadsStart >= 0 && crossroadsContinue > crossroadsStart,
    "the Crossroads authority start boundary is structurally bounded",
  );
  const crossroadsBoundary = crossroadsPhase.slice(crossroadsStart, crossroadsContinue);
  assert.match(
    crossroadsBoundary,
    /const v2ControlCutover = isCoopV2ControlCutoverActive\(this\.coopOwningRuntime\)/u,
    "Crossroads decides the authority model from its construction-time runtime",
  );
  assert.match(
    crossroadsBoundary,
    /if \(!spoofed && !recoveredExactControl && !v2ControlCutover\) \{\s*const barrier = await this\.coopAwaitBoundaryBarrier\(\)/u,
    "the legacy reciprocal rendezvous cannot precede a V2 interaction-open and deadlock its replica",
  );
  assert.match(
    coopRuntime,
    /export function isCoopV2ControlCutoverActive\(runtime: CoopRuntime \| null = active\): boolean \{\s*return runtime != null && coopV2ControlCutovers\.has\(runtime\)/u,
    "the barrier bypass is scoped to the exact runtime with the complete V2 control graph",
  );
  assert.match(
    projector,
    /current\.is\("SelectBiomePhase"\)[\s\S]*?installCoopV2BiomeProjection\(plan\.operationId, plan\.sourceWave, control\.turn, plan\.pinned\)/u,
    "the World Map fast path validates the existing captured source boundary and immutable pin",
  );
  assert.ok(
    bindCrossroads < destructiveSequentialProjection && bindBiome < destructiveSequentialProjection,
    "live biome generations are retained before the destructive obsolete-predecessor fallback",
  );
  assert.match(
    projector,
    /currentMarket\.coopV2ProofPhaseName === coopV2MarketProjectionPhaseName\(plan\)[\s\S]*?currentMarket\.installCoopV2MarketProjection\(plan\.operationId, plan\.projection\)/u,
    "the market fast path validates its concrete V2 identity and generation before binding it",
  );
  assert.match(selectModifierPhase, /this\.rerollCount !== projection\.reroll/u);
  assert.match(selectModifierPhase, /this\.coopInteractionStart !== projection\.pinned/u);
  assert.match(
    selectModifierPhase,
    /this\.coopV2ProjectedMysteryFinalizer = projection\.rewardSurface != null/u,
    "the immutable ordered Mystery surface marks destructive reward projection for one finalizer",
  );
  const rewardStart = selectModifierPhase.indexOf("  start() {");
  const rewardOptionsAwait = selectModifierPhase.indexOf("this.startCoopWatch()", rewardStart);
  const projectedMeFinalizer = selectModifierPhase.indexOf(
    'globalScene.phaseManager.pushNew("PostMysteryEncounterPhase")',
    rewardStart,
  );
  assert.ok(
    projectedMeFinalizer > rewardStart && projectedMeFinalizer < rewardOptionsAwait,
    "the exact Mystery terminal fence is queued before projected reward options can await or exit",
  );
  assert.match(
    selectModifierPhase.slice(rewardStart, projectedMeFinalizer),
    /this\.coopV2ProjectedMysteryFinalizer = false/u,
    "a repeated phase start cannot duplicate the projected Mystery finalizer",
  );
  assert.match(biomeShopPhase, /this\.coopBiomeStart !== projection\.pinned/u);
  const retainedMarketStart = biomeShopPhase.indexOf("public retainsCoopV2MarketProjectionBoundary(");
  const retainedMarketEnd = biomeShopPhase.indexOf("\n  /**", retainedMarketStart + 1);
  assert.ok(retainedMarketStart >= 0 && retainedMarketEnd > retainedMarketStart, "market retention is bounded");
  const retainedMarket = biomeShopPhase.slice(retainedMarketStart, retainedMarketEnd);
  assert.match(retainedMarket, /this\.coopBiomeStart === projection\.pinned/u);
  assert.match(retainedMarket, /this\.coopBoundaryStillLive\(coopSessionGeneration\(\), wave\)/u);
  assert.doesNotMatch(retainedMarket, /coopV2ControlOperationId\s*=/u, "retention cannot pre-prove the new operation");
  const retainMarketCheck = projector.indexOf("currentMarket.retainsCoopV2MarketProjectionBoundary?.(");
  const retainMarketReturn = projector.indexOf("return true;", retainMarketCheck);
  assert.ok(retainMarketCheck >= 0 && retainMarketReturn > retainMarketCheck, "market retention branch is bounded");
  assert.doesNotMatch(
    projector.slice(retainMarketCheck, retainMarketReturn),
    /materializeCoopV2RewardOptionsProjection/u,
    "DATA already woke the retained market FIFO; retention cannot republish stock into the next generation",
  );

  const modalStart = phaseManager.indexOf("public replaceWithCoopAuthoritativeModal(");
  const modalEnd = phaseManager.indexOf("\n  /**\n   * Determine the next phase", modalStart);
  assert.ok(modalStart >= 0 && modalEnd > modalStart, "PhaseManager exposes a bounded V2 modal replacement");
  const modal = phaseManager.slice(modalStart, modalEnd);
  assert.match(modal, /this\.currentPhase !== predecessor/u);
  assert.ok(
    modal.indexOf("this.standbyPhase = predecessor") < modal.indexOf("this.currentPhase = successor"),
    "the old renderer standby is replaced by the exact ordered predecessor before the modal starts",
  );
  assert.doesNotMatch(modal, /clearAllPhases/u, "the parked V2 predecessor remains the modal's return target");
});

test("Mystery publishes the real actionability edge after its click-through guard expires", () => {
  const unblockStart = mysteryEncounterUiHandler.indexOf("  unblockInput() {");
  const unblockEnd = mysteryEncounterUiHandler.indexOf("\n  override isCoopV2InputActionable", unblockStart);
  assert.notEqual(unblockStart, -1, "Mystery exposes its delayed input release");
  assert.ok(unblockEnd > unblockStart, "Mystery input release has a bounded source block");
  const unblock = mysteryEncounterUiHandler.slice(unblockStart, unblockEnd);
  const release = unblock.indexOf("this.blockInput = false");
  const proof = unblock.indexOf("notifyCoopV2InteractionSurfaceReady()");
  assert.ok(release >= 0, "the click-through guard is actually released");
  assert.ok(proof > release, "controlInstalled is retried only after the real Mystery handler becomes actionable");
});

test("opening reward confirmation does not require an unchanged watcher to emit a second surface", () => {
  const leaveStart = publicUiHarness.indexOf("  async leaveRewardsAndReachWave2(");
  const leaveEnd = publicUiHarness.indexOf("\n  async ", leaveStart + 1);
  assert.ok(leaveStart >= 0 && leaveEnd > leaveStart, "the public reward-leave journey has a bounded method");
  const leave = publicUiHarness.slice(leaveStart, leaveEnd);
  assert.match(leave, /owner\.waitForOwnedRewardConfirm\(rewardConfirmCursors\[owner\.label\]/u);
  assert.match(
    leave,
    /watcher\.waitForAddressedRewardWatcher\([\s\S]*?ownerCursors\[watcher\.label\]/u,
    "the exact already-visible watcher is addressed from the pre-reward frontier",
  );
  assert.doesNotMatch(
    leave,
    /waitForAddressedRewardWatcher\([\s\S]*?rewardConfirmCursors\[watcher\.label\]/u,
    "an owner-only CONFIRM transition cannot require a fictitious new watcher event",
  );
});

test("V2 Mystery waits for its ordered presentation and destructively replaces the local classifier", () => {
  const guestStart = mysteryEncounterPhases.indexOf("if (isCoopAuthoritativeGuest())");
  const guestEnd = mysteryEncounterPhases.indexOf(
    "// Clears out queued phases that are part of standard battle",
    guestStart,
  );
  assert.ok(guestStart >= 0, "the authoritative guest Mystery classifier exists");
  assert.ok(guestEnd > guestStart, "the guest classifier has a bounded source section");
  const guestClassifier = mysteryEncounterPhases.slice(guestStart, guestEnd);
  const cutover = guestClassifier.indexOf("isCoopV2InteractionCutoverActive(getCoopRuntime()?.durability)");
  const legacyPush = guestClassifier.indexOf('globalScene.phaseManager.pushNew("CoopReplayMePhase"');
  assert.ok(cutover >= 0, "V2 cutover is checked before deriving a local Mystery successor");
  assert.ok(legacyPush > cutover, "the legacy replay fallback remains strictly behind the V2 hold");
  assert.match(
    guestClassifier.slice(cutover, legacyPush),
    /return;/u,
    "V2 holds the classifier until the authenticated ME_PRESENT projector installs its successor",
  );

  const replacementStart = phaseManager.indexOf("public replaceWithCoopAuthoritativePhase(");
  const replacementEnd = phaseManager.indexOf("/**", replacementStart + 1);
  assert.ok(replacementStart >= 0, "the destructive Authority V2 phase replacement exists");
  assert.ok(replacementEnd > replacementStart, "the replacement has a bounded source section");
  const replacement = phaseManager.slice(replacementStart, replacementEnd);
  assert.match(replacement, /this\.currentPhase !== predecessor/u);
  assert.match(replacement, /this\.clearAllPhases\(\)/u);
  assert.match(replacement, /this\.currentPhase = successor/u);
  assert.match(replacement, /this\.startCurrentPhase\(\)/u);
  assert.doesNotMatch(
    replacement,
    /predecessor\.end\(\)/u,
    "the legacy predecessor never gets another chance to choose progression",
  );

  const harnessStart = duoHarness.indexOf("export async function startGuestMeReplay(");
  const harnessEnd = duoHarness.indexOf("/**", harnessStart + 1);
  assert.ok(harnessStart >= 0, "the two-engine Mystery scheduler exists");
  assert.ok(harnessEnd > harnessStart, "the Mystery scheduler has a bounded source section");
  const harness = duoHarness.slice(harnessStart, harnessEnd);
  assert.match(
    harness,
    /current\?\.phaseName === "CoopReplayMePhase" \? current : null/u,
    "the headless scheduler observes V2's directly installed phase rather than requiring a legacy queue tap",
  );
});

test("the duo Mystery driver crosses only an interceptor-suppressed projected phase start", () => {
  const driverStart = duoHarness.indexOf("export async function driveDuoGuestMeReplay(");
  const driverEnd = duoHarness.indexOf("\n/**", driverStart + 1);
  assert.notEqual(driverStart, -1, "the duo harness exposes its retained Mystery driver");
  assert.ok(driverEnd > driverStart, "the retained Mystery driver has a bounded source block");
  const driver = duoHarness.slice(driverStart, driverEnd);
  const readsActive = driver.indexOf("getActiveCoopReplayMePhaseForHarness()");
  const readsCurrent = driver.indexOf("phaseManager.getCurrentPhase()");
  const provesUnstartedCurrent = driver.indexOf("current === projectedReplay && activeReplay !== projectedReplay");
  const startsProjected = driver.indexOf("projectedReplay.start()", provesUnstartedCurrent);
  const legacyFallback = driver.indexOf("startGuestMeReplay(rig.guestScene)");
  assert.ok(readsActive >= 0 && readsCurrent > readsActive, "the driver observes both runtime and scheduler ownership");
  assert.ok(
    provesUnstartedCurrent > readsCurrent && startsProjected > provesUnstartedCurrent,
    "only a current phase which the interceptor left inactive receives the omitted browser scheduler edge",
  );
  assert.ok(legacyFallback > readsCurrent, "legacy construction remains a fallback only when V2 projected no replay");
});

test("every Mystery result stays on the presentation's pre-battle authority coordinate", () => {
  assert.match(meOperation, /export const COOP_ME_AUTHORITY_TURN = 0;/u);
  assert.match(
    meOperation,
    /if \(params\.turn !== COOP_ME_AUTHORITY_TURN\) \{\s+coopWarn\("me", `ME op OWNER rejected/u,
    "the runtime commit boundary also rejects an untyped or stale ambient turn",
  );
  assert.match(
    meOperation,
    /guest\(\)\.hasApplied\(id\) \? \{ epoch: s\.epoch, wave, turn: COOP_ME_AUTHORITY_TURN \} : null/u,
    "guest result proof returns the same fixed coordinate",
  );

  for (const functionName of [
    "commitCoopMeBattleSettlementAtBattleEnd",
    "commitCoopMeNoBattleRewardSettlementAfterPreparation",
    "coopMeOwnerRelayBattleHandoff",
  ]) {
    const start = coopRuntime.indexOf(`function ${functionName}(`);
    const end = coopRuntime.indexOf("\n/**", start + 1);
    assert.ok(start >= 0, `${functionName} exists`);
    assert.ok(end > start, `${functionName} has a bounded source section`);
    const source = coopRuntime.slice(start, end);
    assert.match(source, /kind: "ME_TERMINAL"/u, `${functionName} commits a Mystery terminal`);
    assert.match(
      source,
      /turn: COOP_ME_AUTHORITY_TURN/u,
      `${functionName} preserves the presentation's authority coordinate`,
    );
    assert.doesNotMatch(
      source,
      /turn: (?:battle\.turn|hostTurn)/u,
      `${functionName} must not borrow the battle's ambient turn for log ordering`,
    );
  }

  const mysteryCoordinates = mysteryEncounterPhases.match(/turn: COOP_ME_AUTHORITY_TURN/g) ?? [];
  assert.equal(
    mysteryCoordinates.length,
    4,
    "presentation, owner picks, and the no-battle terminal all share the fixed Mystery coordinate",
  );
});

test("Mystery projection construction cannot recursively attest an unopened handler", () => {
  const installerStart = replayMePhase.indexOf("public installCoopV2MePresentation(");
  const installerEnd = replayMePhase.indexOf("/**", installerStart + 1);
  assert.ok(installerStart >= 0, "the V2 Mystery presentation installer exists");
  assert.ok(installerEnd > installerStart, "the V2 Mystery presentation installer has a bounded source section");
  const installer = replayMePhase.slice(installerStart, installerEnd);
  assert.doesNotMatch(
    installer,
    /notifyCoopV2InteractionSurfaceReady/u,
    "constructing a replay phase must not re-enter projection before that phase owns a public handler",
  );

  const readinessStart = replayMePhase.indexOf("private openV2MysterySurface(");
  const readinessEnd = replayMePhase.indexOf("constructor(", readinessStart);
  assert.ok(readinessStart >= 0, "the live Mystery surface opener exists");
  assert.ok(readinessEnd > readinessStart, "the live Mystery surface opener has a bounded source section");
  const readiness = replayMePhase.slice(readinessStart, readinessEnd);
  assert.match(readiness, /openModeBounded\(UiMode\.MYSTERY_ENCOUNTER/u);
  assert.match(readiness, /boundaryStillLive\(\)/u);
  const openingIndex = readiness.indexOf("const opening = this.openModeBounded(");
  const immediateProofIndex = readiness.indexOf("notifyCoopV2InteractionSurfaceReady(this.boundRuntime)", openingIndex);
  const settledRetryIndex = readiness.indexOf("void opening.then(", immediateProofIndex);
  assert.ok(openingIndex >= 0, "the Mystery surface starts opening before it can attest control");
  assert.ok(
    immediateProofIndex > openingIndex && settledRetryIndex > immediateProofIndex,
    "the synchronously actionable handler is proved before public input can outrun the settled retry",
  );
  assert.match(
    readiness,
    /void opening\.then\([\s\S]*notifyCoopV2InteractionSurfaceReady\(this\.boundRuntime\)/u,
    "an asynchronously actionable Mystery handler retains its settled proof retry",
  );
});

test("repeated Mystery rounds bind the new log address only when their fresh presentation is consumed", () => {
  const rebindStart = replayMePhase.indexOf("private rebindLiveCoopV2MePresentation(");
  const rebindEnd = replayMePhase.indexOf("/**", rebindStart + 1);
  assert.ok(rebindStart >= 0, "the live replay shell exposes an address handoff for repeated rounds");
  assert.ok(rebindEnd > rebindStart, "the repeated-round address handoff has a bounded source section");
  const rebind = replayMePhase.slice(rebindStart, rebindEnd);
  assert.match(rebind, /boundaryStillLive\(\)/u);
  assert.match(rebind, /this\.settled/u);
  assert.match(
    rebind,
    /installCoopV2MePresentation\([\s\S]*?operationId,[\s\S]*?this\.interactionCounter,[\s\S]*?this\.coopV2MysteryEncounterType,[\s\S]*?this\.coopV2InstalledIntroVisuals,[\s\S]*?presentation/u,
    "a repeated presentation retains both the immutable encounter identity and its resolved visual material",
  );

  const outcomeStart = replayMePhase.indexOf("const outcome = winner.outcome;");
  const repeatStart = replayMePhase.indexOf(
    'if (outcome != null && outcome.k === "mePresent" && outcome.subPrompt == null',
    outcomeStart,
  );
  assert.ok(outcomeStart >= 0 && repeatStart > outcomeStart, "the repeated presentation branch exists");
  const outcomeBinding = replayMePhase.slice(outcomeStart, repeatStart);
  const consume = outcomeBinding.indexOf("consumeCommittedInteractionOutcomeOperationId(this.seq, outcome)");
  const bind = outcomeBinding.indexOf("rebindLiveCoopV2MePresentation(committedOperationId, outcome)");
  assert.ok(consume >= 0 && bind > consume, "the FIFO consumer recovers and binds the exact committed address");
  assert.match(
    outcomeBinding,
    /failCoopSharedSession/u,
    "a journal presentation without an exact operation address fails closed",
  );

  const projectionStart = coopRuntime.indexOf("function prepareCoopV2OrdinaryInteractionControlSurface(");
  const projectionEnd = coopRuntime.indexOf(
    "\n/**\n * Construct the exact engine generation recovery",
    projectionStart,
  );
  const projector = coopRuntime.slice(projectionStart, projectionEnd);
  assert.doesNotMatch(
    projector,
    /rebindLiveCoopV2MePresentation/u,
    "the projector cannot relabel the old actionable handler before the new FIFO presentation is consumed",
  );
  const retain = projector.indexOf("retainsCoopV2MePresentationBoundary(plan.pinned)");
  const replace = projector.indexOf("phaseManager.replaceWithCoopAuthoritativePhase(current, phase)");
  assert.ok(retain >= 0 && replace > retain, "a live repeated-round shell is retained before destructive projection");
  assert.doesNotMatch(
    projector.slice(0, replace),
    /installCoopV2MePresentation/u,
    "ordinary projection never binds the new Mystery address before the FIFO consumer renders it",
  );

  const journalApplyStart = meOperation.indexOf("function applyJournaledMeEnvelope(");
  const journalApplyEnd = meOperation.indexOf("registerCoopOperationApplier", journalApplyStart);
  const journalApply = meOperation.slice(journalApplyStart, journalApplyEnd);
  const materialApplied = journalApply.indexOf('applyCoopOperationEnvelope(g, "op:me", envelope, applyContext)');
  const resultReceipt = journalApply.indexOf('settleCoopMeOwnerIntentRetries("authoritative-result")');
  assert.ok(
    materialApplied >= 0 && resultReceipt > materialApplied,
    "a later immutable ME_PRESENT retires proposal retries only after its material result applies",
  );
  assert.match(
    journalApply.slice(materialApplied, resultReceipt),
    /op\.kind === "ME_PRESENT"/u,
    "proposal retries are not retired by an unrelated or merely admitted V2 entry",
  );

  assert.match(
    browserEntry,
    /phaseAuthorityOperationId[\s\S]*authorityAddress[\s\S]*phase === "CoopReplayMePhase"[\s\S]*\(authorityAddress % 1_000\) \+ 1/u,
    "the keyboard-only observer exposes each ordered repeated presentation as a fresh positive generation",
  );
  assert.match(
    campaignDriver,
    /observation\.phaseInstance,[\s\S]*observation\.surfaceGeneration/u,
    "the campaign's appearance identity consumes the ordered presentation generation",
  );
});

test("biome-market readiness proves the exact actionable owner or fully armed watcher surface", () => {
  const readinessStart = biomeShopPhase.indexOf("private notifyCoopBiomeContinuationSurfaceReady(");
  const readinessEnd = biomeShopPhase.indexOf(
    "/** Never let a market continue against locally generated stock",
    readinessStart,
  );
  assert.ok(readinessStart >= 0, "the biome-market readiness publisher exists");
  assert.ok(readinessEnd > readinessStart, "the biome-market publisher has a bounded source section");
  const readiness = biomeShopPhase.slice(readinessStart, readinessEnd);
  assert.match(readiness, /coopAsyncBoundaryStillLive\(generation, wave, pinned\)/u);
  assert.match(readiness, /handler\?\.active === true/u);
  assert.match(readiness, /handler\.isCoopV2InputActionable\?\.\(\) === true/u);
  assert.match(readiness, /mode === UiMode\.BIOME_SHOP && actionable/u);
  assert.match(
    readiness,
    /this\.coopBiomeWatcherContinuationReady && mode === UiMode\.MESSAGE && actionable/u,
    "watcher readiness requires stock materialization and its live terminal consumer",
  );
  const interactionReady = readiness.indexOf("notifyCoopV2InteractionSurfaceReady(");
  const surfaceProof = readiness.indexOf("const publicSurface");
  assert.ok(interactionReady > surfaceProof, "V2 cannot retire before the concrete market surface is proven");
});

test("command material waits for an address-exact engine consumer, never a phase-name allowlist", () => {
  const consumerStart = coopRuntime.indexOf("function hasCoopV2CommandOpenMaterialConsumer(");
  const consumerEnd = coopRuntime.indexOf("\n/**\n * Release the real turn finalizer", consumerStart);
  assert.notEqual(consumerStart, -1, "runtime exposes one command material consumer proof");
  assert.ok(consumerEnd > consumerStart, "the command material proof has a bounded source block");
  const consumer = coopRuntime.slice(consumerStart, consumerEnd);
  assert.match(consumer, /v2DeferredCommandStarts/u);
  assert.match(consumer, /commandOpenControlAddressesClaim\(control, claim\)/u);
  assert.match(consumer, /canReleaseForCoopV2Control/u);
  assert.doesNotMatch(consumer, /phaseName|EncounterPhase|SwitchBiomePhase/u);

  const applyStart = coopRuntime.indexOf(
    'if (material.kind === "command-open" && !hasCoopV2CommandOpenMaterialConsumer',
  );
  assert.notEqual(applyStart, -1, "command material is fail-closed behind the exact consumer proof");

  const addressStart = controlOpenAdapter.indexOf("export function commandOpenControlAddressesClaim(");
  const addressEnd = controlOpenAdapter.indexOf("\n}\n", addressStart) + 2;
  assert.notEqual(addressStart, -1, "the adapter exposes one shared command address matcher");
  assert.ok(addressEnd > addressStart, "the command address matcher has a bounded source block");
  const address = controlOpenAdapter.slice(addressStart, addressEnd);
  assert.match(address, /control\.epoch === claim\.epoch/u);
  assert.match(address, /control\.wave === claim\.wave/u);
  assert.match(address, /control\.turn === claim\.turn/u);
  assert.match(address, /command\.fieldIndex/u);
  assert.match(address, /command\.pokemonId/u);
});

test("a committed replacement wake cannot be stranded behind its own turn finalizer", () => {
  const markStart = coopRuntime.indexOf("function markCoopV2ControlMaterialApplied(");
  const markEnd = coopRuntime.indexOf("\n}\n", markStart) + 2;
  assert.notEqual(markStart, -1, "runtime exposes the materialApplied successor edge");
  assert.ok(markEnd > markStart, "materialApplied successor edge has a bounded source block");
  const mark = coopRuntime.slice(markStart, markEnd);
  const reconstructsPicker = mark.indexOf("releaseCoopV2DeferredInteractionStarts");
  const releasesFinalizer = mark.indexOf("releaseCoopV2ParkedTurnBoundary");
  assert.ok(reconstructsPicker >= 0, "the exact deferred replacement picker is reconstructed");
  assert.ok(
    releasesFinalizer > reconstructsPicker,
    "the parked turn is released only after its exact replacement wake is queued",
  );

  const acceptsStart = replayPhases.indexOf("private acceptsCoopV2ControlSuccessor(");
  const acceptsEnd = replayPhases.indexOf("\n  /** Non-mutating proof", acceptsStart);
  assert.notEqual(acceptsStart, -1, "the real finalizer exposes one exact successor predicate");
  assert.ok(acceptsEnd > acceptsStart, "the successor predicate has a bounded source block");
  const accepts = replayPhases.slice(acceptsStart, acceptsEnd);
  assert.match(accepts, /successor\.revision === this\.authorityRevision/u);
  assert.match(accepts, /statedControl\?\.kind === "REPLACEMENT"/u);
  assert.match(accepts, /controlIdOf\(successor\.nextControl\) === controlIdOf\(statedControl\)/u);
  assert.match(
    accepts,
    /successor\.revision === this\.authorityRevision \+ 1[\s\S]*statedControl\?\.kind === "REPLACEMENT"[\s\S]*successor\.kind === "REPLACEMENT_COMMIT"[\s\S]*successor\.operationId === statedControl\.operationId/u,
    "the executable replacement control releases only through its exact globally-next immutable result",
  );

  const proofStart = replayPhases.indexOf("public canReleaseForCoopV2Control(");
  const proofEnd = replayPhases.indexOf("\n  public releaseForCoopV2Control(", proofStart);
  assert.notEqual(proofStart, -1, "the finalizer exposes a non-mutating pre-apply proof");
  assert.ok(proofEnd > proofStart, "the pre-apply proof has a bounded source block");
  const proof = replayPhases.slice(proofStart, proofEnd);
  assert.match(proof, /return this\.acceptsCoopV2ControlSuccessor\(successor\)/u);
  assert.doesNotMatch(proof, /authoritySuccessorReady|completeCoopV2ControlRelease/u);

  const releaseStart = proofEnd + 1;
  const releaseEnd = replayPhases.indexOf("\n  private completeCoopV2ControlRelease(", releaseStart);
  assert.ok(releaseEnd > releaseStart, "the finalizer release edge has a bounded source block");
  const release = replayPhases.slice(releaseStart, releaseEnd);
  assert.match(release, /this\.acceptsCoopV2ControlSuccessor\(successor\)/u);
  assert.match(release, /this\.authoritySuccessorReady \?\?= successor/u);

  const parkStart = replayPhases.indexOf("} else if (v2NoImmediateCommand) {");
  const parkEnd = replayPhases.indexOf("\n      } else {", parkStart);
  assert.notEqual(parkStart, -1, "the finalizer has an explicit non-command park");
  assert.ok(parkEnd > parkStart, "the non-command park has a bounded source block");
  const park = replayPhases.slice(parkStart, parkEnd);
  const marksParked = park.indexOf("this.awaitingAuthoritySuccessor = true");
  const consumesEarlyWake = park.indexOf("this.authoritySuccessorReady != null");
  assert.ok(
    marksParked >= 0 && consumesEarlyWake > marksParked,
    "a wake installed during receipt completion is consumed at the exact park decision",
  );
});

test("the public continuation oracle proves exact V2 retirement or authenticated log subsumption", () => {
  assert.match(
    authorityLog,
    /subsumedRevisions\.push\(subsumed\)/u,
    "the authority verdict identifies only revisions its own retained window actually retired",
  );
  assert.match(
    shadow,
    /subsumed=\[\$\{verdict\.subsumedRevisions\?\.join\(","\) \?\? ""\}\]/u,
    "the public trace exposes exact supersession evidence instead of hiding it behind the successor receipt",
  );
  const proofStart = publicUiHarness.indexOf("async assertRetainedContinuation(");
  const proofEnd = publicUiHarness.indexOf("\n  async assertRetainedRewardTerminal(", proofStart);
  assert.notEqual(proofStart, -1, "the public journey owns one retained-continuation proof");
  assert.ok(proofEnd > proofStart, "the retained-continuation proof has a bounded source block");
  const proof = publicUiHarness.slice(proofStart, proofEnd);
  assert.match(proof, /const exactOwnRetirement = new RegExp/u);
  assert.match(proof, /const exactSubsumption = new RegExp/u);
  assert.match(proof, /rev=\$\{authorityRevision \+ 1\}/u, "only the exact next ordered revision may subsume the turn");
  assert.match(proof, /subsumed=.*\$\{authorityRevision\}/u, "the proof names the exact predecessor revision");
  assert.equal(
    [
      ...proof.matchAll(
        /this\.host\.evidence\.waitFor\((?:exactTurnReceipt|exactMechanicalRetirement), \{[\s\S]*?from: 0,/gu,
      ),
    ].length,
    2,
    "exact V2 identity proofs scan the full host trace instead of comparing cross-browser wall-clock cursors",
  );
  assert.match(proof, /"v2-subsumption" : "v2-retirement"/u);
});

test("a materially complete non-control entry wakes the exact command frontier it already owns", () => {
  const markStart = coopRuntime.indexOf("function markCoopV2ControlMaterialApplied(");
  const markEnd = coopRuntime.indexOf("\n}\n", markStart) + 2;
  assert.notEqual(markStart, -1, "runtime exposes the shared material-terminal seam");
  assert.ok(markEnd > markStart, "material-terminal seam has a bounded source block");
  const mark = coopRuntime.slice(markStart, markEnd);
  assert.match(
    mark,
    /entry\.kind !== "CONTROL_COMMIT" && entry\.nextControl\.kind === "COMMAND_FRONTIER"[\s\S]*releaseCoopV2DeferredCommandStarts\(runtime, entry\.nextControl\)/u,
    "replacement/turn/wave entries release a CommandPhase parked while their own material was applying",
  );
});

test("ordinary replacement projection has an immutable fallback when cosmetic faint replay is absent", () => {
  const prepareStart = coopRuntime.indexOf("function prepareCoopV2OrdinaryReplacementControlSurface(");
  const prepareEnd = coopRuntime.indexOf("\n/**\n * Install an ordinary replica's exact V2 successor", prepareStart);
  assert.notEqual(prepareStart, -1, "runtime exposes the ordinary replacement projector");
  assert.ok(prepareEnd > prepareStart, "ordinary replacement projector has a bounded source block");
  const prepare = coopRuntime.slice(prepareStart, prepareEnd);
  const readsImmutableEntry = prepare.indexOf("v2ControlLedger.sourceEntryOf(control)");
  const checksExactControl = prepare.indexOf("controlsEqual(sourceEntry.nextControl, control)");
  const queuesExactPicker = prepare.indexOf('unshiftNew("CoopGuestFaintSwitchPhase"');
  const releasesFinalizer = prepare.lastIndexOf("releaseCoopV2ParkedTurnBoundary(runtime, sourceEntry)");
  assert.ok(readsImmutableEntry >= 0, "projection starts from the retained mechanical entry");
  assert.ok(checksExactControl > readsImmutableEntry, "the retained entry must state the identical control");
  assert.ok(
    queuesExactPicker > checksExactControl,
    "the exact picker is reconstructed without a faint-event side token",
  );
  assert.ok(
    releasesFinalizer > queuesExactPicker,
    "the predecessor finalizer cannot yield until the immutable picker wake exists",
  );

  const projectStart = coopRuntime.indexOf("function projectCoopV2InteractionControl(");
  const projectEnd = coopRuntime.indexOf("\n/**\n * Mark the exact globally-registered successor", projectStart);
  assert.notEqual(projectStart, -1, "runtime exposes the ordinary interaction projector");
  assert.ok(projectEnd > projectStart, "ordinary interaction projector has a bounded source block");
  const project = coopRuntime.slice(projectStart, projectEnd);
  assert.match(project, /prepareCoopV2OrdinaryReplacementControlSurface\(runtime, control\)/u);
});

test("a won-wave faint reopens replacement only through one exact phase-owned CONTROL_COMMIT", () => {
  assert.match(
    controlOpenAdapter,
    /interface CoopReplacementOpenMaterialV2[\s\S]*origin: "settled-wave" \| "pre-encounter"[\s\S]*authoritativeState:[\s\S]*control:/u,
  );
  assert.match(controlOpenAdapter, /buildReplacementOpenEntry[\s\S]*replacementOpenMaterialDigest/u);
  assert.match(
    controlOpenAdapter,
    /decodeReplacementOpenEntry[\s\S]*controlsEqual\(material\.control, entry\.nextControl\)/u,
    "replacement-open decoding binds complete material to the identical executable control",
  );
  assert.match(
    controlOpenAdapter,
    /classifyReplacementOpenCursor[\s\S]*"advance-one"[\s\S]*"await-destination"/u,
    "replacement-open owns one exact same-wave cursor edge but never manufactures a future Battle shell",
  );

  const controlApplyStart = coopRuntime.indexOf('if (entry.kind === "CONTROL_COMMIT")');
  const controlApplyEnd = coopRuntime.indexOf(
    'if (entry.kind === "WAVE_ADVANCE" || entry.kind === "TERMINAL_COMMIT")',
    controlApplyStart,
  );
  assert.notEqual(controlApplyStart, -1, "runtime exposes the CONTROL_COMMIT material branch");
  assert.ok(controlApplyEnd > controlApplyStart, "CONTROL_COMMIT material branch has a bounded source block");
  const controlApply = coopRuntime.slice(controlApplyStart, controlApplyEnd);
  const applyState = controlApply.indexOf("applyCoopAuthoritativeBattleState(material.authoritativeState, true)");
  const adoptCursor = controlApply.indexOf('replacementCursorAction === "advance-one"');
  assert.ok(applyState >= 0 && adoptCursor > applyState, "complete DATA applies before its ordered cursor edge");
  assert.doesNotMatch(
    controlApply.slice(0, applyState),
    /deferred replacement-open[\s\S]*until battle/u,
    "same-wave DATA cannot wait for the turn that the same immutable entry authorizes",
  );

  const establishStart = coopRuntime.indexOf("export function establishCoopV2ReplacementControlBoundary(");
  const establishEnd = coopRuntime.indexOf("\n/**\n * Gate an early replica faint picker", establishStart);
  assert.notEqual(establishStart, -1, "runtime exposes the delayed replacement control boundary");
  assert.ok(establishEnd > establishStart, "the delayed replacement boundary has a bounded source block");
  const establish = coopRuntime.slice(establishStart, establishEnd);
  assert.match(establish, /const sameWaveSettlement =/u);
  assert.match(establish, /const preEncounter =/u);
  assert.match(establish, /exactReplacementPermit/u);
  assert.match(establish, /current\.allowedKinds\.includes\("CONTROL_COMMIT"\)/u);
  assert.match(establish, /preEncounter && state\.enemyParty\.length > 0/u);
  assert.match(establish, /pendingHostWaveTransitions\.get\(state\.wave\)/u);
  assert.match(establish, /commitHostReplacementOpen/u);
  assert.match(
    coopRuntime,
    /COOP_WINNING_TURN_REPLACEMENT_OCCURRENCE_BASE = 9_000[\s\S]*COOP_WINNING_TURN_REPLACEMENT_OCCURRENCE_SPAN = 1_000/u,
    "winning-turn V2 choices remain encodable by the bounded faint-switch carrier",
  );

  const replacementCommitStart = coopRuntime.indexOf("export function commitCoopV2ReplacementAuthority(");
  const replacementCommitEnd = coopRuntime.indexOf(
    "\nexport type CoopV2CommandBoundaryVerdict",
    replacementCommitStart,
  );
  assert.notEqual(replacementCommitStart, -1, "runtime exposes the authoritative replacement result commit");
  assert.ok(replacementCommitEnd > replacementCommitStart, "the replacement result commit has a bounded source block");
  const replacementCommit = coopRuntime.slice(replacementCommitStart, replacementCommitEnd);
  assert.match(replacementCommit, /activeReplacementOpen\.origin === "pre-encounter"/u);
  assert.match(replacementCommit, /activeReplacementOpen\.origin === "settled-wave"/u);
  assert.match(replacementCommit, /allowedKinds: \["INTERACTION_COMMIT", "CONTROL_COMMIT"\]/u);
  assert.match(replacementCommit, /operationKind: "ME_PRESENT"[\s\S]*turn: 0/u);
  assert.match(replacementCommit, /materialKind: "replacement-open"[\s\S]*materialKind: "command-open"/u);
  assert.match(
    replacementCommit,
    /settledWaveReplacement[\s\S]*allowedKinds: \["CONTROL_COMMIT", "WAVE_ADVANCE"\][\s\S]*materialKind: "replacement-open"/u,
  );

  const stagedWaitStart = battleStream.indexOf("export function deferredCoopV2WaveSuccessorWait(");
  const stagedWaitEnd = battleStream.indexOf("\n/**\n * Exact replacement successor", stagedWaitStart);
  assert.notEqual(stagedWaitStart, -1, "turn capture exposes the staged won-wave successor builder");
  assert.ok(stagedWaitEnd > stagedWaitStart, "the staged won-wave successor builder has a bounded source block");
  const stagedWait = battleStream.slice(stagedWaitStart, stagedWaitEnd);
  assert.match(stagedWait, /allowedKinds: \["CONTROL_COMMIT", "WAVE_ADVANCE"\]/u);
  assert.match(stagedWait, /materialKind: "replacement-open"[\s\S]*turn: turn \+ 1/u);
  assert.match(stagedWait, /allowNextWaveStart: false/u);

  const switchStart = switchPhase.indexOf("const controlBoundary = establishCoopV2ReplacementControlBoundary(");
  const switchFailure = switchPhase.indexOf('controlBoundary.kind === "failed"', switchStart);
  const switchDeferred = switchPhase.indexOf('controlBoundary.kind === "deferred"', switchFailure);
  const bindsCommittedId = switchPhase.indexOf(
    "this.coopV2ControlOperationId = controlBoundary.control.operationId",
    switchDeferred,
  );
  assert.ok(
    switchStart >= 0
      && switchFailure > switchStart
      && switchDeferred > switchFailure
      && bindsCommittedId > switchDeferred,
    "SwitchPhase fails closed or binds only the globally committed delayed replacement address",
  );
});

test("a cut-over turn cannot fall back to a raw legacy mechanical carrier", () => {
  assert.match(turnCutover, /export function suppressesLegacyTurnApplication[\s\S]*return mode === "v2"/u);
  assert.match(battleStream, /if \(!v2Committed\)[\s\S]*beginAuthorityTerminal[\s\S]*return false/u);
  assert.match(
    battleStream,
    /source === "transport"[\s\S]*suppressesLegacyTurnApplication\(activeCoopTurnAuthorityMode\(\)\)[\s\S]*IGNORE cosmetic turnResolution/u,
  );
});

test("replacement controls are proven by the real async PARTY surface and multi-faints advance one picker at a time", () => {
  const openParty = guestFaintSwitchPhase.indexOf("const openedParty = scene.ui.setMode(");
  const awaitParty = guestFaintSwitchPhase.indexOf("Promise.resolve(openedParty).then(", openParty);
  const notifyReady = guestFaintSwitchPhase.indexOf("notifyCoopV2InteractionSurfaceReady(runtime)", awaitParty);
  assert.notEqual(openParty, -1, "the replacement phase retains the real setMode completion");
  assert.ok(
    awaitParty > openParty && notifyReady > awaitParty,
    "control readiness is published only after PARTY's asynchronous public handler opens",
  );
  const ownerOpenParty = switchPhase.indexOf("const openedParty = scene.ui.setMode(");
  const ownerAwaitParty = switchPhase.indexOf("Promise.resolve(openedParty).then(", ownerOpenParty);
  const ownerNotifyReady = switchPhase.indexOf("notifyCoopV2InteractionSurfaceReady(ownerRuntime)", ownerAwaitParty);
  assert.notEqual(ownerOpenParty, -1, "the authority owner replacement retains the real setMode completion");
  assert.ok(
    ownerAwaitParty > ownerOpenParty && ownerNotifyReady > ownerAwaitParty,
    "the authority owner also proves control only after PARTY is public",
  );
  const versusBind = switchPhase.indexOf("this.coopV2ControlOperationId = replacementOperationId(", ownerNotifyReady);
  const versusOpenParty = switchPhase.indexOf("const openedVersusParty = globalScene.ui.setMode(", versusBind);
  const versusAwaitParty = switchPhase.indexOf("Promise.resolve(openedVersusParty).then(", versusOpenParty);
  const versusNotifyReady = switchPhase.indexOf("notifyCoopV2InteractionSurfaceReady(versusRuntime)", versusAwaitParty);
  assert.ok(
    versusBind > ownerNotifyReady && versusOpenParty > versusBind,
    "Showdown's vanilla picker is bound to the exact V2 replacement address before it opens",
  );
  assert.ok(
    versusAwaitParty > versusOpenParty && versusNotifyReady > versusAwaitParty,
    "Showdown proves its authority-local replacement only after the real PARTY handler opens",
  );

  const successorStart = replacementAdapter.indexOf('case "next-replacement":');
  const successorEnd = replacementAdapter.indexOf('\n    case "terminal":', successorStart);
  assert.notEqual(successorStart, -1, "the replacement adapter exposes its ordered-chain successor");
  assert.ok(successorEnd > successorStart, "the ordered-chain successor has a bounded source block");
  const successor = replacementAdapter.slice(successorStart, successorEnd);
  assert.match(successor, /return successor\.control/u);

  assert.match(
    pushReplacementCheckpointPhase,
    /Every completed summon is now its own immutable V2 transaction/u,
    "each picker result is captured before the next modal can act",
  );
  assert.match(
    pushReplacementCheckpointPhase,
    /if \(!isCoopV2ReplacementCutoverActive\(\)\)[\s\S]*partySlotStillFainted/u,
    "only rollback/legacy mode retains the old whole-batch capture guard",
  );
  assert.match(
    pushReplacementCheckpointPhase,
    /v2\?\.kind === "no-pending"[\s\S]*refusing an unlogged compatibility checkpoint/u,
    "a full-V2 replacement carrier without its exact staged result fails closed instead of reviving legacy authority",
  );
  assert.match(
    replayTurnPhase,
    /envelope\.authorityNextControl\?\.kind === "REPLACEMENT"[\s\S]*acknowledgeReplacement\(envelope, "continuationReady"\)/u,
    "an intermediate complete carrier advances to its stated picker without demanding a command",
  );
});

test("TURN_RESOLVE prompts form a closed command-to-turn Authority V2 path", () => {
  assert.match(nextControl, /const TURN_RESOLVE_PROMPT_SURFACES = \{/u);
  for (const [kind, surface] of [
    ["CATCH_FULL", "op:catchFull"],
    ["LEARN_MOVE", "op:learnMove"],
    ["LEARN_MOVE_BATCH", "op:learnMove"],
    ["REVIVAL", "op:revival"],
  ]) {
    assert.match(nextControl, new RegExp(`${kind}: "${surface}"`, "u"));
  }
  assert.match(nextControl, /envelope\?\.logicalPhase === "TURN_RESOLVE"/u);
  assert.match(nextControl, /operation\?\.id === next\.operationId/u);
  assert.match(nextControl, /operation\.status === "applied"/u);
  assert.match(nextControl, /payload\?\.type === "prompt"/u);

  const turnResolveCases = interactionCutover.slice(
    interactionCutover.indexOf('case "REVIVAL":'),
    interactionCutover.indexOf('case "ME_PRESENT":'),
  );
  assert.match(
    turnResolveCases,
    /\["TURN_COMMIT", "INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"\]/u,
  );
  assert.match(
    coopRuntime,
    /authorityControl\?\.kind === "SHARED_INTERACTION"[\s\S]*v2DeferredCommandStarts\.set\(key,[\s\S]*return "deferred"/u,
    "a transient authority CommandPhase parks instead of aborting while the exact mid-turn interaction owns control",
  );
  assert.match(
    coopRuntime,
    /entry\.nextControl\.kind === "AWAIT_SUCCESSOR"[\s\S]*allowedKinds\.includes\("CONTROL_COMMIT"\)[\s\S]*resumeOneCoopV2DeferredAuthorityCommandStart/u,
    "the installed interaction successor wait retries the parked authority CommandPhase",
  );
});

test("Crossroads result envelopes retain the exact V2 control turn instead of a legacy turn-zero sentinel", () => {
  assert.match(
    victoryPhase,
    /const postBattleSettlementTurn = this\.coopSourceTurn \?\? globalScene\.currentBattle\.turn \+ 1/u,
    "local Victory advances once while retained Victory preserves its immutable V2 settlement turn",
  );
  assert.match(
    replayPhases,
    /pushNew\("VictoryPhase", battlerArg, false, pending\.wave, pending\.settledTurn\)/u,
    "the retained WAVE_ADVANCE turn reaches the guest Victory capsule without ambient re-derivation",
  );
  assert.match(
    victoryPhase,
    /pushNew\("ErCrossroadsPhase", currentWaveIndex, postBattleSettlementTurn\)/u,
    "Victory freezes Crossroads at the settlement turn shared by the terminal reward",
  );
  assert.match(
    victoryPhase,
    /pushNew\("SelectBiomePhase", currentWaveIndex, postBattleSettlementTurn\)/u,
    "the natural World Map successor uses the same exact settlement coordinate",
  );
  const ownerStart = crossroadsPhase.indexOf("private coopOwnerCommit(");
  const ownerEnd = crossroadsPhase.indexOf("\n  /**", ownerStart);
  assert.notEqual(ownerStart, -1, "Crossroads exposes the owner result seam");
  assert.ok(ownerEnd > ownerStart, "Crossroads owner result seam has a bounded source block");
  const ownerCommit = crossroadsPhase.slice(ownerStart, ownerEnd);

  const watcherStart = crossroadsPhase.indexOf("private applyCrossroadsWatcherDecision(");
  const watcherEnd = crossroadsPhase.indexOf("\n  private ", watcherStart + 1);
  assert.notEqual(watcherStart, -1, "Crossroads exposes the watcher result seam");
  assert.ok(watcherEnd > watcherStart, "Crossroads watcher result seam has a bounded source block");
  const watcherApply = crossroadsPhase.slice(watcherStart, watcherEnd);

  assert.match(ownerCommit, /turn: this\.coopSourceTurn/u);
  assert.doesNotMatch(ownerCommit, /turn: 0/u);
  assert.match(watcherApply, /turn: this\.coopSourceTurn/u);
  assert.doesNotMatch(watcherApply, /turn: 0/u);
  assert.match(
    crossroadsPhase,
    /enterCoopV2CrossroadsControlBoundary\(\{[\s\S]*sourceWave: wave,[\s\S]*sourceTurn: this\.coopSourceTurn/u,
    "the control-open receives the same constructor-captured coordinate as the result",
  );
  // The exact-turn capture moved into the shared biome-family boundary helper when the natural
  // biome pick gained its own establisher; pin the invariant there AND pin both wrappers' exact
  // operation identities so neither surface can borrow the other's proof.
  const sharedBoundaryStart = coopRuntime.indexOf("function enterCoopV2BiomeInteractionControlBoundary(");
  const sharedBoundaryEnd = coopRuntime.indexOf(
    "export function enterCoopV2CrossroadsControlBoundary(",
    sharedBoundaryStart,
  );
  assert.notEqual(sharedBoundaryStart, -1, "runtime exposes the shared biome-family control boundary");
  assert.ok(sharedBoundaryEnd > sharedBoundaryStart, "shared control boundary has a bounded source block");
  const sharedBoundary = coopRuntime.slice(sharedBoundaryStart, sharedBoundaryEnd);
  assert.match(sharedBoundary, /captureCoopAuthoritativeBattleState\(input\.sourceTurn\)/u);
  assert.doesNotMatch(sharedBoundary, /captureCoopAuthoritativeBattleState\(battle\.turn\)/u);
  const crossroadsBoundaryStart = coopRuntime.indexOf("export function enterCoopV2CrossroadsControlBoundary(");
  const crossroadsBoundaryEnd = coopRuntime.indexOf("\nfunction commandStartKey(", crossroadsBoundaryStart);
  assert.notEqual(crossroadsBoundaryStart, -1, "runtime exposes the Crossroads control boundary");
  assert.ok(crossroadsBoundaryEnd > crossroadsBoundaryStart, "Crossroads control boundary has a bounded source block");
  const crossroadsBoundary = coopRuntime.slice(crossroadsBoundaryStart, crossroadsBoundaryEnd);
  assert.match(
    crossroadsBoundary,
    /enterCoopV2BiomeInteractionControlBoundary\(input, \{\s*operationKind: "CROSSROADS_PICK",\s*projectionKind: "crossroads",/u,
    "Crossroads delegates to the shared boundary with its exact operation identity",
  );
  assert.match(
    crossroadsBoundary,
    /enterCoopV2BiomeInteractionControlBoundary\(input, \{\s*operationKind: "BIOME_PICK",\s*projectionKind: "biome",/u,
    "the natural biome pick delegates to the shared boundary with its exact operation identity",
  );

  assert.match(
    coopRuntime,
    /create\("ErCrossroadsPhase", plan\.sourceWave, control\.turn\)[\s\S]*installCoopV2CrossroadsProjection\(plan\.operationId, plan\.sourceWave, control\.turn\)/u,
    "ordinary and recovery projection pass the authority-stated turn into Crossroads",
  );

  const ownerReadyStart = crossroadsPhase.indexOf("private publishCoopOwnerSurfaceWhenActionable(");
  const ownerReadyEnd = crossroadsPhase.indexOf("\n  /**", ownerReadyStart + 1);
  assert.notEqual(ownerReadyStart, -1, "Crossroads exposes a bounded owner actionability proof");
  assert.ok(ownerReadyEnd > ownerReadyStart, "Crossroads owner actionability proof has a bounded source block");
  const ownerReady = crossroadsPhase.slice(ownerReadyStart, ownerReadyEnd);
  const actionableCheck = ownerReady.indexOf("handler.isCoopV2InputActionable?.() === true");
  const controlProof = ownerReady.indexOf("notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime)");
  assert.ok(actionableCheck >= 0, "Crossroads checks the exact option handler's input-delay state");
  assert.ok(
    controlProof > actionableCheck,
    "Crossroads cannot publish controlInstalled before the handler is actionable",
  );
  assert.match(
    ownerReady,
    /runWhenCoopRuntimeActive\(this\.coopOwningRuntime, publish\)/u,
    "delayed Crossroads readiness re-enters the phase's own browser runtime",
  );
});

test("the learn-move soak proves the real guest UI-to-relay terminal before rebuilding combat", () => {
  const start = soakDriver.indexOf("const processLearnMoveWave = async");
  const end = soakDriver.indexOf(
    "\n  // ---------------------------------------------------------------------------",
    start + 1,
  );
  assert.notEqual(start, -1, "the representative soak exposes its learn-move wave");
  assert.ok(end > start, "the learn-move wave has a bounded source block");
  const learnMove = soakDriver.slice(start, end);
  const schedulesDestinations = learnMove.indexOf("setDestinationContextDelivery?.(destinationScheduled)");
  const createsHostPhase = learnMove.indexOf('phaseManager.create("LearnMoveBatchPhase"');
  const installsHostPhase = learnMove.indexOf("phaseManager.overridePhase(hostLearnPhase)");
  const startsHostPhase = learnMove.indexOf("hostLearnPhase.start()");
  const provesPhase = learnMove.indexOf('guestLearnPhase?.phaseName !== "CoopReplayLearnMoveBatchPhase"');
  const startsProvenPhase = learnMove.indexOf("guestLearnPhase.start()");
  const provesMode = learnMove.indexOf(
    'awaitClientUiMode(rig.guestCtx, UiMode.LEARN_MOVE_BATCH, "guest-owned learn-move batch")',
  );
  const firstInput = learnMove.indexOf('"learn-move select offered move"');
  const secondInput = learnMove.indexOf('"learn-move overwrite slot zero"');
  const provesTerminal = learnMove.indexOf("isCoopLearnMoveForwardInFlightEmpty()");
  assert.ok(schedulesDestinations >= 0, "transport callbacks are pinned to their destination browser");
  assert.ok(
    createsHostPhase >= 0 && installsHostPhase > createsHostPhase && startsHostPhase > installsHostPhase,
    "the host control proof belongs to the exact current LearnMoveBatchPhase, never a detached UI producer",
  );
  assert.ok(
    provesPhase > schedulesDestinations && startsProvenPhase > provesPhase && provesMode > startsProvenPhase,
    "the interceptor starts only the exact queue-owned replay phase before proving its public handler",
  );
  assert.ok(
    firstInput > provesMode && secondInput > firstInput,
    "both human button presses traverse the public input layer in order",
  );
  assert.ok(
    provesTerminal > secondInput,
    "the driver waits for the UI-to-relay-to-authority terminal instead of trusting shared fixture objects",
  );
});

test("a host-owned learn-move prompt has one exact pre-picker presentation lease", () => {
  assert.match(
    nextControl,
    /export function sharedInteractionAllowsLocalPresentationInput\([\s\S]*control\.ownerSeatId !== proof\.localSeatId[\s\S]*control\.operationId !== proof\.operationId[\s\S]*control\.surfaceClass === "op:learnMove"[\s\S]*control\.operationKind === "LEARN_MOVE"[\s\S]*proof\.phaseName === "LearnMovePhase"/u,
    "the pure control model admits only the addressed owner and closed LearnMove operation/phase pair",
  );
  const gateStart = coopRuntime.indexOf("export function isCoopV2InteractionHumanInputFrozen(");
  const gateEnd = coopRuntime.indexOf("\n/**", gateStart + 1);
  assert.notEqual(gateStart, -1, "the production physical-input gate exists");
  assert.ok(gateEnd > gateStart, "the production physical-input gate has a bounded source block");
  const inputGate = coopRuntime.slice(gateStart, gateEnd);
  assert.match(inputGate, /if \(pending\.kind === "SHARED_INTERACTION"\)/u);
  assert.match(inputGate, /ledger\.isMaterialApplied\(pending\)/u);
  assert.match(inputGate, /sharedInteractionAllowsLocalPresentationInput\(pending,/u);
  assert.match(inputGate, /localSeatId: runtime\.controller\.localSeatId/u);
  assert.match(inputGate, /coopV2ControlOperationId/u);
  assert.match(inputGate, /messageHandlerActionable,/u);
  assert.doesNotMatch(
    inputGate.slice(
      inputGate.indexOf('if (pending.kind === "SHARED_INTERACTION")'),
      inputGate.indexOf('if (pending.kind === "AWAIT_SUCCESSOR")'),
    ),
    /activeControl/u,
    "the pre-picker bridge cannot require a control that is installable only after the prompt is dismissed",
  );
});

test("an ME battle handoff leases its whole exact-address action-only pre-command prefix", () => {
  const start = nextControl.indexOf("export function successorWaitAllowsLocalPresentationInput(");
  const end = nextControl.indexOf("\ninterface MechanicalAddress", start);
  assert.notEqual(start, -1, "the ordered-wait presentation lease exists");
  assert.ok(end > start, "the ordered-wait presentation lease has a bounded source block");
  const lease = nextControl.slice(start, end);
  assert.match(
    lease,
    /const exactBattleCommandTarget =[\s\S]*target\.materialKind === "command-open"[\s\S]*target\.wave === proof\.wave[\s\S]*target\.turn === proof\.turn[\s\S]*target\.operationId == null/u,
    "the lease is pinned to the terminal's exact command-open address",
  );
  assert.match(
    lease,
    /if \(exactBattleCommandTarget === true\) \{\s*return wait\.allowedKinds\.includes\("CONTROL_COMMIT"\);\s*\}/u,
    "every ACTION-only presentation prefix at that exact address can drain before CONTROL_COMMIT",
  );
  assert.doesNotMatch(
    lease,
    /proof\.phaseName === "MysteryEncounterBattlePhase"/u,
    "the lease cannot strand entry abilities by recognizing only the first intro phase",
  );
});

test("a turn wait leases only its exact BattleEnd message on the path to an allowed wave successor", () => {
  const start = nextControl.indexOf("export function successorWaitAllowsLocalPresentationInput(");
  const end = nextControl.indexOf("\ninterface MechanicalAddress", start);
  assert.notEqual(start, -1, "the ordered-wait presentation lease exists");
  assert.ok(end > start, "the ordered-wait presentation lease has a bounded source block");
  const lease = nextControl.slice(start, end);
  assert.match(
    lease,
    /wait\.allowedKinds\.includes\("WAVE_ADVANCE"\)[\s\S]*proof\.wave === wait\.wave[\s\S]*proof\.turn === wait\.turn \+ 1[\s\S]*proof\.phaseName === "MessagePhase"/u,
    "the settlement lease is pinned to the exact next-turn action-only MessagePhase and an explicit wave edge",
  );
});

test("pre-battle Mystery engine narration cannot depend on the selector phase still being current", () => {
  const helperStart = coopRuntime.indexOf("export function coopHostEngineDialogueMessageAdvanceAllowed(");
  const helperEnd = coopRuntime.indexOf("\n/** Retry the exact retained interaction claim", helperStart);
  assert.notEqual(helperStart, -1, "the authoritative host narration lease exists");
  assert.ok(helperEnd > helperStart, "the host narration lease has a bounded source block");
  const helper = coopRuntime.slice(helperStart, helperEnd);
  assert.match(helper, /ctx\.localRole === "host"/u, "only the sole authoritative engine receives the lease");
  assert.doesNotMatch(
    helper,
    /ctx\.meInteractiveSurfaceActive/u,
    "an ordinary MessagePhase remains part of the live Mystery narration after its selector phase ends",
  );
  assert.match(
    coopRuntime,
    /coopHostStreamMeMessage\(text: string, actionablePrompt = false\)[\s\S]*coopMeNarrationOperationId\([\s\S]*captureCoopMeCommittedTerminalCursor\(pinned\)[\s\S]*&& !terminalCommitted[\s\S]*requiresAck[\s\S]*battleStream\.sendMeMessage/u,
    "the host publishes a deterministic prompt identity before exposing a guest-owned narration lease",
  );
  assert.match(
    coopUi,
    /if \(hostEngineDialogueAdvance && coopHostMeNarrationAwaitingGuestAck\(\)\) \{[\s\S]*return false;[\s\S]*if \(meInteractiveSurfaceActive\)/u,
    "the exact guest narration lease blocks host input even after the selector becomes an ordinary MessagePhase",
  );
  assert.match(
    coopRuntime,
    /validateCoopMeNarrationObservation[\s\S]*pending\.operationId !== observation\.operationId[\s\S]*isCoopMeNarrationOperationId/u,
    "the authority accepts only the exact live narration identity",
  );
  assert.match(
    coopRuntime,
    /function isCoopGuestMeNarrationAddressLive[\s\S]*isCoopMeNarrationOperationId[\s\S]*function hasCoopGuestMeNarrationInputLease[\s\S]*guestPending[\s\S]*phaseName !== "CoopReplayMePhase"[\s\S]*isCoopV2InteractionHumanInputFrozen[\s\S]*hasCoopGuestMeNarrationInputLease\(runtime\)/u,
    "the guest's exact rendered narration lease must cross the global V2 physical-input freeze",
  );
  assert.match(
    coopRuntime,
    /COOP_ME_NARRATION_ADVANCE_CEILING_MS[\s\S]*isMessageMode: globalScene\.ui\?\.getMode\(\) === UiMode\.MESSAGE[\s\S]*hostAdvanceTimer = setTimeout[\s\S]*advanceCoopHostMeNarrationFromGuest/u,
    "an early acknowledgement retries until the real host Message handler is actionable and then advances it",
  );
  assert.match(
    coopRuntime,
    /interface CoopMeNarrationLease[\s\S]*readonly text: string[\s\S]*resendTimer:[\s\S]*scheduleCoopHostMeNarrationRedelivery[\s\S]*battleStream\.sendMeMessage/u,
    "the authority retains and redelivers an unacknowledged narration lease across a dark transport window",
  );
  assert.match(
    coopRuntime,
    /interface CoopGuestMeNarrationLease[\s\S]*acknowledgedChoice:[\s\S]*retryTimer:[\s\S]*scheduleCoopGuestMeNarrationAckRetry[\s\S]*sendV2MeNarrationObservation/u,
    "the replica retains and retries its exact dismissal until a successor or stale address retires it",
  );
  const guestAckStart = coopRuntime.indexOf("export function coopGuestAcknowledgeMeNarration(");
  const guestAckEnd = coopRuntime.indexOf("\ninterface CoopMeNarrationObservation", guestAckStart);
  assert.ok(guestAckStart >= 0 && guestAckEnd > guestAckStart, "the guest acknowledgement block is bounded");
  assert.doesNotMatch(
    coopRuntime.slice(guestAckStart, guestAckEnd),
    /guestPending = null/u,
    "enqueueing one acknowledgement is not delivery proof and cannot discard the retry lease",
  );
  assert.match(
    replayMePhase,
    /clearCoopGuestMeNarrationLease[\s\S]*this\.offMeMessage = \(\) => \{[\s\S]*clearCoopGuestMeNarrationLease\(this\.boundRuntime\)/u,
    "every replay teardown retires its retained acknowledgement timer through the narration unsubscribe",
  );
  assert.match(
    coopRuntime,
    /if \(receive !== "executed" && receive !== "duplicate"\) \{[\s\S]*return false;[\s\S]*clearCoopGuestMeNarrationLease\(runtime\);[\s\S]*settleCoopV2InteractionOperation\(op\.id, runtime\)/u,
    "the exact ordered Mystery terminal retires an old guest narration ACK even while its primary pin survives",
  );
  assert.match(battleStream, /meMessageHandler:[\s\S]*=> boolean/u, "the replay handler reports exact acceptance");
  const narrationDeliveryStart = battleStream.indexOf("private deliverMeMessage(");
  const narrationDeliveryEnd = battleStream.indexOf("\n  /**", narrationDeliveryStart + 1);
  assert.ok(narrationDeliveryStart >= 0 && narrationDeliveryEnd > narrationDeliveryStart);
  const narrationDelivery = battleStream.slice(narrationDeliveryStart, narrationDeliveryEnd);
  const acceptedHandler = narrationDelivery.indexOf("accepted = this.meMessageHandler(message)");
  const retainedMessage = narrationDelivery.indexOf("this.pendingMeMessages.push(message)", acceptedHandler);
  const seenMessage = narrationDelivery.indexOf("this.seenMeMessageOperationIds.add(message.operationId)");
  assert.ok(
    acceptedHandler >= 0 && retainedMessage > acceptedHandler && seenMessage > retainedMessage,
    "a narration is deduplicated only after the exact replay boundary accepts it, so an early delivery remains replayable",
  );
  assert.match(
    coopUi,
    /result && modeBefore === UiMode\.MESSAGE && coopGuestAcknowledgeMeNarration\(button\)/u,
    "only a real handler-consumed guest press emits the presentation acknowledgement",
  );
  assert.doesNotMatch(
    coopDurability,
    /COOP_COSMETIC_TYPES[\s\S]*"meMessage"/u,
    "an actionable narration lease is reliable rather than a fault-sheddable cosmetic cue",
  );
  assert.match(
    replayMePhase,
    /catch \(error\)[\s\S]*message\.requiresAck[\s\S]*failCoopSharedSession\(`Mystery narration/u,
    "an actionable prompt that cannot render fails closed instead of leaving the host invisibly fenced",
  );
});

test("a host-owned V2 learn-move prompt retains the guest at the same wave until its exact result", () => {
  assert.match(
    learnMovePhase,
    /monOwner === "host"[\s\S]*movesetFull[\s\S]*isCoopLearnMoveAuthorityV2Active\(this\.coopOperationBinding\)[\s\S]*markCoopLearnMoveForwardInFlight\(this\.partyMemberIndex\)[\s\S]*this\.coopAwaitingHostOwnedPresentation = true[\s\S]*return;/u,
    "the guest must claim and retain its real LearnMovePhase instead of entering NextEncounter early",
  );
  assert.match(
    learnMovePhase,
    /coopWatchHostOwnedV2Decision[\s\S]*awaitInteractionChoice\(seq, COOP_LEARN_MOVE_FWD_WAIT_MS, COOP_LEARN_MOVE_CHOICE_KINDS\)[\s\S]*settleCoopV2InteractionOperation\(expectedOperationId, this\.coopOwningRuntime\)[\s\S]*tryRemovePhase\("SelectModifierPhase"\)[\s\S]*this\.end\(\)/u,
    "only the exact immutable decision may release the retained phase and reward continuation",
  );
  assert.match(
    coopRuntime,
    /hasPhaseOfType\("LearnMovePhase", phase => \{[\s\S]*stageCoopV2HostOwnedLearnMovePresentation\([\s\S]*learnMoveForwardInFlight\.add\(partySlot\)[\s\S]*return;/u,
    "a prompt-first delivery must bind the already-queued reward continuation instead of spawning a duplicate replay",
  );
  assert.match(
    learnMovePhase,
    /stageCoopV2HostOwnedLearnMovePresentation[\s\S]*this\.coopV2ControlOperationId = operationId;[\s\S]*this\.coopAwaitingHostOwnedPresentation = true;[\s\S]*const presentationWasStaged = this\.coopV2ControlOperationId != null;[\s\S]*coopWatchHostOwnedV2Decision\(move, pokemon\)/u,
    "the queued phase must retain the exact operation address and start the watcher from that address",
  );
});

test("the duo Mystery split cannot inject a choice before public V2 input is actionable", () => {
  const helperStart = duoHarness.indexOf("export function relayGuestMeOptionIndexOnly(");
  const helperEnd = duoHarness.indexOf("\n/**", helperStart + 1);
  assert.notEqual(helperStart, -1, "the duo harness exposes its context-safe Mystery proposal split");
  assert.ok(helperEnd > helperStart, "the Mystery proposal split has a bounded source block");
  const helper = duoHarness.slice(helperStart, helperEnd);
  const handlerActionable = helper.indexOf("handler.isCoopV2InputActionable?.() !== true");
  const v2InputGate = helper.indexOf("isCoopV2InteractionHumanInputFrozen()");
  const ownerCommit = helper.indexOf("commitMeOwnerIntent({");
  const relayDispatch = helper.indexOf("resend();", ownerCommit);
  assert.ok(handlerActionable >= 0, "the split observes the same actionable Mystery handler as a human");
  assert.ok(
    v2InputGate > handlerActionable,
    "the split crosses the production Authority V2 physical-input gate only after actionability",
  );
  assert.ok(
    ownerCommit > v2InputGate && relayDispatch > ownerCommit,
    "no owner intent or relay packet may precede the installed public control proof",
  );
  assert.match(
    helper,
    /relay\.sendInteractionChoice\(seam\.seq, "me", index, \[step\], undefined, operationId \?\? undefined\)/u,
    "the shared-process split must carry the same exact immutable proposal identity as the browser handler",
  );
  assert.match(
    helper,
    /resend: isCoopMeOperationJournalActive\(\) \? resend : undefined/u,
    "proposal retries must preserve that exact immutable identity",
  );

  const mysteryDriveStart = soakDriver.indexOf("hitMode(UiMode.MYSTERY_ENCOUNTER);");
  const mysteryDriveEnd = soakDriver.indexOf(
    "\n  // ---------------------------------------------------------------------------",
    mysteryDriveStart + 1,
  );
  assert.notEqual(mysteryDriveStart, -1, "the representative soak exposes its Mystery drive");
  assert.ok(mysteryDriveEnd > mysteryDriveStart, "the representative Mystery drive has a bounded source block");
  const mysteryDrive = soakDriver.slice(mysteryDriveStart, mysteryDriveEnd);
  assert.equal(
    [...mysteryDrive.matchAll(/relayGuestMeOptionIndexOnly\(/gu)].length,
    3,
    "every shared-process guest-owned Mystery path is inventoried",
  );
  assert.equal(
    [...mysteryDrive.matchAll(/awaitClientActionableUiMode\([\s\S]*?UiMode\.MYSTERY_ENCOUNTER/gu)].length,
    4,
    "both owners' battle-handoff and flat/nested paths await the real input boundary before direct helpers",
  );
  assert.equal(
    [...mysteryDrive.matchAll(/assertClientV2HumanInputLease\(rig\.hostCtx,/gu)].length,
    2,
    "both host-owned paths cross the production physical-input projector before their legacy engine helper",
  );

  const hostMysteryStart = mysteryEncounterPhases.indexOf("export class MysteryEncounterPhase extends Phase");
  const hostMysteryEnd = mysteryEncounterPhases.indexOf(
    "\nexport class MysteryEncounterOptionSelectedPhase",
    hostMysteryStart + 1,
  );
  assert.notEqual(hostMysteryStart, -1, "production exposes the authoritative host Mystery selector");
  assert.ok(hostMysteryEnd > hostMysteryStart, "the host Mystery selector has a bounded source block");
  const hostMystery = mysteryEncounterPhases.slice(hostMysteryStart, hostMysteryEnd);
  const addressField = hostMystery.indexOf("public coopV2ControlOperationId: string | null = null;");
  const presentationCommit = hostMystery.indexOf("const operationId = commitMeOwnerIntent({");
  const addressBind = hostMystery.indexOf("this.coopV2ControlOperationId = operationId;");
  const presentationGuard = hostMystery.indexOf("if (!this.coopHostStreamPresentation())");
  const selectorOpen = hostMystery.indexOf("setModeBoundedWhen(UiMode.MYSTERY_ENCOUNTER");
  assert.ok(addressField >= 0, "the live host phase carries its immutable ME_PRESENT address");
  assert.ok(
    presentationCommit > addressField && addressBind > presentationCommit,
    "the host binds the exact operation returned by the committed presentation",
  );
  assert.ok(
    presentationGuard > addressField && selectorOpen > presentationGuard,
    "runtime execution completes the presentation commit/bind guard before exposing the delayed selector",
  );
});

test("guest-owned Mystery control is installed only by an exact authority proposal wait", () => {
  assert.match(
    mysteryEncounterPhases,
    /awaitInteractionChoice\([\s\S]*?COOP_ME_PICK_CHOICE_KINDS,[\s\S]*?authorityControlOperationId \?\? undefined/u,
    "the authority arms the host wait at the exact phase-owned ME_PRESENT address",
  );
  assert.match(
    interactionRelay,
    /projectV2AuthorityProposalWait\(authorityWait\)/u,
    "the relay refuses to park an addressed V2 waiter unless the global ledger installs it",
  );
  assert.match(
    coopRuntime,
    /function projectCoopV2AuthorityProposalWait\([\s\S]*?projectAuthorityProposalWait\(/u,
    "the runtime derives and installs the proposal ingress through the one global control ledger",
  );
  assert.match(
    controlLedger,
    /kind: "authority-proposal-wait"/u,
    "a remote proposal wait is distinct from executable owner UI and cosmetic watcher UI",
  );
  assert.match(
    interactionRelay,
    /res == null && authorityWait != null[\s\S]*?revokeV2AuthorityProposalWait\(authorityWait\)/u,
    "timeout, cancellation, and supersession retire the exact waiter generation",
  );
});

test("every relay-driven remote interaction derives one exact authority proposal ingress", () => {
  const specStart = coopRuntime.indexOf("function coopV2AuthorityProposalWaitSpec(");
  const specEnd = coopRuntime.indexOf("\nfunction sameOrderedStrings", specStart);
  assert.notEqual(specStart, -1, "runtime exposes one closed proposal-ingress derivation");
  assert.ok(specEnd > specStart, "the proposal-ingress derivation has a bounded source block");
  const spec = coopRuntime.slice(specStart, specEnd);
  for (const planKind of [
    "ability",
    "bargain",
    "biome",
    "crossroads",
    "catch-full",
    "colosseum",
    "learn-move",
    "learn-move-batch",
    "mystery",
    "revival",
    "reward",
    "market",
    "stormglass",
  ]) {
    assert.match(spec, new RegExp(`case "${planKind}"`, "u"), `${planKind} has an exact remote proposal wait spec`);
  }
  assert.match(
    interactionRelay,
    /resolveV2AuthorityProposalControlId\(\{[\s\S]*?relaySequence: seq,[\s\S]*?acceptedKinds:[\s\S]*?expectedRewardSurface/u,
    "the relay derives the active control centrally from every real wait rather than optional phase wiring",
  );
  assert.match(
    coopRuntime,
    /resolveV2AuthorityProposalControlId: wait =>[\s\S]*?resolveCoopV2AuthorityProposalControlId\(runtime, wait\)/u,
    "the production relay is wired to the runtime's immutable projection capsule",
  );
  assert.match(
    interactionRelay,
    /if \(proposalWaitRequired && resolvedAuthorityControlOperationId === undefined\)[\s\S]*?return Promise\.resolve\(null\)/u,
    "a remote-owned V2 surface fails closed when its exact proposal address cannot be derived",
  );
  assert.match(
    controlLedger,
    /sameRewardSurface\(installed\.expectedRewardSurface, observation\.expectedRewardSurface\)/u,
    "nested Mystery reward waits cannot attest the wrong surface at a reused sequence",
  );
  assert.match(
    interactionRelay,
    /awaitInteractionOutcomeProposal\([\s\S]*?resolveV2AuthorityProposalControlId\([\s\S]*?projectV2AuthorityProposalWait\(authorityWait\)/u,
    "complete Bargain outcomes use the same address-exact control proof as small choice proposals",
  );
  assert.match(
    interactionRelay,
    /sendInteractionOutcomeProposal\([\s\S]*?cosmeticOperationId: proposalOperationId/u,
    "the non-authority Bargain result carries a stable non-mechanical proposal identity",
  );

  const closeStart = theBargainPhase.indexOf("  private closeCoopBargainOwnerTerminal(): void {");
  const closeEnd = theBargainPhase.indexOf("\n  /** Co-op WATCHER", closeStart);
  assert.ok(closeStart >= 0 && closeEnd > closeStart, "Bargain exposes its bounded owner-terminal close");
  const close = theBargainPhase.slice(closeStart, closeEnd);
  const park = close.indexOf("const parkForAuthority");
  const localEnd = close.indexOf("super.end()");
  const publish = close.indexOf("this.flushCoopBargainTerminal()");
  assert.ok(park >= 0 && localEnd > park && publish > localEnd, "Bargain decides its V2 park before publishing");
  assert.match(
    close.slice(park, publish),
    /if \(!parkForAuthority\) \{\s*super\.end\(\);\s*\}/u,
    "a guest owner cannot advance its ambient phase queue at proposal-send time",
  );

  const resultWaitStart = theBargainPhase.indexOf("  private coopAwaitAuthoritativeBargainResult(");
  const resultWaitEnd = theBargainPhase.indexOf("\n  /** Close locally only", resultWaitStart);
  assert.ok(resultWaitStart >= 0 && resultWaitEnd > resultWaitStart, "Bargain exposes its exact result wait");
  const resultWait = theBargainPhase.slice(resultWaitStart, resultWaitEnd);
  const consumeAddress = resultWait.indexOf("consumeCommittedInteractionOutcomeOperationId");
  const authorityEnd = resultWait.indexOf("super.end()");
  assert.ok(
    consumeAddress >= 0 && authorityEnd > consumeAddress,
    "the parked phase ends only after the exact committed result address is observed",
  );
});

test("every retained V2 interaction proposal is identity-idempotent before any later waiter", () => {
  assert.match(
    proposalAdmission,
    /return existing === proposal\.fingerprint \? "duplicate" : "conflict"/u,
    "one proposal ID has one immutable fingerprint for the whole epoch",
  );
  assert.match(
    proposalAdmission,
    /capacity-exhausted[\s\S]*Eviction would make a sufficiently late retry executable again/u,
    "the admission ledger fails closed instead of evicting exactly-once history",
  );
  assert.match(
    interactionRelay,
    /cosmeticOperationId: proposalOperationId/u,
    "the frozen interaction carrier transports the retained proposal's stable operation ID",
  );
  assert.match(
    interactionRelay,
    /v2GuestProposal[\s\S]*!isValidOperationId\(proposalOperationId\)[\s\S]*onV2AuthorityProposalViolation\(reason\)/u,
    "a new guest-owned interaction surface cannot silently send an unidentified V2 proposal",
  );
  assert.match(
    interactionRelay,
    /requiresV2GuestProposalIdentity\(msg\.kind\)[\s\S]*!isValidOperationId\(msg\.cosmeticOperationId\)[\s\S]*onV2AuthorityProposalViolation\(reason\)/u,
    "the authority rejects a forged unidentified proposal before FIFO admission",
  );
  assert.match(
    interactionRelay,
    /interactionAuthorityV2 && kind === "meBtn"[\s\S]*suppressed retired raw Mystery button[\s\S]*return;/u,
    "a V2 sender must not emit the obsolete Mystery button carrier",
  );
  assert.match(
    interactionRelay,
    /this\.isInteractionAuthorityV2\(\) && msg\.kind === "meBtn"[\s\S]*validateV2MeNarrationObservation\(observation\)[\s\S]*onV2MeNarrationObservation\(observation\)[\s\S]*dropped retired\/stale Mystery button[\s\S]*return;/u,
    "only an exact narration observation may cross the retired Mystery-button boundary",
  );
  assert.match(
    interactionRelay,
    /sendV2MeNarrationObservation\([\s\S]*kind: "meBtn"[\s\S]*data: \[step\][\s\S]*cosmeticOperationId: operationId/u,
    "the guest acknowledgement carries its immutable prompt identity and ordinal",
  );
  assert.match(
    interactionRelay,
    /if \(admission === "duplicate"\)[\s\S]*return;/u,
    "same-ID retries are dropped before the per-sequence FIFO can feed a later action",
  );
  assert.match(
    interactionRelay,
    /if \(admission !== "admitted"\)[\s\S]*onV2AuthorityProposalViolation\(reason\)/u,
    "same-ID conflicting material terminates instead of being reinterpreted",
  );
  assert.match(
    rewardOperation,
    /isCoopV2InteractionCutoverActive\(binding\?\.durability\)[\s\S]*params\.action\.operationId !== opId[\s\S]*proposal-operation-id-mismatch/u,
    "the authority accepts only the exact operation ID derived for its current shop ordinal",
  );
  assert.match(
    selectModifierPhase,
    /sendInteractionChoice\([\s\S]*this\.coopRewardSurface,[\s\S]*prepared\?\.operationId/u,
    "reward, reroll, lock, transfer, and check proposals carry the ID retained by the owner",
  );
  assert.match(
    biomeShopPhase,
    /retainCoopV2InteractionProposal\([\s\S]*operationId: preparedOperationId[\s\S]*resend/u,
    "non-terminal market purchases use the same durable identity lease",
  );
  assert.match(
    biomeOperation,
    /v2InteractionActive\(binding\) && params\.res\.operationId !== opId[\s\S]*proposal-operation-id-mismatch/u,
    "biome and crossroads choices must match the exact deterministic authority address",
  );
  assert.match(
    meOperation,
    /params\.operationId !== expectedOperationId[\s\S]*return \{ kind: "failed" \}/u,
    "Mystery option and sub-option retries cannot be reinterpreted under a later ordinal",
  );
});

test("a synchronous retained redelivery cannot re-enter the same replica material application", () => {
  assert.match(
    shadow,
    /if \(this\.replicaEntriesInFlight\.has\(entry\.revision\)\)[\s\S]*?return false;[\s\S]*?this\.replicaEntriesInFlight\.add\(entry\.revision\)/u,
    "the replica rejects re-entrant same-revision delivery before admission or materialization",
  );
  assert.match(
    shadow,
    /try \{[\s\S]*?this\.applyReplicaEntryOnce\(entry\)[\s\S]*?finally \{[\s\S]*?this\.replicaEntriesInFlight\.delete\(entry\.revision\)/u,
    "the in-flight guard is released on every success, deferral, rejection, and throw path",
  );
});

test("Mystery dialogue and quiz verdicts retain the same address-exact human-input lease", () => {
  const mysteryProofStart = operationSurfaceRegistry.indexOf("  ME_PRESENT: {");
  const mysteryProofEnd = operationSurfaceRegistry.indexOf("\n  ME_SUB:", mysteryProofStart);
  assert.notEqual(mysteryProofStart, -1, "the V2 registry declares the Mystery presentation proof");
  assert.ok(mysteryProofEnd > mysteryProofStart, "the Mystery presentation proof has a bounded source block");
  const mysteryProof = operationSurfaceRegistry.slice(mysteryProofStart, mysteryProofEnd);
  assert.match(mysteryProof, /UiMode\.MYSTERY_ENCOUNTER/u);
  assert.match(
    mysteryProof,
    /UiMode\.MESSAGE/u,
    "selected-option dialogue remains actionable under the live ME_PRESENT address",
  );
  assert.match(mysteryProof, /"MysteryEncounterPhase"/u);
  assert.match(
    mysteryEncounterPhases,
    /continueEncounter\(\)[\s\S]*setMode\(UiMode\.MESSAGE\)\.then\(showNextDialogue\)/u,
  );

  const quizProofStart = operationSurfaceRegistry.indexOf("  QUIZ_ANSWER: {");
  const quizProofEnd = operationSurfaceRegistry.indexOf("\n  REVIVAL:", quizProofStart);
  assert.notEqual(quizProofStart, -1, "the V2 registry declares the quiz-answer proof");
  assert.ok(quizProofEnd > quizProofStart, "the quiz-answer proof has a bounded source block");
  const quizProof = operationSurfaceRegistry.slice(quizProofStart, quizProofEnd);
  assert.match(quizProof, /UiMode\.ER_QUIZ/u);
  assert.match(quizProof, /UiMode\.MESSAGE/u, "the answer verdict retains the live QUIZ_ANSWER address");
  assert.match(quizProof, /"ErQuizPhase"/u);
  assert.match(
    erQuizPhase,
    /onAnswer\(choice: number\)[\s\S]*setModeBoundedWhen\(UiMode\.MESSAGE[\s\S]*showText\([\s\S]*afterVerdict/u,
    "the production quiz crosses MESSAGE before the next ordered question",
  );

  assert.match(
    controlLedger,
    /installed\.observation\.phaseToken === observation\.phaseToken[\s\S]*claim\.installed =/u,
    "handler rebinding remains limited to the exact same phase generation",
  );
  assert.match(
    controlLedger,
    /installed\.phaseToken === observation\.phaseToken[\s\S]*installed\.handlerToken === observation\.handlerToken/u,
    "physical input still requires the exact newly installed handler token",
  );
});

test("the host-faint soak observes the actionable successor without consuming it", () => {
  assert.match(
    hostFaintSoak,
    /phaseInterceptor\.to\("CommandPhase", false\)/u,
    "the focused replacement proof stops at CommandPhase instead of running past the boundary under test",
  );
});

test("a retained V2 replacement is consumed before the next replica command can fence the queue", () => {
  const guestTurnStart = turnInitPhase.indexOf("private startAuthoritativeGuestInputTurn(): boolean");
  const guestTurnEnd = turnInitPhase.indexOf("\n  start()", guestTurnStart);
  assert.notEqual(guestTurnStart, -1, "TurnInit exposes the authoritative replica branch");
  assert.ok(guestTurnEnd > guestTurnStart, "the authoritative replica branch has a bounded source block");
  const guestTurn = turnInitPhase.slice(guestTurnStart, guestTurnEnd);
  const pendingProbe = guestTurn.indexOf("this.pendingAuthoritativeReplacementTurn()");
  const replacementReplay = guestTurn.indexOf('"CoopReplayTurnPhase"');
  const ordinaryCommand = guestTurn.indexOf('"CommandPhase"');
  assert.ok(pendingProbe >= 0, "the replica probes the exact retained replacement before queuing input");
  assert.ok(
    replacementReplay > pendingProbe && ordinaryCommand > replacementReplay,
    "replacement replay is structurally queued before the ordinary command path",
  );

  const probeStart = turnInitPhase.indexOf("private pendingAuthoritativeReplacementTurn(): number | null");
  const probeEnd = turnInitPhase.indexOf("\n  /**", probeStart + 1);
  assert.notEqual(probeStart, -1, "TurnInit exposes the retained replacement probe");
  assert.ok(probeEnd > probeStart, "the retained replacement probe has a bounded source block");
  const probe = turnInitPhase.slice(probeStart, probeEnd);
  assert.match(probe, /isCoopV2ReplacementCutoverActive\(\)/u);
  assert.match(probe, /pending\.epoch !== controller\.sessionEpoch/u);
  assert.match(probe, /pending\.wave !== currentWave/u);
  assert.match(probe, /pending\.turn !== currentTurn && pending\.turn !== currentTurn \+ 1/u);

  const replacementCommandStart = replayTurnPhase.indexOf("const waveWon =");
  const replacementCommandEnd = replayTurnPhase.indexOf("if (!hasLocalCommandSlot)", replacementCommandStart);
  assert.ok(
    replacementCommandStart >= 0 && replacementCommandEnd > replacementCommandStart,
    "the replacement-to-command boundary is bounded",
  );
  const replacementCommand = replayTurnPhase.slice(replacementCommandStart, replacementCommandEnd);
  assert.doesNotMatch(
    replacementCommand,
    /turnCommands\[ownSlot\] == null/u,
    "a local command cache cannot veto the committed COMMAND_FRONTIER",
  );
  assert.match(
    replacementCommand,
    /turnCommands\[ownSlot\] = null;[\s\S]*?ownMon\.resetTurnData\(\);[\s\S]*?unshiftNew\("CommandPhase", ownSlot\)/u,
    "the addressed replacement actor's stale input ephemera is cleared before its exact public command opens",
  );
  assert.match(
    replacementCommand,
    /const commandTurn = globalScene\.currentBattle\.turn;[\s\S]*?registerReplacementContinuation\(envelope, \{[\s\S]*?turn: commandTurn,[\s\S]*?unshiftNew\([\s\S]*?"CoopReplayTurnPhase",[\s\S]*?commandTurn,/u,
    "an N+1 replacement replays the authoritative command turn instead of reopening a stale duplicate command",
  );
  assert.doesNotMatch(
    replacementCommand,
    /"CoopReplayTurnPhase",\s*this\.turn,/u,
    "the replacement-to-command pivot cannot retain its pre-checkpoint replay address",
  );
});

test("a half-wiped renderer never manufactures an immortal no-replacement proposal lease", () => {
  const noBenchStart = replayPhases.indexOf("if (!hasBench) {");
  const noBenchEnd = replayPhases.indexOf(
    'globalScene.phaseManager.unshiftNew("CoopGuestFaintSwitchPhase"',
    noBenchStart,
  );
  assert.ok(noBenchStart >= 0 && noBenchEnd > noBenchStart, "the guest half-wipe branch is structurally present");
  const noBenchBranch = replayPhases.slice(noBenchStart, noBenchEnd);
  assert.match(
    noBenchBranch,
    /markCoopFaintSwitchPickerSettled[\s\S]*COOP_FAINT_SWITCH_RESOLUTION_NONE[\s\S]*sendCoopFaintSwitchChoice/u,
    "the renderer publishes one exact NONE observation after proving no picker exists",
  );
  assert.doesNotMatch(
    noBenchBranch,
    /armCoopFaintSwitchIntentResend/u,
    "NONE is not a human proposal and cannot fence a later authoritative command frontier forever",
  );
});

test("a committed guest picker settles and buffers its V2 carrier before yielding to TurnInit", () => {
  const closeStart = guestFaintSwitchPhase.indexOf("const closePicker = (): void => {");
  const closeEnd = guestFaintSwitchPhase.indexOf("\n    };", closeStart) + 7;
  assert.notEqual(closeStart, -1, "the guest replacement phase exposes its committed close boundary");
  assert.ok(closeEnd > closeStart, "the committed close boundary has a bounded source block");
  const close = guestFaintSwitchPhase.slice(closeStart, closeEnd);
  const materialized = close.indexOf("markPickerMaterialized()");
  const yielded = close.indexOf("scene.phaseManager.shiftPhase()");
  assert.ok(
    materialized >= 0 && yielded > materialized,
    "the exact picker terminal becomes materially settled before local phase progression can resume",
  );

  const settleStart = guestFaintSwitchPhase.indexOf("const markPickerMaterialized = (): void => {");
  const settleEnd = guestFaintSwitchPhase.indexOf("\n    };", settleStart) + 7;
  assert.notEqual(settleStart, -1, "the guest replacement phase exposes its material settlement boundary");
  assert.ok(settleEnd > settleStart, "the material settlement boundary has a bounded source block");
  const settle = guestFaintSwitchPhase.slice(settleStart, settleEnd);
  const recordsTerminal = settle.indexOf("markCoopFaintSwitchPickerSettled(");
  const retriesAuthority = settle.indexOf("retryCoopV2PendingAuthorityAtSafeBoundary(runtime)");
  assert.ok(
    recordsTerminal >= 0 && retriesAuthority > recordsTerminal,
    "the already-admitted V2 entry is retried synchronously after terminal proof and before picker yield",
  );
});

test("an ordered no-choice replacement dissolves without exposing an impossible PARTY modal", () => {
  const noChoiceStart = guestFaintSwitchPhase.indexOf("private dissolveNoChoiceReplacement(");
  const boundaryStart = guestFaintSwitchPhase.indexOf("public override start(): void", noChoiceStart);
  assert.ok(noChoiceStart >= 0 && boundaryStart > noChoiceStart, "the no-choice replacement boundary is bounded");
  const orderedOpen = guestFaintSwitchPhase.slice(noChoiceStart, boundaryStart);
  assert.match(orderedOpen, /const hasLegalOwnerBench =/u);
  assert.match(
    orderedOpen,
    /if \(hasLegalOwnerBench\) \{[\s\S]*return false;[\s\S]*isCoopFaintSwitchPickerSettled\([\s\S]*sendCoopFaintSwitchChoice\([\s\S]*scene\.phaseManager\.shiftPhase\(\);/u,
    "a wiped owner half publishes at most one exact NONE result and yields before opening PARTY",
  );
  const call = guestFaintSwitchPhase.indexOf(
    "this.dissolveNoChoiceReplacement(sourceWave, sourceTurn, occurrence, operationBinding)",
    boundaryStart,
  );
  const openStart = guestFaintSwitchPhase.indexOf("beginCoopFaintSwitchWindow()", boundaryStart);
  assert.ok(
    call >= boundaryStart && openStart > call,
    "the no-choice branch runs before the human-input lease can open",
  );
});

test("direct Mystery narration is excluded only from the duplicate battle-turn recorder", () => {
  assert.match(
    phaseManager,
    /import \{ coopMeHandoffBattleStarted, coopMeInProgress \} from "#data\/elite-redux\/coop\/coop-me-pin-state";/u,
    "the recorder guard reads the runtime Mystery handoff predicates directly",
  );
  const queueStart = phaseManager.indexOf("queueMessage(");
  const queueEnd = phaseManager.indexOf("const phase = new MessagePhase", queueStart);
  assert.ok(queueStart >= 0 && queueEnd > queueStart, "PhaseManager.queueMessage has a bounded recorder block");
  const queue = phaseManager.slice(queueStart, queueEnd);
  assert.match(queue, /globalScene\.gameMode\.isCoop && coopMeInProgress\(\) && !coopMeHandoffBattleStarted\(\)/u);
  assert.match(queue, /isCoopRecording\(\) && !directMysteryNarration/u);
  assert.match(queue, /recordCoopMessage\(message\)/u);
  assert.doesNotMatch(
    queue,
    /directMysteryNarration[\s\S]*recordCoopMessage\(message\)[\s\S]*recordCoopMessage\(message\)/u,
    "the queue has one generic recorder call, never a second Mystery-specific copy",
  );
});

test("the public post-turn scanner never infers replacement ownership from a phase name", () => {
  const scanStart = publicUiHarness.indexOf("async waitForPostTurnOutcome(");
  const scanEnd = publicUiHarness.indexOf("\n  async driveReplacement(", scanStart);
  assert.notEqual(scanStart, -1, "the public driver exposes its post-turn outcome scanner");
  assert.ok(scanEnd > scanStart, "the post-turn outcome scanner has a bounded source block");
  const scan = publicUiHarness.slice(scanStart, scanEnd);
  assert.match(scan, /findOwnedReadyReplacement\(client, from\[client\.label\]\)/u);
  assert.doesNotMatch(scan, /GUEST_FAINT_PICKER|HOST_SWITCH_PHASE/u);
});

test("the campaign outcome wait never infers replacement ownership from a phase name", () => {
  const scanStart = campaignDriver.indexOf("export async function waitForOutcomeBounded(");
  const scanEnd = campaignDriver.indexOf("\nasync function driveBattleWave(", scanStart);
  assert.notEqual(scanStart, -1, "the campaign driver exposes its bounded outcome scanner");
  assert.ok(scanEnd > scanStart, "the campaign outcome scanner has a bounded source block");
  const scan = campaignDriver.slice(scanStart, scanEnd);
  assert.match(scan, /findOwnedActionableReplacementSurface\(client, from\[client\.label\]\)/u);
  assert.doesNotMatch(scan, /GUEST_FAINT_PICKER|HOST_SWITCH_PHASE/u);
});

test("a chained biome picker preserves its exact interaction coordinate through owner, watcher, and recovery", () => {
  const watcherStart = selectBiomePhase.indexOf("private async applyBiomeWatcherDecision(");
  const watcherEnd = selectBiomePhase.indexOf("\n  private ", watcherStart + 1);
  assert.notEqual(watcherStart, -1, "SelectBiome exposes the watcher result seam");
  assert.ok(watcherEnd > watcherStart, "SelectBiome watcher result seam has a bounded source block");
  const watcherApply = selectBiomePhase.slice(watcherStart, watcherEnd);

  const ownerStart = selectBiomePhase.indexOf("private coopRelayOwnerBiome(");
  const ownerEnd = selectBiomePhase.length;
  assert.notEqual(ownerStart, -1, "SelectBiome exposes the owner result seam");
  assert.ok(ownerEnd > ownerStart, "SelectBiome owner result seam has a bounded source block");
  const ownerCommit = selectBiomePhase.slice(ownerStart, ownerEnd);

  assert.match(watcherApply, /turn: this\.coopSourceTurn/u);
  assert.doesNotMatch(watcherApply, /turn: 0/u);
  assert.match(ownerCommit, /turn: this\.coopSourceTurn/u);
  assert.doesNotMatch(ownerCommit, /turn: 0/u);
  assert.match(
    coopRuntime,
    /create\("SelectBiomePhase", plan\.sourceWave, control\.turn\)[\s\S]*installCoopV2BiomeProjection\(plan\.operationId, plan\.sourceWave, control\.turn, plan\.pinned\)/u,
    "ordinary and recovery projection pass the authority-stated turn and pin into the chained biome picker",
  );
  assert.match(
    interactionProjection,
    /parsed\.pinnedSeq - COOP_BIOME_PICK_SEQ_BASE[\s\S]*kind: "biome"[\s\S]*pinned/u,
    "the complete biome projection derives its pin from the immutable future BIOME_PICK address",
  );
  const projectionInstallerStart = selectBiomePhase.indexOf("public installCoopV2BiomeProjection(");
  const projectionInstallerEnd = selectBiomePhase.indexOf("\n  /**", projectionInstallerStart);
  const projectionInstaller = selectBiomePhase.slice(projectionInstallerStart, projectionInstallerEnd);
  assert.match(projectionInstaller, /Number\.isSafeInteger\(pinned\)/u);
  assert.match(projectionInstaller, /this\.coopV2ProjectedPinned = pinned/u);
  assert.match(projectionInstaller, /this\.coopAdvancePinned = pinned/u);
  assert.match(projectionInstaller, /this\.coopChained = true/u);
  assert.match(
    selectBiomePhase,
    /start\(\) \{[\s\S]*this\.coopV2ProjectedPinned = -1;[\s\S]*setCoopBiomeInteractionStart\(pinned\)/u,
    "the pin becomes module-visible only after PhaseManager accepts and starts the projected successor",
  );
  assert.match(
    selectBiomePhase,
    /public coopV2BiomeInteractionPin\(\): number \{[\s\S]*?this\.coopChained \? this\.coopAdvancePinned : -1/u,
    "the installed V2 successor exposes its own address rather than requiring a module-global snapshot",
  );
  assert.match(
    soakDriver,
    /phase\.coopV2BiomeInteractionPin\?\.\(\)[\s\S]*?phasePin >= 0 \? phasePin : coopBiomeInteractionStartValue\(\)/u,
    "the two-engine soak asserts the actual projected phase coordinate before its legacy leaf fallback",
  );
  const readyStart = selectBiomePhase.indexOf("private publishCoopBiomeSurfaceWhenActionable(");
  const readyEnd = selectBiomePhase.indexOf("\n  private ", readyStart + 1);
  assert.notEqual(readyStart, -1, "SelectBiome exposes one bounded public-control proof");
  assert.ok(readyEnd > readyStart, "SelectBiome public-control proof has a bounded source block");
  const ready = selectBiomePhase.slice(readyStart, readyEnd);
  const actionableCheck = ready.indexOf("handler.isCoopV2InputActionable?.() === true");
  const interactionProof = ready.indexOf("notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime)");
  const continuationProof = ready.indexOf("notifyCoopWaveContinuationSurfaceReady(wave)");
  assert.ok(actionableCheck >= 0, "SelectBiome checks the exact World Map handler");
  assert.ok(
    interactionProof > actionableCheck,
    "SelectBiome cannot retire the chained V2 interaction before the World Map is actionable",
  );
  assert.ok(
    continuationProof > interactionProof,
    "the same actionable World Map proves V2 interaction control before the retained wave continuation",
  );
  assert.equal(
    [...selectBiomePhase.matchAll(/this\.publishCoopBiomeSurfaceWhenActionable\(generation, (?:wave|boundaryWave)\)/gu)]
      .length,
    2,
    "both the owner and watcher map paths publish through the same exact proof",
  );
});

test("Crossroads and World Map interpret every asynchronous surface completion only in their owning runtime", () => {
  for (const [name, source, continuation] of [
    ["Crossroads", crossroadsPhase, "this.continueCoopStart(controller, spoofed);"],
    ["World Map", selectBiomePhase, "this.continueCoopBiomePickFlow(controller, revealed, origin, spoofed);"],
  ]) {
    const awaitBarrier = source.indexOf("const barrier = await this.coopAwaitBoundaryBarrier();");
    const runtimeResume = source.indexOf("this.resumeInOwningRuntime(() => {", awaitBarrier);
    const acceptBarrier = source.indexOf("this.acceptCoopBoundaryBarrier(barrier)", runtimeResume);
    const continueFlow = source.indexOf(continuation, acceptBarrier);
    assert.ok(
      awaitBarrier >= 0
        && runtimeResume > awaitBarrier
        && acceptBarrier > runtimeResume
        && continueFlow > acceptBarrier,
      `${name} binds the complete post-await owner/watcher split to its own runtime`,
    );
  }

  for (const [name, source, watcherContinuation, legacyHelper] of [
    ["Crossroads", crossroadsPhase, "this.continueCoopWatchFlow(", "finishLegacyCrossroadsWatcher"],
    ["World Map", selectBiomePhase, "this.continueCoopBiomePickWatch(", "finishLegacyBiomeWatcher"],
  ]) {
    const settledMode = source.indexOf("const settledMode = mode;");
    const watcherResume = source.indexOf("this.resumeInOwningRuntime(", settledMode);
    const watcherContinue = source.indexOf(watcherContinuation, watcherResume);
    assert.ok(
      settledMode >= 0 && watcherResume > settledMode && watcherContinue > watcherResume,
      `${name} binds its post-UI watcher continuation to its own runtime`,
    );

    const legacyStart = source.indexOf(`private async ${legacyHelper}`);
    const legacyAwait = source.indexOf("awaitCoopChoiceWithOrphanBackstop(", legacyStart);
    const legacyResume = source.indexOf("this.resumeInOwningRuntime(() => {", legacyAwait);
    assert.ok(
      legacyStart >= 0 && legacyAwait > legacyStart && legacyResume > legacyAwait,
      `${name} binds legacy relay completion to its own runtime`,
    );
  }
});

test("overlapping duo scopes cannot overwrite a newer browser-local World Map snapshot", () => {
  assert.match(
    duoHarness,
    /outgoing\.biomeStateSaveGeneration = \(outgoing\.biomeStateSaveGeneration \?\? 0\) \+ 1;[\s\S]*outgoing\.biomeState = snapshotBiomeModuleState\(\)/u,
    "cross-client preemption claims and persists the newest World Map snapshot",
  );
  assert.match(
    duoHarness,
    /function ownsInstalledClientRealm\(ctx: ClientCtx\): boolean \{\s*return activeClientCtx === ctx && globalScene === ctx\.scene && getCoopRuntime\(\) === ctx\.runtime;\s*\}/u,
    "a resumed client proves that the exact scene/runtime/browser realm is installed",
  );
  assert.equal(
    [
      ...duoHarness.matchAll(
        /ctx\.biomeStateSaveGeneration === biomeStateSaveGeneration \|\| ownsInstalledClientRealm\(ctx\)/gu,
      ),
    ].length,
    2,
    "sync and async windows retain the generation fence while saving a legitimately resumed realm",
  );
  assert.equal(
    [
      ...duoHarness.matchAll(
        /if \(activeClientCtx != null\) \{\s*\/\/[\s\S]*?persistPreemptedClientState\(activeClientCtx\);/gu,
      ),
    ].length,
    2,
    "sync and async same-browser re-entry persist the live realm before loading the callback window",
  );
  assert.doesNotMatch(
    duoHarness,
    /activeClientCtx != null && activeClientCtx !== ctx/u,
    "same-browser ACK callbacks cannot bypass live realm persistence",
  );
});

test("biome permits and dex acquisition state belong to exact receiver scenes", () => {
  assert.match(
    rendererGate,
    /const biomeTransitionTailPermits = new WeakMap<object, CoopBiomeTransitionTailPermit>\(\);[\s\S]+function biomeTransitionTailPermitKey\(\): object \{\s*return globalScene \?\? biomeTransitionTailPermitBeforeScene;/u,
    "each browser scene owns an independent one-shot biome transition permit",
  );
  assert.doesNotMatch(
    duoHarness,
    /(?:snapshot|restore)CoopBiomeTransitionTailPermit/u,
    "the one-process harness no longer serializes one client's scene-owned permit through ambient module state",
  );
  assert.match(
    coopBattleEngine,
    /const coopDexBaselines = new WeakMap<typeof globalScene, CoopDexBaseline>\(\);/u,
    "each account scene owns its own run-scoped dex acquisition baseline",
  );
  assert.match(
    coopBattleEngine,
    /export function applyCoopDexDelta\(blob: string, receiverScene: typeof globalScene = globalScene\): void \{[\s\S]+receiverScene\.gameData\.dexData[\s\S]+receiverScene\.gameData\.starterData/u,
    "a received dex carrier applies to its explicit account scene instead of the ambient browser",
  );
  assert.match(
    coopRuntime,
    /const receiverScene = runtimeSceneBindings\.get\(runtime\) as typeof globalScene \| undefined;[\s\S]+applyCoopDexDelta\(dex, receiverScene\)/u,
    "the relay binds dex material to the authenticated receiver runtime's scene",
  );
});

test("superseded control addresses can reopen without weakening live-address conflicts", () => {
  const registerStart = controlLedger.indexOf("registerEntry(entry: CoopAuthorityEntry): boolean");
  const registerEnd = controlLedger.indexOf("\n  /**", registerStart + 1);
  assert.notEqual(registerStart, -1, "the global ledger exposes its registration boundary");
  assert.ok(registerEnd > registerStart, "the registration boundary has a bounded source block");
  const register = controlLedger.slice(registerStart, registerEnd);
  assert.match(register, /if \(!prior\.superseded \|\| entry\.revision <= prior\.revision\) \{\s*return false;/u);
  assert.ok(
    register.indexOf("if (duplicate)") < register.indexOf("if (!prior.superseded"),
    "identical redelivery stays idempotent before a newer lease generation is considered",
  );
});

test("biome result materialization cannot invalidate its exact queued transition tail", () => {
  const adoptStart = rendererGate.indexOf("export function adoptCoopBiomeTransitionSwitchPermit(");
  const adoptEnd = rendererGate.indexOf("\nexport function markCoopBiomeTransitionHistoryRecorded", adoptStart);
  assert.notEqual(adoptStart, -1, "the renderer gate exposes the biome permit adopter");
  assert.ok(adoptEnd > adoptStart, "the biome permit adopter has a bounded source block");
  const adopt = rendererGate.slice(adoptStart, adoptEnd);
  assert.match(
    adopt,
    /const destinationAlreadyMaterialized =[\s\S]*permit\.destinationBiomeId === params\.sourceBiomeId[\s\S]*permit\.wave === params\.wave/u,
    "an exact same-wave destination state may precede first tail adoption",
  );
  assert.match(
    switchBiomePhase,
    /erRecordBiomeEntry\(permit\.sourceBiomeId as BiomeId\)/u,
    "history is derived from immutable source authority instead of the already-materialized arena",
  );
});

test("a projected biome transition consumes the exact destination command carrier before leaving its source battle", () => {
  assert.match(
    selectBiomePhase,
    /completion\?\.authoritativeProjection === true/u,
    "the projected result explicitly marks the switch as a destination-carrier consumer",
  );
  const rendererBiomeTail = selectBiomePhase.slice(
    selectBiomePhase.indexOf("const sanctionedBattleAdvances ="),
    selectBiomePhase.indexOf(
      "this.coopAppliedTerminal =",
      selectBiomePhase.indexOf("const sanctionedBattleAdvances ="),
    ),
  );
  assert.match(rendererBiomeTail, /phaseName === "NewBattlePhase" && isCoopWaveTailSanctioned\(phaseName\)/u);
  assert.match(
    rendererBiomeTail,
    /completion\?\.authoritativeProjection === true && sanctionedBattleAdvances === 0/u,
    "only a projection without an ordered WAVE_ADVANCE battle carrier waits for a command shell",
  );
  assert.match(
    rendererBiomeTail,
    /if \(sanctionedBattleAdvances > 1\) \{[\s\S]*?throw new Error/u,
    "ambiguous ordered battle successors fail closed",
  );
  assert.match(switchBiomePhase, /private readonly coopAwaitDestinationCarrier: boolean/u);
  assert.match(switchBiomePhase, /public canReleaseForCoopV2Control\(successor:/u);
  assert.match(switchBiomePhase, /public prepareForCoopV2ControlMaterial\(successor:/u);
  assert.match(switchBiomePhase, /successor\.kind === "CONTROL_COMMIT"/u);
  assert.match(switchBiomePhase, /command\?\.kind === "COMMAND_FRONTIER"/u);
  assert.match(switchBiomePhase, /permit\.wave === \(this\.coopSourceWave \?\? this\.coopWave\)/u);
  assert.match(switchBiomePhase, /permit\.nextWave === command\.wave/u);
  assert.match(
    switchBiomePhase,
    /Array\.isArray\(material\.entryPresentation\)/u,
    "an exact command carrier may seal a legitimate zero-event presentation",
  );
  assert.doesNotMatch(
    switchBiomePhase,
    /material\.entryPresentation\.length > 0/u,
    "zero cosmetic events cannot invalidate complete mechanical command authority",
  );
  const admission = switchBiomePhase.slice(
    switchBiomePhase.indexOf("public canReleaseForCoopV2Control("),
    switchBiomePhase.indexOf("public releaseForCoopV2Control("),
  );
  assert.match(admission, /this\.coopAwaitDestinationCarrier/u);
  assert.doesNotMatch(
    admission,
    /permit\.(?:historyRecorded|switchPrepared)/u,
    "pre-DATA admission does not circularly require stages completed from the destination carrier",
  );
  assert.doesNotMatch(
    admission,
    /globalScene\.arena\?\.biomeId === permit\.destinationBiomeId/u,
    "pre-DATA admission accepts the exact carrier while the renderer still shows the source arena",
  );
  const preparation = switchBiomePhase.slice(
    switchBiomePhase.indexOf("public prepareForCoopV2ControlMaterial("),
    switchBiomePhase.indexOf("public releaseForCoopV2Control("),
  );
  assert.match(
    preparation,
    /currentBattle\.waveIndex !== permit\.wave[\s\S]*?command\.wave !== permit\.nextWave[\s\S]*?command\.wave !== currentBattle\.waveIndex \+ 1/u,
    "structural preparation is pinned to the exact immediately-next permitted wave",
  );
  assert.match(preparation, /const destinationBattle = globalScene\.newCoopV2ProjectedBattle\(\)/u);
  assert.match(
    preparation,
    /destinationBattle\.waveIndex !== command\.wave[\s\S]*?destinationBattle\.turn !== command\.turn/u,
    "the prepared battle shell must prove the signed destination address",
  );
  const projectedBattleStart = battleScene.indexOf("public newCoopV2ProjectedBattle(): Battle");
  const projectedBattleEnd = battleScene.indexOf("\n  private createBattle(", projectedBattleStart);
  assert.ok(
    projectedBattleStart >= 0 && projectedBattleEnd > projectedBattleStart,
    "BattleScene exposes one bounded projected-battle constructor",
  );
  const projectedBattle = battleScene.slice(projectedBattleStart, projectedBattleEnd);
  assert.match(projectedBattle, /if \(!isCoopAuthoritativeGuest\(\)\)/u);
  assert.match(projectedBattle, /return this\.createBattle\(undefined, false\)/u);
  assert.doesNotMatch(
    projectedBattle,
    /doPostBattleCleanup/u,
    "the projected shell cannot derive or queue a renderer-local encounter successor",
  );
  assert.match(
    switchBiomePhase,
    /this\.coopDestinationBattleCreated && ambientWave === this\.coopWave \+ 1/u,
    "the same retained phase remains lifetime-valid while DATA and queue release finish on its prepared shell",
  );
  const controlApplyStart = coopRuntime.indexOf('if (entry.kind === "CONTROL_COMMIT")');
  const controlApplyEnd = coopRuntime.indexOf('if (entry.kind === "WAVE_ADVANCE"', controlApplyStart);
  const controlApply = coopRuntime.slice(controlApplyStart, controlApplyEnd);
  const runtimePrepare = controlApply.indexOf("!prepareCoopV2CommandOpenMaterialConsumer(runtime, entry)");
  const runtimeApply = controlApply.indexOf("applyCoopAuthoritativeBattleState(material.authoritativeState, true)");
  assert.ok(
    controlApplyStart >= 0
      && controlApplyEnd > controlApplyStart
      && runtimePrepare >= 0
      && runtimeApply > runtimePrepare,
    "the exact structural shell is prepared before immutable command-open DATA is applied",
  );
  const projectedPark = switchBiomePhase.indexOf("if (authoritativeGuest && this.coopAwaitDestinationCarrier)");
  const eagerRetry = switchBiomePhase.indexOf("retryCoopV2PendingAuthorityAtSafeBoundary();", projectedPark);
  const ordinaryPreparation = switchBiomePhase.indexOf("this.prepareAuthoritativeTransition(", projectedPark);
  assert.ok(
    projectedPark >= 0 && eagerRetry > projectedPark && ordinaryPreparation > eagerRetry,
    "a destructively projected switch parks and retries its carrier before any local preparation or end",
  );
  const release = switchBiomePhase.indexOf("public releaseForCoopV2Control(");
  const markHistory = switchBiomePhase.indexOf("markCoopBiomeTransitionHistoryRecorded(permit.operationId)", release);
  const markPrepared = switchBiomePhase.indexOf("markCoopBiomeTransitionSwitchPrepared(permit.operationId)", release);
  const materializeArena = switchBiomePhase.indexOf("this.materializeCoopTransition();", release);
  const queueEncounter = switchBiomePhase.indexOf(
    'globalScene.phaseManager.unshiftNew("NewBiomeEncounterPhase")',
    release,
  );
  const endSwitch = switchBiomePhase.indexOf("this.end();", queueEncounter);
  assert.ok(
    release >= 0
      && markHistory > release
      && markPrepared > markHistory
      && materializeArena > markPrepared
      && queueEncounter > materializeArena
      && endSwitch > queueEncounter,
    "post-DATA release prepares the one-shot permit and arena before exposing the encounter tail",
  );
});

test("the campaign presentation oracle compares a canonical epoch prefix instead of unrelated browser cursors", () => {
  const proofStart = publicUiHarness.indexOf("async assertPresentationLedgerAtSharedCommand(");
  const proofEnd = publicUiHarness.indexOf("\n  /**", proofStart);
  assert.ok(
    proofStart >= 0 && proofEnd > proofStart,
    "the shared-command presentation proof has a bounded source block",
  );
  const proof = publicUiHarness.slice(proofStart, proofEnd);
  assert.match(proof, /currentEpochPrefix: true/u);
  const ledgerStart = publicUiHarness.indexOf("assertPresentationLedger(");
  const ledgerEnd = publicUiHarness.indexOf("\n  /**", ledgerStart);
  assert.ok(ledgerStart >= 0 && ledgerEnd > ledgerStart, "the ordered presentation ledger has a bounded source block");
  const ledger = publicUiHarness.slice(ledgerStart, ledgerEnd);
  assert.match(ledger, /const proofEpoch = currentEpochPrefix \? commandMatch\.comparable\?\.epoch : null/u);
  assert.match(ledger, /\.slice\(currentEpochPrefix \? 0 : \(cursors\[client\.label\] \?\? 0\)\)/u);
  assert.match(ledger, /event\.observation\?\.epoch === proofEpoch/u);
});

test("a V2 biome receipt is consumed without consulting the retired operation revision clock", () => {
  const watcherStart = biomeOperation.indexOf("export function adoptBiomeWatcherChoice(");
  const watcherEnd = biomeOperation.indexOf(
    "\n// -----------------------------------------------------------------------------",
    watcherStart,
  );
  assert.notEqual(watcherStart, -1, "the biome adapter exposes its watcher-consumption boundary");
  assert.ok(watcherEnd > watcherStart, "the watcher-consumption boundary has a bounded source block");
  const watcher = biomeOperation.slice(watcherStart, watcherEnd);
  const v2Receipt = watcher.indexOf("s.pendingJournalMaterializations.has(opId)");
  const legacyDuplicate = watcher.indexOf("guest(binding).hasApplied(opId)");
  assert.ok(v2Receipt >= 0, "the watcher accepts one exact V2 materialization receipt");
  assert.ok(
    legacyDuplicate > v2Receipt,
    "the legacy operation ledger is only a post-receipt duplicate detector, never a V2 application permit",
  );
});

test("a missing V2 reward result retains control instead of inventing a local leave", () => {
  const applyStart = selectModifierPhase.indexOf("  private coopApplyWatcherAction(");
  const applyEnd = selectModifierPhase.indexOf("\n  /** WATCHER: open the SAME reward screen", applyStart);
  assert.notEqual(applyStart, -1, "the reward watcher exposes one bounded result-apply boundary");
  assert.ok(applyEnd > applyStart, "the reward watcher result boundary is structurally bounded");
  const apply = selectModifierPhase.slice(applyStart, applyEnd);
  const missingStart = apply.indexOf("if (action == null)");
  const operationGate = apply.indexOf("isCoopV2InteractionCutoverActive", missingStart);
  const reconnect = apply.indexOf("getCoopRuntime()?.durability?.reconnect()", operationGate);
  const recover = apply.indexOf('return "recover"', reconnect);
  const legacyEnd = apply.indexOf("super.end()", recover);
  const legacyAdvance = apply.indexOf("this.coopAdvanceInteraction()", legacyEnd);
  assert.ok(
    missingStart >= 0
      && operationGate > missingStart
      && reconnect > operationGate
      && recover > reconnect
      && legacyEnd > recover
      && legacyAdvance > legacyEnd,
    "V2 null re-requests the retained tail before the legacy-only leave/advance branch",
  );

  const watchStart = selectModifierPhase.indexOf("  private async startCoopWatch(): Promise<void>");
  const watchEnd = selectModifierPhase.indexOf(
    "\n  /**\n   * WATCHER: apply one relayed reward-screen action",
    watchStart,
  );
  assert.ok(watchStart >= 0 && watchEnd > watchStart, "the watcher pump has a bounded source block");
  const watch = selectModifierPhase.slice(watchStart, watchEnd);
  const recoveryBranch = watch.indexOf('if (disposition === "recover")');
  const backoff = watch.indexOf("COOP_REWARD_RECOVERY_REARM_MS", recoveryBranch);
  const liveness = watch.indexOf('this.coopShopSceneAlive("watcher V2 result re-arm")', backoff);
  const retry = watch.indexOf("continue;", liveness);
  assert.ok(
    recoveryBranch >= 0 && backoff > recoveryBranch && liveness > backoff && retry > liveness,
    "an immediately refused wait is re-armed with bounded backoff only while the exact shop remains live",
  );
});

test("a fully missing account save set publishes no-save without a generic reconciliation tail", () => {
  const snapshotStart = gameData.indexOf("  async getCoopResumeLobbySnapshot(): Promise<CoopResumeLobbySnapshot>");
  const snapshotEnd = gameData.indexOf("\n  /**\n   * Strict programmatic scan", snapshotStart);
  assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart, "the resume snapshot has a bounded source block");
  const snapshot = gameData.slice(snapshotStart, snapshotEnd);
  const cloudScan = snapshot.indexOf("this.scanCoopCloudReplicas(accountIdentity!, true)");
  const cloudProof = snapshot.indexOf("const everyCloudSlotMissing", cloudScan);
  const localProof = snapshot.indexOf("const everyLocalSlotMissing", cloudProof);
  const terminal = snapshot.indexOf("if (everyCloudSlotMissing && everyLocalSlotMissing)", localProof);
  const populate = snapshot.indexOf("sessions.set(slot, undefined)", terminal);
  const publish = snapshot.indexOf("return { sessions, failures }", populate);
  const genericReconcile = snapshot.indexOf("this.reconcileCoopResumeSlot", publish);
  assert.ok(
    cloudScan >= 0
      && cloudProof > cloudScan
      && localProof > cloudProof
      && terminal > localProof
      && populate > terminal
      && publish > populate
      && genericReconcile > publish,
    "five typed cloud-missing results plus five exact local absences publish no-save before generic reconciliation",
  );
  assert.doesNotMatch(
    snapshot.slice(terminal, publish),
    /deleteSession|removeItem|setItem|updateCoopCas/u,
    "the fresh all-empty completion is observation-only",
  );
});

test("the asynchronous lobby save decision rebuilds one actionable handler after a bounded exact-session transition", () => {
  const installerStart = titlePhase.indexOf("const installHostLaunchDecision = (");
  const installerEnd = titlePhase.indexOf("// HOST: is there a saved run", installerStart);
  assert.ok(installerStart >= 0 && installerEnd > installerStart, "the host decision installer has a bounded block");
  const installer = titlePhase.slice(installerStart, installerEnd);
  const clear = installer.indexOf("handler.clear()");
  const reopen = installer.indexOf("handler.show([])", clear);
  const reset = installer.indexOf("globalScene.ui.resetModeChain()", reopen);
  const prompt = installer.indexOf("globalScene.ui.showText(message, 0, callback, null, true)", reset);
  const proof = installer.indexOf("handler.active && handler.isCoopV2InputActionable()", prompt);
  const terminal = installer.indexOf("terminalFailure(", proof);
  assert.ok(
    clear >= 0 && reopen > clear && reset > reopen && prompt > reset && proof > prompt && terminal > proof,
    "the same-mode lobby handler is cleared, reopened, prompted, and proved actionable or terminalized",
  );

  const decisionStart = titlePhase.indexOf("const blockedMessage = coopResumeBlockMessage(discovery);");
  const decisionEnd = titlePhase.indexOf("// Offer the HOST a real RESUME / NEW GAME choice.", decisionStart);
  assert.ok(decisionStart >= 0 && decisionEnd > decisionStart, "the fresh launch decision has a bounded source block");
  const freshDecision = titlePhase.slice(decisionStart, decisionEnd);
  const boundedOpen = freshDecision.indexOf("setModeBoundedWhen(UiMode.MESSAGE, 2_000, isCurrentSession)");
  const currentFence = freshDecision.indexOf('transition === "superseded" || !isCurrentSession()', boundedOpen);
  const install = freshDecision.indexOf('installHostLaunchDecision("Connected to your partner!', currentFence);
  assert.ok(
    boundedOpen >= 0 && currentFence > boundedOpen && install > currentFence,
    "a lost lobby fade cannot retain the checking-saves screen or install a prompt after session replacement",
  );
  assert.doesNotMatch(
    freshDecision,
    /await globalScene\.ui\.setMode\(UiMode\.MESSAGE\)/u,
    "the exact fresh decision may not wait forever on an unbounded Phaser transition",
  );
});

test("the replacement harness preserves an already-installed command frontier", () => {
  const helperStart = duoHarness.indexOf("export async function materializeGuestInputAfterReplacement(");
  const helperEnd = duoHarness.indexOf("\n/**", helperStart + 1);
  assert.notEqual(helperStart, -1, "the duo harness exposes its post-replacement materializer");
  assert.ok(helperEnd > helperStart, "the post-replacement materializer has a bounded source block");
  const helper = duoHarness.slice(helperStart, helperEnd);
  const commandReturn = helper.indexOf('if (scene.phaseManager.getCurrentPhase()?.phaseName === "CommandPhase")');
  const bootFallback = helper.indexOf("materializeMirroredGuestInputTurn(scene)");
  assert.ok(
    commandReturn >= 0 && bootFallback > commandReturn,
    "an exact V2 CommandPhase is retained before the mirrored-boot fallback is considered",
  );
});

test("soaks budget command rendezvous for authoritative presentation and restore the test default", () => {
  const soakSuiteDirectory = new URL("test/tests/elite-redux/coop/", root);
  const representativeSoaks = readdirSync(soakSuiteDirectory)
    .filter(name => name.endsWith(".test.ts"))
    .map(name => ({ name, source: readFileSync(new URL(name, soakSuiteDirectory), "utf8") }))
    .filter(({ source }) => source.includes("runCoopSoak("));

  assert.ok(representativeSoaks.length >= 10, "the complete representative-soak inventory is inspected");
  for (const { name, source } of representativeSoaks) {
    const budgets = [...source.matchAll(/setCoopRendezvousWaitMs\(([\d_]+)\)/gu)].map(match =>
      Number(match[1].replaceAll("_", "")),
    );
    assert.ok(
      budgets.some(budget => budget >= 1_000),
      `${name} cannot compress healthy authoritative presentation into the generic 350ms retry ceiling`,
    );
    assert.match(source, /resetCoopRendezvousWaitMs\(\)/u, `${name} restores the test-aware rendezvous default`);
    assert.doesNotMatch(
      source,
      /afterEach\([\s\S]*?setCoopRendezvousWaitMs\(60_000\)/u,
      `${name} cleanup must not latch the live interval into later files`,
    );
  }
});

test("the animations-on campaign extends a live between-wave renderer without weakening other profiles", () => {
  assert.match(campaignDriver, /const betweenWaveTimeoutMs = rig\.config\.timeoutMs \* 3/u);
  assert.match(
    campaignDriver,
    /const betweenWaveBudget = policy\.moveAnimationsExpected[\s\S]*createAnimationProgressBudget\(rig, commandCursors, betweenWaveTimeoutMs,[\s\S]*hardCeilingMs: Math\.max\([\s\S]*betweenWaveTimeoutMs \+ ANIMATION_PROGRESS_ALLOWANCE_MS,[\s\S]*ANIMATIONS_ON_OUTCOME_HARD_CEILING_MS/u,
  );
  assert.match(
    campaignDriver,
    /betweenWaveBudget\?\.observe\(\) \?\? mysteryProgressBudget\?\.deadline\(\) \?\? fixedDeadline/u,
  );
  assert.doesNotMatch(
    campaignDriver,
    /const betweenWaveBudget = true/u,
    "the animation budget remains scoped to the animations-on profile",
  );
});

test("the Mystery gauntlet uses progress-proven rolling surface windows under an immutable ceiling", () => {
  assert.match(campaignDriver, /export function createRegisteredSurfaceProgressBudget\(/u);
  assert.match(campaignDriver, /const mysteryProgressBudget = policy\.mysteryGauntlet\.required/u);
  assert.match(campaignDriver, /policy\.mysteryGauntlet\.minSurfaces/u);
  assert.match(campaignDriver, /recordMysteryProgress\(`surface:\$\{drove\}`\)/u);
  assert.match(campaignDriver, /recordMysteryProgress\("mystery-narration"\)/u);
  assert.match(campaignDriver, /mysteryProgressBudget\?\.deadline\(\)/u);
});

test("campaign speed setup follows semantic title identities across a late title rebuild", () => {
  assert.match(campaignDriver, /const SPEED_STEP_OBSERVATION_TIMEOUT_MS = 4_000/u);
  assert.match(
    campaignDriver,
    /selectOptionById\(client, \{[\s\S]*surfaceId: "title-menu",[\s\S]*targetId: "settings",[\s\S]*submitKey: "Space",[\s\S]*timeoutMs: client\.config\.timeoutMs,[\s\S]*findLastRenderProfileObservation\(openCursor\)/u,
    "Settings navigation must tolerate the post-login TitlePhase rebuilding and resetting its cursor",
  );
  assert.match(
    campaignDriver,
    /const closeCursor = client\.evidence\.cursor\(\);[\s\S]*press\("Backspace", "speed-walk-close-settings"\)[\s\S]*findLastSemanticSurface\(closeCursor, "title-menu"\)[\s\S]*targetId: "new-game",[\s\S]*submit: false,[\s\S]*fromCursor: closeCursor/u,
    "the harness must observe the newly reopened title before parking on New Game",
  );
});

test("the browser observer republishes an unchanged menu after a non-semantic modal closes", () => {
  const classify = browserEntry.indexOf("classifySemanticSurface(phase, uiMode);");
  const selection = browserEntry.indexOf("const selection = readSelection(handler, uiMode);", classify);
  assert.ok(classify >= 0 && selection > classify, "the semantic classification block is bounded");
  const classification = browserEntry.slice(classify, selection);
  assert.match(
    classification,
    /if \(semantic == null\) \{[\s\S]*if \(runtime == null \|\| membership\?\.state !== "active"\) \{[\s\S]*lastSemanticObservation = "";[\s\S]*return;/u,
    "a local Settings/modal gap must invalidate deduplication so the reopened title menu is fresh",
  );
});

test("the browser observer derives interaction ownership from the rendering phase's immutable pin", () => {
  assert.match(
    browserEntry,
    /function semanticPinnedInteractionCounter\(semantic: SemanticSurface, currentPhase: unknown\)/u,
  );
  assert.match(browserEntry, /case "reward-shop":[\s\S]*candidate = phase\.coopInteractionStart;/u);
  assert.match(browserEntry, /case "biome-market":[\s\S]*candidate = phase\.coopBiomeStart;/u);
  assert.match(browserEntry, /case "crossroads":[\s\S]*candidate = phase\.coopStartCounter;/u);
  assert.match(browserEntry, /candidate = coopMeInteractionStartValue\(\);/u);
  assert.match(
    browserEntry,
    /const pinned = semanticPinnedInteractionCounter\(semantic, currentPhase\);[\s\S]*isLocalOwnerAtCounter\(pinned \?\? runtime\.controller\.interactionCounter\(\)\)/u,
    "an advanced live cursor must not flip the owner of an already-rendered interaction",
  );
});

test("an exact final battle boundary can close the command frontier without a phantom turn commit", () => {
  const admissionStart = nextControl.indexOf("export function controlAllowsSuccessorEntry(");
  const commandCaseStart = nextControl.indexOf('case "COMMAND_FRONTIER":', admissionStart);
  const replacementCaseStart = nextControl.indexOf('case "REPLACEMENT":', commandCaseStart);
  assert.ok(commandCaseStart >= 0 && replacementCaseStart > commandCaseStart, "command admission has a bounded case");
  const commandAdmission = nextControl.slice(commandCaseStart, replacementCaseStart);
  assert.match(commandAdmission, /next\.kind === "TURN_COMMIT"/u);
  assert.match(commandAdmission, /next\.kind === "WAVE_ADVANCE"/u);
  assert.match(commandAdmission, /next\.kind === "TERMINAL_COMMIT"/u);
  assert.match(
    commandAdmission,
    /address\?\.epoch === control\.epoch[\s\S]*address\.wave === control\.wave[\s\S]*address\.turn === control\.turn/u,
    "direct wave/terminal successors remain bound to the exact command address",
  );
});

test("the one-process soak retains the authority browser while nested peer pumps settle a wave crossing", () => {
  const crossingStart = soakDriver.indexOf("  const crossCommandBoundaryWithReplayGuest = async (");
  const crossingEnd = soakDriver.indexOf(
    "\n  // ---------------------------------------------------------------------------",
    crossingStart,
  );
  assert.ok(crossingStart >= 0 && crossingEnd > crossingStart, "the command crossing has a bounded source block");
  const crossing = soakDriver.slice(crossingStart, crossingEnd);
  const authorityScope = crossing.indexOf("return withClient(rig.hostCtx, async () => {");
  const pending = crossing.indexOf("const crossing = game.phaseInterceptor.toFirst", authorityScope);
  const settle = crossing.indexOf("return settleDuoPromise(rig, crossing", pending);
  const scopeClose = crossing.indexOf("\n              });", settle);
  assert.ok(
    authorityScope >= 0 && pending > authorityScope && settle > pending && scopeClose > settle,
    "the authority Promise settles inside its outer host scope while peer servicing remains nested",
  );
  assert.doesNotMatch(
    crossing.slice(pending, settle),
    /await withClient\(rig\.hostCtx[\s\S]*\}\);[\s\S]*settleDuoPromise/u,
    "the soak must not release the host scope before settling its structural continuation",
  );
});

test("the one-process duo pins Phaser tween callbacks to the browser that scheduled them", () => {
  const pinsStart = duoHarness.indexOf("function installDuoCtxOwnershipPins(");
  const pinsEnd = duoHarness.indexOf("\n/**\n * Dispose both independently assembled runtimes", pinsStart);
  assert.ok(pinsStart >= 0 && pinsEnd > pinsStart, "the client ownership pins have a bounded source block");
  const pins = duoHarness.slice(pinsStart, pinsEnd);
  const helper = pins.indexOf("const pinTweenCallbacks = (scene: BattleScene, ctx: ClientCtx): void =>");
  const wrap = pins.indexOf("withClientSync(ctx, () => callback.apply(this, callbackArgs))", helper);
  const retiredPassThrough = pins.indexOf("originalAdd(disposed ? config : wrapConfig(config))", wrap);
  const host = pins.indexOf("pinTweenCallbacks(rig.hostScene, rig.hostCtx)", wrap);
  const guest = pins.indexOf("pinTweenCallbacks(rig.guestScene, rig.guestCtx)", host);
  assert.ok(
    helper >= 0 && wrap > helper && retiredPassThrough > wrap && host > retiredPassThrough && guest > host,
    "a synchronous or delayed tween completion may not read the other browser's global scene/phase/runtime",
  );
  assert.match(
    pins,
    /const ownsClockRealm = \(\): boolean =>[\s\S]+activeClientCtx === ctx[\s\S]+globalScene === ctx\.scene[\s\S]+getCoopRuntime\(\) === ctx\.runtime/u,
    "a repeated host/guest label is not sufficient evidence that a Phaser clock owns the installed realm",
  );
  assert.match(
    pins,
    /clock\.preUpdate = \(time: number, delta: number\)[\s\S]+runOwned\(\(\) => originalPreUpdate\(time, delta\)\)[\s\S]+clock\.update = \(time: number, delta: number\)[\s\S]+runOwned\(\(\) => originalUpdate\(time, delta\)\)/u,
    "both halves of the headless MockClock tick must execute in their exact scheduling browser",
  );
  assert.match(
    pins,
    /const pinPhaseCompletion = \(scene: BattleScene, ctx: ClientCtx\): void => \{[\s\S]+const pinnedPrepare = \(\): void => \{[\s\S]+const phase = manager\.getCurrentPhase\(\);[\s\S]+const original = phase\.end;[\s\S]+withClientSync\(ctx, \(\) => original\.call\(phase\)\);[\s\S]+manager\.prepareCurrentPhaseForStart = pinnedPrepare;/u,
    "an async phase completion must shift the phase tree belonging to the browser that started it",
  );
  assert.match(
    pins,
    /pinPhaseCompletion\(rig\.hostScene, rig\.hostCtx\);\s*pinPhaseCompletion\(rig\.guestScene, rig\.guestCtx\);/u,
    "both simulated browser phase trees own their Promise-delayed completion edges",
  );
  assert.match(
    pins,
    /const ownsHostInterceptorRealm = \(\): boolean =>\s*activeClientCtx === rig\.hostCtx\s*&& globalScene === rig\.hostScene\s*&& getCoopRuntime\(\) === rig\.hostRuntime;[\s\S]+if \(ownsHostInterceptorRealm\(\)\) \{\s*return originalRun\(phase\);/u,
    "a repeated host label cannot run an authority phase while the guest scene/runtime is installed",
  );
  assert.doesNotMatch(
    pins,
    /if \(activeClientLabel === rig\.hostCtx\.label\) \{\s*return originalRun\(phase\);/u,
    "the interceptor may not use a label as its browser-realm identity proof",
  );
  assert.match(
    pins,
    /poll = originalRun\(phase\);\s*for \(let i = 0; i < 4; i\+\+\) \{\s*await Promise\.resolve\(\);/u,
    "the phase-start realm retains only its immediate microtask tail and cannot delay peer macrotasks",
  );
  assert.match(
    pins,
    /setCoopEncounterContinuationWrapperForTesting\(\(callback, ownerRuntime\) => \{[\s\S]+ownerRuntime === rig\.hostRuntime[\s\S]+ownerRuntime === rig\.guestRuntime[\s\S]+activeClientCtx === owner[\s\S]+globalScene === owner\.scene[\s\S]+getCoopRuntime\(\) === owner\.runtime[\s\S]+withClientSync\(owner, \(\) => callback\(\.\.\.args\)\)/u,
    "the variable-depth encounter continuation must re-enter the browser selected by its exact runtime",
  );
  assert.match(
    encounterPhase,
    /awaitCoopEncounterAssetsBounded\(Promise\.all\(loadEnemyAssets\), \{[\s\S]+enabled: encounterScene\.gameMode\.isCoop[\s\S]+remainsCurrent: encounterBoundaryIsLive/u,
    "an ambient controller gap cannot turn a captured co-op encounter asset join back into an unbounded wait",
  );
  assert.match(
    encounterPhase,
    /prepareCoopAuthoritativeGuestPresentationOnly[\s\S]+await awaitCoopEncounterAssetsBounded\(Promise\.all\(loads\), \{[\s\S]+enabled: scene\.gameMode\.isCoop[\s\S]+remainsCurrent: stillCurrent/u,
    "the authoritative guest presentation-only asset join is bounded by its exact scene too",
  );
  assert.match(
    encounterPhase,
    /const COOP_ENCOUNTER_ASSET_WAIT_MS = 12_000;[\s\S]+setTimeout\([\s\S]+continuing with placeholders[\s\S]+finish\(\);[\s\S]+COOP_ENCOUNTER_ASSET_WAIT_MS/u,
    "the asset deadline preserves late cosmetic repair while releasing the mechanical phase",
  );
  assert.match(
    encounterPhase,
    /void assetsReady[\s\S]+\.then\(\s*wrapCoopEncounterContinuation\(\(\) => \{/u,
    "success of the encounter asset join uses the exact continuation-owner seam",
  );
  assert.match(
    encounterPhase,
    /const ownerRuntime = getCoopRuntime\(\);[\s\S]+runWhenCoopRuntimeActive\(ownerRuntime, \(\) => \{[\s\S]+result = callback\(\.\.\.args\);/u,
    "encounter continuations wait for the exact runtime and its scene binding, not just an ambient harness label",
  );
  assert.match(
    encounterPhase,
    /coopEncounterContinuationWrapperForTesting\?\.\(callback, ownerRuntime\)/u,
    "the independent-browser executor receives the exact production-captured runtime identity",
  );
  assert.match(
    encounterPhase,
    /globalScene\.ui\.setMode\(UiMode\.MESSAGE\)\.then\(\s*wrapCoopEncounterContinuation\(\(\) => \{/u,
    "the nested encounter UI-mode continuation cannot escape into the peer browser realm",
  );
  assert.match(
    encounterPhase,
    /battle\.trainer\.loadAssets\(\)\.then\(\s*wrapCoopEncounterContinuation\(\(\) => battle\.trainer\?\.initSprite\(\)\)/u,
    "trainer asset completion initializes the sprite only in the encounter's owning browser",
  );
  assert.match(
    encounterPhase,
    /showFieldOverlay\(500\)[\s\S]+\.then\(\s*wrapCoopEncounterContinuation\(\(\) => \{[\s\S]+showCharacter\([\s\S]+\.then\(\s*wrapCoopEncounterContinuation\(\(\) => \{[\s\S]+showDialogueAndSummon\(\);[\s\S]+\.catch\(\s*wrapCoopEncounterContinuation\(error => \{/u,
    "every trainer character-intro promise edge re-enters the owning runtime before testing phase liveness",
  );
  assert.match(
    encounterPhase,
    /globalScene\.charSprite[\s\S]+\.hide\(\)[\s\S]+\.then\(\s*wrapCoopEncounterContinuation\(\(\) => \{[\s\S]+hideFieldOverlay\(250\)[\s\S]+\.then\(\s*wrapCoopEncounterContinuation\(\(\) => \{[\s\S]+finishInteractiveWait\(\)[\s\S]+\.catch\(\s*wrapCoopEncounterContinuation\(error => \{/u,
    "trainer dialogue cleanup cannot consume its summon continuation against the peer scene",
  );
  assert.match(
    encounterPhase,
    /\.then\(wrapCoopEncounterContinuation\(\(\) => doEncounter\(\)\)\)[\s\S]+mystery encounter overlay cleanup failed/u,
    "Mystery visual cleanup uses the same exact continuation ownership as trainer presentation",
  );
  assert.match(
    encounterPhase,
    /Promise\.all\(\[tutorialReady, playerPresentationReady\]\)[\s\S]+\.then\(\s*wrapCoopEncounterContinuation\(\(\) => \{/u,
    "the player-presentation terminal join must re-enter the browser that owns the encounter phase",
  );
  assert.match(
    encounterPhase,
    /tutorialReady\.then\(wrapCoopEncounterContinuation\(\(\) => this\.completeEncounterEnd\(\)\)\)/u,
    "the no-player-join tutorial terminal uses the same exact owner seam",
  );
  assert.match(
    encounterPhase,
    /\.catch\(\s*wrapCoopEncounterContinuation\(\(error: unknown\) => \{/u,
    "failure of the encounter asset join uses the exact continuation-owner seam",
  );
  const exactScheduledRealm =
    /activeClientCtx === owner\s*&& globalScene === owner\.scene\s*&& getCoopRuntime\(\) === owner\.runtime/g;
  assert.ok(
    [...pins.matchAll(exactScheduledRealm)].length >= 2,
    "durability callbacks and raw timers both require exact client, scene, and runtime ownership",
  );
  assert.doesNotMatch(
    pins,
    /if \(activeClientLabel === owner\.label\)/u,
    "a repeated client label may not authorize any scheduled callback realm",
  );
});

test("an Authority V2 Mystery selector renders the authority's resolved visuals without a second mechanics engine", () => {
  assert.match(
    mePresentation,
    /introVisuals\.spriteConfigs\.map[\s\S]*?species: _species[\s\S]*?visualPresentationByEncounter\.set/u,
    "the authority commits resolved sprite material and retains it across repeated selector rounds",
  );
  const visualStart = replayMePhase.indexOf("private async installCoopV2IntroVisualShell()");
  const visualEnd = replayMePhase.indexOf("public disposeCoopV2IntroVisualShell()", visualStart);
  assert.ok(
    visualStart >= 0 && visualEnd > visualStart,
    "the visual-only Mystery projector has a bounded source block",
  );
  const visualProjector = replayMePhase.slice(visualStart, visualEnd);
  assert.match(visualProjector, /new MysteryEncounterIntroVisuals\(/u);
  assert.match(
    visualProjector,
    /setPosition\(descriptor\.x, descriptor\.y\)\.setAlpha\(descriptor\.alpha\)\.setVisible\(descriptor\.visible\)/u,
    "the replay shell installs the authority's settled container transform, not the off-screen constructor default",
  );
  assert.match(visualProjector, /await visuals\.loadAssets\(\)[\s\S]*?visuals\.initSprite\(\)/u);
  assert.doesNotMatch(visualProjector, /getMysteryEncounter|\.onInit\(/u);
});

test("a projected Mystery phase cannot attest through its predecessor's active handler", () => {
  assert.match(
    replayMePhase,
    /public isCoopV2ControlSurfaceReady\(handlerToken: object\): boolean[\s\S]*?this\.initialPresentationEntered[\s\S]*?this\.boundaryStillLive\(\)[\s\S]*?globalScene\.ui\.getHandler\(\) === handlerToken/u,
    "Mystery proof is owned by the started replay generation and its consumed presentation",
  );
  const observerStart = coopRuntime.indexOf("function observeCoopV2InteractionSurface(");
  const observerEnd = coopRuntime.indexOf("\n/**\n * Physical UI input gate", observerStart);
  assert.ok(observerStart >= 0 && observerEnd > observerStart, "the interaction observer has a bounded source block");
  const observer = coopRuntime.slice(observerStart, observerEnd);
  const readinessFence = observer.indexOf("isCoopV2ControlSurfaceReady");
  const handlerActive = observer.indexOf("const handlerActive");
  assert.ok(
    readinessFence >= 0 && handlerActive > readinessFence,
    "phase-owned readiness rejects a queued/stale generation before generic handler evidence is read",
  );
});
