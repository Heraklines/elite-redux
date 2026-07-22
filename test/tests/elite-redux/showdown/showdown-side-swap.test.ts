import type { SessionSaveData } from "#app/@types/save-data";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopBattleEvent,
  CoopFullBattleSnapshot,
  CoopFullMonSnapshot,
} from "#app/data/elite-redux/coop/coop-transport";
import {
  swapArenaTagSide,
  swapAuthoritativeState,
  swapBattleEvent,
  swapBi,
  swapCheckpoint,
  swapFullField,
  swapFullSnapshot,
  swapSessionData,
} from "#app/data/elite-redux/showdown/showdown-side-swap";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { BattlerIndex } from "#enums/battler-index";
import { describe, expect, it } from "vitest";

/**
 * Task F1 - the versus-guest data-level perspective flip. These are PURE unit tests (no engine):
 * every swap must be its own inverse (swap∘swap = identity), every side-keyed field must actually
 * move, party ORDER must be preserved, and the bi remap must be correct at the arrangement
 * boundaries. A missed side-keyed field here = a wrong-sprite animation or a checksum divergence
 * downstream, so the coverage is deliberately exhaustive.
 */

describe("showdown-side-swap: primitives", () => {
  it("swapBi reflects both player seats to enemy seats and back", () => {
    expect(swapBi(BattlerIndex.PLAYER)).toBe(BattlerIndex.ENEMY);
    expect(swapBi(BattlerIndex.PLAYER_2)).toBe(BattlerIndex.ENEMY_2);
    expect(swapBi(BattlerIndex.ENEMY)).toBe(BattlerIndex.PLAYER);
    expect(swapBi(BattlerIndex.ENEMY_2)).toBe(BattlerIndex.PLAYER_2);
  });

  it("swapBi passes through the ATTACKER sentinel and unexpected indices", () => {
    expect(swapBi(BattlerIndex.ATTACKER)).toBe(BattlerIndex.ATTACKER);
    expect(swapBi(-2)).toBe(-2);
  });

  it("swapBi is an involution over the field seats", () => {
    for (const bi of [0, 1, 2, 3, -1]) {
      expect(swapBi(swapBi(bi))).toBe(bi);
    }
  });

  it("swapBi maps TRIPLES seats when given the 3-wide enemy base (player 0/1/2 <-> enemy 3/4/5)", () => {
    // The multi-slot fix: with enemyBase=3 every player seat p reflects to enemy seat 3+p and back.
    // (Red-proof: the old hardcoded-2 swapBi mis-mapped these - swapBi(2)->0, swapBi(3)->1, 4/5 passthrough.)
    expect(swapBi(0, 3)).toBe(3);
    expect(swapBi(1, 3)).toBe(4);
    expect(swapBi(2, 3)).toBe(5);
    expect(swapBi(3, 3)).toBe(0);
    expect(swapBi(4, 3)).toBe(1);
    expect(swapBi(5, 3)).toBe(2);
    // Still an involution at the 3-wide width, and the ATTACKER sentinel passes through.
    for (const bi of [0, 1, 2, 3, 4, 5, -1]) {
      expect(swapBi(swapBi(bi, 3), 3)).toBe(bi);
    }
    expect(swapBi(-1, 3)).toBe(-1);
  });

  it("swapArenaTagSide reflects PLAYER<->ENEMY and leaves BOTH", () => {
    expect(swapArenaTagSide(ArenaTagSide.PLAYER)).toBe(ArenaTagSide.ENEMY);
    expect(swapArenaTagSide(ArenaTagSide.ENEMY)).toBe(ArenaTagSide.PLAYER);
    expect(swapArenaTagSide(ArenaTagSide.BOTH)).toBe(ArenaTagSide.BOTH);
    for (const s of [ArenaTagSide.BOTH, ArenaTagSide.PLAYER, ArenaTagSide.ENEMY]) {
      expect(swapArenaTagSide(swapArenaTagSide(s))).toBe(s);
    }
  });
});

