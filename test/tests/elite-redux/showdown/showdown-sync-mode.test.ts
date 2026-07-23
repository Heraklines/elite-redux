/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  assembleCoopRuntime,
  clearCoopRuntime,
  getCoopNetcodeMode,
  isShowdownGuestFlip,
  isShowdownSyncSession,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { localShowdownResult } from "#data/elite-redux/showdown/showdown-sync-command";
import { afterEach, describe, expect, it } from "vitest";

describe("Showdown Sync mode routing", () => {
  afterEach(() => clearCoopRuntime());

  it("honors the explicitly selected lockstep mode and keeps the guest world canonical", () => {
    const { guest } = createLoopbackPair();
    const runtime = assembleCoopRuntime(guest, { kind: "versus", netcodeMode: "lockstep" });

    setCoopRuntime(runtime);

    expect(runtime.controller.role).toBe("guest");
    expect(getCoopNetcodeMode()).toBe("lockstep");
    expect(isShowdownSyncSession()).toBe(true);
    expect(isShowdownGuestFlip()).toBe(false);
    expect(localShowdownResult(true)).toBe(false);
  });

  it("leaves authoritative Showdown's guest perspective flip unchanged", () => {
    const { guest } = createLoopbackPair();
    const runtime = assembleCoopRuntime(guest, { kind: "versus", netcodeMode: "authoritative" });

    setCoopRuntime(runtime);

    expect(getCoopNetcodeMode()).toBe("authoritative");
    expect(isShowdownSyncSession()).toBe(false);
    expect(isShowdownGuestFlip()).toBe(true);
    expect(localShowdownResult(true)).toBe(true);
  });
});
