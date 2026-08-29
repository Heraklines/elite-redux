import type Phaser from "phaser";
import { BrowserClockAdapter } from "../adapters/clock-adapter";
import { BrowserRawInputAdapter } from "../adapters/input-adapter";
import { BrowserLifecycleAdapter } from "../adapters/lifecycle-adapter";
import {
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
  const ui = new PhaserUiAdapterV1(options.scene);
  const battle = new PhaserBattleAdapterV1(options.scene);
  const surface = new PhaserSurfaceAdapterV1(options.scene);
  const trace = new PresentationSettlementTraceV1();
  let work = Promise.resolve();
  let disposed = false;

  const handle = async (responses: readonly BrowserResponseEnvelopeV1[]): Promise<void> => {
    for (const envelope of responses) {
      if (envelope.response.kind === "FAULT") {
        throw new Error(`${envelope.response.value.code}: ${envelope.response.value.message}`);
      }
      if (envelope.response.kind !== "EFFECTS") {
        continue;
      }
      for (const effect of envelope.response.value.effects) {
        if (effect.kind === "UI_CHANGED") {
          ui.render(Uint8Array.from(effect.value));
        } else if (effect.kind === "PRESENTATION_SCENE_CHANGED") {
          surface.render(Uint8Array.from(effect.value));
        } else if (effect.kind === "PRESENTATION") {
          const bytes = Uint8Array.from(effect.value);
          const cue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { event_id: string };
          const generation = envelope.accepted_sequence;
          trace.begin(cue.event_id, generation, "PHASER");
          const outcome = await battle.present(bytes);
          trace.settle(cue.event_id, generation, outcome);
          await dispatch({ kind: "PRESENTATION_SETTLED", value: { event_id: cue.event_id, outcome } });
        }
      }
      clock.schedule(envelope.response.value.next_wakeup_micros);
    }
  };

  const dispatch = async (request: BrowserRequestV1): Promise<BrowserResponseEnvelopeV1[]> => {
    if (disposed) {
      throw new Error("Rust Phaser route is disposed");
    }
    const responses = await host.dispatch(request);
    await handle(responses);
    return responses;
  };

  const enqueue = (request: BrowserRequestV1): void => {
    work = work.then(() => dispatch(request)).then(() => undefined);
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
      trace.dispose();
      battle.dispose();
      surface.dispose();
      ui.dispose();
      await host.dispose();
    },
  };
}
