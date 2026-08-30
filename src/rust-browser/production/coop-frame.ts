import { encodeCanonicalJsonV1 } from "../host/message-sequencer";
import type { ReleaseChannelV1 } from "./contracts";
import { type TrustedBrowserReleaseKeyV1, verifyEd25519EnvelopeV1 } from "./signature-verifier";

const FRAME_DOMAIN_V1 = "er-m9:coop-frame-v1";
const BINDING_DOMAIN_V1 = "er-m9:coop-frame-binding-v1";
const IDENTIFIER = /^[a-zA-Z0-9._:-]{1,128}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
declare const VERIFIED_COOP_FRAME_BINDING_V1: unique symbol;
const MAXIMUM_PUBLIC_FRAME_BYTES = 1_048_576;
const FRAME_KEYS: Readonly<Record<string, true>> = {
  envelope_version: true,
  session_id: true,
  participant_id: true,
  seat_id: true,
  release_id: true,
  connection_generation: true,
  sequence: true,
  kind: true,
  payload_sha256: true,
  payload_base64url: true,
  signature_base64url: true,
};
const SIGNED_BINDING_KEYS: Readonly<Record<string, true>> = {
  envelope_version: true,
  key_id: true,
  payload: true,
  signature: true,
};
const BINDING_KEYS: Readonly<Record<string, true>> = {
  schema_version: true,
  binding_id: true,
  party_id: true,
  session_id: true,
  release_id: true,
  authority_protocol: true,
  authority_seat_id: true,
  participants: true,
  issued_at: true,
  expires_at: true,
};
const PARTICIPANT_KEYS: Readonly<Record<string, true>> = {
  participant_id: true,
  seat_id: true,
  frame_public_key: true,
  connection_generation: true,
};

export type CoopPublicFrameKindV1 = "REPLICA_PROPOSAL" | "AUTHORITY_MATERIAL";

export interface CoopFrameParticipantBindingV1 {
  participant_id: string;
  seat_id: number;
  frame_public_key: number[];
  connection_generation: number;
}

export interface CoopFrameBindingV1 {
  schema_version: 1;
  binding_id: string;
  party_id: string;
  session_id: string;
  release_id: string;
  authority_protocol: "er-coop-47";
  authority_seat_id: number;
  participants: CoopFrameParticipantBindingV1[];
  issued_at: number;
  expires_at: number;
}

export type VerifiedCoopFrameBindingV1 = CoopFrameBindingV1 & {
  readonly [VERIFIED_COOP_FRAME_BINDING_V1]: true;
};

export interface SignedCoopFrameBindingV1 {
  envelope_version: 1;
  key_id: string;
  payload: CoopFrameBindingV1;
  signature: number[];
}

export interface CoopFrameEnvelopeV1 {
  envelope_version: 1;
  session_id: string;
  participant_id: string;
  seat_id: number;
  release_id: string;
  connection_generation: number;
  sequence: number;
  kind: CoopPublicFrameKindV1;
  payload_sha256: string;
  payload_base64url: string;
  signature_base64url: string;
}

interface CoopFrameHeaderV1 {
  envelope_version: 1;
  session_id: string;
  participant_id: string;
  seat_id: number;
  release_id: string;
  connection_generation: number;
  sequence: number;
  kind: CoopPublicFrameKindV1;
  payload_sha256: string;
}

export async function verifySignedCoopFrameBindingV1(options: {
  envelope: SignedCoopFrameBindingV1;
  trustedKeys: readonly TrustedBrowserReleaseKeyV1[];
  channel: ReleaseChannelV1;
  releaseId: string;
  now?: number;
}): Promise<VerifiedCoopFrameBindingV1> {
  if (Object.keys(options.envelope).some(key => SIGNED_BINDING_KEYS[key] !== true)) {
    throw new Error("signed co-op frame binding envelope has unknown fields");
  }
  const binding = options.envelope.payload;
  validateBinding(binding, options.releaseId, options.now ?? Date.now());
  const verified = await verifyEd25519EnvelopeV1({
    envelopeVersion: options.envelope.envelope_version,
    keyId: options.envelope.key_id,
    payload: binding,
    signature: options.envelope.signature,
    domain: BINDING_DOMAIN_V1,
    channel: options.channel,
    trustedKeys: options.trustedKeys,
  });
  return verified as VerifiedCoopFrameBindingV1;
}

