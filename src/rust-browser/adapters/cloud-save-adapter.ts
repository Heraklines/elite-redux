const MAXIMUM_CLOUD_SAVE_BYTES = 268_435_456;

export interface CloudSaveValueV1 {
  revision: string;
  bytes: Uint8Array;
  generation?: number;
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
  productionSaveSchema?: number;
  requireProductionIdentity?: boolean;
  authorization?: string;
  saveNamespace?: string;
  kernelGeneration?: number;
  contentIdentity?: string;
  mechanicsSha256?: string;
  activeModelIdentity?: string;
}

export class CloudSaveAdapterV1 {
  readonly #endpoint: URL;
  readonly #allowedOrigin: string;
  readonly #releaseIdentity: string;
  readonly #productionSaveSchema: number;
  readonly #requireProductionIdentity: boolean;
  readonly #authorization: string | null;
  readonly #saveNamespace: string | null;
  readonly #kernelGeneration: number | null;
  readonly #contentIdentity: string | null;
  readonly #mechanicsSha256: string | null;
  readonly #activeModelIdentity: string | null;
  readonly #controller = new AbortController();
  #disposed = false;

  constructor(options: CloudSaveAdapterOptionsV1) {
    const schema = options.productionSaveSchema ?? 1;
    if (
      options.endpoint.origin !== options.allowedOrigin
      || options.releaseIdentity.length === 0
      || !Number.isSafeInteger(schema)
      || schema < 1
      || !validOptionalCloudIdentity(options)
    ) {
      throw new Error("cloud save endpoint, release, or schema identity is invalid");
    }
    this.#endpoint = options.endpoint;
    this.#allowedOrigin = options.allowedOrigin;
    this.#releaseIdentity = options.releaseIdentity;
    this.#productionSaveSchema = schema;
    this.#requireProductionIdentity = options.requireProductionIdentity ?? false;
    this.#authorization = options.authorization ?? null;
    this.#saveNamespace = options.saveNamespace ?? null;
    this.#kernelGeneration = options.kernelGeneration ?? null;
    this.#contentIdentity = options.contentIdentity ?? null;
    this.#mechanicsSha256 = options.mechanicsSha256 ?? null;
    this.#activeModelIdentity = options.activeModelIdentity ?? null;
  }

  async load(slot: string): Promise<CloudSaveValueV1 | null> {
    this.#assertOpen();
    const response = await fetch(this.#slot(slot), {
      credentials: this.#authorization == null ? "include" : "omit",
      cache: "no-store",
      headers: {
        accept: "application/octet-stream",
        ...(this.#authorization == null ? {} : { authorization: `Bearer ${this.#authorization}` }),
        "x-er-release": this.#releaseIdentity,
        "x-er-save-schema": String(this.#productionSaveSchema),
        ...(this.#saveNamespace == null ? {} : { "x-er-save-namespace": this.#saveNamespace }),
      },
      signal: this.#controller.signal,
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`cloud save load failed: ${response.status}`);
    }
    this.#assertProductionIdentity(response, slot);
    return {
      revision: requiredRevision(response),
      bytes: await boundedBytes(response),
      ...(this.#requireProductionIdentity ? { generation: requiredGeneration(response) } : {}),
    };
  }

  async compareAndSwap(slot: string, expectedRevision: string | null, bytes: Uint8Array): Promise<string> {
    this.#assertOpen();
    if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_CLOUD_SAVE_BYTES) {
      throw new Error("cloud save bytes are empty or oversized");
    }
    const response = await fetch(this.#slot(slot), {
      method: "PUT",
      credentials: this.#authorization == null ? "include" : "omit",
      cache: "no-store",
      headers: {
        "content-type": "application/octet-stream",
        "if-match": expectedRevision ?? "*",
        "x-er-release": this.#releaseIdentity,
        "x-er-save-schema": String(this.#productionSaveSchema),
        ...(this.#authorization == null ? {} : { authorization: `Bearer ${this.#authorization}` }),
        ...(this.#saveNamespace == null ? {} : { "x-er-save-namespace": this.#saveNamespace }),
      },
      body: Uint8Array.from(bytes).buffer,
      signal: this.#controller.signal,
    });
    if (response.status === 409 || response.status === 412) {
      throw new CloudSaveConflictV1();
    }
    if (!response.ok) {
      throw new Error(`cloud save write failed: ${response.status}`);
    }
    this.#assertProductionIdentity(response, slot);
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

  #assertProductionIdentity(response: Response, slot: string): void {
    if (!this.#requireProductionIdentity) {
      return;
    }
    if (
      response.headers.get("x-er-release-id") !== this.#releaseIdentity
      || response.headers.get("x-er-save-slot") !== slot
      || response.headers.get("x-er-save-schema") !== String(this.#productionSaveSchema)
      || (this.#saveNamespace != null && response.headers.get("x-er-save-namespace") !== this.#saveNamespace)
      || (this.#kernelGeneration != null
        && response.headers.get("x-er-kernel-generation") !== String(this.#kernelGeneration))
      || (this.#contentIdentity != null && response.headers.get("x-er-content-identity") !== this.#contentIdentity)
      || (this.#mechanicsSha256 != null && response.headers.get("x-er-mechanics-sha256") !== this.#mechanicsSha256)
      || (this.#activeModelIdentity != null
        && response.headers.get("x-er-active-model-identity") !== this.#activeModelIdentity)
    ) {
      throw new Error("cloud save response is cross-release, cross-slot, or wrong mechanical identity");
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

function validOptionalCloudIdentity(options: CloudSaveAdapterOptionsV1): boolean {
  return (
    (options.authorization == null || /^[A-Za-z0-9._~-]{16,8192}$/u.test(options.authorization))
    && (options.saveNamespace == null || /^[A-Z0-9_]{1,64}$/u.test(options.saveNamespace))
    && (options.kernelGeneration == null
      || (Number.isSafeInteger(options.kernelGeneration) && options.kernelGeneration > 0))
    && (options.contentIdentity == null || options.contentIdentity.length > 0)
    && (options.mechanicsSha256 == null || /^[0-9a-f]{64}$/u.test(options.mechanicsSha256))
    && (options.activeModelIdentity == null || /^[a-zA-Z0-9._:-]{1,128}$/u.test(options.activeModelIdentity))
  );
}

function requiredRevision(response: Response): string {
  const revision = response.headers.get("etag");
  if (revision == null || revision.length === 0 || revision.length > 256) {
    throw new Error("cloud save response has no bounded revision");
  }
  return revision;
}

function requiredGeneration(response: Response): number {
  const generation = Number(response.headers.get("x-er-save-generation"));
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("cloud save response has no safe generation");
  }
  return generation;
}
