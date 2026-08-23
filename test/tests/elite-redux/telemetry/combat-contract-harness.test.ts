/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { modifierTypes } from "#data/data-lists";
import { captureCommittedCombatDecision } from "#data/elite-redux/ai/combat-committed-action";
import {
  enumerateErCombatCandidates,
  snapshotErCombatJointActions,
  snapshotErCombatObservation,
} from "#data/elite-redux/ai/combat-engine-adapter";
import { snapshotBattleState } from "#data/elite-redux/telemetry/telemetry-state";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpeciesForm } from "#utils/pokemon-utils";
import { gzipSync } from "node:zlib";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("combat contract live harness", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .startingLevel(50)
      .enemyLevel(50)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .moveset(MoveId.GROWL)
      .enemyMoveset(MoveId.GROWL)
      .enemySpecies(SpeciesId.MAGIKARP);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function captureGrowl(format: "single" | "double" | "triple", party: SpeciesId[]) {
    game.override.battleStyle(format);
    if (party.length === 1) {
      await game.classicMode.startBattle(party[0]!);
    } else if (party.length === 2) {
      await game.classicMode.startBattle(party[0]!, party[1]!);
    } else {
      await game.classicMode.startBattle(party[0]!, party[1]!, party[2]!);
    }
    const observation = snapshotErCombatObservation(game.scene);
    const candidates = enumerateErCombatCandidates(game.scene, 0);
    for (let slot = 0; slot < game.scene.getPlayerField().length; slot++) {
      game.move.select(MoveId.GROWL, slot);
    }
    await game.phaseInterceptor.to("EnemyCommandPhase", false);
    return captureCommittedCombatDecision({
      scene: game.scene,
      perspective: "player",
      actorSlot: 0,
      jointActionId: `live:${format}:1`,
      observation,
      candidates,
      policySource: "human-v1",
      policyTarget: true,
      buildSha: "harness",
      dexHash: "harness",
      dictionaryHash: "harness",
      episodeId: `live:${format}`,
    });
  }

  it.each([
    ["single", [SpeciesId.CHARIZARD]],
    ["double", [SpeciesId.CHARIZARD, SpeciesId.PIKACHU]],
    ["triple", [SpeciesId.CHARIZARD, SpeciesId.PIKACHU, SpeciesId.EEVEE]],
  ] as const)("maps a real committed %s command to exactly one legal candidate", async (format, party) => {
    const captured = await captureGrowl(format, [...party]);
    expect(captured).not.toBeNull();
    expect(captured?.record.chosenCandidateId).toBe(captured?.chosen.id);
    expect(captured?.record.candidates.filter(candidate => candidate.id === captured.chosen.id)).toHaveLength(1);
    expect(captured?.record.observation.selfParty.filter(mon => mon.activeSlot != null)).toHaveLength(party.length);
  });

  it("represents a Mega as ordinary form identity with no Mega action state", async () => {
    game.override.battleStyle("single");
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const charizard = game.scene.getPlayerField()[0];
    charizard.formIndex = 1;
    const observation = snapshotErCombatObservation(game.scene);
    const self = observation.selfParty.find(mon => mon.entityId === charizard.id);

    expect(self?.form).toBe(1);
    expect(self?.originalForm).toBe(1);
    expect(self?.transformation.formTransition).toBeNull();
    expect(JSON.stringify(self?.transformation).toLowerCase()).not.toContain("mega");
    expect(
      enumerateErCombatCandidates(game.scene, 0).some(candidate => candidate.id.toLowerCase().includes("mega")),
    ).toBe(false);
  });

  it("measures the real contract capture and payload cost against schema v1", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    game.move.select(MoveId.GROWL, 0);
    await game.phaseInterceptor.to("EnemyCommandPhase", false);

    const preparationSamples: number[] = [];
    let observation = snapshotErCombatObservation(game.scene);
    let candidates = enumerateErCombatCandidates(game.scene, 0);
    for (let sample = 0; sample < 10; sample++) {
      const started = performance.now();
      observation = snapshotErCombatObservation(game.scene);
      candidates = enumerateErCombatCandidates(game.scene, 0);
      preparationSamples.push(performance.now() - started);
    }

    const commitSamples: number[] = [];
    let record: ReturnType<typeof captureCommittedCombatDecision> = null;
    for (let sample = 0; sample < 10; sample++) {
      const started = performance.now();
      record = captureCommittedCombatDecision({
        scene: game.scene,
        perspective: "player",
        actorSlot: 0,
        jointActionId: "live:benchmark:1",
        observation,
        candidates,
        policySource: "human-v1",
        policyTarget: true,
        buildSha: "harness",
        dexHash: "harness",
        dictionaryHash: "harness",
        episodeId: "live:benchmark",
      });
      commitSamples.push(performance.now() - started);
    }
    expect(record).not.toBeNull();
    const contractJson = JSON.stringify(record!.record);
    const battle = game.scene.currentBattle;
    const legacyJson = JSON.stringify({
      kind: "battle_decision",
      t: 0,
      wave: battle.waveIndex,
      actor: "self",
      slotFieldIndex: 0,
      state: snapshotBattleState(game.scene.getPlayerField(), game.scene.getEnemyField(), {
        wave: battle.waveIndex,
        biome: game.scene.arena.biomeId,
        turn: battle.turn,
        weather: game.scene.arena.weather?.weatherType ?? null,
        terrain: game.scene.arena.terrain?.terrainType ?? null,
      }),
      action: { kind: "move", moveIndex: 0, moveId: MoveId.GROWL },
    });
    const serializationStarted = performance.now();
    for (let iteration = 0; iteration < 100; iteration++) {
      JSON.stringify(record!.record);
    }
    const serializationMsPerDecision = (performance.now() - serializationStarted) / 100;
    preparationSamples.sort((left, right) => left - right);
    commitSamples.sort((left, right) => left - right);
    const report = {
      preparationMedianMs: preparationSamples[Math.floor(preparationSamples.length / 2)],
      preparedCommitMedianMs: commitSamples[Math.floor(commitSamples.length / 2)],
      serializationMsPerDecision,
      legacyBytes: Buffer.byteLength(legacyJson),
      contractBytes: Buffer.byteLength(contractJson),
      legacyGzipBytes: gzipSync(legacyJson).byteLength,
      contractGzipBytes: gzipSync(contractJson).byteLength,
    };
    console.log(`[combat-telemetry-benchmark] ${JSON.stringify(report)}`);
    expect(contractJson).not.toMatch(/"(?:username|email|saveBlob|dialogue|chat|freeFormText)"/iu);
    expect(Object.values(report).every(Number.isFinite)).toBe(true);
    expect(report.preparationMedianMs).toBeLessThan(250);
    expect(report.preparedCommitMedianMs).toBeLessThan(10);
  });

  it.each([
    ["single", [SpeciesId.CHARIZARD]],
    ["double", [SpeciesId.CHARIZARD, SpeciesId.PIKACHU]],
    ["triple", [SpeciesId.CHARIZARD, SpeciesId.PIKACHU, SpeciesId.EEVEE]],
  ] as const)("profiles the complete damaging-candidate preparation for a %s field", async (format, party) => {
    game.override.startingWave(2).battleStyle(format).moveset(MoveId.TACKLE).enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(...party);

    expect(game.scene.getPlayerField()).toHaveLength(party.length);
    expect(game.scene.getEnemyField()).toHaveLength(party.length);

    const samples: number[] = [];
    let candidateCount = 0;
    for (let sample = 0; sample < 5; sample++) {
      const started = performance.now();
      // Production now shares this immutable pre-turn observation across every
      // active actor while retaining actor-specific candidate enumeration.
      snapshotErCombatObservation(game.scene);
      candidateCount = 0;
      for (let actorSlot = 0; actorSlot < party.length; actorSlot++) {
        candidateCount += enumerateErCombatCandidates(game.scene, actorSlot).length;
      }
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    const report = {
      format,
      activeSlots: party.length,
      candidateCount,
      preparationMedianMs: samples[Math.floor(samples.length / 2)],
    };
    console.log(`[combat-telemetry-multibattle-benchmark] ${JSON.stringify(report)}`);
    expect(candidateCount).toBeGreaterThanOrEqual(party.length);
    expect(report.preparationMedianMs).toBeLessThan(1_000);
  });

  it("maps the real Baton switch flag without calling a chooser", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARIZARD, SpeciesId.PIKACHU);
    const actor = game.scene.getPlayerField()[0];
    expect(
      enumerateErCombatCandidates(game.scene, 0).some(
        candidate => candidate.kind === "switch" && candidate.partyIndex === 1 && candidate.transfer === "normal",
      ),
    ).toBe(true);
    actor.addTag(BattlerTagType.TRAPPED, 2, MoveId.MEAN_LOOK, game.scene.getEnemyField()[0].id);
    expect(
      enumerateErCombatCandidates(game.scene, 0).some(
        candidate => candidate.kind === "switch" && candidate.transfer === "normal",
      ),
    ).toBe(false);
    actor.removeTag(BattlerTagType.TRAPPED);
    await game.scene.addModifier(modifierTypes.BATON().withIdFromFunc(modifierTypes.BATON).newModifier(actor));
    const observation = snapshotErCombatObservation(game.scene);
    const candidates = enumerateErCombatCandidates(game.scene, 0);
    const phase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
    expect(phase.handleCommand(Command.POKEMON, 1, true)).toBe(true);

    const captured = captureCommittedCombatDecision({
      scene: game.scene,
      perspective: "player",
      actorSlot: 0,
      jointActionId: "live:baton:1",
      observation,
      candidates,
      policySource: "human-v1",
      policyTarget: true,
      buildSha: "harness",
      dexHash: "harness",
      dictionaryHash: "harness",
      episodeId: "live:baton",
    });
    expect(captured?.chosen).toMatchObject({ kind: "switch", partyIndex: 1, transfer: "baton" });
  });

  it("populates typing, reveal, restrictions, items, field, relic and boss state from the live engine", async () => {
    game.override.moveset([MoveId.TACKLE, MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.CHARIZARD, SpeciesId.PIKACHU);
    const player = game.scene.getPlayerField()[0];
    const enemy = game.scene.getEnemyField()[0];

    player.pushMoveHistory({ move: MoveId.TACKLE, targets: [enemy.getBattlerIndex()], useMode: MoveUseMode.NORMAL });
    player.addTag(BattlerTagType.DISABLED, 4, MoveId.DISABLE, enemy.id);
    player.addTag(BattlerTagType.ENCORE, 4, MoveId.ENCORE, enemy.id);
    player.addTag(BattlerTagType.GORILLA_TACTICS, 0, MoveId.NONE, player.id);
    player.addTag(BattlerTagType.RECHARGING, 2, MoveId.HYPER_BEAM, player.id);
    player.addTag(BattlerTagType.TRAPPED, 2, MoveId.MEAN_LOOK, enemy.id);
    player.summonData.types = [PokemonType.FIRE, PokemonType.WATER, PokemonType.GRASS];
    player.summonData.abilitySuppressed = true;

    const leftovers = modifierTypes.LEFTOVERS().withIdFromFunc(modifierTypes.LEFTOVERS).newModifier(player);
    expect(leftovers).toBeInstanceOf(PokemonHeldItemModifier);
    if (!(leftovers instanceof PokemonHeldItemModifier)) {
      throw new TypeError("LEFTOVERS did not create a held-item modifier");
    }
    leftovers.stackCount = 2;
    await game.scene.addModifier(leftovers, true);
    const enemyLeftovers = modifierTypes.LEFTOVERS().withIdFromFunc(modifierTypes.LEFTOVERS).newModifier(enemy);
    expect(enemyLeftovers).toBeInstanceOf(PokemonHeldItemModifier);
    if (!(enemyLeftovers instanceof PokemonHeldItemModifier)) {
      throw new TypeError("enemy LEFTOVERS did not create a held-item modifier");
    }
    enemyLeftovers.stackCount = 3;
    await game.scene.addEnemyModifier(enemyLeftovers, true, true);
    enemy.waveData.seenInBattle = false;
    enemy.waveData.abilityRevealed = false;
    enemy.waveData.revealedAbilityKeys.clear();
    enemy.waveData.heldItemKnowledgeComplete = false;
    enemy.waveData.revealedHeldItemIds.clear();
    const relic = modifierTypes.ER_RELIC_STORMGLASS().withIdFromFunc(modifierTypes.ER_RELIC_STORMGLASS).newModifier();
    await game.scene.addModifier(relic, true);

    game.scene.arena.trySetWeather(WeatherType.RAIN, player);
    game.scene.arena.trySetTerrain(TerrainType.GRASSY, true, player, 5);
    game.scene.arena.addTag(ArenaTagType.REFLECT, 5, MoveId.REFLECT, player.id, ArenaTagSide.PLAYER, true);
    game.scene.arena.addTag(ArenaTagType.STEALTH_ROCK, 0, MoveId.STEALTH_ROCK, enemy.id, ArenaTagSide.ENEMY, true);
    game.scene.arena.addTag(ArenaTagType.TRICK_ROOM, 5, MoveId.TRICK_ROOM, player.id, ArenaTagSide.BOTH, true);
    enemy.setBoss(true, 4);
    enemy.bossSegmentIndex = 1;
    player.summonData.speciesForm = getPokemonSpeciesForm(SpeciesId.MAGIKARP, 0);

    const observation = snapshotErCombatObservation(game.scene);
    const self = observation.selfParty.find(mon => mon.entityId === player.id)!;
    const foe = observation.opponentActive.find(mon => mon.entityId === enemy.id)!;
    const tackle = self.moves.find(move => move.moveId === MoveId.TACKLE)!;
    const splash = self.moves.find(move => move.moveId === MoveId.SPLASH)!;

    expect(self.nativeTypes).not.toEqual(self.types);
    expect(self.types).toEqual([PokemonType.FIRE, PokemonType.WATER, PokemonType.GRASS]);
    expect(self.transformation.formTransition).toMatchObject({
      fromSpecies: SpeciesId.CHARIZARD,
      toSpecies: SpeciesId.MAGIKARP,
    });
    expect(self.abilities.every(ability => ability.suppressed)).toBe(true);
    expect(tackle.unavailableReasons).toContain(`battler-tag:${BattlerTagType.DISABLED}`);
    expect(splash.unavailableReasons).toContain(`battler-tag:${BattlerTagType.ENCORE}`);
    expect(self.moves.flatMap(move => move.unavailableReasons)).toContain(
      `battler-tag:${BattlerTagType.GORILLA_TACTICS}`,
    );
    expect(self.tags.map(tag => tag.effectId)).toEqual(
      expect.arrayContaining([BattlerTagType.RECHARGING, BattlerTagType.TRAPPED]),
    );
    expect(self.heldItems).toEqual(expect.arrayContaining([expect.objectContaining({ stackCount: 2 })]));
    expect(foe.revealState.abilities).toBe("complete");
    expect(foe.revealState.items).toBe("complete");
    expect(foe.heldItems).toEqual(expect.arrayContaining([expect.objectContaining({ stackCount: 3 })]));
    expect(observation.weather).toMatchObject({ effectId: WeatherType.RAIN, sourceEntityId: player.id });
    expect(observation.terrain).toMatchObject({ effectId: TerrainType.GRASSY, sourceEntityId: player.id });
    expect(observation.fieldEffects.map(effect => effect.effectId)).toEqual(
      expect.arrayContaining([ArenaTagType.REFLECT, ArenaTagType.STEALTH_ROCK, ArenaTagType.TRICK_ROOM]),
    );
    expect(observation.modifiers.some(modifier => modifier.modifierId.includes("STORMGLASS"))).toBe(true);
    expect(foe.boss).toMatchObject({ segments: 4, segmentIndex: 1, phase: 3 });
  });

  it("encodes real damage, charge, recharge, multihit and self-faint candidate consequences", async () => {
    game.override.moveset([MoveId.HYPER_BEAM, MoveId.SOLAR_BEAM, MoveId.BULLET_SEED, MoveId.EXPLOSION]);
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const candidates = enumerateErCombatCandidates(game.scene, 0).filter(candidate => candidate.kind === "move");
    const byMove = (moveId: MoveId) => candidates.find(candidate => candidate.moveId === moveId && !candidate.tera)!;

    expect(byMove(MoveId.HYPER_BEAM).derived.forcesRecharge).toBe(true);
    expect(byMove(MoveId.SOLAR_BEAM).derived.requiresCharge).toBe(true);
    expect(byMove(MoveId.BULLET_SEED).derived).toMatchObject({ minHits: 2, maxHits: 5 });
    expect(byMove(MoveId.EXPLOSION).derived.selfFaints).toBe(true);
    expect(byMove(MoveId.HYPER_BEAM).derived.expectedDamageMax).toBeGreaterThan(0);
    expect(byMove(MoveId.HYPER_BEAM).derived.engineTypeMultiplier).not.toBeNull();
    expect(byMove(MoveId.HYPER_BEAM).derived.targetOutcomes[0]).toMatchObject({
      target: expect.objectContaining({ side: "opponent" }),
      engineTypeMultiplier: expect.any(Number),
      expectedDamageMax: expect.any(Number),
    });
    expect(byMove(MoveId.HYPER_BEAM).derived.orderAssessment).toBe("opponent-action-unknown");
  });

  it("represents Tera state without creating any Mega action state", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const player = game.scene.getPlayerField()[0];
    player.teraType = PokemonType.FIRE;
    player.isTerastallized = true;
    game.scene.arena.playerTerasUsed = 1;
    const observation = snapshotErCombatObservation(game.scene);
    const self = observation.selfParty.find(mon => mon.entityId === player.id)!;

    expect(self.transformation).toMatchObject({ teraType: PokemonType.FIRE, terastallized: true });
    expect(observation.playerTerasUsed).toBe(1);
    expect(JSON.stringify(observation).toLowerCase()).not.toContain("megaavailable");
  });

  it("captures both sides' committed and resolved action history with real execution order", async () => {
    game.override.moveset(MoveId.TACKLE).enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    game.move.select(MoveId.TACKLE, 0);
    await game.phaseInterceptor.to("TurnStartPhase", false);

    const jointActionId = "live:history:1";
    const committed = snapshotErCombatJointActions(game.scene, jointActionId, "committed");
    expect(committed.map(action => action.side)).toEqual(expect.arrayContaining(["self", "opponent"]));
    expect(committed.every(action => action.phase === "committed" && action.result == null)).toBe(true);

    await game.phaseInterceptor.to("TurnEndPhase", false);
    const resolved = snapshotErCombatJointActions(game.scene, jointActionId, "resolved", committed);
    expect(resolved.filter(action => action.kind === "move").every(action => action.resolutionOrder != null)).toBe(
      true,
    );
    expect(resolved.map(action => action.actorEntityId).sort()).toEqual(
      committed.map(action => action.actorEntityId).sort(),
    );
    const observation = snapshotErCombatObservation(game.scene, { previousActions: [...committed, ...resolved] });
    expect(observation.previousActions).toHaveLength(committed.length + resolved.length);
    expect(observation.previousActions.every(action => action.turn <= observation.turn)).toBe(true);
    expect(new Set(observation.previousActions.map(action => action.turn))).toEqual(new Set([observation.turn]));
  });
});
