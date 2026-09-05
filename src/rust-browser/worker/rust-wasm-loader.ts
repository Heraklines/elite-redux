export interface RustWasmHostV1 {
  dispatch_batch(requestBytes: Uint8Array): Uint8Array;
  snapshot(): Uint8Array;
  export_repro(): Uint8Array;
  dispose(): void;
  free?(): void;
}

export interface RustWasmModuleV1 {
  default(input: { module_or_path: WebAssembly.Module | Uint8Array<ArrayBuffer> }): Promise<unknown>;
  BrowserKernelHostV1: {
    create(contentBytes: Uint8Array, initBytes: Uint8Array): RustWasmHostV1;
  };
  restore_production_save_v2(
    contentBytes: Uint8Array,
    envelopeBytes: Uint8Array,
    templateBytes: Uint8Array,
  ): Uint8Array;
}

const MAXIMUM_WASM_BYTES = 33_554_432;
const MAXIMUM_GLUE_BYTES = 4_194_304;
const SHA256 = /^[0-9a-f]{64}$/u;

export async function loadRustWasmModule(url: URL, expectedSha256: string): Promise<RustWasmModuleV1> {
  if (!SHA256.test(expectedSha256)) {
    throw new Error("invalid Wasm release digest");
  }
  if (!url.pathname.endsWith(".wasm") || url.origin !== globalThis.location.origin) {
    throw new Error("Wasm URL must be a same-origin .wasm asset");
  }
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", redirect: "error" });
  if (!response.ok) {
    throw new Error(`Wasm fetch failed: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_WASM_BYTES || (await sha256(bytes)) !== expectedSha256) {
    bytes.fill(0);
    throw new Error("Wasm release asset is empty, oversized, or mismatched");
  }
  const glueUrl = new URL(url.href.replace(/\.wasm$/u, ".js"));
  const glue = await import(/* @vite-ignore */ glueUrl.href);
  const typed = validateModule(glue);
  try {
    const compiled = await WebAssembly.compile(bytes);
    await typed.default({ module_or_path: compiled });
  } finally {
    bytes.fill(0);
  }
  return typed;
}

export async function loadRustWasmModuleFromVerifiedBytesV1(options: {
  glueBytes: Uint8Array;
  glueSha256: string;
  wasmBytes: Uint8Array;
  wasmSha256: string;
  onCompiled?: () => void;
  onInstantiated?: () => void;
}): Promise<RustWasmModuleV1> {
  if (
    !SHA256.test(options.glueSha256)
    || !SHA256.test(options.wasmSha256)
    || options.glueBytes.byteLength === 0
    || options.glueBytes.byteLength > MAXIMUM_GLUE_BYTES
    || options.wasmBytes.byteLength === 0
    || options.wasmBytes.byteLength > MAXIMUM_WASM_BYTES
    || (await sha256(options.glueBytes)) !== options.glueSha256
    || (await sha256(options.wasmBytes)) !== options.wasmSha256
  ) {
    throw new Error("verified Wasm/glue cohort is invalid");
  }
  const glueCopy = Uint8Array.from(options.glueBytes);
  const wasmCopy = Uint8Array.from(options.wasmBytes);
  const glueUrl = URL.createObjectURL(new Blob([glueCopy], { type: "text/javascript" }));
  try {
    const glue = await import(/* @vite-ignore */ glueUrl);
    const typed = validateModule(glue);
    const compiled = await WebAssembly.compile(wasmCopy);
    options.onCompiled?.();
    await typed.default({ module_or_path: compiled });
    options.onInstantiated?.();
    return typed;
  } finally {
    URL.revokeObjectURL(glueUrl);
    glueCopy.fill(0);
    wasmCopy.fill(0);
  }
}

function validateModule(value: unknown): RustWasmModuleV1 {
  if (
    typeof value !== "object"
    || value == null
    || typeof (value as Partial<RustWasmModuleV1>).default !== "function"
    || typeof (value as Partial<RustWasmModuleV1>).BrowserKernelHostV1?.create !== "function"
    || typeof (value as Partial<RustWasmModuleV1>).restore_production_save_v2 !== "function"
  ) {
    throw new Error("Wasm glue does not expose the frozen browser ABI");
  }
  return value as RustWasmModuleV1;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

export interface RustWasmHostV2 {
  process(requestBytes: Uint8Array): Uint8Array;
  free(): void;
}

export interface RustWasmModuleV2 {
  default(input: { module_or_path: WebAssembly.Module }): Promise<unknown>;
  BrowserKernelHostV2: new (contentBytes: Uint8Array) => RustWasmHostV2;
}

export interface CurrentWorkerAssetsV2 {
  wasm_url: string;
  wasm_sha256: string;
  glue_url: string;
  glue_sha256: string;
  content_url: string;
  content_sha256: string;
}

/** Explicit development ABI2 loader; V1 rollout and validation above are unchanged. */
export async function fetchCurrentVerifiedAssetV2(
  location: string,
  expectedSha256: string,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const url = new URL(location, globalThis.location.href);
  if (url.origin !== globalThis.location.origin || !SHA256.test(expectedSha256)) {
    throw new Error("current Worker asset must have a same-origin SHA-256 identity");
  }
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", redirect: "error", signal });
  if (!response.ok || response.body == null) {
    throw new Error(`current Worker asset fetch failed: ${response.status}`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (part.value.byteLength > maximumBytes - length) {
        part.value.fill(0);
        await reader.cancel();
        throw new Error("current Worker asset exceeds its byte bound");
      }
      length += part.value.byteLength;
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (length === 0 || (await sha256(bytes)) !== expectedSha256) {
      bytes.fill(0);
      throw new Error("current Worker asset is empty or has a mismatched SHA-256");
    }
    return bytes;
  } finally {
    reader.releaseLock();
    for (const chunk of chunks) chunk.fill(0);
  }
}

export async function loadCurrentRustWasmModuleV2(
  assets: CurrentWorkerAssetsV2,
  signal: AbortSignal,
): Promise<RustWasmModuleV2> {
  const wasmUrl = new URL(assets.wasm_url, globalThis.location.href);
  const glueUrl = new URL(assets.glue_url, globalThis.location.href);
  if (!wasmUrl.pathname.endsWith(".wasm") || !glueUrl.pathname.endsWith(".js")) {
    throw new Error("current Worker requires explicit Wasm and JavaScript assets");
  }
  const wasm = await fetchCurrentVerifiedAssetV2(assets.wasm_url, assets.wasm_sha256, MAXIMUM_WASM_BYTES, signal);
  let glue: Uint8Array<ArrayBuffer> | null = null;
  let objectUrl: string | null = null;
  try {
    glue = await fetchCurrentVerifiedAssetV2(assets.glue_url, assets.glue_sha256, MAXIMUM_GLUE_BYTES, signal);
    objectUrl = URL.createObjectURL(new Blob([glue], { type: "text/javascript" }));
    const loaded: unknown = await import(/* @vite-ignore */ objectUrl);
    const module = loaded as Partial<RustWasmModuleV2> | null;
    if (typeof module?.default !== "function" || typeof module.BrowserKernelHostV2 !== "function"
      || typeof module.BrowserKernelHostV2.prototype.process !== "function") {
      throw new Error("Wasm glue does not expose the current browser ABI2");
    }
    await module.default({ module_or_path: await WebAssembly.compile(wasm) });
    return module as RustWasmModuleV2;
  } finally {
    if (objectUrl != null) URL.revokeObjectURL(objectUrl);
    glue?.fill(0);
    wasm.fill(0);
  }
}
