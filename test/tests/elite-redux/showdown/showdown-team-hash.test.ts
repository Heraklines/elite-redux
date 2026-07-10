import { type ShowdownUnlockGameData, starterToManifest } from "#app/data/elite-redux/showdown/showdown-manifest";
import { showdownTeamHash } from "#app/data/elite-redux/showdown/showdown-session";
import type { Starter } from "#types/save-data";
import { describe, expect, it } from "vitest";

/**
 * Regression: the team hash MUST be computed over the transport-canonical shape.
 * `JSON.stringify` (the real WebRTC framing) drops `undefined`-valued keys, while
 * `Object.keys` locally keeps them - so hashing the raw in-memory manifest committed
 * a fingerprint the receiver could never recompute, voiding EVERY real match at the
 * ready gate. Loopback tests pass objects by reference and structurally cannot catch
 * this, hence this explicit JSON-round-trip lock.
 */

const emptyGameData: ShowdownUnlockGameData = { dexData: {}, starterData: {} };

const starter = (over: Partial<Starter> = {}): Starter =>
  ({
    speciesId: 4,
    shiny: false,
    variant: 0,
    formIndex: 0,
    abilityIndex: 0,
    nature: 0,
    moveset: [1, 2, 3, 4],
    pokerus: false,
    ivs: [31, 31, 31, 31, 31, 31],
    ...over,
  }) as Starter;

describe("showdownTeamHash transport-shape canonicality", () => {
  it("starterToManifest omits the erShinyLab key entirely for a non-shiny mon", () => {
    const manifest = starterToManifest(starter(), emptyGameData);
    expect("erShinyLab" in manifest).toBe(false);
  });

  it("hash of the in-memory manifest equals the hash of its JSON round-trip", () => {
    const team = [
      starterToManifest(starter(), emptyGameData),
      starterToManifest(starter({ speciesId: 7 }), emptyGameData),
    ];
    const rehydrated = JSON.parse(JSON.stringify(team));
    expect(showdownTeamHash(team)).toBe(showdownTeamHash(rehydrated));
  });

  it("survives a manifest that DOES carry an undefined-valued optional key", () => {
    // Even if a future field regresses to `key: undefined`, the hash must stay
    // transport-canonical because showdownTeamHash round-trips before hashing.
    const m: Record<string, unknown> = { ...starterToManifest(starter(), emptyGameData) };
    const withUndefined = { ...m, erShinyLab: undefined };
    expect(showdownTeamHash([withUndefined as never])).toBe(
      showdownTeamHash(JSON.parse(JSON.stringify([withUndefined]))),
    );
  });

  // Showdown fairness (2026-07-10): `nature` is a FREE, OPTIONAL manifest field. It must obey the
  // same transport-canonical omit-when-absent discipline as `erShinyLab` (both clients hash the
  // exact wire shape, so an absent field must NOT appear as a `nature` key).
  describe("optional nature field", () => {
    it("hashes a manifest with nature PRESENT differently from one with nature ABSENT", () => {
      const present = starterToManifest(starter({ nature: 5 }), emptyGameData);
      const absent: Record<string, unknown> = { ...present };
      delete absent.nature;
      expect("nature" in present).toBe(true);
      expect("nature" in absent).toBe(false);
      expect(showdownTeamHash([present])).not.toBe(showdownTeamHash([absent as never]));
    });

    it("hashes two manifests with DIFFERENT natures differently (nature is in the hash)", () => {
      const a = starterToManifest(starter({ nature: 0 }), emptyGameData);
      const b = starterToManifest(starter({ nature: 12 }), emptyGameData);
      expect(showdownTeamHash([a])).not.toBe(showdownTeamHash([b]));
    });

    it("an ABSENT nature produces NO `nature` key after the JSON round-trip (and a stable hash)", () => {
      const absent: Record<string, unknown> = { ...starterToManifest(starter(), emptyGameData) };
      delete absent.nature;
      const rehydrated = JSON.parse(JSON.stringify(absent));
      expect("nature" in rehydrated).toBe(false);
      // Transport-canonical: the in-memory (already key-less) object hashes identically to its round-trip.
      expect(showdownTeamHash([absent as never])).toBe(showdownTeamHash([rehydrated]));
    });

    it("treats `nature: undefined` identically to an omitted nature (the erShinyLab omit-void lesson)", () => {
      const base = starterToManifest(starter(), emptyGameData);
      const omitted: Record<string, unknown> = { ...base };
      delete omitted.nature;
      const withUndefined = { ...base, nature: undefined };
      expect(showdownTeamHash([withUndefined as never])).toBe(showdownTeamHash([omitted as never]));
    });
  });
});
