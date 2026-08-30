/// <reference path="./cloudflare-workers.d.ts" />

import { isM9Record } from "./m9-type-guards";

interface M9R2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

interface M9R2Bucket {
  get(key: string): Promise<M9R2Object | null>;
}

interface M9Env {
  DB: D1Database;
  M9_RUST_SAVES: D1Database;
  M9_RELEASES: M9R2Bucket;
  M9_RELEASE_SIGNING_PRIVATE_KEY: string;
  M9_INTERNAL_ACCOUNTS?: string;
  M9_TELEMETRY_URL?: string;
}

interface M9Auth {
  uid: number;
  u: string;
}

interface SignedEnvelope {
  envelope_version: number;
  key_id: string;
  payload: Record<string, unknown>;
  signature: number[];
}

const PUBLIC_KEY = Uint8Array.from([
  125, 204, 207, 198, 76, 152, 199, 166, 208, 56, 189, 10, 100, 113, 89, 240, 107, 149, 135, 191, 77, 117, 18, 75, 237,
  22, 120, 8, 213, 169, 37, 142,
]);
const RUST_PREVIEW_SAVE_NAMESPACE = "M9_RUST_PREVIEW_V1";
const RUST_PREVIEW_ENVELOPE_KEYS: Readonly<Record<string, true>> = {
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
const rustPreviewReleaseIdentities = new Map<string, RustPreviewReleaseIdentity>();

interface RustPreviewSaveRow {
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

interface RustPreviewEnvelopeIdentity {
  kernelGeneration: number;
  contentIdentity: string;
  mechanicsSha256: string;
  activeModelIdentity: string;
  payloadSha256: string;
}

interface RustPreviewReleaseIdentity {
  kernelGeneration: number;
  saveSchema: number;
  authorityProtocol: string;
  contentIdentity: string;
  mechanicsSha256: string;
  activeModelIdentity: string;
}
const MAXIMUM_SAVE_BYTES = 268_435_456;

export async function handleM9PlatformContext(
  auth: M9Auth,
  env: M9Env,
  cors: Record<string, string>,
): Promise<Response> {
  const telemetryEventUrl = env.M9_TELEMETRY_URL ?? "https://er-telemetry.heraklines.workers.dev/m9/health/event";
  if (!secureTelemetryEventUrl(telemetryEventUrl)) {
    return json({ error: "production telemetry endpoint invalid" }, 503, cors);
  }
  const account = await pseudonymousAccount(auth.uid);
  const entitlements = await sha256(new TextEncoder().encode(`m9-entitlements:${auth.uid}:v1`));
  return json(
    {
      schema_version: 1,
      pseudonymous_account_id: account,
      entitlements_digest: entitlements,
      server_api_versions: {
        schema_version: 1,
        save_api: 2,
        telemetry_api: 1,
        signaling_api: 33,
        showdown_api: 1,
        achievement_api: 1,
      },
      default_save_slot: "rust-slot-0",
      rust_save_namespace: RUST_PREVIEW_SAVE_NAMESPACE,
      telemetry_event_url: telemetryEventUrl,
    },
    200,
    cors,
  );
}

export async function handleM9ReleaseObject(
  request: Request,
  url: URL,
  env: M9Env,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (request.method !== "GET") {
    return null;
  }
  const manifestMatch = /^\/__m9_manifests\/([a-zA-Z0-9._:-]{1,128})\.json$/u.exec(url.pathname);
  if (manifestMatch != null) {
    const object = await env.M9_RELEASES.get(`manifests/${manifestMatch[1]}.json`);
    if (object == null) {
      return json({ error: "release manifest unavailable" }, 404, cors);
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 131_072) {
      return json({ error: "release manifest invalid" }, 502, cors);
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return json({ error: "release manifest invalid" }, 502, cors);
    }
    if (
      !(await verifyEnvelope(envelope, "er-m9:release-manifest-v1"))
      || (envelope as SignedEnvelope).payload.release_id !== manifestMatch[1]
    ) {
      return json({ error: "release manifest invalid" }, 502, cors);
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-cache",
        ...cors,
      },
    });
  }
  const artifactMatch = /^\/__m9_releases\/([a-zA-Z0-9._:-]{1,128})\/([0-9a-f]{64})\/([a-zA-Z0-9._-]{1,128})$/u.exec(
    url.pathname,
  );
  if (artifactMatch == null) {
    return null;
  }
  const object = await env.M9_RELEASES.get(`${artifactMatch[1]}/${artifactMatch[2]}/${artifactMatch[3]}`);
  if (object == null) {
    return json({ error: "release artifact unavailable" }, 404, cors);
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_SAVE_BYTES || (await sha256(bytes)) !== artifactMatch[2]) {
    return json({ error: "release artifact invalid" }, 502, cors);
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": releaseArtifactMediaType(artifactMatch[3]),
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(bytes.byteLength),
      ...cors,
    },
  });
}

