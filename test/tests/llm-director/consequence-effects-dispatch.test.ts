import type { ConsequenceEffect } from "#data/llm-director/beat-schema";
import { applyEffects } from "#system/llm-director/consequence-effects";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration tests for the v2 effects dispatch — uses a real GameManager so
 * we exercise the actual `globalScene.addMoney`, `arena.trySetWeather`,
 * `phaseManager.queueMessage`, etc. paths the LLM hits at runtime. These
 * are heavier than unit tests but they prove the full plumbing works,
 * including the `globalScene` import binding.
 */

describe("applyEffects — dispatch (integration via GameManager)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
  });

  beforeEach(async () => {
    await game.importData("./test/utils/saves/everything.prsv");
  });

  it("give_money increases player money", () => {
    const before = game.scene.money;
    applyEffects([{ type: "give_money", amount: 1500 }]);
    expect(game.scene.money).toBe(before + 1500);
  });

  it("lose_money decreases player money (floor at 0)", () => {
    game.scene.money = 1000;
    applyEffects([{ type: "lose_money", amount: 500 }]);
    expect(game.scene.money).toBe(500);
    applyEffects([{ type: "lose_money", amount: 999_999 }]);
    expect(game.scene.money).toBe(0);
  });

  it("give_voucher increments the right voucher count", () => {
    const before = game.scene.gameData.voucherCounts[2]; // PREMIUM
    applyEffects([{ type: "give_voucher", voucherType: "PREMIUM" }]);
    expect(game.scene.gameData.voucherCounts[2]).toBe(before + 1);
  });

  it("custom returns the prefixed description for the caller to queue", () => {
    // applyEffects is pure-ish — it mutates game state for non-narrative
    // effects and RETURNS narrative strings for the caller to consolidate
    // into a single $-paginated MessagePhase. The previous behavior
    // (queueMessage per effect) caused stuck-text bugs when multiple
    // effects' messages raced with battle UI mode changes.
    const messages = applyEffects([
      {
        type: "custom",
        description: "the moonlight scars your starter",
        positive: false,
      },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("the moonlight scars your starter");
    expect(messages[0]).toContain("⚠");
  });

  it("logs every stubbed variant without throwing", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const stubs: ConsequenceEffect[] = [
      { type: "heal_party_pp", percent: 50 },
      { type: "stat_boost_temp", stat: "ATK", stages: 2 },
      { type: "stat_boost_permanent", stat: "HP", stacks: 3 },
      { type: "evolve" },
      { type: "learn_move", moveId: 14 },
      { type: "forget_move", moveSlot: 0 },
      { type: "change_ability", abilityId: 22 },
      { type: "change_type", type1: 13 },
      { type: "change_form", formIndex: 1 },
      { type: "give_held_item", modifierType: "LEFTOVERS" },
      { type: "remove_held_item" },
      { type: "tera_change", teraType: 13 },
      { type: "shiny_unlock" },
      { type: "release_pokemon", target: { partyIndex: 0 } },
      { type: "level_down", levels: 3 },
      { type: "trigger_battle" },
      { type: "trigger_boss_battle", enemyTeam: [{ speciesId: 25 }] },
      { type: "skip_wave", count: 2 },
      { type: "force_capture_chance", target: { species: 25 } },
      { type: "field_effect", effect: "TRICK_ROOM", duration: "next_battle" },
      { type: "reveal_map_ahead", waves: 5 },
      { type: "buff_persistent", kind: "money_multiplier", multiplier: 2, waves: 5 },
      { type: "debuff_persistent", kind: "exp_multiplier", multiplier: 0.5, waves: 5 },
      { type: "lose_egg" },
    ];
    expect(() => applyEffects(stubs)).not.toThrow();
    const stubLogCount = info.mock.calls.filter(call => String(call[0] ?? "").includes("effect-stubbed")).length;
    expect(stubLogCount).toBe(stubs.length);
    info.mockRestore();
  });

  it("multi-effect chain: cursed-potion pattern produces all three side effects", () => {
    game.scene.money = 1000;
    const messages = applyEffects([
      { type: "give_money", amount: 200 },
      { type: "lose_money", amount: 500 },
      { type: "custom", description: "the bargain feels heavier than the gold." },
    ]);
    // give 200 then lose 500 → -300 net
    expect(game.scene.money).toBe(700);
    // give_money / lose_money / custom each return a notification string so
    // the player sees what happened — three messages, in source order.
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain("received");
    expect(messages[0]).toContain("200");
    expect(messages[1]).toContain("lost");
    expect(messages[1]).toContain("500");
    expect(messages[2]).toContain("the bargain feels heavier than the gold.");
  });

  it("does not throw when a single effect raises — continues to subsequent effects", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // addMoney throws once, then friendship_boost still runs — but we don't
    // have a Pokemon to boost without setting one up, so we use give_money
    // again as the recovery effect.
    const before = game.scene.money;
    const original = game.scene.addMoney.bind(game.scene);
    let calls = 0;
    game.scene.addMoney = ((amount: number) => {
      calls++;
      if (calls === 1) {
        throw new Error("boom");
      }
      original(amount);
    }) as typeof game.scene.addMoney;
    applyEffects([
      { type: "give_money", amount: 100 },
      { type: "give_money", amount: 50 },
    ]);
    // First call threw and was caught; second succeeded.
    expect(game.scene.money).toBe(before + 50);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    game.scene.addMoney = original;
  });
});
