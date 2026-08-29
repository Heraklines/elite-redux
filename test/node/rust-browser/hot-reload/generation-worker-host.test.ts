import { afterEach, describe, expect, it } from "vitest";
import {
  BrowserExecutionModeV1,
  type BrowserRequestEnvelopeV1,
} from "../../../../src/rust-browser/contracts/browser-contracts";
import type { BrowserKernelGenerationIdentityV1 } from "../../../../src/rust-browser/hot-reload/contracts";
import { GenerationWorkerHostV1 } from "../../../../src/rust-browser/hot-reload/generation-worker-host";

class FakeGenerationWorker {
  terminated = false;
  corruptNext = false;
  readonly #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.#listeners.get(type)?.delete(listener);
  }

  postMessage(value: unknown): void {
    const attach = value as { kind?: string; generation?: number; port?: MessagePort };
    if (attach.kind !== "ATTACH_PORT_V1" || !(attach.port instanceof MessagePort)) {
      throw new Error("fake Worker expected generation port");
    }
    const port = attach.port;
    port.onmessage = event => {
      const requests = JSON.parse(new TextDecoder().decode(event.data as ArrayBuffer)) as BrowserRequestEnvelopeV1[];
      const responses = requests.map(request => ({
        version: 1,
        request_id: this.corruptNext ? request.request_id + 1 : request.request_id,
        accepted_sequence: request.sequence,
        after_mechanical_digest: `generation-${attach.generation}`,
        response:
          request.request.kind === "INITIALIZE"
            ? { kind: "READY", value: { identity_bytes: [] } }
            : request.request.kind === "SNAPSHOT"
              ? { kind: "SNAPSHOT", value: [123] }
              : request.request.kind === "DISPOSE"
                ? { kind: "DISPOSED" }
                : {
                    kind: "EFFECTS",
                    value: {
                      external_sequence: request.sequence,
                      effects: [],
                      observation_bytes: [],
                      next_wakeup_micros: null,
                    },
                  },
      }));
      this.corruptNext = false;
      const bytes = new TextEncoder().encode(JSON.stringify(responses));
      port.postMessage(bytes.buffer, [bytes.buffer]);
    };
    port.start();
  }

  terminate(): void {
    this.terminated = true;
  }
}

const workers: FakeGenerationWorker[] = [];

afterEach(() => {
  workers.length = 0;
});

function identity(): BrowserKernelGenerationIdentityV1 {
  return {
    schema_version: 1,
    session_id: "worker-host",
    generation: 2,
    artifact_sha256: "a".repeat(64),
    wasm_sha256: "b".repeat(64),
    content_sha256: "c".repeat(64),
    source_git_sha: "d".repeat(40),
    worker_abi_version: 1,
    minimum_snapshot_schema: 6,
    maximum_snapshot_schema: 6,
    content_identity: "content",
    release_id: "release",
  };
}

function createHost() {
  return GenerationWorkerHostV1.create({
    identity: identity(),
    workerUrl: new URL("https://example.test/worker.js"),
    initialize: {
      kind: "INITIALIZE",
      value: {
        mode: BrowserExecutionModeV1.RUST_LOCAL_AUTHORITY,
        execution_identity_bytes: [],
        session_start_bytes: [1],
        maximum_pending_requests: 8,
      },
    },
    workerFactory() {
      const worker = new FakeGenerationWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
  });
}

describe("generation-aware Worker host", () => {
  it("routes bytes over a private MessagePort and terminates the old Worker", async () => {
    const host = await createHost();
    expect(await host.snapshot()).toEqual(Uint8Array.from([123]));
    await host.dispose();
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminated).toBe(true);
  });

  it("rejects a stale or miscorrelated Worker response and fences the Worker", async () => {
    const host = await createHost();
    const worker = workers[0];
    if (worker == null) {
      throw new Error("fake Worker was not created");
    }
    worker.corruptNext = true;
    await expect(host.dispatch({ kind: "ADVANCE_TIME", value: 1 })).rejects.toThrow(/correlation/u);
    expect(worker.terminated).toBe(true);
    await host.dispose();
  });
});
