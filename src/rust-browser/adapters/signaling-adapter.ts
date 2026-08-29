export interface BrowserKernelCompatibilityV1 {
  browser_worker_protocol: 1;
  authority_protocol: string;
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
  for (const [key, value] of Object.entries(identity)) {
    if ((typeof value === "string" && (value.length === 0 || value.length > 512)) || value == null) {
      throw new Error(`browser compatibility field ${key} is invalid`);
    }
  }
  return new TextEncoder().encode(
    JSON.stringify(Object.fromEntries(Object.entries(identity).sort(([left], [right]) => left.localeCompare(right)))),
  );
}

export function assertCompatibleRustPeer(
  local: BrowserKernelCompatibilityV1,
  remoteBytes: Uint8Array,
): BrowserKernelCompatibilityV1 {
  if (remoteBytes.byteLength === 0 || remoteBytes.byteLength > MAXIMUM_TICKET_BYTES) {
    throw new Error("peer compatibility handshake is empty or oversized");
  }
  const remote = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(remoteBytes),
  ) as Partial<BrowserKernelCompatibilityV1>;
  if (remote.authority_runtime !== "RUST") {
    throw new Error("mixed TypeScript/Rust authority peers are forbidden");
  }
  for (const key of Object.keys(local) as Array<keyof BrowserKernelCompatibilityV1>) {
    if (remote[key] !== local[key]) {
      throw new Error(`Rust peer compatibility mismatch at ${key}`);
    }
  }
  return remote as BrowserKernelCompatibilityV1;
}

export async function fetchAuthenticatedSignalingTicket(
  endpoint: URL,
  allowedOrigin: string,
  signal?: AbortSignal,
): Promise<AuthenticatedSignalingTicketV1> {
  if (endpoint.origin !== allowedOrigin || endpoint.pathname.includes("/coop/") || !endpoint.pathname.includes("p33")) {
    throw new Error("only the authenticated P33 signaling route is allowed");
  }
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal,
  });
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
