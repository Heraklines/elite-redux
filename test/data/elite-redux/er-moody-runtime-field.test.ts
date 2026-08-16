import { MOODY_BOONS, MOODY_CURSES } from "#data/elite-redux/moody/moody-catalog.generated";
import {
  assertMoodyRuntimeFieldCoverage,
  createMoodyRuntimeFieldState,
  MOODY_RUNTIME_FIELD_BOON_IDS,
  MOODY_RUNTIME_FIELD_COVERAGE,
  MOODY_RUNTIME_FIELD_CURSE_IDS,
  MOODY_RUNTIME_FIELD_VARIANTS,
  type MoodyRuntimeFieldBoonId,
  type MoodyRuntimeFieldCurseId,
  type MoodyRuntimeFieldEvent,
  type MoodyRuntimeFieldState,
  type MoodyRuntimePokemonSnapshot,
  resolveMoodyRuntimeField,
} from "#data/elite-redux/moody/moody-runtime-field";
import type { MoodyBoonInstance, MoodyCurseInstance } from "#data/elite-redux/moody/moody-types";
import { describe, expect, it } from "vitest";

const player: MoodyRuntimePokemonSnapshot = {
  id: 101,
  side: "player",
  partySlot: 0,
  currentHp: 80,
  maxHp: 100,
  status: "burn",
  grounded: true,
  moveCount: 4,
  moveIds: ["flamethrower", "protect", "psychic", "recover"],
  eligibleMoveIds: ["flamethrower", "psychic"],
  compatibleAbilityIds: ["blaze", "magic-guard"],
  types: ["fire"],
};

const ally: MoodyRuntimePokemonSnapshot = {
  id: 102,
  side: "player",
  partySlot: 1,
  currentHp: 30,
  maxHp: 100,
  grounded: true,
  moveCount: 4,
  moveIds: ["tackle", "growl"],
  eligibleMoveIds: ["tackle"],
  compatibleAbilityIds: ["intimidate"],
  types: ["normal"],
};

const faintedAlly: MoodyRuntimePokemonSnapshot = {
  ...ally,
  id: 103,
  partySlot: 2,
  currentHp: 0,
  fainted: true,
};

const enemy: MoodyRuntimePokemonSnapshot = {
  id: 201,
  side: "enemy",
  partySlot: 0,
  currentHp: 100,
  maxHp: 100,
  grounded: true,
  moveCount: 4,
  moveIds: ["surf", "toxic"],
  eligibleMoveIds: ["surf"],
  compatibleAbilityIds: ["torrent"],
  types: ["water"],
};

const base = {
  battleId: "battle:test",
  waveIndex: 100,
  turn: 4,
  seed: 0x12345678,
} as const;

function state(
  options: {
    numbers?: Record<string, number>;
    values?: Record<string, string | number | boolean>;
    lists?: Record<string, readonly string[]>;
  } = {},
): MoodyRuntimeFieldState {
  return {
    numbers: options.numbers ?? {},
    values: options.values ?? {},
    lists: options.lists ?? {},
  };
}

function boon(boonId: MoodyRuntimeFieldBoonId, rank: 1 | 2 | 3 = 1, evolutionId?: string): MoodyBoonInstance {
  return {
    instanceId: `${boonId}:test`,
    boonId,
    rank,
    ...(evolutionId == null ? {} : { evolutionId }),
    acquiredAtWave: 10,
    target: {
      pokemonIds: [player.id],
      partySlots: [player.partySlot],
    },
  };
}

function curse(curseId: MoodyRuntimeFieldCurseId): MoodyCurseInstance {
  return {
    curseId,
    acquiredAtWave: 10,
    ...(curseId === "oathbound" ? { target: { pokemonIds: [player.id] } } : {}),
  };
}

