import type Phaser from "phaser";
import { BrowserClockAdapter } from "../adapters/clock-adapter";
import { BrowserRawInputAdapter } from "../adapters/input-adapter";
import { BrowserLifecycleAdapter } from "../adapters/lifecycle-adapter";
import {
  type BrowserEffectV1,
  BrowserExecutionModeV1,
  type BrowserRequestV1,
  type BrowserResponseEnvelopeV1,
} from "../contracts/browser-contracts";
import { RustBrowserHost } from "../host/rust-browser-host";
import { PhaserBattleAdapterV1 } from "../render/phaser-battle-adapter";
import { PhaserSurfaceAdapterV1 } from "../render/phaser-surface-adapter";
import { PhaserUiAdapterV1 } from "../render/phaser-ui-adapter";
import { PresentationSettlementTraceV1, type RenderSettlementTraceEntryV1 } from "../render/presentation-settlement";

export interface RustPhaserRouteOptionsV1 {
  workerUrl: URL;
  executionIdentityBytes: Uint8Array;
  sessionStartBytes: Uint8Array;
  scene: Phaser.Scene;
  mode?: BrowserExecutionModeV1.RUST_LOCAL_AUTHORITY | BrowserExecutionModeV1.RUST_STAGING_AUTHORITY;
}

export interface RustPhaserRouteSessionV1 {
  mechanicalDigest(): Promise<string>;
  renderTrace(): readonly RenderSettlementTraceEntryV1[];
  dispose(): Promise<void>;
}

export interface RustPhaserKernelHostV1 {
  dispatch(request: BrowserRequestV1): Promise<BrowserResponseEnvelopeV1[]>;
  dispose(): Promise<void>;
}

export interface RustPhaserStorageHandlerV1 {
  handleRequest(bytes: Uint8Array): Promise<Uint8Array>;
}

export async function startRustPhaserRoute(options: RustPhaserRouteOptionsV1): Promise<RustPhaserRouteSessionV1> {
  const mode = options.mode ?? BrowserExecutionModeV1.RUST_LOCAL_AUTHORITY;
  const host = await RustBrowserHost.create({
    workerUrl: options.workerUrl,
    initialize: {
      kind: "INITIALIZE",
      value: {
        mode,
        execution_identity_bytes: Array.from(options.executionIdentityBytes),
        session_start_bytes: Array.from(options.sessionStartBytes),
        maximum_pending_requests: 64,
      },
    },
  });
  return startRustPhaserHostV1(host, options.scene, null);
}

