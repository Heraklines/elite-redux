/// <reference path="../../er-save-api/src/cloudflare-workers.d.ts" />

import { isPreviewRecord } from "./type-guards";

interface PreviewR2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface PreviewR2Bucket {
  get(key: string): Promise<PreviewR2Object | null>;
}

interface Env {
  RUST_PREVIEW_DB: D1Database;
  M9_RELEASES: PreviewR2Bucket;
  M9_RELEASE_SIGNING_PRIVATE_KEY: string;
  M9_PREVIEW_INVITE_SECRET: string;
  M9_PREVIEW_HEALTH_SECRET: string;
  M9_PREVIEW_ONLY_WORKER: string;
  M9_LEGACY_MIGRATION_ENABLED: string;
  M9_PREVIEW_DATABASE_IDENTITY_HASH: string;
  M9_TELEMETRY_URL?: string;
  ALLOWED_ORIGIN?: string;
}

interface PreviewAccountRow {
  account_id: string;
  disabled: number;
}

interface PreviewSaveRow {
  data: string;
  revision: number;
  release_id: string;
  kernel_generation: number;
  content_identity: string;
  active_model_identity: string;
  mechanics_sha256: string;
  save_schema: number;
  payload_sha256: string;
  created_at: number;
  updated_at: number;
}

interface PreviewLeaseRow {
  holder: string;
  lease_hash: string;
  generation: number;
  expires_at: number;
}

interface PreviewReleaseIdentity {
  kernelGeneration: number;
  saveSchema: number;
  authorityProtocol: "er-coop-47";
  contentIdentity: string;
  mechanicsSha256: string;
  activeModelIdentity: string;
}

interface PreviewEnvelopeIdentity {
  kernelGeneration: number;
  contentIdentity: string;
  mechanicsSha256: string;
  activeModelIdentity: string;
  payloadSha256: string;
}

interface SignedEnvelope {
  envelope_version: number;
  key_id: string;
  payload: Record<string, unknown>;
  signature: number[];
}

const PREVIEW_NAMESPACE = "M9_RUST_PREVIEW_V1";
const PREVIEW_ACCOUNT_PREFIX = "rust-preview:";
const PREVIEW_WORKER_MODE = "true";
const MIGRATION_DISABLED = "false";
const MAXIMUM_SAVE_BYTES = 268_435_456;
const MAXIMUM_LEASE_MS = 30_000;
const MINIMUM_SESSION_TOKEN_BYTES = 32;
const PUBLIC_KEY = Uint8Array.from([
  125, 204, 207, 198, 76, 152, 199, 166, 208, 56, 189, 10, 100, 113, 89, 240, 107, 149, 135, 191, 77, 117, 18, 75, 237,
  22, 120, 8, 213, 169, 37, 142,
]);
const PREVIEW_WORKER_ORIGIN = "https://er-m9-preview-save.heraklines.workers.dev";
const EXPECTED_PREVIEW_DATABASE_IDENTITY = "b860cac56eb16855e2a46fc6ba2f458666f06d0ab4e04ca4c83f0e3962afd36e";
const ENVELOPE_KEYS: Readonly<Record<string, true>> = {
  envelope_version: true,
  save_namespace: true,
  slot: true,
  pseudonymous_account_id: true,
  cloud_generation: true,
  origin_runtime: true,
  release_id: true,
  kernel_generation: true,
  mechanical_identity: true,
  authority_protocol: true,
  save_schema: true,
  content_hash: true,
  payload_hash: true,
  payload: true,
  migration: true,
  legacy_backup: true,
};
const releaseCache = new Map<string, PreviewReleaseIdentity>();

