/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "test/tools/coop-soak-driver.ts"), "utf8");

describe("Authority V2 soak wave-boundary oracle", () => {
  it("requires the exact public handler to be active and actionable", () => {
    const waiterStart = source.indexOf("const waitForPublicModeOrPhaseExit");
    const waiterEnd = source.indexOf("const waitForBothBoundaryPhasesToExit", waiterStart);
    const waiter = source.slice(waiterStart, waiterEnd);

    expect(waiter).toContain("handler?.active === true");
    expect(waiter).toContain("handler.isCoopV2InputActionable?.() === true");
    expect(waiter).toContain("isCoopV2ControlSurfaceReady");
    expect(waiter).toContain("&& exactReady()");
    expect(waiter).not.toContain("if (state.mode === mode) {");
  });

  it("binds the digest sample to a guest-owned command proof and dominated carrier", () => {
    const proofWrite = source.indexOf("guestOwnedCommandProofs.add(point)");
    const observerStart = source.indexOf("let guestCommandOpenedExactSurface = false");
    const observerEnd = source.indexOf("markRealGuestCommandBoundary", observerStart);
    const observer = source.slice(observerStart, observerEnd);
    const boundaryStart = source.indexOf("const assertWaveBoundary");
    const boundaryEnd = source.indexOf("const assertPostTurnConverged", boundaryStart);
    const boundary = source.slice(boundaryStart, boundaryEnd);

    expect(proofWrite).toBeGreaterThan(0);
    expect(observer).toContain("mode === UiMode.COMMAND");
    expect(observer).toContain("phaseManager.getCurrentPhase() === guestCommand");
    expect(observer).toContain("guestCommandOpenedExactSurface = true");
    expect(source).toContain("guestCommandOpenedExactSurface && (pendingTick == null");
    expect(source).toContain("restoreGuestCommandModeObserver?.()");
    expect(boundary).toContain("guestOwnedCommandProofs.has(point)");
    expect(boundary).toContain("peekEnemyPartyState(wave)?.tick");
    expect(boundary).toContain("coopAppliedStateTick()");
    expect(boundary).toContain("pendingTick > carrierStatus.appliedTick");
  });

  it("settles through ordinary peer pumps before recovery and keeps persistent drift red", () => {
    const digestStart = source.indexOf("const checkDigest");
    const digestEnd = source.indexOf("const resyncHealAnalogue", digestStart);
    const digest = source.slice(digestStart, digestEnd);

    expect(digest.indexOf("await settleNaturally()")).toBeLessThan(digest.indexOf("resyncHeals++"));
    expect(digest).toContain('where === "wave-start" && classification === "unexpected"');
    expect(digest.indexOf("await recordDigestFinding(wave, where)")).toBeLessThan(digest.indexOf("await oneHeal()"));

    const boundaryStart = source.indexOf("const assertWaveBoundary");
    const boundaryEnd = source.indexOf("const assertPostTurnConverged", boundaryStart);
    const boundary = source.slice(boundaryStart, boundaryEnd);
    expect(boundary).toContain("await pumpDuoDestinations(rig, 1)");
    expect(boundary).not.toContain("applyCoopAuthoritativeBattleState");
    expect(boundary).not.toContain("applyCoopFullSnapshot");
  });
});
