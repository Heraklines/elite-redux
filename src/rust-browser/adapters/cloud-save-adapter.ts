const MAXIMUM_CLOUD_SAVE_BYTES = 4_194_304;

export interface CloudSaveValueV1 {
  revision: string;
  bytes: Uint8Array;
}

export class CloudSaveConflictV1 extends Error {
  constructor() {
    super("cloud save compare-and-swap conflict");
    this.name = "CloudSaveConflictV1";
  }
}

export interface CloudSaveAdapterOptionsV1 {
  endpoint: URL;
  allowedOrigin: string;
  releaseIdentity: string;
}

export class CloudSaveAdapterV1 {
  readonly #endpoint: URL;
  readonly #allowedOrigin: string;
  readonly #releaseIdentity: string;
  readonly #controller = new AbortController();
  #disposed = false;

  constructor(options: CloudSaveAdapterOptionsV1) {
    if (options.endpoint.origin !== options.allowedOrigin || options.releaseIdentity.length === 0) {
      throw new Error("cloud save endpoint or release identity is invalid");
    }
    this.#endpoint = options.endpoint;
    this.#allowedOrigin = options.allowedOrigin;
    this.#releaseIdentity = options.releaseIdentity;
  }

  async load(slot: string): Promise<CloudSaveValueV1 | null> {
    this.#assertOpen();
    const response = await fetch(this.#slot(slot), {
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/octet-stream", "x-er-release": this.#releaseIdentity },
      signal: this.#controller.signal,
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`cloud save load failed: ${response.status}`);
    }
    return { revision: requiredRevision(response), bytes: await boundedBytes(response) };
  }

  async compareAndSwap(slot: string, expectedRevision: string | null, bytes: Uint8Array): Promise<string> {
    this.#assertOpen();
    if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_CLOUD_SAVE_BYTES) {
      throw new Error("cloud save bytes are empty or oversized");
    }
    const response = await fetch(this.#slot(slot), {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: {
        "content-type": "application/octet-stream",
        "if-match": expectedRevision ?? "*",
        "x-er-release": this.#releaseIdentity,
      },
      body: bytes,
      signal: this.#controller.signal,
    });
    if (response.status === 409 || response.status === 412) {
      throw new CloudSaveConflictV1();
    }
    if (!response.ok) {
      throw new Error(`cloud save write failed: ${response.status}`);
    }
    return requiredRevision(response);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#controller.abort("cloud save adapter disposed");
  }

  #slot(slot: string): URL {
    if (!/^[a-zA-Z0-9._-]{1,128}$/u.test(slot)) {
      throw new Error("cloud save slot is invalid");
    }
    const url = new URL(this.#endpoint);
    if (url.origin !== this.#allowedOrigin) {
      throw new Error("cloud save origin changed");
    }
    url.searchParams.set("slot", slot);
    return url;
  }

  #assertOpen(): void {
    if (this.#disposed) {
      throw new Error("cloud save adapter is disposed");
    }
  }
}

async function boundedBytes(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAXIMUM_CLOUD_SAVE_BYTES) {
    throw new Error("cloud save response is oversized");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_CLOUD_SAVE_BYTES) {
    throw new Error("cloud save response is empty or oversized");
  }
  return bytes;
}

function requiredRevision(response: Response): string {
  const revision = response.headers.get("etag");
  if (revision == null || revision.length === 0 || revision.length > 256) {
    throw new Error("cloud save response has no bounded revision");
  }
  return revision;
}