// biome-ignore lint/style/noDefaultExport: Cloudflare Workers require the module-worker default export
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(env, origin);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (!validWorkerMode(env)) {
      return json({ error: "Rust preview Worker capability configuration is invalid" }, 503, cors);
    }
    const url = new URL(request.url);
    if (url.pathname === "/api/m9/preview-account" && request.method === "POST") {
      return createPreviewAccount(request, env, cors);
    }
    const account = await authenticatePreviewAccount(request, env);
    if (account == null) {
      return json({ error: "preview authorization required" }, 401, cors);
    }
    if (url.pathname === "/api/m9/platform-context" && request.method === "GET") {
      return platformContext(account, env, cors);
    }
    if (url.pathname === "/api/m9/runtime-assignment" && request.method === "POST") {
      return runtimeAssignment(request, account, env, cors);
    }
    if (url.pathname === "/api/m9/health/event" && request.method === "POST") {
      return forwardHealthEvent(request, account, env, cors);
    }
    if (url.pathname === "/api/m9/lease" && request.method === "POST") {
      return acquireLease(request, account, env, cors);
    }
    if (url.pathname === "/api/m9/lease" && request.method === "DELETE") {
      return releaseLease(request, account, env, cors);
    }
    if (url.pathname === "/api/m9/rust-save" && (request.method === "GET" || request.method === "PUT")) {
      return rustPreviewSave(request, url, account, env, cors);
    }
    return json({ error: "preview route not found" }, 404, cors);
  },
};

function validWorkerMode(env: Env): boolean {
  return (
    env.M9_PREVIEW_ONLY_WORKER === PREVIEW_WORKER_MODE
    && env.M9_LEGACY_MIGRATION_ENABLED === MIGRATION_DISABLED
    && env.M9_PREVIEW_DATABASE_IDENTITY_HASH === EXPECTED_PREVIEW_DATABASE_IDENTITY
    && typeof env.M9_RELEASE_SIGNING_PRIVATE_KEY === "string"
    && env.M9_RELEASE_SIGNING_PRIVATE_KEY.length >= 32
    && typeof env.M9_PREVIEW_INVITE_SECRET === "string"
    && env.M9_PREVIEW_INVITE_SECRET.length >= 16
    && typeof env.M9_PREVIEW_HEALTH_SECRET === "string"
    && env.M9_PREVIEW_HEALTH_SECRET.length >= 32
    && typeof env.RUST_PREVIEW_DB?.prepare === "function"
    && !("DB" in env)
  );
}

async function createPreviewAccount(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const invite = bearer(request);
  if (invite == null || !(await equalSecret(invite, env.M9_PREVIEW_INVITE_SECRET))) {
    return json({ error: "preview invite required" }, 403, cors);
  }
  const body: unknown = await request.json().catch(() => null);
  if (!isPreviewRecord(body) || typeof body.browser_instance_id !== "string" || !identifier(body.browser_instance_id)) {
    return json({ error: "invalid preview account bootstrap" }, 400, cors);
  }
  const accountId = `${PREVIEW_ACCOUNT_PREFIX}${randomHex(16)}`;
  const sessionToken = randomToken(32);
  const tokenHash = await sessionTokenHash(sessionToken);
  const now = Date.now();
  const inserted = await env.RUST_PREVIEW_DB.prepare(
    `INSERT INTO rust_preview_accounts (
       account_id, token_hash, created_at, last_seen_at, disabled
     ) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(account_id) DO NOTHING`,
  )
    .bind(accountId, tokenHash, now, now)
    .run();
  if ((inserted.meta.changes ?? 0) !== 1) {
    return json({ error: "preview account allocation conflict" }, 409, cors);
  }
  return json(
    {
      schema_version: 1,
      account_id: accountId,
      session_token: sessionToken,
      imports: { legacy_save: false, legacy_achievements: false, legacy_unlocks: false, legacy_profile: false },
    },
    201,
    cors,
  );
}

async function authenticatePreviewAccount(request: Request, env: Env): Promise<PreviewAccountRow | null> {
  const token = bearer(request);
  if (token == null || token.length < 32 || token.length > 512) {
    return null;
  }
  const tokenHash = await sessionTokenHash(token);
  const row = await env.RUST_PREVIEW_DB.prepare(
    "SELECT account_id, disabled FROM rust_preview_accounts WHERE token_hash = ?",
  )
    .bind(tokenHash)
    .first<PreviewAccountRow>();
  if (row == null || row.disabled !== 0 || !row.account_id.startsWith(PREVIEW_ACCOUNT_PREFIX)) {
    return null;
  }
  await env.RUST_PREVIEW_DB.prepare(
    "UPDATE rust_preview_accounts SET last_seen_at = ? WHERE account_id = ? AND disabled = 0",
  )
    .bind(Date.now(), row.account_id)
    .run();
  return row;
}

