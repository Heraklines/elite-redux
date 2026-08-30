import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ConnectionGenerationV1 } from "../../../../src/rust-browser/adapters/connection-generation";
import { installAtomicReleaseCache, loadAtomicReleaseCache } from "../../../../src/rust-browser/adapters/release-cache";
import {
  assertCompatibleRustPeer,
  type BrowserKernelCompatibilityV1,
  encodeCompatibilityHandshake,
} from "../../../../src/rust-browser/adapters/signaling-adapter";
import type { VerifiedCoopTransportContextV1 } from "../../../../src/rust-browser/adapters/transport-adapter";
import { RustBrowserTransportAdapterV1 } from "../../../../src/rust-browser/adapters/transport-adapter";
import { encodeCanonicalJsonV1 } from "../../../../src/rust-browser/host/message-sequencer";
import {
  type CoopFrameBindingV1,
  type CoopFrameParticipantBindingV1,
  verifySignedCoopFrameBindingV1,
} from "../../../../src/rust-browser/production/coop-frame";
import type { TrustedBrowserReleaseKeyV1 } from "../../../../src/rust-browser/production/signature-verifier";
import { PresentationSettlementTraceV1 } from "../../../../src/rust-browser/render/presentation-settlement";

const identity: BrowserKernelCompatibilityV1 = {
  browser_worker_protocol: 1,
  frame_envelope_version: 1,
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
  readonly ordered = true;
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

async function frameContexts(generation: number): Promise<{
  left: VerifiedCoopTransportContextV1;
  right: VerifiedCoopTransportContextV1;
}> {
  const leftKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  const rightKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  const participants: CoopFrameParticipantBindingV1[] = [
    {
      participant_id: "left",
      seat_id: 0,
      frame_public_key: Array.from(new Uint8Array(await crypto.subtle.exportKey("raw", leftKeys.publicKey))),
      connection_generation: generation,
    },
    {
      participant_id: "right",
      seat_id: 1,
      frame_public_key: Array.from(new Uint8Array(await crypto.subtle.exportKey("raw", rightKeys.publicKey))),
      connection_generation: generation,
    },
  ];
  const binding: CoopFrameBindingV1 = {
    schema_version: 1,
    binding_id: `binding-${generation}`,
    party_id: "party-1",
    session_id: "session-1",
    release_id: identity.release_id,
    authority_protocol: "er-coop-47",
    authority_seat_id: 0,
    participants,
    issued_at: 1,
    expires_at: Number.MAX_SAFE_INTEGER,
  };
  const releaseKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", releaseKeys.publicKey));
  const trusted: TrustedBrowserReleaseKeyV1[] = [
    {
      key_id: "release-key",
      public_key: Array.from(publicKey),
      channels: ["STABLE"],
      minimum_release_epoch: 1,
      revoked: false,
    },
  ];
  const prefix = new TextEncoder().encode("er-m9:coop-frame-binding-v1\0");
  const canonical = encodeCanonicalJsonV1(binding);
  const signedBytes = new Uint8Array(prefix.byteLength + canonical.byteLength);
  signedBytes.set(prefix);
  signedBytes.set(canonical, prefix.byteLength);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, releaseKeys.privateKey, signedBytes));
  const verifiedBinding = await verifySignedCoopFrameBindingV1({
    envelope: {
      envelope_version: 1,
      key_id: "release-key",
      payload: binding,
      signature: Array.from(signature),
    },
    trustedKeys: trusted,
    channel: "STABLE",
    releaseId: identity.release_id,
    now: 2,
  });
  canonical.fill(0);
  signedBytes.fill(0);
  signature.fill(0);
  return {
    left: {
      binding: verifiedBinding,
      local_participant_id: "left",
      peer_participant_id: "right",
      local_private_key: leftKeys.privateKey,
    },
    right: {
      binding: verifiedBinding,
      local_participant_id: "right",
      peer_participant_id: "left",
      local_private_key: rightKeys.privateKey,
    },
  };
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

  it("sends exactly one compatibility handshake when open is observed twice", async () => {
    const channel = new PairedChannel();
    channel.readyState = "open";
    const transport = new RustBrowserTransportAdapterV1({ compatibility: identity, emit: () => undefined });
    const context = await frameContexts(1);
    transport.attach(channel as unknown as RTCDataChannel, context.left);
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
    const firstContext = await frameContexts(1);
    const leftGeneration = left.attach(leftChannel as unknown as RTCDataChannel, firstContext.left);
    right.attach(rightChannel as unknown as RTCDataChannel, firstContext.right);
    leftChannel.open();
    rightChannel.open();
    await flushMicrotasks();
    expect(leftEvents.at(-1)).toMatchObject({ kind: "TRANSPORT_CHANGED", value: { connected: true } });
    expect(rightEvents.at(-1)).toMatchObject({ kind: "TRANSPORT_CHANGED", value: { connected: true } });
    await left.send(leftGeneration, Uint8Array.from([7, 8]));
    await vi.waitFor(() => {
      expect(rightEvents.at(-1)).toEqual({ kind: "NETWORK_FRAME", value: { generation: 1, bytes: [7, 8] } });
    });

    const [rejoinedLeft, rejoinedRight] = pair();
    const secondContext = await frameContexts(2);
    const nextGeneration = left.attach(rejoinedLeft as unknown as RTCDataChannel, secondContext.left);
    right.attach(rejoinedRight as unknown as RTCDataChannel, secondContext.right);
    rejoinedLeft.open();
    rejoinedRight.open();
    await flushMicrotasks();
    await expect(left.send(leftGeneration, Uint8Array.from([1]))).rejects.toThrow(/generation/u);
    expect(nextGeneration).toBe(2);
    await left.send(nextGeneration, Uint8Array.of(9));
    await vi.waitFor(() => {
      expect(rightEvents.at(-1)).toEqual({ kind: "NETWORK_FRAME", value: { generation: 2, bytes: [9] } });
    });
    left.dispose();
    right.dispose();
  });

  it("rejects raw, duplicated, and stale authenticated frames before Rust delivery", async () => {
    const [leftChannel, rightChannel] = pair();
    const rightEvents: Array<{ kind: string; value?: unknown }> = [];
    const left = new RustBrowserTransportAdapterV1({ compatibility: identity, emit: () => undefined });
    const right = new RustBrowserTransportAdapterV1({
      compatibility: identity,
      emit: value => rightEvents.push(value),
    });
    const contexts = await frameContexts(1);
    const generation = left.attach(leftChannel as unknown as RTCDataChannel, contexts.left);
    right.attach(rightChannel as unknown as RTCDataChannel, contexts.right);
    leftChannel.open();
    rightChannel.open();
    await flushMicrotasks();
    await left.send(generation, Uint8Array.of(7, 8));
    await vi.waitFor(() => {
      expect(rightEvents.filter(value => value.kind === "NETWORK_FRAME")).toHaveLength(1);
    });
    const acceptedEnvelope = leftChannel.sent.at(-1);
    if (acceptedEnvelope == null) {
      throw new Error("authenticated test frame was not sent");
    }
    rightChannel.dispatchEvent(new MessageEvent("message", { data: Uint8Array.from(acceptedEnvelope).buffer }));
    await vi.waitFor(() => {
      expect(rightEvents.at(-1)).toMatchObject({ kind: "TRANSPORT_CHANGED", value: { connected: false } });
    });
    expect(rightEvents.filter(value => value.kind === "NETWORK_FRAME")).toHaveLength(1);

    const [rawLeftChannel, rawRightChannel] = pair();
    const rawEvents: Array<{ kind: string; value?: unknown }> = [];
    const rawLeft = new RustBrowserTransportAdapterV1({ compatibility: identity, emit: () => undefined });
    const rawRight = new RustBrowserTransportAdapterV1({
      compatibility: identity,
      emit: value => rawEvents.push(value),
    });
    const rawContexts = await frameContexts(1);
    rawLeft.attach(rawLeftChannel as unknown as RTCDataChannel, rawContexts.left);
    rawRight.attach(rawRightChannel as unknown as RTCDataChannel, rawContexts.right);
    rawLeftChannel.open();
    rawRightChannel.open();
    await flushMicrotasks();
    rawRightChannel.dispatchEvent(new MessageEvent("message", { data: Uint8Array.of(1, 2, 3).buffer }));
    await vi.waitFor(() => {
      expect(rawEvents.at(-1)).toMatchObject({ kind: "TRANSPORT_CHANGED", value: { connected: false } });
    });
    expect(rawEvents.some(value => value.kind === "NETWORK_FRAME")).toBe(false);
    left.dispose();
    right.dispose();
    rawLeft.dispose();
    rawRight.dispose();
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
