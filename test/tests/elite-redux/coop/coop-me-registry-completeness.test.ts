/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Mystery-event authoritative-surface completeness. The guest never executes encounter option code; it
// renders the host's operation stream. That guarantee is only exhaustive if every registered event stays
// inside the audited interaction vocabulary. This engine-free gate inventories the complete registry and
// turns any new custom UI/phase/loop into a mandatory co-op architecture decision instead of a latent live
// softlock. Concrete two-engine tests named below prove each exceptional surface.

import { erGauntletPickMeType, erGauntletWaveKind } from "#data/elite-redux/er-mystery-gauntlet";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { allMysteryEncounters, initMysteryEncounters } from "#mystery-encounters/mystery-encounters";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..", "src");
const TEST_ROOT = __dirname;
const REGISTRY_PATH = join(ROOT, "data", "mystery-encounters", "mystery-encounters.ts");
const ENUM_PATH = join(ROOT, "enums", "mystery-encounter-type.ts");
const ENCOUNTER_DIR = join(ROOT, "data", "mystery-encounters", "encounters");

const registrySource = readFileSync(REGISTRY_PATH, "utf8");

function enumMembers(): string[] {
  const body = readFileSync(ENUM_PATH, "utf8").match(/export enum MysteryEncounterType\s*\{([\s\S]*)\}\s*$/)?.[1];
  expect(body, "MysteryEncounterType enum remains statically enumerable").toBeDefined();
  return body!
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .split(",")
    .map(entry => entry.trim().match(/^([A-Z][A-Z0-9_]*)/)?.[1])
    .filter((entry): entry is string => entry != null);
}

function registeredAliases(): Map<string, string> {
  const imports = new Map<string, string>();
  for (const match of registrySource.matchAll(/import\s*\{([^}]+)\}\s*from\s*"#mystery-encounters\/([^"]+)";/g)) {
    for (const imported of match[1].split(",")) {
      const alias = imported
        .trim()
        .split(/\s+as\s+/)
        .at(-1)
        ?.trim();
      if (alias) {
        imports.set(alias, match[2]);
      }
    }
  }

  const registered = new Map<string, string>();
  for (const match of registrySource.matchAll(
    /allMysteryEncounters\[MysteryEncounterType\.([A-Z0-9_]+)\]\s*=\s*([A-Za-z0-9_]+);/g,
  )) {
    const source = imports.get(match[2]);
    expect(source, `${match[1]} resolves to an imported encounter definition`).toBeDefined();
    registered.set(match[1], source!);
  }
  return registered;
}

const registered = registeredAliases();
const encounterSources = new Map(
  [...registered.values()].map(specifier => {
    const file = `${basename(specifier)}.ts`;
    return [file, readFileSync(join(ENCOUNTER_DIR, file), "utf8")] as const;
  }),
);

function filesMatching(pattern: RegExp): string[] {
  return [...encounterSources]
    .filter(([, source]) => pattern.test(source))
    .map(([file]) => file)
    .sort();
}

function assertProof(testFile: string, needles: readonly string[]): void {
  const proof = readFileSync(join(TEST_ROOT, testFile), "utf8");
  for (const needle of needles) {
    expect(proof, `${testFile} retains the ${needle} co-op proof`).toContain(needle);
  }
}

