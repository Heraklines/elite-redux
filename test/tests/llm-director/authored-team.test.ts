import { type AuthoredPokemon, validateBeat } from "#data/llm-director/beat-schema";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { authoredTeamToEnemyConfigs, clampAuthoredTeam, isMapTeamFailure } from "#system/llm-director/authored-team";
import { describe, expect, it } from "vitest";

describe("AuthoredPokemon schema validation", () => {
  const baseTrainerBeat = (extra: object = {}) => ({
    beatId: "t1",
    type: "trainer_battle",
    introText: "x",
    trainerName: "Rival",
    trainerType: 1,
    preBattleText: "x",
    postWinText: "x",
    ...extra,
  });

  it("accepts a valid enemyTeam with all fields", () => {
    const beat = baseTrainerBeat({
      enemyTeam: [
        {
          speciesId: SpeciesId.PIKACHU,
          level: 12,
          abilityId: AbilityId.STATIC,
          moveIds: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK],
          heldItemKeys: ["LEFTOVERS", "FOCUS_BAND"],
          isBoss: false,
          shiny: false,
          nickname: "Sparky",
        },
      ],
    });
    expect(validateBeat(beat).ok).toBe(true);
  });

  it("rejects negative speciesId", () => {
    const beat = baseTrainerBeat({ enemyTeam: [{ speciesId: -1 }] });
    const r = validateBeat(beat);
    expect(r.ok).toBe(false);
  });

  it("rejects zero speciesId", () => {
    const beat = baseTrainerBeat({ enemyTeam: [{ speciesId: 0 }] });
    expect(validateBeat(beat).ok).toBe(false);
  });

  it("rejects more than 4 moves on a single Pokemon", () => {
    const beat = baseTrainerBeat({
      enemyTeam: [
        {
          speciesId: 1,
          moveIds: [1, 2, 3, 4, 5],
        },
      ],
    });
    expect(validateBeat(beat).ok).toBe(false);
  });

  it("rejects more than 6 team members", () => {
    const beat = baseTrainerBeat({
      enemyTeam: [
        { speciesId: 1 },
        { speciesId: 2 },
        { speciesId: 3 },
        { speciesId: 4 },
        { speciesId: 5 },
        { speciesId: 6 },
        { speciesId: 7 },
      ],
    });
    expect(validateBeat(beat).ok).toBe(false);
  });

  it("rejects empty enemyTeam", () => {
    const beat = baseTrainerBeat({ enemyTeam: [] });
    expect(validateBeat(beat).ok).toBe(false);
  });

  it("rejects level outside [1, 200]", () => {
    expect(validateBeat(baseTrainerBeat({ enemyTeam: [{ speciesId: 1, level: 0 }] })).ok).toBe(false);
    expect(validateBeat(baseTrainerBeat({ enemyTeam: [{ speciesId: 1, level: 201 }] })).ok).toBe(false);
  });

  it("rejects more than 6 held items", () => {
    const beat = baseTrainerBeat({
      enemyTeam: [
        {
          speciesId: 1,
          heldItemKeys: ["A", "B", "C", "D", "E", "F", "G"],
        },
      ],
    });
    expect(validateBeat(beat).ok).toBe(false);
  });
});

describe("clampAuthoredTeam", () => {
  const team: AuthoredPokemon[] = [
    { speciesId: SpeciesId.PIKACHU, level: 50, moveIds: [1, 2, 3, 4, 5] },
    { speciesId: SpeciesId.CHARIZARD, level: 1 },
  ];

  it("clamps levels to baseLevel ±3 by default", () => {
    const out = clampAuthoredTeam(team, { baseLevel: 20, recentFaints: 0 });
    expect(out[0].level).toBe(23);
    expect(out[1].level).toBe(17);
  });

  it("expands the cap to ±5 for difficultyTag=brutal AND recentFaints==0", () => {
    const out = clampAuthoredTeam(team, { baseLevel: 20, recentFaints: 0, difficultyTag: "brutal" });
    expect(out[0].level).toBe(25);
    expect(out[1].level).toBe(15);
  });

  it("rolls back brutal cap to ±3 when player is struggling", () => {
    const out = clampAuthoredTeam(team, { baseLevel: 20, recentFaints: 2, difficultyTag: "brutal" });
    expect(out[0].level).toBe(23);
    expect(out[1].level).toBe(17);
  });

  it("trims teams beyond 6 members", () => {
    const big: AuthoredPokemon[] = Array.from({ length: 10 }, (_, i) => ({ speciesId: i + 1 }));
    expect(clampAuthoredTeam(big, { baseLevel: 10, recentFaints: 0 })).toHaveLength(6);
  });

  it("trims movesets to 4 entries", () => {
    const out = clampAuthoredTeam(team, { baseLevel: 20, recentFaints: 0 });
    expect(out[0].moveIds).toHaveLength(4);
  });

  it("trims heldItemKeys to 6 entries", () => {
    const t: AuthoredPokemon[] = [{ speciesId: 1, heldItemKeys: ["A", "B", "C", "D", "E", "F", "G", "H"] }];
    const out = clampAuthoredTeam(t, { baseLevel: 10, recentFaints: 0 });
    expect(out[0].heldItemKeys).toHaveLength(6);
  });

  it("never produces a level below 1", () => {
    const t: AuthoredPokemon[] = [{ speciesId: 1, level: 5 }];
    const out = clampAuthoredTeam(t, { baseLevel: 1, recentFaints: 0 });
    expect(out[0].level).toBeGreaterThanOrEqual(1);
  });

  it("preserves omitted level (no override)", () => {
    const t: AuthoredPokemon[] = [{ speciesId: 1 }];
    const out = clampAuthoredTeam(t, { baseLevel: 20, recentFaints: 0 });
    expect(out[0].level).toBeUndefined();
  });
});

