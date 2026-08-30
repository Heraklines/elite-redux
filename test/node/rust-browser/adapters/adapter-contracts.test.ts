import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConnectionGenerationV1 } from "../../../../src/rust-browser/adapters/connection-generation";
import { installAtomicReleaseCache, loadAtomicReleaseCache } from "../../../../src/rust-browser/adapters/release-cache";
import {
  assertCompatibleRustPeer,
  type BrowserKernelCompatibilityV1,
  encodeCompatibilityHandshake,
} from "../../../../src/rust-browser/adapters/signaling-adapter";
import { RustBrowserTransportAdapterV1 } from "../../../../src/rust-browser/adapters/transport-adapter";
import { PresentationSettlementTraceV1 } from "../../../../src/rust-browser/render/presentation-settlement";

const identity: BrowserKernelCompatibilityV1 = {
  browser_worker_protocol: 1,
  authority_protocol: "er-coop-47",
  release_id: "release-v1",
  compatible_releases: [],
  mechanical_identity: "mechanical-v1",
  content_hash: "content-v1",
  material_schema: 5,
  save_schema: 1,
  browser_kernel_abi: 1,
  active_model_identity: "model-v1",
  authority_runtime: "RUST",
};

class PairedChannel extends EventTarget {
  binaryType = "arraybuffer";
  readyState: RTCDataChannelState = "connecting";
  peer: PairedChannel | null = null;
  readonly sent: Uint8Array[] = [];

  open(): void {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }

  send(data: string | Blob | ArrayBuffer | ArrayBufferView): void {
    if (typeof data === "string" || data instanceof Blob) {
      throw new Error("test transport accepts binary only");
    }
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data.slice(0))
        : new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    this.sent.push(bytes);
    const peer = this.peer;
    if (peer != null) {
      queueMicrotask(() => peer.dispatchEvent(new MessageEvent("message", { data: bytes.buffer })));
    }
  }

  close(): void {
    if (this.readyState === "closed") {
      return;
    }
    this.readyState = "closed";
    this.dispatchEvent(new Event("close"));
  }
}

function pair(): [PairedChannel, PairedChannel] {
  const left = new PairedChannel();
  const right = new PairedChannel();
  left.peer = right;
  right.peer = left;
  return [left, right];
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

class MemoryCache {
  readonly values = new Map<string, Response>();

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.values.set(String(request instanceof Request ? request.url : request), response.clone());
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.values.get(String(request instanceof Request ? request.url : request))?.clone();
  }
}

class MemoryCacheStorage {
  readonly caches = new Map<string, MemoryCache>();

  async open(name: string): Promise<Cache> {
    const cache = this.caches.get(name) ?? new MemoryCache();
    this.caches.set(name, cache);
    return cache as unknown as Cache;
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
}

describe("M8 browser adapters", () => {
  it("advances and fences connection generations", () => {
    const generations = new ConnectionGenerationV1();
    const first = generations.advance();
    expect(generations.accepts(first)).toBe(true);
    const second = generations.advance();
    expect(generations.accepts(first)).toBe(false);
    expect(generations.accepts(second)).toBe(true);
    generations.dispose();
    expect(generations.accepts(second)).toBe(false);
  });

  it("rejects mixed authority peers before transport admission", () => {
    expect(assertCompatibleRustPeer(identity, encodeCompatibilityHandshake(identity))).toEqual(identity);
    const mixed = new TextEncoder().encode(JSON.stringify({ ...identity, authority_runtime: "TYPESCRIPT" }));
    expect(() => assertCompatibleRustPeer(identity, mixed)).toThrow(/mixed TypeScript\/Rust/u);
  });

  it("sends exactly one compatibility handshake when open is observed twice", () => {
    const channel = new PairedChannel();
    channel.readyState = "open";
    const transport = new RustBrowserTransportAdapterV1({ compatibility: identity, emit: () => undefined });
    transport.attach(channel as unknown as RTCDataChannel);
    channel.dispatchEvent(new Event("open"));
    expect(channel.sent).toHaveLength(1);
    transport.dispose();
  });

  it("negotiates binary frames and hot-rejoins with a new generation", async () => {
    const [leftChannel, rightChannel] = pair();
    const leftEvents: Array<{ kind: string; value?: unknown }> = [];
    const rightEvents: Array<{ kind: string; value?: unknown }> = [];
    const left = new RustBrowserTransportAdapterV1({ compatibility: identity, emit: value => leftEvents.push(value) });
    const right = new RustBrowserTransportAdapterV1({
      compatibility: identity,
      emit: value => rightEvents.push(value),
    });
    const leftGeneration = left.attach(leftChannel as unknown as RTCDataChannel);
    right.attach(rightChannel as unknown as RTCDataChannel);
    leftChannel.open();
    rightChannel.open();
    await flushMicrotasks();
    expect(leftEvents.at(-1)).toMatchObject({ kind: "TRANSPORT_CHANGED", value: { connected: true } });
    expect(rightEvents.at(-1)).toMatchObject({ kind: "TRANSPORT_CHANGED", value: { connected: true } });
    left.send(leftGeneration, Uint8Array.from([7, 8]));
    await flushMicrotasks();
    expect(rightEvents.at(-1)).toEqual({ kind: "NETWORK_FRAME", value: { generation: 1, bytes: [7, 8] } });

    const [rejoinedLeft, rejoinedRight] = pair();
    const nextGeneration = left.attach(rejoinedLeft as unknown as RTCDataChannel);
    right.attach(rejoinedRight as unknown as RTCDataChannel);
    rejoinedLeft.open();
    rejoinedRight.open();
    await flushMicrotasks();
    expect(() => left.send(leftGeneration, Uint8Array.from([1]))).toThrow(/generation/u);
    expect(nextGeneration).toBe(2);
    left.dispose();
    right.dispose();
  });

  it("records exactly one generation-fenced settlement outcome", () => {
    let now = 1;
    const trace = new PresentationSettlementTraceV1(() => now);

    trace.begin("cue/1", 1, "PHASER");
    now = 2;
    trace.settle("cue/1", 1, "SETTLED");
    expect(trace.snapshot()).toEqual([
      {
        sequence: 1,
        event_id: "cue/1",
        generation: 1,
        renderer: "PHASER",
        started_micros: 1_000,
        completed_micros: 2_000,
        outcome: "SETTLED",
      },
    ]);
    expect(() => trace.settle("cue/1", 1, "SETTLED")).toThrow(/duplicate/u);
    trace.dispose();
    expect(trace.pendingCount()).toBe(0);
  });
  it("publishes only complete digest-verified release caches", async () => {
    const storage = new MemoryCacheStorage();
    const bytes = Uint8Array.from([1, 2, 3]);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(bytes, { status: 200 });
    try {
      await installAtomicReleaseCache(storage as unknown as CacheStorage, {
        schema_version: 1,
        release_id: "release-1",
        browser_sha: "b2ed1a6eb050a18d5f335ec826e01b7b425ce311",
        rust_sha: "ea57c3cedd5dbc5856baf3748c0f03a7dc2c9273",
        assets: [{ url: "https://example.invalid/er_web.wasm", sha256: digest }],
      });
      const loaded = await loadAtomicReleaseCache(storage as unknown as CacheStorage, "release-1");
      expect(loaded.manifest.release_id).toBe("release-1");
      await expect(loadAtomicReleaseCache(storage as unknown as CacheStorage, "release-2")).rejects.toThrow(/mixed/u);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