function sampleAuthoritativeState(): CoopAuthoritativeBattleStateV1 {
  return {
    version: 1,
    tick: 5,
    wave: 1,
    turn: 3,
    playerParty: [
      { id: 111, species: 1 },
      { id: 112, species: 2 },
    ],
    enemyParty: [
      { id: 221, species: 3 },
      { id: 222, species: 4 },
    ],
    field: [
      { side: "player", bi: BattlerIndex.PLAYER, partyIndex: 0, pokemonId: 111, owner: "host", presented: true },
      { side: "player", bi: BattlerIndex.PLAYER_2, partyIndex: 1, pokemonId: 112, presented: true },
      { side: "enemy", bi: BattlerIndex.ENEMY, partyIndex: 0, pokemonId: 221, presented: true },
      { side: "enemy", bi: BattlerIndex.ENEMY_2, partyIndex: 1, pokemonId: 222, presented: true },
    ],
    weather: 3,
    weatherTurnsLeft: 4,
    terrain: 2,
    terrainTurnsLeft: 5,
    arenaTags: [
      { tagType: "STEALTH_ROCK", side: ArenaTagSide.ENEMY, turnCount: 0, layers: 1 },
      { tagType: "TAILWIND", side: ArenaTagSide.PLAYER, turnCount: 3, layers: 1 },
      { tagType: "MUD_SPORT", side: ArenaTagSide.BOTH, turnCount: 5, layers: 1 },
    ],
    money: 5000,
    score: 42,
    pokeballCounts: [[0, 5]],
    playerModifiers: [{ player: true, typeId: "EXP_CHARM", args: [], stackCount: 1 }],
    enemyModifiers: [{ player: false, typeId: "GRIP_CLAW", args: [221], stackCount: 1 }],
    seed: "seed-abc",
    waveSeed: "wave-abc",
  };
}

describe("showdown-side-swap: authoritative state", () => {
  it("trades party rosters preserving ORDER (switch-index alignment)", () => {
    const swapped = swapAuthoritativeState(sampleAuthoritativeState());
    // The host's ENEMY party (the guest's own team) becomes the guest's local PLAYER party.
    expect(swapped.playerParty.map(p => (p as { id: number }).id)).toEqual([221, 222]);
    expect(swapped.enemyParty.map(p => (p as { id: number }).id)).toEqual([111, 112]);
  });

  it("trades modifier stacks and re-flags each blob onto its new side", () => {
    const swapped = swapAuthoritativeState(sampleAuthoritativeState());
    expect(swapped.playerModifiers).toEqual([{ player: true, typeId: "GRIP_CLAW", args: [221], stackCount: 1 }]);
    expect(swapped.enemyModifiers).toEqual([{ player: false, typeId: "EXP_CHARM", args: [], stackCount: 1 }]);
  });

  it("mirrors every field seat (side + bi), preserving identity/partyIndex/owner", () => {
    const swapped = swapAuthoritativeState(sampleAuthoritativeState());
    const seat = (bi: number) => swapped.field.find(f => f.bi === bi)!;
    // The host lead (was PLAYER/0/id111) now sits on the ENEMY side at bi 2, same identity + slot.
    expect(seat(BattlerIndex.ENEMY)).toMatchObject({ side: "enemy", partyIndex: 0, pokemonId: 111, owner: "host" });
    expect(seat(BattlerIndex.ENEMY_2)).toMatchObject({ side: "enemy", partyIndex: 1, pokemonId: 112 });
    // The host's enemy lead (the guest's own mon, id221) is now the guest's local PLAYER at bi 0.
    expect(seat(BattlerIndex.PLAYER)).toMatchObject({ side: "player", partyIndex: 0, pokemonId: 221 });
    expect(seat(BattlerIndex.PLAYER_2)).toMatchObject({ side: "player", partyIndex: 1, pokemonId: 222 });
  });

  it("flips arena-tag sides (BOTH unchanged)", () => {
    const swapped = swapAuthoritativeState(sampleAuthoritativeState());
    const tag = (t: string) => swapped.arenaTags.find(a => a.tagType === t)!;
    expect(tag("STEALTH_ROCK").side).toBe(ArenaTagSide.PLAYER);
    expect(tag("TAILWIND").side).toBe(ArenaTagSide.ENEMY);
    expect(tag("MUD_SPORT").side).toBe(ArenaTagSide.BOTH);
  });

  it("leaves side-agnostic run state untouched", () => {
    const swapped = swapAuthoritativeState(sampleAuthoritativeState());
    expect(swapped.money).toBe(5000);
    expect(swapped.score).toBe(42);
    expect(swapped.weather).toBe(3);
    expect(swapped.terrain).toBe(2);
    expect(swapped.seed).toBe("seed-abc");
    expect(swapped.pokeballCounts).toEqual([[0, 5]]);
  });

  it("swap∘swap = identity", () => {
    const original = sampleAuthoritativeState();
    expect(swapAuthoritativeState(swapAuthoritativeState(original))).toEqual(original);
  });
});