function boonEvent(id: MoodyRuntimeFieldBoonId): {
  event: MoodyRuntimeFieldEvent;
  state?: MoodyRuntimeFieldState;
} {
  const beforeMove: MoodyRuntimeFieldEvent = {
    ...base,
    kind: "before-move",
    user: player,
    target: enemy,
    moveId: "flamethrower",
    moveType: "fire",
    category: "special",
    damaging: true,
    raisesStats: true,
    asleep: true,
    dreamTagged: true,
    weatherWeakens: true,
    legalBestType: "grass",
    weaknessMultiplier: 2,
    actionId: "action:1",
  };
  const moveResolved: MoodyRuntimeFieldEvent = {
    ...base,
    kind: "move-resolved",
    user: player,
    target: enemy,
    moveId: "flamethrower",
    moveType: "fire",
    category: "special",
    damaging: true,
    landed: true,
    dealtDirectDamage: true,
    weaknessMultiplier: 2,
    actionId: "action:1",
  };
  const beforeDamage: MoodyRuntimeFieldEvent = {
    ...base,
    kind: "before-damage",
    source: enemy,
    target: player,
    amount: 80,
    direct: true,
    category: "physical",
    superEffective: true,
    poisonDamage: false,
    hitIndex: 2,
    sameOriginatingAction: true,
  };
  const afterDamage: MoodyRuntimeFieldEvent = {
    ...base,
    kind: "after-damage",
    source: enemy,
    target: player,
    direct: true,
    amount: 30,
    barrierAbsorbed: 20,
    hpAfter: 20,
    crossedQuarterHp: true,
  };
  const entry: MoodyRuntimeFieldEvent = {
    ...base,
    kind: "entry",
    pokemon: player,
    activePokemonIds: [player.id],
    isReentry: false,
    afterAllyFaint: true,
    weatherOptions: ["sun", "rain", "sand", "snow", "fog"],
    terrainOptions: ["electric", "grassy", "misty", "psychic"],
  };
  const statusApplied: MoodyRuntimeFieldEvent = {
    ...base,
    kind: "status-applied",
    target: { ...player, status: "frostbite" },
    status: "frostbite",
  };
  const statusCured: MoodyRuntimeFieldEvent = {
    ...base,
    kind: "status-cured",
    target: player,
    status: "burn",
    adjacentAllies: [ally],
  };
  const battleEnd: MoodyRuntimeFieldEvent = {
    ...base,
    kind: "battle-end",
    won: true,
    party: [player, ally, faintedAlly],
    enteredPokemonIds: [player.id],
    field: [
      { kind: "weather", id: "rain", persistent: true },
      {
        kind: "hazard",
        id: "spikes",
        ownerSide: "player",
        beneficialToOwner: false,
        persistent: true,
      },
    ],
  };
  const faint: MoodyRuntimeFieldEvent = {
    ...base,
    kind: "faint",
    pokemon: player,
    committedMove: {
      moveId: "flamethrower",
      category: "special",
      eligible: true,
    },
    otherConsciousAllies: [ally],
    activeEnemy: enemy,
  };

  switch (id) {
    case "prismatic-opening":
    case "chromatic-relay":
    case "climate-contrarian":
    case "burning-resolve":
      return { event: beforeMove };
    case "insomniac-dreams":
      return { event: { ...beforeMove, category: "status", damaging: false } };
    case "elemental-dividend":
      return { event: moveResolved };
    case "microclimate":
    case "terrain-weaver":
      return { event: entry };
    case "eye-of-the-storm":
    case "weather-wake":
      return {
        event: {
          ...base,
          kind: "weather-transition",
          previous: "rain",
          next: "clear",
          naturalOrReplacement: true,
          activePokemon: player,
          lowestHpBenchedAlly: ally,
        },
      };
    case "four-seasons":
      return {
        event: {
          ...base,
          turn: 12,
          kind: "turn-start",
          activePokemonIds: [player.id],
        },
      };
    case "battlefield-memory":
    case "rest-cycle":
      return { event: battleEnd };
    case "adrenal-condition":
    case "frostbound-time":
      return { event: statusApplied };
    case "toxic-bloom":
      return { event: { ...beforeMove, user: { ...player, status: "toxic" } } };
    case "shared-antibodies":
    case "aftercare":
      return { event: statusCured };
    case "status-bank":
      return {
        event: {
          ...base,
          kind: "status-attempt",
          source: enemy,
          target: player,
          status: "poison",
          legalOnSource: true,
        },
      };
    case "misery-loves-company":
    case "damage-ceiling":
    case "layered-armor":
    case "deferred-pain":
      return { event: beforeDamage };
    case "volatile-memory":
      return {
        event: {
          ...base,
          kind: "volatile-applied",
          target: player,
          volatile: "confusion",
        },
      };
    case "purge-pulse":
      return {
        event: {
          ...base,
          kind: "action-resolved",
          actor: player,
          target: enemy,
          actionId: "action:5",
          boonTriggerCount: 1,
          removableNegativeCount: 3,
        },
        state: state({
          numbers: { [`${base.battleId}:purge-pulse:actions`]: 19 },
        }),
      };
    case "overflow-ward":
    case "shared-cup":
      return {
        event: {
          ...base,
          kind: "heal",
          target: { ...player, currentHp: 95 },
          amount: 25,
          effectiveAmount: 5,
          benchedAllies: [ally],
        },
      };
    case "emergency-shell":
    case "glass-memory":
      return { event: afterDamage };
    case "guarded-setup":
      return { event: { ...beforeMove, category: "status", damaging: false } };
    case "last-rites":
    case "phoenix-clause":
    case "dead-man-s-action":
      return { event: faint };
    case "no-one-left-behind":
      return {
        event: {
          ...base,
          kind: "battle-won",
          party: [player, faintedAlly, { ...faintedAlly, id: 104, partySlot: 3 }],
          selectedReviveIds: [103, 104],
          alliedFaints: 2,
        },
      };
  }
}

