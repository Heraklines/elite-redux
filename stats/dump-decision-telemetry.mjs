import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import lzString from "lz-string";

const { decompressFromBase64 } = lzString;

const DATA = new URL("./data/", import.meta.url);
const OUTPUT = new URL("_decisions.json", DATA);
const COLLECTION_STARTED_AT = Date.parse("2026-08-25T00:00:00Z");
const OBSERVATIONS_URL = process.env.BALANCE_OBSERVATIONS_URL || "https://er-stats.pages.dev/data/balance-observations.json";
const BUCKET = process.env.PLAYER_TELEMETRY_BUCKET || "er-telemetry";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

const objectKeyDigest = key => createHash("sha256").update(key).digest("hex");

if (!accountId || !apiToken) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
}

async function previousState() {
  try {
    const response = await fetch(OBSERVATIONS_URL, { headers: { "Cache-Control": "no-cache" } });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data?.telemetryState && typeof data.telemetryState === "object" ? data.telemetryState : null;
  } catch {
    return null;
  }
}

function dateSegments(from, to) {
  const out = [];
  const day = 24 * 60 * 60 * 1000;
  for (let cursor = Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth(), new Date(from).getUTCDate()); cursor <= to; cursor += day) {
    const date = new Date(cursor);
    out.push(
      `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}/`,
    );
  }
  return out;
}

async function listObjects(prefix) {
  const objects = [];
  let cursor = "";
  do {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET}/objects`,
    );
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("per_page", "1000");
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiToken}` } });
    const body = await response.json();
    if (!response.ok || body?.success !== true) {
      const detail = body?.errors?.map(error => error.message).filter(Boolean).join("; ") || response.statusText;
      throw new Error(`Cloudflare R2 list failed (${response.status}): ${detail}`);
    }
    objects.push(...(Array.isArray(body.result) ? body.result : []));
    cursor = body?.result_info?.is_truncated
      ? String(body?.result_info?.cursor ?? body?.result_info?.next_cursor ?? "")
      : "";
  } while (cursor);
  return objects;
}

function decodeBatch(bytes, encoding) {
  const attempts = [
    () => bytes.toString("utf8"),
    () => gunzipSync(bytes).toString("utf8"),
    () => decompressFromBase64(bytes.toString("utf8")),
  ];
  if (encoding === "gz") {
    attempts.unshift(attempts.splice(1, 1)[0]);
  } else if (encoding === "lz") {
    attempts.unshift(attempts.splice(2, 1)[0]);
  }
  for (const attempt of attempts) {
    try {
      const text = attempt();
      if (text) {
        return JSON.parse(text);
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function getObject(object) {
  const key = String(object.key ?? "");
  const encodedKey = key
    .split("/")
    .map(part => encodeURIComponent(part))
    .join("/");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET}/objects/${encodedKey}`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  );
  if (!response.ok) {
    throw new Error(`Cloudflare R2 get failed for ${key} (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return decodeBatch(bytes, object.custom_metadata?.enc);
}

async function mapConcurrent(values, limit, mapper) {
  const output = new Array(values.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= values.length) {
        return;
      }
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

const now = Date.now();
const previous = await previousState();
const previousWatermark = Number(previous?.watermark?.uploadedAt) || COLLECTION_STARTED_AT;
const keysAtWatermark = new Set(Array.isArray(previous?.watermark?.keys) ? previous.watermark.keys.map(String) : []);
let listed = [];
let exportError = null;

try {
  const segments = dateSegments(COLLECTION_STARTED_AT, now);
  listed = (await Promise.all(segments.map(listObjects))).flat();
} catch (error) {
  exportError = error instanceof Error ? error.message : String(error);
}

const pending = listed.filter(object => {
  const uploadedAt = Number(object.custom_metadata?.uploadedAt);
  if (!Number.isFinite(uploadedAt) || uploadedAt < previousWatermark) {
    return false;
  }
  return uploadedAt > previousWatermark || !keysAtWatermark.has(objectKeyDigest(String(object.key)));
});

const batches = exportError
  ? []
  : await mapConcurrent(pending, 12, async object => {
      try {
        return { object, batch: await getObject(object) };
      } catch {
        return { object, batch: null };
      }
    });

if (!exportError && batches.some(entry => !entry.batch?.envelope || !Array.isArray(entry.batch.events))) {
  exportError = "One or more decision telemetry objects could not be decoded; the watermark was not advanced.";
}

const events = [];
let watermarkAt = previousWatermark;
let watermarkKeys = [...keysAtWatermark];
for (const { object, batch } of batches) {
  if (exportError) {
    break;
  }
  const uploadedAt = Number(object.custom_metadata?.uploadedAt);
  if (uploadedAt > watermarkAt) {
    watermarkAt = uploadedAt;
    watermarkKeys = [objectKeyDigest(String(object.key))];
  } else if (uploadedAt === watermarkAt) {
    watermarkKeys.push(objectKeyDigest(String(object.key)));
  }
  for (const event of batch.events) {
    if (event?.kind !== "biome_decision" && event?.kind !== "mystery_encounter") {
      continue;
    }
    events.push({
      ...event,
      difficulty: String(batch.envelope.difficulty ?? "unknown"),
      gameModeId: Number(batch.envelope.gameModeId),
      gameVersion: String(batch.envelope.build ?? "unknown"),
      erVersion: String(batch.envelope.erVersion ?? "unknown"),
    });
  }
}

writeFileSync(
  OUTPUT,
  `${JSON.stringify({
    generatedAt: new Date(now).toISOString(),
    collectionStartedAt: COLLECTION_STARTED_AT,
    previous,
    watermark: { uploadedAt: watermarkAt, keys: [...new Set(watermarkKeys)].slice(-100) },
    listedObjects: listed.length,
    fetchedObjects: pending.length,
    exportError,
    events,
  })}\n`,
  "utf8",
);

console.log(
  exportError
    ? `Decision telemetry export skipped: ${exportError}`
    : `Exported ${events.length} decision events from ${pending.length} new R2 objects`,
);
