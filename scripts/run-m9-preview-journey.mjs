import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const previewUrl = requiredUrl(process.env.M9_PREVIEW_URL ?? "https://m9-r1-internal.elite-redux.pages.dev");
const workerOrigin = requiredUrl(
  process.env.M9_PREVIEW_WORKER_ORIGIN ?? "https://er-m9-preview-save.heraklines.workers.dev",
).origin;
const invite = requiredSecret("M9_PREVIEW_INVITE_SECRET");
const expectedRelease = requiredIdentifier("M9_EXPECTED_RELEASE_ID");
const expectedManifestHash = requiredSha256("M9_EXPECTED_MANIFEST_SHA256");
const expectedDatabaseIdentity = requiredSha256("M9_EXPECTED_PREVIEW_DATABASE_SHA256");
const journeyMode = parseJourneyMode(process.env.M9_JOURNEY_MODE ?? "functional");
const minimumActiveMs =
  journeyMode === "SOAK" ? boundedInteger(process.env.M9_MINIMUM_ACTIVE_MS ?? "60000", 1_000, 300_000) : 0;
const outputPath = resolve(process.env.M9_EVIDENCE_OUTPUT ?? "m9-preview-journey-evidence.json");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "allow" });
const page = await context.newPage();
const consoleErrors = [];
const requestFailures = [];
const expectedLifecycleAborts = [];
const expectedLifecycleConsoleErrors = [];
const activeWorkerRequests = new Set();
let lifecycleBoundary = false;
page.on("console", message => {
  if (message.type() === "error") {
    const bounded = message.text().slice(0, 256);
    const expectedMissingSave = bounded === "Failed to load resource: the server responded with a status of 404 ()";
    (lifecycleBoundary || expectedMissingSave ? expectedLifecycleConsoleErrors : consoleErrors).push(bounded);
  }
});
page.on("request", request => {
  if (new URL(request.url()).origin === workerOrigin) {
    activeWorkerRequests.add(request);
  }
});
page.on("requestfinished", request => {
  activeWorkerRequests.delete(request);
});
page.on("requestfailed", request => {
  const failure = {
    method: request.method(),
    origin: new URL(request.url()).origin,
    failure: request.failure()?.errorText.slice(0, 128) ?? "unknown",
  };
  if (failure.origin === workerOrigin && failure.failure === "net::ERR_ABORTED") {
    expectedLifecycleAborts.push(failure);
  } else {
    requestFailures.push(failure);
  }
  activeWorkerRequests.delete(request);
});