function curseEvent(id: MoodyRuntimeFieldCurseId): {
  event: MoodyRuntimeFieldEvent;
  state?: MoodyRuntimeFieldState;
} {
  const beforeMove: MoodyRuntimeFieldEvent = {
    ...base,
    kind: "before-move",
    user: player,
    target: enemy,
    moveId: "flamethrower",
    moveType: "fire",
    category: "special",
    damaging: true,
    actionId: "action:1",
  };
  const beforeDamage: MoodyRuntimeFieldEvent = {
    ...base,
    kind: "before-damage",
    source: enemy,
    target: player,
    amount: 50,
    direct: true,
    category: "special",
    superEffective: true,
  };
  const moveResolved: MoodyRuntimeFieldEvent = {
    ...base,
    kind: "move-resolved",
    user: player,
    target: enemy,
    moveId: "flamethrower",
    moveType: "fire",
    category: "special",
    damaging: true,
    landed: true,
    dealtDirectDamage: true,
    actionId: "action:1",
  };
  const encounter: MoodyRuntimeFieldEvent = {
    ...base,
    kind: "encounter-generate",
    isBoss: true,
    isTrainer: true,
    baseRosterSize: 6,
    playerThreatPokemonId: player.id,
    noFaintWinStreak: 5,
  };
  const faint: MoodyRuntimeFieldEvent = {
    ...base,
    kind: "faint",
    pokemon: player,
    otherConsciousAllies: [ally],
    activeEnemy: enemy,
  };

  switch (id) {
    case "restless-lead":
      return {
        event: {
          ...base,
          kind: "lead-selection",
          pokemonId: player.id,
        },
      };
    case "type-tax":
      return {
        event: beforeMove,
        state: state({
          numbers: { "persistent:type-tax:type:fire:duplicates": 2 },
        }),
      };
    case "slow-to-warm":
      return { event: beforeMove };
    case "fading-momentum":
      return {
        event: {
          ...base,
          turn: 3,
          kind: "turn-end",
          activePokemonIds: [player.id],
        },
      };
    case "exposed-flank":
    case "brittle-weakness":
      return { event: beforeDamage };
    case "accumulated-fatigue":
      return {
        event: {
          ...base,
          kind: "battle-end",
          won: true,
          party: [player, ally],
          enteredPokemonIds: [player.id],
        },
      };
    case "shared-pain":
      return {
        event: {
          ...base,
          kind: "after-damage",
          source: enemy,
          target: player,
          direct: true,
          amount: 40,
          barrierAbsorbed: 0,
          hpAfter: 40,
        },
      };
    case "no-retreat":
    case "withering-pp":
      return id === "withering-pp"
        ? { event: moveResolved, state: state({ numbers: { [`${base.battleId}:withering-pp:uses`]: 3 } }) }
        : { event: moveResolved };
    case "fog-of-war":
    case "public-enemy":
    case "nemesis-protocol":
    case "reverse-snowball":
      return { event: encounter };
    case "oathbound":
      return { event: faint };
    case "sweeper-s-tax":
      return { event: { ...base, kind: "ko", actor: player, defeated: enemy } };
    case "mood-swing":
      return {
        event: {
          ...base,
          kind: "battle-start",
          isBoss: true,
          isTrainer: true,
          activePokemonId: player.id,
          party: [player, ally],
        },
      };
    case "blood-moon":
      return {
        event: {
          ...base,
          kind: "battle-won",
          party: [
            { ...enemy, fainted: true, currentHp: 0 },
            { ...enemy, id: 202, fainted: true, currentHp: 0 },
          ],
          alliedFaints: 0,
        },
      };
    case "cursed-draft":
      return {
        event: {
          ...base,
          kind: "boon-draft",
          offerIds: ["offer:a", "offer:b", "offer:c"],
        },
      };
    case "entropy":
      return {
        event: {
          ...base,
          kind: "biome-transition",
          party: [player, ally],
          replacementMoveCandidates: {
            [player.id]: ["ice-beam"],
            [ally.id]: ["quick-attack"],
          },
        },
      };
    case "feedback-loop":
      return {
        event: {
          ...base,
          kind: "action-resolved",
          actor: player,
          target: enemy,
          actionId: "action:1",
          boonTriggerCount: 4,
          removableNegativeCount: 0,
        },
      };
  }
}

