/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTrainerEntry } from "./trainers.mjs";

const SIMPLE_PATH = resolve(__dirname, "../fixtures/sample-trainer.json");
const TIERED_PATH = resolve(__dirname, "../fixtures/sample-trainer-tiered.json");
const VENDOR_PATH = resolve(__dirname, "../../../vendor/elite-redux/v2.65beta.json");

describe("trainers transformer (pure)", () => {
  it("maps the simple smoke trainer (party only, empty insane/hell)", async () => {
    const raw = JSON.parse(await readFile(SIMPLE_PATH, "utf8"));
    const entry = buildTrainerEntry(raw, 0);
    expect(entry.id).toBe(0);
    expect(entry.name).toBe("May Route 103 Treecko");
    expect(entry.trainerClass).toBe(15);
    expect(entry.isDouble).toBe(false);
    expect(entry.party).toHaveLength(2);
    expect(entry.insaneParty).toBeNull();
    expect(entry.hellParty).toBeNull();
    expect(entry.extras).toEqual([]);
  });

  it("maps the tiered fixture (Rick) with all 3 tiers populated", async () => {
    const raw = JSON.parse(await readFile(TIERED_PATH, "utf8"));
    const entry = buildTrainerEntry(raw, 42);
    expect(entry.id).toBe(42);
    expect(entry.name).toBe("Rick");
    expect(entry.party.length).toBe(3);
    expect(entry.insaneParty?.length).toBe(3);
    expect(entry.hellParty?.length).toBe(5);
  });

  it("renames party member keys (spc/abi → species/abilitySlot)", async () => {
    const raw = JSON.parse(await readFile(SIMPLE_PATH, "utf8"));
    const entry = buildTrainerEntry(raw, 0);
    const member = entry.party[0];
    expect(member.species).toBeDefined();
    expect(member.abilitySlot).toBeDefined();
    expect(member.moves.length).toBeGreaterThan(0);
    expect(member.ivs).toHaveLength(6);
    expect(member.evs).toHaveLength(6);
  });

  it("returns null (not empty array) for empty insane/hell", async () => {
    const raw = JSON.parse(await readFile(SIMPLE_PATH, "utf8"));
    const entry = buildTrainerEntry(raw, 0);
    expect(entry.insaneParty).toBeNull();
    expect(entry.hellParty).toBeNull();
  });

  it("preserves the moves array as numeric IDs", async () => {
    const raw = JSON.parse(await readFile(SIMPLE_PATH, "utf8"));
    const entry = buildTrainerEntry(raw, 0);
    expect(entry.party[0].moves.every(m => typeof m === "number")).toBe(true);
  });

  it("throws with id context when name is missing", () => {
    const bad = { tclass: 0, db: false, party: [], insane: [], hell: [], rem: [], map: 0 } as unknown as Parameters<
      typeof buildTrainerEntry
    >[0];
    expect(() => buildTrainerEntry(bad, 999)).toThrow(/trainer.*999|name/i);
  });

  it("handles a malformed party member by throwing with context", () => {
    const raw = {
      name: "Test",
      tclass: 0,
      db: false,
      party: [
        {
          /* missing spc/abi/ivs/etc. */
        },
      ],
      insane: [],
      hell: [],
      rem: [],
      map: 0,
    };
    expect(() => buildTrainerEntry(raw, 5)).toThrow(/trainer.*5|party|member|species/i);
  });
});

describe.skipIf(!existsSync(VENDOR_PATH))("trainers transformer — full dump", () => {
  it("transforms all 895 trainers without throwing", async () => {
    const dump = JSON.parse(await readFile(VENDOR_PATH, "utf8"));
    const entries = dump.trainers.map((t: Parameters<typeof buildTrainerEntry>[0], i: number) =>
      buildTrainerEntry(t, i),
    );
    expect(entries.length).toBe(895);
  });

  it("counts populated tier rosters (insane / hell)", async () => {
    const dump = JSON.parse(await readFile(VENDOR_PATH, "utf8"));
    const entries = dump.trainers.map((t: Parameters<typeof buildTrainerEntry>[0], i: number) =>
      buildTrainerEntry(t, i),
    );
    const withInsane = entries.filter((e: { insaneParty: unknown }) => e.insaneParty !== null).length;
    const withHell = entries.filter((e: { hellParty: unknown }) => e.hellParty !== null).length;
    // Per design doc: 429 insane + 399 hell
    expect(withInsane).toBeGreaterThan(400);
    expect(withInsane).toBeLessThan(460);
    expect(withHell).toBeGreaterThan(370);
    expect(withHell).toBeLessThan(430);
  });

  it("trainer 0 is May Route 103 Treecko (smoke baseline)", async () => {
    const dump = JSON.parse(await readFile(VENDOR_PATH, "utf8"));
    const entry = buildTrainerEntry(dump.trainers[0], 0);
    expect(entry.name).toBe("May Route 103 Treecko");
  });
});
