export interface RustWasmModuleV1 {
  BrowserKernelHostV1: new () => unknown;
}

export async function loadRustWasmModule(url: URL, expectedSha256: string): Promise<WebAssembly.Module> {
  if (!/^[0-9a-f]{64}$/u.test(expectedSha256)) {
    throw new Error("invalid Wasm release digest");
  }
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`Wasm fetch failed: ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const actual = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expectedSha256) {
    throw new Error("Wasm release digest mismatch");
  }
  return WebAssembly.compile(bytes);
}
