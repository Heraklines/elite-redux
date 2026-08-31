import { CloudSaveAdapterV1, type CloudSaveValueV1 } from "../adapters/cloud-save-adapter";
import { startProductionBootstrapV1 } from "./bootstrap";
import { getOrCreateBrowserGameSessionIdV1 } from "./browser-session";
import {
  RUST_PREVIEW_SAVE_NAMESPACE_V1,
  type SignedProductionManifestV1,
  type SignedRuntimeAssignmentV1,
} from "./contracts";
import type { ProductionHealthEventV1 } from "./health-event";
import { sendProductionHealthEventV1 } from "./health-reporter";
import { M9StartupJourneyRecorderV1 } from "./performance-stages";
import { loadAuthenticatedPlatformContextV1, readProductionAccountAuthorizationV1 } from "./platform-context";
import {
  bootstrapRustPreviewAccountV1,
  M9_PREVIEW_WORKER_ORIGIN_V1,
  M9_RELEASE_OBJECT_ORIGIN_V1,
  PreviewAuthorizationRequiredV1,
  persistRustPreviewAuthorizationV1,
} from "./preview-account";
import { PreviewRemoteLeaseClientV1 } from "./preview-remote-lease";
import { RustPreviewSaveStorageV1 } from "./preview-save-storage";
import { ProductionSaveRestoreWorkerV1 } from "./production-save-restore-worker";
import {
  type CompleteProductionReleaseV2,
  materializeVerifiedArtifactUrlV1,
  readVerifiedArtifactBytesV1,
} from "./release-cache-v2";
import { PINNED_PRODUCTION_RELEASE_KEYS_V1 } from "./release-keys";
import { ProductionSaveLeaseManagerV1 } from "./save-lease";
import { loadRustPreviewSaveV1 } from "./save-migration";
import { IndexedDbSessionRuntimePinStoreV1 } from "./session-pin";
import { decodeBoundedSignedJsonV1 } from "./signature-verifier";

const MAXIMUM_MANIFEST_BYTES = 131_072;
const MAXIMUM_ASSIGNMENT_BYTES = 65_536;