let authorization = "";
try {
  const journeyStartedAt = Date.now();
  const freshAccountStartedAt = performance.now();
  await page.goto(previewUrl.href, { waitUntil: "load", timeout: 60_000 });
  await page.locator("form[data-preview-authorization=required]").waitFor({ state: "visible", timeout: 30_000 });
  if (journeyMode === "COLD_START") {
    await page.evaluate(async () => {
      for (const cacheName of await caches.keys()) {
        await caches.delete(cacheName);
      }
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        await registration.unregister();
      }
    });
  }
  await page.locator('input[name="preview-invite"]').fill(invite);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "load", timeout: 60_000 }),
    page.getByRole("button", { name: "Create fresh Rust preview account" }).click(),
  ]);
  await page.locator("canvas").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll("canvas").length === 1, undefined, { timeout: 60_000 });
  const coldReadyMs = rounded(await page.evaluate(() => performance.now()));
  const freshAccountBootstrapMs = rounded(performance.now() - freshAccountStartedAt);
  await waitForPreviewHealthResource(page);
  await waitForWorkerIdle(activeWorkerRequests);

  authorization = await page.evaluate(() => {
    const value = document.cookie
      .split("; ")
      .find(entry => entry.startsWith("er_m9_preview_session="))
      ?.slice("er_m9_preview_session=".length);
    return value ?? "";
  });
  if (!/^[A-Za-z0-9._~-]{32,512}$/u.test(authorization)) {
    throw new Error("live preview journey did not receive a bounded preview authorization");
  }

  const releaseResponse = await fetch(new URL("/release.json", previewUrl), { cache: "no-store", redirect: "error" });
  const releaseIdentity = await requiredJson(releaseResponse, "deployed release identity");
  if (releaseIdentity.release_id !== expectedRelease || releaseIdentity.manifest_sha256 !== expectedManifestHash) {
    throw new Error("deployed preview identity differs from the immutable release under test");
  }

  const platform = await authorizedJson("/api/m9/platform-context", authorization);
  if (
    platform.preview_only !== true
    || platform.rust_save_namespace !== "M9_RUST_PREVIEW_V1"
    || platform.preview_database_identity_hash !== expectedDatabaseIdentity
    || typeof platform.pseudonymous_account_id !== "string"
    || !/^rust-preview:[0-9a-f]{32}$/u.test(platform.pseudonymous_account_id)
    || Object.values(platform.imports ?? {}).some(value => value !== false)
  ) {
    throw new Error("live preview platform context is not capability-isolated");
  }

  const browserSessionId = await readBrowserSessionId(page);
  const assignment = await authorizedJson("/api/m9/runtime-assignment", authorization, {
    method: "POST",
    body: JSON.stringify({ schema_version: 1, browser_session_id: browserSessionId }),
  });
  if (
    assignment.envelope_version !== 1
    || assignment.key_id !== "m9-prod-2026-01"
    || assignment.payload?.release_id !== expectedRelease
    || assignment.payload?.authority !== "RUST_CANARY"
    || assignment.payload?.cohort !== "R1_PREVIEW_ONLY"
    || !Array.isArray(assignment.signature)
    || assignment.signature.length !== 64
  ) {
    throw new Error("live preview assignment is not the signed R1 release assignment");
  }

  const manifestResponse = await fetch(
    `https://er-save-api.heraklines.workers.dev/__m9_manifests/${encodeURIComponent(expectedRelease)}.json`,
    { cache: "no-store", redirect: "error" },
  );
  const manifestBytes = new Uint8Array(await manifestResponse.arrayBuffer());
  if (!manifestResponse.ok || sha256(manifestBytes) !== expectedManifestHash) {
    throw new Error("live preview manifest differs from the immutable release under test");
  }
  const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  manifestBytes.fill(0);
  const saveSchema = manifest.payload?.save_schema;
  if (!Number.isSafeInteger(saveSchema) || saveSchema < 1) {
    throw new Error("live preview manifest has no safe save schema");
  }

  const cacheNames = await page.evaluate(() => caches.keys());
  if (
    !cacheNames.includes("er-m9-release-registry-v2")
    || !cacheNames.includes(`er-m9-release-v2-${expectedRelease}`)
    || cacheNames.some(name => name.startsWith("er-m9-release-v2-") && name !== `er-m9-release-v2-${expectedRelease}`)
  ) {
    throw new Error("live preview cache is missing or mixes immutable release generations");
  }

  const saveIdentity = {
    slot: platform.default_save_slot,
    release: expectedRelease,
    namespace: platform.rust_save_namespace,
    schema: saveSchema,
  };
  if ((await readSave(authorization, saveIdentity)) != null) {
    throw new Error("fresh preview account unexpectedly contains a preexisting save");
  }

  const beforeCanvas = await page.locator("canvas").screenshot();
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  const firstSave = await waitForSave(authorization, saveIdentity, 30_000);
  await waitForWorkerIdle(activeWorkerRequests);
  const afterCanvas = await page.locator("canvas").screenshot();
  if (sha256(beforeCanvas) === sha256(afterCanvas)) {
    throw new Error("raw physical input produced no rendered canonical transition");
  }

  const readback = await readSave(authorization, saveIdentity);
  if (
    readback == null
    || readback.generation !== firstSave.generation
    || readback.revision !== firstSave.revision
    || readback.payload_sha256 !== firstSave.payload_sha256
  ) {
    throw new Error("preview save write did not read back at the same exact generation");
  }
  const transitionLease = await proveLeaseReleased(authorization, platform.default_save_slot);
  const remainingActiveMs = minimumActiveMs - (Date.now() - journeyStartedAt);
  if (remainingActiveMs > 0) {
    await page.waitForTimeout(remainingActiveMs);
  }
  lifecycleBoundary = true;
  await page.reload({ waitUntil: "load", timeout: 60_000 });
  try {
    await page.locator("canvas").waitFor({ state: "visible", timeout: 60_000 });
    await waitForPreviewHealthResource(page);
  } catch {
    const unavailable = (
      await page
        .locator('[data-production-authority="unavailable"]')
        .textContent()
        .catch(() => null)
    )?.slice(0, 256);
    const diagnostics = [...consoleErrors.slice(-3), unavailable].filter(
      value => typeof value === "string" && value.length > 0,
    );
    throw new Error(`natural preview reload failed: ${diagnostics.join(" | ") || "no bounded browser diagnostic"}`);
  }
  const restored = await readSave(authorization, saveIdentity);
  if (
    restored == null
    || restored.generation !== firstSave.generation
    || restored.revision !== firstSave.revision
    || restored.payload_sha256 !== firstSave.payload_sha256
  ) {
    throw new Error("natural preview reload did not retain the exact save frontier");
  }
  await waitForWorkerIdle(activeWorkerRequests);
  lifecycleBoundary = false;

  const performanceEvidence = await page.evaluate(() =>
    performance
      .getEntriesByType("measure")
      .filter(entry => entry.name.startsWith("er:m9:"))
      .map(entry => ({ name: entry.name, duration_ms: Math.round(entry.duration * 1_000) / 1_000 })),
  );
  const browserClass = await page.evaluate(() => navigator.userAgent);
  lifecycleBoundary = true;
  await page.close({ runBeforeUnload: true });
  const teardown = await proveLeaseReleased(authorization, platform.default_save_slot);
  await sendTerminalHealthEvent(authorization, browserSessionId, manifest.payload);

  const evidence = {
    schema_version: 1,
    journey_mode: journeyMode.toLowerCase().replace("_", "-"),
    release_id: expectedRelease,
    release_sha: manifest.payload.integration_sha,
    release_manifest_hash: expectedManifestHash,
    deployment_url: previewUrl.origin,
    preview_worker_origin: workerOrigin,
    preview_database_identity_hash: expectedDatabaseIdentity,
    preview_account: platform.pseudonymous_account_id,
    browser_session_id: browserSessionId,
    save_slot: platform.default_save_slot,
    save_generation: firstSave.generation,
    save_revision: firstSave.revision,
    save_payload_sha256: firstSave.payload_sha256,
    active_duration_ms: Date.now() - journeyStartedAt,
    minimum_active_duration_ms: minimumActiveMs,
    cold_ready_ms: coldReadyMs,
    fresh_account_bootstrap_ms: freshAccountBootstrapMs,
    browser_class: browserClass.includes("Chrome/") ? "CHROMIUM" : "UNKNOWN",
    platform_class: "DESKTOP",
    imports_disabled: true,
    signed_r1_assignment: true,
    exact_release_cache: true,
    raw_input_transition: true,
    save_write_readback: true,
    natural_reload_readback: true,
    hard_stop_failures: 0,
    teardown,
    transition_lease: transitionLease,
    lifecycle_abort_count: expectedLifecycleAborts.length,
    lifecycle_console_error_count: expectedLifecycleConsoleErrors.length,
    terminal_health_delivery: true,
    performance: performanceEvidence,
    console_error_count: consoleErrors.length,
    request_failure_count: requestFailures.length,
  };
  if (
    consoleErrors.length > 0
    || requestFailures.length > 0
    || teardown.lease_reacquired_after_close !== true
    || teardown.lease_available_after_ms > 5_000
  ) {
    throw new Error(
      `live preview journey ended with browser errors, request failures, or an active lease: ${JSON.stringify({
        console_errors: consoleErrors.slice(-3),
        request_failures: requestFailures.slice(-3),
        teardown,
      }).slice(0, 1_024)}`,
    );
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      release_id: evidence.release_id,
      journey_mode: evidence.journey_mode,
      save_generation: evidence.save_generation,
      active_duration_ms: evidence.active_duration_ms,
      cold_ready_ms: evidence.cold_ready_ms,
      evidence_sha256: sha256(Buffer.from(JSON.stringify(evidence))),
    }),
  );
} finally {
  authorization = "";
  await context.close().catch(() => undefined);
  await browser.close().catch(() => undefined);
}

