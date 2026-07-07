import { starterToManifest } from "#app/data/elite-redux/showdown/showdown-manifest";
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
    const manifest = starterToManifest(starter(), undefined);
    expect("erShinyLab" in manifest).toBe(false);
  });

  it("hash of the in-memory manifest equals the hash of its JSON round-trip", () => {
    const team = [starterToManifest(starter(), undefined), starterToManifest(starter({ speciesId: 7 }), undefined)];
    const rehydrated = JSON.parse(JSON.stringify(team));
    expect(showdownTeamHash(team)).toBe(showdownTeamHash(rehydrated));
  });

  it("survives a manifest that DOES carry an undefined-valued optional key", () => {
    // Even if a future field regresses to `key: undefined`, the hash must stay
    // transport-canonical because showdownTeamHash round-trips before hashing.
    const m = starterToManifest(starter(), undefined) as Record<string, unknown>;
    const withUndefined = { ...m, erShinyLab: undefined };
    expect(showdownTeamHash([withUndefined as never])).toBe(
      showdownTeamHash(JSON.parse(JSON.stringify([withUndefined]))),
    );
  });
});
