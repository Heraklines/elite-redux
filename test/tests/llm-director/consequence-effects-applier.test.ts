import type { TargetSpec } from "#data/llm-director/beat-schema";
import type { PlayerPokemon } from "#field/pokemon";
import { resolveTargets } from "#system/llm-director/consequence-effects";
import { describe, expect, it } from "vitest";

/**
 * Pure-function unit tests for the consequence-effects applier helpers.
 *
 * `resolveTargets` is the only piece testable without a full battle scene.
 * Dispatch coverage lives in two places:
 *   1. Schema validation (`consequence-effects-schema.test.ts`) — proves
 *      every variant round-trips through AJV.
 *   2. Real-LLM smoke (`smoke-real-llm.test.ts` with RUN_LLM_SMOKE=1) —
 *      proves the prompt steers the model toward emitting effects[] arrays
 *      that pass validation, plus the dispatch table lights up at runtime
 *      when the player walks through a beat.
 *
 * `random` target uses `Phaser.Math.RND` which is uninitialized outside
 * GameManager-backed tests, so we cover it implicitly via the integration
 * suite rather than mocking the seeded RNG here.
 */

function stubParty(speciesIds: number[]): PlayerPokemon[] {
  return speciesIds.map(id => ({ species: { speciesId: id } }) as unknown as PlayerPokemon);
}

describe("resolveTargets", () => {
  it("returns the whole party for undefined / 'all'", () => {
    const party = stubParty([25, 6, 1]);
    expect(resolveTargets(undefined, party)).toHaveLength(3);
    expect(resolveTargets("all", party)).toHaveLength(3);
  });

  it("returns the indexed slot for partyIndex", () => {
    const party = stubParty([25, 6, 1]);
    const out = resolveTargets({ partyIndex: 1 }, party);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(party[1]);
  });

  it("returns an empty array for out-of-range partyIndex", () => {
    const party = stubParty([25, 6, 1]);
    expect(resolveTargets({ partyIndex: 5 }, party)).toEqual([]);
  });

  it("returns the first species match for { species }", () => {
    const party = stubParty([25, 6, 25, 1]);
    const out = resolveTargets({ species: 25 }, party);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(party[0]);
  });

  it("returns an empty array when species not present", () => {
    const party = stubParty([25, 6]);
    expect(resolveTargets({ species: 999 }, party)).toEqual([]);
  });

  it("handles empty party for every target spec (except 'random' — see file note)", () => {
    const party = stubParty([]);
    const specs: TargetSpec[] = ["all", { partyIndex: 0 }, { species: 25 }];
    for (const spec of specs) {
      expect(resolveTargets(spec, party)).toEqual([]);
    }
  });
});
