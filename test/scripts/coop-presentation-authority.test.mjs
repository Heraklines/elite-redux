/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("switch presentation is host-authored and the renderer never predicts its own switch", () => {
  const producer = read("src/phases/switch-summon-phase.ts");
  const replay = read("src/phases/coop-replay-turn-phase.ts");
  const replayPhases = read("src/phases/coop-replay-phases.ts");
  const animations = read("src/animations.ts");
  const rendererGate = read("src/data/elite-redux/coop/coop-renderer-gate.ts");
  const guestTurn = read("src/phases/turn-start-phase.ts");

  assert.match(producer, /recordCoopEvent\(\{\s*k:\s*"switch"/u);
  assert.match(producer, /pokemonId:\s*incoming\.id/u);
  assert.match(producer, /speciesId:\s*incomingSpeciesId/u);
  assert.match(
    replay,
    /case\s+"switch":[\s\S]+pm\.unshiftNew\("CoopSwitchReplayPhase",\s*event,\s*undefined,\s*outcomeToken\)/u,
  );
  assert.match(rendererGate, /"CoopSwitchReplayPhase"/u);
  assert.match(
    replayPhases,
    /renderType\s*!==\s*Phaser\.HEADLESS[\s\S]+addPokeballOpenParticles/u,
    "headless presentation cannot leave an orphaned particle timer after scene teardown",
  );
  assert.match(
    animations,
    /doDefaultPbOpenParticles[\s\S]+const scene = globalScene[\s\S]+const particleTimer = scene\.time\.addEvent[\s\S]+scene\.add == null[\s\S]+particleTimer\.remove\(\)/u,
    "the shared animation boundary binds its timer to one scene and retires callbacks after teardown",
  );
  assert.doesNotMatch(guestTurn, /mirrorGuestOwnSwitch|summonCoopPlayerField/u);
});

test("healing is an authority-authored presentation and every event kind is exhaustively rendered", () => {
  const pokemon = read("src/field/pokemon.ts");
  const replay = read("src/phases/coop-replay-turn-phase.ts");
  const replayPhases = read("src/phases/coop-replay-phases.ts");

  assert.match(
    pokemon,
    /public heal\([\s\S]+healAmount > 0 && isCoopRecording\(\)[\s\S]+recordCoopEvent\(\{\s*k: "hp"/u,
  );
  assert.match(replayPhases, /const healing = toHp > fromHp[\s\S]+CommonBattleAnim\(CommonAnim\.HEALTH_UP, mon\)/u);
  assert.match(replayPhases, /damageNumberHandler\.add\(mon, amount, HitResult\.HEAL, false\)/u);
  assert.match(replay, /const unhandledEvent: never = event/u);
});

test("authoritative tag recovery hydrates identity without re-entering battle mechanics", () => {
  const engine = read("src/data/elite-redux/coop/coop-battle-engine.ts");
  const start = engine.indexOf("function reconcileTags(");
  const end = engine.indexOf("\n}\n\n/**", start);
  const reconcile = engine.slice(start, end);

  assert.ok(start >= 0 && end > start, "the replica tag projector is present");
  assert.doesNotMatch(reconcile, /mon\.addTag\(/u, "recovery must not execute tag onAdd/immunity mechanics");
  assert.doesNotMatch(reconcile, /mon\.removeTag\(/u, "recovery must not execute tag onRemove mechanics");
  assert.match(reconcile, /tags\.push\(getBattlerTag\(/u, "missing authority identities are hydrated directly");
  assert.match(reconcile, /tag instanceof SubstituteTag[\s\S]+tag\.sprite\?\.active[\s\S]+tag\.sprite\.destroy\(\)/u);
});

test("sacrificial spread presentation is authored once without dropping any mechanical target", () => {
  const producer = read("src/phases/move-effect-phase.ts");
  const replayPump = read("src/phases/coop-replay-turn-phase.ts");
  const replay = read("src/phases/coop-replay-phases.ts");
  const boundaryStart = producer.indexOf("const allAnimationTargets");
  const boundaryEnd = producer.indexOf("\n    this.postAnimCallback(user, targets);", boundaryStart);
  const boundary = producer.slice(boundaryStart, boundaryEnd);

  assert.ok(boundaryStart >= 0 && boundaryEnd > boundaryStart, "the move-animation boundary is present");
  assert.match(
    boundary,
    /authoritativeCoopPresentation\s*&&\s*move\.hasAttr\("SacrificialAttr"\)[\s\S]+allAnimationTargets\.slice\(0, 1\)/u,
    "only the authoritative co-op host collapses a user-centred sacrificial spread animation",
  );
  assert.match(
    boundary,
    /recordCoopEvent\(\{[\s\S]+k:\s*"moveAnim"[\s\S]+targets:\s*targetsForAnimation\.map/u,
    "the retained event identifies exactly the visual playback targets",
  );
  assert.match(
    boundary,
    /for \(const \[targetIndex, target\] of targetsForAnimation\.entries\(\)\)[\s\S]+new MoveAnim/u,
    "the authority plays the same target set it retained",
  );
  assert.match(
    producer,
    /this\.applyToTargets\(user, targets\)/u,
    "move mechanics still apply to the complete hit-check target set",
  );
  assert.match(replayPump, /case "moveAnim":[\s\S]+\[\.\.\.event\.targets\]/u);
  assert.doesNotMatch(
    replay,
    /SacrificialAttr/u,
    "the renderer follows retained presentation and never infers move policy",
  );
});

test("the host's ordinary NewBattle tail is routed by the exact committed biome permit", () => {
  const newBattle = read("src/phases/new-battle-phase.ts");
  const battleScene = read("src/battle-scene.ts");

  assert.match(
    newBattle,
    /function routeCoopCommittedBiomeEncounterTail[\s\S]+permit\.sessionEpoch !== params\.sessionEpoch[\s\S]+permit\.wave !== params\.sourceWave[\s\S]+permit\.nextWave !== params\.destinationWave[\s\S]+permit\.destinationBiomeId !== params\.destinationBiomeId/u,
    "the replacement is fenced by exact session, adjacent wave, and destination identity",
  );
  assert.match(
    newBattle,
    /const sourceWave = globalScene\.currentBattle\?\.waveIndex \?\? -1;[\s\S]+globalScene\.newBattle\(\);[\s\S]+this\.routeCommittedHostBiomeEncounter\(sourceWave\)/u,
    "the ordinary host construction consults the permit only after the destination Battle exists",
  );
  assert.match(
    newBattle,
    /newBiomeCount !== 0 \|\| nextEncounterCount !== 1[\s\S]+removeAllPhasesOfType\("NextEncounterPhase"\)[\s\S]+pushNew\("NewBiomeEncounterPhase"\)/u,
    "only one exact ordinary tail can be replaced",
  );
  assert.match(
    battleScene,
    /const committedCoopBiomeTransition =[\s\S]+controller\?\.role === "host"[\s\S]+controller\.netcodeMode === "authoritative"[\s\S]+biomePermit\.wave === lastBattle\.waveIndex[\s\S]+biomePermit\.nextWave === this\.currentBattle\.waveIndex[\s\S]+biomePermit\.destinationBiomeId === this\.arena\.biomeId[\s\S]+const isNewBiome = committedCoopBiomeTransition \|\| this\.isNewBiome\(lastBattle\)/u,
    "the same signed permit drives host post-battle mechanics instead of only repairing presentation",
  );
});

test("damage effectiveness and critical presentation are authority-authored end to end", () => {
  const pokemon = read("src/field/pokemon.ts");
  const transport = read("src/data/elite-redux/coop/coop-transport.ts");
  const replay = read("src/phases/coop-replay-phases.ts");

  assert.match(pokemon, /presentationResult[\s\S]+result: presentationResult, critical: presentationCritical/u);
  assert.match(transport, /result\?: number;\s*critical\?: boolean/u);
  assert.match(replay, /damageNumberHandler\.add\(mon, amount, damageResult, this\.critical\)/u);
  assert.match(replay, /HitResult\.SUPER_EFFECTIVE[\s\S]+playSound\("se\/hit_strong"\)/u);
  assert.match(replay, /repeat:\s*5[\s\S]+setVisible/u);
});

test("Terastallization is authority-authored and replayed without renderer mechanics", () => {
  const producer = read("src/phases/tera-phase.ts");
  const transport = read("src/data/elite-redux/coop/coop-transport.ts");
  const replay = read("src/phases/coop-replay-phases.ts");
  const replayPump = read("src/phases/coop-replay-turn-phase.ts");

  assert.match(producer, /recordCoopEvent\(\{[\s\S]+k: "tera"[\s\S]+teraType: this\.pokemon\.getTeraType\(\)/u);
  assert.match(transport, /k: "tera";\s*bi: number;\s*pokemonId: number;\s*partySlot: number;\s*teraType: number;/u);
  const teraReplay = replay.slice(
    replay.indexOf("export class CoopTeraReplayPhase"),
    replay.indexOf("export class", replay.indexOf("export class CoopTeraReplayPhase") + 1),
  );
  assert.match(teraReplay, /CommonAnim\.TERASTALLIZE/u);
  assert.doesNotMatch(teraReplay, /isTerastallized = true/u);
  assert.match(replayPump, /case "tera":[\s\S]+"CoopTeraReplayPhase"/u);
});

test("plain common battle animations are authority-authored at enqueue and replayed by exact actor identity", () => {
  const manager = read("src/phase-manager.ts");
  const common = read("src/phases/common-anim-phase.ts");
  const transport = read("src/data/elite-redux/coop/coop-transport.ts");
  const validator = read("src/data/elite-redux/coop/coop-battle-event-validator.ts");
  const replay = read("src/phases/coop-replay-phases.ts");
  const replayPump = read("src/phases/coop-replay-turn-phase.ts");

  assert.match(
    manager,
    /phase instanceof CommonAnimPhase && phase\.phaseName === "CommonAnimPhase"[\s\S]+recordCoopPresentationAtEnqueue\(\)/u,
  );
  assert.match(common, /recordCoopEvent\(\{\s*k: "commonAnim"[\s\S]+targetActor:/u);
  assert.match(
    common,
    /this\.targetIndex === undefined \? source : globalScene\.getField\(\)\[this\.targetIndex\]/u,
    "common VFX target identity must use the canonical flat battler index (including enemy/triple self-effects)",
  );
  assert.match(common, /this\.coopPresentation != null[\s\S]+return;/u, "weather and terrain keep one richer event");
  assert.match(transport, /k: "commonAnim";[\s\S]+targetActor: CoopPresentationActorRef;/u);
  assert.match(validator, /case "commonAnim":[\s\S]+isPresentationActorRef\(event\.targetActor\)/u);
  const commonReplay = replay.slice(
    replay.indexOf("export class CoopCommonAnimReplayPhase"),
    replay.indexOf("export class", replay.indexOf("export class CoopCommonAnimReplayPhase") + 1),
  );
  assert.match(commonReplay, /exactDisplayedActor\(this\.actor\)/u);
  assert.match(commonReplay, /exactDisplayedActor\(this\.targetActor\)/u);
  assert.match(commonReplay, /new CommonBattleAnim\(this\.anim as CommonAnim, source, target\)/u);
  assert.match(replayPump, /case "commonAnim":[\s\S]+"CoopCommonAnimReplayPhase"/u);
});

test("form changes and Transform carry complete authority material into dedicated renderer phases", () => {
  const transport = read("src/data/elite-redux/coop/coop-transport.ts");
  const validator = read("src/data/elite-redux/coop/coop-battle-event-validator.ts");
  const form = read("src/phases/quiet-form-change-phase.ts");
  const transform = read("src/phases/pokemon-transform-phase.ts");
  const engine = read("src/data/elite-redux/coop/coop-battle-engine.ts");
  const replay = read("src/phases/coop-replay-phases.ts");
  const replayPump = read("src/phases/coop-replay-turn-phase.ts");

  assert.match(form, /recordCoopEvent\(\{\s*k: "formChange"[\s\S]+formIndex: pokemon\.formIndex/u);
  assert.match(form, /recordCoopMessage\(message\)/u, "direct form narration must enter the ordered stream");
  assert.match(transform, /captureCoopMonTransform\(user\)[\s\S]+k: "transform"/u);
  assert.match(transport, /interface CoopMonTransform[\s\S]+passives: number\[\]/u);
  assert.match(engine, /passives: \[\.\.\.\(sd\.passiveAbilities \?\? \[\]\)\]/u);
  assert.match(engine, /sd\.passiveAbilities = transform\.passives\.map/u);
  assert.match(validator, /case "formChange":[\s\S]+case "transform":[\s\S]+isStrictTransformResult/u);
  assert.match(replay, /export class CoopFormChangeReplayPhase[\s\S]+refreshAuthorityAppearance/u);
  assert.match(replay, /export class CoopTransformReplayPhase[\s\S]+installAuthorityTransformMaterial/u);
  assert.match(replayPump, /case "formChange":[\s\S]+"CoopFormChangeReplayPhase"/u);
  assert.match(replayPump, /case "transform":[\s\S]+"CoopTransformReplayPhase"/u);
});

test("ordinary co-op and Showdown replay every retained pre-command presentation before input", () => {
  const summon = read("src/phases/summon-phase.ts");
  const initEncounter = read("src/phases/init-encounter-phase.ts");
  const command = read("src/phases/command-phase.ts");
  const turnInit = read("src/phases/turn-init-phase.ts");
  const replay = read("src/phases/coop-replay-turn-phase.ts");
  const replayPhases = read("src/phases/coop-replay-phases.ts");
  const stream = read("src/data/elite-redux/coop/coop-battle-stream.ts");
  const runtime = read("src/data/elite-redux/coop/coop-runtime.ts");

  assert.match(
    summon,
    /if \(isAuthoritativeBattleSession\(\) && controller\?\.role === "host"\)[\s\S]+beginCoopRecording/u,
  );
  assert.doesNotMatch(summon, /isVersusSession\(\).*beginCoopRecording/u);
  assert.match(
    initEncounter,
    /isAuthoritativeBattleSession\(\) && controller\?\.role === "host"[\s\S]+beginCoopRecording/u,
  );
  assert.match(
    command,
    /else if \(controller\.role === "host"\)[\s\S]+sealCoopEntryPresentation\(\)[\s\S]+preparedCoopEntryPresentation = entryPresentation \?\? \[\][\s\S]+if \(turn !== 1\)[\s\S]+rebroadcastCoopWaveStartAuthorityAfterEntryEffects/u,
    "every command frontier seals a prefix; only turn one also publishes the legacy wave carrier",
  );
  assert.match(
    turnInit,
    /inspectCoopV2CommandPresentationRequirement\(wave, turn\)[\s\S]+commandPresentation\.kind === "awaiting-source"[\s\S]+commandPresentation\.kind === "presentation"[\s\S]+hasConsumedCommandPresentation\(commandPresentation\.operationId\)[\s\S]+"CoopReplayTurnPhase"[\s\S]+wave,[\s\S]+true,/u,
    "V2 queues a prefix consumer only while a command source is absent or its CONTROL prefix is unconsumed",
  );
  assert.match(
    turnInit,
    /pendingAuthoritativeReplacementTurn[\s\S]+inspectCoopV2CommandPresentationRequirement\(currentWave, currentTurn\)\.kind[\s\S]+=== "awaiting-replacement-carrier"[\s\S]+hasPendingCoopFaintSwitchReplacementIntent\(currentWave, currentTurn - 1\)[\s\S]+"CoopReplayTurnPhase"[\s\S]+replacementReplayTurn,[\s\S]+0,/u,
    "a known or exactly one-turn-ahead replacement uses the checkpoint-consuming replay before its carrier is buffered",
  );
  assert.doesNotMatch(turnInit, /isShowdownGuestFlipGated\(\) && globalScene\.currentBattle\.turn === 1/u);
  const entryPump = replay.slice(
    replay.indexOf("private async pumpEntryPresentation"),
    replay.indexOf("private handleAuthorityFailure"),
  );
  assert.match(entryPump, /this\.renderEvents\(events\)[\s\S]+"CoopFinalizeEntryPresentationPhase"/u);
  assert.doesNotMatch(
    entryPump,
    /this\.renderEvents\(events\)[\s\S]+streamer\.noteRenderedThrough/u,
    "queueing entry cues is not permission to advance their watermark",
  );
  assert.match(
    replayPhases,
    /class CoopFinalizeEntryPresentationPhase[\s\S]+inspectCoopPresentationOutcomes[\s\S]+noteRenderedThrough[\s\S]+noteConsumedCommandPresentation[\s\S]+this\.end\(\)/u,
    "the last queued phase must prove every outcome before command control can open",
  );
  assert.match(
    replay,
    /const sourceStateMaterial =[^;]+successor\.kind === "TURN_COMMIT"[\s\S]+successor\.kind === "INTERACTION_COMMIT"[\s\S]+successor\.kind === "REPLACEMENT_COMMIT"[\s\S]+const coveredState = material == null \? readLatestAcceptedCoopAuthoritativeBattleState\(\) : null[\s\S]+coveredState\.tick !== sourceStateMaterial\.stateTick[\s\S]+coveredState\.tick !== coopAppliedStateTick\(\)[\s\S]+authoritativeState: structuredClone\(coveredState!\)/u,
    "a non-CONTROL successor closes a speculative prefix only with its own exact accepted state image",
  );
  assert.match(
    runtime,
    /const replacement = reconstructCoopV2ReplacementCheckpoint\(entry\)[\s\S]+replacementStateMaterial: \{[\s\S]+stateTick: replacement\.checkpoint\.authoritativeState\.tick/u,
    "the runtime binds a replacement successor claim to that commit's immutable state tick",
  );
  assert.match(replay, /controlOperationId: successor\.operationId/u);
  assert.doesNotMatch(
    replay,
    /successor\.kind !== "CONTROL_COMMIT"[\s\S]+material == null[\s\S]+events: \[\][\s\S]+stateTick: coopAppliedStateTick\(\)[\s\S]+controlOperationId: successor\.operationId[\s\S]+this\.entryPresentationPrefix = prefix/u,
    "a non-CONTROL source cannot close a speculative prefix with only the mutable applied tick",
  );
  assert.match(stream, /consumedCommandPresentationOperations = new Set<string>/u);
  assert.match(
    runtime,
    /inspectCoopV2CommandPresentationRequirement[\s\S]+sourceEntryOf\(control\)[\s\S]+source\.kind === "CONTROL_COMMIT"[\s\S]+decodeControlOpenEntry\(source\)[\s\S]+kind: "covered-by-source"/u,
    "the command source distinguishes a replayable CONTROL prefix from an already-presented TURN successor",
  );
  assert.match(
    runtime,
    /control\?\.kind === "REPLACEMENT"[\s\S]+control\.wave === wave[\s\S]+control\.turn === turn \|\| control\.turn \+ 1 === turn[\s\S]+kind: "awaiting-replacement-carrier"/u,
    "a typed replacement frontier, including its exact one-turn-ahead shell, is never downgraded to a missing command source",
  );
  assert.match(
    runtime,
    /entry\.kind !== "CONTROL_COMMIT" && entry\.nextControl\.kind === "COMMAND_FRONTIER"[\s\S]+releaseCoopV2ParkedTurnBoundary\(runtime, entry\)[\s\S]+releaseCoopV2DeferredCommandStarts\(runtime, entry\.nextControl\)/u,
    "a non-CONTROL command successor releases either exact wait shape after its material applies",
  );
});

test("renderer fixtures cannot manufacture legacy wave authority", () => {
  const rendererFixture = read("test/tests/elite-redux/coop/coop-guest-renderer.test.ts");

  assert.doesNotMatch(rendererFixture, /makeCoopOperationId/u);
  assert.doesNotMatch(rendererFixture, /partner\.send\(\{\s*t:\s*"waveResolved"/u);
  assert.doesNotMatch(rendererFixture, /pendingOperation:\s*\{[\s\S]*kind:\s*"WAVE_ADVANCE"/u);
});

test("every authority event receives an ordered renderer-completion receipt in the exact-browser build", () => {
  const recorder = read("src/data/elite-redux/coop/coop-turn-recorder.ts");
  const replay = read("src/phases/coop-replay-turn-phase.ts");
  const browser = read("scripts/coop-browser-entry.ts");
  const harness = read("test/browser/coop-public-ui/public-ui-harness.mjs");

  assert.match(recorder, /stage:\s*"authority-recorded"/u);
  assert.match(recorder, /stage:\s*"renderer-completed"/u);
  assert.match(replay, /class CoopPresentationReceiptPhase[\s\S]+observeCoopRenderedPresentation/u);
  assert.match(replay, /const canonicalEvents = events[\s\S]+canonicalEvents\[eventOffset\]/u);
  assert.match(replay, /if \(hasCoopPresentationObserver\(\)\)[\s\S]+CoopPresentationReceiptPhase/u);
  assert.match(browser, /\[coop-browser:presentation-event\]/u);
  assert.match(harness, /assertPresentationLedger\(battleCursors, commandMatch/u);
  assert.match(harness, /assertPresentationLedger\(presentationCursors, commandMatch/u);
  assert.match(harness, /ordered presentation ledger diverged/u);
});

test("presentation liveness uses an exact runtime wall scheduler rather than the ambient Phaser scene clock", () => {
  const watchdog = read("src/phases/coop-presentation-watchdog.ts");
  const replayPhases = read("src/phases/coop-replay-phases.ts");
  const moveEffect = read("src/phases/move-effect-phase.ts");
  const browser = read("scripts/coop-browser-entry.ts");
  const abilityReplay = replayPhases.slice(
    replayPhases.indexOf("export class CoopShowAbilityReplayPhase"),
    replayPhases.indexOf("export class", replayPhases.indexOf("export class CoopShowAbilityReplayPhase") + 1),
  );
  const captureReplay = replayPhases.slice(
    replayPhases.indexOf("export class CoopCaptureReplayPhase"),
    replayPhases.indexOf("export class", replayPhases.indexOf("export class CoopCaptureReplayPhase") + 1),
  );

  assert.match(watchdog, /const scene = globalScene/u);
  assert.match(watchdog, /streamer\.scheduleAuthorityRetry\(callback, ms\)/u);
  assert.match(watchdog, /generation !== coopSessionGeneration\(\) \|\| getCoopBattleStreamer\(\) !== streamer/u);
  assert.match(watchdog, /DEFAULT_COOP_PRESENTATION_HARD_WALL_MS = 120_000/u);
  assert.match(
    browser,
    /const CI_COOP_PRESENTATION_HARD_WALL_MS = 18_000 \* 32;[\s\S]+setCoopPresentationHardWallMsForTest\(CI_COOP_PRESENTATION_HARD_WALL_MS\)/u,
    "the software-WebGL browser grants measured patience without changing the staging bundle",
  );
  assert.doesNotMatch(browser, /intentionally-skipped/u);
  assert.doesNotMatch(watchdog, /globalScene\.time\.delayedCall/u);
  assert.match(
    moveEffect,
    /globalScene\.gameMode\.isCoop && getCoopController\(\)\?\.netcodeMode === "authoritative"[\s\S]+watchdog = armCoopPresentationProgressWatchdog\(expireAnimations\)/u,
  );
  assert.match(
    moveEffect,
    /let animationSettled = false[\s\S]+if \(animationSettled\) \{[\s\S]+return;[\s\S]+this\.postAnimCallback\(user, targets\)/u,
  );
  assert.match(
    moveEffect,
    /try \{[\s\S]+\.play\(hitsSubstitute\[targetIndex\] \?\? false, settleAnimations\)[\s\S]+catch \(error\)[\s\S]+settleAnimations\(\)/u,
  );
  for (const [name, phase] of [
    ["ability", abilityReplay],
    ["capture", captureReplay],
  ]) {
    assert.match(phase, /armCoopPresentationProgressWatchdog/u, `${name} replay uses the runtime watchdog`);
    assert.doesNotMatch(
      phase,
      /watchdog\s*=\s*globalScene\.time\.delayedCall/u,
      `${name} replay cannot depend on a paused scene timer for liveness`,
    );
  }
});

test("an authoritative host turn commit cannot silently release without its immutable recording", () => {
  const commit = read("src/phases/coop-turn-commit-phase.ts");

  assert.match(commit, /const runtime = getCoopRuntime\(\)/u);
  assert.match(commit, /controller\.role !== "host" \|\| !isAuthoritativeBattleSession\(\)/u);
  assert.match(commit, /if \(recording\.turn < 0\) \{/u);
  assert.match(commit, /fatal\(reason\)/u);
  assert.doesNotMatch(
    commit,
    /controller == null \|\| streamer == null \|\| controller\.role !== "host" \|\| recording\.turn < 0/u,
  );
});

test("the production turn boundary is owned by a runtime mutation ledger, not a phase-name blacklist", () => {
  const manager = read("src/phase-manager.ts");
  const runtime = read("src/data/elite-redux/coop/coop-runtime.ts");
  const ledger = read("src/data/elite-redux/coop/coop-mutation-ledger.ts");
  const commit = read("src/phases/coop-turn-commit-phase.ts");

  assert.match(manager, /setCoopMutationLedger\(ledger: CoopMutationLedger \| null, required = false\)/u);
  assert.match(manager, /prepareCurrentPhaseForStart\(\)[\s\S]+ledger\.begin\(`phase:\$\{phase\.phaseName\}`\)/u);
  assert.match(
    manager,
    /if \(this\.coopMutationLedgerRequired\) \{[\s\S]+authoritative co-op phase \$\{phase\.phaseName\} has no scene-bound mutation ledger/u,
  );
  assert.match(manager, /shiftPhase\(\)[\s\S]+settleCoopMutationPhase\(this\.currentPhase\)/u);
  assert.match(runtime, /mutationLedger:\s*new CoopMutationLedger\(\)/u);
  assert.match(
    runtime,
    /phaseManager\?\.setCoopMutationLedger\?\.\([\s\S]+runtime\.mutationLedger,[\s\S]+runtime\.controller\.netcodeMode === "authoritative"/u,
  );
  assert.match(
    runtime,
    /const runtimeScene = runtimeSceneBindings\.get\(activeRuntime\)[\s\S]+runtimeScene\?\.phaseManager\?\.setCoopMutationLedger\?\.\(null\)[\s\S]+runtimeSceneBindings\.delete\(activeRuntime\)/u,
  );
  assert.match(ledger, /begin\(label: string\)[\s\S]+activeTokens\.set/u);
  assert.match(ledger, /settle:[\s\S]+activeTokens\.delete/u);
  assert.match(commit, /const mutationBefore = runtime\.mutationLedger\.snapshot\(\)/u);
  assert.match(commit, /const carrier = captureCoopAuthoritativeCarrier/u);
  assert.match(commit, /const mutationAfter = runtime\.mutationLedger\.snapshot\(\)/u);
  assert.match(commit, /mutationAfter\.generation !== mutationBefore\.generation/u);
  assert.doesNotMatch(commit, /const UNSETTLED_TURN_MUTATORS/u);
});

test("V2 replacement animation drains before its checkpoint can install", () => {
  const replay = read("src/phases/coop-replay-turn-phase.ts");
  const checkpoint = read("src/phases/coop-push-replacement-checkpoint-phase.ts");
  const switchPhase = read("src/phases/switch-phase.ts");
  const harness = read("test/tools/coop-duo-harness.ts");
  const presentationGate = replay.indexOf("hasRenderedReplacementPresentation(envelope)");
  const apply = replay.indexOf("this.applyReplacementTransaction(envelope)", presentationGate);
  assert.ok(presentationGate >= 0, "replacement replay has an exactly-once presentation gate");
  assert.ok(apply > presentationGate, "checkpoint apply occurs only after the presentation gate");
  assert.match(replay, /CoopSwitchReplayPhase[\s\S]+CoopReplayTurnPhase[\s\S]+this\.end\(\)/u);
  assert.match(checkpoint, /private readonly noSummonExpected: boolean/u);
  assert.match(checkpoint, /constructor\(noSummonExpected = false\)[\s\S]+this\.noSummonExpected = noSummonExpected/u);
  assert.match(
    checkpoint,
    /recordedPresentation == null && !this\.noSummonExpected[\s\S]+recordedPresentation \?\? \[\]/u,
  );
  assert.match(checkpoint, /host sealing intentional empty replacement presentation/u);
  assert.equal(
    [...switchPhase.matchAll(/unshiftNew\("CoopPushReplacementCheckpointPhase", true\)/gu)].length,
    2,
    "only the two explicit no-replacement paths may publish an empty presentation without a summon recorder",
  );
  assert.match(harness, /"CoopFinalizeEntryPresentationPhase"/u);
});

test("protocol 53 binds every structured presentation cue and retained Mystery market to exact mechanics", () => {
  const adapter = read("src/data/elite-redux/coop/authority-v2/adapters/faint-replacement.ts");
  const transport = read("src/data/elite-redux/coop/coop-transport.ts");
  const validator = read("src/data/elite-redux/coop/coop-battle-event-validator.ts");
  const move = read("src/phases/move-phase.ts");
  assert.match(adapter, /live authority carrier has invalid replacement presentation/u);
  assert.match(adapter, /"presentation"/u);
  assert.match(transport, /COOP_PROTOCOL_VERSION\s*=\s*"er-coop-53"/u);
  const rewardUtilities = read("src/data/mystery-encounters/utils/encounter-phase-utils.ts");
  assert.match(rewardUtilities, /export function setEncounterMarketReward/u);
  for (const [path, marketKind] of [
    ["import-bazaar-encounter.ts", "import-bazaar"],
    ["exotic-trader-encounter.ts", "exotic"],
    ["black-market-encounter.ts", "black-market"],
  ]) {
    const encounter = read(`src/data/mystery-encounters/encounters/${path}`);
    assert.match(encounter, new RegExp(`setEncounterMarketReward\\("${marketKind}"\\)`, "u"));
    assert.doesNotMatch(encounter, /\.doEncounterRewards\s*=/u);
  }
  assert.match(
    read("src/data/elite-redux/coop/authority-v2/adapters/control-open.ts"),
    /readonly entryPresentation: readonly CoopBattleEvent\[\]/u,
  );
  assert.match(transport, /actor: CoopPresentationActorRef/u);
  assert.doesNotMatch(transport, /actor\?: CoopPresentationActorRef/u);
  assert.match(validator, /event\.targetActors\.length === event\.targets\.length/u);
  assert.match(validator, /case "moveAnim"[\s\S]+event\.hitsSubstitute\.length === event\.targets\.length/u);
  assert.match(validator, /charge === undefined[\s\S]+targetCount > 0[\s\S]+targetCount === 0/u);
  assert.match(validator, /isValidChargeAnim\(charge\)/u);
  assert.match(move, /targets: targetEntries\.map\(entry => entry\.target\)/u);
  assert.match(move, /targetActors: targetEntries\.map\(entry => entry\.actor\)/u);
  assert.match(move, /animate: false/u);
  assert.match(read("src/phases/move-effect-phase.ts"), /k: "moveAnim"[\s\S]+hitsSubstitute/u);
  assert.match(read("src/phases/move-charge-phase.ts"), /k: "moveAnim"[\s\S]+chargeAnim: move\.chargeAnim/u);
  assert.match(
    read("src/phases/coop-replay-turn-phase.ts"),
    /case "moveUsed"[\s\S]+event\.animate !== false[\s\S]+case "moveAnim"/u,
  );
});

test("every co-op renderer boundary triggers the production two-browser journey", () => {
  const workflow = read(".github/workflows/coop-public-ui-journey.yml");
  for (const path of [
    "src/data/elite-redux/coop/**",
    "src/data/elite-redux/showdown/**",
    "src/field/**",
    "src/phase-manager.ts",
    "src/phases/**",
    "src/ui/**",
  ]) {
    assert.match(workflow, new RegExp(`- "${path.replaceAll("*", "\\*")}"`, "u"));
  }
});

test("production-transition fixtures use public commands and terminal teardown cannot resurrect a dead client", () => {
  const harness = read("test/tools/coop-duo-harness.ts");
  const biomeJourney = read("test/tests/elite-redux/coop/coop-transition-t2-biome.test.ts");
  const mysteryJourney = read("test/tests/elite-redux/coop/coop-transition-t2-mystery.test.ts");

  assert.match(harness, /options\.submitHostTackle[\s\S]+host selects Fight through COMMAND UI/u);
  assert.equal(
    [...harness.matchAll(/restoredRuntime != null && restoredRuntime\.localTransport\.state !== "closed"/gu)].length,
    2,
    "sync and async scope teardown restore only the newest still-live browser runtime",
  );
  assert.doesNotMatch(harness, /prev\.runtime\.localTransport\.state !== "closed"/u);
  assert.match(
    harness,
    /startGuestMeShopOwner[\s\S]+peerContextByScene\.get\(guestScene\)[\s\S]+withClient\(peerCtx, \(\) => drainLoopback\(\)\)/u,
  );
  assert.doesNotMatch(
    harness,
    /for \(const runtime of \[rig\.guestRuntime, rig\.hostRuntime\]\) \{\s*if \(runtime\.localTransport\.state === "closed"\)/u,
  );
  assert.match(biomeJourney, /submitHostTackle:\s*true/u);
  assert.doesNotMatch(biomeJourney, /game\.move\.select\(/u);
  assert.match(mysteryJourney, /submitHostTackle:\s*true/u);
  assert.doesNotMatch(mysteryJourney, /game\.move\.select\(/u);
});

test("the headless replay pump drains every immutable presentation phase used by production", () => {
  const harness = read("test/tools/coop-duo-harness.ts");
  const replayPump = read("src/phases/coop-replay-turn-phase.ts");
  const productionReplayPhases = new Set(
    [...replayPump.matchAll(/"(Coop[A-Z][A-Za-z]+ReplayPhase)"/gu)].map(match => match[1]),
  );
  assert.ok(productionReplayPhases.size > 0, "the production replay pump must expose renderer phases");
  const drainSet = harness.slice(
    harness.indexOf("export const REPLAY_DRAIN_PHASES"),
    harness.indexOf("interface ReplayPumpScene"),
  );
  for (const phaseName of productionReplayPhases) {
    assert.match(
      drainSet,
      new RegExp(`"${phaseName}"`, "u"),
      `${phaseName} must be drained before the headless harness can call a replay turn complete`,
    );
  }
});
