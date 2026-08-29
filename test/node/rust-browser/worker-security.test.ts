import { describe, expect, it } from "vitest";
import {
  BrowserExecutionModeV1,
  type BrowserRequestEnvelopeV1,
  type BrowserResponseEnvelopeV1,
} from "../../../src/rust-browser/contracts/browser-contracts";
import { RustBrowserHost } from "../../../src/rust-browser/host/rust-browser-host";

class ContractWorker extends EventTarget {
  terminated = false;
  hold = false;
  readonly held: ArrayBuffer[] = [];

  postMessage(message: ArrayBuffer): void {
    if (this.terminated) {
      throw new Error("worker is terminated");
    }
    if (this.hold) {
      this.held.push(message);
      return;
    }
    this.respond(message);
  }

  respond(message: ArrayBuffer): void {
    const requests = JSON.parse(new TextDecoder().decode(message)) as BrowserRequestEnvelopeV1[];
    const responses: BrowserResponseEnvelopeV1[] = requests.map(request => ({
      version: 1,
      request_id: request.request_id,
      accepted_sequence: request.sequence,
      after_mechanical_digest: `digest-${request.sequence}`,
      response:
        request.request.kind === "INITIALIZE"
          ? { kind: "READY", value: { identity_bytes: [1] } }
          : request.request.kind === "SNAPSHOT"
            ? { kind: "SNAPSHOT", value: [1, 2, 3] }
            : request.request.kind === "EXPORT_REPRO"
              ? { kind: "REPRO", value: [4, 5, 6] }
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
    const bytes = new TextEncoder().encode(JSON.stringify(responses));
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: bytes.buffer })));
  }

  terminate(): void {
    this.terminated = true;
  }
}

function options(worker: ContractWorker, maximumPendingRequests = 4) {
  return {
    workerUrl: new URL("https://example.invalid/rust-kernel-worker.js"),
    initialize: {
      kind: "INITIALIZE" as const,
      value: {
        mode: BrowserExecutionModeV1.RUST_LOCAL_AUTHORITY,
        execution_identity_bytes: [1],
        session_start_bytes: [2],
        maximum_pending_requests: maximumPendingRequests,
      },
    },
    maximumPendingRequests,
    workerFactory: () => worker as unknown as Worker,
  };
}

describe("Rust browser worker security boundary", () => {
  it("runs through one worker and releases it on disposal", async () => {
    const worker = new ContractWorker();
    const host = await RustBrowserHost.create(options(worker));
    await expect(host.snapshot()).resolves.toEqual(Uint8Array.from([1, 2, 3]));
    await expect(host.exportRepro()).resolves.toEqual(Uint8Array.from([4, 5, 6]));
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(host))).not.toEqual(
      expect.arrayContaining(["chooseMove", "resolveTurn", "selectReward", "submitCommand"]),
    );
    await host.dispose();
    expect(worker.terminated).toBe(true);
    await expect(host.snapshot()).rejects.toThrow(/disposed/u);
  });

  it("rejects queue overflow before posting another worker message", async () => {
    const worker = new ContractWorker();
    const host = await RustBrowserHost.create(options(worker, 1));
    worker.hold = true;
    const pending = host.dispatch({ kind: "OBSERVE", value: { profile: "held" } });
    await expect(host.dispatch({ kind: "SNAPSHOT" })).rejects.toThrow(/backpressure/u);
    expect(worker.held).toHaveLength(1);
    worker.hold = false;
    worker.respond(worker.held.shift() as ArrayBuffer);
    await expect(pending).resolves.toHaveLength(1);
    await host.dispose();
  });

  it("terminates the session on stale or conflicting response identity", async () => {
    class ConflictingWorker extends ContractWorker {
      override respond(message: ArrayBuffer): void {
        const requests = JSON.parse(new TextDecoder().decode(message)) as BrowserRequestEnvelopeV1[];
        const request = requests[0];
        const response: BrowserResponseEnvelopeV1[] = [
          {
            version: 1,
            request_id: request.request_id + 1,
            accepted_sequence: request.sequence,
            after_mechanical_digest: "conflict",
            response: { kind: "READY", value: { identity_bytes: [] } },
          },
        ];
        const bytes = new TextEncoder().encode(JSON.stringify(response));
        queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: bytes.buffer })));
      }
    }
    const worker = new ConflictingWorker();
    await expect(RustBrowserHost.create(options(worker))).rejects.toThrow(/correlation/u);
    expect(worker.terminated).toBe(true);
  });
});
