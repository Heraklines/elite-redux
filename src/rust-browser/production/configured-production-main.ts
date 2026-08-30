import { CloudSaveAdapterV1 } from "../adapters/cloud-save-adapter";
import { startProductionBootstrapV1 } from "./bootstrap";
import { getOrCreateBrowserGameSessionIdV1 } from "./browser-session";
import type { SignedProductionManifestV1, SignedRuntimeAssignmentV1 } from "./contracts";
import { loadAuthenticatedPlatformContextV1 } from "./platform-context";
import { ProductionSaveMigrationWorkerV1 } from "./production-save-worker";
import {
  type CompleteProductionReleaseV2,
  materializeVerifiedArtifactUrlV1,
  readVerifiedArtifactBytesV1,
} from "./release-cache-v2";
import { PINNED_PRODUCTION_RELEASE_KEYS_V1 } from "./release-keys";
import { ProductionSaveLeaseManagerV1 } from "./save-lease";
import { loadOrMigrateProductionSaveV1 } from "./save-migration";
import { IndexedDbSessionRuntimePinStoreV1 } from "./session-pin";
import { decodeBoundedSignedJsonV1 } from "./signature-verifier";

const MAXIMUM_MANIFEST_BYTES = 131_072;
const MAXIMUM_ASSIGNMENT_BYTES = 65_536;

export async function startConfiguredProductionMainV1(): Promise<void> {
  const sessionId = await getOrCreateBrowserGameSessionIdV1();
  const platform = await loadAuthenticatedPlatformContextV1();
  const pinStore = new IndexedDbSessionRuntimePinStoreV1();
  const session = await startProductionBootstrapV1({
    sessionId,
    now: Date.now(),
    trustedKeys: PINNED_PRODUCTION_RELEASE_KEYS_V1,
    expectedAssignmentScopes: [
      { kind: "BROWSER_SESSION", value: { session_id: sessionId } },
      { kind: "ACCOUNT", value: { pseudonymous_account_id: platform.pseudonymous_account_id } },
    ],
    caches,
    pinStore,
    loadPin: id => pinStore.load(id),
    async loadRelease(releaseId) {
      const response = await fetch(`/__m9_manifests/${encodeURIComponent(releaseId)}.json`, {
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      });
      return decodeBoundedSignedJsonV1<SignedProductionManifestV1>(
        await boundedResponse(response, MAXIMUM_MANIFEST_BYTES, "application/json"),
        MAXIMUM_MANIFEST_BYTES,
      );
    },
    async requestAssignment() {
      const response = await fetch("/m9/runtime-assignment", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schema_version: 1, browser_session_id: sessionId }),
      });
      return decodeBoundedSignedJsonV1<SignedRuntimeAssignmentV1>(
        await boundedResponse(response, MAXIMUM_ASSIGNMENT_BYTES, "application/json"),
        MAXIMUM_ASSIGNMENT_BYTES,
      );
    },
    async prepareSessionStart(_selection, release) {
      const cloud = new CloudSaveAdapterV1({
        endpoint: new URL("/m9/save", globalThis.location.origin),
        allowedOrigin: globalThis.location.origin,
        releaseIdentity: release.manifest.release_id,
        productionSaveSchema: release.manifest.save_schema,
        requireProductionIdentity: true,
      });
      const leases = new ProductionSaveLeaseManagerV1();
      try {
        const source = await cloud.load(platform.default_save_slot);
        if (source == null) {
          return readVerifiedArtifactBytesV1(release, release.manifest.artifacts.session_template);
        }
        const result = await loadOrMigrateProductionSaveV1({
          cloud,
          source,
          leases,
          backend: new ProductionSaveMigrationWorkerV1(release),
          release: release.manifest,
          accountId: platform.pseudonymous_account_id,
          slot: platform.default_save_slot,
          browserInstanceId: `instance-${crypto.randomUUID()}`,
        });
        return result.sessionStartBytes;
      } finally {
        cloud.dispose();
        leases.dispose();
      }
    },
    async startRustView(host, _selection, release) {
      const entry = await loadVerifiedBrowserEntry(release);
      if (typeof entry.module.startRustProductionViewV1 !== "function") {
        entry.revoke();
        throw new Error("verified Rust browser entry has no production start function");
      }
      const view = await entry.module.startRustProductionViewV1(host);
      return {
        async dispose() {
          try {
            await view.dispose();
          } finally {
            entry.revoke();
          }
        },
      };
    },
    async startLegacyTransition(selection, release) {
      const entry = await loadVerifiedBrowserEntry(release);
      if (typeof entry.module.startVerifiedLegacyTransitionV1 !== "function") {
        entry.revoke();
        throw new Error("verified legacy browser entry has no transition start function");
      }
      const view = await entry.module.startVerifiedLegacyTransitionV1(selection);
      return {
        async dispose() {
          try {
            await view.dispose();
          } finally {
            entry.revoke();
          }
        },
      };
    },
  });
  globalThis.addEventListener(
    "pagehide",
    () => {
      session.disposePage().catch(() => undefined);
    },
    { once: true },
  );
}

export function renderProductionUnavailableV1(error: unknown): void {
  const root = document.querySelector("#app") ?? document.body;
  root.replaceChildren();
  const message = document.createElement("main");
  message.setAttribute("role", "alert");
  message.dataset.productionAuthority = "unavailable";
  message.textContent =
    "The verified Rust game release is unavailable. No game state was changed. Please try again later.";
  root.append(message);
  console.error("Production Rust authority unavailable", error instanceof Error ? error.name : "UnknownError");
}

interface VerifiedBrowserEntryModuleV1 {
  startRustProductionViewV1?: (
    host: Parameters<ProductionBootstrapStartRustV1>[0],
  ) => Promise<{ dispose(): Promise<void> }>;
  startVerifiedLegacyTransitionV1?: (
    selection: Parameters<ProductionBootstrapStartLegacyV1>[0],
  ) => Promise<{ dispose(): Promise<void> }>;
}

type ProductionBootstrapStartRustV1 = Parameters<typeof startProductionBootstrapV1>[0]["startRustView"];
type ProductionBootstrapStartLegacyV1 = Parameters<typeof startProductionBootstrapV1>[0]["startLegacyTransition"];

async function loadVerifiedBrowserEntry(
  release: CompleteProductionReleaseV2,
): Promise<{ module: VerifiedBrowserEntryModuleV1; revoke(): void }> {
  const handle = await materializeVerifiedArtifactUrlV1(release, release.manifest.artifacts.browser_js);
  try {
    const module = (await import(/* @vite-ignore */ handle.url)) as VerifiedBrowserEntryModuleV1;
    return { module, revoke: handle.revoke };
  } catch (error) {
    handle.revoke();
    throw error;
  }
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