export async function handleM9RuntimeAssignment(
  request: Request,
  auth: M9Auth,
  env: M9Env,
  cors: Record<string, string>,
): Promise<Response> {
  const body: unknown = await request.json();
  if (!isM9Record(body) || typeof body.browser_session_id !== "string" || !identifier(body.browser_session_id)) {
    return json({ error: "invalid browser session" }, 400, cors);
  }
  const policyObject = await env.M9_RELEASES.get("policies/current.json");
  if (policyObject == null) {
    return json({ error: "rollout policy unavailable" }, 503, cors);
  }
  const policyBytes = new Uint8Array(await policyObject.arrayBuffer());
  if (policyBytes.byteLength === 0 || policyBytes.byteLength > 65_536) {
    return json({ error: "rollout policy invalid" }, 503, cors);
  }
  const policy = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(policyBytes)) as unknown;
  if (!(await verifyEnvelope(policy, "er-m9:rollout-policy-v1"))) {
    return json({ error: "rollout policy signature invalid" }, 503, cors);
  }
  const payload = (policy as SignedEnvelope).payload;
  const activeRing = typeof payload.active_ring === "string" ? payload.active_ring : "";
  const rings = Array.isArray(payload.rings) ? payload.rings : [];
  const ring = rings.find(value => isM9Record(value) && value.ring === activeRing);
  if (!isM9Record(ring) || !Number.isSafeInteger(ring.percentage_basis_points)) {
    return json({ error: "active rollout ring invalid" }, 503, cors);
  }
  const account = await pseudonymousAccount(auth.uid);
  const bucket = await cohortBucket(payload.policy_id, account);
  const internal = new Set(
    (env.M9_INTERNAL_ACCOUNTS ?? "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean),
  );
  const eligible =
    activeRing === "R0"
      ? false
      : activeRing === "R1" || activeRing === "R2"
        ? internal.has(auth.u)
        : bucket < Number(ring.percentage_basis_points);
  const releaseId = String(eligible ? payload.candidate_release : payload.stable_release);
  if (!identifier(releaseId)) {
    return json({ error: "assigned release invalid" }, 503, cors);
  }
  const releaseObject = await env.M9_RELEASES.get(`manifests/${releaseId}.json`);
  if (releaseObject == null) {
    return json({ error: "assigned release unavailable" }, 503, cors);
  }
  const release = JSON.parse(await releaseObject.text()) as unknown;
  if (!(await verifyEnvelope(release, "er-m9:release-manifest-v1"))) {
    return json({ error: "assigned release signature invalid" }, 503, cors);
  }
  const releasePayload = (release as SignedEnvelope).payload;
  const channel = releasePayload.channel;
  const authority =
    channel === "LEGACY_TRANSITION"
      ? "LEGACY_TRANSITION"
      : eligible && channel !== "STABLE" && channel !== "ROLLBACK"
        ? "RUST_CANARY"
        : "RUST_PRODUCTION";
  const now = Date.now();
  const assignment = {
    schema_version: 1,
    assignment_id: `assignment-${String(payload.policy_version)}-${account}`,
    release_id: releaseId,
    authority,
    cohort: activeRing,
    sticky_scope: { kind: "ACCOUNT", value: { pseudonymous_account_id: account } },
    issued_at: now,
    expires_at: Math.min(Number(payload.expires_at), now + 86_400_000),
    policy_version: Number(payload.policy_version),
  };
  const signed = await signEnvelope(assignment, "er-m9:runtime-assignment-v1", env.M9_RELEASE_SIGNING_PRIVATE_KEY);
  return json(signed, 200, cors);
}