export async function startConfiguredProductionMainV1(): Promise<void> {
  const startup = new M9StartupJourneyRecorderV1({
    journeyId: `startup-${crypto.randomUUID()}`,
    startedAtMs: performance.now(),
  });
  const authorization = readProductionAccountAuthorizationV1();
  startup.record("AUTHENTICATION_READY", performance.now());
  const sessionId = await getOrCreateBrowserGameSessionIdV1();
  const browserInstanceId = `instance-${crypto.randomUUID()}`;
  let preparedSaveFrontier: Pick<CloudSaveValueV1, "revision" | "generation"> | null | undefined;
  const platform = await loadAuthenticatedPlatformContextV1(authorization);
  startup.record("PLATFORM_CONTEXT_READY", performance.now());
  const pinStore = new IndexedDbSessionRuntimePinStoreV1();
  const session = await startProductionBootstrapV1({
    startup,
    sessionId,
    get now() {
      return Date.now();
    },
    trustedKeys: PINNED_PRODUCTION_RELEASE_KEYS_V1,
    expectedAssignmentScopes: [
      { kind: "BROWSER_SESSION", value: { session_id: sessionId } },
      { kind: "ACCOUNT", value: { pseudonymous_account_id: platform.pseudonymous_account_id } },
    ],
    caches,
    pinStore,
    loadPin: id => pinStore.load(id),
    async loadRelease(releaseId) {
      const response = await fetch(
        `${M9_RELEASE_OBJECT_ORIGIN_V1}/__m9_manifests/${encodeURIComponent(releaseId)}.json`,
        {
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
        },
      );
      return decodeBoundedSignedJsonV1<SignedProductionManifestV1>(
        await boundedResponse(response, MAXIMUM_MANIFEST_BYTES, "application/json"),
        MAXIMUM_MANIFEST_BYTES,
      );
    },
    async requestAssignment() {
      const response = await fetch(`${M9_PREVIEW_WORKER_ORIGIN_V1}/api/m9/runtime-assignment`, {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        headers: {
          authorization: `Bearer ${authorization}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ schema_version: 1, browser_session_id: sessionId }),
      });
      return decodeBoundedSignedJsonV1<SignedRuntimeAssignmentV1>(
        await boundedResponse(response, MAXIMUM_ASSIGNMENT_BYTES, "application/json"),
        MAXIMUM_ASSIGNMENT_BYTES,
      );
    },
    async prepareSessionStart(_selection, release) {
      const cloud = new CloudSaveAdapterV1({
        endpoint: new URL("/api/m9/rust-save", M9_PREVIEW_WORKER_ORIGIN_V1),
        allowedOrigin: M9_PREVIEW_WORKER_ORIGIN_V1,
        releaseIdentity: release.manifest.release_id,
        productionSaveSchema: release.manifest.save_schema,
        requireProductionIdentity: true,
        authorization,
        saveNamespace: RUST_PREVIEW_SAVE_NAMESPACE_V1,
        kernelGeneration: release.manifest.release_epoch,
        contentIdentity: release.manifest.mechanical_identity.content_hash,
        mechanicsSha256: release.manifest.mechanical_identity.mechanics_sha256,
        activeModelIdentity: release.manifest.mechanical_identity.active_model_identity,
        previewOnly: true,
        previewDatabaseIdentity: platform.preview_database_identity_hash,
      });
      const leases = new ProductionSaveLeaseManagerV1();
      try {
        const source = await cloud.load(platform.default_save_slot);
        if (source != null && (!Number.isSafeInteger(source.generation) || Number(source.generation) < 1)) {
          throw new Error("Rust preview save source has no safe generation");
        }
        preparedSaveFrontier =
          source == null ? null : { revision: source.revision, generation: Number(source.generation) };
        if (source == null) {
          return readVerifiedArtifactBytesV1(release, release.manifest.artifacts.session_template);
        }
        const result = await loadRustPreviewSaveV1({
          cloud,
          source,
          leases,
          backend: new ProductionSaveRestoreWorkerV1(release),
          release: release.manifest,
          accountId: platform.pseudonymous_account_id,
          slot: platform.default_save_slot,
          browserInstanceId,
        });
        return result.sessionStartBytes;
      } finally {
        cloud.dispose();
        leases.dispose();
      }
    },
    async startRustView(host, _selection, release) {
      if (preparedSaveFrontier === undefined) {
        throw new Error("Rust preview save frontier was not prepared");
      }
      const cloud = new CloudSaveAdapterV1({
        endpoint: new URL("/api/m9/rust-save", M9_PREVIEW_WORKER_ORIGIN_V1),
        allowedOrigin: M9_PREVIEW_WORKER_ORIGIN_V1,
        releaseIdentity: release.manifest.release_id,
        productionSaveSchema: release.manifest.save_schema,
        requireProductionIdentity: true,
        authorization,
        saveNamespace: RUST_PREVIEW_SAVE_NAMESPACE_V1,
        kernelGeneration: release.manifest.release_epoch,
        contentIdentity: release.manifest.mechanical_identity.content_hash,
        mechanicsSha256: release.manifest.mechanical_identity.mechanics_sha256,
        activeModelIdentity: release.manifest.mechanical_identity.active_model_identity,
        previewOnly: true,
        previewDatabaseIdentity: platform.preview_database_identity_hash,
      });
      const leases = new ProductionSaveLeaseManagerV1();
      const remoteLeases = new PreviewRemoteLeaseClientV1(authorization);
      let storage: RustPreviewSaveStorageV1 | null = null;
      let entry: VerifiedBrowserEntryV1 | null = null;
      try {
        const current = await cloud.load(platform.default_save_slot);
        if (!sameSaveFrontier(preparedSaveFrontier, current)) {
          throw new Error("Rust preview save changed while the verified kernel was starting");
        }
        storage = new RustPreviewSaveStorageV1({
          cloud,
          leases,
          remoteLeases,
          release: release.manifest,
          accountId: platform.pseudonymous_account_id,
          slot: platform.default_save_slot,
          browserInstanceId,
          source: current,
        });
        entry = await loadVerifiedBrowserEntry(release);
        if (typeof entry.module.startRustProductionViewV1 !== "function") {
          throw new Error("verified Rust browser entry has no production start function");
        }
        const view = await entry.module.startRustProductionViewV1(host, storage);
        return {
          async dispose() {
            try {
              await view.dispose();
            } finally {
              storage?.dispose();
              entry?.revoke();
            }
          },
        };
      } catch (error) {
        storage?.dispose();
        if (storage == null) {
          cloud.dispose();
          leases.dispose();
          remoteLeases.dispose();
        }
        entry?.revoke();
        throw error;
      }
    },
    async startLegacyTransition() {
      throw new Error("legacy transition is unavailable in the Rust preview-only release");
    },
  });
  const startupSnapshot = startup.snapshot();
  const healthEvent: ProductionHealthEventV1 = {
    schema_version: 1,
    release_id: session.generation.release_id,
    kernel_generation: session.generation,
    browser_class: productionBrowserClass(),
    platform_class: productionPlatformClass(),
    event: "BOOTSTRAP_SUCCESS",
    failure_fingerprint: null,
    performance: {
      samples: 1,
      median_micros: Math.round(startupSnapshot.total_ms * 1_000),
      p95_micros: Math.round(startupSnapshot.total_ms * 1_000),
      p99_micros: Math.round(startupSnapshot.total_ms * 1_000),
      maximum_micros: Math.round(startupSnapshot.total_ms * 1_000),
      memory_bytes: 0,
    },
    hard_stop_rule: null,
  };
  queueMicrotask(() => {
    sendProductionHealthEventV1({
      endpoint: new URL(platform.telemetry_event_url),
      allowedOrigin: new URL(platform.telemetry_event_url).origin,
      idempotencyKey: `bootstrap-${session.generation.artifact_sha256.slice(0, 16)}-${session.generation.generation}`,
      event: healthEvent,
      authorization,
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  });
  globalThis.addEventListener(
    "pagehide",
    () => {
      session.disposePage().catch(() => undefined);
    },
    { once: true },
  );
}

function productionBrowserClass(): ProductionHealthEventV1["browser_class"] {
  const agent = navigator.userAgent;
  if (agent.includes("Firefox/")) {
    return "FIREFOX";
  }
  if (agent.includes("AppleWebKit/") && !["Chrome/", "Chromium/", "Edg/"].some(name => agent.includes(name))) {
    return "WEBKIT";
  }
  if (["Chrome/", "Chromium/", "Edg/"].some(name => agent.includes(name))) {
    return "CHROMIUM";
  }
  return "UNKNOWN";
}

function productionPlatformClass(): ProductionHealthEventV1["platform_class"] {
  const touch = navigator.maxTouchPoints > 0;
  if (touch && globalThis.innerWidth <= 767) {
    return "MOBILE";
  }
  if (touch && globalThis.innerWidth <= 1_280) {
    return "TABLET";
  }
  return "DESKTOP";
}

export function renderProductionUnavailableV1(error: unknown): void {
  const root = document.querySelector("#app") ?? document.body;
  root.replaceChildren();
  if (error instanceof PreviewAuthorizationRequiredV1) {
    const form = document.createElement("form");
    form.dataset.previewAuthorization = "required";
    const label = document.createElement("label");
    label.textContent = "Internal Rust preview invite";
    const input = document.createElement("input");
    input.type = "password";
    input.name = "preview-invite";
    input.autocomplete = "one-time-code";
    input.required = true;
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Create fresh Rust preview account";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    label.append(input);
    form.append(label, submit, status);
    form.addEventListener("submit", event => {
      event.preventDefault();
      submit.disabled = true;
      status.textContent = "Creating isolated preview account…";
      bootstrapRustPreviewAccountV1(input.value, `bootstrap-${crypto.randomUUID()}`)
        .then(account => {
          persistRustPreviewAuthorizationV1(account.session_token);
          input.value = "";
          globalThis.location.reload();
        })
        .catch(bootstrapError => {
          input.value = "";
          submit.disabled = false;
          status.textContent =
            bootstrapError instanceof Error ? bootstrapError.message : "Preview account bootstrap failed";
        });
    });
    root.append(form);
    return;
  }
  const message = document.createElement("main");
  message.setAttribute("role", "alert");
  message.dataset.productionAuthority = "unavailable";
  message.textContent =
    "The verified Rust preview release is unavailable. No game state was changed. Please try again later.";
  root.append(message);
  const detail = error instanceof Error ? `${error.name}: ${error.message.slice(0, 256)}` : "UnknownError";
  console.error("Production Rust preview authority unavailable", detail);
}

interface VerifiedBrowserEntryModuleV1 {
  startRustProductionViewV1?: (
    host: Parameters<ProductionBootstrapStartRustV1>[0],
    storage: RustPreviewSaveStorageV1,
  ) => Promise<{ dispose(): Promise<void> }>;
  startVerifiedLegacyTransitionV1?: (
    selection: Parameters<ProductionBootstrapStartLegacyV1>[0],
  ) => Promise<{ dispose(): Promise<void> }>;
}

interface VerifiedBrowserEntryV1 {
  module: VerifiedBrowserEntryModuleV1;
  revoke(): void;
}

type ProductionBootstrapStartRustV1 = Parameters<typeof startProductionBootstrapV1>[0]["startRustView"];
type ProductionBootstrapStartLegacyV1 = Parameters<typeof startProductionBootstrapV1>[0]["startLegacyTransition"];

async function loadVerifiedBrowserEntry(release: CompleteProductionReleaseV2): Promise<VerifiedBrowserEntryV1> {
  const handle = await materializeVerifiedArtifactUrlV1(release, release.manifest.artifacts.browser_js);
  try {
    const module = (await import(/* @vite-ignore */ handle.url)) as VerifiedBrowserEntryModuleV1;
    return { module, revoke: handle.revoke };
  } catch (error) {
    handle.revoke();
    throw error;
  }
}

function sameSaveFrontier(
  prepared: Pick<CloudSaveValueV1, "revision" | "generation"> | null,
  current: CloudSaveValueV1 | null,
): boolean {
  return (
    (prepared == null && current == null)
    || (prepared != null
      && current != null
      && prepared.revision === current.revision
      && prepared.generation === current.generation)
  );
}

async function boundedResponse(response: Response, maximum: number, mediaType: string): Promise<Uint8Array> {
  if (!response.ok || response.redirected) {
    throw new Error(`production bootstrap request failed: ${response.status}`);
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum || response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== mediaType) {
    throw new Error("production bootstrap response metadata is invalid");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maximum) {
    bytes.fill(0);
    throw new Error("production bootstrap response is empty or oversized");
  }
  return bytes;
}
