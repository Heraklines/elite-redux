/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  formatCoopCausalTrace,
  getCoopCausalTrace,
  recordCoopCausalEvent,
  resetCoopCausalTrace,
} from "#data/elite-redux/coop/coop-causal-trace";
import { afterEach, describe, expect, it } from "vitest";

describe("co-op canonical causal trace", () => {
  afterEach(() => resetCoopCausalTrace());

  it("correlates commit, materialization, and apply by one immutable operation id", () => {
    const causalId = "42:1:REWARD:700000";
    for (const [stage, role] of [
      ["committed", "host"],
      ["materialized", "guest"],
      ["applied", "guest"],
    ] as const) {
      recordCoopCausalEvent({
        domain: "operation",
        stage,
        causalId,
        role,
        epoch: 42,
        revision: 7,
        wave: 20,
        turn: 0,
      });
    }

    const trace = getCoopCausalTrace();
    expect(trace.map(event => event.causalId)).toEqual([causalId, causalId, causalId]);
    expect(trace.map(event => event.stage)).toEqual(["committed", "materialized", "applied"]);
    expect(trace.map(event => event.sequence)).toEqual([1, 2, 3]);
    expect(formatCoopCausalTrace()).toContain(`operation:applied id=${causalId}`);
  });

  it("is bounded, ordered, immutable to callers, and refuses uncorrelatable events", () => {
    recordCoopCausalEvent({ domain: "lobby", stage: "", causalId: "missing-stage" });
    recordCoopCausalEvent({ domain: "lobby", stage: "offered", causalId: "  " });
    for (let i = 1; i <= 520; i++) {
      recordCoopCausalEvent({ domain: "recovery", stage: "edge", causalId: `event-${i}` });
    }

    const trace = getCoopCausalTrace();
    expect(trace).toHaveLength(512);
    expect(trace[0]).toMatchObject({ sequence: 9, causalId: "event-9" });
    expect(trace.at(-1)).toMatchObject({ sequence: 520, causalId: "event-520" });
    expect(formatCoopCausalTrace(2)).toContain("2/512 most-recent edges");
  });
});
