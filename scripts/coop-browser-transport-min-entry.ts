/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Optimization brief R6 tier-1: MINIMAL transport bundle. Imports ONLY the
// production connector factory (real signaling client, SDP exchange, chunker,
// keepalive, reconnection driver, Chromium WebRTC) - never src/main, never
// Phaser, never the game session. Tier-2 (the sealed full-app checkpoint)
// proves src/main wires the SAME factory; tier-3 is the public-UI lane. This
// bundle builds in seconds and its checkpoint budget is < 1 minute.
// =============================================================================

import type { CoopRole } from "../src/data/elite-redux/coop/coop-transport";
import { establishCoopTransportWithCode } from "../src/data/elite-redux/coop/coop-webrtc-connect";
import { COOP_PC_DISCONNECTED_GRACE_MS } from "../src/data/elite-redux/coop/coop-webrtc-transport";

Object.defineProperty(globalThis, "__coopTransportMinBridge", {
  configurable: false,
  enumerable: false,
  writable: false,
  value: Object.freeze({
    ready: () => true,
    peerDisconnectedGraceMs: COOP_PC_DISCONNECTED_GRACE_MS,
    establish: (code: string, role: CoopRole, opts?: Parameters<typeof establishCoopTransportWithCode>[2]) =>
      establishCoopTransportWithCode(code, role, opts),
  }),
});
