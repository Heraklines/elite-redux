import { expect, it, vi } from "vitest";
import { CurrentStorageWorker, type CurrentStorageWorkerOptions } from "../../../../src/rust-browser/routes/rust-current-storage-entry";
import { encodeCanonicalJsonV2, type BrowserEffectV2, type BrowserRequestEnvelopeV2 } from "../../../../src/rust-browser/contracts/browser-contracts-v2";

// The real storage owner, router and serial host run against controlled wire
// responses. This test does not pretend to execute Wasm or a DOM renderer.
class ControlledWorker extends EventTarget {
  static instances: ControlledWorker[] = [];
  requests: BrowserRequestEnvelopeV2[] = [];
  nextEffects: BrowserEffectV2[] = [];
  terminated = false;
  constructor() { super(); ControlledWorker.instances.push(this); }
  postMessage(message: unknown): void {
    if (!(message instanceof ArrayBuffer)) return; // Configuration does not require a reply.
    const request = JSON.parse(new TextDecoder().decode(message)) as BrowserRequestEnvelopeV2;
    this.requests.push(request);
    const effects = this.nextEffects; this.nextEffects = [];
    const response = request.request.kind === "INITIALIZE" ? { kind: "READY" }
      : request.request.kind === "DISPOSE" ? { kind: "DISPOSED" }
      : { kind: "EFFECTS", batch: { external_sequence: request.sequence, effects } };
    const encoded = encodeCanonicalJsonV2({ version: 2, request_id: request.request_id,
      accepted_sequence: request.sequence, response });
    void Promise.resolve().then(() => {
      if (!this.terminated) this.dispatchEvent(new MessageEvent("message", { data: encoded.buffer }));
    });
  }
  terminate(): void { this.terminated = true; }
}
function latch() {
  let release: () => void = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function options(present: CurrentStorageWorkerOptions["present"]): CurrentStorageWorkerOptions {
  const noop = () => {};
  return {
    assets: { wasm_url: "/fixture.wasm", wasm_sha256: "0".repeat(64), glue_url: "/fixture.js",
      glue_sha256: "0".repeat(64), content_url: "/fixture.json", content_sha256: "0".repeat(64) },
    initialization: { kind: "CURRENT_REPRO_CAPSULE", capsule_bytes: [1] },
    sessionIdentity: "presentation-lifetime-wire-fixture",
    backend: { identity: { namespace: "fixture", contentIdentity: "fixture" },
      read: async () => null, list: async () => [], write: async () => {},
      reconcile: async () => "RETRY", close: async () => {} },
    adapters: { renderUi: noop, changePresentationScene: noop, sendNetworkFrame: noop,
      requestAsset: noop, playAudioCue: noop, showTerminal: noop, recordTelemetry: noop,
      publishRepro: noop, publishCurrentRepro: noop }, present,
  };
}
const prompt: BrowserEffectV2 = { kind: "PRESENTATION", effect: {
  event_id: 41, semantic: { kind: "CUE", value: "PROGRESSION" },
  blocking: "BLOCKS_HUMAN_INPUT", skip: "FORBIDDEN",
  payload: { kind: "CANDY_LEVEL_MESSAGE", holder: 1, level: 7 },
} };
function transport(): ControlledWorker {
  const worker = ControlledWorker.instances.at(-1);
  if (worker == null) throw new Error("real owner did not construct its Worker transport");
  return worker;
}

it("human presentation waits survive deadlines, settle once, and abort without late settlement", async () => {
  vi.useFakeTimers(); vi.stubGlobal("Worker", ControlledWorker);
  const owners: CurrentStorageWorker[] = [];
  try {
    const completed = latch(); const entered = latch(); let signal: AbortSignal | undefined;
    const owner = new CurrentStorageWorker(options(async (effect, abort) => {
      expect(effect).toEqual(prompt.kind === "PRESENTATION" ? prompt.effect : null);
      signal = abort; entered.release(); await completed.promise;
    })); owners.push(owner);
    const wire = transport(); await owner.initialize(); wire.nextEffects = [prompt];
    await owner.dispatch({ kind: "ADVANCE_TIME", milliseconds: 0 }); await entered.promise;
    await vi.advanceTimersByTimeAsync(20_001);
    expect(owner.status).toMatchObject({ fenced: false, closed: false, pendingPresentations: 1, presentationsSettled: 0 });
    expect(signal?.aborted).toBe(false);
    expect(wire.requests.filter(row => row.request.kind === "PRESENTATION_SETTLED")).toEqual([]);
    completed.release(); await owner.drainPresentations(); completed.release();
    expect(wire.requests.filter(row => row.request.kind === "PRESENTATION_SETTLED").map(row => row.request))
      .toEqual([{ kind: "PRESENTATION_SETTLED", event_id: 41, outcome: { kind: "SETTLED" } }]);
    expect(owner.status).toMatchObject({ fenced: false, pendingPresentations: 0, presentationsSettled: 1, presentationBytes: 0 });
    expect(await owner.dispose()).toEqual({ acknowledged: true });

    const late = latch(); const lateEntered = latch(); let lateSignal: AbortSignal | undefined;
    const waiting = new CurrentStorageWorker(options(async (_effect, abort) => {
      lateSignal = abort; lateEntered.release(); await late.promise;
    })); owners.push(waiting);
    const lateWire = transport(); await waiting.initialize(); lateWire.nextEffects = [prompt];
    await waiting.dispatch({ kind: "ADVANCE_TIME", milliseconds: 0 }); await lateEntered.promise;
    expect(await waiting.dispose()).toEqual({ acknowledged: false });
    expect(lateSignal?.aborted).toBe(true); expect(lateWire.terminated).toBe(true);
    late.release(); await vi.advanceTimersByTimeAsync(0);
    expect(lateWire.requests.filter(row => row.request.kind === "PRESENTATION_SETTLED")).toEqual([]);
    expect(waiting.status).toMatchObject({ pendingPresentations: 0, presentationsSettled: 0, presentationBytes: 0 });

    // Non-human effect dispatch retains the established ten-second bound.
    const blocked = latch(); const rendering = latch(); const blockedOptions = options(async () => {});
    blockedOptions.adapters.renderUi = async () => { rendering.release(); await blocked.promise; };
    const stalled = new CurrentStorageWorker(blockedOptions); owners.push(stalled);
    const stalledWire = transport(); await stalled.initialize();
    stalledWire.nextEffects = [{ kind: "UI_CHANGED", control: { schema_version: 2, revision: 1,
      kind: "TITLE", owner_seat: 1, action_context: null, menu: null, actionable: false } }];
    const failure = stalled.dispatch({ kind: "ADVANCE_TIME", milliseconds: 0 }).then(() => null, error => error);
    await rendering.promise; await vi.advanceTimersByTimeAsync(10_001);
    expect(String(await failure)).toContain("deadline exceeded");
    expect(stalled.status.fenced).toBe(true); expect(stalledWire.terminated).toBe(true);
    blocked.release(); expect(await stalled.dispose()).toEqual({ acknowledged: false });
  } finally {
    await Promise.all(owners.map(owner => owner.dispose()));
    vi.unstubAllGlobals(); vi.useRealTimers(); ControlledWorker.instances = [];
  }
});
