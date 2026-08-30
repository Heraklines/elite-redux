import {
  BROWSER_WORKER_PROTOCOL_VERSION_V1,
  type BrowserRequestEnvelopeV1,
  type BrowserResponseEnvelopeV1,
  MAXIMUM_BROWSER_BATCH_REQUESTS_V1,
  MAXIMUM_BROWSER_EFFECT_BYTES_V1,
  MAXIMUM_BROWSER_PENDING_REQUESTS_V1,
  MAXIMUM_BROWSER_REQUEST_BYTES_V1,
} from "../contracts/browser-contracts";
import {
  loadRustWasmModule,
  loadRustWasmModuleFromVerifiedBytesV1,
  type RustWasmHostV1,
  type RustWasmModuleV1,
} from "./rust-wasm-loader";

interface WorkerTransferPortV1 {
  postMessage(message: ArrayBuffer, transfer: Transferable[]): void;
}

interface WorkerObjectPortV1 {
  postMessage(message: unknown, transfer?: Transferable[]): void;
}
interface AttachGenerationPortV1 {
  kind: "ATTACH_PORT_V1";
  generation: number;
  port: MessagePort;
}

interface AttachProductionArtifactsV1 {
  kind: "ATTACH_PRODUCTION_ARTIFACTS_V1";
  release_id: string;
  generation: number;
  glue_sha256: string;
  wasm_sha256: string;
  content_sha256: string;
  glue_bytes: ArrayBuffer;
  wasm_bytes: ArrayBuffer;
  content_bytes: ArrayBuffer;
}

interface ProductionArtifactsV1 {
  releaseId: string;
  generation: number;
  glueSha256: string;
  wasmSha256: string;
  contentSha256: string;
  glueBytes: Uint8Array;
  wasmBytes: Uint8Array;
  contentBytes: Uint8Array;
}

interface RestoreProductionSaveV2 {
  kind: "RESTORE_PRODUCTION_SAVE_V2";
  release_id: string;
  generation: number;
  envelope_bytes: ArrayBuffer;
  template_bytes: ArrayBuffer;
}

const globalTransferPort = self as unknown as WorkerTransferPortV1;
const workerObjectPort = self as unknown as WorkerObjectPortV1;
let transferPort: WorkerTransferPortV1 = globalTransferPort;
let generationPort: MessagePort | null = null;
let productionArtifacts: ProductionArtifactsV1 | null = null;

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
  transferPort.postMessage(transferable.buffer, [transferable.buffer]);
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
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
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
  let module: RustWasmModuleV1;
  let contentBytes: Uint8Array;
  if (productionArtifacts == null) {
    const query = new URLSearchParams(self.location.search);
    const wasmUrl = new URL(query.get("wasm") ?? "", self.location.href);
    const contentUrl = new URL(query.get("content") ?? "", self.location.href);
    const wasmDigest = query.get("wasm_sha256") ?? "";
    const contentDigest = query.get("content_sha256") ?? "";
    [module, contentBytes] = await Promise.all([
      loadRustWasmModule(wasmUrl, wasmDigest),
      fetchContent(contentUrl, contentDigest),
    ]);
  } else {
    const artifacts = productionArtifacts;
    productionArtifacts = null;
    if (
      first.request.value.production_release_id !== artifacts.releaseId
      || first.request.value.production_generation !== artifacts.generation
    ) {
      zeroizeProductionArtifacts(artifacts);
      throw new Error("production Worker execution identity is cross-release");
    }
    if ((await sha256(artifacts.contentBytes)) !== artifacts.contentSha256) {
      zeroizeProductionArtifacts(artifacts);
      throw new Error("production content digest mismatch");
    }
    try {
      module = await loadRustWasmModuleFromVerifiedBytesV1({
        glueBytes: artifacts.glueBytes,
        glueSha256: artifacts.glueSha256,
        wasmBytes: artifacts.wasmBytes,
        wasmSha256: artifacts.wasmSha256,
      });
      contentBytes = Uint8Array.from(artifacts.contentBytes);
    } finally {
      zeroizeProductionArtifacts(artifacts);
    }
  }
  const initBytes = Uint8Array.from(first.request.value.session_start_bytes);
  try {
    host = module.BrowserKernelHostV1.create(contentBytes, initBytes);
  } finally {
    contentBytes.fill(0);
    initBytes.fill(0);
  }
}