export function participantBindingV1(
  binding: VerifiedCoopFrameBindingV1,
  participantId: string,
): CoopFrameParticipantBindingV1 {
  const participant = binding.participants.find(value => value.participant_id === participantId);
  if (participant == null) {
    throw new Error("co-op frame participant is absent from the verified binding");
  }
  return participant;
}

export function frameKindForParticipantV1(
  binding: VerifiedCoopFrameBindingV1,
  participant: CoopFrameParticipantBindingV1,
): CoopPublicFrameKindV1 {
  return participant.seat_id === binding.authority_seat_id ? "AUTHORITY_MATERIAL" : "REPLICA_PROPOSAL";
}

export async function signCoopFrameV1(options: {
  binding: VerifiedCoopFrameBindingV1;
  participant: CoopFrameParticipantBindingV1;
  sequence: number;
  kind: CoopPublicFrameKindV1;
  payload: Uint8Array;
  privateKey: CryptoKey;
}): Promise<Uint8Array> {
  validateFrameSequence(options.sequence);
  if (
    options.payload.byteLength === 0
    || options.payload.byteLength > MAXIMUM_PUBLIC_FRAME_BYTES
    || frameKindForParticipantV1(options.binding, options.participant) !== options.kind
  ) {
    throw new Error("co-op public frame is empty, oversized, or has the wrong sender kind");
  }
  const payload = Uint8Array.from(options.payload);
  const header: CoopFrameHeaderV1 = {
    envelope_version: 1,
    session_id: options.binding.session_id,
    participant_id: options.participant.participant_id,
    seat_id: options.participant.seat_id,
    release_id: options.binding.release_id,
    connection_generation: options.participant.connection_generation,
    sequence: options.sequence,
    kind: options.kind,
    payload_sha256: await sha256Hex(payload),
  };
  const signedBytes = domainSeparatedBytes(FRAME_DOMAIN_V1, header);
  try {
    const signature = new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, options.privateKey, Uint8Array.from(signedBytes).buffer),
    );
    if (signature.byteLength !== 64) {
      throw new Error("co-op frame signer returned an invalid signature");
    }
    const envelope: CoopFrameEnvelopeV1 = {
      ...header,
      payload_base64url: encodeBase64Url(payload),
      signature_base64url: encodeBase64Url(signature),
    };
    return new TextEncoder().encode(JSON.stringify(envelope));
  } finally {
    payload.fill(0);
    signedBytes.fill(0);
  }
}

export async function verifyCoopFrameV1(options: {
  bytes: Uint8Array;
  binding: VerifiedCoopFrameBindingV1;
  participant: CoopFrameParticipantBindingV1;
  expectedSequence: number;
  expectedKind: CoopPublicFrameKindV1;
}): Promise<Uint8Array> {
  if (options.bytes.byteLength === 0 || options.bytes.byteLength > 1_500_000) {
    throw new Error("authenticated co-op frame envelope is empty or oversized");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(options.bytes));
  } catch {
    throw new Error("authenticated co-op frame envelope is malformed");
  }
  if (!isUnknownRecord(decoded) || Object.keys(decoded).some(key => FRAME_KEYS[key] !== true)) {
    throw new Error("authenticated co-op frame envelope has unknown fields");
  }
  const frame = decoded as unknown as CoopFrameEnvelopeV1;
  validateFrameSequence(frame.sequence);
  if (
    frame.envelope_version !== 1
    || frame.session_id !== options.binding.session_id
    || frame.participant_id !== options.participant.participant_id
    || frame.seat_id !== options.participant.seat_id
    || frame.release_id !== options.binding.release_id
    || frame.connection_generation !== options.participant.connection_generation
    || frame.sequence !== options.expectedSequence
    || frame.kind !== options.expectedKind
    || !SHA256.test(frame.payload_sha256)
    || typeof frame.payload_base64url !== "string"
    || !BASE64URL.test(frame.payload_base64url)
    || typeof frame.signature_base64url !== "string"
    || !BASE64URL.test(frame.signature_base64url)
  ) {
    throw new Error("authenticated co-op frame identity or sequence is invalid");
  }
  const signature = decodeCanonicalBase64Url(frame.signature_base64url, 64);
  const header: CoopFrameHeaderV1 = {
    envelope_version: frame.envelope_version,
    session_id: frame.session_id,
    participant_id: frame.participant_id,
    seat_id: frame.seat_id,
    release_id: frame.release_id,
    connection_generation: frame.connection_generation,
    sequence: frame.sequence,
    kind: frame.kind,
    payload_sha256: frame.payload_sha256,
  };
  const signedBytes = domainSeparatedBytes(FRAME_DOMAIN_V1, header);
  const publicKey = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(options.participant.frame_public_key),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  try {
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      Uint8Array.from(signature).buffer,
      Uint8Array.from(signedBytes).buffer,
    );
    if (!valid) {
      throw new Error("authenticated co-op frame signature is invalid");
    }
  } finally {
    signature.fill(0);
    signedBytes.fill(0);
  }
  const payload = decodeCanonicalBase64Url(frame.payload_base64url, MAXIMUM_PUBLIC_FRAME_BYTES);
  const digest = await sha256Hex(payload);
  if (digest !== frame.payload_sha256) {
    payload.fill(0);
    throw new Error("authenticated co-op frame payload digest is invalid");
  }
  return payload;
}

