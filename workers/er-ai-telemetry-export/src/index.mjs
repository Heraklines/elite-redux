const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 25;
const READ_BATCH_SIZE = 5;

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

async function tokenMatches(request, expectedToken) {
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") ?? "";
  if (!actual || !expectedToken) {
    return false;
  }
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expectedToken)),
  ]);
  const left = new Uint8Array(actualHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function parsePageSize(value) {
  if (value == null || value === "") {
    return DEFAULT_PAGE_SIZE;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_PAGE_SIZE ? parsed : null;
}

function matchesContractVersion(object, contractVersion) {
  return contractVersion == null || String(object.customMetadata?.combatContractVersion ?? "0") === contractVersion;
}

async function readRows(bucket, objects) {
  const rows = [];
  for (let offset = 0; offset < objects.length; offset += READ_BATCH_SIZE) {
    const chunk = objects.slice(offset, offset + READ_BATCH_SIZE);
    const chunkRows = await Promise.all(
      chunk.map(async object => {
        const body = await bucket.get(object.key);
        if (!body) {
          return { body: null, invalidReason: "missing", size: object.size ?? 0 };
        }
        return {
          body: await body.text(),
          customMetadata: object.customMetadata ?? {},
          lastModified: object.uploaded instanceof Date ? object.uploaded.toISOString() : null,
          size: object.size ?? 0,
        };
      }),
    );
    rows.push(...chunkRows);
  }
  return rows;
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/v1/export") {
    return jsonResponse({ error: "not found" }, 404);
  }
  if (!(await tokenMatches(request, env.EXPORT_TOKEN))) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const limit = parsePageSize(url.searchParams.get("limit"));
  if (limit == null) {
    return jsonResponse({ error: `limit must be between 1 and ${MAX_PAGE_SIZE}` }, 400);
  }
  const contractVersion = url.searchParams.get("contractVersion") || null;
  const prefix = url.searchParams.get("prefix") ?? "";
  const cursor = url.searchParams.get("cursor") || undefined;
  const listed = await env.TELEMETRY.list({
    cursor,
    include: ["customMetadata"],
    limit,
    prefix,
  });
  const selected = listed.objects.filter(object => matchesContractVersion(object, contractVersion));
  const rows = await readRows(env.TELEMETRY, selected);
  const body = rows.map(row => JSON.stringify(row)).join("\n");

  return new Response(body ? `${body}\n` : "", {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-er-listed-objects": String(listed.objects.length),
      "x-er-next-cursor": listed.truncated ? (listed.cursor ?? "") : "",
      "x-er-selected-bytes": String(selected.reduce((sum, object) => sum + (object.size ?? 0), 0)),
      "x-er-selected-objects": String(selected.length),
      "x-er-truncated": String(listed.truncated),
    },
  });
}

// A module Worker requires a default export for the runtime fetch handler.
// biome-ignore lint/style/noDefaultExport: Cloudflare Workers module contract.
export default {
  fetch: handleRequest,
};