function zeroizeProductionArtifacts(artifacts: ProductionArtifactsV1): void {
  artifacts.glueBytes.fill(0);
  artifacts.wasmBytes.fill(0);
  artifacts.contentBytes.fill(0);
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

function acceptProtocolMessage(event: MessageEvent<unknown>): void {
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
}

async function processProductionSaveRestoreV2(message: RestoreProductionSaveV2): Promise<void> {
  const artifacts = productionArtifacts;
  productionArtifacts = null;
  if (
    artifacts == null
    || message.release_id !== artifacts.releaseId
    || message.generation !== artifacts.generation
    || !(message.envelope_bytes instanceof ArrayBuffer)
    || !(message.template_bytes instanceof ArrayBuffer)
    || message.envelope_bytes.byteLength === 0
    || message.envelope_bytes.byteLength > 268_435_456
    || message.template_bytes.byteLength === 0
    || message.template_bytes.byteLength > MAXIMUM_BROWSER_EFFECT_BYTES_V1
    || (await sha256(artifacts.contentBytes)) !== artifacts.contentSha256
  ) {
    if (artifacts != null) {
      zeroizeProductionArtifacts(artifacts);
    }
    throw new Error("production save restore request is invalid");
  }
  const envelope = new Uint8Array(message.envelope_bytes);
  const template = new Uint8Array(message.template_bytes);
  try {
    const module = await loadRustWasmModuleFromVerifiedBytesV1({
      glueBytes: artifacts.glueBytes,
      glueSha256: artifacts.glueSha256,
      wasmBytes: artifacts.wasmBytes,
      wasmSha256: artifacts.wasmSha256,
    });
    const output = module.restore_production_save_v2(artifacts.contentBytes, envelope, template);
    if (output.byteLength === 0 || output.byteLength > 268_435_456) {
      output.fill(0);
      throw new Error("Rust production save restore returned invalid bytes");
    }
    const transferable = Uint8Array.from(output);
    output.fill(0);
    workerObjectPort.postMessage(
      {
        kind: "RESTORED_PRODUCTION_SAVE_V2",
        release_id: message.release_id,
        generation: message.generation,
        bytes: transferable.buffer,
      },
      [transferable.buffer],
    );
    disposed = true;
  } finally {
    envelope.fill(0);
    template.fill(0);
    zeroizeProductionArtifacts(artifacts);
  }
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const production = event.data as Partial<AttachProductionArtifactsV1> | null;
  if (production?.kind === "ATTACH_PRODUCTION_ARTIFACTS_V1") {
    if (
      productionArtifacts != null
      || generationPort != null
      || host != null
      || pending !== 0
      || typeof production.release_id !== "string"
      || production.release_id.length === 0
      || !Number.isSafeInteger(production.generation)
      || (production.generation ?? -1) < 0
      || !/^[0-9a-f]{64}$/u.test(production.glue_sha256 ?? "")
      || !/^[0-9a-f]{64}$/u.test(production.wasm_sha256 ?? "")
      || !/^[0-9a-f]{64}$/u.test(production.content_sha256 ?? "")
      || !(production.glue_bytes instanceof ArrayBuffer)
      || !(production.wasm_bytes instanceof ArrayBuffer)
      || !(production.content_bytes instanceof ArrayBuffer)
      || production.glue_bytes.byteLength === 0
      || production.glue_bytes.byteLength > MAXIMUM_BROWSER_EFFECT_BYTES_V1
      || production.wasm_bytes.byteLength === 0
      || production.wasm_bytes.byteLength > 33_554_432
      || production.content_bytes.byteLength === 0
      || production.content_bytes.byteLength > MAXIMUM_BROWSER_EFFECT_BYTES_V1
    ) {
      postProtocolFault("INVALID_PRODUCTION_ARTIFACTS", "production artifact attachment is invalid");
      return;
    }
    productionArtifacts = {
      releaseId: production.release_id ?? "",
      generation: production.generation ?? 0,
      glueSha256: production.glue_sha256 ?? "",
      wasmSha256: production.wasm_sha256 ?? "",
      contentSha256: production.content_sha256 ?? "",
      glueBytes: new Uint8Array(production.glue_bytes),
      wasmBytes: new Uint8Array(production.wasm_bytes),
      contentBytes: new Uint8Array(production.content_bytes),
    };
    return;
  }
  const restore = event.data as Partial<RestoreProductionSaveV2> | null;
  if (restore?.kind === "RESTORE_PRODUCTION_SAVE_V2") {
    queue = queue
      .then(() => processProductionSaveRestoreV2(restore as RestoreProductionSaveV2))
      .catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        workerObjectPort.postMessage({
          kind: "PRODUCTION_SAVE_RESTORE_FAULT",
          message: message.slice(0, 512),
        });
        disposed = true;
      });
    return;
  }
  const candidate = event.data as Partial<AttachGenerationPortV1> | null;
  if (candidate?.kind === "ATTACH_PORT_V1") {
    if (
      generationPort != null
      || host != null
      || pending !== 0
      || !Number.isSafeInteger(candidate.generation)
      || (productionArtifacts != null && candidate.generation !== productionArtifacts.generation)
      || (candidate.generation ?? -1) < 0
      || !(candidate.port instanceof MessagePort)
    ) {
      postProtocolFault("INVALID_GENERATION_PORT", "generation port attachment is stale or invalid");
      return;
    }
    generationPort = candidate.port;
    transferPort = generationPort;
    generationPort.onmessage = acceptProtocolMessage;
    generationPort.start();
    return;
  }
  if (generationPort != null) {
    postProtocolFault("GENERATION_PORT_REQUIRED", "global worker channel is fenced after generation attachment");
    return;
  }
  acceptProtocolMessage(event);
};
