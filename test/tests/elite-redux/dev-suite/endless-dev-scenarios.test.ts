/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  consumePendingDevEndlessOffer,
  consumePendingDevGhostTeam,
  runPendingDevPartySetup,
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
    const nextScenario = source.indexOf('label: "Endless: full Hell ghost"', scenarioStart);
    const scenario = source.slice(scenarioStart, nextScenario);

    expect(resetStart).toBeGreaterThan(-1);
    expect(source.slice(resetStart, resetEnd)).toContain("resetErRunPacing()");
    expect(scenarioStart).toBeGreaterThan(-1);
    expect(nextScenario).toBeGreaterThan(scenarioStart);
    expect(scenario).toContain("usableGhostMembers(DEV_HELL_VICTORY_GHOST)");
    expect(scenario).toContain('setErRunPacing("normal")');
    expect(scenario).toContain("STARTING_BIOME_OVERRIDE: BiomeId.END");
    expect(scenario).toContain("setPendingDevEndlessOffer()");
    expect(scenario).toContain("applyPreparedGhostHeldItems(globalScene.getPlayerParty(), members)");
    expect(scenario).toContain("applyPreparedGhostRelics(DEV_HELL_VICTORY_GHOST)");
    expect(scenario).toContain("Hell victory legacy loadout restored partially");
    expect(scenario).not.toContain("Hell victory loadout was incomplete");
    expect(scenario).toContain("globalScene.currentBattle.isClassicFinalBoss");
    expect(scenario).toContain("boss.damageAndUpdate(Math.max(1, boss.hp)");
    expect(source.match(/boss\.damageAndUpdate\(Math\.max\(1, boss\.hp\)/gu)).toHaveLength(1);
    expect(source).toContain(
      'export const DEV_MENU_SCENARIOS: DevScenario[] = DEV_SCENARIOS.filter(\n  scenario => scenario.label === "Endless: final boss auto-KO",',
    );
  });
});