describe("Moody runtime field coverage", () => {
  it("matches exactly boon lines 38-71 and the requested curse numbers", () => {
    expect(() => assertMoodyRuntimeFieldCoverage()).not.toThrow();
    expect(MOODY_RUNTIME_FIELD_COVERAGE.boonNumbers).toEqual(Array.from({ length: 34 }, (_, index) => index + 38));
    expect(MOODY_RUNTIME_FIELD_BOON_IDS).toEqual(
      MOODY_BOONS.filter(definition => definition.number >= 38 && definition.number <= 71).map(
        definition => definition.id,
      ),
    );
    expect(MOODY_RUNTIME_FIELD_CURSE_IDS).toEqual(
      MOODY_CURSES.filter(definition => MOODY_RUNTIME_FIELD_COVERAGE.curseNumbers.includes(definition.number)).map(
        definition => definition.id,
      ),
    );
    expect(Object.keys(MOODY_RUNTIME_FIELD_VARIANTS)).toEqual([...MOODY_RUNTIME_FIELD_BOON_IDS]);
  });

  for (const boonId of MOODY_RUNTIME_FIELD_BOON_IDS) {
    const variants = MOODY_RUNTIME_FIELD_VARIANTS[boonId];
    for (const variant of [
      { name: "base", instance: boon(boonId, 1) },
      { name: "rank II", instance: boon(boonId, 2) },
      ...variants.evolutionIds.map(evolutionId => ({
        name: evolutionId,
        instance: boon(boonId, 3, evolutionId),
      })),
    ]) {
      it(`${boonId} ${variant.name} emits an explicit command or state delta`, () => {
        const fixture = boonEvent(boonId);
        const result = resolveMoodyRuntimeField({
          ownerSide: "player",
          boons: [variant.instance],
          curses: [],
          state: fixture.state ?? createMoodyRuntimeFieldState(),
          event: fixture.event,
        });
        expect(result.triggeredEffectIds, JSON.stringify(result, null, 2)).toContain(boonId);
        expect(result.commands.length + result.deltas.length).toBeGreaterThan(0);
        expect(result.commands.every(command => command.effectId === boonId)).toBe(true);
      });
    }
  }

  for (const curseId of MOODY_RUNTIME_FIELD_CURSE_IDS) {
    it(`${curseId} emits an explicit command or state delta`, () => {
      const fixture = curseEvent(curseId);
      const result = resolveMoodyRuntimeField({
        ownerSide: "player",
        boons: [],
        curses: [curse(curseId)],
        state: fixture.state ?? createMoodyRuntimeFieldState(),
        event: fixture.event,
      });
      expect(result.triggeredEffectIds, JSON.stringify(result, null, 2)).toContain(curseId);
      expect(result.commands.length + result.deltas.length).toBeGreaterThan(0);
      expect(result.commands.every(command => command.effectId === curseId)).toBe(true);
    });
  }
});

