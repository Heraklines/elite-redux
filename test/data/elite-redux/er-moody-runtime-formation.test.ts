import { MOODY_BOONS } from "#data/elite-redux/moody/moody-catalog.generated";
import {
  createMoodyFormationRuntimeState,
  MOODY_FORMATION_BOON_IDS,
  MOODY_FORMATION_RUNTIME_COVERAGE,
  MOODY_FORMATION_RUNTIME_DEFINITIONS,
  type MoodyFormationBoonId,
  type MoodyFormationEffect,
  type MoodyFormationEvent,
  type MoodyFormationPokemonSnapshot,
  type MoodyFormationResolution,
  type MoodyFormationRuntimeState,
  resolveMoodyFormationEffect,
} from "#data/elite-redux/moody/moody-runtime-formation";
import { describe, expect, it } from "vitest";

const lead: MoodyFormationPokemonSnapshot = {
  pokemonId: 1,
  partySlot: 0,
  currentHp: 80,
  maxHp: 100,
  conscious: true,
  positiveStages: { attack: 2, speed: 1 },
  negativeStages: { defense: -1 },
  highestOffensiveStat: "attack",
  highestNonHpStat: "speed",
  highestDefensiveStat: "defense",
  mostDepletedMoveId: 10,
  allPpFull: false,
};

const partner: MoodyFormationPokemonSnapshot = {
  ...lead,
  pokemonId: 2,
  partySlot: 1,
  currentHp: 40,
  highestOffensiveStat: "specialAttack",
};

const reserve: MoodyFormationPokemonSnapshot = {
  ...lead,
  pokemonId: 3,
  partySlot: 2,
  currentHp: 20,
};

const party = { slots: [lead, partner, reserve, null, null, null] } as const;

function effect(
  boonId: MoodyFormationBoonId,
  variant: "base" | "rank-two" | "evolution-a" | "evolution-b" = "base",
): MoodyFormationEffect {
  const definition = MOODY_FORMATION_RUNTIME_DEFINITIONS[boonId];
  return {
    instanceId: `${boonId}:${variant}`,
    boonId,
    rank: variant === "base" ? 1 : variant === "rank-two" ? 2 : 3,
    ...(variant === "evolution-a"
      ? { evolutionId: definition.evolutionIds[0] }
      : variant === "evolution-b"
        ? { evolutionId: definition.evolutionIds[1] }
        : {}),
    target: {
      pokemonIds: [lead.pokemonId, partner.pokemonId],
      partySlots: [lead.partySlot, partner.partySlot],
      moveIds: [10, 11],
      itemStackIds: ["leftovers:1", "berry:1"],
      elementalType: "fire",
      moveTag: "punch",
    },
  };
}

function moveAttempt(
  overrides: Partial<Extract<MoodyFormationEvent, { type: "move-attempt" }>> = {},
): Extract<MoodyFormationEvent, { type: "move-attempt" }> {
  return {
    type: "move-attempt",
    user: lead,
    targetPokemonId: 99,
    targetTypes: ["fire"],
    moveId: 10,
    moveType: "fire",
    category: "physical",
    moveTags: ["punch"],
    damaging: true,
    echoEligible: true,
    priority: 1,
    ppBefore: 1,
    maxPp: 10,
    useNumber: 3,
    consecutiveUse: 5,
    isStab: false,
    previousAlliedAction: {
      pokemonId: partner.pokemonId,
      moveType: "fire",
      damaging: true,
    },
    opponentLastMoveId: 40,
    finalDraftEndings: ["climax", "precision"],
    ...overrides,
  };
}

