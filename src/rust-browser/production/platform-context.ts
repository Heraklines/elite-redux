import { type PlatformApiVersionSetV1, RUST_PREVIEW_SAVE_NAMESPACE_V1 } from "./contracts";
import {
  M9_PREVIEW_SESSION_COOKIE_V1,
  M9_PREVIEW_WORKER_ORIGIN_V1,
  PreviewAuthorizationRequiredV1,
} from "./preview-account";
import { isUnknownRecord } from "./type-guards";

const AUTHORIZATION = /^[A-Za-z0-9._~-]{32,512}$/u;
const IDENTIFIER = /^[a-zA-Z0-9._:-]{1,128}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const CONTEXT_KEYS: Readonly<Record<string, true>> = {
  schema_version: true,
  pseudonymous_account_id: true,
  entitlements_digest: true,
  server_api_versions: true,
  default_save_slot: true,
  rust_save_namespace: true,
  telemetry_event_url: true,
  preview_only: true,
  imports: true,
  preview_database_identity_hash: true,
};

export interface AuthenticatedPlatformContextV1 {
  schema_version: 1;
  pseudonymous_account_id: string;
  entitlements_digest: string;
  server_api_versions: PlatformApiVersionSetV1;
  default_save_slot: string;
  telemetry_event_url: string;
  rust_save_namespace: typeof RUST_PREVIEW_SAVE_NAMESPACE_V1;
  preview_only: true;
  imports: {
    legacy_save: false;
    legacy_achievements: false;
    legacy_unlocks: false;
    legacy_profile: false;
  };
  preview_database_identity_hash: string;
}

export function readProductionAccountAuthorizationV1(
  cookieHeader = document.cookie,
  cookieName = M9_PREVIEW_SESSION_COOKIE_V1,
): string {
  const prefix = `${cookieName}=`;
  const matches = cookieHeader
    .split(";")
    .map(value => value.trim())
    .filter(value => value.startsWith(prefix));
  if (matches.length === 0) {
    throw new PreviewAuthorizationRequiredV1();
  }
  if (matches.length !== 1) {
    throw new Error("Rust preview account session is ambiguous");
  }
  const authorization = matches[0].slice(prefix.length);
  if (!AUTHORIZATION.test(authorization)) {
    throw new Error("Rust preview account session has an invalid shape");
  }
  return authorization;
}

export async function loadAuthenticatedPlatformContextV1(
  authorization: string,
): Promise<AuthenticatedPlatformContextV1> {
  if (!AUTHORIZATION.test(authorization)) {
    throw new Error("Rust preview account authorization is invalid");
  }
  const response = await fetch(`${M9_PREVIEW_WORKER_ORIGIN_V1}/api/m9/platform-context`, {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${authorization}`,
    },
  });
  if (!response.ok || response.redirected || Number(response.headers.get("content-length") ?? 0) > 65_536) {
    throw new Error("authenticated Rust preview platform context is unavailable");
  }
  const value: unknown = await response.json();
  if (!isAuthenticatedPlatformContext(value)) {
    throw new Error("authenticated Rust preview platform context is invalid");
  }
  return value;
}

function isAuthenticatedPlatformContext(value: unknown): value is AuthenticatedPlatformContextV1 {
  if (
    !isUnknownRecord(value)
    || Object.keys(value).some(key => CONTEXT_KEYS[key] !== true)
    || value.schema_version !== 1
    || typeof value.pseudonymous_account_id !== "string"
    || !value.pseudonymous_account_id.startsWith("rust-preview:")
    || !IDENTIFIER.test(value.pseudonymous_account_id)
    || typeof value.default_save_slot !== "string"
    || !IDENTIFIER.test(value.default_save_slot)
    || typeof value.entitlements_digest !== "string"
    || !SHA256.test(value.entitlements_digest)
    || typeof value.telemetry_event_url !== "string"
    || !isSecureTelemetryUrl(value.telemetry_event_url)
    || value.rust_save_namespace !== RUST_PREVIEW_SAVE_NAMESPACE_V1
    || value.preview_only !== true
    || typeof value.preview_database_identity_hash !== "string"
    || !SHA256.test(value.preview_database_identity_hash)
    || !validDisabledImports(value.imports)
  ) {
    return false;
  }
  return isPlatformApiVersions(value.server_api_versions);
}

function validDisabledImports(value: unknown): boolean {
  return (
    isUnknownRecord(value)
    && Object.keys(value).length === 4
    && value.legacy_save === false
    && value.legacy_achievements === false
    && value.legacy_unlocks === false
    && value.legacy_profile === false
  );
}

function isSecureTelemetryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:"
      && url.username.length === 0
      && url.password.length === 0
      && url.search.length === 0
      && url.hash.length === 0
      && url.origin === M9_PREVIEW_WORKER_ORIGIN_V1
      && url.pathname === "/api/m9/health/event"
    );
  } catch {
    return false;
  }
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