async function authorizedJson(pathname, token, init = {}) {
  const response = await fetch(new URL(pathname, workerOrigin), {
    ...init,
    cache: "no-store",
    redirect: "error",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  return requiredJson(response, pathname);
}

async function requiredJson(response, label) {
  if (
    !response.ok
    || response.redirected
    || response.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  ) {
    throw new Error(`${label} failed with status ${response.status}`);
  }
  return response.json();
}

async function readBrowserSessionId(page) {
  const value = await page.evaluate(
    () =>
      new Promise((resolveValue, reject) => {
        const opening = indexedDB.open("er-m9-browser-session-v1", 1);
        opening.onerror = () => reject(opening.error ?? new Error("browser session database failed"));
        opening.onsuccess = () => {
          const transaction = opening.result.transaction("identity", "readonly");
          const request = transaction.objectStore("identity").get("current");
          request.onerror = () => reject(request.error ?? new Error("browser session identity read failed"));
          request.onsuccess = () => resolveValue(request.result ?? "");
        };
      }),
  );
  if (typeof value !== "string" || !/^browser-[0-9a-f-]{36}$/u.test(value)) {
    throw new Error("live preview browser session identity is invalid");
  }
  return value;
}

async function readSave(token, identity) {
  const url = new URL("/api/m9/rust-save", workerOrigin);
  url.searchParams.set("slot", identity.slot);
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    headers: {
      authorization: `Bearer ${token}`,
      "x-er-release": identity.release,
      "x-er-save-namespace": identity.namespace,
      "x-er-save-schema": String(identity.schema),
    },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok || response.redirected) {
    throw new Error(`preview save read failed with status ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const value = {
    generation: Number(response.headers.get("x-er-save-generation")),
    revision: response.headers.get("etag"),
    payload_sha256: sha256(bytes),
  };
  bytes.fill(0);
  if (!Number.isSafeInteger(value.generation) || value.generation < 1 || value.revision == null) {
    throw new Error("preview save readback identity is invalid");
  }
  return value;
}

async function waitForSave(token, identity, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await readSave(token, identity);
    if (value != null) {
      return value;
    }
    await new Promise(resolveValue => setTimeout(resolveValue, 250));
  } while (Date.now() < deadline);
  throw new Error("preview save was not written after the canonical transition");
}

async function proveLeaseReleased(token, slot) {
  const startedAt = Date.now();
  const deadline = Date.now() + 15_000;
  let response;
  do {
    const holder = `journey-${randomUUID()}`;
    response = await fetch(new URL("/api/m9/lease", workerOrigin), {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ schema_version: 1, slot, holder, duration_ms: 5_000 }),
    });
    if (response.status === 409) {
      await new Promise(resolveValue => setTimeout(resolveValue, 250));
      continue;
    }
    if (!response.ok || response.redirected) {
      throw new Error(`preview lease teardown probe failed with status ${response.status}`);
    }
    const acquired = await response.json();
    if (typeof acquired.lease_token !== "string" || acquired.holder !== holder || acquired.slot !== slot) {
      throw new Error("preview lease teardown probe returned an invalid identity");
    }
    const release = await fetch(new URL("/api/m9/lease", workerOrigin), {
      method: "DELETE",
      cache: "no-store",
      redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ schema_version: 1, slot, lease_token: acquired.lease_token }),
    });
    acquired.lease_token = "";
    if (release.status !== 204 || release.redirected) {
      throw new Error("preview lease teardown probe could not release its lease");
    }
    return {
      lease_reacquired_after_close: true,
      lease_released_after_probe: true,
      lease_available_after_ms: Date.now() - startedAt,
    };
  } while (Date.now() < deadline);
  throw new Error("preview save lease remained held after the storage operation settled");
}

async function waitForPreviewHealthResource(page) {
  await page.waitForFunction(
    healthUrl => performance.getEntriesByType("resource").some(entry => entry.name === healthUrl),
    `${workerOrigin}/api/m9/health/event`,
    { timeout: 30_000 },
  );
}

async function waitForWorkerIdle(activeRequests, quietMs = 1_000, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let quietStartedAt = activeRequests.size === 0 ? Date.now() : null;
  while (Date.now() < deadline) {
    if (activeRequests.size === 0) {
      quietStartedAt ??= Date.now();
      if (Date.now() - quietStartedAt >= quietMs) {
        return;
      }
    } else {
      quietStartedAt = null;
    }
    await new Promise(resolveValue => setTimeout(resolveValue, 50));
  }
  const pending = [...activeRequests].map(request => ({
    method: request.method(),
    path: new URL(request.url()).pathname,
  }));
  throw new Error(`preview Worker requests did not quiesce: ${JSON.stringify(pending).slice(0, 1_024)}`);
}

async function sendTerminalHealthEvent(token, sessionId, release) {
  const event = {
    schema_version: 1,
    release_id: release.release_id,
    kernel_generation: {
      schema_version: 1,
      session_id: sessionId,
      generation: release.release_epoch,
      artifact_sha256: release.qualification.artifact_set_sha256,
      wasm_sha256: release.artifacts.wasm.sha256,
      content_sha256: release.artifacts.content.sha256,
      source_git_sha: release.integration_sha,
      worker_abi_version: 1,
      minimum_snapshot_schema: 6,
      maximum_snapshot_schema: 6,
      content_identity: release.mechanical_identity.content_hash,
      release_id: release.release_id,
    },
    browser_class: "CHROMIUM",
    platform_class: "DESKTOP",
    event: "TERMINAL_COMPLETION",
    failure_fingerprint: null,
    performance: null,
    hard_stop_rule: null,
  };
  const response = await fetch(new URL("/api/m9/health/event", workerOrigin), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-er-health-idempotency-key": `terminal-${randomUUID()}`,
    },
    body: JSON.stringify(event),
  });
  if (response.status !== 204 || response.redirected) {
    throw new Error(`terminal health delivery failed with status ${response.status}`);
  }
}

function requiredSecret(name) {
  const value = process.env[name] ?? "";
  if (!/^[A-Za-z0-9._~-]{16,8192}$/u.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function requiredIdentifier(name) {
  const value = process.env[name] ?? "";
  if (!/^[a-zA-Z0-9._:-]{1,128}$/u.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function requiredSha256(name) {
  const value = process.env[name] ?? "";
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function requiredUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new Error("M9 preview URL must be an unauthenticated HTTPS origin");
  }
  return url;
}

function parseJourneyMode(value) {
  const normalized = value.trim().toUpperCase().replaceAll("-", "_");
  if (!["FUNCTIONAL", "COLD_START", "SOAK"].includes(normalized)) {
    throw new Error("M9 preview journey mode is invalid");
  }
  return normalized;
}

function boundedInteger(value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error("M9 preview journey duration is invalid");
  }
  return parsed;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function rounded(value) {
  return Math.round(value * 1_000) / 1_000;
}
