/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

function methodBody(file: string, start: string, end: string): string {
  const contents = source(file);
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end, startIndex + start.length);
  expect(startIndex, `${file} contains ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `${file} contains ${end} after ${start}`).toBeGreaterThan(startIndex);
  return contents.slice(startIndex, endIndex);
}

describe("Authority V2 form-change phase ordering", () => {
  it("keeps summon setup form material in the recorded co-op subtree", () => {
    const fieldSetup = methodBody(
      "src/field/pokemon.ts",
      "public fieldSetup(resetSummonData?: boolean): void",
      "public resetSummonData(): void",
    );
    expect(fieldSetup).toMatch(/const coopTurnRecording = globalScene\.gameMode\.isCoop && isCoopRecording\(\);/);
    expect(fieldSetup).toMatch(
      /triggerPokemonFormChange\(this, SpeciesFormChangePostMoveTrigger, !coopTurnRecording\)/,
    );

    const summon = methodBody("src/phases/summon-phase.ts", "onEnd(): void", "queuePostSummon(): void");
    expect(summon).toMatch(/const coopTurnRecording = globalScene\.gameMode\.isCoop && isCoopRecording\(\);/);
    expect(summon).toMatch(/triggerPokemonFormChange\(pokemon, SpeciesFormChangeActiveTrigger, !coopTurnRecording\)/);

    const switchSummon = methodBody("src/phases/switch-summon-phase.ts", "onEnd(): void", "queuePostSummon(): void");
    expect(switchSummon).toMatch(/const coopTurnRecording = globalScene\.gameMode\.isCoop && isCoopRecording\(\);/);
    expect(switchSummon).toMatch(
      /triggerPokemonFormChange\(pokemon, SpeciesFormChangeActiveTrigger, !coopTurnRecording\)/,
    );
  });

  it("suppresses only duplicate faint cleanup and retains living switch reverts on either side", () => {
    const leaveField = methodBody(
      "src/field/pokemon.ts",
      "leaveField(clearEffects = true, hideInfo = true, destroy = false)",
      "destroy(): void",
    );
    expect(leaveField).toMatch(/const coopTurnRecording = globalScene\.gameMode\.isCoop && isCoopRecording\(\);/);
    expect(leaveField).toMatch(
      /if \(!coopTurnRecording \|\| !this\.isFainted\(\)\) \{[\s\S]*?SpeciesFormChangeActiveTrigger, !coopTurnRecording/,
    );
    expect(leaveField).not.toMatch(/!coopTurnRecording \|\| this\.isPlayer\(\)/);
  });

  it("keeps the ordering override co-op-specific so Showdown and lockstep stay unchanged", () => {
    const bodies = [
      methodBody(
        "src/field/pokemon.ts",
        "public fieldSetup(resetSummonData?: boolean): void",
        "public resetSummonData(): void",
      ),
      methodBody(
        "src/field/pokemon.ts",
        "leaveField(clearEffects = true, hideInfo = true, destroy = false)",
        "destroy(): void",
      ),
      methodBody("src/phases/summon-phase.ts", "onEnd(): void", "queuePostSummon(): void"),
      methodBody("src/phases/switch-summon-phase.ts", "onEnd(): void", "queuePostSummon(): void"),
    ];
    for (const body of bodies) {
      expect(body).toMatch(/gameMode\.isCoop && isCoopRecording\(\)/);
      expect(body).not.toMatch(/gameMode\.isShowdown/);
      expect(body).not.toMatch(/isAuthoritativeBattleSession\(\)\s*&&\s*isCoopRecording/);
    }
  });
});
