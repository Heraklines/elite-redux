#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile } from "node:fs/promises";

const files = [
  "public-ui-harness.mjs",
  "campaign-nav.mjs",
  "solo-classic.mjs",
  "journeys.mjs",
  "run.mjs",
  "evidence.mjs",
  "preview-server.mjs",
  "provision-accounts.mjs",
  "vite.config.mjs",
];
const forbidden = [
  /(?:^|["'])\.\.\/\.\.\/\.\.\/src\//mu,
  /applyResync/u,
  /gameData/u,
  /getCurrentPhase/u,
  /indexedDB/u,
  /localStorage\.setItem/u,
  /phaseQueue/u,
  /RTCDataChannel/u,
  /RTCPeerConnection/u,
  /WebSocket/u,
  /__coopBrowserBridge/u,
  /globalScene/u,
  /getCoopRuntime/u,
  /captureCoop/u,
  /page\.evaluateOnNewDocument/u,
  /page\.exposeFunction/u,
];

const failures = [];
const sources = new Map();
for (const file of files) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  sources.set(file, source);
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      failures.push(`${file}: forbidden private-state boundary ${pattern}`);
    }
  }
}

const harness = sources.get("public-ui-harness.mjs");
const campaignNav = sources.get("campaign-nav.mjs");
const soloClassic = sources.get("solo-classic.mjs");
const campaign = await readFile(new URL("campaign.mjs", import.meta.url), "utf8");
const evidence = sources.get("evidence.mjs");
if (
  // Optimization brief R1: launchBrowser carries the seat so each Chromium process is
  // pinned to its OWN Xvfb display (COOP_UI_DISPLAY_HOST/GUEST). Still exactly two
  // independent processes, one per seat - the boundary this rule exists to protect.
  !harness?.includes('launchBrowser(config.locales["host-seat"], "host-seat")')
  || !harness.includes('launchBrowser(config.locales["guest-seat"], "guest-seat")')
  || (harness.match(/launchBrowser\(config\.locales\["(?:host|guest)-seat"\], "(?:host|guest)-seat"\)/gu)?.length ?? 0)
    !== 2
  || !harness.includes("hostBrowser.createBrowserContext()")
  || !harness.includes("guestBrowser.createBrowserContext()")
  || !harness.includes("if (launchFailure)")
  || !harness.includes("--accept-lang=")
  || !harness.includes("browserLocale(locale)")
  || !harness.includes("Promise.allSettled(this.browsers.map(browser => browser.close()))")
) {
  failures.push(
    "public-ui-harness.mjs: both public players must own independent Chrome processes and contexts with bounded teardown",
  );
}
if (
  !soloClassic?.includes("chooseBestCampaignMove(fight.observation)")
  || !soloClassic.includes("targetId: move.optionId")
  || soloClassic.includes('surfaceId: FIGHT_SURFACE,\n    targetId: "cursor:0"')
) {
  failures.push("solo public-UI validation must select a stable visible usable move instead of a stale cursor id");
}
const evaluateCalls = harness?.match(/page\.evaluate\(/gu)?.length ?? 0;
if (evaluateCalls !== 1 || !harness?.includes("document.activeElement.blur()")) {
  failures.push(
    "public-ui-harness.mjs: page.evaluate must remain the single DOM-focus blur operation; do not inspect game state",
  );
}

const run = sources.get("run.mjs");
const preview = sources.get("preview-server.mjs");
const provision = sources.get("provision-accounts.mjs");
const viteConfig = sources.get("vite.config.mjs");
const journeyWorkflow = await readFile(
  new URL("../../../.github/workflows/coop-public-ui-journey.yml", import.meta.url),
  "utf8",
);
if (!run?.includes("startSealedPreview(config)")) {
  failures.push("run.mjs: every gameplay journey must start from a verified sealed browser artifact");
}
if (
  !preview?.includes('"--verify"')
  || !preview.includes('config.browserDist, "_redirects"')
  || !preview.includes("Location: redirected")
  || /safeStaticFile\([^,]+,\s*["']src/gu.test(preview)
) {
  failures.push(
    "preview-server.mjs: preview must verify the immutable manifest, honor pinned production asset redirects, and never mount game source",
  );
}
if (
  !harness?.includes("findSharedCommanderMatch(")
  || !harness.includes("findOwnedCommandUi(boundary.owner")
  || !harness.includes("async waitForCommanderCommandBoundaryDrivingBattlePrompts(")
  || !harness.includes("const advanceBattlePrompt = createBattlePromptAdvancer(this, cursors, {}, purpose, {")
  || !harness.includes("const POST_TURN_PROGRESS_ALLOWANCE_MS = 90_000;")
  || !harness.includes("const POST_TURN_ABSOLUTE_CEILING_MS = 900_000;")
  || !harness.includes("hardCeilingMs = POST_TURN_ABSOLUTE_CEILING_MS")
  || !harness.includes("const COMMANDER_BOUNDARY_HARD_CEILING_MS = 420_000;")
  || !harness.includes("hardCeilingMs: COMMANDER_BOUNDARY_HARD_CEILING_MS")
  || !harness.includes("return this.assertCommanderCommandBoundary(cursors, purpose, { expectedWave })")
  || (harness.match(/waitForCommanderCommandBoundaryDrivingBattlePrompts\(/gu)?.length ?? 0) < 4
  || !harness.includes("commander-generated-skip-rendezvous-proof")
  || !harness.includes("commander-rendezvous-retry-converged-proof")
  || !harness.includes("RENDEZVOUS_RECOVERY_RETRY_POINT")
  || !harness.includes("(?:terminal requested|stopped safely)")
  || !harness.includes("next-command barrier")
  || !harness.includes("assertNoFatalRecoverySince(")
  || !harness.includes("match?.[1] !== expectedPoint")
  || !harness.includes("expectedCommandAddress:")
  || !harness.includes("boundary.observation.epoch")
  || !campaign.includes("expectedCommandAddress ??")
  || !campaign.includes("currentSharedCommandAddress(clients, purpose)")
) {
  failures.push(
    "public-ui-harness.mjs: Commander must drive exact-address public prompts, prove hidden-owner rendezvous, and admit only exact-point converged retries",
  );
}
if (
  !journeyWorkflow.includes("chrome_trace:")
  || !journeyWorkflow.includes("Diagnostic opt-in for the resource-heavy Chrome CDP performance timeline")
  || !journeyWorkflow.includes("COOP_UI_CHROME_TRACE: ${{ inputs.chrome_trace && '1' || '0' }}")
) {
  failures.push(
    "coop-public-ui-journey.yml: normal two-player journeys must omit the optional CDP performance trace with an explicit diagnostic opt-in",
  );
}
if (
  !harness.includes("findActionableFirstLoginGenderSurface")
  || !harness.includes('findLastSemanticSurface(from, "option-select:SelectGenderPhase")')
  || !harness.includes('observation.uiMode !== "OPTION_SELECT"')
  || !harness.includes("!Number.isSafeInteger(observation.phaseInstance)")
  || !harness.includes("observation.phaseInstance < 2")
  || !harness.includes("actionable first-login gender option surface or TitlePhase")
) {
  failures.push(
    "public-ui-harness.mjs: first-login gender confirmation must wait for the actionable option picker instead of its preceding message",
  );
}
if (!viteConfig?.includes("SOURCE_ENTRY") || !viteConfig.includes("sourceEntryReplaced")) {
  failures.push("vite.config.mjs: exact-SHA browser build entry replacement must stay explicit and idempotent");
}
if (!provision?.includes("randomBytes") || /fetch\s*\(|["'`]\/coop\//u.test(provision)) {
  failures.push("provision-accounts.mjs: fixture setup may generate credentials but must not call any API");
}
if (
  !harness?.includes("function findOwnedCommandOrTerminal(client, from)")
  || !harness.includes("findOwnedCommandOrTerminal(this, from)")
  || !harness.includes('findLastSemanticSurface(from, "command:command")')
  || !harness.includes('semantic.observation.uiMode === "COMMAND"')
  || !harness.includes("semantic.observation.seatsWithInput?.includes(client.publicSeat)")
) {
  failures.push("public-ui-harness.mjs: command readiness must use the owned public semantic surface");
}
if (!harness?.includes("createPublicBattleProgressBudget(") || !harness.includes("event ??= findEvidence()")) {
  failures.push("public-ui-harness.mjs: command readiness must retain bounded progress and drain buffered evidence");
}
if (
  !harness?.includes("const COMMANDER_POST_TURN_PROGRESS_ALLOWANCE_MS = 150_000")
  || !harness.includes("progressAllowanceMs: COMMANDER_POST_TURN_PROGRESS_ALLOWANCE_MS")
  || !harness.includes("hardCeilingMs: COMMANDER_BOUNDARY_HARD_CEILING_MS")
  || !harness.includes("progressBudgetOptions = {}")
  || !harness.includes("createPublicBattleProgressBudget(this, from, this.config.timeoutMs, progressBudgetOptions)")
) {
  failures.push(
    "public-ui-harness.mjs: Commander post-turn waits must admit measured animation dilation under the immutable seven-minute ceiling",
  );
}
if (
  !harness?.includes('findLastSemanticSurface(from, "reward-shop")')
  || !harness.includes("semantic.observation.ready.awaitingActionInput === true")
  || !harness.includes("semantic.observation.ownerSeat === client.publicSeat")
  || !harness.includes("await owner.waitForOwnedReward(ownerCursors[owner.label])")
  || !harness.includes("findLastSemanticSurface(from)")
  || !harness.includes('semantic?.observation.surfaceId === "reward:confirm"')
  || !harness.includes('semantic.observation.uiMode === "CONFIRM"')
  || !harness.includes('semantic.observation.selectedOptionId === "yes"')
  || !harness.includes("sameAddress(semantic.observation.address, expectedAddress)")
  || !harness.includes("owner.waitForOwnedRewardConfirm(rewardConfirmCursors[owner.label]")
  || !harness.includes("watcher.waitForAddressedRewardWatcher(")
  || !harness.includes("!semantic.observation.seatsWithInput?.includes(client.publicSeat)")
  || !harness.includes("semantic.observation.ready.awaitingActionInput === false")
  || !harness.includes("this.evidence.find(SHARED_SESSION_TERMINAL, from)")
  || !harness.includes('projection: "actionable-confirmation"')
  || !harness.includes('projection: "non-actionable-shop-watcher"')
) {
  failures.push(
    "public-ui-harness.mjs: reward leave must prove the owner confirmation and addressed non-actionable watcher",
  );
}

const fixtureRegistry = await readFile(new URL("../../../src/dev-tools/registry.ts", import.meta.url), "utf8");
const starterHandler = await readFile(
  new URL("../../../src/ui/handlers/starter-select-ui-handler.ts", import.meta.url),
  "utf8",
);
const webRtcTransport = await readFile(
  new URL("../../../src/data/elite-redux/coop/coop-webrtc-transport.ts", import.meta.url),
  "utf8",
);
if (
  !fixtureRegistry.includes('env?.VITE_COOP_BROWSER_FIXTURE === "commander-skip"')
  || !fixtureRegistry.includes('env?.VITE_COOP_BROWSER_FIXTURE === "faint-replacement"')
  || !fixtureRegistry.includes('env?.VITE_COOP_BROWSER_FIXTURE === "game-over"')
  || !fixtureRegistry.includes('env?.VITE_COOP_BROWSER_FIXTURE === "showdown-battle"')
  || !fixtureRegistry.includes('get("coopfixture")')
  || !starterHandler.includes("getCoopBrowserCommanderFixtureStarters()")
  || !starterHandler.includes("getCoopBrowserFaintFixtureStarters()")
  || !starterHandler.includes("getCoopBrowserGameOverFixtureStarters()")
  || !starterHandler.includes("{ allowUncaught: true }")
) {
  failures.push("Browser gameplay checkpoints must require the exact build+URL gate at their visible setup UI");
}
if (
  !webRtcTransport.includes('env?.VITE_COOP_BROWSER_FIXTURE !== "game-over"')
  || !webRtcTransport.includes('get("coopfixture") !== "game-over"')
  || !webRtcTransport.includes('msg.envelope.pendingOperation?.kind !== "WAVE_ADVANCE"')
  || !webRtcTransport.includes('payload?.outcome === "gameOver"')
  || !webRtcTransport.includes("this.delayedGameOverFixtureAuthorities.has(fixtureAuthority)")
  || !webRtcTransport.includes("this.sendNow(msg);")
) {
  failures.push("GameOver fault injection must delay only the exact-gated retained RTC envelope");
}
const rewardConfirmOpen = harness?.indexOf("await owner.press(openConfirmKey") ?? -1;
const rewardConfirmReady = harness?.indexOf("owner.waitForOwnedRewardConfirm(rewardConfirmCursors[owner.label]") ?? -1;
const rewardConfirmAccept = harness?.indexOf("for (const [index, key] of confirmKeys.entries())") ?? -1;
const rewardTerminalApplied = harness?.indexOf("await this.assertRetainedRewardTerminal(") ?? -1;
if (
  rewardConfirmOpen < 0
  || rewardConfirmReady <= rewardConfirmOpen
  || rewardConfirmAccept <= rewardConfirmReady
  || rewardTerminalApplied <= rewardConfirmAccept
) {
  failures.push("public-ui-harness.mjs: reward confirmation must open, converge at one address, then accept");
}
if (
  !harness?.includes("reward authoritative RESULT retained")
  || !harness.includes("shop authoritative RESULT applied-before-render")
  || !harness.includes("reward op WATCHER materialize retained")
) {
  failures.push("public-ui-harness.mjs: reward leave must prove exact retained terminal application before wave 2");
}
if (!harness?.includes("createBattlePromptAdvancer(this, from") || !harness.includes("await advanceBattlePrompt()")) {
  failures.push("public-ui-harness.mjs: post-turn waits must drive readiness-proven public battle prompts");
}
if (
  !harness?.includes("driveSequentialCommandRound(")
  || !harness.includes("pending.delete(client.label)")
  || !harness.includes('record("sequential-command-proof"')
  || !harness.includes("const commandClient = values.find(")
) {
  failures.push(
    "public-ui-harness.mjs: reciprocal commands must be submitted in public owner-UI order without waiting for both surfaces",
  );
}

const browserEntry = await readFile(new URL("../../../scripts/coop-browser-entry.ts", import.meta.url), "utf8");
if (
  !browserEntry.includes("[coop-browser:commander]")
  || !browserEntry.includes("function observeCommanderBoundary(): void")
  || !browserEntry.includes("pokemon.getTag(BattlerTagType.COMMANDED)")
  || !browserEntry.includes("const commanderOwnerRole =")
  || !browserEntry.includes("runtime.controller.role === commanderOwnerRole")
  || !browserEntry.includes('phase === "TurnStartPhase" || phase === "CoopReplayTurnPhase"')
  || !browserEntry.includes("commanderCommand?.command === Command.FIGHT")
  || !browserEntry.includes("commanderCommand.move?.move === MoveId.NONE")
  || !browserEntry.includes("commanderCommand.skip === true")
  || !browserEntry.includes("commanderOwnerRole,")
  || !browserEntry.includes("stateDigest")
  || /\.addTag\(BattlerTagType\.COMMANDED|\.removeTag\(BattlerTagType\.COMMANDED/u.test(browserEntry)
) {
  failures.push("coop-browser-entry.ts: Commander observer must remain a strict read-only boundary oracle");
}
if (!browserEntry.includes("import type { Pokemon }") || browserEntry.includes("export {};")) {
  failures.push("coop-browser-entry.ts: the static Pokemon type import must be the sole top-level-await module marker");
}
if (
  !browserEntry.includes("surfaceObserverVersion: 1")
  || !browserEntry.includes("[coop-browser:binding]")
  || !browserEntry.includes("seat: runtime.controller.seat")
  || !browserEntry.includes("ui.getHandler().active")
  || !browserEntry.includes("computeMechanicalDigest(")
  || browserEntry.includes("captureCoopChecksumState")
) {
  failures.push("coop-browser-entry.ts: missing the read-only rendered-surface/address/digest observer contract");
}
if (
  !browserEntry.includes('phase === "ExpPhase"')
  || !browserEntry.includes('surfaceId: "battle:exp"')
  || !browserEntry.includes('phase === "MessagePhase"')
  || !browserEntry.includes('surfaceId: "battle:message"')
  || !browserEntry.includes("isAwaitingPromptAction")
  || !browserEntry.includes("phaseInstance: semanticSurfaceInstance")
  || !browserEntry.includes("getPromptGeneration")
) {
  failures.push("coop-browser-entry.ts: EXP prompts must expose complete actionable readiness to the public driver");
}
if (
  !browserEntry.includes('phase === "SelectTargetPhase"')
  || !browserEntry.includes('surfaceId: "command:target"')
  || !browserEntry.includes("`battle-target:${target}`")
  || !harness.includes("findOwnedActionableTargetSurface")
  || !harness.includes('"semantic-target-selection-proof"')
  || !harness.includes('"public-ui-post-turn-target"')
) {
  failures.push("target selection must remain an address-bound semantic public UI-to-relay chain");
}
if (
  !browserEntry.includes("function readFightMoveSlots(")
  || !browserEntry.includes("pokemonMove.isUsable(pokemon, false, true)[0]")
  || !browserEntry.includes("MoveCategory[move.category]")
  || !browserEntry.includes("moveSlots,")
  || /\.usePp\(|\.setCursor\(|\.handleCommand\(/u.test(browserEntry)
  || !campaignNav?.includes("function chooseBestCampaignMove(")
  || !campaignNav.includes("function driveBestCampaignMove(")
  || !campaignNav.includes('surfaceId: "command:fight"')
  || !campaign.includes("driveBestCampaignMove(client, commandPurpose")
  || !campaign.includes("policy.keys.battleKeysFromEnv")
  || !harness.includes("driveCommand(client, `${purpose}-${client.label}`, event)")
) {
  failures.push(
    "campaign battle selection must use read-only visible FIGHT metadata and public keys, with exact key overrides retained",
  );
}
if (
  !browserEntry.includes("hp: pokemon.hp")
  || !browserEntry.includes("maxHp: pokemon.getMaxHp()")
  || !campaign.includes("export function chooseRewardPartyTargetSlot(")
  || !campaign.includes('observation?.surfaceId === "reward-shop"')
  || !campaign.includes("slot.fainted === true")
  || !campaign.includes("slot.hp < slot.maxHp")
  || !campaign.includes("chooseRewardPartyTargetSlot(boundary, driver.partySlot ?? 0)")
) {
  failures.push(
    "reward targeting must derive a legal revive/healing slot from the read-only visible party and reward projections",
  );
}
if (
  evidence?.includes("/operation delivery retries exhausted/iu")
  || !evidence?.includes("\\boperation continuation EXHAUSTED\\b")
) {
  failures.push(
    "delivery retry exhaustion must remain recoverable while true operation continuation exhaustion stays fatal",
  );
}
if (
  !browserEntry.includes("[coop-browser:render-profile]")
  || !browserEntry.includes("mode === UiMode.SETTINGS")
  || !browserEntry.includes("mode === UiMode.SETTINGS_DISPLAY")
  || browserEntry.includes("instanceof SettingsUiHandler")
  || browserEntry.includes("instanceof SettingsDisplayUiHandler")
  || !browserEntry.includes("moveAnimations: globalScene.moveAnimations")
  || !browserEntry.includes("gameSpeed: globalScene.gameSpeed")
  || !browserEntry.includes('lastObservedRenderProfile = "";')
) {
  failures.push("coop-browser-entry.ts: missing the read-only visible render-profile attestation");
}
if (
  !browserEntry.includes("pokemon.status.effect === StatusEffect.TOXIC")
  || !browserEntry.includes("pokemon.status.effect === StatusEffect.SLEEP")
) {
  failures.push("coop-browser-entry.ts: status digest must ignore non-mechanical sleep/toxic constructor ephemera");
}
if (!browserEntry.includes("partyStageVectors") || !browserEntry.includes("innates, stages")) {
  failures.push("coop-browser-entry.ts: digest evidence must expose exact stage vectors beside innate ids");
}
if (
  !browserEntry.includes("semanticBattleAddress(battle)")
  || !browserEntry.includes("address: { epoch, wave, turn }")
  || !browserEntry.includes("optionHandler.config?.options")
) {
  failures.push("coop-browser-entry.ts: setup option surfaces must remain observable before Battle construction");
}
if (
  !browserEntry.includes("[coop-browser:market]")
  || !browserEntry.includes("function observeBiomeMarket(): void")
  || !browserEntry.includes('targetModel: option.type instanceof PokemonModifierType ? "party" : "direct"')
  || !browserEntry.includes('stockModel: localOwner ? "authoritative-visible" : "replica-apply-ledger"')
  || !browserEntry.includes("heldModifiers,")
  || /globalScene\.money\s*=|\.setStock\(|\.applyModifier\(/u.test(browserEntry)
) {
  failures.push("coop-browser-entry.ts: market observer must expose read-only catalog/state proof without mutation");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Public browser boundary verified across ${files.length} executable files`);
}
