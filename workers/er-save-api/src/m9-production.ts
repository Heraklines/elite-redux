/// <reference path="./cloudflare-workers.d.ts" />

import { isM9Record } from "./m9-type-guards";

interface M9R2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface M9R2Bucket {
  get(key: string): Promise<M9R2Object | null>;
}

interface M9Env {
  M9_RELEASES: M9R2Bucket;
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

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
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
