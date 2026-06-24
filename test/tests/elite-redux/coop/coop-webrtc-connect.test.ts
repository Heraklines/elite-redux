/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op WebRTC connector (#633, P6): the STUN-default / optional-TURN ICE policy.
// This is the pure, testable core of the "won't eat your Cloudflare quota" design
// - by default it uses FREE public STUN and adds a TURN relay only when one is
// configured. The live RTCPeerConnection flow is browser-only (not harness-tested).

import { buildIceServers, COOP_DEFAULT_STUN } from "#data/elite-redux/coop/coop-webrtc-connect";
import { describe, expect, it } from "vitest";

describe("co-op WebRTC ICE config (#633, P6)", () => {
  it("defaults to FREE public STUN and NO TURN (no relay, no quota cost)", () => {
    const servers = buildIceServers();
    expect(servers).toHaveLength(1); // STUN only
    expect(servers[0].urls).toBe(COOP_DEFAULT_STUN);
    // The default STUN is Google's free reflector - no credentials, no relay.
    expect(COOP_DEFAULT_STUN.every(u => u.startsWith("stun:"))).toBe(true);
    expect(servers.some(s => s.username || s.credential)).toBe(false);
  });

  it("appends a TURN relay only when one is configured", () => {
    const servers = buildIceServers({
      turn: { urls: "turn:relay.example.com:3478", username: "u", credential: "c" },
    });
    expect(servers).toHaveLength(2); // STUN + TURN
    const turn = servers[1];
    expect(turn.urls).toBe("turn:relay.example.com:3478");
    expect(turn.username).toBe("u");
    expect(turn.credential).toBe("c");
  });

  it("a TURN entry without credentials still works (open relay)", () => {
    const servers = buildIceServers({ turn: { urls: "turn:open.example.com:3478" } });
    expect(servers).toHaveLength(2);
    expect(servers[1].username).toBeUndefined();
    expect(servers[1].credential).toBeUndefined();
  });

  it("honours custom STUN urls when supplied", () => {
    const servers = buildIceServers({ stunUrls: ["stun:my.stun:3478"] });
    expect(servers[0].urls).toEqual(["stun:my.stun:3478"]);
  });
});