async function platformContext(account: PreviewAccountRow, env: Env, cors: Record<string, string>): Promise<Response> {
  const telemetryEventUrl = env.M9_TELEMETRY_URL ?? "https://er-telemetry.heraklines.workers.dev/m9/health/event";
  if (!secureTelemetryUrl(telemetryEventUrl)) {
    return json({ error: "preview telemetry endpoint invalid" }, 503, cors);
  }
  return json(
    {
      schema_version: 1,
      pseudonymous_account_id: account.account_id,
      entitlements_digest: await sha256(new TextEncoder().encode(`m9-preview-entitlements:${account.account_id}:v1`)),
      server_api_versions: {
        schema_version: 1,
        save_api: 2,
        telemetry_api: 1,
        signaling_api: 33,
        showdown_api: 1,
        achievement_api: 1,
      },
      default_save_slot: "rust-slot-0",
      rust_save_namespace: PREVIEW_NAMESPACE,
      telemetry_event_url: `${PREVIEW_WORKER_ORIGIN}/api/m9/health/event`,
      preview_only: true,
      imports: { legacy_save: false, legacy_achievements: false, legacy_unlocks: false, legacy_profile: false },
      preview_database_identity_hash: env.M9_PREVIEW_DATABASE_IDENTITY_HASH,
    },
    200,
    cors,
  );
}

async function forwardHealthEvent(
  request: Request,
  account: PreviewAccountRow,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const telemetryEventUrl = env.M9_TELEMETRY_URL ?? "https://er-telemetry.heraklines.workers.dev/m9/health/event";
  if (!secureTelemetryUrl(telemetryEventUrl) || env.M9_PREVIEW_HEALTH_SECRET.length < 32) {
    return json({ error: "preview telemetry forwarding is unavailable" }, 503, cors);
  }
  const idempotencyKey = request.headers.get("x-er-health-idempotency-key") ?? "";
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!/^[a-zA-Z0-9._:-]{1,128}$/u.test(idempotencyKey) || bytes.byteLength === 0 || bytes.byteLength > 32_768) {
    return json({ error: "invalid preview health event" }, 400, cors);
  }
  const response = await fetch(telemetryEventUrl, {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      "x-er-health-idempotency-key": idempotencyKey,
      "x-er-preview-health-authorization": `Bearer ${env.M9_PREVIEW_HEALTH_SECRET}`,
      "x-er-preview-account": account.account_id,
    },
    body: bytes,
  });
  return response.status === 204
    ? new Response(null, { status: 204, headers: cors })
    : json({ error: "preview telemetry ingestion failed" }, 502, cors);
}

async function runtimeAssignment(
  request: Request,
  account: PreviewAccountRow,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  if (!isPreviewRecord(body) || typeof body.browser_session_id !== "string" || !identifier(body.browser_session_id)) {
    return json({ error: "invalid preview browser session" }, 400, cors);
  }
  const policyObject = await env.M9_RELEASES.get("policies/current.json");
  if (policyObject == null) {
    return json({ error: "preview rollout policy unavailable" }, 503, cors);
  }
  const policy = await decodeSignedObject(policyObject, "er-m9:rollout-policy-v1");
  if (policy == null) {
    return json({ error: "preview rollout policy invalid" }, 503, cors);
  }
  const activeRing = policy.payload.active_ring;
  if (activeRing !== "R1" && activeRing !== "R2") {
    return json({ error: "preview rollout ring is not authorized" }, 503, cors);
  }
  const now = Date.now();
  if (
    !Number.isSafeInteger(policy.payload.policy_version)
    || Number(policy.payload.policy_version) < 1
    || !Number.isSafeInteger(policy.payload.expires_at)
    || Number(policy.payload.expires_at) <= now
  ) {
    return json({ error: "preview rollout policy identity is invalid" }, 503, cors);
  }
  const releaseId = policy.payload.candidate_release;
  if (typeof releaseId !== "string" || !identifier(releaseId)) {
    return json({ error: "preview candidate release invalid" }, 503, cors);
  }
  if ((await previewReleaseIdentity(env, releaseId)) == null) {
    return json({ error: "preview candidate release unavailable" }, 503, cors);
  }
  const assignment = {
    schema_version: 1,
    assignment_id: `preview-assignment-${String(policy.payload.policy_version)}-${account.account_id}`,
    release_id: releaseId,
    authority: "RUST_CANARY",
    cohort: `${activeRing}_PREVIEW_ONLY`,
    sticky_scope: { kind: "ACCOUNT", value: { pseudonymous_account_id: account.account_id } },
    issued_at: now,
    expires_at: Math.min(Number(policy.payload.expires_at), now + 86_400_000),
    policy_version: Number(policy.payload.policy_version),
  };
  return json(
    await signEnvelope(assignment, "er-m9:runtime-assignment-v1", env.M9_RELEASE_SIGNING_PRIVATE_KEY),
    200,
    cors,
  );
}

