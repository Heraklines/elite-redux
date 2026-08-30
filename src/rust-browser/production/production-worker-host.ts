import { BrowserExecutionModeV1, type BrowserRequestV1 } from "../contracts/browser-contracts";
import { encodeCanonicalJsonV1 } from "../host/message-sequencer";
import type { BrowserKernelGenerationIdentityV1, BrowserKernelGenerationV1 } from "../hot-reload/contracts";
import { GenerationWorkerHostV1 } from "../hot-reload/generation-worker-host";
import type { ProductionAuthorityRuntimeV1, ProductionReleaseManifestV2 } from "./contracts";
import {
  type CompleteProductionReleaseV2,
  materializeVerifiedArtifactUrlV1,
  readVerifiedArtifactBytesV1,
} from "./release-cache-v2";

export interface ProductionWorkerHostOptionsV1 {
  release: CompleteProductionReleaseV2;
  sessionId: string;
  authority: ProductionAuthorityRuntimeV1;
  sessionStartBytes: Uint8Array;
}

export class ProductionWorkerHostV1 implements BrowserKernelGenerationV1 {
  readonly identity: BrowserKernelGenerationIdentityV1;
  readonly #host: GenerationWorkerHostV1;
  readonly #revokeWorker: () => void;
  #disposed = false;

  private constructor(
    identity: BrowserKernelGenerationIdentityV1,
    host: GenerationWorkerHostV1,
    revokeWorker: () => void,
  ) {
    this.identity = identity;
    this.#host = host;
    this.#revokeWorker = revokeWorker;
  }

  static async create(options: ProductionWorkerHostOptionsV1): Promise<ProductionWorkerHostV1> {
    const startedAt = performance.now();
    const manifest = options.release.manifest;
    const worker = await materializeVerifiedArtifactUrlV1(options.release, manifest.artifacts.worker_js);
    const workerUrlReadyAt = performance.now();
    const [glueBytes, wasmBytes, contentBytes] = await Promise.all([
      readVerifiedArtifactBytesV1(options.release, manifest.artifacts.wasm_glue_js),
      readVerifiedArtifactBytesV1(options.release, manifest.artifacts.wasm),
      readVerifiedArtifactBytesV1(options.release, manifest.artifacts.content),
    ]);
    const artifactsReadyAt = performance.now();
    const identity = generationIdentity(manifest, options.sessionId);
    const executionIdentityBytes = contentIdentityBytes(contentBytes);
    const initialize: BrowserRequestV1 & { kind: "INITIALIZE" } = {
      kind: "INITIALIZE",
      value: {
        mode: executionMode(options.authority),
        execution_identity_bytes: Array.from(executionIdentityBytes),
        session_start_bytes: Array.from(options.sessionStartBytes),
        maximum_pending_requests: 64,
        production_release_id: manifest.release_id,
        production_generation: identity.generation,
      },
    };
    executionIdentityBytes.fill(0);
    try {
      const host = await GenerationWorkerHostV1.create({
        identity,
        workerUrl: new URL(worker.url),
        initialize,
        configureWorker(created) {
          created.postMessage(
            {
              kind: "ATTACH_PRODUCTION_ARTIFACTS_V1",
              release_id: manifest.release_id,
              generation: identity.generation,
              glue_sha256: manifest.artifacts.wasm_glue_js.sha256,
              wasm_sha256: manifest.artifacts.wasm.sha256,
              content_sha256: manifest.artifacts.content.sha256,
              glue_bytes: glueBytes.buffer,
              wasm_bytes: wasmBytes.buffer,
              content_bytes: contentBytes.buffer,
            },
            [glueBytes.buffer, wasmBytes.buffer, contentBytes.buffer],
          );
        },
      });
      const readyAt = performance.now();
      recordBoundedMeasure("er:m9:worker-url-materialization", startedAt, workerUrlReadyAt);
      recordBoundedMeasure("er:m9:worker-artifact-read", workerUrlReadyAt, artifactsReadyAt);
      recordBoundedMeasure("er:m9:worker-initialization", artifactsReadyAt, readyAt);
      recordBoundedMeasure("er:m9:warm-worker-ready", startedAt, readyAt);
      return new ProductionWorkerHostV1(identity, host, worker.revoke);
    } catch (error) {
      worker.revoke();
      glueBytes.fill(0);
      wasmBytes.fill(0);
      contentBytes.fill(0);
      throw error;
    }
  }

  dispatch(request: Parameters<BrowserKernelGenerationV1["dispatch"]>[0]) {
    return this.#host.dispatch(request);
  }

  snapshot(): Promise<Uint8Array> {
    return this.#host.snapshot();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    try {
      await this.#host.dispose();
    } finally {
      this.#revokeWorker();
    }
  }
}

function recordBoundedMeasure(name: string, startedAt: number, endedAt: number): void {
  if (performance.getEntriesByName(name, "measure").length >= 512) {
    performance.clearMeasures(name);
  }
  performance.measure(name, { start: startedAt, end: endedAt });
}

function generationIdentity(
  manifest: ProductionReleaseManifestV2,
  sessionId: string,
): BrowserKernelGenerationIdentityV1 {
  return {
    schema_version: 1,
    session_id: sessionId,
    generation: manifest.release_epoch,
    artifact_sha256: manifest.qualification.artifact_set_sha256,
    wasm_sha256: manifest.artifacts.wasm.sha256,
    content_sha256: manifest.artifacts.content.sha256,
    source_git_sha: manifest.integration_sha,
    worker_abi_version: 1,
    minimum_snapshot_schema: 6,
    maximum_snapshot_schema: 6,
    content_identity: manifest.mechanical_identity.content_hash,
    release_id: manifest.release_id,
  };
}

function contentIdentityBytes(contentBytes: Uint8Array): Uint8Array {
  const content = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(contentBytes)) as {
    oracle_sha?: unknown;
    content_hash?: unknown;
    battle?: { content_hash?: unknown; semantic_catalog_hash?: unknown };
  };
  const identity = {
    battle_content_hash: content.battle?.content_hash,
    content_hash: content.content_hash,
    oracle_sha: content.oracle_sha,
    semantic_catalog_hash: content.battle?.semantic_catalog_hash,
  };
  if (Object.values(identity).some(value => typeof value !== "string" || value.length === 0)) {
    throw new Error("production content bundle lacks complete execution identity");
  }
  return encodeCanonicalJsonV1(identity);
}

function executionMode(authority: ProductionAuthorityRuntimeV1): BrowserExecutionModeV1 {
  if (authority === "RUST_PRODUCTION") {
    return BrowserExecutionModeV1.RUST_PRODUCTION_AUTHORITY;
  }
  if (authority === "RUST_CANARY") {
    return BrowserExecutionModeV1.RUST_CANARY_AUTHORITY;
  }
  if (authority === "RUST_SHADOW_SAMPLE") {
    return BrowserExecutionModeV1.RUST_SHADOW_SAMPLE;
  }
  throw new Error("legacy transition cannot initialize a Rust production Worker");
}
