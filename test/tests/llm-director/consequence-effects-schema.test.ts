import { type DialogueChoiceBeat, validateBeat } from "#data/llm-director/beat-schema";
import { describe, expect, it } from "vitest";

/**
 * Schema-level coverage for the v2 ConsequenceEffect discriminated union.
 *
 * Each test wraps an effect inside a minimal dialogue_choice beat so we
 * exercise the same code path the LLM hits at runtime. The beat shape is
 * fixed; only the effect under test varies.
 */

const wrap = (effect: unknown): DialogueChoiceBeat =>
  ({
    beatId: "b1",
    type: "dialogue_choice",
    introText: "x",
    options: [
      {
        label: "y",
        consequence: {
          // biome-ignore lint/suspicious/noExplicitAny: feeding test-only payloads through the validator
          effects: [effect as any],
        },
      },
    ],
  }) as DialogueChoiceBeat;

describe("validateBeat — Consequence.effects[]", () => {
  // ------------------ heal / restore ------------------
  it("accepts heal_party_hp", () => {
    expect(validateBeat(wrap({ type: "heal_party_hp", percentMaxHp: 50 })).ok).toBe(true);
  });

  it("rejects heal_party_hp with out-of-range percent", () => {
    expect(validateBeat(wrap({ type: "heal_party_hp", percentMaxHp: 0 })).ok).toBe(false);
    expect(validateBeat(wrap({ type: "heal_party_hp", percentMaxHp: 101 })).ok).toBe(false);
  });

  it("accepts heal_party_status (no extras)", () => {
    expect(validateBeat(wrap({ type: "heal_party_status" })).ok).toBe(true);
  });

  it("accepts heal_party_pp", () => {
    expect(validateBeat(wrap({ type: "heal_party_pp", percent: 100 })).ok).toBe(true);
  });

  it("accepts heal_party_full with target=all", () => {
    expect(validateBeat(wrap({ type: "heal_party_full", target: "all" })).ok).toBe(true);
  });

  it("accepts revive with default percentMaxHp omitted", () => {
    expect(validateBeat(wrap({ type: "revive", target: { partyIndex: 0 } })).ok).toBe(true);
  });

  it("accepts revive_all", () => {
    expect(validateBeat(wrap({ type: "revive_all" })).ok).toBe(true);
  });

  // ------------------ stat / progression --------------
  it("accepts stat_boost_temp ATK +2", () => {
    expect(validateBeat(wrap({ type: "stat_boost_temp", stat: "ATK", stages: 2 })).ok).toBe(true);
  });

  it("rejects stat_boost_temp with invalid stat", () => {
    expect(validateBeat(wrap({ type: "stat_boost_temp", stat: "BOGUS", stages: 1 })).ok).toBe(false);
  });

  it("accepts stat_boost_permanent HP", () => {
    expect(validateBeat(wrap({ type: "stat_boost_permanent", stat: "HP", stacks: 3 })).ok).toBe(true);
  });

  it("accepts level_up", () => {
    expect(validateBeat(wrap({ type: "level_up", levels: 5 })).ok).toBe(true);
  });

  it("rejects level_up over 20 levels", () => {
    expect(validateBeat(wrap({ type: "level_up", levels: 21 })).ok).toBe(false);
  });

  it("accepts give_xp", () => {
    expect(validateBeat(wrap({ type: "give_xp", amount: 1000 })).ok).toBe(true);
  });

  it("accepts evolve and friendship_boost", () => {
    expect(validateBeat(wrap({ type: "evolve" })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "friendship_boost", amount: 50 })).ok).toBe(true);
  });

  // ------------------ Pokémon mechanics ---------------
  it("accepts learn_move with replaceIndex", () => {
    expect(validateBeat(wrap({ type: "learn_move", moveId: 14, replaceIndex: 2 })).ok).toBe(true);
  });

  it("accepts forget_move, change_ability, change_type, change_form", () => {
    expect(validateBeat(wrap({ type: "forget_move", moveSlot: 0 })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "change_ability", abilityId: 22 })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "change_type", type1: 13, type2: 17 })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "change_form", formIndex: 1 })).ok).toBe(true);
  });

  it("accepts give_held_item / remove_held_item / tera_change / shiny_unlock", () => {
    expect(validateBeat(wrap({ type: "give_held_item", modifierType: "LEFTOVERS" })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "remove_held_item" })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "tera_change", teraType: 13 })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "shiny_unlock" })).ok).toBe(true);
  });

  // ------------------ inventory / economy -------------
  it("accepts give_item / remove_item / give_money / lose_money", () => {
    expect(validateBeat(wrap({ type: "give_item", modifierType: "POTION", qty: 3 })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "remove_item", modifierType: "REVIVE" })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "give_money", amount: 1000 })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "lose_money", amount: 500 })).ok).toBe(true);
  });

  it("accepts give_egg with all 4 tiers", () => {
    for (const tier of ["common", "rare", "epic", "legendary"]) {
      expect(validateBeat(wrap({ type: "give_egg", tier })).ok).toBe(true);
    }
  });

  it("rejects give_egg with bogus tier", () => {
    expect(validateBeat(wrap({ type: "give_egg", tier: "ultra" })).ok).toBe(false);
  });

  it("accepts give_voucher with all 4 types and lose_egg", () => {
    for (const v of ["REGULAR", "PLUS", "PREMIUM", "GOLDEN"]) {
      expect(validateBeat(wrap({ type: "give_voucher", voucherType: v })).ok).toBe(true);
    }
    expect(validateBeat(wrap({ type: "lose_egg" })).ok).toBe(true);
  });

  // ------------------ damage / status -----------------
  it("accepts every status_inflict variant", () => {
    for (const s of ["POISON", "BURN", "PARALYSIS", "SLEEP", "FREEZE", "TOXIC"]) {
      expect(validateBeat(wrap({ type: "status_inflict", target: "all", status: s })).ok).toBe(true);
    }
  });

  it("rejects status_inflict with invalid status", () => {
    expect(validateBeat(wrap({ type: "status_inflict", target: "all", status: "CONFUSED" })).ok).toBe(false);
  });

  it("accepts damage_party / faint / release_pokemon / level_down", () => {
    expect(validateBeat(wrap({ type: "damage_party", percentMaxHp: 25 })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "faint", target: { partyIndex: 0 } })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "release_pokemon", target: { species: 25 } })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "level_down", levels: 3 })).ok).toBe(true);
  });

  it("rejects faint without target (target is REQUIRED for faint)", () => {
    expect(validateBeat(wrap({ type: "faint" })).ok).toBe(false);
  });

  // ------------------ battle / encounter --------------
  it("accepts trigger_battle with optional fields", () => {
    expect(
      validateBeat(
        wrap({
          type: "trigger_battle",
          trainerType: 5,
          trainerName: "Vance",
          preBattleText: "He draws his pokeball.",
          isDouble: false,
        }),
      ).ok,
    ).toBe(true);
  });

  it("accepts trigger_boss_battle with enemyTeam", () => {
    expect(
      validateBeat(
        wrap({
          type: "trigger_boss_battle",
          enemyTeam: [{ speciesId: 229, level: 50, isBoss: true }],
          preBattleText: "The cult leader steps forward.",
        }),
      ).ok,
    ).toBe(true);
  });

  it("accepts skip_wave / force_capture_chance", () => {
    expect(validateBeat(wrap({ type: "skip_wave", count: 3 })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "force_capture_chance", target: { species: 25 } })).ok).toBe(true);
  });

  // ------------------ field / world -------------------
  it("accepts set_biome / weather_change / field_effect / reveal_map_ahead", () => {
    expect(validateBeat(wrap({ type: "set_biome", biomeId: 13, flavorText: "the cave deepens" })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "weather_change", weather: "RAIN", duration: "next_battle" })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "weather_change", weather: "SANDSTORM", duration: "n_waves", waves: 5 })).ok).toBe(
      true,
    );
    expect(validateBeat(wrap({ type: "field_effect", effect: "TRICK_ROOM", duration: "next_battle" })).ok).toBe(true);
    expect(validateBeat(wrap({ type: "reveal_map_ahead", waves: 5 })).ok).toBe(true);
  });

  // ------------------ long-term modifiers -------------
  it("accepts buff/debuff_persistent in valid range", () => {
    expect(validateBeat(wrap({ type: "buff_persistent", kind: "money_multiplier", multiplier: 2, waves: 10 })).ok).toBe(
      true,
    );
    expect(
      validateBeat(wrap({ type: "debuff_persistent", kind: "exp_multiplier", multiplier: 0.5, waves: 5 })).ok,
    ).toBe(true);
  });

  it("rejects debuff_persistent with multiplier >= 1", () => {
    expect(validateBeat(wrap({ type: "debuff_persistent", kind: "exp_multiplier", multiplier: 1, waves: 5 })).ok).toBe(
      false,
    );
  });

  // ------------------ custom escape hatch -------------
  it("accepts custom with description only", () => {
    expect(validateBeat(wrap({ type: "custom", description: "time slows for thirty seconds" })).ok).toBe(true);
  });

  it("accepts custom with severity + positive metadata", () => {
    expect(
      validateBeat(
        wrap({
          type: "custom",
          description: "the deity blessed your team",
          severity: "major",
          positive: true,
        }),
      ).ok,
    ).toBe(true);
  });

  it("rejects custom with description over 240 chars", () => {
    expect(validateBeat(wrap({ type: "custom", description: "x".repeat(241) })).ok).toBe(false);
  });

  it("rejects custom with empty description", () => {
    expect(validateBeat(wrap({ type: "custom", description: "" })).ok).toBe(false);
  });

  // ------------------ multi-effect chain --------------
  it("accepts multi-effect chain (cursed potion: heal + toxic + lose money)", () => {
    const beat = {
      beatId: "b1",
      type: "dialogue_choice",
      introText: "A glowing flask sits on the altar.",
      options: [
        {
          label: "Drink it",
          consequence: {
            effects: [
              { type: "heal_party_full" },
              { type: "status_inflict", target: "all", status: "TOXIC" },
              { type: "lose_money", amount: 500 },
            ],
          },
        },
      ],
    };
    expect(validateBeat(beat).ok).toBe(true);
  });

  it("rejects unknown effect type", () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid payload
    expect(validateBeat(wrap({ type: "summon_dragon" } as any)).ok).toBe(false);
  });

  it("accepts empty effects array (purely-social choices)", () => {
    const beat = {
      beatId: "b1",
      type: "dialogue_choice",
      introText: "x",
      options: [{ label: "y", consequence: { alignment: 1, effects: [] } }],
    };
    expect(validateBeat(beat).ok).toBe(true);
  });
});