describe("authoredTeamToEnemyConfigs", () => {
  it("maps a valid team to EnemyPokemonConfig[]", () => {
    const team: AuthoredPokemon[] = [
      {
        speciesId: SpeciesId.PIKACHU,
        level: 12,
        abilityId: AbilityId.STATIC,
        moveIds: [MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK],
        isBoss: false,
        shiny: true,
        nickname: "Sparky",
      },
    ];
    const result = authoredTeamToEnemyConfigs(team);
    expect(isMapTeamFailure(result)).toBe(false);
    if (isMapTeamFailure(result)) {
      return;
    }
    expect(result.configs).toHaveLength(1);
    const cfg = result.configs[0];
    expect(cfg.species.speciesId).toBe(SpeciesId.PIKACHU);
    expect(cfg.level).toBe(12);
    // STATIC is Pikachu's ability1 → slot 0
    expect(cfg.abilityIndex).toBe(0);
    expect(cfg.moveSet).toEqual([MoveId.THUNDERBOLT, MoveId.QUICK_ATTACK]);
    expect(cfg.shiny).toBe(true);
    expect(cfg.nickname).toBe("Sparky");
    expect(cfg.isBoss).toBe(false);
  });

  it("invokes heldItemResolver for each key and assembles modifierConfigs", () => {
    const team: AuthoredPokemon[] = [
      { speciesId: SpeciesId.PIKACHU, heldItemKeys: ["LEFTOVERS", "UNKNOWN_ITEM", "FOCUS_BAND"] },
    ];
    const seen: string[] = [];
    const resolver = (key: string) => {
      seen.push(key);
      return key === "UNKNOWN_ITEM" ? null : ({ modifier: { tag: key } } as unknown as ReturnType<typeof resolver>);
    };
    const result = authoredTeamToEnemyConfigs(team, resolver);
    expect(isMapTeamFailure(result)).toBe(false);
    if (isMapTeamFailure(result)) {
      return;
    }
    expect(seen).toEqual(["LEFTOVERS", "UNKNOWN_ITEM", "FOCUS_BAND"]);
    expect(result.configs[0].modifierConfigs).toHaveLength(2);
  });

  it("returns failure for empty team", () => {
    const result = authoredTeamToEnemyConfigs([]);
    expect(isMapTeamFailure(result)).toBe(true);
    if (isMapTeamFailure(result)) {
      expect(result.reason).toMatch(/empty/);
    }
  });

  it("returns failure for non-integer speciesId", () => {
    const result = authoredTeamToEnemyConfigs([{ speciesId: 1.5 }]);
    expect(isMapTeamFailure(result)).toBe(true);
    if (isMapTeamFailure(result)) {
      expect(result.reason).toMatch(/invalid-speciesId/);
    }
  });

  it("returns failure for negative speciesId", () => {
    const result = authoredTeamToEnemyConfigs([{ speciesId: -5 }]);
    expect(isMapTeamFailure(result)).toBe(true);
  });

  it("drops abilityId that doesn't match the species", () => {
    // Squirtle's abilities are TORRENT and RAIN_DISH; pass an unrelated id.
    const team: AuthoredPokemon[] = [{ speciesId: SpeciesId.SQUIRTLE, abilityId: AbilityId.STATIC }];
    const result = authoredTeamToEnemyConfigs(team);
    expect(isMapTeamFailure(result)).toBe(false);
    if (isMapTeamFailure(result)) {
      return;
    }
    // abilityIndex stays undefined → engine rolls the default.
    expect(result.configs[0].abilityIndex).toBeUndefined();
  });
});

describe("buildTrainerOverride enemyTeam folding (via beat-utils)", () => {
  it("forwards beat.enemyTeam into trainerOverride.enemyTeam", async () => {
    // Imported lazily so vitest doesn't pull in globalScene-dependent modules.
    const { buildTrainerOverride } = await import("#phases/llm-director-beat-utils");
    const beat = {
      beatId: "t1",
      type: "trainer_battle" as const,
      introText: "x",
      trainerName: "Rival",
      trainerType: 1,
      preBattleText: "x",
      postWinText: "x",
      enemyTeam: [{ speciesId: SpeciesId.PIKACHU, level: 10 }],
    };
    const override = buildTrainerOverride(beat, { recentFaints: 0 });
    expect(override).not.toBeNull();
    expect(override?.trainerOverride?.enemyTeam).toEqual([{ speciesId: SpeciesId.PIKACHU, level: 10 }]);
  });

  it("returns null when nothing to override", async () => {
    const { buildTrainerOverride } = await import("#phases/llm-director-beat-utils");
    const beat = {
      beatId: "t1",
      type: "trainer_battle" as const,
      introText: "x",
      trainerName: "Rival",
      trainerType: 1,
      preBattleText: "x",
      postWinText: "x",
    };
    expect(buildTrainerOverride(beat, { recentFaints: 0 })).toBeNull();
  });
});
