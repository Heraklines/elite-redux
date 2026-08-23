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

test("enemy switch replay owns the ordinary trainer/tray grammar and retires it absolutely", () => {
  const battlePhase = read("src/phases/battle-phase.ts");
  const producer = read("src/phases/switch-summon-phase.ts");
  const summon = read("src/phases/summon-phase.ts");
  const replay = read("src/phases/coop-replay-phases.ts");
  const tray = read("src/ui/containers/pokeball-tray.ts");
  const presentation = read("src/data/elite-redux/coop/coop-field-presentation.ts");
  const enemySwitchDuo = read("test/tests/elite-redux/coop/coop-duo-enemy-switch-render.test.ts");
  const campaign = read("test/browser/coop-public-ui/campaign.mjs");
  const evidence = read("test/browser/coop-public-ui/evidence.mjs");
  const replayStart = replay.indexOf("export class CoopSwitchReplayPhase");
  const replayEnd = replay.indexOf("\n}\n\n/**\n * GUEST: render a status change", replayStart);
  const switchReplay = replay.slice(replayStart, replayEnd);
  const projectorStart = presentation.indexOf("export function projectCoopSwitchPresentationStructure");
  const projectorEnd = presentation.indexOf("\n}\n\n/**\n * Retire or settle", projectorStart) + 2;
  const structuralProjector = presentation.slice(projectorStart, projectorEnd);

  assert.match(
    battlePhase,
    /enemyTrainerSlotForSwitch[\s\S]+partneredDouble && fieldIndex > 0[\s\S]+TRAINER_PARTNER/u,
    "only a partnered double may select the second trainer; triple positions stay on the primary trainer",
  );
  assert.ok(
    [...producer.matchAll(/enemyTrainerSlotForSwitch\(/gu)].length >= 3,
    "ordinary reveal, recall narration, and send-out narration share the same format-aware resolver",
  );
  assert.doesNotMatch(producer, /fieldIndex\s*%\s*2\s*\?\s*TrainerSlot\.TRAINER_PARTNER/u);
  assert.match(
    summon,
    /trainerName[\s\S]+enemyTrainerSlotForSwitch\([\s\S]+currentBattle\.double[\s\S]+trainer\?\.isDouble\(\)/u,
    "initial trainer send-out shares the same double/triple-aware trainer attribution",
  );
  assert.doesNotMatch(summon, /fieldIndex\s*%\s*2\s*\?\s*TrainerSlot\.TRAINER_PARTNER/u);
  assert.ok(projectorStart >= 0 && projectorEnd > projectorStart, "the structural switch projector is present");
  assert.match(
    structuralProjector,
    /\[party\[request\.fieldSlot\], party\[request\.partySlot\]\][\s\S]+switchOutStatus = true[\s\S]+field\.remove[\s\S]+switchOutStatus = false[\s\S]+field\.add/u,
    "the renderer installs only the authority's exact party permutation and field membership",
  );
  assert.doesNotMatch(
    structuralProjector,
    /\.(?:leaveField|resetSummonData|fieldSetup|loadAssets)\s*\(|applyAbAttrs\s*\(|triggerPokemonFormChange\s*\(/u,
    "the renderer's structural switch projector must never re-enter battle mechanics or derive a local summon",
  );
  assert.match(
    structuralProjector,
    /incoming\.setFieldPosition\(desiredPosition, 0\)\.catch\(\(\) => undefined\)[\s\S]+scene\.updateFieldScale\(\)\.catch\(\(\) => undefined\)/u,
    "torn cosmetic seating/scale promises cannot reject after immutable switch structure is installed",
  );
  assert.doesNotMatch(
    enemySwitchDuo,
    /expect\(projection\)\.toMatchObject/u,
    "engine tests compare Phaser actor identity directly instead of recursively traversing live render trees",
  );
  assert.match(
    enemySwitchDuo,
    /expect\(projection\.incoming\)\.toBe\(incoming\)[\s\S]+expect\(projection\.outgoing\)\.toBe\(outgoing\)/u,
  );
  assert.match(switchReplay, /projectCoopSwitchPresentationStructure\(scene,[\s\S]+pokemonId:[\s\S]+speciesId:/u);
  assert.doesNotMatch(switchReplay, /summonCoop(?:Player|Enemy)Field/u);
  assert.match(
    switchReplay,
    /const scene = globalScene;[\s\S]+const runtime = getCoopRuntime\(\);[\s\S]+const generation = coopSessionGeneration\(\);/u,
  );
  assert.match(
    switchReplay,
    /presentation\.actor\.side !== expectedActorSide[\s\S]+switch-actor-side-mismatch[\s\S]+ownsEnemyTrainerPresentation = !player/u,
    "trainer/tray ownership is admitted only after the signed actor side matches the mapped battler",
  );
  assert.match(
    switchReplay,
    /runWhenCoopRuntimeActive\(runtime,[\s\S]+ownedActivations\.add\(cancel\)/u,
    "detached timers/tweens queue only under their exact runtime and retirement cancels queued activations",
  );
  assert.match(switchReplay, /for \(const cancel of ownedActivations\)[\s\S]+cancel\(\)/u);
  assert.match(
    switchReplay,
    /showEnemyTrainerPresentation\(scene, trainerSlot\);[\s\S]+pbTrayEnemy\.showPbTray\(scene\.getEnemyParty\(\), scene\)/u,
    "an enemy switch positively reveals both ordinary trainer surfaces",
  );
  assert.match(
    switchReplay,
    /const scheduleEnemyIncoming[\s\S]+schedule\(1500,[\s\S]+hideEnemyTrainerPresentation\(scene\)[\s\S]+pbTrayEnemy\.hide\(scene\)[\s\S]+projectIncoming\(\)/u,
    "the renderer preserves the authority's pre-switch delay and visible hold before trainer/tray exit",
  );
  assert.match(switchReplay, /schedule\(750, \(\) => scheduleEnemyIncoming\(\)\)/u);
  assert.match(
    switchReplay,
    /finish = \(outcome[\s\S]+timer\.remove\(false\)[\s\S]+cleanupEnemyTrainerPresentation\(\)[\s\S]+settleCoopPresentationOutcome/u,
    "cleanup and owned timer cancellation precede the presentation proof",
  );
  assert.match(
    switchReplay,
    /pokeball != null[\s\S]+scene\.tweens\.killTweensOf\(pokeball\)[\s\S]+pokeball\.destroy\(\)[\s\S]+settleCoopSwitchActorPresentation\(scene, outgoing, "hidden"\)[\s\S]+settleCoopSwitchActorPresentation\(scene, incoming,/u,
    "retirement cannot leave a ball sprite or a half-scaled incoming actor behind",
  );
  assert.match(switchReplay, /retire\(\)[\s\S]+this\.retireActiveRun\?\.\(\)/u);
  assert.match(
    switchReplay,
    /canRevealIncoming =[\s\S]+outcome\.kind !== "failed"[\s\S]+ownerIsCurrent\(\)[\s\S]+!this\.isRetired\(\)[\s\S]+settleCoopSwitchActorPresentation\(scene, incoming, canRevealIncoming \? "visible" : "hidden"\)/u,
    "failed, retired, or ownership-mismatched replay cannot positively reveal an actor",
  );
  assert.match(
    presentation,
    /settleCoopSwitchActorPresentation\([\s\S]+completeTweensOf\(infoTargets, scene\)[\s\S]+killTweensOf\(compactTargets\(pokemon, sprite, tintSprite\), scene\)[\s\S]+globalScene !== scene[\s\S]+pokemon\.showInfo\(\)/u,
    "actor cleanup owns main, tint, and info children and allows global-dependent reveal only on the exact scene",
  );
  assert.match(
    presentation,
    /completeTweensOf\(\[trainer, \.\.\.trainer\.getSprites\(\), \.\.\.trainer\.getTintSprites\(\)\], scene\);[\s\S]+killTweensOf\(\[trainer, \.\.\.trainer\.getSprites\(\), \.\.\.trainer\.getTintSprites\(\)\], scene\);[\s\S]+trainer\.setVisible\(true\)\.setAlpha\(0\)/u,
    "trainer cleanup removes the completed tween before a later Phaser update can restore alpha",
  );
  assert.match(
    switchReplay,
    /pbTrayEnemy\.settleHidden\(scene\)[\s\S]+settleCoopTrainerPresentation\("enemy", scene\)/u,
  );
  assert.match(tray, /presentationGeneration[\s\S]+generation !== this\.presentationGeneration/u);
  assert.match(tray, /settleHidden\(scene:[\s\S]+killTweensOf[\s\S]+setVisible\(false\)[\s\S]+shown = false/u);
  assert.match(presentation, /settleCoopTrainerPresentation\([\s\S]+scene: BattleScene = globalScene/u);
  assert.match(
    campaign,
    /authoritySwitches\.map\([\s\S]+eventKind: "switch"[\s\S]+epoch: switchAddress\.epoch[\s\S]+wave: switchAddress\.wave[\s\S]+turn: switchAddress\.turn[\s\S]+seq: switchAddress\.seq[\s\S]+canonicalEvent: switchAddress\.event/u,
    "real two-browser campaigns correlate every encountered switch with its exact renderer receipt",
  );
  assert.match(
    evidence,
    /findPresentationEvents\([\s\S]+epoch = null[\s\S]+wave = null[\s\S]+turn = null[\s\S]+seq = null[\s\S]+canonicalEvent = null[\s\S]+event\.observation\.epoch === epoch[\s\S]+event\.observation\.seq === seq[\s\S]+JSON\.stringify\(event\.observation\.event\) === JSON\.stringify\(canonicalEvent\)/u,
  );
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

test("a projected Mystery surface refreshes and proves its authoritative HUD wave", () => {
  const battleScene = read("src/battle-scene.ts");
  const runtime = read("src/data/elite-redux/coop/coop-runtime.ts");
  const newBiome = read("src/phases/new-biome-encounter-phase.ts");
  const observer = read("scripts/coop-browser-entry.ts");
  const evidence = read("test/browser/coop-public-ui/evidence.mjs");
  const campaign = read("test/browser/coop-public-ui/campaign.mjs");

  assert.match(
    battleScene,
    /public getDisplayedBiomeWaveIndex\(\): number \| null[\s\S]+this\.biomeWaveText\.visible[\s\S]+this\.biomeWaveText\.text/u,
    "the exact-browser observer has a read-only view of the wave players can actually see",
  );
  assert.match(
    runtime,
    /case "mystery": \{[\s\S]+globalScene\.updateBiomeWaveText\(\)[\s\S]+phaseManager\.create\(\s*"CoopReplayMePhase"/u,
    "the immutable Mystery projector refreshes cosmetics after its wave material is installed",
  );
  assert.match(
    newBiome,
    /private startGuestPresentation\(\): void \{[\s\S]+globalScene\.updateBiomeWaveText\(\);[\s\S]+globalScene\.playBgm/u,
    "the presentation-only new-biome replica refreshes its signed destination wave before rendering the encounter",
  );
  assert.match(
    observer,
    /const displayedWave = globalScene\.getDisplayedBiomeWaveIndex\(\)[\s\S]+semanticDigestKey = \[[\s\S]+displayedWave[\s\S]+const observation = \{[\s\S]+displayedWave/u,
    "a wave-label change invalidates the observer cache and enters the semantic proof",
  );
  assert.match(evidence, /nullableDisplayedWave[\s\S]+value\.displayedWave/u);
  assert.match(
    campaign,
    /authority\.displayedWave === authority\.address\.wave[\s\S]+observation\.displayedWave === observation\.address\.wave/u,
    "paired Mystery convergence rejects a stale label on either real browser",
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

test("direct common battle animations enter the same immutable presentation stream exactly once", () => {
  const helper = read("src/data/elite-redux/coop/coop-common-anim-presentation.ts");
  const battlerTags = read("src/data/battler-tags.ts");
  const arenaTags = read("src/data/arena-tag.ts");
  const postTurnStatus = read("src/phases/post-turn-status-effect-phase.ts");
  const obtainStatus = read("src/phases/obtain-status-effect-phase.ts");
  const tera = read("src/phases/tera-phase.ts");

  assert.match(
    helper,
    /recordCoopEvent\(\{\s*k: "commonAnim"[\s\S]+actor:[\s\S]+targetActor:/u,
    "the direct-call adapter must retain exact source and target identities",
  );
  assert.match(
    battlerTags,
    /recordDirectCoopCommonAnimPresentation\(CommonAnim\.PROTECT, pokemon\);\s*new CommonBattleAnim\(CommonAnim\.PROTECT, pokemon\)\.play\(\)/u,
    "single-target Protect must record immediately before its floating VFX",
  );
  assert.match(
    arenaTags,
    /recordDirectCoopCommonAnimPresentation\(CommonAnim\.PROTECT, defender\);\s*new CommonBattleAnim\(CommonAnim\.PROTECT, defender\)\.play\(\)/u,
    "team guards must record immediately before their floating VFX",
  );
  assert.match(
    postTurnStatus,
    /recordDirectCoopCommonAnimPresentation\(statusAnim, pokemon\);\s*new CommonBattleAnim\(statusAnim, pokemon\)\.play/u,
    "recurring poison, toxic, and burn ticks need a cue even though status identity did not change",
  );
  assert.doesNotMatch(
    obtainStatus,
    /recordDirectCoopCommonAnimPresentation/u,
    "status acquisition already owns one richer status event and must not double-author its animation",
  );
  assert.doesNotMatch(
    tera,
    /recordDirectCoopCommonAnimPresentation/u,
    "Terastallization already owns one richer tera event and must not double-author its animation",
  );
});

test("Substitute and Commander sprite transitions are authority-authored and outcome-gated", () => {
  const manager = read("src/phase-manager.ts");
  const producer = read("src/phases/pokemon-anim-phase.ts");
  const transport = read("src/data/elite-redux/coop/coop-transport.ts");
  const validator = read("src/data/elite-redux/coop/coop-battle-event-validator.ts");
  const replay = read("src/phases/coop-replay-turn-phase.ts");
  const sideSwap = read("src/data/elite-redux/showdown/showdown-side-swap.ts");

  assert.match(
    manager,
    /phase instanceof PokemonAnimPhase && phase\.phaseName === "PokemonAnimPhase"[\s\S]+recordCoopPresentationAtEnqueue\(\)/u,
  );
  assert.match(producer, /recordCoopEvent\(\{\s*k: "pokemonAnim"[\s\S]+actor:/u);
  assert.match(producer, /armCoopPresentationProgressWatchdog/u);
  assert.match(producer, /settleCoopPresentationOutcome\(this\.coopPresentationOutcomeToken/u);
  assert.match(
    transport,
    /k: "pokemonAnim";\s*anim: number;\s*bi: number;\s*actor: CoopPresentationActorRef;\s*companionBi: number \| null;\s*companionActor: CoopPresentationActorRef \| null;/u,
  );
  assert.match(validator, /case "pokemonAnim":[\s\S]+PokemonAnimType\.COMMANDER_REMOVE/u);
  assert.match(
    replay,
    /case "pokemonAnim":[\s\S]+exactSpriteActor\(event\.companionBi, event\.companionActor\)[\s\S]+actor\.summonData\.tags\.push\(substitute\)[\s\S]+"PokemonAnimPhase"/u,
  );
  assert.doesNotMatch(
    replay.slice(replay.indexOf('case "pokemonAnim"'), replay.indexOf('case "formChange"')),
    /actor\.addTag\(/u,
  );
  assert.match(sideSwap, /case "pokemonAnim":[\s\S]+swapBi\(event\.bi/u);
});

test("same-form Black Shiny promotion is an ordered exact-actor appearance refresh", () => {
  const producer = read("src/data/elite-redux/er-black-shinies.ts");
  const transport = read("src/data/elite-redux/coop/coop-transport.ts");
  const validator = read("src/data/elite-redux/coop/coop-battle-event-validator.ts");
  const replay = read("src/phases/coop-replay-phases.ts");
  const replayPump = read("src/phases/coop-replay-turn-phase.ts");
  const rendererGate = read("src/data/elite-redux/coop/coop-renderer-gate.ts");
  const phaseManager = read("src/phase-manager.ts");
  const harness = read("test/tools/coop-duo-harness.ts");

  assert.match(
    producer,
    /applyErBlackShinyKit\(pokemon\);[\s\S]+recordCoopEvent\(\{[\s\S]+k: "appearance"[\s\S]+erBlackShiny:[\s\S]+recordCoopEvent\(\{ k: "shinySparkle"/u,
    "the authority orders the complete appearance refresh before its direct sparkle cue",
  );
  assert.match(transport, /k: "appearance";[\s\S]+erBlackShiny: boolean/u);
  assert.match(
    validator,
    /case "appearance":[\s\S]+event\.variant <= 2[\s\S]+!event\.erBlackShiny \|\| \(event\.shiny && event\.variant === 2\)/u,
  );
  assert.match(
    replay,
    /export class CoopAppearanceReplayPhase[\s\S]+exactDisplayedActor\(actor\)[\s\S]+pokemon\.customPokemonData\.erBlackShiny = erBlackShiny[\s\S]+refreshAuthorityAppearance[\s\S]+pokemon\.initShinySparkle\(\)[\s\S]+applyErBlackShinyInterimTint/u,
    "the replica installs visual identity only, refreshes assets, and prepares the streamed sparkle",
  );
  assert.doesNotMatch(
    replay.slice(
      replay.indexOf("export class CoopAppearanceReplayPhase"),
      replay.indexOf("export class CoopTransformReplayPhase"),
    ),
    /applyErBlackShinyKit|drawDistinctFromPool|changeForm\(/u,
    "appearance replay must not re-enter gift RNG or form mechanics",
  );
  assert.match(replay, /appearance-watchdog-expired/u);
  assert.match(replayPump, /case "appearance":[\s\S]+"CoopAppearanceReplayPhase"/u);
  assert.match(rendererGate, /"CoopAppearanceReplayPhase"/u);
  assert.match(phaseManager, /CoopAppearanceReplayPhase,[\s\S]+created instanceof CoopAppearanceReplayPhase/u);
  assert.match(harness, /"CoopAppearanceReplayPhase"/u);
});

test("form changes and Transform carry complete authority material into dedicated renderer phases", () => {
  const transport = read("src/data/elite-redux/coop/coop-transport.ts");
  const validator = read("src/data/elite-redux/coop/coop-battle-event-validator.ts");
  const form = read("src/phases/quiet-form-change-phase.ts");
  const richForm = read("src/phases/form-change-phase.ts");
  const transform = read("src/phases/pokemon-transform-phase.ts");
  const engine = read("src/data/elite-redux/coop/coop-battle-engine.ts");
  const replay = read("src/phases/coop-replay-phases.ts");
  const replayPump = read("src/phases/coop-replay-turn-phase.ts");
  const rendererGate = read("src/data/elite-redux/coop/coop-renderer-gate.ts");
  const phaseManager = read("src/phase-manager.ts");
  const ui = read("src/ui/ui.ts");

  assert.match(form, /recordCoopEvent\(\{\s*k: "formChange"[\s\S]+formIndex: pokemon\.formIndex/u);
  assert.match(form, /recordCoopMessage\(message\)/u, "direct form narration must enter the ordered stream");
  assert.match(
    richForm,
    /recordCoopEvent\(\{\s*k: "formChange"[\s\S]+preFormIndex: this\.coopPreFormIndex[\s\S]+presentation: "evolution"/u,
    "ordinary player form changes must author the rich cutscene exactly where their result materializes",
  );
  assert.match(richForm, /if \(this\.coopReplay != null \|\| this\.coopPresentationRecorded\)/u);
  assert.match(
    richForm,
    /authorityPokemon\.formIndex = replay\.targetFormIndex[\s\S]+authorityPokemon\.loadAssets\(false\)[\s\S]+this\.scene\.updateFieldScale\(\)/u,
    "guest replay installs signed appearance without invoking form-change mechanics",
  );
  assert.doesNotMatch(
    richForm.slice(
      richForm.indexOf("private async installCoopReplayResult"),
      richForm.indexOf("private recordAuthoritativePresentation"),
    ),
    /authorityPokemon\.changeForm|calculateStats|updateModifiers|applyPostFormChange/u,
  );
  assert.match(transform, /captureCoopMonTransform\(user\)[\s\S]+k: "transform"/u);
  assert.match(transport, /interface CoopMonTransform[\s\S]+passives: number\[\]/u);
  assert.match(engine, /passives: \[\.\.\.\(sd\.passiveAbilities \?\? \[\]\)\]/u);
  assert.match(engine, /sd\.passiveAbilities = transform\.passives\.map/u);
  assert.match(validator, /case "formChange":[\s\S]+case "transform":[\s\S]+isStrictTransformResult/u);
  assert.match(replay, /export class CoopFormChangeReplayPhase[\s\S]+refreshAuthorityAppearance/u);
  assert.match(
    replay,
    /presentation === "evolution"[\s\S]+addPlayerPokemon\([\s\S]+create\(\s*"CoopFormChangeCutsceneReplayPhase"/u,
    "recovery-safe replay must construct its old-form visual from a detached actor through the renderer gate",
  );
  assert.match(richForm, /export class CoopFormChangeCutsceneReplayPhase extends FormChangePhase/u);
  assert.match(
    replay,
    /export class CoopFormChangeReplayPhase[\s\S]+ownerRuntime = getCoopRuntime\(\)[\s\S]+ownerStreamer = getCoopBattleStreamer\(\)[\s\S]+ownerGeneration = coopSessionGeneration\(\)/u,
    "the async wrapper captures one exact browser runtime before its asset wait",
  );
  assert.match(
    replay,
    /form-change-preimage-assets-watchdog-expired[\s\S]+\.loadAssets\(false\)[\s\S]+dispatchBound/u,
    "detached preimage loading is inside the exact-runtime presentation wall",
  );
  assert.match(
    replay,
    /public override retire\(\): void[\s\S]+clearOwnedResources\(\)[\s\S]+presentationPokemon\?\.destroy\(\)/u,
    "recovery retirement cancels the wrapper and destroys its detached preimage",
  );
  assert.match(
    richForm,
    /form-change-cutscene-watchdog-expired[\s\S]+retireCoopReplayUi\(\)[\s\S]+super\.retire\(\)[\s\S]+shiftPhase\(\)/u,
    "a terminal cutscene retires its async phase before advancing the scheduler",
  );
  assert.match(
    ui,
    /retirePresentationMode\(expectedMode: UiMode, fallbackMode: UiMode\)[\s\S]+\+\+this\.modeTransitionGeneration[\s\S]+this\.getHandler\(\)\.clear\(\)[\s\S]+this\.mode = this\.modeChain\.pop\(\) \?\? fallbackMode/u,
    "presentation retirement invalidates pending transitions and clears the exact stale overlay synchronously",
  );
  assert.match(
    richForm,
    /authorityPokemon\.loadAssets\(false\)\.then\([\s\S]+this\.dispatchBound\(\(\) => \{[\s\S]+authorityPokemon\.playAnim\(\)[\s\S]+authorityPokemon\.updateInfo\(\)[\s\S]+this\.scene\.updateFieldScale\(\)[\s\S]+this\.dispatchBound/u,
    "the rich replay re-enters its immutable runtime after both appearance awaits",
  );
  assert.match(
    richForm,
    /private dispatchBound\([\s\S]+streamer!\.scheduleAuthorityRetry\(resume, 0\)[\s\S]+runWhenCoopRuntimeActive\(runtime, resume\)/u,
    "V2 form promise tails use the captured runtime ledger; only the legacy streamer-only binding keeps its timer fallback",
  );
  assert.match(
    replay,
    /pokemon\.loadAssets\(false\)\.then\([\s\S]+dispatchBound\([\s\S]+pokemon\.playAnim\(\)[\s\S]+pokemon\.updateInfo\(\)\.then\([\s\S]+dispatchBound\(onComplete/u,
    "the field refresh re-enters its immutable runtime after load and info refresh",
  );
  assert.match(
    richForm,
    /public override retire\(\): void[\s\S]+clearOwnedResources\(\)[\s\S]+form-change-cutscene-retired/u,
    "a destructively replaced cutscene retires every callback without advancing its old queue",
  );
  assert.match(rendererGate, /"CoopFormChangeCutsceneReplayPhase"/u);
  assert.match(phaseManager, /CoopFormChangeCutsceneReplayPhase,[\s\S]+CoopFormChangeReplayPhase/u);
  assert.match(replay, /export class CoopTransformReplayPhase[\s\S]+installAuthorityTransformMaterial/u);
  assert.match(replayPump, /case "formChange":[\s\S]+"CoopFormChangeReplayPhase"/u);
  assert.match(replayPump, /case "transform":[\s\S]+"CoopTransformReplayPhase"/u);
});

test("co-op form cutscenes own and retire every nested shared animation resource", () => {
  const animations = read("src/animations.ts");
  const richForm = read("src/phases/form-change-phase.ts");

  assert.match(
    animations,
    /export class AnimationResourceScope implements AnimationResourceOwner[\s\S]+private readonly tweens = new Set<Phaser\.Tweens\.BaseTween>\(\)[\s\S]+private readonly particles = new Set<Phaser\.GameObjects\.GameObject>\(\)/u,
    "compound animation resources need one explicit lifecycle domain",
  );
  assert.match(
    animations,
    /public cancel\(\): void \{[\s\S]+this\.active = false[\s\S]+tween\.stop\(\)[\s\S]+this\.tweens\.clear\(\)[\s\S]+particle\.destroy\(\)[\s\S]+this\.particles\.clear\(\)/u,
    "retirement must synchronously stop every nested tween and destroy every particle",
  );
  assert.match(
    animations,
    /private doOwnedCycle\([\s\S]+if \(!animationOwnerActive\(owner\)\)[\s\S]+ownAnimationTween\([\s\S]+onComplete: \(\) => \{[\s\S]+!animationOwnerActive\(owner\)[\s\S]+this\.doOwnedCycle\([\s\S]+scene,[\s\S]+owner/u,
    "cycle recursion must retain the captured scene and owner and reject late completion callbacks",
  );
  assert.equal(
    animations.match(/ownAnimationParticle\(owner, scene\.add\.image/g)?.length,
    4,
    "all four particle families must register every spawned image",
  );
  assert.equal(
    animations.match(/const particleTimer = ownAnimationTween\(/g)?.length,
    4,
    "all four particle families must register their infinite counters",
  );
  assert.equal(
    animations.match(/if \(!animationOwnerActive\(owner\)\) \{\s*particle\.destroy\(\);\s*particleTimer\.remove\(\);/g)
      ?.length,
    4,
    "a late particle tick must be mechanically inert after its owner retires",
  );
  assert.match(
    richForm,
    /private readonly animationResources = new AnimationResourceScope\(\)[\s\S]+private formAnimationOwner\(\): AnimationResourceOwner \| undefined \{[\s\S]+this\.coopReplay != null \|\| this\.hasRuntimeBoundary\(\)[\s\S]+this\.animationResources/u,
    "only co-op/runtime-bound form phases opt into the new owner; ordinary play stays unchanged",
  );
  assert.match(richForm, /private clearOwnedResources\(\): void \{[\s\S]+this\.animationResources\.cancel\(\)/u);
  assert.match(richForm, /private finishCoopReplay\([\s\S]+this\.clearOwnedResources\(\)/u);
  assert.match(richForm, /private advanceOwner\([\s\S]+this\.clearOwnedResources\(\)/u);
  assert.match(richForm, /public override retire\(\): void \{[\s\S]+this\.clearOwnedResources\(\)/u);
  assert.equal(
    richForm.match(/this\.formAnimationOwner\(\)/g)?.length,
    5,
    "all five compound helper calls must share one phase lifecycle",
  );
  assert.doesNotMatch(richForm, /private readonly tweens =|this\.tweens\./u);
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
    /inspectCoopV2CommandPresentationRequirement\(wave, turn\)[\s\S]+commandPresentation\.kind === "awaiting-source"[\s\S]+commandPresentation\.kind === "presentation"[\s\S]+commandPresentation\.kind === "passive-watcher"[\s\S]+hasConsumedCommandPresentation\(commandPresentation\.operationId\)[\s\S]+"CoopReplayTurnPhase"[\s\S]+wave,[\s\S]+true,/u,
    "V2 queues a prefix consumer while a source is absent or its active/passive presentation is unconsumed",
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
    /class CoopFinalizeEntryPresentationPhase[\s\S]+inspectCoopPresentationOutcomes[\s\S]+noteRenderedThrough[\s\S]+noteConsumedCommandPresentation[\s\S]+retryCoopV2PendingAuthorityAtSafeBoundary\(\)[\s\S]+this\.end\(\)/u,
    "the last queued phase must prove every outcome before command control can open",
  );
  assert.match(
    replay,
    /const sourceStateMaterial =[^;]+successor\.kind === "TURN_COMMIT"[\s\S]+successor\.kind === "INTERACTION_COMMIT"[\s\S]+successor\.kind === "REPLACEMENT_COMMIT"[\s\S]+const coveredState = material == null \? readLatestAcceptedCoopAuthoritativeBattleState\(\) : null[\s\S]+coveredState\.tick !== sourceStateMaterial\.stateTick[\s\S]+coveredState\.tick !== coopAppliedStateTick\(\)[\s\S]+authoritativeState: structuredClone\(coveredState!\)/u,
    "a non-CONTROL successor closes a speculative prefix only with its own exact accepted state image",
  );
  assert.match(
    replay,
    /coveredState\.turn !== this\.turn && coveredState\.turn \+ 1 !== this\.turn/u,
    "a signed settled-turn image may release only its same-turn or immediate-next command watcher",
  );
  assert.match(
    runtime,
    /authoritativeState\.turn !== turn && authoritativeState\.turn \+ 1 !== turn/u,
    "retained recovery uses the same bounded source-to-command turn relation",
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
    /inspectCoopV2CommandPresentationRequirement[\s\S]+sourceEntryOf\(control\)[\s\S]+source\.kind === "CONTROL_COMMIT"[\s\S]+decodeControlOpenEntry\(source\)[\s\S]+authorityRole === "replica"[\s\S]+!runtime\.controller\.isVersusSession\(\)[\s\S]+commandTargetsOwnedBySeat\(control, runtime\.controller\.localSeatId\)\.length === 0[\s\S]+kind: "passive-watcher"[\s\S]+kind: "covered-by-source"/u,
    "the command source distinguishes replayable CONTROL, passive spectator, and locally proved successors",
  );
  assert.match(
    runtime,
    /readRetainedCoopV2CommandEntryPresentation[\s\S]+isMaterialApplied\(control\)[\s\S]+source\.kind === "TURN_COMMIT"[\s\S]+reconstructCoopV2TurnResolution[\s\S]+source\.kind === "REPLACEMENT_COMMIT"[\s\S]+reconstructCoopV2ReplacementCheckpoint[\s\S]+source\.kind === "INTERACTION_COMMIT"[\s\S]+decodeCoopV2InteractionEnvelope[\s\S]+authoritativeState\.wave !== wave[\s\S]+events: \[\][\s\S]+controlOperationId: source\.operationId/u,
    "a late passive watcher recovers only its materially applied immutable source state",
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
  assert.match(
    runtime,
    /claim\.addressedByCurrent[\s\S]+isMaterialApplied\(current\)[\s\S]+inspectCoopV2CommandPresentationRequirement\(state\.wave, state\.turn, runtime\)[\s\S]+presentation\.kind === "presentation"[\s\S]+presentation\.kind === "passive-watcher"[\s\S]+!runtime\.battleStream\.hasConsumedCommandPresentation\(presentation\.operationId\)[\s\S]+return "presentation-required"[\s\S]+return "ready"/u,
    "a TurnInit-bypassing command cannot become actionable before its active or passive prefix is receipted",
  );
  assert.match(
    command,
    /boundary === "presentation-required"[\s\S]+phaseManager\.create\([\s\S]+"CoopReplayTurnPhase"[\s\S]+battle\.waveIndex,[\s\S]+true,[\s\S]+replaceWithCoopAuthoritativePhase\(this, replay\)[\s\S]+return;/u,
    "the TurnInit-bypassing CommandPhase atomically projects the ordinary presentation-only replay",
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
  const campaign = read("test/browser/coop-public-ui/campaign.mjs");
  const evidence = read("test/browser/coop-public-ui/evidence.mjs");

  assert.match(recorder, /stage:\s*"authority-recorded"/u);
  assert.match(recorder, /stage:\s*"renderer-completed"/u);
  assert.match(replay, /class CoopPresentationReceiptPhase[\s\S]+observeCoopRenderedPresentation/u);
  assert.match(replay, /const canonicalEvents = events[\s\S]+canonicalEvents\[eventOffset\]/u);
  assert.match(replay, /if \(hasCoopPresentationObserver\(\)\)[\s\S]+CoopPresentationReceiptPhase/u);
  assert.match(browser, /\[coop-browser:presentation-event\]/u);
  assert.match(harness, /assertPresentationLedger\(battleCursors, commandMatch/u);
  assert.match(harness, /assertPresentationLedger\(presentationCursors, commandMatch/u);
  assert.match(harness, /ordered presentation ledger diverged/u);
  assert.match(
    browser,
    /observation\.event\.k === "switch"[\s\S]+requestAnimationFrame\(\(\) =>[\s\S]+requestAnimationFrame\(\(\) =>[\s\S]+trainerPresented[\s\S]+console\.error\(line\)/u,
    "switch cleanup is inspected after real renderer updates and a leaked trainer is fatal",
  );
  assert.match(evidence, /trainerPostconditionView[\s\S]+browser-trainer-postcondition/u);
  assert.match(
    campaign,
    /findTrainerPostcondition\(\{[\s\S]+canonicalEvent: switchAddress\.event[\s\S]+trainerPresented/u,
    "campaign proof correlates the delayed trainer verdict to the exact authority switch",
  );
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
  assert.match(watchdog, /COOP_PRESENTATION_STALL_MS = 30_000/u);
  assert.match(watchdog, /let lastProgressAt = startedAt/u);
  assert.match(
    watchdog,
    /if \(frame > lastFrame\) \{[\s\S]+lastProgressAt = sampledAt;[\s\S]+sampledAt - lastProgressAt >= stallMs/u,
    "one throttled five-second sample cannot permanently fail a presentation that later resumes",
  );
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
  assert.match(
    manager,
    /shiftPhase\(completingPhase\?: Phase\)[\s\S]+if \(completingPhase != null && completingPhase !== this\.currentPhase\)[\s\S]+return;[\s\S]+settleCoopMutationPhase\(this\.currentPhase\)/u,
    "a stale asynchronous predecessor completion returns before it can settle or shift the authoritative modal",
  );
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

test("detached battle launchers advance only the phase captured before asynchronous construction", () => {
  const starter = read("src/phases/select-starter-phase.ts");
  const classic = read("test/helpers/classic-mode-helper.ts");
  const challenge = read("test/helpers/challenge-mode-helper.ts");
  const manager = read("test/framework/game-manager.ts");
  const devTools = read("src/dev-tools.ts");

  assert.match(
    starter,
    /initBattleFromCurrentPhase\([\s\S]+const completingPhaseManager = globalScene\.phaseManager[\s\S]+const completingPhase = completingPhaseManager\.getCurrentPhase\(\)[\s\S]+this\.initBattle\([\s\S]+completingPhase,[\s\S]+completingPhaseManager/u,
  );
  assert.match(starter, /completingPhase: Phase = this/u);
  assert.match(starter, /completingPhaseManager = globalScene\.phaseManager/u);
  assert.match(
    starter,
    /if \(completingPhase === this\) \{[\s\S]+this\.end\(\)[\s\S]+\} else \{[\s\S]+completingPhaseManager\.shiftPhase\(completingPhase\)/u,
  );
  for (const [name, launcher] of [
    ["classic helper", classic],
    ["challenge helper", challenge],
    ["game manager", manager],
    ["developer tools", devTools],
  ]) {
    assert.match(launcher, /initBattleFromCurrentPhase\(/u, `${name} uses the identity-safe detached entrypoint`);
  }
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
  assert.match(
    checkpoint,
    /constructor\(\s*noSummonExpected = false,[\s\S]+this\.noSummonExpected = noSummonExpected/u,
  );
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
  assert.match(
    switchPhase,
    /const battleLegalParty = globalScene\.getPokemonAllowedInBattle\(\);[\s\S]+const v2HalfWipeNeedsNullReplacement =[\s\S]+battleLegalParty\.length > 0[\s\S]+isCoopV2ReplacementCutoverActive\(\)[\s\S]+!v2HalfWipeNeedsNullReplacement[\s\S]+battleLegalParty\.every\(p => p\.isOnField\(\)\)/u,
    "one surviving partner already on field cannot bypass the ordered V2 null-replacement result",
  );
  assert.match(harness, /"CoopFinalizeEntryPresentationPhase"/u);
});

test("protocol 62 binds every structured presentation cue and authenticated rejoin generation to exact mechanics", () => {
  const adapter = read("src/data/elite-redux/coop/authority-v2/adapters/faint-replacement.ts");
  const transport = read("src/data/elite-redux/coop/coop-transport.ts");
  const validator = read("src/data/elite-redux/coop/coop-battle-event-validator.ts");
  const move = read("src/phases/move-phase.ts");
  assert.match(adapter, /live authority carrier has invalid replacement presentation/u);
  assert.match(adapter, /"presentation"/u);
  assert.match(transport, /COOP_PROTOCOL_VERSION\s*=\s*"er-coop-62"/u);
  assert.match(transport, /connectionGeneration: number/u);
  assert.match(transport, /k: "formChange";[\s\S]+preFormIndex: number;[\s\S]+presentation: "field" \| "evolution";/u);
  assert.match(
    validator,
    /case "formChange":[\s\S]+isSafeAddressPart\(event\.preFormIndex\)[\s\S]+event\.preFormIndex !== event\.formIndex[\s\S]+event\.presentation === "field" \|\| \(event\.presentation === "evolution" && event\.animate\)/u,
  );
  assert.match(transport, /presentation\?: "off-field"/u);
  assert.match(validator, /event\.presentation === undefined \|\| event\.presentation === "off-field"/u);
  assert.match(read("src/field/pokemon.ts"), /this\.isOnField\(\) \? \{\} : \{ presentation: "off-field" as const \}/u);
  assert.match(
    transport,
    /interface CoopFullMonSnapshot[\s\S]+tags: string\[\]/u,
    "full snapshots expose the runtime BattlerTagType string identities without an unsafe numeric adapter",
  );
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
  const capture = read("src/phases/attempt-capture-phase.ts");
  assert.match(
    capture,
    /failCatch\(shakeCount: number, isCritical: boolean\)[\s\S]+recordCoopEvent\(\{[\s\S]+k: "captureAttempt"[\s\S]+outcome: "escaped"/u,
    "a failed throw is an ordered authority event instead of a host-only animation",
  );
  assert.match(
    capture,
    /const captureEventRecorded =[\s\S]+k: "captureAttempt"[\s\S]+outcome: addStatus\.value \? "caught" : "caughtButChallenge"[\s\S]+addStatus\.value && !captureEventRecorded/u,
    "every successful result is retained before the old post-checkpoint carrier can act as fallback",
  );
  assert.match(
    read("src/phases/coop-replay-turn-phase.ts"),
    /case "moveUsed"[\s\S]+event\.animate !== false[\s\S]+case "moveAnim"/u,
  );
  assert.match(
    read("src/phases/coop-replay-turn-phase.ts"),
    /case "captureAttempt":[\s\S]+createCoopPresentationOutcomeToken\(\)[\s\S]+unshiftNew\("CoopCaptureReplayPhase", event, outcomeToken\)/u,
    "the exact attempt owns an outcome-gated pre-checkpoint renderer phase",
  );
  assert.match(
    read("src/phases/shiny-sparkle-phase.ts"),
    /recordCoopEvent\(\{[\s\S]+k: "shinySparkle"[\s\S]+pokemonId: pokemon\.id/u,
    "shiny sparkle records stable actor identity at the observed host presentation boundary",
  );
  assert.match(
    read("src/phases/encounter-phase.ts"),
    /beginCoopRecording\([\s\S]+enemyPokemon\.isShiny\(true\) && !authoritativeGuest/u,
    "encounter sparkles enter the retained prefix and the renderer cannot also derive a duplicate",
  );
  const waveAdapter = read("src/data/elite-redux/coop/authority-v2/adapters/wave-terminal.ts");
  const runtime = read("src/data/elite-redux/coop/coop-runtime.ts");
  const victory = read("src/phases/victory-phase.ts");
  const exp = read("src/phases/exp-phase.ts");
  const partyExp = read("src/phases/show-party-exp-bar-phase.ts");
  const levelUp = read("src/phases/level-up-phase.ts");
  const evolution = read("src/phases/evolution-phase.ts");
  const progressionReplay = read("src/phases/coop-wave-progression-replay-phase.ts");
  const animations = read("src/animations.ts");
  const battleEngine = read("src/data/elite-redux/coop/coop-battle-engine.ts");
  const meTerminalValidator = read("src/data/elite-redux/coop/coop-me-terminal-validator.ts");
  const meOperation = read("src/data/elite-redux/coop/coop-me-operation.ts");
  assert.match(waveAdapter, /readonly progression: readonly CoopWaveProgressionPresentationV2\[\]/u);
  assert.match(waveAdapter, /carrier\.progression\.every\(isValidWaveProgressionPresentation\)/u);
  assert.match(victory, /beginCoopWaveProgressionCapture\(globalScene\.currentBattle\.waveIndex\)/u);
  assert.match(exp, /recordCoopWaveProgressionPresentation\(\{[\s\S]+display: "field"/u);
  assert.match(partyExp, /recordCoopWaveProgressionPresentation\(\{[\s\S]+display: "party"/u);
  assert.match(levelUp, /recordCoopWaveProgressionPresentation\(\{[\s\S]+k: "levelUp"/u);
  assert.match(
    evolution,
    /const presentation = \{[\s\S]+k: "evolution"[\s\S]+prePokemon:[\s\S]+postPokemon:[\s\S]+as const satisfies Extract<CoopWaveProgressionPresentationV2/u,
    "evolution captures one complete immutable presentation result before either consumer can act",
  );
  assert.match(
    evolution,
    /recordCoopWaveProgressionPresentation\(presentation, this\.coopOwningRuntime\);[\s\S]+this\.coopSettleRewardEvolution\([\s\S]+presentation,/u,
    "the presentation recorder and retained interaction settlement consume the same typed result",
  );
  assert.match(runtime, /progression,[\s\S]+commitHostWave/u);
  const replayGate = runtime.indexOf("if (!transaction.progressionReady)");
  const stateApply = runtime.indexOf("applyCoopAuthoritativeBattleState(immutableState, true)", replayGate);
  assert.ok(replayGate >= 0 && stateApply > replayGate, "retained progression drains before wave DATA applies");
  assert.match(battleEngine, /captureCoopMeOutcome\([\s\S]+progression[\s\S]+structuredClone\(progression\)/u);
  assert.match(meTerminalValidator, /value\.progression\.every\(isValidWaveProgressionPresentation\)/u);
  assert.match(runtime, /outcome: captureCoopMeOutcome\(progression\)/u);
  assert.match(
    meOperation,
    /authoritativeState: _crossingState, progression: _oneShotPresentation/u,
    "a final Mystery leave can reuse settled mechanics without replaying its battle progression twice",
  );
  const meReplayGate = runtime.indexOf("prepareCoopV2MeProgressionPresentation(runtime, entry, material.envelope)");
  const interactionStateApply = runtime.indexOf("applyCoopAuthoritativeBattleState", meReplayGate);
  assert.ok(
    meReplayGate >= 0 && interactionStateApply > meReplayGate,
    "embedded Mystery progression drains before ME terminal DATA applies",
  );
  assert.match(progressionReplay, /PROGRESSION_STEP_WATCHDOG_MS/u);
  assert.match(
    progressionReplay,
    /shiftPhaseThroughCoopAuthorityCommit\(this,[\s\S]*this\.onComplete\(!this\.presentationFailed\)/u,
    "retained presentation completion retries V2 after selecting, but before starting, the local successor",
  );
  assert.match(
    waveAdapter,
    /readonly prePokemon: Readonly<Record<string, unknown>>;[\s\S]+readonly postPokemon: Readonly<Record<string, unknown>>;/u,
    "an evolution commit retains complete immutable before and after Pokemon images",
  );
  assert.match(
    progressionReplay,
    /liveMatchesPreImage[\s\S]+liveMatchesPostImage[\s\S]+new PokemonData\(event\.prePokemon\)\.toPokemon[\s\S]+new PokemonData\(event\.postPokemon\)\.toPokemon[\s\S]+new CoopEvolutionPresentation\(before, evolved\)\.play\(signal, heartbeat\)/u,
    "the guest evolution cutscene validates the live replica but renders only immutable before/after material",
  );
  assert.match(
    evolution,
    /this\.coopPreEvolutionPokemon = JSON\.parse\(JSON\.stringify\(new PokemonData\(pokemon\)\)\)[\s\S]+prePokemon: this\.coopPreEvolutionPokemon[\s\S]+postPokemon: JSON\.parse\(JSON\.stringify\(new PokemonData\(this\.pokemon\)\)\)/u,
    "each evolution retains its own complete intermediate pre/post images rather than borrowing live wave state",
  );
  assert.match(
    progressionReplay,
    /controller\.abort\(\)[\s\S]+await render\(controller\.signal, armWatchdog\)/u,
    "the evolution watchdog cancels and then joins its renderer instead of releasing DATA from Promise.race",
  );
  assert.match(
    progressionReplay,
    /let lastProgressStage = "start"[\s\S]+const armWatchdog = \(stage: string\)[\s\S]+clearTimeout\(timeout\)[\s\S]+lastProgressStage = stage[\s\S]+timeout = setTimeout/u,
    "the evolution watchdog is rolling: every completed renderer stage renews the liveness lease",
  );
  assert.match(
    progressionReplay,
    /await this\.awaitExternal\(Promise\.all\([\s\S]+heartbeat\("assets-loaded"\)[\s\S]+heartbeat\("mode-ready"\)[\s\S]+heartbeat\("cycle-complete"\)[\s\S]+heartbeat\("completion-text"\)/u,
    "slow real-browser evolution reports progress across assets, UI transition, animation cycle, and final text",
  );
  assert.match(
    animations,
    /public doCycle\([\s\S]+onCycleComplete\?: \(cycle: number\) => void[\s\S]+this\.doOwnedCycle\([\s\S]+onCycleComplete/u,
    "the public morph animation carries an optional progress callback into its owned recursive implementation",
  );
  assert.match(
    animations,
    /onCycleComplete\?\.\(currentCycle\)[\s\S]+this\.doOwnedCycle\([\s\S]+onCycleComplete/u,
    "every completed morph tween reports progress and carries the callback into the next recursive cycle",
  );
  assert.match(
    progressionReplay,
    /doCycle\(\s*1,\s*15,[\s\S]+this\.cycleCancelled,[\s\S]+undefined,[\s\S]+cycle => heartbeat\(`cycle-\$\{cycle\}`\)/u,
    "the retained evolution renderer renews its watchdog after each real morph cycle",
  );
  assert.match(
    progressionReplay,
    /menu:evolving[\s\S]+callbackDelay: 1000,[\s\S]+prompt: false[\s\S]+heartbeat\("intro-text"\)/u,
    "the retained evolution intro follows native presentation and advances without invented human input",
  );
  assert.match(
    progressionReplay,
    /menu:evolutionDone[\s\S]+callbackDelay: null,[\s\S]+prompt: true,[\s\S]+promptDelay: 4000[\s\S]+heartbeat\("completion-text"\)/u,
    "only the retained evolution completion line exposes the native delayed human prompt",
  );
  assert.match(
    progressionReplay,
    /globalScene\.ui\.showText\(text, null, resolve, callbackDelay, prompt, promptDelay\)/u,
    "the cancellable renderer preserves the UI handler's callback and prompt-delay semantics",
  );
  assert.match(
    progressionReplay,
    /cycleCancelled\.value = true[\s\S]+for \(const cancel of \[\.\.\.this\.cancellationHooks\]\)/u,
    "a cancelled evolution stops its recursive animation and every owned callback",
  );
  assert.match(
    progressionReplay,
    /const cleanupTimeout = setTimeout\(resolve, EVOLUTION_CLEANUP_WATCHDOG_MS\)[\s\S]+clearTimeout\(cleanupTimeout\)/u,
    "a damaged UI cannot turn evolution cleanup itself into an unbounded wave wait",
  );
  assert.doesNotMatch(
    progressionReplay,
    /this\.end\(\);[\s\S]+this\.onComplete\(\)/u,
    "retained completion cannot start a local successor before the V2 completion callback projects control",
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
  assert.match(
    harness,
    /const rendererCtx = peerCtx == null \? undefined : peerContextByScene\.get\(peerCtx\.scene\)[\s\S]+await inRenderer\(async \(\) => \{[\s\S]+cur\.start\(\);[\s\S]+await drainLoopback\(\)/u,
    "every async replay phase resume is pinned to the renderer browser before it can end a phase queue",
  );
});
