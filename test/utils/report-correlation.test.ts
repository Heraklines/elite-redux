/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  COOP_REPORT_CORRELATION_MARKER,
  createCoopReportCorrelation,
  formatCoopReportCorrelation,
} from "#data/elite-redux/coop/coop-report-correlation";
import {
  ER_BUILD_IDENTITY_MARKER,
  type ErBuildIdentityV1,
  formatErBuildIdentity,
  normalizeErBuildIdentity,
} from "#utils/build-identity";
import { describe, expect, it } from "vitest";

const hostBuild: ErBuildIdentityV1 = {
  version: 1,
  id: `github:${"a".repeat(40)}:run-100.1`,
  source: "github",
  sha: "a".repeat(40),
  workflow: {
    provider: "github-actions",
    runId: "100",
    runAttempt: 1,
    workflow: "Deploy Staging",
    job: "build",
    repository: "Heraklines/elite-redux",
    ref: "feat/elite-redux-port",
  },
  deployment: null,
};

describe("report identity and pairing", () => {
  it("validates and serializes the structured build identity", () => {
    expect(normalizeErBuildIdentity(hostBuild)).toEqual(hostBuild);
    const block = formatErBuildIdentity(hostBuild);
    expect(block.startsWith(ER_BUILD_IDENTITY_MARKER)).toBe(true);
    expect(JSON.parse(block.split("\n")[1])).toEqual(hostBuild);
  });

  it("pairs swapped host/guest reports even when one peer is on a stale build", () => {
    const shared = {
      runId: "run_01K123456789ABCDEFGHJKMNPQ",
      epoch: 1700000000000,
      seed: "shared-seed",
      bindingId: "p33-binding:pair:1700000000000:seatmap",
      sessionId: "p33-session:pair:1700000000000",
      bindingSource: "resume" as const,
      authoritySeat: 0,
    };
    const host = createCoopReportCorrelation({
      ...shared,
      localRole: "host",
      localSeat: 0,
      partnerRole: "guest",
      partnerSeat: 1,
      build: hostBuild,
    });
    const staleGuestBuild: ErBuildIdentityV1 = {
      ...hostBuild,
      id: `github:${"b".repeat(40)}:run-99.1`,
      sha: "b".repeat(40),
    };
    const guest = createCoopReportCorrelation({
      ...shared,
      localRole: "guest",
      localSeat: 1,
      partnerRole: "host",
      partnerSeat: 0,
      build: staleGuestBuild,
    });

    expect(guest.pairKey).toBe(host.pairKey);
    expect(guest.local).toEqual(host.partner);
    expect(guest.partner).toEqual(host.local);
    expect(guest.build.id).not.toBe(host.build.id);
    const block = formatCoopReportCorrelation(host);
    expect(block.startsWith(COOP_REPORT_CORRELATION_MARKER)).toBe(true);
    expect(JSON.parse(block.split("\n")[1])).toEqual(host);
    expect(JSON.stringify(host)).not.toMatch(/account|bearer|credential|token/iu);
  });
});
