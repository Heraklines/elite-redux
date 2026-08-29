export enum BrowserExecutionModeV1 {
  LEGACY_TYPESCRIPT = "LEGACY_TYPESCRIPT",
  TYPESCRIPT_WITH_RUST_SHADOW = "TYPESCRIPT_WITH_RUST_SHADOW",
  RUST_LOCAL_AUTHORITY = "RUST_LOCAL_AUTHORITY",
  RUST_STAGING_AUTHORITY = "RUST_STAGING_AUTHORITY",
}

export interface BrowserRequestEnvelopeV1 {
  version: 1;
  request_id: number;
  sequence: number;
  request: { kind: string; value?: unknown };
}

export interface BrowserKernelFaultV1 {
  code: string;
  message: string;
  normalized_panic: string | null;
  repro_reference: string | null;
}

export type BrowserResponseV1 =
  | { kind: "READY"; value: { identity_bytes: number[] } }
  | { kind: "EFFECTS"; value: unknown }
  | { kind: "OBSERVATION"; value: number[] }
  | { kind: "SNAPSHOT"; value: number[] }
  | { kind: "REPRO"; value: number[] }
  | { kind: "FAULT"; value: BrowserKernelFaultV1 }
  | { kind: "DISPOSED" };

export interface BrowserResponseEnvelopeV1 {
  version: 1;
  request_id: number;
  accepted_sequence: number;
  after_mechanical_digest: string;
  response: BrowserResponseV1;
}

export const BROWSER_WORKER_PROTOCOL_VERSION_V1 = 1 as const;