describe("showdown-side-swap: battle events", () => {
  const events: CoopBattleEvent[] = [
    { k: "message", text: "It worked!" },
    { k: "moveUsed", bi: BattlerIndex.PLAYER, moveId: 33, targets: [BattlerIndex.ENEMY, BattlerIndex.ENEMY_2] },
    { k: "hp", bi: BattlerIndex.ENEMY, hp: 40, maxHp: 100, sp: 2 },
    { k: "faint", bi: BattlerIndex.ENEMY_2, narrate: true },
    { k: "statStage", bi: BattlerIndex.PLAYER_2, stat: 1, value: -1 },
    { k: "status", bi: BattlerIndex.ENEMY, status: 4 },
    { k: "switch", bi: BattlerIndex.PLAYER, partySlot: 3 },
    { k: "weather", weather: 2, turnsLeft: 5 },
    { k: "terrain", terrain: 1, turnsLeft: 3 },
    // P3 cosmetic: the ability-banner event carries a bi that must cross the perspective boundary.
    { k: "ability", bi: BattlerIndex.ENEMY_2, abilityName: "Intimidate", passive: false },
  ];

  it("remaps every bi-bearing member (user + targets)", () => {
    const move = swapBattleEvent(events[1]) as Extract<CoopBattleEvent, { k: "moveUsed" }>;
    expect(move.bi).toBe(BattlerIndex.ENEMY);
    expect(move.targets).toEqual([BattlerIndex.PLAYER, BattlerIndex.PLAYER_2]);
    expect((swapBattleEvent(events[2]) as Extract<CoopBattleEvent, { k: "hp" }>).bi).toBe(BattlerIndex.PLAYER);
    expect((swapBattleEvent(events[3]) as Extract<CoopBattleEvent, { k: "faint" }>).bi).toBe(BattlerIndex.PLAYER_2);
    expect((swapBattleEvent(events[4]) as Extract<CoopBattleEvent, { k: "statStage" }>).bi).toBe(BattlerIndex.ENEMY_2);
    expect((swapBattleEvent(events[5]) as Extract<CoopBattleEvent, { k: "status" }>).bi).toBe(BattlerIndex.PLAYER);
    expect((swapBattleEvent(events[6]) as Extract<CoopBattleEvent, { k: "switch" }>).bi).toBe(BattlerIndex.ENEMY);
    // Ability event bi crosses to the guest's local side (ENEMY_2 -> PLAYER_2), name/passive preserved.
    const ability = swapBattleEvent(events[9]) as Extract<CoopBattleEvent, { k: "ability" }>;
    expect(ability.bi).toBe(BattlerIndex.PLAYER_2);
    expect(ability.abilityName).toBe("Intimidate");
    expect(ability.passive).toBe(false);
  });

  it("leaves side-free members (message / weather / terrain) untouched", () => {
    expect(swapBattleEvent(events[0])).toEqual(events[0]);
    expect(swapBattleEvent(events[7])).toEqual(events[7]);
    expect(swapBattleEvent(events[8])).toEqual(events[8]);
  });

  it("swap∘swap = identity for every event kind", () => {
    for (const e of events) {
      expect(swapBattleEvent(swapBattleEvent(e))).toEqual(e);
    }
  });
});