function universalEvents(): MoodyFormationEvent[] {
  const events: MoodyFormationEvent[] = [
    { type: "battle-start", battleId: "battle-1", wave: 30, biome: 2, party },
    { type: "wave-start", wave: 30, seed: 8675309, party },
    { type: "turn-start", turn: 1 },
    {
      type: "entry",
      pokemon: lead,
      firstEntryThisBattle: true,
      afterAllyFainted: true,
      allyDamagedEarlierThisTurn: true,
    },
    {
      type: "entry",
      pokemon: reserve,
      firstEntryThisBattle: true,
      afterAllyFainted: true,
      allyDamagedEarlierThisTurn: true,
    },
    { type: "status-directed", target: lead, status: "burn", volatile: false },
    { type: "stat-drop-directed", target: lead, stat: "attack", stages: 1 },
    moveAttempt(),
    {
      type: "move-resolved",
      user: lead,
      moveId: 10,
      moveSlot: 0,
      moveType: "fire",
      category: "physical",
      damaging: true,
      outcome: "failed",
      selectedStats: ["speed", "attack"],
      selectedRepertoireRewards: ["barrier", "heal", "restore-pp"],
    },
    { type: "opponent-move", moveId: 40, userPokemonId: 99 },
    { type: "opponent-move", moveId: 40, userPokemonId: 99 },
    moveAttempt({ moveId: 11, ppBefore: 0, opponentLastMoveId: 40 }),
    {
      type: "switch",
      voluntary: true,
      outgoing: lead,
      incoming: partner,
      allyDamagedEarlierThisTurn: true,
      selectedPositiveStages: [
        { stat: "attack", stages: 2 },
        { stat: "speed", stages: 1 },
      ],
      selectedBorrowedSecondaryId: "burn-30",
    },
    {
      type: "damage-received",
      target: lead,
      sourcePokemonId: 99,
      moveType: "fire",
      direct: true,
    },
    {
      type: "damage-received",
      target: lead,
      sourcePokemonId: 99,
      moveType: "fire",
      direct: true,
    },
    {
      type: "enemy-stat-increase",
      stat: "specialAttack",
      stages: 2,
      selectedAdjacentPokemonId: reserve.pokemonId,
    },
    {
      type: "item-activation",
      pokemonId: lead.pokemonId,
      itemStackId: "leftovers:1",
      adapter: "magnitude",
    },
    {
      type: "item-activation",
      pokemonId: lead.pokemonId,
      itemStackId: "berry:1",
      adapter: "charges",
    },
    {
      type: "turn-complete",
      turn: 1,
      pokemonId: lead.pokemonId,
      partySlot: lead.partySlot,
      active: true,
    },
    {
      type: "turn-complete",
      turn: 2,
      pokemonId: lead.pokemonId,
      partySlot: lead.partySlot,
      active: true,
    },
    {
      type: "turn-complete",
      turn: 3,
      pokemonId: lead.pokemonId,
      partySlot: lead.partySlot,
      active: true,
    },
    {
      type: "turn-complete",
      turn: 1,
      pokemonId: lead.pokemonId,
      partySlot: lead.partySlot,
      active: false,
    },
    {
      type: "turn-complete",
      turn: 2,
      pokemonId: lead.pokemonId,
      partySlot: lead.partySlot,
      active: false,
    },
    {
      type: "turn-complete",
      turn: 3,
      pokemonId: lead.pokemonId,
      partySlot: lead.partySlot,
      active: false,
    },
    { type: "exit", pokemonId: lead.pokemonId, partySlot: lead.partySlot },
    {
      type: "entry",
      pokemon: lead,
      firstEntryThisBattle: false,
      afterAllyFainted: false,
      allyDamagedEarlierThisTurn: true,
    },
    moveAttempt({ priority: 0, useNumber: 4 }),
    {
      type: "knockout",
      attacker: lead,
      defeatedPokemonId: 99,
      defeatedTypes: ["fire"],
      elite: true,
      boss: true,
      bossSegmentBreak: true,
      tenWaveSegment: 3,
    },
    {
      type: "fainted",
      pokemon: partner,
      party: {
        slots: [lead, { ...partner, conscious: false }, reserve, null, null, null],
      },
    },
    { type: "final-conscious", pokemon: lead },
    {
      type: "lethal-check",
      target: lead,
      hpBeforeFraction: 0.8,
      bossBattle: true,
      biome: 2,
    },
    { type: "status-cured", pokemon: lead, status: "burn" },
    { type: "status-cured", pokemon: lead, status: "burn" },
    { type: "status-cured", pokemon: lead, status: "burn" },
    { type: "status-cured", pokemon: lead, status: "burn" },
    { type: "status-cured", pokemon: lead, status: "burn" },
    { type: "status-cured", pokemon: lead, status: "burn" },
    {
      type: "evaluate",
      pokemon: { ...lead, majorStatus: "burn" },
      party,
      turn: 1,
    },
    {
      type: "move-resolved",
      user: lead,
      moveId: 10,
      moveSlot: 1,
      moveType: "water",
      category: "special",
      damaging: true,
      outcome: "hit",
      selectedStats: ["speed", "attack"],
      selectedRepertoireRewards: ["heal", "random-stat"],
    },
    {
      type: "move-resolved",
      user: lead,
      moveId: 10,
      moveSlot: 2,
      moveType: "normal",
      category: "status",
      damaging: false,
      outcome: "hit",
      selectedStats: ["speed", "attack"],
      selectedRepertoireRewards: ["cleanse", "next-priority"],
    },
    {
      type: "move-resolved",
      user: lead,
      moveId: 10,
      moveSlot: 3,
      moveType: "electric",
      category: "physical",
      damaging: true,
      outcome: "hit",
      selectedStats: ["speed", "attack"],
      selectedRepertoireRewards: ["type-resistance"],
    },
    { type: "turn-start", turn: 2 },
    { type: "status-directed", target: lead, status: "sleep", volatile: false },
    { type: "battle-end", battleId: "battle-1" },
  ];
  return events;
}

