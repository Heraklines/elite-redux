import type { BrowserRequestV1 } from "../contracts/browser-contracts";
import { loadBrowserGenerationArtifactsV1 } from "./artifact-loader";
import type { BrowserGenerationArtifactManifestV1 } from "./contracts";
import { type GenerationWorkerHostOptionsV1, GenerationWorkerHostV1 } from "./generation-worker-host";
import type { BrowserGenerationFactoryV1 } from "./transactional-reload";

export interface CandidateLoaderOptionsV1 {
  storage: CacheStorage;
  initialize: BrowserRequestV1 & { kind: "INITIALIZE" };
  workerFactory?: GenerationWorkerHostOptionsV1["workerFactory"];
  channelFactory?: GenerationWorkerHostOptionsV1["channelFactory"];
}

export function createBrowserGenerationFactoryV1(options: CandidateLoaderOptionsV1): BrowserGenerationFactoryV1 {
  return async (manifest: BrowserGenerationArtifactManifestV1, snapshotBytes: Uint8Array) => {
    const artifacts = await loadBrowserGenerationArtifactsV1(options.storage, manifest);
    const initialize: BrowserRequestV1 & { kind: "INITIALIZE" } = {
      kind: "INITIALIZE",
      value: {
        ...options.initialize.value,
        execution_identity_bytes: Array.from(new TextEncoder().encode(JSON.stringify(manifest.identity))),
        session_start_bytes: Array.from(snapshotBytes),
      },
    };
    return GenerationWorkerHostV1.create({
      identity: manifest.identity,
      workerUrl: artifacts.workerUrl,
      initialize,
      ...(options.workerFactory == null ? {} : { workerFactory: options.workerFactory }),
      ...(options.channelFactory == null ? {} : { channelFactory: options.channelFactory }),
    });
  };
}