export async function handleM9RustPreviewSave(
  request: Request,
  url: URL,
  auth: M9Auth,
  env: M9Env,
  cors: Record<string, string>,
): Promise<Response> {
  const slot = url.searchParams.get("slot") ?? "";
  const releaseId = request.headers.get("x-er-release") ?? "";
  const namespace = request.headers.get("x-er-save-namespace") ?? "";
  const saveSchema = Number(request.headers.get("x-er-save-schema"));
  if (
    !/^rust-slot-[0-4]$/u.test(slot)
    || !identifier(releaseId)
    || namespace !== "M9_RUST_PREVIEW_V1"
    || !Number.isSafeInteger(saveSchema)
    || saveSchema < 1
  ) {
    return json({ error: "invalid Rust preview save identity" }, 400, cors);
  }
  const release = await rustPreviewReleaseIdentity(env, releaseId);
  if (release == null || release.saveSchema !== saveSchema) {
    return json({ error: "Rust preview release identity is unavailable or invalid" }, 503, cors);
  }
  const accountId = await pseudonymousAccount(auth.uid);
  const row = await env.M9_RUST_SAVES.prepare(
    `SELECT data, revision, release_id, kernel_generation, content_identity,
            active_model_identity, mechanics_sha256, save_schema, payload_sha256, created_at, updated_at
       FROM rust_preview_saves WHERE account_id = ? AND slot = ?`,
  )
    .bind(accountId, slot)
    .first<RustPreviewSaveRow>();
  if (request.method === "GET") {
    if (row == null) {
      return new Response(null, {
        status: 404,
        headers: {
          ...cors,
          "cache-control": "no-store",
          "x-er-save-namespace": "M9_RUST_PREVIEW_V1",
        },
      });
    }
    if (
      row.release_id !== releaseId
      || row.save_schema !== saveSchema
      || row.kernel_generation !== release.kernelGeneration
      || row.content_identity !== release.contentIdentity
      || row.mechanics_sha256 !== release.mechanicsSha256
      || row.active_model_identity !== release.activeModelIdentity
    ) {
      return json({ error: "Rust preview save requires an explicit compatible-release migration" }, 409, cors);
    }
    return rustPreviewSaveResponse(row, slot, cors);
  }
  if (request.method !== "PUT") {
    return json({ error: "method not allowed" }, 405, cors);
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
  const identity = await rustPreviewEnvelopeIdentity(parsed, accountId, slot, releaseId, release, nextRevision);
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
    const result = await env.M9_RUST_SAVES.prepare(
      `INSERT INTO rust_preview_saves (
         account_id, slot, release_id, kernel_generation, content_identity,
         active_model_identity, mechanics_sha256, save_schema, payload_sha256,
         data, revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, slot) DO NOTHING`,
    )
      .bind(
        accountId,
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
    changes = result.meta.changes ?? 0;
  } else {
    const results = await env.M9_RUST_SAVES.batch([
      env.M9_RUST_SAVES.prepare(
        `INSERT INTO rust_preview_save_backups (
           account_id, slot, revision, release_id, kernel_generation, content_identity,
           active_model_identity, mechanics_sha256, save_schema, payload_sha256,
           data, created_at, replaced_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, slot, revision) DO NOTHING`,
      ).bind(
        accountId,
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
      env.M9_RUST_SAVES.prepare(
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
        accountId,
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
  const readback = await env.M9_RUST_SAVES.prepare(
    `SELECT data, revision, release_id, kernel_generation, content_identity,
            active_model_identity, mechanics_sha256, save_schema, payload_sha256, created_at, updated_at
       FROM rust_preview_saves WHERE account_id = ? AND slot = ?`,
  )
    .bind(accountId, slot)
    .first<RustPreviewSaveRow>();
  if (
    readback == null
    || readback.data !== incoming
    || readback.revision !== nextRevision
    || readback.payload_sha256 !== identity.payloadSha256
    || readback.release_id !== releaseId
    || readback.kernel_generation !== identity.kernelGeneration
    || readback.content_identity !== identity.contentIdentity
    || readback.active_model_identity !== identity.activeModelIdentity
    || readback.mechanics_sha256 !== identity.mechanicsSha256
    || readback.save_schema !== release.saveSchema
  ) {
    return json({ error: "Rust preview save readback mismatch" }, 500, cors);
  }
  return rustPreviewSaveResponse(readback, slot, cors);
}

async function rustPreviewReleaseIdentity(env: M9Env, releaseId: string): Promise<RustPreviewReleaseIdentity | null> {
  const cached = rustPreviewReleaseIdentities.get(releaseId);
  if (cached != null) {
    return cached;
  }
  const object = await env.M9_RELEASES.get(`manifests/${releaseId}.json`);
  if (object == null) {
    return null;
  }
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
  if (!(await verifyEnvelope(value, "er-m9:release-manifest-v1"))) {
    return null;
  }
  const payload = (value as SignedEnvelope).payload;
  const mechanical = payload.mechanical_identity;
  if (
    payload.release_id !== releaseId
    || !Number.isSafeInteger(payload.release_epoch)
    || Number(payload.release_epoch) < 1
    || !Number.isSafeInteger(payload.save_schema)
    || Number(payload.save_schema) < 1
    || payload.authority_protocol !== "er-coop-47"
    || !isM9Record(mechanical)
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
  const identity = {
    kernelGeneration: Number(payload.release_epoch),
    saveSchema: Number(payload.save_schema),
    authorityProtocol: "er-coop-47",
    contentIdentity: mechanical.content_hash,
    mechanicsSha256: mechanical.mechanics_sha256,
    activeModelIdentity: mechanical.active_model_identity,
  };
  rustPreviewReleaseIdentities.set(releaseId, identity);
  while (rustPreviewReleaseIdentities.size > 16) {
    const first = rustPreviewReleaseIdentities.keys().next().value;
    if (first == null) {
      break;
    }
    rustPreviewReleaseIdentities.delete(first);
  }
  return identity;
}

async function rustPreviewEnvelopeIdentity(
  value: unknown,
  accountId: string,
  slot: string,
  releaseId: string,
  release: RustPreviewReleaseIdentity,
  nextRevision: number,
): Promise<RustPreviewEnvelopeIdentity | null> {
  if (
    !isM9Record(value)
    || Object.keys(value).some(key => RUST_PREVIEW_ENVELOPE_KEYS[key] !== true)
    || value.envelope_version !== 2
    || value.save_namespace !== RUST_PREVIEW_SAVE_NAMESPACE
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
    || !isM9Record(value.mechanical_identity)
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
    contentIdentity: value.content_hash,
    mechanicsSha256: value.mechanical_identity.mechanics_sha256,
    activeModelIdentity: value.mechanical_identity.active_model_identity,
    payloadSha256: value.payload_hash,
  };
}

async function rustPreviewSaveResponse(
  row: RustPreviewSaveRow,
  slot: string,
  cors: Record<string, string>,
): Promise<Response> {
  return new Response(row.data, {
    status: 200,
    headers: {
      ...cors,
      "content-type": "application/octet-stream",
      etag: await etag(row.data),
      "x-er-save-namespace": RUST_PREVIEW_SAVE_NAMESPACE,
      "x-er-release-id": row.release_id,
      "x-er-save-slot": slot,
      "x-er-save-schema": String(row.save_schema),
      "x-er-save-generation": String(row.revision),
      "x-er-kernel-generation": String(row.kernel_generation),
      "x-er-content-identity": row.content_identity,
      "x-er-payload-sha256": row.payload_sha256,
      "x-er-mechanics-sha256": row.mechanics_sha256,
      "x-er-active-model-identity": row.active_model_identity,
      "cache-control": "no-store",
    },
  });
}

async function verifyEnvelope(value: unknown, domain: string): Promise<boolean> {
  if (
    !isM9Record(value)
    || value.envelope_version !== 1
    || value.key_id !== "m9-prod-2026-01"
    || !isM9Record(value.payload)
    || !Array.isArray(value.signature)
    || value.signature.length !== 64
    || value.signature.some(byte => !Number.isSafeInteger(byte) || byte < 0 || byte > 255)
  ) {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", PUBLIC_KEY, { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    Uint8Array.from(value.signature),
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
  return { envelope_version: 1, key_id: "m9-prod-2026-01", payload, signature: Array.from(new Uint8Array(signature)) };
}

async function cohortBucket(policyId: unknown, account: string): Promise<number> {
  if (typeof policyId !== "string" || policyId.length === 0) {
    throw new Error("rollout policy identity is invalid");
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${policyId}:${account}`)),
  );
  return ((digest[0] << 8) | digest[1]) % 10_000;
}

async function pseudonymousAccount(uid: number): Promise<string> {
  return `account-${(await sha256(new TextEncoder().encode(`m9-account:${uid}`))).slice(0, 32)}`;
}

async function etag(data: string): Promise<string> {
  return `"${await sha256(new TextEncoder().encode(data))}"`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function identifier(value: string): boolean {
  return /^[a-zA-Z0-9._:-]{1,128}$/u.test(value);
}

function secureTelemetryEventUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:"
      && url.username.length === 0
      && url.password.length === 0
      && url.search.length === 0
      && url.hash.length === 0
      && url.pathname === "/m9/health/event"
    );
  } catch {
    return false;
  }
}

function releaseArtifactMediaType(name: string): string {
  if (name.endsWith(".js")) {
    return "text/javascript";
  }
  if (name.endsWith(".wasm")) {
    return "application/wasm";
  }
  if (name.endsWith(".json")) {
    return "application/json";
  }
  return "application/octet-stream";
}

function json(value: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, "content-type": "application/json", "cache-control": "no-store" },
  });
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("invalid signed number");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (isM9Record(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("invalid signed value");
}