function run(
  events: readonly MoodyFormationEvent[],
  selectedEffect: MoodyFormationEffect,
  initial = createMoodyFormationRuntimeState(),
): MoodyFormationResolution {
  let state: MoodyFormationRuntimeState = initial;
  let triggered = false;
  const commands: MoodyFormationResolution["commands"][number][] = [];
  for (const event of events) {
    const resolution = resolveMoodyFormationEffect(selectedEffect, state, event);
    state = resolution.state;
    triggered ||= resolution.triggered;
    commands.push(...resolution.commands);
  }
  return { state, commands, triggered };
}

describe("Moody formation runtime coverage", () => {
  it("equals exactly catalogue boon lines 01-37", () => {
    const catalogueIds = MOODY_BOONS.filter(boon => boon.number >= 1 && boon.number <= 37).map(boon => boon.id);
    expect([...MOODY_FORMATION_RUNTIME_COVERAGE]).toEqual(catalogueIds);
    expect([...MOODY_FORMATION_RUNTIME_COVERAGE]).toEqual(MOODY_FORMATION_BOON_IDS);
    expect(MOODY_FORMATION_RUNTIME_COVERAGE.size).toBe(37);
  });

  it.each(MOODY_FORMATION_BOON_IDS)("%s exposes complete base, rank II, and evolution metadata", boonId => {
    const definition = MOODY_FORMATION_RUNTIME_DEFINITIONS[boonId];
    expect(definition.number).toBe(MOODY_FORMATION_BOON_IDS.indexOf(boonId) + 1);
    expect(definition.evolutionIds).toHaveLength(2);
    expect(new Set(definition.evolutionIds).size).toBe(2);
    expect(Object.values(definition.triggerDescriptions)).toHaveLength(4);
    expect(Object.values(definition.triggerDescriptions).every(description => description.length >= 10)).toBe(true);
  });
});

