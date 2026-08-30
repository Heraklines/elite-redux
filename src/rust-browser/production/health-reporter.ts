import { type ProductionHealthEventV1, validateProductionHealthEventV1 } from "./health-event";

export async function sendProductionHealthEventV1(options: {
  endpoint: URL;
  allowedOrigin: string;
  idempotencyKey: string;
  event: ProductionHealthEventV1;
  authorization: string;
  signal?: AbortSignal;
}): Promise<void> {
  if (
    options.endpoint.protocol !== "https:"
    || options.endpoint.origin !== options.allowedOrigin
    || options.endpoint.username.length > 0
    || options.endpoint.password.length > 0
    || options.endpoint.search.length > 0
    || options.endpoint.hash.length > 0
    || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(options.idempotencyKey)
    || options.authorization.length === 0
    || options.authorization.length > 8_192
  ) {
    throw new Error("production health endpoint or delivery identity is invalid");
  }
  const body = JSON.stringify(validateProductionHealthEventV1(options.event));
  if (new TextEncoder().encode(body).byteLength > 16_384) {
    throw new Error("production health event is oversized");
  }
  const request: RequestInit = {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    headers: {
      authorization: `Bearer ${options.authorization}`,
      "content-type": "application/json",
      "x-er-health-idempotency-key": options.idempotencyKey,
    },
    body,
  };
  if (options.signal != null) {
    request.signal = options.signal;
  }
  const response = await fetch(options.endpoint, request);
  if (!response.ok || response.redirected) {
    throw new Error(`production health event delivery failed: ${response.status}`);
  }
}
