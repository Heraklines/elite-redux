import { M9_PREVIEW_WORKER_ORIGIN_V1 } from "./preview-account";

const AUTHORIZATION = /^[A-Za-z0-9._~-]{32,512}$/u;
const IDENTIFIER = /^[a-zA-Z0-9._:-]{1,128}$/u;
const TOKEN = /^[A-Za-z0-9_-]{16,512}$/u;

export interface PreviewRemoteLeaseV1 {
  schema_version: 1;
  slot: string;
  holder: string;
  generation: number;
  expires_at: number;
  lease_token: string;
}

export interface PreviewRemoteLeaseCoordinatorV1 {
  acquire(slot: string, holder: string, durationMs?: number): Promise<PreviewRemoteLeaseV1>;
  release(lease: PreviewRemoteLeaseV1): Promise<void>;
  dispose(): void;
}

export class PreviewRemoteLeaseClientV1 implements PreviewRemoteLeaseCoordinatorV1 {
  readonly #authorization: string;
  readonly #controller = new AbortController();
  #disposed = false;

  constructor(authorization: string) {
    if (!AUTHORIZATION.test(authorization)) {
      throw new Error("Rust preview remote lease authorization is invalid");
    }
    this.#authorization = authorization;
  }

  async acquire(slot: string, holder: string, durationMs = 10_000): Promise<PreviewRemoteLeaseV1> {
    this.#assertOpen();
    if (
      !/^rust-slot-[0-4]$/u.test(slot)
      || !IDENTIFIER.test(holder)
      || !Number.isSafeInteger(durationMs)
      || durationMs < 1
      || durationMs > 30_000
    ) {
      throw new Error("Rust preview remote lease request is invalid");
    }
    const response = await fetch(`${M9_PREVIEW_WORKER_ORIGIN_V1}/api/m9/lease`, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: {
        authorization: `Bearer ${this.#authorization}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ schema_version: 1, slot, holder, duration_ms: durationMs }),
      signal: this.#controller.signal,
    });
    if (!response.ok || response.redirected) {
      throw new Error(`Rust preview remote lease acquisition failed: ${response.status}`);
    }
    const value: unknown = await response.json();
    if (
      value == null
      || typeof value !== "object"
      || Array.isArray(value)
      || !("schema_version" in value)
      || value.schema_version !== 1
      || !("slot" in value)
      || value.slot !== slot
      || !("holder" in value)
      || value.holder !== holder
      || !("generation" in value)
      || !Number.isSafeInteger(value.generation)
      || Number(value.generation) < 1
      || !("expires_at" in value)
      || !Number.isSafeInteger(value.expires_at)
      || Number(value.expires_at) <= Date.now()
      || !("lease_token" in value)
      || typeof value.lease_token !== "string"
      || !TOKEN.test(value.lease_token)
    ) {
      throw new Error("Rust preview remote lease response is invalid");
    }
    return value as PreviewRemoteLeaseV1;
  }

  async release(lease: PreviewRemoteLeaseV1): Promise<void> {
    this.#assertOpen();
    if (!/^rust-slot-[0-4]$/u.test(lease.slot) || !IDENTIFIER.test(lease.holder) || !TOKEN.test(lease.lease_token)) {
      throw new Error("Rust preview remote lease release is invalid");
    }
    const response = await fetch(`${M9_PREVIEW_WORKER_ORIGIN_V1}/api/m9/lease`, {
      method: "DELETE",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: {
        authorization: `Bearer ${this.#authorization}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ schema_version: 1, slot: lease.slot, lease_token: lease.lease_token }),
      signal: this.#controller.signal,
    });
    if (response.status !== 204 || response.redirected) {
      throw new Error(`Rust preview remote lease release failed: ${response.status}`);
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#controller.abort("Rust preview remote lease client disposed");
  }

  #assertOpen(): void {
    if (this.#disposed) {
      throw new Error("Rust preview remote lease client is disposed");
    }
  }
}
