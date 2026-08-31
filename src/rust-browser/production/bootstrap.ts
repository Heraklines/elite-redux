import type { BrowserKernelGenerationIdentityV1, BrowserKernelGenerationV1 } from "../hot-reload/contracts";
import type { ProductionAuthorityRuntimeV1, SessionRuntimePinV1 } from "./contracts";
import { ProductionWorkerHostV1 } from "./production-worker-host";
import {
  type CompleteProductionReleaseV2,
  installCompleteProductionReleaseV2,
  loadCompleteProductionReleaseV2,
  releaseProductionReleasePinV2,
  retainProductionReleasePinV2,
} from "./release-cache-v2";
import {
  type ProductionRuntimeSelectionDependenciesV1,
  selectProductionRuntimeV1,
  type VerifiedProductionRuntimeSelectionV1,
} from "./runtime-selector";
import type { SessionRuntimePinStoreV1 } from "./session-pin";

export interface ProductionBootstrapDependenciesV1 extends ProductionRuntimeSelectionDependenciesV1 {
  caches: CacheStorage;
  pinStore: SessionRuntimePinStoreV1;
  prepareSessionStart(
    selection: VerifiedProductionRuntimeSelectionV1,
    release: CompleteProductionReleaseV2,
  ): Promise<Uint8Array>;
  startRustView(
    host: BrowserKernelGenerationV1,
    selection: VerifiedProductionRuntimeSelectionV1,
    release: CompleteProductionReleaseV2,
  ): Promise<{ dispose(): Promise<void> }>;
  startLegacyTransition(
    selection: VerifiedProductionRuntimeSelectionV1,
    release: CompleteProductionReleaseV2,
  ): Promise<{ dispose(): Promise<void> }>;
}

export interface ProductionBrowserSessionV1 {
  readonly selection: VerifiedProductionRuntimeSelectionV1;
  readonly generation: BrowserKernelGenerationIdentityV1;
  disposePage(): Promise<void>;
  completeRun(): Promise<void>;
}

export async function startProductionBootstrapV1(
  dependencies: ProductionBootstrapDependenciesV1,
): Promise<ProductionBrowserSessionV1> {
  const selection = await selectProductionRuntimeV1(dependencies);
  const release = await loadOrInstallRelease(dependencies, selection);
  const authority = selection.existingPin?.authority ?? selection.assignment?.authority;
  if (authority == null) {
    throw new Error("verified production selection has no authority");
  }
  return authority === "LEGACY_TRANSITION"
    ? startLegacySession(dependencies, selection, release)
    : startRustSession(dependencies, selection, release, authority);
}

interface EnsuredPinV1 {
  pin: SessionRuntimePinV1;
  created: boolean;
}

async function loadOrInstallRelease(
  dependencies: ProductionBootstrapDependenciesV1,
  selection: VerifiedProductionRuntimeSelectionV1,
): Promise<CompleteProductionReleaseV2> {
  try {
    const release = await loadCompleteProductionReleaseV2(dependencies.caches, selection.release);
    dependencies.startup?.classify("WARM");
    dependencies.startup?.record("ARTIFACT_DOWNLOAD_READY", performance.now());
    return release;
  } catch {
    const release = await installCompleteProductionReleaseV2(dependencies.caches, selection.release);
    dependencies.startup?.classify("COLD");
    dependencies.startup?.record("ARTIFACT_DOWNLOAD_READY", performance.now());
    return release;
  }
}

async function startLegacySession(
  dependencies: ProductionBootstrapDependenciesV1,
  selection: VerifiedProductionRuntimeSelectionV1,
  release: CompleteProductionReleaseV2,
): Promise<ProductionBrowserSessionV1> {
  const { pin, created } = await ensurePin(
    dependencies,
    selection,
    legacyGenerationIdentity(selection, dependencies.sessionId),
    "LEGACY_TRANSITION",
  );
  await retainProductionReleasePinV2(dependencies.caches, selection.release.release_id, pin.session_id);
  try {
    const legacy = await dependencies.startLegacyTransition(selection, release);
    return lifecycle(selection, dependencies, legacy, pin.kernel_generation, null, true);
  } catch (error) {
    await cleanupCreatedPin(dependencies, selection, pin, created);
    throw error;
  }
}

