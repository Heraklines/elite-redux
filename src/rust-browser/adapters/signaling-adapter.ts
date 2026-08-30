import { isUnknownRecord } from "../production/type-guards";

export interface BrowserKernelCompatibilityV1 {
  browser_worker_protocol: 1;
  frame_envelope_version: 1;
  authority_protocol: string;
  release_id: string;
  compatible_releases: string[];
  mechanical_identity: string;
  content_hash: string;
  material_schema: number;
  save_schema: number;
  browser_kernel_abi: number;
  active_model_identity: string;
  authority_runtime: "RUST";
}

export interface AuthenticatedSignalingTicketV1 {
  ticket: string;
  expires_at_ms: number;
  signaling_origin: string;
}

const MAXIMUM_TICKET_BYTES = 16_384;

export function encodeCompatibilityHandshake(identity: BrowserKernelCompatibilityV1): Uint8Array {
  validateCompatibility(identity);
  return new TextEncoder().encode(
    JSON.stringify(Object.fromEntries(Object.entries(identity).sort(([left], [right]) => left.localeCompare(right)))),
  );
}

export function assertCompatibleRustPeer(
  local: BrowserKernelCompatibilityV1,
  remoteBytes: Uint8Array,
): BrowserKernelCompatibilityV1 {
  validateCompatibility(local);
  if (remoteBytes.byteLength === 0 || remoteBytes.byteLength > MAXIMUM_TICKET_BYTES) {
    throw new Error("peer compatibility handshake is empty or oversized");
  }
  const remote: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(remoteBytes));
  if (isUnknownRecord(remote) && "authority_runtime" in remote && remote.authority_runtime !== "RUST") {
    throw new Error("mixed TypeScript/Rust authority peers are forbidden");
  }
  if (!isBrowserKernelCompatibility(remote)) {
    throw new Error("peer compatibility handshake is malformed");
  }
  for (const key of [
    "browser_worker_protocol",
    "frame_envelope_version",
    "authority_protocol",
    "mechanical_identity",
    "content_hash",
    "material_schema",
    "save_schema",
    "browser_kernel_abi",
    "active_model_identity",
    "authority_runtime",
  ] as const) {
    if (remote[key] !== local[key]) {
      throw new Error(`Rust peer compatibility mismatch at ${key}`);
    }
  }
  if (
    remote.release_id !== local.release_id
    && (!remote.compatible_releases.includes(local.release_id)
      || !local.compatible_releases.includes(remote.release_id))
  ) {
    throw new Error("Rust peer releases have no signed compatibility relation");
  }
  return remote;
}

function validateCompatibility(identity: BrowserKernelCompatibilityV1): void {
  if (
    identity.authority_runtime !== "RUST"
    || identity.browser_worker_protocol !== 1
    || identity.frame_envelope_version !== 1
    || identity.authority_protocol.length === 0
    || identity.release_id.length === 0
    || identity.compatible_releases.length > 16
    || identity.compatible_releases.some(release => release.length === 0 || release.length > 128)
    || identity.mechanical_identity.length === 0
    || identity.content_hash.length === 0
    || !Number.isSafeInteger(identity.material_schema)
    || !Number.isSafeInteger(identity.save_schema)
    || !Number.isSafeInteger(identity.browser_kernel_abi)
    || identity.active_model_identity.length === 0
  ) {
    throw new Error("browser Rust compatibility identity is invalid");
  }
}

function isBrowserKernelCompatibility(value: unknown): value is BrowserKernelCompatibilityV1 {
  if (!isUnknownRecord(value) || !Array.isArray(value.compatible_releases)) {
    return false;
  }
  return (
    value.authority_runtime === "RUST"
    && value.browser_worker_protocol === 1
    && value.frame_envelope_version === 1
    && typeof value.authority_protocol === "string"
    && typeof value.release_id === "string"
    && value.compatible_releases.every(release => typeof release === "string")
    && typeof value.mechanical_identity === "string"
    && typeof value.content_hash === "string"
    && typeof value.material_schema === "number"
    && typeof value.save_schema === "number"
    && typeof value.browser_kernel_abi === "number"
    && typeof value.active_model_identity === "string"
  );
}

export async function fetchAuthenticatedSignalingTicket(
  endpoint: URL,
  allowedOrigin: string,
  signal?: AbortSignal,
): Promise<AuthenticatedSignalingTicketV1> {
  if (endpoint.origin !== allowedOrigin || endpoint.pathname.includes("/coop/") || !endpoint.pathname.includes("p33")) {
    throw new Error("only the authenticated P33 signaling route is allowed");
  }
  const request: RequestInit = {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: "{}",
  };
  if (signal != null) {
    request.signal = signal;
  }
  const response = await fetch(endpoint, request);
  if (!response.ok) {
    throw new Error(`authenticated signaling ticket failed: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_TICKET_BYTES) {
    throw new Error("authenticated signaling ticket is empty or oversized");
  }
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as Partial<AuthenticatedSignalingTicketV1>;
  if (
    typeof value.ticket !== "string"
    || value.ticket.length === 0
    || value.ticket.length > 8_192
    || !Number.isSafeInteger(value.expires_at_ms)
    || (value.expires_at_ms ?? 0) <= Date.now()
    || value.signaling_origin !== allowedOrigin
  ) {
    throw new Error("authenticated signaling ticket payload is invalid");
  }
  return value as AuthenticatedSignalingTicketV1;
}
