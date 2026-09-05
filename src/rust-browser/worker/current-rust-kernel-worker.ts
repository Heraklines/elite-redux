/** Explicit current development Worker. The V1 production entry is unchanged. */
import {
  type BrowserRequestEnvelopeV2,
  type CurrentWorkerFailureV2,
  decodeBrowserResponseEnvelopeV2,
  MAXIMUM_BROWSER_REQUEST_BYTES_V2,
  safeCurrentInteger,
} from "../contracts/browser-contracts-v2";
import {
  type CurrentWorkerAssetsV2,
  fetchCurrentVerifiedAssetV2,
  loadCurrentRustWasmModuleV2,
  type RustWasmHostV2,
} from "./rust-wasm-loader";

interface WorkerPortV2 {
  postMessage(value: unknown, transfer?: Transferable[]): void;
  close(): void;
}

const port = self as unknown as WorkerPortV2;
const abort = new AbortController();
let assets: CurrentWorkerAssetsV2 | null = null;
let host: RustWasmHostV2 | null = null;
let busy = false;
let closed = false;
let nextSequence = 0;
let acceptedSequence: number | null = null;

function release(): void {
  closed = true;
  abort.abort();
  const previous = host;
  host = null;
  previous?.free();
}

function fail(code: string, message: string, envelope: BrowserRequestEnvelopeV2 | null, known: boolean): void {
  const failure: CurrentWorkerFailureV2 = {
    kind: "CURRENT_WORKER_FAILURE_V2", version: 2,
    request_id: envelope?.request_id ?? null, sequence: envelope?.sequence ?? null,
    code, message: message.slice(0, 512),
    ...(known ? { acceptance: "REJECTED" as const, accepted_sequence: acceptedSequence }
      : { acceptance: "UNKNOWN" as const, accepted_sequence: null }),
  };
  try { port.postMessage(failure); }
  catch { known = false; }
  if (!known) {
    try { release(); } finally { port.close(); }
  }
}

function configure(value: unknown): void {
  if (assets != null || host != null || busy || closed || typeof value !== "object" || value == null) {
    throw new Error("current Worker configuration is already owned or invalid");
  }
  const candidate = value as CurrentWorkerAssetsV2;
  for (const key of ["wasm_url", "glue_url", "content_url"] as const) {
    if (typeof candidate[key] !== "string" || candidate[key].length > 2048
      || new URL(candidate[key], self.location.href).origin !== self.location.origin) {
      throw new Error("current Worker configuration requires bounded same-origin URLs");
    }
  }
  for (const key of ["wasm_sha256", "glue_sha256", "content_sha256"] as const) {
    if (typeof candidate[key] !== "string" || !/^[0-9a-f]{64}$/u.test(candidate[key])) {
      throw new Error("current Worker configuration requires exact asset hashes");
    }
  }
  assets = { wasm_url: candidate.wasm_url, wasm_sha256: candidate.wasm_sha256,
    glue_url: candidate.glue_url, glue_sha256: candidate.glue_sha256,
    content_url: candidate.content_url, content_sha256: candidate.content_sha256 };
}

async function process(buffer: ArrayBuffer): Promise<void> {
  let envelope: BrowserRequestEnvelopeV2 | null = null;
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)) as BrowserRequestEnvelopeV2;
    if (parsed == null || !safeCurrentInteger(parsed.request_id) || !safeCurrentInteger(parsed.sequence)) {
      throw new Error("current Worker request correlation is invalid");
    }
    envelope = parsed;
    if (envelope.version !== 2) {
      fail("INVALID_ABI", "current Worker accepts only browser ABI2 envelopes", envelope, true);
      return;
    }
    if (envelope.sequence !== nextSequence || !safeCurrentInteger(nextSequence + 1)) {
      fail("INVALID_SEQUENCE", "current Worker request sequence is not its next frontier", envelope, true);
      return;
    }
    if (host == null) {
      if (assets == null || envelope.request?.kind !== "INITIALIZE") {
        fail("INITIALIZE_REQUIRED", "configure and initialize the current Worker first", envelope, true);
        return;
      }
      const module = await loadCurrentRustWasmModuleV2(assets, abort.signal);
      const content = await fetchCurrentVerifiedAssetV2(assets.content_url, assets.content_sha256, 32 * 1024 * 1024, abort.signal);
      try {
        if (closed) return;
        host = new module.BrowserKernelHostV2(content);
      } finally { content.fill(0); }
    }
    if (closed || host == null) return;
    let result: Uint8Array;
    try {
      result = host.process(new Uint8Array(buffer));
    } catch (error) {
      // host_v2::js_error returns a string for a transactional Result::Err.
      // Traps/JS failures have uncertain acceptance and fence the Worker.
      if (typeof error === "string") {
        fail("HOST_REJECTED", error, envelope, true);
        return;
      }
      throw error;
    }
    try {
      const bytes = Uint8Array.from(result);
      const response = decodeBrowserResponseEnvelopeV2(bytes.buffer);
      if (response.request_id !== envelope.request_id || response.accepted_sequence !== envelope.sequence) {
        throw new Error("current Wasm host returned mismatched correlation");
      }
      acceptedSequence = response.accepted_sequence;
      nextSequence += 1;
      port.postMessage(bytes.buffer, [bytes.buffer]);
      if (response.response.kind === "DISPOSED") {
        try { release(); } finally { port.close(); }
      }
    } finally { result.fill(0); }
  } catch (error) {
    fail("WORKER_FAILURE", error instanceof Error ? error.message : String(error), envelope, false);
  } finally {
    new Uint8Array(buffer).fill(0);
  }
}

self.onmessage = (event: MessageEvent<unknown>): void => {
  if (closed) return;
  const configuration = event.data as { kind?: unknown; assets?: unknown } | null;
  if (configuration?.kind === "CONFIGURE_CURRENT_WORKER_V2") {
    try { configure(configuration.assets); }
    catch (error) { fail("INVALID_CONFIGURATION", String(error), null, false); }
    return;
  }
  if (busy || !(event.data instanceof ArrayBuffer) || event.data.byteLength === 0
    || event.data.byteLength > MAXIMUM_BROWSER_REQUEST_BYTES_V2) {
    fail("INVALID_WORKER_MESSAGE", "current Worker requires one bounded request at a time", null, false);
    return;
  }
  busy = true;
  void process(event.data).finally(() => { busy = false; });
};
