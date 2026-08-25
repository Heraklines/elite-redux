/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  clearDevEncounterPersistenceBypass,
  consumePendingDevEndlessOffer,
  consumePendingDevGhostTeam,
  isDevEncounterPersistenceBypassActive,
  runPendingDevPartySetup,
  setDevEncounterPersistenceBypass,
  setPendingDevEndlessOffer,
  setPendingDevGhostTeam,
  setPendingDevPartySetup,
} from "#app/dev-tools/registry";
import { DEV_HELL_VICTORY_GHOST } from "#app/dev-tools/test-suite/fixtures/hell-victory-ghost";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("Endless dev scenario fixtures", () => {
  it("keeps the sanitized Hell victory team complete", () => {
    expect(DEV_HELL_VICTORY_GHOST).toMatchObject({
      id: "dev-hell-victory-showcase",
      sourceUserId: "dev-fixture",
      trainerName: "Hell Victor",
      difficulty: "hell",
      mode: "classic",
      waveReached: 200,
      isVictory: true,
      timestamp: 0,
    });
    expect(DEV_HELL_VICTORY_GHOST.party).toHaveLength(6);
    expect(DEV_HELL_VICTORY_GHOST.party.every(member => member.moves.length === 4)).toBe(true);
    expect(DEV_HELL_VICTORY_GHOST.party.reduce((total, member) => total + (member.heldItems?.length ?? 0), 0)).toBe(46);
    expect(DEV_HELL_VICTORY_GHOST.relics).toEqual([
      ["bloodPact", 1, null],
      ["secondWind", 1, null],
    ]);
  });

  it("consumes a staged ghost exactly once", () => {
    consumePendingDevGhostTeam();
    setPendingDevGhostTeam(DEV_HELL_VICTORY_GHOST);

    expect(consumePendingDevGhostTeam()).toBe(DEV_HELL_VICTORY_GHOST);
    expect(consumePendingDevGhostTeam()).toBeNull();
  });

  it("consumes the dev-only Endless offer exactly once", () => {
    consumePendingDevEndlessOffer();
    setPendingDevEndlessOffer();

    expect(consumePendingDevEndlessOffer()).toBe(true);
    expect(consumePendingDevEndlessOffer()).toBe(false);
  });

  it("keeps the dev-only encounter persistence bypass scoped until title cleanup", () => {
    clearDevEncounterPersistenceBypass();
    setDevEncounterPersistenceBypass();

    expect(isDevEncounterPersistenceBypassActive()).toBe(true);
    expect(isDevEncounterPersistenceBypassActive()).toBe(true);
    clearDevEncounterPersistenceBypass();
    expect(isDevEncounterPersistenceBypassActive()).toBe(false);
  });

  it("does not abort run creation when a dev party setup fails", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    setPendingDevPartySetup(() => {
      throw new Error("legacy fixture entry");
    });

    expect(runPendingDevPartySetup()).toBe(false);
    expect(runPendingDevPartySetup()).toBe(true);
    expect(warning).toHaveBeenCalledWith(
      "[dev-tools] Party setup failed; continuing with the restored base party",
      expect.any(Error),
    );
    warning.mockRestore();
  });

  it("keeps the final-boss auto-KO scoped to the Hell-team picker scenario", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/dev-tools/test-suite/scenarios.ts"), "utf8");
    const resetStart = source.indexOf("export function resetDevOverrides()");
    const resetEnd = source.indexOf("function setOverrides", resetStart);
    const scenarioStart = source.indexOf('label: "Endless: final boss auto-KO"');
    const nextScenario = source.indexOf('label: "Endless: deep Hell ghost (wave 401)"', scenarioStart);
    const scenario = source.slice(scenarioStart, nextScenario);

    expect(resetStart).toBeGreaterThan(-1);
    expect(source.slice(resetStart, resetEnd)).toContain("resetErRunPacing()");
    expect(scenarioStart).toBeGreaterThan(-1);
    expect(nextScenario).toBeGreaterThan(scenarioStart);
    expect(scenario).toContain("usableGhostMembers(DEV_HELL_VICTORY_GHOST)");
    expect(scenario).toContain('setErRunPacing("normal")');
    expect(scenario).toContain("STARTING_BIOME_OVERRIDE: BiomeId.END");
    expect(scenario).toContain("setPendingDevEndlessOffer()");
    expect(scenario).toContain("boss.customPokemonData.erBlackShiny = true");
    expect(scenario).toContain("applyPreparedGhostHeldItems(globalScene.getPlayerParty(), members)");
    expect(scenario).toContain("applyPreparedGhostRelics(DEV_HELL_VICTORY_GHOST)");
    expect(scenario).toContain("Hell victory legacy loadout restored partially");
    expect(scenario).not.toContain("Hell victory loadout was incomplete");
    expect(scenario).toContain("globalScene.currentBattle.isClassicFinalBoss");
    expect(scenario).toContain("onFirstTurnCommitted: () =>");
    expect(scenario).toContain("bypassEncounterPersistence: true");
    expect(scenario).not.toContain("onBattleStart: () =>");
    expect(scenario).toContain("boss.damageAndUpdate(Math.max(1, boss.hp)");
    expect(source.match(/boss\.damageAndUpdate\(Math\.max\(1, boss\.hp\)/gu)).toHaveLength(1);
    expect(source).toContain('"Endless: final boss auto-KO"');
    expect(source).toContain('"Endless: deep Hell ghost (wave 401)"');
    expect(source).toContain("DEV_MENU_SCENARIO_LABELS.has(scenario.label)");
  });

  it("exposes a deep Endless fixture with Avalanche and active Rifts", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/dev-tools/test-suite/scenarios.ts"), "utf8");
    const scenarioStart = source.indexOf('label: "Endless: deep Hell ghost (wave 401)"');
    const nextScenario = source.indexOf("// Final boss — Primal Cascoon two-phase fight", scenarioStart);
    const scenario = source.slice(scenarioStart, nextScenario);

    expect(scenarioStart).toBeGreaterThan(-1);
    expect(nextScenario).toBeGreaterThan(scenarioStart);
    expect(scenario).toContain("STARTING_WAVE_OVERRIDE: 401");
    expect(scenario).toContain("enteredAtWave: 200");
    expect(scenario).toContain('{ id: "inverse-rift"');
    expect(scenario).toContain('{ id: "weather-carousel"');
    expect(scenario).toContain('{ id: "avalanche-reroll"');
    expect(scenario).toContain('{ id: "overheal-barrier"');
    expect(scenario).toContain("setPendingDevGhostTeam(structuredClone(DEV_HELL_VICTORY_GHOST))");
  });

  it("presents the throwaway staging encounter without entering the cloud-save failure path", () => {
    const launcher = fs.readFileSync(path.join(process.cwd(), "src/dev-tools/test-suite/index.ts"), "utf8");
    const encounter = fs.readFileSync(path.join(process.cwd(), "src/phases/encounter-phase.ts"), "utf8");
    const bypassBranch = encounter.indexOf("isDevEncounterPersistenceBypassActive()");
    const saveBranch = encounter.indexOf("saveEncounterCheckpointWithEndlessEntryRecovery(", bypassBranch);

    expect(launcher).toContain("setDevEncounterPersistenceBypass()");
    expect(launcher).toContain("clearDevEncounterPersistenceBypass()");
    expect(bypassBranch).toBeGreaterThan(-1);
    expect(saveBranch).toBeGreaterThan(bypassBranch);
    expect(encounter.slice(bypassBranch, saveBranch)).toContain("this.enterEncounterPresentation()");
  });

  it("waits for the first committed move before triggering the scenario KO", () => {
    const registry = fs.readFileSync(path.join(process.cwd(), "src/dev-tools/registry.ts"), "utf8");
    const launcher = fs.readFileSync(path.join(process.cwd(), "src/dev-tools/test-suite/index.ts"), "utf8");
    const turnStart = fs.readFileSync(path.join(process.cwd(), "src/phases/turn-start-phase.ts"), "utf8");

    expect(registry).toContain("setPendingDevPostCommandSetup");
    expect(registry).toContain("consumePendingDevPostCommandSetup");
    expect(launcher).toContain("setPendingDevPostCommandSetup(scenario.onFirstTurnCommitted)");
    expect(turnStart).toContain("const devPostCommandSetup = consumePendingDevPostCommandSetup()");
    expect(turnStart.indexOf("const devPostCommandSetup = consumePendingDevPostCommandSetup()")).toBeLessThan(
      turnStart.indexOf("const field = globalScene.getField()"),
    );
  });

  it("routes the synthetic victory directly to the Endless prompt", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/phases/game-over-phase.ts"), "utf8");
    const devRoute = source.indexOf("if (this.isVictory && consumePendingDevEndlessOffer())");
    const cloudClear = source.indexOf("pokerogueApi.savedata.session");

    expect(devRoute).toBeGreaterThan(-1);
    expect(cloudClear).toBeGreaterThan(devRoute);
    expect(source.slice(devRoute, cloudClear)).toContain('pushNew("EndlessOfferPhase")');
  });

  it("clears the offer UI and permits encounters beyond the original finale", () => {
    const offer = fs.readFileSync(path.join(process.cwd(), "src/phases/endless-offer-phase.ts"), "utf8");
    const encounter = fs.readFileSync(path.join(process.cwd(), "src/phases/encounter-phase.ts"), "utf8");

    expect(offer.match(/globalScene\.ui\.setMode\(UiMode\.MESSAGE\)/gu)).toHaveLength(2);
    expect(encounter).toContain(
      "globalScene.gameMode.isClassic\n      && !isErEndlessContinuationActive()\n      && globalScene.currentBattle.waveIndex >",
    );
  });
});