export async function startRustPhaserHostV1(
  host: RustPhaserKernelHostV1,
  scene: Phaser.Scene,
  storage: RustPhaserStorageHandlerV1 | null,
): Promise<RustPhaserRouteSessionV1> {
  const ui = new PhaserUiAdapterV1(scene);
  const battle = new PhaserBattleAdapterV1(scene);
  const surface = new PhaserSurfaceAdapterV1(scene);
  const trace = new PresentationSettlementTraceV1();
  const acknowledgedStorageRequests = new Set<number>();
  let work = Promise.resolve();
  let disposed = false;
  let dispatch: (request: BrowserRequestV1, inputStartedAt?: number) => Promise<BrowserResponseEnvelopeV1[]>;

  const handleStorageEffect = async (effect: Extract<BrowserEffectV1, { kind: "STORAGE_REQUEST" }>): Promise<void> => {
    if (storage == null) {
      throw new Error("Rust Phaser route received storage work without an isolated save handler");
    }
    const request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(effect.value))) as {
      request_id?: unknown;
    };
    if (!Number.isSafeInteger(request.request_id) || Number(request.request_id) < 1) {
      throw new Error("Rust Phaser route received an invalid storage request identity");
    }
    const requestId = Number(request.request_id);
    const result = await storage.handleRequest(Uint8Array.from(effect.value));
    try {
      if (acknowledgedStorageRequests.has(requestId)) {
        return;
      }
      await dispatch({
        kind: "STORAGE_RESULT",
        value: { request_id: requestId, bytes: Array.from(result) },
      });
      acknowledgedStorageRequests.add(requestId);
      while (acknowledgedStorageRequests.size > 2_048) {
        const first = acknowledgedStorageRequests.values().next().value;
        if (first == null) {
          break;
        }
        acknowledgedStorageRequests.delete(first);
      }
    } finally {
      result.fill(0);
    }
  };

  const handleEffect = async (envelope: BrowserResponseEnvelopeV1, effect: BrowserEffectV1): Promise<void> => {
    if (effect.kind === "UI_CHANGED") {
      const startedAt = performance.now();
      ui.render(Uint8Array.from(effect.value));
      recordBoundedMeasure("er:m9:main-thread-adapter", startedAt, performance.now());
    } else if (effect.kind === "PRESENTATION_SCENE_CHANGED") {
      const startedAt = performance.now();
      surface.render(Uint8Array.from(effect.value));
      recordBoundedMeasure("er:m9:main-thread-adapter", startedAt, performance.now());
    } else if (effect.kind === "PRESENTATION") {
      const bytes = Uint8Array.from(effect.value);
      const cue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { event_id: string };
      const generation = envelope.accepted_sequence;
      trace.begin(cue.event_id, generation, "PHASER");
      const outcome = await battle.present(bytes);
      trace.settle(cue.event_id, generation, outcome);
      await dispatch({ kind: "PRESENTATION_SETTLED", value: { event_id: cue.event_id, outcome } });
    } else if (effect.kind === "STORAGE_REQUEST") {
      await handleStorageEffect(effect);
    }
  };

  const handle = async (responses: readonly BrowserResponseEnvelopeV1[], inputStartedAt?: number): Promise<void> => {
    let inputEffectObserved = false;
    for (const envelope of responses) {
      if (envelope.response.kind === "FAULT") {
        throw new Error(`${envelope.response.value.code}: ${envelope.response.value.message}`);
      }
      if (envelope.response.kind !== "EFFECTS") {
        continue;
      }
      for (const effect of envelope.response.value.effects) {
        if (
          inputStartedAt != null
          && !inputEffectObserved
          && ["UI_CHANGED", "PRESENTATION_SCENE_CHANGED", "PRESENTATION"].includes(effect.kind)
        ) {
          inputEffectObserved = true;
          recordBoundedMeasure("er:m9:input-to-effect", inputStartedAt, performance.now());
        }
        await handleEffect(envelope, effect);
      }
      clock.schedule(envelope.response.value.next_wakeup_micros);
    }
  };

  dispatch = async (request: BrowserRequestV1, inputStartedAt?: number): Promise<BrowserResponseEnvelopeV1[]> => {
    if (disposed) {
      throw new Error("Rust Phaser route is disposed");
    }
    const responses = await host.dispatch(request);
    await handle(responses, inputStartedAt);
    return responses;
  };

  const enqueue = (request: BrowserRequestV1): void => {
    const inputStartedAt = request.kind === "RAW_INPUT" ? performance.now() : undefined;
    work = work.then(() => dispatch(request, inputStartedAt)).then(() => undefined);
  };

  const clock = new BrowserClockAdapter({ emit: enqueue });
  const lifecycle = new BrowserLifecycleAdapter({ emit: enqueue, clock });
  const input = new BrowserRawInputAdapter({ emit: enqueue });
  lifecycle.start();
  input.start();
  enqueue({ kind: "OBSERVE", value: { profile: "RUST_PHASER_INITIAL" } });

  return {
    mechanicalDigest: async () => {
      await work;
      const responses = await dispatch({ kind: "OBSERVE", value: { profile: "RUST_PHASER_DIGEST" } });
      const digest = responses.at(-1)?.after_mechanical_digest;
      if (digest == null) {
        throw new Error("Rust Phaser route returned no digest");
      }
      return digest;
    },
    renderTrace: () => trace.snapshot(),
    dispose: async () => {
      if (disposed) {
        return;
      }
      input.dispose();
      lifecycle.dispose();
      clock.dispose();
      await work.catch(() => undefined);
      disposed = true;
      acknowledgedStorageRequests.clear();
      trace.dispose();
      battle.dispose();
      surface.dispose();
      ui.dispose();
      await host.dispose();
    },
  };
}

function recordBoundedMeasure(name: string, startedAt: number, endedAt: number): void {
  if (performance.getEntriesByName(name, "measure").length >= 512) {
    performance.clearMeasures(name);
  }
  performance.measure(name, { start: startedAt, end: endedAt });
}
