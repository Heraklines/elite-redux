import {
  buildDemoChallengesConfig,
  type CommunityChallengeConfig,
  validateChallengeConfig as clientValidate,
} from "#data/elite-redux/er-community-challenges";
import { describe, expect, it } from "vitest";
// The worker carries a VERBATIM copy of validateChallengeConfig (it can't import
// from src/). This parity test asserts the two implementations agree on every
// input, so the client never sends a config the worker would reject (or vice
// versa). Imported the same way as er-usage-tier-publish-guard.test.ts.
import { validateChallengeConfig as workerValidate } from "../../../workers/er-save-api/src/index";

// A valid baseline config (the demo NOZLOCKE) to mutate into failure cases.
function validConfig(): CommunityChallengeConfig {
  const feed = buildDemoChallengesConfig({ populated: true });
  // The demo featured[0] is a complete, valid CommunityChallengeConfig, but its
  // difficultyTier/etc. are already legal; add a non-empty baseChallenges to also
  // exercise the [id,value,severity] path.
  return {
    ...feed.featured[0].config,
    baseChallenges: [
      [9, 1],
      [11, 1, 2],
    ],
  };
}

const cases: { name: string; config: unknown }[] = [
  { name: "valid demo-derived config", config: validConfig() },
  { name: "null", config: null },
  { name: "array (not an object)", config: [] },
  { name: "empty object", config: {} },
  { name: "missing name", config: { ...validConfig(), name: "" } },
  { name: "overlong name", config: { ...validConfig(), name: "x".repeat(61) } },
  { name: "bad difficulty", config: { ...validConfig(), difficulty: "godlike" } },
  { name: "difficultyTier 0", config: { ...validConfig(), difficultyTier: 0 } },
  { name: "difficultyTier 6", config: { ...validConfig(), difficultyTier: 6 } },
  { name: "non-numeric gameModeId", config: { ...validConfig(), gameModeId: "x" } },
  { name: "baseChallenges not an array", config: { ...validConfig(), baseChallenges: "nope" } },
  { name: "baseChallenge id out of range", config: { ...validConfig(), baseChallenges: [[99, 1]] } },
  { name: "baseChallenge negative id", config: { ...validConfig(), baseChallenges: [[-1, 1]] } },
  { name: "baseChallenge missing value", config: { ...validConfig(), baseChallenges: [[9]] } },
  { name: "baseChallenge bad severity", config: { ...validConfig(), baseChallenges: [[9, 1, "x"]] } },
  { name: "too many baseChallenges", config: { ...validConfig(), baseChallenges: new Array(21).fill([9, 1]) } },
  { name: "allowedSpecies wrong type", config: { ...validConfig(), allowedSpecies: 5 } },
  { name: "allowedSpecies non-integer entry", config: { ...validConfig(), allowedSpecies: [1, 2.5] } },
  { name: "allowedSpecies zero entry", config: { ...validConfig(), allowedSpecies: [0] } },
  { name: "allowedSpecies null (allowed)", config: { ...validConfig(), allowedSpecies: null } },
  { name: "targetWave 0", config: { ...validConfig(), targetWave: 0 } },
  { name: "targetWave 201", config: { ...validConfig(), targetWave: 201 } },
  { name: "tags not an array", config: { ...validConfig(), tags: "x" } },
  { name: "too many tags", config: { ...validConfig(), tags: new Array(9).fill("T") } },
  { name: "empty tag", config: { ...validConfig(), tags: [""] } },
  { name: "overlong tag", config: { ...validConfig(), tags: ["x".repeat(25)] } },
  { name: "restrictions wrong type", config: { ...validConfig(), restrictions: [] } },
  {
    name: "multiple errors at once",
    config: { name: "", difficulty: "x", difficultyTier: 9, baseChallenges: [[99, 1]], targetWave: 999, tags: 5 },
  },
];

describe("validateChallengeConfig client/worker parity", () => {
  it("the demo-derived config is accepted by both", () => {
    expect(clientValidate(validConfig()).ok).toBe(true);
    expect(workerValidate(validConfig()).ok).toBe(true);
  });

  for (const { name, config } of cases) {
    it(`agrees on: ${name}`, () => {
      const client = clientValidate(config);
      const worker = workerValidate(config);
      // Identical ok + identical error list (same strings, same order).
      expect(client).toEqual(worker);
    });
  }

  it("rejects invalid configs (sanity: at least one case is not ok)", () => {
    const r = clientValidate({});
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