function validateBinding(binding: CoopFrameBindingV1, releaseId: string, now: number): void {
  if (
    !isUnknownRecord(binding)
    || Object.keys(binding).some(key => BINDING_KEYS[key] !== true)
    || !Array.isArray(binding.participants)
  ) {
    throw new Error("signed co-op frame binding shape is invalid");
  }
  if (
    binding.schema_version !== 1
    || !IDENTIFIER.test(binding.binding_id)
    || !IDENTIFIER.test(binding.party_id)
    || !IDENTIFIER.test(binding.session_id)
    || binding.release_id !== releaseId
    || !IDENTIFIER.test(binding.release_id)
    || binding.authority_protocol !== "er-coop-47"
    || !safeInteger(binding.authority_seat_id, 0)
    || !safeInteger(binding.issued_at, 0)
    || !safeInteger(binding.expires_at, 1)
    || binding.issued_at > now
    || now >= binding.expires_at
    || binding.participants.length < 2
    || binding.participants.length > 3
  ) {
    throw new Error("signed co-op frame binding is invalid or expired");
  }
  const participantIds = new Set<string>();
  const seats = new Set<number>();
  for (const participant of binding.participants) {
    if (!isUnknownRecord(participant) || Object.keys(participant).some(key => PARTICIPANT_KEYS[key] !== true)) {
      throw new Error("signed co-op frame participant binding shape is invalid");
    }
    if (
      !IDENTIFIER.test(participant.participant_id)
      || !safeInteger(participant.seat_id, 0)
      || !safeInteger(participant.connection_generation, 1)
      || participant.frame_public_key.length !== 32
      || participant.frame_public_key.some(value => !safeInteger(value, 0, 255))
      || participantIds.has(participant.participant_id)
      || seats.has(participant.seat_id)
    ) {
      throw new Error("signed co-op frame participant binding is invalid");
    }
    participantIds.add(participant.participant_id);
    seats.add(participant.seat_id);
  }
  if (!seats.has(binding.authority_seat_id)) {
    throw new Error("signed co-op frame binding has no authority participant");
  }
}

function domainSeparatedBytes(domain: string, value: object): Uint8Array {
  const prefix = new TextEncoder().encode(`${domain}\0`);
  const payload = encodeCanonicalJsonV1(value);
  const result = new Uint8Array(prefix.byteLength + payload.byteLength);
  result.set(prefix);
  result.set(payload, prefix.byteLength);
  payload.fill(0);
  return result;
}

function encodeBase64Url(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 32_768, bytes.byteLength))));
  }
  return btoa(chunks.join("")).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeCanonicalBase64Url(value: string, maximumBytes: number): Uint8Array {
  if (!BASE64URL.test(value)) {
    throw new Error("authenticated co-op frame base64url is invalid");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  } catch {
    throw new Error("authenticated co-op frame base64url is invalid");
  }
  if (binary.length === 0 || binary.length > maximumBytes) {
    throw new Error("authenticated co-op frame decoded bytes are empty or oversized");
  }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) {
    bytes.fill(0);
    throw new Error("authenticated co-op frame base64url is noncanonical");
  }
  return bytes;
}

function validateFrameSequence(value: number): void {
  if (!safeInteger(value, 1)) {
    throw new Error("authenticated co-op frame sequence is invalid");
  }
}

function safeInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): boolean {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
