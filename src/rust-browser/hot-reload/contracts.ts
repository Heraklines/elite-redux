import type { BrowserRequestV1, BrowserResponseEnvelopeV1 } from "../contracts/browser-contracts";

export const BROWSER_RELOAD_PROTOCOL_VERSION_V1 = 1 as const;
export const MAXIMUM_BROWSER_RELOAD_TAIL_V1 = 4_096;
export const MAXIMUM_BROWSER_RELOAD_MANIFEST_BYTES_V1 = 65_536;

export interface BrowserKernelGenerationIdentityV1 {
  schema_version: 1;
  session_id: string;
  generation: number;
  artifact_sha256: string;
  wasm_sha256: string;
  content_sha256: string;
  source_git_sha: string;
  worker_abi_version: 1;
  minimum_snapshot_schema: number;
  maximum_snapshot_schema: number;
  content_identity: string;
  release_id: string;
}

export interface BrowserGenerationArtifactManifestV1 {
  schema_version: 1;
  identity: BrowserKernelGenerationIdentityV1;
  worker_url: string;
  wasm_url: string;
  content_url: string;
}

export type BrowserReloadPolicyV1 =
  | "EXACT_PRESERVATION"
  | "DECLARED_SEMANTIC_CHANGE"
  | "MIGRATED_COMPATIBLE"
  | "INCOMPATIBLE_REJECT";

export interface BrowserReloadPlanV1 {
  schema_version: 1;
  policy: BrowserReloadPolicyV1;
  allowed_response_kinds: string[];
  acceptance_events: number;
}

export interface BrowserReloadTailEventV1 {
  request: BrowserRequestV1;
  active_digest: string;
}

export interface BrowserReloadDecisionV1 {
  accepted: boolean;
  previous: BrowserKernelGenerationIdentityV1;
  candidate: BrowserKernelGenerationIdentityV1;
  policy: BrowserReloadPolicyV1;
  replayed_events: number;
  divergent_response_kinds: string[];
  elapsed_ms: number;
  reason: string;
}

export interface BrowserKernelGenerationV1 {
  readonly identity: BrowserKernelGenerationIdentityV1;
  dispatch(request: BrowserRequestV1): Promise<BrowserResponseEnvelopeV1[]>;
  snapshot(): Promise<Uint8Array>;
  dispose(): Promise<void>;
}

export function validateBrowserGenerationIdentityV1(identity: BrowserKernelGenerationIdentityV1): void {
  const digest = /^[0-9a-f]{64}$/u;
  if (
    identity.schema_version !== 1
    || identity.worker_abi_version !== 1
    || identity.session_id.length === 0
    || identity.session_id.length > 128
    || !Number.isSafeInteger(identity.generation)
    || identity.generation < 0
    || !digest.test(identity.artifact_sha256)
    || !digest.test(identity.wasm_sha256)
    || !digest.test(identity.content_sha256)
    || !/^[0-9a-f]{40}$/u.test(identity.source_git_sha)
    || !Number.isSafeInteger(identity.minimum_snapshot_schema)
    || identity.minimum_snapshot_schema < 1
    || identity.minimum_snapshot_schema > identity.maximum_snapshot_schema
    || identity.content_identity.length === 0
    || identity.release_id.length === 0
  ) {
    throw new Error("browser kernel generation identity is invalid");
  }
}

export function browserResponseDigestV1(responses: readonly BrowserResponseEnvelopeV1[]): string {
  return JSON.stringify(
    responses.map(response => ({
      after_mechanical_digest: response.after_mechanical_digest,
      response: response.response,
    })),
  );
}
