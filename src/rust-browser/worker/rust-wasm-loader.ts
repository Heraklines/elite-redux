export interface RustWasmHostV1 {
  dispatch_batch(requestBytes: Uint8Array): Uint8Array;
  snapshot(): Uint8Array;
  export_repro(): Uint8Array;
  dispose(): void;
  free?(): void;
}

export interface RustWasmModuleV1 {
  default(input: { module_or_path: WebAssembly.Module }): Promise<unknown>;
  BrowserKernelHostV1: {
    create(contentBytes: Uint8Array, initBytes: Uint8Array): RustWasmHostV1;
  };
}

const MAXIMUM_WASM_BYTES = 33_554_432;

export async function loadRustWasmModule(url: URL, expectedSha256: string): Promise<RustWasmModuleV1> {
  if (!/^[0-9a-f]{64}$/u.test(expectedSha256)) {
    throw new Error("invalid Wasm release digest");
  }
  if (!url.pathname.endsWith(".wasm") || url.origin !== globalThis.location.origin) {
    throw new Error("Wasm URL must be a same-origin .wasm asset");
  }
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`Wasm fetch failed: ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAXIMUM_WASM_BYTES) {
    throw new Error("Wasm release asset is oversized");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_WASM_BYTES) {
    throw new Error("Wasm release asset is empty or oversized");
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const actual = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expectedSha256) {
    throw new Error("Wasm release digest mismatch");
  }
  const module = await WebAssembly.compile(bytes);
  const glueUrl = new URL(url.href.replace(/\.wasm$/u, ".js"));
  // Release-manifest selection determines the same-origin glue URL at runtime.
  const glue: unknown = await import(/* @vite-ignore */ glueUrl.href);
  if (
    typeof glue !== "object"
    || glue == null
    || typeof (glue as Partial<RustWasmModuleV1>).default !== "function"
    || typeof (glue as Partial<RustWasmModuleV1>).BrowserKernelHostV1?.create !== "function"
  ) {
    throw new Error("Wasm glue does not expose the frozen browser ABI");
  }
  const typed = glue as RustWasmModuleV1;
  await typed.default({ module_or_path: module });
  return typed;
}
