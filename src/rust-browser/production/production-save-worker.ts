import { encodeCanonicalJsonV1 } from "../host/message-sequencer";
import type { ProductionReleaseManifestV2, ProductionSaveEnvelopeV2 } from "./contracts";
import {
  type CompleteProductionReleaseV2,
  materializeVerifiedArtifactUrlV1,
  readVerifiedArtifactBytesV1,
} from "./release-cache-v2";
import { decodeProductionSaveEnvelopeV2 } from "./save-envelope";
import type { RustProductionSaveMigrationBackendV1 } from "./save-migration";

const RESPONSE_TIMEOUT_MS = 30_000;

export class ProductionSaveMigrationWorkerV1 implements RustProductionSaveMigrationBackendV1 {
  readonly #release: CompleteProductionReleaseV2;

  constructor(release: CompleteProductionReleaseV2) {
    this.#release = release;
  }

  async migrateLegacy(options: {
    sourceBytes: Uint8Array;
    release: ProductionReleaseManifestV2;
    accountId: string;
    slot: string;
    cloudGeneration: number;
    legacyBackupReference: string;
  }): Promise<{ envelope: ProductionSaveEnvelopeV2; sessionStartBytes: Uint8Array }> {
    this.#assertRelease(options.release);
    const metadata = encodeCanonicalJsonV1({
      schema_version: 1,
      slot: options.slot,
      pseudonymous_account_id: options.accountId,
      cloud_generation: options.cloudGeneration,
      release_id: options.release.release_id,
      kernel_generation: options.release.release_epoch,
      mechanical_identity: options.release.mechanical_identity,
      save_schema: options.release.save_schema,
      legacy_backup: options.legacyBackupReference,
    });
    const output = await this.#process("MIGRATE_LEGACY", options.sourceBytes, metadata);
    metadata.fill(0);
    const decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output)) as {
      schema_version?: unknown;
      envelope_bytes?: unknown;
      session_start_bytes?: unknown;
    };
    output.fill(0);
    if (
      decoded.schema_version !== 1
      || !Array.isArray(decoded.envelope_bytes)
      || !Array.isArray(decoded.session_start_bytes)
    ) {
      throw new Error("Rust production save migration response is malformed");
    }
    const envelopeBytes = Uint8Array.from(decoded.envelope_bytes);
    const sessionStartBytes = Uint8Array.from(decoded.session_start_bytes);
    const envelope = decodeProductionSaveEnvelopeV2(envelopeBytes);
    envelopeBytes.fill(0);
    return { envelope, sessionStartBytes };
  }

  async restoreProductionSave(options: {
    envelope: ProductionSaveEnvelopeV2;
    release: ProductionReleaseManifestV2;
  }): Promise<Uint8Array> {
    this.#assertRelease(options.release);
    const envelope = new TextEncoder().encode(JSON.stringify(options.envelope));
    try {
      return await this.#process("RESTORE_RUST", envelope, new Uint8Array());
    } finally {
      envelope.fill(0);
    }
  }

  async #process(
    operation: "MIGRATE_LEGACY" | "RESTORE_RUST",
    sourceBytes: Uint8Array,
    metadataBytes: Uint8Array,
  ): Promise<Uint8Array> {
    const manifest = this.#release.manifest;
    const workerHandle = await materializeVerifiedArtifactUrlV1(this.#release, manifest.artifacts.worker_js);
    const [glue, wasm, content, template] = await Promise.all([
      readVerifiedArtifactBytesV1(this.#release, manifest.artifacts.wasm_glue_js),
      readVerifiedArtifactBytesV1(this.#release, manifest.artifacts.wasm),
      readVerifiedArtifactBytesV1(this.#release, manifest.artifacts.content),
      readVerifiedArtifactBytesV1(this.#release, manifest.artifacts.session_template),
    ]);
    const worker = new Worker(workerHandle.url, {
      type: "module",
      name: `er-save-migration-${manifest.release_epoch}`,
    });
    const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();
    const timeout = globalThis.setTimeout(
      () => reject(new Error("Rust production save migration timed out")),
      RESPONSE_TIMEOUT_MS,
    );
    worker.onmessage = event => {
      const value: unknown = event.data;
      if (value == null || typeof value !== "object" || !("kind" in value)) {
        reject(new Error("Rust production save migration returned an invalid message"));
        return;
      }
      if (value.kind === "PRODUCTION_SAVE_MIGRATION_FAULT") {
        reject(new Error("Rust production save migration failed"));
        return;
      }
      if (
        value.kind !== "PROCESSED_PRODUCTION_SAVE_V2"
        || !("release_id" in value)
        || value.release_id !== manifest.release_id
        || !("generation" in value)
        || value.generation !== manifest.release_epoch
        || !("bytes" in value)
        || !(value.bytes instanceof ArrayBuffer)
      ) {
        reject(new Error("Rust production save migration response is cross-release or malformed"));
        return;
      }
      resolve(new Uint8Array(value.bytes));
    };
    worker.onerror = event => reject(new Error(event.message || "Rust production save Worker crashed"));
    try {
      worker.postMessage(
        {
          kind: "ATTACH_PRODUCTION_ARTIFACTS_V1",
          release_id: manifest.release_id,
          generation: manifest.release_epoch,
          glue_sha256: manifest.artifacts.wasm_glue_js.sha256,
          wasm_sha256: manifest.artifacts.wasm.sha256,
          content_sha256: manifest.artifacts.content.sha256,
          glue_bytes: glue.buffer,
          wasm_bytes: wasm.buffer,
          content_bytes: content.buffer,
        },
        [glue.buffer, wasm.buffer, content.buffer],
      );
      const source = Uint8Array.from(sourceBytes);
      const metadata = Uint8Array.from(metadataBytes);
      worker.postMessage(
        {
          kind: "MIGRATE_PRODUCTION_SAVE_V2",
          operation,
          release_id: manifest.release_id,
          generation: manifest.release_epoch,
          legacy_bytes: source.buffer,
          template_bytes: template.buffer,
          metadata_bytes: metadata.buffer,
        },
        [source.buffer, template.buffer, metadata.buffer],
      );
      return await promise;
    } finally {
      globalThis.clearTimeout(timeout);
      worker.terminate();
      workerHandle.revoke();
      glue.fill(0);
      wasm.fill(0);
      content.fill(0);
      template.fill(0);
    }
  }

  #assertRelease(release: ProductionReleaseManifestV2): void {
    if (
      release.release_id !== this.#release.manifest.release_id
      || release.release_epoch !== this.#release.manifest.release_epoch
    ) {
      throw new Error("production save Worker release identity mismatch");
    }
  }
}
