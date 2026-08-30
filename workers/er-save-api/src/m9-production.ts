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
  M9_RELEASES: M9R2Bucket;
  M9_RELEASE_SIGNING_PRIVATE_KEY: string;
  M9_INTERNAL_ACCOUNTS?: string;
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
const MAXIMUM_SAVE_BYTES = 268_435_456;

export async function handleM9PlatformContext(
  auth: M9Auth,
  _env: M9Env,
  cors: Record<string, string>,
): Promise<Response> {
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
      default_save_slot: "slot-0",
    },
    200,
    cors,
  );
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

export async function handleM9Save(
  request: Request,
  url: URL,
  auth: M9Auth,
  env: M9Env,
  cors: Record<string, string>,
): Promise<Response> {
  const slotText = url.searchParams.get("slot") ?? "";
  const match = /^slot-([0-4])$/u.exec(slotText);
  const releaseId = request.headers.get("x-er-release") ?? "";
  const saveSchema = Number(request.headers.get("x-er-save-schema"));
  if (match == null || !identifier(releaseId) || !Number.isSafeInteger(saveSchema) || saveSchema < 1) {
    return json({ error: "invalid production save identity" }, 400, cors);
  }
  const slot = Number(match[1]);
  const row = await env.DB.prepare("SELECT data, updated_at FROM session_saves WHERE user_id = ? AND slot = ?")
    .bind(auth.uid, slot)
    .first<{ data: string; updated_at: number }>();
  if (request.method === "GET") {
    if (row == null) {
      return new Response(null, { status: 404, headers: cors });
    }
    return saveResponse(row.data, row.updated_at, releaseId, slotText, saveSchema, cors);
  }
  if (request.method !== "PUT") {
    return json({ error: "method not allowed" }, 405, cors);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_SAVE_BYTES) {
    return json({ error: "save is empty or oversized" }, 413, cors);
  }
  let incoming: string;
  try {
    incoming = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return json({ error: "save is not canonical UTF-8" }, 400, cors);
  }
  const expected = request.headers.get("if-match");
  const currentEtag = row == null ? null : await etag(row.data);
  if ((row == null && expected !== "*") || (row != null && expected !== currentEtag)) {
    return json({ error: "save generation conflict" }, 412, cors);
  }
  const generation = Math.max(Date.now(), (row?.updated_at ?? 0) + 1);
  const result =
    row == null
      ? await env.DB.prepare(
          "INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, slot) DO NOTHING",
        )
          .bind(auth.uid, slot, incoming, generation)
          .run()
      : await env.DB.prepare(
          "UPDATE session_saves SET data = ?, updated_at = ? WHERE user_id = ? AND slot = ? AND data = ?",
        )
          .bind(incoming, generation, auth.uid, slot, row.data)
          .run();
  if ((result.meta.changes ?? 0) !== 1) {
    return json({ error: "save compare-and-swap conflict" }, 409, cors);
  }
  const readback = await env.DB.prepare("SELECT data, updated_at FROM session_saves WHERE user_id = ? AND slot = ?")
    .bind(auth.uid, slot)
    .first<{ data: string; updated_at: number }>();
  if (readback == null || readback.data !== incoming || readback.updated_at !== generation) {
    return json({ error: "save readback mismatch" }, 500, cors);
  }
  return saveResponse(readback.data, readback.updated_at, releaseId, slotText, saveSchema, cors);
}

async function saveResponse(
  data: string,
  generation: number,
  releaseId: string,
  slot: string,
  saveSchema: number,
  cors: Record<string, string>,
): Promise<Response> {
  return new Response(data, {
    status: 200,
    headers: {
      ...cors,
      "content-type": "application/octet-stream",
      etag: await etag(data),
      "x-er-release-id": releaseId,
      "x-er-save-slot": slot,
      "x-er-save-schema": String(saveSchema),
      "x-er-save-generation": String(generation),
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