async function startRustSession(
  dependencies: ProductionBootstrapDependenciesV1,
  selection: VerifiedProductionRuntimeSelectionV1,
  release: CompleteProductionReleaseV2,
  authority: Exclude<ProductionAuthorityRuntimeV1, "LEGACY_TRANSITION">,
): Promise<ProductionBrowserSessionV1> {
  const sessionStart = await dependencies.prepareSessionStart(selection, release);
  dependencies.startup?.record("SAVE_READY", performance.now());
  let host: ProductionWorkerHostV1 | null = null;
  let pinState: EnsuredPinV1 | null = null;
  try {
    host = await ProductionWorkerHostV1.create({
      release,
      sessionId: dependencies.sessionId,
      authority,
      sessionStartBytes: sessionStart,
      startup: dependencies.startup,
    });
    dependencies.startup?.record("SESSION_READY", performance.now());
    pinState = await ensurePin(dependencies, selection, host.identity, authority);
    await retainProductionReleasePinV2(dependencies.caches, selection.release.release_id, pinState.pin.session_id);
    const view = await dependencies.startRustView(host, selection, release);
    dependencies.startup?.record("FIRST_CONTROL_READY", performance.now());
    return lifecycle(selection, dependencies, view, pinState.pin.kernel_generation, host, true);
  } catch (error) {
    await host?.dispose().catch(() => undefined);
    if (pinState != null) {
      await cleanupCreatedPin(dependencies, selection, pinState.pin, pinState.created);
    }
    throw error;
  } finally {
    sessionStart.fill(0);
  }
}

async function ensurePin(
  dependencies: ProductionBootstrapDependenciesV1,
  selection: VerifiedProductionRuntimeSelectionV1,
  generation: BrowserKernelGenerationV1["identity"],
  authority: ProductionAuthorityRuntimeV1,
): Promise<EnsuredPinV1> {
  const pin = selection.existingPin ?? createPin(selection, generation, authority);
  const created = selection.existingPin == null;
  if (created) {
    await dependencies.pinStore.establish(pin);
  }
  return { pin, created };
}

async function cleanupCreatedPin(
  dependencies: ProductionBootstrapDependenciesV1,
  selection: VerifiedProductionRuntimeSelectionV1,
  pin: SessionRuntimePinV1,
  created: boolean,
): Promise<void> {
  if (!created) {
    return;
  }
  await dependencies.pinStore.remove(pin.session_id).catch(() => undefined);
  await releaseProductionReleasePinV2(dependencies.caches, selection.release.release_id, pin.session_id).catch(
    () => undefined,
  );
}

function createPin(
  selection: VerifiedProductionRuntimeSelectionV1,
  generation: BrowserKernelGenerationV1["identity"],
  authority: ProductionAuthorityRuntimeV1,
): SessionRuntimePinV1 {
  return {
    schema_version: 1,
    session_id: generation.session_id,
    run_id:
      selection.assignment?.sticky_scope.kind === "GAME_RUN" ? selection.assignment.sticky_scope.value.run_id : null,
    release_id: selection.release.release_id,
    kernel_generation: generation,
    mechanical_identity: selection.release.mechanical_identity,
    authority,
    created_sequence: 0,
    latest_sequence: 0,
  };
}

function legacyGenerationIdentity(
  selection: VerifiedProductionRuntimeSelectionV1,
  sessionId: string,
): BrowserKernelGenerationIdentityV1 {
  return {
    schema_version: 1,
    session_id: sessionId,
    generation: selection.release.release_epoch,
    artifact_sha256: selection.release.qualification.artifact_set_sha256,
    wasm_sha256: selection.release.artifacts.wasm.sha256,
    content_sha256: selection.release.artifacts.content.sha256,
    source_git_sha: selection.release.integration_sha,
    worker_abi_version: 1,
    minimum_snapshot_schema: 6,
    maximum_snapshot_schema: 6,
    content_identity: selection.release.mechanical_identity.content_hash,
    release_id: selection.release.release_id,
  };
}

function lifecycle(
  selection: VerifiedProductionRuntimeSelectionV1,
  dependencies: ProductionBootstrapDependenciesV1,
  view: { dispose(): Promise<void> },
  generation: BrowserKernelGenerationIdentityV1,
  host: ProductionWorkerHostV1 | null,
  hasPersistentPin: boolean,
): ProductionBrowserSessionV1 {
  let disposed = false;
  let terminal = false;
  return {
    generation,
    selection,
    async disposePage() {
      if (!disposed) {
        disposed = true;
        await view.dispose();
        await host?.dispose();
      }
    },
    async completeRun() {
      if (terminal) {
        return;
      }
      terminal = true;
      await this.disposePage();
      if (hasPersistentPin) {
        await dependencies.pinStore.remove(dependencies.sessionId);
        await releaseProductionReleasePinV2(dependencies.caches, selection.release.release_id, dependencies.sessionId);
      }
    },
  };
}