async function acquireLease(
  request: Request,
  account: PreviewAccountRow,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  if (
    !isPreviewRecord(body)
    || typeof body.slot !== "string"
    || !validSlot(body.slot)
    || typeof body.holder !== "string"
    || !identifier(body.holder)
    || !Number.isSafeInteger(body.duration_ms)
    || Number(body.duration_ms) < 1
    || Number(body.duration_ms) > MAXIMUM_LEASE_MS
  ) {
    return json({ error: "invalid preview lease request" }, 400, cors);
  }
  const slot = body.slot;
  const holder = body.holder;
  const now = Date.now();
  const expiresAt = now + Number(body.duration_ms);
  const token = randomToken(24);
  const leaseHash = await leaseTokenHash(token);
  const row = await env.RUST_PREVIEW_DB.prepare(
    "SELECT holder, lease_hash, generation, expires_at FROM rust_preview_save_leases WHERE account_id = ? AND slot = ?",
  )
    .bind(account.account_id, slot)
    .first<PreviewLeaseRow>();
  let generation = 1;
  let changes = 0;
  if (row == null) {
    const inserted = await env.RUST_PREVIEW_DB.prepare(
      `INSERT INTO rust_preview_save_leases (
         account_id, slot, holder, lease_hash, generation, expires_at, updated_at
       ) VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(account_id, slot) DO NOTHING`,
    )
      .bind(account.account_id, slot, holder, leaseHash, expiresAt, now)
      .run();
    changes = inserted.meta.changes ?? 0;
  } else {
    if (row.expires_at > now && row.holder !== holder) {
      return json({ error: "preview save lease is held by another browser" }, 409, cors);
    }
    generation = row.generation + 1;
    const updated = await env.RUST_PREVIEW_DB.prepare(
      `UPDATE rust_preview_save_leases
          SET holder = ?, lease_hash = ?, generation = ?, expires_at = ?, updated_at = ?
        WHERE account_id = ? AND slot = ? AND generation = ?
          AND (expires_at <= ? OR holder = ?)`,
    )
      .bind(holder, leaseHash, generation, expiresAt, now, account.account_id, slot, row.generation, now, holder)
      .run();
    changes = updated.meta.changes ?? 0;
  }
  if (changes !== 1) {
    return json({ error: "preview save lease conflict" }, 409, cors);
  }
  return json({ schema_version: 1, slot, holder, generation, expires_at: expiresAt, lease_token: token }, 200, cors);
}

async function releaseLease(
  request: Request,
  account: PreviewAccountRow,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  if (
    !isPreviewRecord(body)
    || typeof body.slot !== "string"
    || !validSlot(body.slot)
    || typeof body.lease_token !== "string"
  ) {
    return json({ error: "invalid preview lease release" }, 400, cors);
  }
  const leaseHash = await leaseTokenHash(body.lease_token);
  await env.RUST_PREVIEW_DB.prepare(
    "DELETE FROM rust_preview_save_leases WHERE account_id = ? AND slot = ? AND lease_hash = ?",
  )
    .bind(account.account_id, body.slot, leaseHash)
    .run();
  return new Response(null, { status: 204, headers: cors });
}

