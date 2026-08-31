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