describe("Moody formation runtime variants", () => {
  const variants = ["base", "rank-two", "evolution-a", "evolution-b"] as const;

  for (const boonId of MOODY_FORMATION_BOON_IDS) {
    it.each(variants)(`${boonId} executes its %s lane deterministically`, variant => {
      const selectedEffect = effect(boonId, variant);
      const events = universalEvents();
      const first = run(events, selectedEffect);
      const second = run(events, selectedEffect);
      expect(first.triggered).toBe(true);
      expect(first).toEqual(second);
      expect(first.commands.every(command => command.source === boonId)).toBe(true);
    });
  }

  it("rejects an evolution from another boon", () => {
    expect(() =>
      resolveMoodyFormationEffect(
        {
          ...effect("crowned-vanguard", "evolution-a"),
          evolutionId: "citadel-seat",
        },
        createMoodyFormationRuntimeState(),
        moveAttempt(),
      ),
    ).toThrow(/Invalid evolution/);
  });
});

describe("Moody formation state transitions and command contracts", () => {
  it("keeps caller-owned state and events immutable", () => {
    const initial = createMoodyFormationRuntimeState();
    const event = moveAttempt();
    const initialSnapshot = structuredClone(initial);
    const eventSnapshot = structuredClone(event);
    resolveMoodyFormationEffect(effect("signature-technique"), initial, event);
    expect(initial).toEqual(initialSnapshot);
    expect(event).toEqual(eventSnapshot);
  });

  it("rearms Royal Vanguard only after three complete bench turns", () => {
    const selected = effect("crowned-vanguard", "evolution-a");
    const result = run(
      [
        { type: "battle-start", battleId: "b", wave: 10, biome: 1, party },
        moveAttempt({ priority: 0 }),
        {
          type: "turn-complete",
          turn: 1,
          pokemonId: lead.pokemonId,
          partySlot: 0,
          active: false,
        },
        {
          type: "turn-complete",
          turn: 2,
          pokemonId: lead.pokemonId,
          partySlot: 0,
          active: false,
        },
        {
          type: "turn-complete",
          turn: 3,
          pokemonId: lead.pokemonId,
          partySlot: 0,
          active: false,
        },
        {
          type: "entry",
          pokemon: lead,
          firstEntryThisBattle: false,
          afterAllyFainted: false,
          allyDamagedEarlierThisTurn: false,
        },
        moveAttempt({ priority: 0 }),
      ],
      selected,
    );
    expect(result.commands.filter(command => command.kind === "modify-action")).toHaveLength(2);
  });

  it("banks and consumes Hungry Seat Feast tokens across battles", () => {
    const selected = effect("hungry-seat", "rank-two");
    const knockout: MoodyFormationEvent = {
      type: "knockout",
      attacker: lead,
      defeatedPokemonId: 99,
      defeatedTypes: ["water"],
      elite: false,
      boss: false,
      bossSegmentBreak: false,
      tenWaveSegment: 1,
    };
    const result = run(
      [knockout, knockout, { type: "battle-start", battleId: "next", wave: 11, biome: 1, party }],
      selected,
    );
    expect(result.commands).toContainEqual({
      kind: "heal",
      source: "hungry-seat",
      pokemonId: 1,
      maxHpFraction: 0.2,
    });
    expect(result.state.counters.feastTokens).toBe(0);
  });

  it("keeps Empty Throne current HP unchanged while deriving all three modifiers", () => {
    const result = run([{ type: "evaluate", pokemon: lead, party, turn: 1 }], effect("empty-throne", "evolution-a"));
    const modifier = result.commands.find(command => command.kind === "max-hp-and-damage");
    expect(modifier).toMatchObject({
      kind: "max-hp-and-damage",
      source: "empty-throne",
      pokemonId: 1,
      speedMultiplier: 1.15,
      preserveCurrentHp: true,
    });
    expect(modifier?.kind === "max-hp-and-damage" ? modifier.maxHpMultiplier : 0).toBeCloseTo(1.36);
    expect(modifier?.kind === "max-hp-and-damage" ? modifier.damageMultiplier : 0).toBeCloseTo(1.36);
  });

  it("tracks persistent Glory and status-cure progression", () => {
    const glory = run(
      [
        {
          type: "knockout",
          attacker: lead,
          defeatedPokemonId: 99,
          defeatedTypes: ["water"],
          elite: true,
          boss: false,
          bossSegmentBreak: false,
          tenWaveSegment: 2,
        },
        { type: "evaluate", pokemon: lead, party, turn: 1 },
      ],
      effect("chosen-one", "rank-two"),
    );
    expect(glory.state.counters.glory).toBe(1);
    expect(glory.commands).toContainEqual({
      kind: "mark",
      source: "chosen-one",
      name: "outgoingDamageMultiplier",
      value: 1.02,
    });

    const cureEvents: MoodyFormationEvent[] = [
      ...Array.from({ length: 6 }, () => ({ type: "status-cured", pokemon: lead, status: "burn" }) as const),
      {
        type: "evaluate",
        pokemon: { ...lead, majorStatus: "burn" },
        party,
        turn: 1,
      },
    ];
    const cures = run(cureEvents, effect("mithridatism", "evolution-a"));
    expect(cures.state.counters["cures.burn"]).toBe(6);
    expect(cures.commands).toContainEqual({
      kind: "status-resistance",
      source: "mithridatism",
      pokemonId: 1,
      status: "burn",
      tier: "immune",
    });
  });

  it("learns Scar Reader resistance after the first hit, not during it", () => {
    const selected = effect("scar-reader");
    const first = resolveMoodyFormationEffect(selected, createMoodyFormationRuntimeState(), {
      type: "damage-received",
      target: lead,
      moveType: "water",
      direct: true,
    });
    expect(first.commands).toHaveLength(0);
    const second = resolveMoodyFormationEffect(selected, first.state, {
      type: "damage-received",
      target: lead,
      moveType: "water",
      direct: true,
    });
    expect(second.commands).toContainEqual({
      kind: "modify-action",
      source: "scar-reader",
      pokemonId: 1,
      incomingDamageMultiplier: 0.75,
    });
  });

  it("applies School Founder to matching tagged moves beyond the original move", () => {
    const result = run(
      [moveAttempt({ moveId: 99, moveTags: ["punch"], useNumber: 3 })],
      effect("signature-technique", "evolution-b"),
    );
    expect(result.commands).toContainEqual({
      kind: "modify-action",
      source: "signature-technique",
      pokemonId: 1,
      damageMultiplier: 1.15,
    });
  });

  it("never repeats Full Repertoire rewards in one battle", () => {
    const selected = effect("full-repertoire");
    const physical = {
      type: "move-resolved",
      user: lead,
      moveId: 10,
      moveSlot: 0,
      moveType: "fire",
      category: "physical",
      damaging: true,
      outcome: "hit",
      selectedRepertoireRewards: ["barrier", "heal"],
    } as const;
    const special = {
      ...physical,
      moveSlot: 1,
      category: "special",
    } as const;
    const result = run([physical, special], selected);
    expect(
      result.commands.filter(command => command.kind === "repertoire-reward" && command.reward === "barrier"),
    ).toHaveLength(1);
    expect(result.commands).toContainEqual({
      kind: "repertoire-reward",
      source: "full-repertoire",
      pokemonId: 1,
      reward: "heal",
      magnitudeMultiplier: 1,
    });
  });

  it("preserves Bulwark readiness when exit is dispatched before switch", () => {
    const selected = effect("hold-the-line", "evolution-b");
    const result = run(
      [
        {
          type: "turn-complete",
          turn: 1,
          pokemonId: 1,
          partySlot: 0,
          active: true,
        },
        {
          type: "turn-complete",
          turn: 2,
          pokemonId: 1,
          partySlot: 0,
          active: true,
        },
        { type: "exit", pokemonId: 1, partySlot: 0 },
        {
          type: "switch",
          voluntary: true,
          outgoing: lead,
          incoming: partner,
          allyDamagedEarlierThisTurn: false,
        },
      ],
      selected,
    );
    expect(result.commands).toContainEqual({
      kind: "barrier",
      source: "hold-the-line",
      pokemonId: 2,
      maxHpFraction: 0.2,
    });
  });

  it("models Turntable beats and Final Draft choices explicitly", () => {
    const turntable = run(
      [
        { type: "turn-start", turn: 1 },
        moveAttempt(),
        { type: "turn-start", turn: 2 },
        {
          type: "damage-received",
          target: lead,
          moveType: "water",
          direct: true,
        },
      ],
      effect("turntable", "rank-two"),
    );
    expect(turntable.commands).toContainEqual({
      kind: "mark",
      source: "turntable",
      name: "beat",
      value: "offbeat",
    });
    expect(turntable.commands).toContainEqual({
      kind: "modify-action",
      source: "turntable",
      pokemonId: 1,
      incomingDamageMultiplier: 0.8,
    });

    const { finalDraftEndings: _resolvedEndings, ...unresolvedAttempt } = moveAttempt();
    const choice = run([unresolvedAttempt], effect("final-draft", "evolution-a"));
    expect(choice.commands).toContainEqual({
      kind: "choice-required",
      source: "final-draft",
      choice: "final-draft",
      options: ["climax", "precision", "revision"],
      chooseCount: 2,
    });
  });

  it("uses explicit caller choices for random stages, secondaries, and repertoire rewards", () => {
    const relay = run(
      [
        {
          type: "switch",
          voluntary: true,
          outgoing: lead,
          incoming: partner,
          allyDamagedEarlierThisTurn: false,
          selectedPositiveStages: [{ stat: "speed", stages: 1 }],
        },
      ],
      effect("relay-seat"),
    );
    expect(relay.commands).toContainEqual({
      kind: "stat-stage",
      source: "relay-seat",
      pokemonId: 2,
      stat: "speed",
      stages: 1,
    });

    const tag = run(
      [
        {
          type: "switch",
          voluntary: true,
          outgoing: lead,
          incoming: partner,
          allyDamagedEarlierThisTurn: false,
          selectedBorrowedSecondaryId: "flinch-30",
        },
      ],
      effect("tag-combo", "evolution-a"),
    );
    expect(tag.commands).toContainEqual({
      kind: "copy-secondary",
      source: "tag-combo",
      pokemonId: 2,
      secondaryId: "flinch-30",
      uses: 2,
      guaranteed: true,
    });

    const repertoire = run(
      [
        {
          type: "move-resolved",
          user: lead,
          moveId: 10,
          moveSlot: 0,
          moveType: "fire",
          category: "physical",
          damaging: true,
          outcome: "hit",
          selectedRepertoireRewards: ["barrier"],
        },
      ],
      effect("full-repertoire", "rank-two"),
    );
    expect(repertoire.commands).toContainEqual({
      kind: "repertoire-reward",
      source: "full-repertoire",
      pokemonId: 1,
      reward: "barrier",
      magnitudeMultiplier: 1.25,
    });
  });

  it("reaches Revenge Entry and Shared Inspiration through their production payload fields", () => {
    const revenge = run(
      [
        {
          type: "entry",
          pokemon: lead,
          firstEntryThisBattle: false,
          afterAllyFainted: true,
          allyDamagedEarlierThisTurn: false,
        },
      ],
      effect("revenge-entry", "rank-two"),
    );
    expect(revenge.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "stat-stage", pokemonId: lead.pokemonId, stat: "speed", stages: 1 }),
        expect.objectContaining({ kind: "stat-stage", pokemonId: lead.pokemonId, stat: "attack", stages: 1 }),
      ]),
    );

    const inspiration = run(
      [{ type: "enemy-stat-increase", stat: "specialAttack", stages: 2, selectedAdjacentPokemonId: partner.pokemonId }],
      effect("copycat-heart", "evolution-b"),
    );
    expect(inspiration.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "stat-stage", pokemonId: lead.pokemonId, stat: "specialAttack", stages: 2 }),
        expect.objectContaining({ kind: "stat-stage", pokemonId: partner.pokemonId, stat: "specialAttack", stages: 2 }),
      ]),
    );
  });
});