describe("Moody runtime field deterministic mechanics", () => {
  it("does not mutate its state, loadout, or event and is replay deterministic", () => {
    const inputState = state({
      numbers: { stable: 7 },
      lists: { stable: ["a"] },
    });
    const inputBoon = boon("elemental-dividend", 3, "diversified-portfolio");
    const event = boonEvent("elemental-dividend").event;
    const snapshot = structuredClone({ inputState, inputBoon, event });
    const first = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [inputBoon],
      curses: [],
      state: inputState,
      event,
    });
    const second = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [inputBoon],
      curses: [],
      state: inputState,
      event,
    });

    expect(first).toEqual(second);
    expect({ inputState, inputBoon, event }).toEqual(snapshot);
    expect(first.state).not.toBe(inputState);
  });

  it("implements Prismatic Opening base, rank, and both evolutions numerically", () => {
    const event = boonEvent("prismatic-opening").event;
    const multiplier = (instance: MoodyBoonInstance) =>
      resolveMoodyRuntimeField({
        ownerSide: "player",
        boons: [instance],
        curses: [],
        state: createMoodyRuntimeFieldState(),
        event,
      }).commands.find(command => command.kind === "modify-damage")?.multiplier;

    expect(multiplier(boon("prismatic-opening", 1))).toBe(0.7);
    expect(multiplier(boon("prismatic-opening", 2))).toBe(0.8);
    expect(multiplier(boon("prismatic-opening", 3, "perfect-refraction"))).toBe(1);
    expect(multiplier(boon("prismatic-opening", 3, "prismatic-doctrine"))).toBe(0.65);
  });

  it("applies the reduced Rest Cycle healing at both ranks", () => {
    const event = boonEvent("rest-cycle").event;
    const healing = (rank: 1 | 2) =>
      resolveMoodyRuntimeField({
        ownerSide: "player",
        boons: [boon("rest-cycle", rank)],
        curses: [],
        state: createMoodyRuntimeFieldState(),
        event,
      }).commands.find(command => command.kind === "heal")?.fraction;

    expect(healing(1)).toBe(0.05);
    expect(healing(2)).toBe(0.1);
  });

  it("only heals Cauterized after a successful damaging action", () => {
    const cauterized = boon("burning-resolve", 3, "cauterized");
    const before = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [cauterized],
      curses: [],
      state: createMoodyRuntimeFieldState(),
      event: boonEvent("burning-resolve").event,
    });
    expect(before.commands).not.toContainEqual(expect.objectContaining({ kind: "heal" }));

    const resolved = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [cauterized],
      curses: [],
      state: before.state,
      event: {
        ...base,
        kind: "move-resolved",
        user: player,
        target: enemy,
        moveId: "flamethrower",
        moveType: "fire",
        category: "special",
        damaging: true,
        landed: true,
        dealtDirectDamage: true,
        actionId: "cauterized:hit",
      },
    });
    expect(resolved.commands).toContainEqual(
      expect.objectContaining({ kind: "heal", subjectId: player.id, fraction: 0.05 }),
    );
  });

  it("grants Shared Dream's ally stat only after its allowed action lands", () => {
    const sharedDream = boon("insomniac-dreams", 3, "shared-dream");
    const actionId = "shared-dream:status";
    const prepared = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [sharedDream],
      curses: [],
      state: createMoodyRuntimeFieldState(),
      event: {
        ...boonEvent("insomniac-dreams").event,
        actionId,
      } as MoodyRuntimeFieldEvent,
    });
    const resolved = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [sharedDream],
      curses: [],
      state: prepared.state,
      event: {
        ...base,
        kind: "move-resolved",
        user: { ...player, status: "sleep" },
        target: enemy,
        moveId: "protect",
        moveType: "normal",
        category: "status",
        damaging: false,
        landed: true,
        dealtDirectDamage: false,
        actionId,
      },
    });
    expect(resolved.commands).toContainEqual(
      expect.objectContaining({
        kind: "modify-stat",
        amount: 1,
        value: "seeded-random",
        data: expect.objectContaining({ target: "lowest-hp-other-ally", excludePokemonId: player.id }),
      }),
    );
  });

  it("removes Ashen Return's temporary all-stat boost after three turns", () => {
    const ashen = boon("phoenix-clause", 3, "ashen-return");
    const revived = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [ashen],
      curses: [],
      state: createMoodyRuntimeFieldState(),
      event: boonEvent("phoenix-clause").event,
    });
    expect(revived.commands).toContainEqual(
      expect.objectContaining({
        kind: "revive",
        subjectId: player.id,
        data: expect.objectContaining({ allStats: 1, statDuration: 3 }),
      }),
    );

    const expired = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [ashen],
      curses: [],
      state: revived.state,
      event: { ...base, turn: base.turn + 3, kind: "turn-end", activePokemonIds: [player.id] },
    });
    expect(expired.commands).toContainEqual(
      expect.objectContaining({ kind: "modify-stat", subjectId: player.id, amount: -1, value: "all" }),
    );
  });

  it("records Restless Lead at encounter selection and rejects it on the next battle", () => {
    const selected = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("restless-lead")],
      state: createMoodyRuntimeFieldState(),
      event: { ...base, kind: "lead-selection", pokemonId: player.id },
    });
    expect(selected.state.values["persistent:restless-lead:last-lead"]).toBe(player.id);
    expect(selected.commands).not.toContainEqual(expect.objectContaining({ kind: "invalidate-lead" }));

    const repeated = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("restless-lead")],
      state: selected.state,
      event: { ...base, battleId: "battle:next", kind: "lead-selection", pokemonId: player.id },
    });
    expect(repeated.commands).toContainEqual(
      expect.objectContaining({ kind: "invalidate-lead", subjectId: player.id }),
    );
    expect(repeated.state.values["persistent:restless-lead:last-lead"]).toBe(player.id);

    const replacement = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("restless-lead")],
      state: repeated.state,
      event: { ...base, battleId: "battle:next", kind: "lead-selection", pokemonId: ally.id },
    });
    expect(replacement.state.values["persistent:restless-lead:last-lead"]).toBe(ally.id);
  });

  it("applies Exposed Flank only to a Pokemon's first direct hit in each battle", () => {
    const firstHit = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("exposed-flank")],
      state: createMoodyRuntimeFieldState(),
      event: { ...base, kind: "before-damage", source: enemy, target: player, amount: 40, direct: true },
    });
    expect(firstHit.commands).toContainEqual(
      expect.objectContaining({ kind: "modify-damage", effectId: "exposed-flank", multiplier: 1.15 }),
    );

    const laterTurn = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("exposed-flank")],
      state: firstHit.state,
      event: {
        ...base,
        turn: base.turn + 1,
        kind: "before-damage",
        source: enemy,
        target: player,
        amount: 40,
        direct: true,
      },
    });
    expect(laterTurn.commands).not.toContainEqual(
      expect.objectContaining({ kind: "modify-damage", effectId: "exposed-flank" }),
    );

    const nextBattle = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("exposed-flank")],
      state: laterTurn.state,
      event: {
        ...base,
        battleId: "battle:next",
        kind: "before-damage",
        source: enemy,
        target: player,
        amount: 40,
        direct: true,
      },
    });
    expect(nextBattle.commands).toContainEqual(
      expect.objectContaining({ kind: "modify-damage", effectId: "exposed-flank", multiplier: 1.15 }),
    );
  });

  it("applies Type Tax only to duplicated move types and emits nothing for unaffected types", () => {
    const event = boonEvent("prismatic-opening").event;
    expect(event.kind).toBe("before-move");
    if (event.kind !== "before-move") {
      throw new Error("Prismatic Opening fixture must use a before-move event");
    }
    const unaffected = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("type-tax")],
      state: createMoodyRuntimeFieldState(),
      event,
    });
    expect(unaffected.commands).toEqual([]);
    expect(unaffected.triggeredEffectIds).toEqual([]);

    const duplicated = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("type-tax")],
      state: state({ numbers: { "persistent:type-tax:type:fire:duplicates": 2 } }),
      event,
    });
    expect(duplicated.commands).toContainEqual(
      expect.objectContaining({ kind: "modify-damage", effectId: "type-tax", multiplier: 0.92 }),
    );

    const opponent = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("type-tax")],
      state: state({ numbers: { "persistent:type-tax:type:fire:duplicates": 2 } }),
      event: {
        ...event,
        user: { ...event.user, side: "enemy" },
      },
    });
    expect(opponent.commands).toEqual([]);
    expect(opponent.triggeredEffectIds).toEqual([]);
  });

  it("limits Public Enemy roster growth to trainers and gives boss trainers one complete Second Act", () => {
    const wild = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("public-enemy")],
      state: createMoodyRuntimeFieldState(),
      event: {
        ...base,
        kind: "encounter-generate",
        isBoss: false,
        isTrainer: false,
        baseRosterSize: 1,
        noFaintWinStreak: 0,
      },
    });
    expect(wild.commands).toEqual([]);

    const trainer = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("public-enemy")],
      state: createMoodyRuntimeFieldState(),
      event: {
        ...base,
        kind: "encounter-generate",
        isBoss: false,
        isTrainer: true,
        baseRosterSize: 4,
        noFaintWinStreak: 0,
      },
    });
    const rosterSize = trainer.commands.find(command => command.kind === "set-enemy-roster-size")?.amount;
    expect(rosterSize).toBeGreaterThanOrEqual(7);
    expect(rosterSize).toBeLessThanOrEqual(8);

    const secondAct = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("public-enemy")],
      state: createMoodyRuntimeFieldState(),
      event: {
        ...base,
        kind: "faint",
        isBoss: true,
        pokemon: { ...enemy, currentHp: 0, fainted: true },
        otherConsciousAllies: [],
        finalEnemyPokemon: true,
      },
    });
    expect(secondAct.commands).toContainEqual(
      expect.objectContaining({
        kind: "revive",
        fraction: 1,
        data: expect.objectContaining({ healthSegments: 1, allStats: 1 }),
      }),
    );
    expect(secondAct.state.values[`${base.battleId}:public-enemy:second-act-used`]).toBe(true);
  });

  it("caps Reverse Snowball at +30% enemy stats", () => {
    const result = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("reverse-snowball")],
      state: createMoodyRuntimeFieldState(),
      event: {
        ...base,
        kind: "encounter-generate",
        isBoss: false,
        isTrainer: false,
        baseRosterSize: 1,
        noFaintWinStreak: 99,
      },
    });
    expect(result.commands).toContainEqual(
      expect.objectContaining({ kind: "apply-enemy-stat-multiplier", multiplier: 1.3 }),
    );
  });

  it("only advances Reverse Snowball after a flawless win", () => {
    const persistentKey = "persistent:reverse-snowball:streak";
    const runtimeState = { numbers: { [persistentKey]: 4 }, values: {}, lists: {} };
    const held = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("reverse-snowball")],
      state: runtimeState,
      event: {
        ...base,
        kind: "battle-won",
        party: [player, ally, { ...ally, id: 103 }],
        alliedFaints: 1,
      },
    });
    expect(held.state.numbers[persistentKey]).toBe(4);
    expect(held.commands).toContainEqual(expect.objectContaining({ kind: "mark-trigger", value: "streak-held" }));

    const advanced = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("reverse-snowball")],
      state: held.state,
      event: {
        ...base,
        kind: "battle-won",
        party: [player, ally, { ...ally, id: 103 }],
        alliedFaints: 0,
      },
    });
    expect(advanced.state.numbers[persistentKey]).toBe(5);

    const reset = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("reverse-snowball")],
      state: advanced.state,
      event: {
        ...base,
        kind: "battle-won",
        party: [player, ally, { ...ally, id: 103 }],
        alliedFaints: 2,
      },
    });
    expect(reset.state.numbers[persistentKey]).toBe(0);
  });

  it("expires Community Care's adjacent stat rebound after one full turn", () => {
    const community = boon("aftercare", 3, "community-care");
    const cured = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [community],
      curses: [],
      state: createMoodyRuntimeFieldState(),
      event: {
        ...base,
        kind: "status-cured",
        target: player,
        status: "burn",
        adjacentAllies: [ally],
      },
    });
    expect(cured.commands).toContainEqual(
      expect.objectContaining({ kind: "modify-stat", subjectId: player.id, amount: 1, value: "attack" }),
    );
    expect(cured.commands).toContainEqual(
      expect.objectContaining({
        kind: "modify-stat",
        subjectId: ally.id,
        amount: 1,
        value: "attack",
        durationTurns: 1,
      }),
    );

    const beforeExpiry = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [community],
      curses: [],
      state: cured.state,
      event: { ...base, kind: "turn-end", activePokemonIds: [player.id, ally.id] },
    });
    expect(beforeExpiry.commands).not.toContainEqual(expect.objectContaining({ kind: "modify-stat", amount: -1 }));

    const expired = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [community],
      curses: [],
      state: beforeExpiry.state,
      event: { ...base, turn: base.turn + 1, kind: "turn-end", activePokemonIds: [player.id, ally.id] },
    });
    expect(expired.commands).toContainEqual(
      expect.objectContaining({ kind: "modify-stat", subjectId: ally.id, amount: -1, value: "attack" }),
    );
  });

  it("keeps Status Bank FIFO and upgrades held poison after a full turn", () => {
    const bank = boon("status-bank", 3, "interest-bearing-status");
    const stored = state({
      lists: {
        [`${base.battleId}:status-bank:stored`]: ["poison@2", "burn@3"],
      },
    });
    const result = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [bank],
      curses: [],
      state: stored,
      event: boonEvent("elemental-dividend").event,
    });

    expect(result.commands).toContainEqual(
      expect.objectContaining({
        kind: "apply-status",
        effectId: "status-bank",
        subjectId: enemy.id,
        value: "toxic",
      }),
    );
    expect(result.state.lists[`${base.battleId}:status-bank:stored`]).toEqual(["burn@3"]);
  });

  it("caps and carries Deferred Pain debt, then allows Debt Restructuring to collect through barriers", () => {
    const first = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [boon("deferred-pain", 3, "debt-restructuring")],
      curses: [],
      state: createMoodyRuntimeFieldState(),
      event: boonEvent("deferred-pain").event,
    });
    expect(first.commands).toContainEqual(expect.objectContaining({ kind: "split-damage", fraction: 0.5 }));
    expect(first.state.numbers["persistent:deferred-pain:pokemon:101:debt"]).toBe(40);

    const collected = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [boon("deferred-pain", 3, "debt-restructuring")],
      curses: [],
      state: first.state,
      event: {
        ...base,
        turn: 5,
        kind: "turn-end",
        activePokemonIds: [player.id],
      },
    });
    expect(collected.commands).toContainEqual(
      expect.objectContaining({
        kind: "collect-damage-debt",
        amount: 40,
        data: expect.objectContaining({ barriersMayAbsorb: true }),
      }),
    );
  });

  it("calculates Feedback Loop tiers and preserves its nonlethal floor command", () => {
    const result = resolveMoodyRuntimeField({
      ownerSide: "player",
      boons: [],
      curses: [curse("feedback-loop")],
      state: createMoodyRuntimeFieldState(),
      event: curseEvent("feedback-loop").event,
    });
    expect(result.commands).toContainEqual(
      expect.objectContaining({
        kind: "nonlethal-damage",
        fraction: 0.18,
        data: expect.objectContaining({ minimumHp: 1, triggerCount: 4 }),
      }),
    );
  });
});
