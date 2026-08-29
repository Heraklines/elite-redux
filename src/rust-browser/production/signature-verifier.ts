import { encodeCanonicalJsonV1 } from "../host/message-sequencer";
import type { ReleaseChannelV1 } from "./contracts";

export interface TrustedBrowserReleaseKeyV1 {
  key_id: string;
  public_key: number[];
  channels: ReleaseChannelV1[];
  minimum_release_epoch: number;
  revoked: boolean;
}

export async function verifyEd25519EnvelopeV1<T extends object>(options: {
  envelopeVersion: number;
  keyId: string;
  payload: T;
  signature: readonly number[];
  domain: string;
  channel: ReleaseChannelV1;
  releaseEpoch?: number;
  trustedKeys: readonly TrustedBrowserReleaseKeyV1[];
}): Promise<T> {
  if (options.envelopeVersion !== 1 || options.signature.length !== 64) {
    throw new Error("signed production envelope has an invalid shape");
  }
  const key = options.trustedKeys.find(candidate => candidate.key_id === options.keyId);
  if (
    key == null
    || key.revoked
    || key.public_key.length !== 32
    || !key.channels.includes(options.channel)
    || options.releaseEpoch != null && options.releaseEpoch < key.minimum_release_epoch
    || !boundedBytes(key.public_key)
    || !boundedBytes(options.signature)
  ) {
    throw new Error("signed production envelope key policy rejected the input");
  }
  const publicKey = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(key.public_key),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const domain = new TextEncoder().encode(`${options.domain}\0`);
  const payload = encodeCanonicalJsonV1(options.payload);
  const signed = new Uint8Array(domain.byteLength + payload.byteLength);
  signed.set(domain);
  signed.set(payload, domain.byteLength);
  try {
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      Uint8Array.from(options.signature),
      signed,
    );
    if (!valid) {
      throw new Error("signed production envelope signature is invalid");
    }
    return options.payload;
  } finally {
    payload.fill(0);
    signed.fill(0);
  }
}

export function decodeBoundedSignedJsonV1<T>(bytes: Uint8Array, maximumBytes: number): T {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new Error("signed production document is empty or oversized");
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
}

function boundedBytes(values: readonly number[]): boolean {
  return values.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 255);
}
