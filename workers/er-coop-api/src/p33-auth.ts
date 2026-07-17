/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export interface CoopIdentityTicketV1 {
  v: 1;
  sub: string;
  displayName: string;
  canonicalUsername: string;
  /** Unix epoch milliseconds. */
  exp: number;
  nonce: string;
}

export interface CoopPairingCredentialV1 {
  presenceId: string;
  bearer: string;
  bearerHash: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_TICKET_BYTES = 4_096;
const MAX_FUTURE_EXPIRY_MS = 15 * 60_000;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!BASE64URL.test(value)) {
    return null;
  }
  try {
    const padded = value
      .replace(/-/gu, "+")
      .replace(/_/gu, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function exactBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function safeIdentityText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && ![...value].some(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  );
}

function validPayload(value: unknown, now: number): value is CoopIdentityTicketV1 {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const payload = value as Partial<CoopIdentityTicketV1>;
  return (
    payload.v === 1
    && safeIdentityText(payload.sub, 256)
    && safeIdentityText(payload.displayName, 128)
    && safeIdentityText(payload.canonicalUsername, 128)
    && Number.isSafeInteger(payload.exp)
    && (payload.exp ?? 0) > now
    && (payload.exp ?? 0) <= now + MAX_FUTURE_EXPIRY_MS
    && typeof payload.nonce === "string"
    && payload.nonce.length >= 20
    && payload.nonce.length <= 128
    && BASE64URL.test(payload.nonce)
  );
}

/** Verify the account Worker's HMAC ticket without trusting any caller-supplied identity field. */
export async function verifyCoopIdentityTicket(
  ticket: string,
  secret: string,
  now: number = Date.now(),
): Promise<CoopIdentityTicketV1 | null> {
  if (secret.length < 32 || ticket.length === 0 || ticket.length > MAX_TICKET_BYTES) {
    return null;
  }
  const separator = ticket.indexOf(".");
  if (separator <= 0 || separator !== ticket.lastIndexOf(".")) {
    return null;
  }
  const body = ticket.slice(0, separator);
  const signature = fromBase64Url(ticket.slice(separator + 1));
  if (signature == null || signature.length !== 32 || !exactBytes(signature, await hmac(body, secret))) {
    return null;
  }
  const bodyBytes = fromBase64Url(body);
  if (bodyBytes == null) {
    return null;
  }
  try {
    const payload = JSON.parse(decoder.decode(bodyBytes)) as unknown;
    return validPayload(payload, now) ? payload : null;
  } catch {
    return null;
  }
}

export function isCoopClientNonce(value: unknown): value is string {
  return typeof value === "string" && value.length >= 20 && value.length <= 128 && BASE64URL.test(value);
}

/**
 * Deterministic under an exact ticket+client nonce so a lost announce response is safely retryable.
 * The HMAC keeps the bearer unpredictable; D1 stores only bearerHash.
 */
export async function deriveCoopPairingCredential(
  payload: CoopIdentityTicketV1,
  clientNonce: string,
  secret: string,
): Promise<CoopPairingCredentialV1 | null> {
  if (secret.length < 32 || !isCoopClientNonce(clientNonce)) {
    return null;
  }
  const presenceDigest = await sha256(`p33-presence\u0000${payload.sub}\u0000${payload.nonce}`);
  const bearerBytes = await hmac(`p33-bearer\u0000${payload.sub}\u0000${payload.nonce}\u0000${clientNonce}`, secret);
  const bearer = base64Url(bearerBytes);
  return {
    presenceId: `p33_${base64Url(presenceDigest).slice(0, 32)}`,
    bearer,
    bearerHash: base64Url(await sha256(bearer)),
  };
}

export async function hashCoopPairingBearer(bearer: string): Promise<string | null> {
  return bearer.length >= 32 && bearer.length <= 256 && BASE64URL.test(bearer) ? base64Url(await sha256(bearer)) : null;
}
