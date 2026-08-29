import { describe, expect, it } from "vitest";
import {
  BrowserExecutionModeV1,
  type BrowserRequestEnvelopeV1,
  type BrowserResponseEnvelopeV1,
} from "../../../src/rust-browser/contracts/browser-contracts";
import { projectShadowBoundary } from "../../../src/rust-browser/shadow/common-projection";
import { RustShadowHostV1 } from "../../../src/rust-browser/shadow/rust-shadow-host";
import { prepareNaturalSaveShadowBootstrap } from "../../../src/rust-browser/shadow/shadow-bootstrap";
import { TypeScriptBoundaryCaptureV1 } from "../../../src/rust-browser/shadow/typescript-boundary-capture";

class QuarantinedWorker extends EventTarget {
  terminated = false;
  posts = 0;
  rustHp = 10;

  postMessage(message: ArrayBuffer): void {
    this.posts += 1;
    const requests = JSON.parse(new TextDecoder().decode(message)) as BrowserRequestEnvelopeV1[];
    const responses: BrowserResponseEnvelopeV1[] = requests.map(request => {
      if (request.request.kind === "INITIALIZE") {
        return {
          version: 1,
          request_id: request.request_id,
          accepted_sequence: request.sequence,
          after_mechanical_digest: "init",
          response: { kind: "READY", value: { identity_bytes: [1] } },
        };
      }
      const observation = new TextEncoder().encode(
        JSON.stringify({
          mechanical_state: { hp: this.rustHp },
          rng_queries: [],
          control: { kind: "BATTLE_COMMAND" },
          presentation: [],
          canonical_save: { wave: 1 },
        }),
      );
      return {
        version: 1,
        request_id: request.request_id,
        accepted_sequence: request.sequence,
        after_mechanical_digest: `digest-${request.sequence}`,
        response: {
          kind: "EFFECTS",
          value: {
            external_sequence: request.sequence,
            effects: [
              { kind: "STORAGE_REQUEST", value: [1] },
              { kind: "SEND_NETWORK_FRAME", value: { generation: 1, bytes: [2] } },
            ],
            observation_bytes: Array.from(observation),
            next_wakeup_micros: null,
          },
        },
      };
    });
    const bytes = new TextEncoder().encode(JSON.stringify(responses));
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: bytes.buffer })));
  }

  terminate(): void {
    this.terminated = true;
  }
}

function typescript(sequence: number, hp = 10) {
  return projectShadowBoundary("TYPESCRIPT", sequence, "TURN", `turn/${sequence}`, {
    mechanical_state: { hp },
    rng_queries: [],
    control: { kind: "BATTLE_COMMAND" },
    presentation: [],
    canonical_save: { wave: 1 },
  });
}

describe("Rust shadow isolation", () => {
  it("quarantines every Rust effect and stops after first mechanical divergence", async () => {
    const worker = new QuarantinedWorker();
    const host = await RustShadowHostV1.create({
      workerUrl: new URL("https://example.invalid/rust-shadow-worker.js"),
      initialize: {
        kind: "INITIALIZE",
        value: {
          mode: BrowserExecutionModeV1.TYPESCRIPT_WITH_RUST_SHADOW,
          execution_identity_bytes: [1],
          session_start_bytes: [2],
          maximum_pending_requests: 8,
        },
      },
      workerFactory: () => worker as unknown as Worker,
    });
    const equal = await host.observe(typescript(1), { kind: "OBSERVE", value: { profile: "shadow-1" } });
    expect(equal.comparison.classification).toBe("EQUAL");
    expect(equal.quarantined_effect_count).toBe(2);

    worker.rustHp = 9;
    const divergent = await host.observe(typescript(2), { kind: "OBSERVE", value: { profile: "shadow-2" } });
    expect(divergent.comparison.classification).toBe("MECHANICAL_DIVERGENCE");
    expect(divergent.comparison.first_difference?.path).toBe("$.mechanical_state.hp");
    const postsAtDivergence = worker.posts;
    const stopped = await host.observe(typescript(3), { kind: "OBSERVE", value: { profile: "shadow-3" } });
    expect(stopped).toBe(divergent);
    expect(worker.posts).toBe(postsAtDivergence);
    await host.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("captures TypeScript boundaries in exact observer order and tears down", () => {
    const capture = new TypeScriptBoundaryCaptureV1(2);
    const observed: number[] = [];
    const unsubscribe = capture.subscribe(value => observed.push(value.sequence));
    capture.capture({ boundary: "BOOTSTRAP", operationId: "bootstrap/1", payload: { state: { wave: 1 } } });
    capture.capture({
      boundary: "COMMAND_CONTROL",
      operationId: "control/1",
      payload: { control: { kind: "COMMAND" } },
    });
    capture.capture({ boundary: "TURN", operationId: "turn/1", payload: { state: { wave: 1 } } });
    expect(observed).toEqual([1, 2, 3]);
    expect(capture.retained().map(value => value.sequence)).toEqual([2, 3]);
    unsubscribe();
    capture.dispose();
    expect(capture.retained()).toHaveLength(0);
  });

  it("normalizes a natural save and starts only the quarantined shadow mode", () => {
    const bootstrap = prepareNaturalSaveShadowBootstrap({
      operationId: "save/bootstrap/1",
      typescriptSave: { z: 2, a: { wave: 1 } },
      executionIdentityBytes: Uint8Array.from([1]),
      rustSessionStartBytes: Uint8Array.from([2]),
    });
    expect(new TextDecoder().decode(bootstrap.normalizedTypeScriptSaveBytes)).toBe('{"a":{"wave":1},"z":2}');
    expect(bootstrap.initializeRequest.value.mode).toBe(BrowserExecutionModeV1.TYPESCRIPT_WITH_RUST_SHADOW);
    expect(bootstrap.saveProjection.save).toEqual({ a: { wave: 1 }, z: 2 });
  });
});
