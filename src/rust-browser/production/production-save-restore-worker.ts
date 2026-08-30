import type { ProductionReleaseManifestV2, ProductionSaveEnvelopeV2 } from "./contracts";
import {
  type CompleteProductionReleaseV2,
  materializeVerifiedArtifactUrlV1,
  readVerifiedArtifactBytesV1,
} from "./release-cache-v2";
import type { RustProductionSaveRestoreBackendV1 } from "./save-migration";

const RESPONSE_TIMEOUT_MS = 30_000;

export class ProductionSaveRestoreWorkerV1 implements RustProductionSaveRestoreBackendV1 {
  readonly #release: CompleteProductionReleaseV2;

  constructor(release: CompleteProductionReleaseV2) {
    this.#release = release;
  }

  async restoreProductionSave(options: {
    envelope: ProductionSaveEnvelopeV2;
    release: ProductionReleaseManifestV2;
  }): Promise<Uint8Array> {
    if (
      options.release.release_id !== this.#release.manifest.release_id
      || options.release.release_epoch !== this.#release.manifest.release_epoch
    ) {
      throw new Error("production save restore Worker release identity mismatch");
    }
    const envelope = new TextEncoder().encode(JSON.stringify(options.envelope));
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
      name: `er-save-restore-${manifest.release_epoch}`,
    });
    const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();
    const timeout = globalThis.setTimeout(
      () => reject(new Error("Rust production save restore timed out")),
      RESPONSE_TIMEOUT_MS,
    );
    worker.onmessage = event => {
      const value: unknown = event.data;
      if (value == null || typeof value !== "object" || !("kind" in value)) {
        reject(new Error("Rust production save restore returned an invalid message"));
        return;
      }
      if (value.kind === "PRODUCTION_SAVE_RESTORE_FAULT") {
        reject(new Error("Rust production save restore failed"));
        return;
      }
      if (
        value.kind !== "RESTORED_PRODUCTION_SAVE_V2"
        || !("release_id" in value)
        || value.release_id !== manifest.release_id
        || !("generation" in value)
        || value.generation !== manifest.release_epoch
        || !("bytes" in value)
        || !(value.bytes instanceof ArrayBuffer)
      ) {
        reject(new Error("Rust production save restore response is cross-release or malformed"));
        return;
      }
      resolve(new Uint8Array(value.bytes));
    };
    worker.onerror = event => reject(new Error(event.message || "Rust production save restore Worker crashed"));
    const glueMessage = Uint8Array.from(glue);
    const wasmMessage = Uint8Array.from(wasm);
    const contentMessage = Uint8Array.from(content);
    const templateMessage = Uint8Array.from(template);
    try {
      worker.postMessage(
        {
          kind: "ATTACH_PRODUCTION_ARTIFACTS_V1",
          release_id: manifest.release_id,
          generation: manifest.release_epoch,
          glue_sha256: manifest.artifacts.wasm_glue_js.sha256,
          wasm_sha256: manifest.artifacts.wasm.sha256,
          content_sha256: manifest.artifacts.content.sha256,
          glue_bytes: glueMessage.buffer,
          wasm_bytes: wasmMessage.buffer,
          content_bytes: contentMessage.buffer,
        },
        [glueMessage.buffer, wasmMessage.buffer, contentMessage.buffer],
      );
      const sourceMessage = Uint8Array.from(envelope);
      worker.postMessage(
        {
          kind: "RESTORE_PRODUCTION_SAVE_V2",
          release_id: manifest.release_id,
          generation: manifest.release_epoch,
          envelope_bytes: sourceMessage.buffer,
          template_bytes: templateMessage.buffer,
        },
        [sourceMessage.buffer, templateMessage.buffer],
      );
      return await promise;
    } finally {
      globalThis.clearTimeout(timeout);
      worker.terminate();
      workerHandle.revoke();
      envelope.fill(0);
      glue.fill(0);
      wasm.fill(0);
      content.fill(0);
      template.fill(0);
    }
  }
}
