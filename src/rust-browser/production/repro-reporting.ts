export type ProductionReproAuthorizationV1 =
  | { kind: "EXPLICIT_USER_CONSENT"; consent_id: string }
  | { kind: "INTERNAL_DIAGNOSTIC_COHORT"; policy_id: string };

export async function uploadAuthorizedProductionReproV1(options: {
  endpoint: URL;
  allowedOrigin: string;
  releaseId: string;
  generation: number;
  failureFingerprint: string;
  capsuleBytes: Uint8Array;
  authorization: ProductionReproAuthorizationV1;
  signal?: AbortSignal;
}): Promise<void> {
  const authorization = authorizationId(options.authorization);
  if (
    options.endpoint.protocol !== "https:"
    || options.endpoint.origin !== options.allowedOrigin
    || options.endpoint.username.length > 0
    || options.endpoint.password.length > 0
    || options.endpoint.search.length > 0
    || options.endpoint.hash.length > 0
    || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(options.releaseId)
    || !Number.isSafeInteger(options.generation)
    || options.generation < 1
    || !/^[0-9a-f]{64}$/u.test(options.failureFingerprint)
    || options.capsuleBytes.byteLength === 0
    || options.capsuleBytes.byteLength > 8_388_608
    || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(authorization)
  ) {
    throw new Error("production repro upload is unauthorized or oversized");
  }
  const capsuleHash = await sha256Hex(options.capsuleBytes);
  const request: RequestInit = {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    redirect: "error",
    headers: {
      "content-type": "application/octet-stream",
      "x-er-release-id": options.releaseId,
      "x-er-kernel-generation": String(options.generation),
      "x-er-failure-fingerprint": options.failureFingerprint,
      "x-er-repro-authorization": options.authorization.kind,
      "x-er-repro-authorization-id": authorization,
      "x-er-repro-capsule-sha256": capsuleHash,
    },
    body: Uint8Array.from(options.capsuleBytes).buffer,
  };
  if (options.signal != null) {
    request.signal = options.signal;
  }
  const response = await fetch(options.endpoint, request);
  if (!response.ok || response.redirected) {
    throw new Error(`authorized production repro upload failed: ${response.status}`);
  }
}

function authorizationId(value: ProductionReproAuthorizationV1): string {
  return value.kind === "EXPLICIT_USER_CONSENT" ? value.consent_id : value.policy_id;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
