export const M9_PREVIEW_WORKER_ORIGIN_V1 = "https://er-m9-preview-save.heraklines.workers.dev" as const;
export const M9_RELEASE_OBJECT_ORIGIN_V1 = "https://er-save-api.heraklines.workers.dev" as const;
export const M9_PREVIEW_SESSION_COOKIE_V1 = "er_m9_preview_session" as const;

const AUTHORIZATION = /^[A-Za-z0-9._~-]{32,512}$/u;
const INVITE = /^[A-Za-z0-9._~-]{16,8192}$/u;

export class PreviewAuthorizationRequiredV1 extends Error {
  constructor() {
    super("fresh Rust preview authorization is required");
    this.name = "PreviewAuthorizationRequiredV1";
  }
}

export interface PreviewAccountBootstrapV1 {
  schema_version: 1;
  account_id: string;
  session_token: string;
  imports: {
    legacy_save: false;
    legacy_achievements: false;
    legacy_unlocks: false;
    legacy_profile: false;
  };
}

export async function bootstrapRustPreviewAccountV1(
  invite: string,
  browserInstanceId: string,
): Promise<PreviewAccountBootstrapV1> {
  if (!INVITE.test(invite) || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(browserInstanceId)) {
    throw new Error("Rust preview invite or browser identity is invalid");
  }
  const response = await fetch(`${M9_PREVIEW_WORKER_ORIGIN_V1}/api/m9/preview-account`, {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    headers: {
      authorization: `Bearer ${invite}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ schema_version: 1, browser_instance_id: browserInstanceId }),
  });
  if (
    !response.ok
    || response.redirected
    || response.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  ) {
    throw new Error(`Rust preview account bootstrap failed: ${response.status}`);
  }
  const value: unknown = await response.json();
  if (
    value == null
    || typeof value !== "object"
    || Array.isArray(value)
    || !("schema_version" in value)
    || value.schema_version !== 1
    || !("account_id" in value)
    || typeof value.account_id !== "string"
    || !value.account_id.startsWith("rust-preview:")
    || !("session_token" in value)
    || typeof value.session_token !== "string"
    || !AUTHORIZATION.test(value.session_token)
    || !("imports" in value)
    || value.imports == null
    || typeof value.imports !== "object"
    || Array.isArray(value.imports)
    || !("legacy_save" in value.imports)
    || value.imports.legacy_save !== false
    || !("legacy_achievements" in value.imports)
    || value.imports.legacy_achievements !== false
    || !("legacy_unlocks" in value.imports)
    || value.imports.legacy_unlocks !== false
    || !("legacy_profile" in value.imports)
    || value.imports.legacy_profile !== false
  ) {
    throw new Error("Rust preview account bootstrap response is invalid");
  }
  return value as PreviewAccountBootstrapV1;
}

export function persistRustPreviewAuthorizationV1(token: string, cookieTarget: Document = document): void {
  if (!AUTHORIZATION.test(token)) {
    throw new Error("Rust preview authorization is invalid");
  }
  cookieTarget.cookie = `${M9_PREVIEW_SESSION_COOKIE_V1}=${token}; Path=/; Max-Age=2592000; Secure; SameSite=Strict`;
}