async function rustPreviewSave(
  request: Request,
  url: URL,
  account: PreviewAccountRow,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const slot = url.searchParams.get("slot") ?? "";
  const releaseId = request.headers.get("x-er-release") ?? "";
  const namespace = request.headers.get("x-er-save-namespace") ?? "";
  const saveSchema = Number(request.headers.get("x-er-save-schema"));
  if (
    !validSlot(slot)
    || !identifier(releaseId)
    || namespace !== PREVIEW_NAMESPACE
    || !Number.isSafeInteger(saveSchema)
    || saveSchema < 1
  ) {
    return json({ error: "invalid Rust preview save identity" }, 400, cors);
  }
  const release = await previewReleaseIdentity(env, releaseId);
  if (release == null || release.saveSchema !== saveSchema) {
    return json({ error: "Rust preview release identity is unavailable or invalid" }, 503, cors);
  }
  const row = await env.RUST_PREVIEW_DB.prepare(
    `SELECT data, revision, release_id, kernel_generation, content_identity,
            active_model_identity, mechanics_sha256, save_schema, payload_sha256, created_at, updated_at
       FROM rust_preview_saves WHERE account_id = ? AND slot = ?`,
  )
    .bind(account.account_id, slot)
    .first<PreviewSaveRow>();
  if (request.method === "GET") {
    if (row == null) {
      return new Response(null, {
        status: 404,
        headers: {
          ...cors,
          "cache-control": "no-store",
          "x-er-save-namespace": PREVIEW_NAMESPACE,
          "x-er-preview-database-identity": env.M9_PREVIEW_DATABASE_IDENTITY_HASH,
        },
      });
    }
    if (!saveRowMatchesRelease(row, releaseId, saveSchema, release)) {
      return json({ error: "Rust preview save requires an explicit compatible-release migration" }, 409, cors);
    }
    return previewSaveResponse(row, slot, env, cors);
  }
  const lease = await validLease(request, account.account_id, slot, env);
  if (lease == null) {
    return json({ error: "valid Rust preview save lease required" }, 409, cors);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_SAVE_BYTES) {
    return json({ error: "Rust preview save is empty or oversized" }, 413, cors);
  }
  let incoming: string;
  let parsed: unknown;
  try {
    incoming = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(incoming);
  } catch {
    return json({ error: "Rust preview save is not canonical UTF-8 JSON" }, 400, cors);
  }
  if (canonical(parsed) !== incoming) {
    return json({ error: "Rust preview save is not canonical JSON" }, 400, cors);
  }
  const nextRevision = (row?.revision ?? 0) + 1;
  const identity = await previewEnvelopeIdentity(parsed, account.account_id, slot, releaseId, release, nextRevision);
  if (identity == null) {
    return json({ error: "Rust preview save envelope identity is invalid" }, 400, cors);
  }
  const expected = request.headers.get("if-match");
  const currentEtag = row == null ? null : await etag(row.data);
  if ((row == null && expected !== "*") || (row != null && expected !== currentEtag)) {
    return json({ error: "Rust preview save generation conflict" }, 412, cors);
  }
  const now = Date.now();
  let changes = 0;
  if (row == null) {
    const inserted = await env.RUST_PREVIEW_DB.prepare(
      `INSERT INTO rust_preview_saves (
         account_id, slot, release_id, kernel_generation, content_identity,
         active_model_identity, mechanics_sha256, save_schema, payload_sha256,
         data, revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, slot) DO NOTHING`,
    )
      .bind(
        account.account_id,
        slot,
        releaseId,
        identity.kernelGeneration,
        identity.contentIdentity,
        identity.activeModelIdentity,
        identity.mechanicsSha256,
        saveSchema,
        identity.payloadSha256,
        incoming,
        nextRevision,
        now,
        now,
      )
      .run();
    changes = inserted.meta.changes ?? 0;
  } else {
    const results = await env.RUST_PREVIEW_DB.batch([
      env.RUST_PREVIEW_DB.prepare(
        `INSERT INTO rust_preview_save_backups (
           account_id, slot, revision, release_id, kernel_generation, content_identity,
           active_model_identity, mechanics_sha256, save_schema, payload_sha256,
           data, created_at, replaced_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, slot, revision) DO NOTHING`,
      ).bind(
        account.account_id,
        slot,
        row.revision,
        row.release_id,
        row.kernel_generation,
        row.content_identity,
        row.active_model_identity,
        row.mechanics_sha256,
        row.save_schema,
        row.payload_sha256,
        row.data,
        row.created_at,
        now,
      ),
      env.RUST_PREVIEW_DB.prepare(
        `UPDATE rust_preview_saves
            SET release_id = ?, kernel_generation = ?, content_identity = ?,
                active_model_identity = ?, mechanics_sha256 = ?, save_schema = ?,
                payload_sha256 = ?, data = ?, revision = ?, updated_at = ?
          WHERE account_id = ? AND slot = ? AND revision = ? AND payload_sha256 = ?`,
      ).bind(
        releaseId,
        identity.kernelGeneration,
        identity.contentIdentity,
        identity.activeModelIdentity,
        identity.mechanicsSha256,
        saveSchema,
        identity.payloadSha256,
        incoming,
        nextRevision,
        now,
        account.account_id,
        slot,
        row.revision,
        row.payload_sha256,
      ),
    ]);
    changes = results[1]?.meta.changes ?? 0;
  }
  if (changes !== 1) {
    return json({ error: "Rust preview save compare-and-swap conflict" }, 409, cors);
  }
  const readback = await env.RUST_PREVIEW_DB.prepare(
    `SELECT data, revision, release_id, kernel_generation, content_identity,
            active_model_identity, mechanics_sha256, save_schema, payload_sha256, created_at, updated_at
       FROM rust_preview_saves WHERE account_id = ? AND slot = ?`,
  )
    .bind(account.account_id, slot)
    .first<PreviewSaveRow>();
  if (
    readback == null
    || readback.data !== incoming
    || readback.revision !== nextRevision
    || readback.payload_sha256 !== identity.payloadSha256
    || !saveRowMatchesRelease(readback, releaseId, saveSchema, release)
  ) {
    return json({ error: "Rust preview save readback mismatch" }, 500, cors);
  }
  return previewSaveWriteResponse(readback, slot, env, cors);
}