describe("showdown-side-swap: checkpoint + full snapshot safety net", () => {
  const checkpoint: CoopBattleCheckpoint = {
    tick: 9,
    field: [
      {
        bi: BattlerIndex.PLAYER,
        partyIndex: 0,
        speciesId: 1,
        hp: 100,
        maxHp: 100,
        status: 0,
        statStages: [0, 0, 0, 0, 0, 0, 0],
        fainted: false,
      },
      {
        bi: BattlerIndex.ENEMY,
        partyIndex: 0,
        speciesId: 3,
        hp: 50,
        maxHp: 80,
        status: 1,
        statStages: [0, 0, 0, 0, 0, 0, 0],
        fainted: false,
      },
    ],
    weather: 0,
    weatherTurnsLeft: 0,
    terrain: 0,
    terrainTurnsLeft: 0,
    arenaTags: [{ tagType: "SPIKES", side: ArenaTagSide.PLAYER, turnCount: 0, layers: 2 }],
    money: 3000,
  };

  it("swapCheckpoint reflects field bi + arena-tag side, keeps money", () => {
    const swapped = swapCheckpoint(checkpoint);
    expect(swapped.field.map(f => f.bi).sort()).toEqual([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
    expect(swapped.field.find(f => f.speciesId === 1)!.bi).toBe(BattlerIndex.ENEMY);
    expect(swapped.field.find(f => f.speciesId === 3)!.bi).toBe(BattlerIndex.PLAYER);
    expect(swapped.arenaTags![0].side).toBe(ArenaTagSide.ENEMY);
    expect(swapped.money).toBe(3000);
  });

  it("swapCheckpoint is an involution", () => {
    expect(swapCheckpoint(swapCheckpoint(checkpoint))).toEqual(checkpoint);
  });

  it("swapFullField mirrors every rich mon carrier and is an involution", () => {
    const field: CoopFullMonSnapshot[] = [
      {
        bi: BattlerIndex.PLAYER,
        partyIndex: 0,
        speciesId: 1,
        hp: 91,
        maxHp: 100,
        status: 0,
        statStages: [],
        fainted: false,
        abilityId: 12,
        formIndex: 0,
        moves: [[33, 2]],
        tags: [],
        heldItems: [{ typeId: "LEFTOVERS", player: true }],
      },
      {
        bi: BattlerIndex.ENEMY,
        partyIndex: 0,
        speciesId: 3,
        hp: 47,
        maxHp: 80,
        status: 1,
        statStages: [],
        fainted: false,
        abilityId: 34,
        formIndex: 1,
        moves: [[45, 1]],
        tags: [],
      },
    ];

    const swapped = swapFullField(field);
    expect(swapped.map(mon => mon.bi)).toEqual([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
    expect(swapped[0].heldItems).toEqual(field[0].heldItems);
    expect(swapFullField(swapped)).toEqual(field);
  });

  it("swapFullSnapshot recurses the embedded authoritative state and mirrors legacy seating", () => {
    const snap: CoopFullBattleSnapshot = {
      tick: 1,
      field: [
        {
          bi: BattlerIndex.PLAYER,
          partyIndex: 0,
          speciesId: 1,
          hp: 100,
          maxHp: 100,
          status: 0,
          statStages: [],
          fainted: false,
          abilityId: 0,
          formIndex: 0,
          moves: [],
          tags: [],
        },
        {
          bi: BattlerIndex.ENEMY,
          partyIndex: 0,
          speciesId: 3,
          hp: 60,
          maxHp: 90,
          status: 0,
          statStages: [],
          fainted: false,
          abilityId: 0,
          formIndex: 0,
          moves: [],
          tags: [],
        },
      ],
      weather: 0,
      weatherTurnsLeft: 0,
      terrain: 0,
      terrainTurnsLeft: 0,
      arenaTags: [{ tagType: "REFLECT", side: ArenaTagSide.PLAYER, turnCount: 5, layers: 1 }],
      party: [1, 2],
      money: 100,
      modifiers: [["EXP_CHARM", 1]],
      authoritativeState: sampleAuthoritativeState(),
    };
    const swapped = swapFullSnapshot(snap);
    expect(swapped.field.find(f => f.speciesId === 1)!.bi).toBe(BattlerIndex.ENEMY);
    expect(swapped.arenaTags[0].side).toBe(ArenaTagSide.ENEMY);
    // The embedded id-keyed state (the modern path the guest actually adopts) is flipped too.
    expect(swapped.authoritativeState!.playerParty.map(p => (p as { id: number }).id)).toEqual([221, 222]);
    // Involution across the whole nested shape.
    expect(swapFullSnapshot(swapFullSnapshot(snap))).toEqual(snap);
  });
});

describe("showdown-side-swap: session data (launch/resume boot)", () => {
  function sampleSession(): SessionSaveData {
    return {
      // Real PokemonData always carries a `player` flag; the guest's own team is authored as the host's
      // ENEMY roster (player:false), so the swap must flip it to player:true (-> PlayerPokemon on boot).
      party: [
        { id: 1, player: true },
        { id: 2, player: true },
      ],
      enemyParty: [
        { id: 3, player: false },
        { id: 4, player: false },
      ],
      modifiers: [{ player: true, typeId: "A" }],
      enemyModifiers: [
        { player: false, typeId: "B" },
        { player: false, typeId: "C" },
      ],
      arena: {
        tags: [
          { tagType: "STEALTH_ROCK", side: ArenaTagSide.ENEMY },
          { tagType: "MUD_SPORT", side: ArenaTagSide.BOTH },
        ],
      },
    } as unknown as SessionSaveData;
  }

  it("trades party <-> enemyParty preserving order and re-flags each mon's player flag", () => {
    const s = swapSessionData(sampleSession());
    expect((s.party as unknown as { id: number }[]).map(p => p.id)).toEqual([3, 4]);
    expect((s.enemyParty as unknown as { id: number }[]).map(p => p.id)).toEqual([1, 2]);
    // The guest's own team (ids 3/4, authored as the host ENEMY roster) becomes its local PLAYER
    // side -> player:true (so PokemonData.toPokemon rebuilds PlayerPokemon); the opponent -> player:false.
    expect((s.party as unknown as { player: boolean }[]).every(p => p.player === true)).toBe(true);
    expect((s.enemyParty as unknown as { player: boolean }[]).every(p => p.player === false)).toBe(true);
  });

  it("trades modifiers <-> enemyModifiers and re-sets each player flag", () => {
    const s = swapSessionData(sampleSession());
    expect(s.modifiers).toEqual([
      { player: true, typeId: "B" },
      { player: true, typeId: "C" },
    ]);
    expect(s.enemyModifiers).toEqual([{ player: false, typeId: "A" }]);
  });

  it("flips arena tag sides (BOTH unchanged)", () => {
    const s = swapSessionData(sampleSession());
    const tags = s.arena.tags as unknown as { tagType: string; side: number }[];
    expect(tags.find(t => t.tagType === "STEALTH_ROCK")!.side).toBe(ArenaTagSide.PLAYER);
    expect(tags.find(t => t.tagType === "MUD_SPORT")!.side).toBe(ArenaTagSide.BOTH);
  });

  it("swap∘swap = identity", () => {
    const original = sampleSession();
    const twice = swapSessionData(swapSessionData(sampleSession()));
    expect(twice).toEqual(original);
  });
});
