import { describe, expect, it } from "vitest";
import type { BrowserEffectBatchV2 } from "../../../../src/rust-browser/contracts/browser-contracts-v2";
import {
  type BrowserEffectAdaptersV2,
  BrowserEffectRouterV2,
} from "../../../../src/rust-browser/routes/browser-effects-v2";

describe("BrowserEffectRouterV2", () => {
  it("routes every typed effect once and fences stale or disposed batches", async () => {
    const calls: string[] = [];
    const adapters: BrowserEffectAdaptersV2 = {
      renderUi: () => {
        calls.push("UI_CHANGED");
      },
      present: () => {
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
      ],
    };

    await router.dispatch(batch);
    expect(calls).toEqual([
      "UI_CHANGED",
      "PRESENTATION",
      "PRESENTATION_SCENE_CHANGED",
      "SEND_NETWORK_FRAME",
      "STORAGE_REQUEST",
      "ASSET_REQUEST",
      "AUDIO_CUE",
      "TERMINAL",
      "TELEMETRY",
      "REPRO_READY",
    ]);
    await expect(router.dispatch(batch)).rejects.toThrow("stale, duplicated");
    await router.dispose();
    await router.dispose();
    expect(calls.at(-1)).toBe("DISPOSE");
    expect(calls.filter(call => call === "DISPOSE")).toHaveLength(1);
    await expect(router.dispatch({ external_sequence: 2, effects: [] })).rejects.toThrow("after disposal");
  });
});