async function validLease(
  request: Request,
  accountId: string,
  slot: string,
  env: Env,
): Promise<PreviewLeaseRow | null> {
  const token = request.headers.get("x-er-preview-lease") ?? "";
  const holder = request.headers.get("x-er-preview-holder") ?? "";
  if (token.length < 16 || token.length > 512 || !identifier(holder)) {
    return null;
  }
  const leaseHash = await leaseTokenHash(token);
  const row = await env.RUST_PREVIEW_DB.prepare(
    `SELECT holder, lease_hash, generation, expires_at
       FROM rust_preview_save_leases
      WHERE account_id = ? AND slot = ? AND holder = ? AND lease_hash = ?`,
  )
    .bind(accountId, slot, holder, leaseHash)
    .first<PreviewLeaseRow>();
  return row != null && row.expires_at > Date.now() ? row : null;
}

function saveRowMatchesRelease(
  row: PreviewSaveRow,
  releaseId: string,
  saveSchema: number,
  release: PreviewReleaseIdentity,
): boolean {
  return (
    row.release_id === releaseId
    && row.save_schema === saveSchema
    && row.kernel_generation === release.kernelGeneration
    && row.content_identity === release.contentIdentity
    && row.mechanics_sha256 === release.mechanicsSha256
    && row.active_model_identity === release.activeModelIdentity
  );
}

async function previewReleaseIdentity(env: Env, releaseId: string): Promise<PreviewReleaseIdentity | null> {
  const cached = releaseCache.get(releaseId);
  if (cached != null) {
    return cached;
  }
  const object = await env.M9_RELEASES.get(`manifests/${releaseId}.json`);
  if (object == null) {
    return null;
  }
  const signed = await decodeSignedObject(object, "er-m9:release-manifest-v1");
  if (signed == null) {
    return null;
  }
  const payload = signed.payload;
  const mechanical = payload.mechanical_identity;
  if (
    payload.release_id !== releaseId
    || (payload.channel !== "INTERNAL" && payload.channel !== "PREVIEW" && payload.channel !== "CANARY")
    || !Number.isSafeInteger(payload.release_epoch)
    || Number(payload.release_epoch) < 1
    || !Number.isSafeInteger(payload.save_schema)
    || Number(payload.save_schema) < 1
    || payload.authority_protocol !== "er-coop-47"
    || !isPreviewRecord(mechanical)
    || Object.keys(mechanical).length !== 5
    || mechanical.schema_version !== 1
    || typeof mechanical.mechanics_sha256 !== "string"
    || !/^[0-9a-f]{64}$/u.test(mechanical.mechanics_sha256)
    || typeof mechanical.content_hash !== "string"
    || mechanical.content_hash.length === 0
    || mechanical.content_hash.length > 256
    || mechanical.authority_protocol !== "er-coop-47"
    || typeof mechanical.active_model_identity !== "string"
    || !identifier(mechanical.active_model_identity)
  ) {
    return null;
  }
  const identity: PreviewReleaseIdentity = {
    kernelGeneration: Number(payload.release_epoch),
    saveSchema: Number(payload.save_schema),
    authorityProtocol: "er-coop-47",
    contentIdentity: mechanical.content_hash,
    mechanicsSha256: mechanical.mechanics_sha256,
    activeModelIdentity: mechanical.active_model_identity,
  };
  releaseCache.set(releaseId, identity);
  while (releaseCache.size > 16) {
    const first = releaseCache.keys().next().value;
    if (first == null) {
      break;
    }
    releaseCache.delete(first);
  }
  return identity;
}

