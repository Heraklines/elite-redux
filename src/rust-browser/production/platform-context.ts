import type { PlatformApiVersionSetV1 } from "./contracts";
import { isUnknownRecord } from "./type-guards";

export interface AuthenticatedPlatformContextV1 {
  schema_version: 1;
  pseudonymous_account_id: string;
  entitlements_digest: string;
  server_api_versions: PlatformApiVersionSetV1;
  default_save_slot: string;
}

export async function loadAuthenticatedPlatformContextV1(): Promise<AuthenticatedPlatformContextV1> {
  const response = await fetch("/m9/platform-context", {
    cache: "no-store",
    credentials: "include",
    redirect: "error",
    headers: { accept: "application/json" },
  });
  if (!response.ok || response.redirected || Number(response.headers.get("content-length") ?? 0) > 65_536) {
    throw new Error("authenticated production platform context is unavailable");
  }
  const value: unknown = await response.json();
  if (!isAuthenticatedPlatformContext(value)) {
    throw new Error("authenticated production platform context is invalid");
  }
  return value;
}

function isAuthenticatedPlatformContext(value: unknown): value is AuthenticatedPlatformContextV1 {
  if (value == null || typeof value !== "object") {
    return false;
  }
  if (
    !("schema_version" in value)
    || value.schema_version !== 1
    || !("pseudonymous_account_id" in value)
    || typeof value.pseudonymous_account_id !== "string"
    || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(value.pseudonymous_account_id)
    || !("default_save_slot" in value)
    || typeof value.default_save_slot !== "string"
    || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(value.default_save_slot)
    || !("entitlements_digest" in value)
    || typeof value.entitlements_digest !== "string"
    || !/^[0-9a-f]{64}$/u.test(value.entitlements_digest)
    || !("server_api_versions" in value)
  ) {
    return false;
  }
  return isPlatformApiVersions(value.server_api_versions);
}

function isPlatformApiVersions(value: unknown): value is PlatformApiVersionSetV1 {
  if (!isUnknownRecord(value) || value.schema_version !== 1) {
    return false;
  }
  return ["save_api", "telemetry_api", "signaling_api", "showdown_api", "achievement_api"].every(field => {
    const version = value[field];
    return Number.isSafeInteger(version) && Number(version) >= 1;
  });
}
