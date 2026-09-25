import { describe, expect, it, vi } from "vitest";
import type {
  BrowserEffectBatchV2,
  BrowserRequestV2,
  GamePresentationEffectV2Wire,
} from "../../../../src/rust-browser/contracts/browser-contracts-v2";
import {
  type BrowserEffectAdaptersV2,
  BrowserEffectRouterV2,
} from "../../../../src/rust-browser/routes/browser-effects-v2";

describe("BrowserEffectRouterV2", () => {
  it("captures requested clock and Flash inputs once, without inventing Egg outputs", async () => {
    const delivered: BrowserRequestV2[] = [];
    const noop = () => {};
    const adapters: BrowserEffectAdaptersV2 = {
      completeExternalRequest: request => {
        delivered.push(request);
      },
      renderUi: noop,
      renderScene: noop,
      present: noop,
      changePresentationScene: noop,
      sendNetworkFrame: noop,
      handleStorageRequest: noop,
      requestAsset: noop,
      playAudioCue: noop,
      showTerminal: noop,
      recordTelemetry: noop,
      publishRepro: noop,
      publishCurrentRepro: noop,
      dispose: noop,
    };
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const now = vi.spyOn(Date, "now").mockReturnValue(1234);
    try {
      const router = new BrowserEffectRouterV2(adapters);
      const batch: BrowserEffectBatchV2 = {
        external_sequence: 1,
        effects: [
          { kind: "UTC_CLOCK_REQUEST", request_id: 7 },
          { kind: "FLASH_EGG_INPUTS_REQUEST", request: { request: 8, pending: 1 } },
        ],
      };
      await router.dispatch(batch);
      expect(delivered).toEqual([
        { kind: "UTC_CLOCK_RESULT", request_id: 7, utc_milliseconds: 1234 },
        {
          kind: "FLASH_EGG_INPUTS",
          input: {
            request: 8,
            pending: 1,
            seed_draws: Array.from({ length: 24 }, () => ({ ieee754_bits: "3fe0000000000000" })),
            id_draw: { ieee754_bits: "3fe0000000000000" },
            egg_utc_milliseconds: 1234,
          },
        },
      ]);
      expect(random).toHaveBeenCalledTimes(25);
      await expect(router.dispatch(batch)).rejects.toThrow("stale");
      expect(random).toHaveBeenCalledTimes(25);
      // SAVE READ can reissue an exact retained request in a later wire batch.
      await router.dispatch({ external_sequence: 2, effects: batch.effects });
      expect(delivered.slice(2)).toEqual(delivered.slice(0, 2));
      expect(random).toHaveBeenCalledTimes(50);
      delete adapters.completeExternalRequest;
      await expect(
        new BrowserEffectRouterV2(adapters).dispatch({
          external_sequence: 2,
          effects: [{ kind: "FLASH_EGG_INPUTS_REQUEST", request: { request: 9, pending: 1 } }],
        }),
      ).rejects.toThrow("adapter is unavailable");
      expect(random).toHaveBeenCalledTimes(50);
    } finally {
      random.mockRestore();
      now.mockRestore();
    }
  });
  it("routes every typed effect once and fences stale or disposed batches", async () => {
    const calls: string[] = [];
    const presented: GamePresentationEffectV2Wire[] = [];
    const external: BrowserRequestV2[] = [];
    const capsuleBytes = [123, 34, 120, 34, 58, 34, 195, 169, 34, 125];
    const adapters: BrowserEffectAdaptersV2 = {
      renderUi: () => {
        calls.push("UI_CHANGED");
      },
      renderScene: scene => {
        expect(scene.actors[0]?.hp).toEqual({ kind: "ENEMY_BAR", ten_thousandths: 6250 });
        calls.push("SCENE_PROJECTED");
      },
      completeExternalRequest: request => {
        external.push(request);
      },
      present: effect => {
        presented.push(effect);
        calls.push("PRESENTATION");
      },
      changePresentationScene: () => {
        calls.push("PRESENTATION_SCENE_CHANGED");
      },
      sendNetworkFrame: (generation, bytes) => {
        expect(generation).toBe(2);
        expect([...bytes]).toEqual([1, 2, 3]);
        calls.push("SEND_NETWORK_FRAME");
      },
      handleStorageRequest: () => {
        calls.push("STORAGE_REQUEST");
      },
      requestAsset: () => {
        calls.push("ASSET_REQUEST");
      },
      playAudioCue: () => {
        calls.push("AUDIO_CUE");
      },
      showTerminal: () => {
        calls.push("TERMINAL");
      },
      recordTelemetry: () => {
        calls.push("TELEMETRY");
      },
      publishRepro: () => {
        calls.push("REPRO_READY");
      },
      publishCurrentRepro: bytes => {
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect([...bytes]).toEqual(capsuleBytes);
        calls.push("CURRENT_REPRO_READY");
      },
      dispose: () => {
        calls.push("DISPOSE");
      },
    };
    const router = new BrowserEffectRouterV2(adapters);
    const batch: BrowserEffectBatchV2 = {
      external_sequence: 1,
      effects: [
        {
          kind: "UI_CHANGED",
          control: {
            schema_version: 2,
            revision: 1,
            kind: "TITLE",
            owner_seat: 1,
            action_context: null,
            menu: null,
            actionable: false,
          },
        },
        {
          kind: "PRESENTATION",
          effect: {
            event_id: 1,
            semantic: { kind: "CONTROL", value: "TITLE" },
            blocking: "NON_BLOCKING",
            skip: "ALLOWED",
          },
        },
        {
          kind: "SCENE_PROJECTED",
          scene: {
            schema_version: 1,
            control: {
              schema_version: 2, revision: 1, kind: "BATTLE_COMMAND", owner_seat: 1,
              action_context: null, menu: null, actionable: true,
            },
            actors: [{
              slot: { side: "ENEMY", position: 0 }, pokemon: 2, species: 276, form: 0,
              owner_seat: null, status: "NONE", hp: { kind: "ENEMY_BAR", ten_thousandths: 6250 },
            }],
          },
        },
        { kind: "PRESENTATION_SCENE_CHANGED", semantic: "BATTLE" },
        { kind: "SEND_NETWORK_FRAME", generation: 2, bytes: [1, 2, 3] },
        {
          kind: "STORAGE_REQUEST",
          request: {
            request_id: 1,
            kind: "READ",
            slot: "slot-1",
            generation: 1,
            bytes: [],
          },
        },
        { kind: "ASSET_REQUEST", asset: "POKEMON_SPRITE" },
        { kind: "AUDIO_CUE", cue: "CONFIRM" },
        {
          kind: "TERMINAL",
          terminal: { terminal_id: "terminal/1", reason: "VICTORY" },
        },
        { kind: "TELEMETRY", event: "ACTION_APPLIED" },
        { kind: "REPRO_READY", snapshot: { schema_version: 7 }, inputs: [] },
        { kind: "CURRENT_REPRO_READY", capsule_bytes: capsuleBytes },
      ],
    };

    await router.dispatch(batch);
    expect(calls).toEqual([
      "UI_CHANGED",
      "PRESENTATION",
      "SCENE_PROJECTED",
      "PRESENTATION_SCENE_CHANGED",
      "SEND_NETWORK_FRAME",
      "STORAGE_REQUEST",
      "ASSET_REQUEST",
      "AUDIO_CUE",
      "TERMINAL",
      "TELEMETRY",
      "REPRO_READY",
      "CURRENT_REPRO_READY",
    ]);
    // Exact current Rust field names, not a TypeScript validator or DOM renderer.
    // Transport must keep the queued Growl and Candy/LevelUp parameters intact.
    const payloadEffects: GamePresentationEffectV2Wire[] = [
      {
        event_id: 2,
        semantic: { kind: "CUE", value: "MOVE" },
        blocking: "BLOCKS_HUMAN_INPUT",
        skip: "FORBIDDEN",
        payload: { kind: "STAT_STAGE_ANIMATION", holder: 2, stat: 1, before: 0, after: -1, tween_milliseconds: 1750 },
      },
      {
        event_id: 3,
        semantic: { kind: "CUE", value: "MOVE" },
        blocking: "BLOCKS_HUMAN_INPUT",
        skip: "FORBIDDEN",
        payload: { kind: "STAT_STAGE_MESSAGE", holder: 2, stat: 1, before: 0, after: -1 },
      },
      {
        event_id: 4,
        semantic: { kind: "CUE", value: "PROGRESSION" },
        blocking: "BLOCKS_HUMAN_INPUT",
        skip: "FORBIDDEN",
        payload: { kind: "CANDY_LEVEL_MESSAGE", holder: 1, level: 7 },
      },
      {
        event_id: 5,
        semantic: { kind: "CUE", value: "PROGRESSION" },
        blocking: "BLOCKS_HUMAN_INPUT",
        skip: "FORBIDDEN",
        payload: {
          kind: "LEVEL_STATS",
          holder: 1,
          previous_level: 6,
          level: 7,
          previous_stats: { hp: 23, attack: 11, defense: 12, special_attack: 13, special_defense: 13, speed: 10 },
          stats: { hp: 25, attack: 12, defense: 13, special_attack: 14, special_defense: 14, speed: 11 },
        },
      },
    ];
    const frozenPayloads = JSON.stringify(payloadEffects);
    await router.dispatch({
      external_sequence: 2,
      effects: payloadEffects.map(effect => ({ kind: "PRESENTATION" as const, effect })),
    });
    expect(presented.slice(1)).toEqual(payloadEffects);
    for (const [index, effect] of payloadEffects.entries()) {
      expect(presented[index + 1]).toBe(effect);
      expect(presented[index + 1]?.payload).toBe(effect.payload);
    }
    expect(JSON.stringify(payloadEffects)).toBe(frozenPayloads);
    expect(external).toEqual([]); // Resolving present() must not fabricate a settlement request.
    await expect(router.dispatch(batch)).rejects.toThrow("stale, duplicated");
    expect(calls.filter(call => call === "CURRENT_REPRO_READY")).toHaveLength(1);
    expect(presented).toHaveLength(5);
    expect(external).toEqual([]);
    await router.dispose();
    await router.dispose();
    expect(calls.at(-1)).toBe("DISPOSE");
    expect(calls.filter(call => call === "DISPOSE")).toHaveLength(1);
    await expect(router.dispatch({ external_sequence: 2, effects: batch.effects })).rejects.toThrow("after disposal");
    expect(calls.filter(call => call === "CURRENT_REPRO_READY")).toHaveLength(1);
  });
});
