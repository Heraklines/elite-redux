import {
  BrowserExecutionModeV1,
  type BrowserRequestV1,
  MAXIMUM_BROWSER_EFFECT_BYTES_V1,
} from "../contracts/browser-contracts";
import {
  type CanonicalShadowProjectionV1,
  canonicalShadowJson,
  canonicalShadowValue,
  projectShadowBoundary,
} from "./common-projection";

export interface NaturalSaveShadowBootstrapInputV1 {
  operationId: string;
  typescriptSave: unknown;
  executionIdentityBytes: Uint8Array;
  rustSessionStartBytes: Uint8Array;
  maximumPendingRequests?: number;
}

export interface NaturalSaveShadowBootstrapV1 {
  normalizedTypeScriptSaveBytes: Uint8Array;
  initializeRequest: BrowserRequestV1 & { kind: "INITIALIZE" };
  saveProjection: CanonicalShadowProjectionV1;
}

export function prepareNaturalSaveShadowBootstrap(
  input: NaturalSaveShadowBootstrapInputV1,
): NaturalSaveShadowBootstrapV1 {
  if (
    input.executionIdentityBytes.byteLength === 0
    || input.rustSessionStartBytes.byteLength === 0
    || input.executionIdentityBytes.byteLength > MAXIMUM_BROWSER_EFFECT_BYTES_V1
    || input.rustSessionStartBytes.byteLength > MAXIMUM_BROWSER_EFFECT_BYTES_V1
  ) {
    throw new Error("shadow bootstrap identity or session bytes are empty or oversized");
  }
  const normalizedSave = canonicalShadowValue(input.typescriptSave);
  const normalizedTypeScriptSaveBytes = new TextEncoder().encode(canonicalShadowJson(normalizedSave));
  if (
    normalizedTypeScriptSaveBytes.byteLength === 0
    || normalizedTypeScriptSaveBytes.byteLength > MAXIMUM_BROWSER_EFFECT_BYTES_V1
  ) {
    throw new Error("natural TypeScript save is empty or oversized");
  }
  const maximumPendingRequests = Math.min(256, Math.max(1, input.maximumPendingRequests ?? 64));
  return {
    normalizedTypeScriptSaveBytes,
    initializeRequest: {
      kind: "INITIALIZE",
      value: {
        mode: BrowserExecutionModeV1.TYPESCRIPT_WITH_RUST_SHADOW,
        execution_identity_bytes: Array.from(input.executionIdentityBytes),
        session_start_bytes: Array.from(input.rustSessionStartBytes),
        maximum_pending_requests: maximumPendingRequests,
      },
    },
    saveProjection: projectShadowBoundary("TYPESCRIPT", 1, "SAVE", input.operationId, {
      canonical_save: normalizedSave,
    }),
  };
}
