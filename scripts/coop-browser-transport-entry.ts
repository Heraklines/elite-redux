/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopRole } from "../src/data/elite-redux/coop/coop-transport";
import { GameModes } from "../src/enums/game-modes";

// CI-only transport entry. The sharded browser checkpoint needs a narrow programmatic connector to
// exercise the production WebRTC stack without the lobby. Public-UI journeys use coop-browser-entry.ts
// instead, whose bridge is deliberately read-only and cannot pair or mutate the game.
await import("../src/main");

const [{ globalScene }, { connectCoopWithCode }] = await Promise.all([
  import("../src/global-scene"),
  import("../src/data/elite-redux/coop/coop-webrtc-connect"),
]);

Object.defineProperty(globalThis, "__coopBrowserBridge", {
  configurable: false,
  enumerable: false,
  writable: false,
  value: Object.freeze({
    ready: () => globalScene?.gameData != null,
    gameModeCoop: GameModes.COOP,
    connect: (code: string, role: CoopRole, opts?: Parameters<typeof connectCoopWithCode>[2]) =>
      connectCoopWithCode(code, role, opts),
  }),
});