describe("co-op Mystery Encounter registry and exceptional-surface completeness", () => {
  it("registers every concrete enum event exactly once (91 registry events + one gauntlet-only Bargain)", () => {
    const expectedRegistry = enumMembers().filter(name => name !== "LLM_DIRECTED" && name !== "ER_THE_BARGAIN");
    expect([...registered.keys()].sort(), "no concrete Mystery Event is unregistered or multiply aliased").toEqual(
      expectedRegistry.sort(),
    );
    expect(registered.size, "the audited biome/gauntlet registry cardinality is explicit").toBe(91);
    expect(enumMembers()).toContain("ER_THE_BARGAIN");
  });

  it("keeps every seeded gauntlet ME pick concrete and registered", () => {
    initMysteryEncounters();
    const syntheticTypes = new Set([MysteryEncounterType.LLM_DIRECTED, MysteryEncounterType.ER_THE_BARGAIN]);

    for (let seedIndex = 0; seedIndex < 512; seedIndex++) {
      const seed = `gauntlet-registry-${seedIndex}`;
      for (let wave = 2; wave <= 257; wave++) {
        if (erGauntletWaveKind(wave) !== "me") {
          continue;
        }
        const selected = erGauntletPickMeType(wave, [], seed);
        expect(
          syntheticTypes.has(selected),
          `seed ${seed} wave ${wave} selected synthetic ${MysteryEncounterType[selected]}`,
        ).toBe(false);
        expect(
          allMysteryEncounters[selected],
          `seed ${seed} wave ${wave} selected unregistered ${MysteryEncounterType[selected]}`,
        ).toBeDefined();
      }
    }
  });

  it("keeps every direct encounter UI escape inside the audited files", () => {
    const calls = new Map<string, Set<string>>();
    for (const [file, source] of encounterSources) {
      for (const match of source.matchAll(/globalScene\.ui\.([A-Za-z0-9_]+)/g)) {
        const owners = calls.get(match[1]) ?? new Set<string>();
        owners.add(file);
        calls.set(match[1], owners);
      }
    }
    const normalized = Object.fromEntries(
      [...calls].sort(([a], [b]) => a.localeCompare(b)).map(([method, files]) => [method, [...files].sort()]),
    );
    expect(normalized, "a new direct UI call requires an authoritative replay design + two-engine proof").toEqual({
      add: ["bug-type-superfan-encounter.ts", "colosseum-encounter.ts"],
      clearText: ["the-winstrate-challenge-encounter.ts"],
      setMode: ["clowning-around-encounter.ts"],
      setModeWithoutClear: ["clowning-around-encounter.ts"],
      showText: ["fun-and-games-encounter.ts"],
    });
    assertProof("coop-me-yesno-subprompt.test.ts", ["yes/no", "CLOWNING_AROUND"]);
  });

  it("keeps quiz, repeated-choice, bespoke-market, and multi-round phases exhaustively classified", () => {
    expect(
      filesMatching(/unshiftNew\("ErQuizPhase"/),
      "all eight quiz definitions use the one mirrored quiz seam",
    ).toEqual([
      "dormant-guardian-encounter.ts",
      "frozen-shapes-encounter.ts",
      "lake-spirit-encounter.ts",
      "salvage-yard-encounter.ts",
      "scrambled-pokedex-encounter.ts",
      "sealed-door-encounter.ts",
      "town-guessing-booth-encounter.ts",
      "tracks-in-the-snow-encounter.ts",
    ]);
    expect(
      filesMatching(/startPressYourLuck\(/),
      "all press-your-luck events use the repeated-presentation seam",
    ).toEqual([
      "abyssal-vent-encounter.ts",
      "buried-city-encounter.ts",
      "glittering-vein-encounter.ts",
      "into-the-caldera-encounter.ts",
      "overcharge-core-encounter.ts",
      "overgrown-temple-encounter.ts",
      "tide-pools-encounter.ts",
      "woodland-forager-encounter.ts",
    ]);
    expect(filesMatching(/initSubsequentOptionSelect\(/), "Safari is the only direct repeated selector").toEqual([
      "safari-zone-encounter.ts",
    ]);
    expect(filesMatching(/unshiftNew\("(?:Exotic|BlackMarket|ImportBazaar)ShopPhase"/)).toEqual([
      "black-market-encounter.ts",
      "exotic-trader-encounter.ts",
      "import-bazaar-encounter.ts",
    ]);
    expect(filesMatching(/unshiftNew\("ColosseumChoicePhase"/)).toEqual(["colosseum-encounter.ts"]);

    assertProof("coop-duo-mystery.test.ts", ["ErQuizPhase", "ER_INTO_THE_CALDERA"]);
    assertProof("coop-duo-biome-market-continuation.test.ts", ["BIOME_SHOP", "WATCHER"]);
    assertProof("coop-colosseum-board.test.ts", ["runColosseumGuestRoundLoop", "COLOSSEUM_CONTINUE"]);
  });
});
