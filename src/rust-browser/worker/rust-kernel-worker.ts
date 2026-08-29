import {
  BROWSER_WORKER_PROTOCOL_VERSION_V1,
  type BrowserRequestEnvelopeV1,
  type BrowserResponseEnvelopeV1,
  MAXIMUM_BROWSER_BATCH_REQUESTS_V1,
  MAXIMUM_BROWSER_EFFECT_BYTES_V1,
  MAXIMUM_BROWSER_PENDING_REQUESTS_V1,
  MAXIMUM_BROWSER_REQUEST_BYTES_V1,
} from "../contracts/browser-contracts";
import { loadRustWasmModule, type RustWasmHostV1 } from "./rust-wasm-loader";

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
let host: RustWasmHostV1 | null = null;
let disposed = false;
let pending = 0;
let queue = Promise.resolve();

function postBytes(bytes: Uint8Array): void {
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_BROWSER_EFFECT_BYTES_V1) {
    throw new Error("worker response is empty or oversized");
  }
  const transferable = bytes.slice();
  self.postMessage(transferable.buffer, { transfer: [transferable.buffer] });
}

function postProtocolFault(code: string, message: string, requestId = 0, sequence = 0): void {
  const responses: BrowserResponseEnvelopeV1[] = [
    {
      version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
      request_id: requestId,
      accepted_sequence: sequence,
      after_mechanical_digest: "worker-protocol-fault",
      response: {
        kind: "FAULT",
        value: { code, message, normalized_panic: null, repro_reference: null },
      },
    },
  ];
  postBytes(encoder.encode(JSON.stringify(responses)));
}

function parseBatch(buffer: ArrayBuffer): BrowserRequestEnvelopeV1[] {
  const parsed: unknown = JSON.parse(decoder.decode(buffer));
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAXIMUM_BROWSER_BATCH_REQUESTS_V1) {
    throw new Error("worker request batch count is outside the frozen bounds");
  }
  for (const envelope of parsed) {
    if (
      typeof envelope !== "object"
      || envelope == null
      || (envelope as BrowserRequestEnvelopeV1).version !== BROWSER_WORKER_PROTOCOL_VERSION_V1
    ) {
      throw new Error("worker request envelope version is invalid");
    }
  }
  return parsed as BrowserRequestEnvelopeV1[];
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchContent(url: URL, expectedSha256: string): Promise<Uint8Array> {
  if (url.origin !== self.location.origin || !/^[0-9a-f]{64}$/u.test(expectedSha256)) {
    throw new Error("content asset identity is invalid");
  }
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`content fetch failed: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_BROWSER_EFFECT_BYTES_V1) {
    throw new Error("content asset is empty or oversized");
  }
  if ((await sha256(bytes)) !== expectedSha256) {
    bytes.fill(0);
    throw new Error("content asset digest mismatch");
  }
  return bytes;
}

async function initialize(first: BrowserRequestEnvelopeV1): Promise<void> {
  if (first.request.kind !== "INITIALIZE") {
    throw new Error("first browser worker request must initialize the kernel");
  }
  const query = new URLSearchParams(self.location.search);
  const wasmUrl = new URL(query.get("wasm") ?? "", self.location.href);
  const contentUrl = new URL(query.get("content") ?? "", self.location.href);
  const wasmDigest = query.get("wasm_sha256") ?? "";
  const contentDigest = query.get("content_sha256") ?? "";
  const [module, contentBytes] = await Promise.all([
    loadRustWasmModule(wasmUrl, wasmDigest),
    fetchContent(contentUrl, contentDigest),
  ]);
  const initBytes = Uint8Array.from(first.request.value.session_start_bytes);
  try {
    host = module.BrowserKernelHostV1.create(contentBytes, initBytes);
  } finally {
    contentBytes.fill(0);
    initBytes.fill(0);
  }
}

async function processBatch(buffer: ArrayBuffer): Promise<void> {
  if (disposed) {
    postProtocolFault("WORKER_DISPOSED", "worker accepts no work after disposal");
    return;
  }
  const requests = parseBatch(buffer);
  if (host == null) {
    await initialize(requests[0]);
  }
  const current = host;
  if (current == null) {
    throw new Error("Wasm browser host initialization produced no owner");
  }
  const requestBytes = new Uint8Array(buffer);
  let responseBytes: Uint8Array;
  try {
    responseBytes = current.dispatch_batch(requestBytes);
  } finally {
    requestBytes.fill(0);
    for (const request of requests) {
      if (request.request.kind === "INITIALIZE") {
        request.request.value.execution_identity_bytes.fill(0);
        request.request.value.session_start_bytes.fill(0);
      }
    }
  }
  postBytes(responseBytes);
  responseBytes.fill(0);
  if (requests.some(request => request.request.kind === "DISPOSE")) {
    disposed = true;
    current.dispose();
    current.free?.();
    host = null;
  }
}

self.onmessage = (event: MessageEvent<unknown>) => {
  if (
    !(event.data instanceof ArrayBuffer)
    || event.data.byteLength === 0
    || event.data.byteLength > MAXIMUM_BROWSER_REQUEST_BYTES_V1
  ) {
    postProtocolFault("INVALID_WORKER_MESSAGE", "worker message must be a bounded non-empty ArrayBuffer");
    return;
  }
  if (pending >= MAXIMUM_BROWSER_PENDING_REQUESTS_V1) {
    postProtocolFault("WORKER_QUEUE_OVERFLOW", "worker pending request limit exceeded");
    return;
  }
  const buffer = event.data;
  pending += 1;
  queue = queue
    .then(() => processBatch(buffer))
    .catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      postProtocolFault("WORKER_RUNTIME_FAULT", message);
      if (host != null) {
        host.dispose();
        host.free?.();
        host = null;
      }
      disposed = true;
    })
    .finally(() => {
      pending -= 1;
    });
};