async function previewEnvelopeIdentity(
  value: unknown,
  accountId: string,
  slot: string,
  releaseId: string,
  release: PreviewReleaseIdentity,
  nextRevision: number,
): Promise<PreviewEnvelopeIdentity | null> {
  if (
    !isPreviewRecord(value)
    || Object.keys(value).some(key => ENVELOPE_KEYS[key] !== true)
    || value.envelope_version !== 2
    || value.save_namespace !== PREVIEW_NAMESPACE
    || value.slot !== slot
    || value.pseudonymous_account_id !== accountId
    || value.cloud_generation !== nextRevision
    || value.origin_runtime !== "RUST"
    || value.release_id !== releaseId
    || value.kernel_generation !== release.kernelGeneration
    || value.authority_protocol !== release.authorityProtocol
    || value.save_schema !== release.saveSchema
    || value.content_hash !== release.contentIdentity
    || typeof value.payload_hash !== "string"
    || !/^[0-9a-f]{64}$/u.test(value.payload_hash)
    || !Array.isArray(value.payload)
    || value.payload.length === 0
    || value.payload.length > MAXIMUM_SAVE_BYTES
    || value.payload.some(byte => !Number.isSafeInteger(byte) || Number(byte) < 0 || Number(byte) > 255)
    || value.migration !== null
    || value.legacy_backup !== null
    || !isPreviewRecord(value.mechanical_identity)
    || Object.keys(value.mechanical_identity).length !== 5
    || value.mechanical_identity.schema_version !== 1
    || value.mechanical_identity.mechanics_sha256 !== release.mechanicsSha256
    || value.mechanical_identity.content_hash !== release.contentIdentity
    || value.mechanical_identity.authority_protocol !== release.authorityProtocol
    || value.mechanical_identity.active_model_identity !== release.activeModelIdentity
  ) {
    return null;
  }
  const payload = Uint8Array.from(value.payload as number[]);
  try {
    if ((await sha256(payload)) !== value.payload_hash) {
      return null;
    }
  } finally {
    payload.fill(0);
  }
  return {
    kernelGeneration: Number(value.kernel_generation),
    contentIdentity: value.content_hash as string,
    mechanicsSha256: value.mechanical_identity.mechanics_sha256 as string,
    activeModelIdentity: value.mechanical_identity.active_model_identity as string,
    payloadSha256: value.payload_hash,
  };
}

async function previewSaveResponse(
  row: PreviewSaveRow,
  slot: string,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  return new Response(row.data, {
    status: 200,
    headers: await previewSaveHeaders(row, slot, env, cors),
  });
}

async function previewSaveWriteResponse(
  row: PreviewSaveRow,
  slot: string,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  return new Response(null, {
    status: 200,
    headers: await previewSaveHeaders(row, slot, env, cors),
  });
}

