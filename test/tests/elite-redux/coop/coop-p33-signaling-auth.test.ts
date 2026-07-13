/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveCoopPairingCredential,
  hashCoopPairingBearer,
  verifyCoopIdentityTicket,
} from "../../../../workers/er-coop-api/src/p33-auth";

const secret = "shared-coop-identity-secret-at-least-32-bytes";

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function ticket(
  overrides: Partial<{
    v: number;
    sub: string;
    displayName: string;
    canonicalUsername: string;
    exp: number;
    nonce: string;
  }> = {},
): Promise<string> {
  const payload = {
    v: 1,
    sub: "er-account:17",
    displayName: "Alice",
    canonicalUsername: "alice",
    exp: 70_000,
    nonce: "AQIDBAUGBwgJCgsMDQ4PEA",
    ...overrides,
  };
  const body = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${base64Url(new Uint8Array(signature))}`;
}

describe("P33 authenticated signaling credentials", () => {
  beforeEach(() => vi.stubGlobal("crypto", webcrypto));
  afterEach(() => vi.unstubAllGlobals());

  it("accepts the exact signed immutable identity and rejects tamper, expiry, and wrong secrets", async () => {
    const signed = await ticket();
    await expect(verifyCoopIdentityTicket(signed, secret, 10_000)).resolves.toEqual({
      v: 1,
      sub: "er-account:17",
      displayName: "Alice",
      canonicalUsername: "alice",
      exp: 70_000,
      nonce: "AQIDBAUGBwgJCgsMDQ4PEA",
    });
    const [body, signature] = signed.split(".");
    const tamperedBody = base64Url(
      new TextEncoder().encode(
        JSON.stringify({
          v: 1,
          sub: "er-account:18",
          displayName: "Alice",
          canonicalUsername: "alice",
          exp: 70_000,
          nonce: "AQIDBAUGBwgJCgsMDQ4PEA",
        }),
      ),
    );
    await expect(verifyCoopIdentityTicket(`${tamperedBody}.${signature}`, secret, 10_000)).resolves.toBeNull();
    await expect(verifyCoopIdentityTicket(signed, secret, 70_000)).resolves.toBeNull();
    await expect(verifyCoopIdentityTicket(signed, `${secret}-wrong`, 10_000)).resolves.toBeNull();
    await expect(verifyCoopIdentityTicket(`${body}.${signature}.extra`, secret, 10_000)).resolves.toBeNull();
  });

  it("derives an idempotent unpredictable bearer while binding one client nonce", async () => {
    const payload = (await verifyCoopIdentityTicket(await ticket(), secret, 10_000))!;
    const first = await deriveCoopPairingCredential(payload, "clientNonce_1234567890", secret);
    const retry = await deriveCoopPairingCredential(payload, "clientNonce_1234567890", secret);
    const otherClient = await deriveCoopPairingCredential(payload, "clientNonce_0987654321", secret);
    expect(first).toEqual(retry);
    expect(first?.presenceId).toMatch(/^p33_[A-Za-z0-9_-]{32}$/u);
    expect(first?.bearer).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first?.bearerHash).toBe(await hashCoopPairingBearer(first!.bearer));
    expect(otherClient?.presenceId).toBe(first?.presenceId);
    expect(otherClient?.bearer).not.toBe(first?.bearer);
    expect(await deriveCoopPairingCredential(payload, "short", secret)).toBeNull();
  });

  it("keeps the opaque account ID exact across mutable display-name/case changes", async () => {
    const renamed = await ticket({ displayName: "ALICE RENAMED", canonicalUsername: "alice renamed" });
    const payload = await verifyCoopIdentityTicket(renamed, secret, 10_000);
    expect(payload?.sub).toBe("er-account:17");
    expect(payload?.displayName).toBe("ALICE RENAMED");
  });
});