async function previewSaveHeaders(
  row: PreviewSaveRow,
  slot: string,
  env: Env,
  cors: Record<string, string>,
): Promise<Record<string, string>> {
  return {
    ...cors,
    "content-type": "application/octet-stream",
    etag: await etag(row.data),
    "x-er-save-namespace": PREVIEW_NAMESPACE,
    "x-er-release-id": row.release_id,
    "x-er-save-slot": slot,
    "x-er-save-schema": String(row.save_schema),
    "x-er-save-generation": String(row.revision),
    "x-er-kernel-generation": String(row.kernel_generation),
    "x-er-content-identity": row.content_identity,
    "x-er-payload-sha256": row.payload_sha256,
    "x-er-mechanics-sha256": row.mechanics_sha256,
    "x-er-active-model-identity": row.active_model_identity,
    "x-er-preview-database-identity": env.M9_PREVIEW_DATABASE_IDENTITY_HASH,
    "cache-control": "no-store",
  };
}

async function decodeSignedObject(object: PreviewR2Object, domain: string): Promise<SignedEnvelope | null> {
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 131_072) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  return (await verifyEnvelope(value, domain)) ? (value as SignedEnvelope) : null;
}

async function verifyEnvelope(value: unknown, domain: string): Promise<boolean> {
  if (
    !isPreviewRecord(value)
    || value.envelope_version !== 1
    || value.key_id !== "m9-prod-2026-01"
    || !isPreviewRecord(value.payload)
    || !Array.isArray(value.signature)
    || value.signature.length !== 64
    || value.signature.some(byte => !Number.isSafeInteger(byte) || Number(byte) < 0 || Number(byte) > 255)
  ) {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", PUBLIC_KEY, { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    Uint8Array.from(value.signature as number[]),
    new TextEncoder().encode(`${domain}\0${canonical(value.payload)}`),
  );
}

async function signEnvelope(payload: Record<string, unknown>, domain: string, privateKeyBase64: string) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(privateKeyBase64), value => value.charCodeAt(0)),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    new TextEncoder().encode(`${domain}\0${canonical(payload)}`),
  );
  return {
    envelope_version: 1,
    key_id: "m9-prod-2026-01",
    payload,
    signature: Array.from(new Uint8Array(signature)),
  };
}

function bearer(request: Request): string | null {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

async function equalSecret(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    sha256Bytes(new TextEncoder().encode(`m9-preview-invite:${left}`)),
    sha256Bytes(new TextEncoder().encode(`m9-preview-invite:${right}`)),
  ]);
  return leftHash.byteLength === rightHash.byteLength && leftHash.every((value, index) => value === rightHash[index]);
}

async function sessionTokenHash(token: string): Promise<string> {
  return sha256(new TextEncoder().encode(`m9-preview-session:${token}`));
}

async function leaseTokenHash(token: string): Promise<string> {
  return sha256(new TextEncoder().encode(`m9-preview-lease:${token}`));
}

function randomToken(bytes: number): string {
  if (bytes < MINIMUM_SESSION_TOKEN_BYTES / 2) {
    throw new Error("preview token size is invalid");
  }
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), value => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function validSlot(slot: string): boolean {
  return /^rust-slot-[0-4]$/u.test(slot);
}

function identifier(value: string): boolean {
  return /^[a-zA-Z0-9._:-]{1,128}$/u.test(value);
}

function secureTelemetryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && url.hash === ""
      && url.pathname === "/m9/health/event"
    );
  } catch {
    return false;
  }
}

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGIN ?? "")
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);
  const allowedOrigin = origin != null && allowed.includes(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type,Authorization,If-Match,X-Er-Release,X-Er-Save-Schema,X-Er-Save-Namespace,X-Er-Preview-Lease,X-Er-Preview-Holder,X-Er-Health-Idempotency-Key",
    "Access-Control-Expose-Headers":
      "ETag,X-Er-Release-Id,X-Er-Save-Slot,X-Er-Save-Schema,X-Er-Save-Generation,X-Er-Save-Namespace,X-Er-Kernel-Generation,X-Er-Content-Identity,X-Er-Mechanics-Sha256,X-Er-Active-Model-Identity,X-Er-Payload-Sha256,X-Er-Preview-Database-Identity",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(value: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function etag(data: string): Promise<string> {
  return `"${await sha256(new TextEncoder().encode(data))}"`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await sha256Bytes(bytes);
  return Array.from(digest, value => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
}

function canonical(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("canonical preview JSON requires safe integers");
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (isPreviewRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("canonical preview JSON contains an unsupported value");
}
