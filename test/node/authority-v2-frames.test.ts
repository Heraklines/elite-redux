/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Lane 5 node-pure tests (frame context + wire codec +
// the ONE boundary validator). Engine-free: the whole import graph is
// TYPE-erased contract + three pure modules, so this runs in the node lane in
// milliseconds. The properties pinned here are the Lane-5 guarantees:
//   - every frame type round-trips encode -> decode -> validate byte-exact;
//   - every mandatory context field's absence is a protocol-violation that
//     NAMES the field (the audited defect: malformed frames used to surface as
//     unrelated timeouts because the context was never validated at the boundary);
//   - the compatibility helpers reject a wrong epoch / membership;
//   - fuzz-ish garbage (null/array/deep-nonsense/bad JSON) is ALWAYS classified,
//     never thrown - the boundary is total.
// =============================================================================

import type { CoopFrameContextV2, CoopRuntimeContext } from "#data/elite-redux/coop/authority-v2/contract";
import type { CoopFrameTypeV2, CoopFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import { COOP_FRAME_TYPES_V2, decodeFrameV2, encodeFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import {
  bindFrameContext,
  CoopFrameContextError,
  frameContextsCompatible,
  frameContextsEqual,
  isFrameContextV2,
} from "#data/elite-redux/coop/authority-v2/frame-context";
import { validateInboundFrame } from "#data/elite-redux/coop/authority-v2/protocol-validator";
import { describe, expect, it } from "vitest";

const CTX: CoopFrameContextV2 = {
  sessionId: "sess-1",
  runId: "run-1",
  sessionEpoch: 3,
  seatMapId: "seatmap-abc",
  membershipRevision: 2,
  senderSeatId: 0,
  authoritySeatId: 0,
  connectionGeneration: 1,
};

const CTX_FIELDS: readonly (keyof CoopFrameContextV2)[] = [
  "sessionId",
  "runId",
  "sessionEpoch",
  "seatMapId",
  "membershipRevision",
  "senderSeatId",
  "authoritySeatId",
  "connectionGeneration",
];

const ENTRY_BODY = {
  revision: 5,
  operationId: "op-1",
  kind: "TURN_COMMIT" as const,
  material: { digest: "digest-1", payload: { foo: 1, nested: [1, 2, 3] } },
  nextControl: { kind: "COMMAND" as const, epoch: 3, wave: 4, turn: 1, ownerSeatId: 0, pokemonId: 99 },
  subsumes: [3, 4],
};

const FRAMES: Record<CoopFrameTypeV2, CoopFrameV2> = {
  authorityEntry: { v: 2, t: "authorityEntry", ctx: CTX, body: ENTRY_BODY },
  authorityReceipt: {
    v: 2,
    t: "authorityReceipt",
    ctx: CTX,
    body: { revision: 5, operationId: "op-1", stage: "controlInstalled", controlId: "ctrl-1" },
  },
  tailRequest: { v: 2, t: "tailRequest", ctx: CTX, body: { fromRevision: 2 } },
  recoveryRequest: { v: 2, t: "recoveryRequest", ctx: CTX, body: { capturedFrontier: 10, reason: "rejoin" } },
  recoveryBundle: { v: 2, t: "recoveryBundle", ctx: CTX, body: { frontier: 12, entries: [ENTRY_BODY] } },
  terminal: { v: 2, t: "terminal", ctx: CTX, body: { terminalId: "term-1", reason: "capture-failed" } },
};

describe("authority-v2 frame codec (round-trip)", () => {
  for (const frameType of COOP_FRAME_TYPES_V2) {
    it(`encode -> decode -> validate is byte-exact for ${frameType}`, () => {
      const frame = FRAMES[frameType];
      const wire = encodeFrameV2(frame);
      expect(typeof wire).toBe("string");

      const decoded = decodeFrameV2(wire);
      expect(decoded.kind).toBe("envelope");
      if (decoded.kind === "envelope") {
        expect(decoded.frameType).toBe(frameType);
      }

      const result = validateInboundFrame(wire);
      expect(result.kind).toBe("valid");
      if (result.kind === "valid") {
        expect(result.frame).toEqual(frame);
      }
    });

    it(`validates ${frameType} delivered as an already-parsed object (loopback path)`, () => {
      const result = validateInboundFrame(FRAMES[frameType]);
      expect(result).toEqual({ kind: "valid", frame: FRAMES[frameType] });
    });
  }

  it("validates every next-control kind (incl. null)", () => {
    const controls: unknown[] = [
      null,
      { kind: "COMMAND", epoch: 3, wave: 4, turn: 1, ownerSeatId: 0, pokemonId: 7 },
      { kind: "REPLACEMENT", epoch: 3, wave: 4, turn: 1, occurrence: 0, fieldIndex: 1, ownerSeatId: 1 },
      { kind: "REWARD", operationId: "op-r", ownerSeatId: 0 },
      { kind: "BIOME", operationId: "op-b", ownerSeatId: 1 },
      { kind: "MYSTERY", operationId: "op-m", ownerSeatId: 0 },
      { kind: "TERMINAL", terminalId: "the-end" },
    ];
    for (const nextControl of controls) {
      const frame = { v: 2, t: "authorityEntry", ctx: CTX, body: { ...ENTRY_BODY, nextControl } };
      expect(validateInboundFrame(frame).kind).toBe("valid");
    }
  });

  it("accepts a receipt without the optional controlId", () => {
    const frame = {
      v: 2,
      t: "authorityReceipt",
      ctx: CTX,
      body: { revision: 1, operationId: "op", stage: "admitted" },
    };
    expect(validateInboundFrame(frame).kind).toBe("valid");
  });
});

describe("authority-v2 boundary - mandatory context", () => {
  for (const field of CTX_FIELDS) {
    it(`absent ctx.${field} => protocol-violation naming the field`, () => {
      const badCtx: Record<string, unknown> = { ...CTX };
      delete badCtx[field];
      const frame = { v: 2, t: "terminal", ctx: badCtx, body: { terminalId: "t", reason: "r" } };

      const result = validateInboundFrame(frame);
      expect(result.kind).toBe("protocol-violation");
      if (result.kind === "protocol-violation") {
        expect(result.frameType).toBe("terminal");
        expect(result.issues.some(issue => issue.includes(field))).toBe(true);
      }
    });
  }

  it("a wrong-typed ctx field (not just absent) is also named", () => {
    const frame = {
      v: 2,
      t: "tailRequest",
      ctx: { ...CTX, sessionEpoch: -1, seatMapId: "" },
      body: { fromRevision: 0 },
    };
    const result = validateInboundFrame(frame);
    expect(result.kind).toBe("protocol-violation");
    if (result.kind === "protocol-violation") {
      expect(result.issues).toEqual(expect.arrayContaining(["ctx.sessionEpoch", "ctx.seatMapId"]));
    }
  });
});

describe("authority-v2 boundary - malformed bodies", () => {
  it("names every malformed authorityEntry body field (incl. nested material + control)", () => {
    const frame = {
      v: 2,
      t: "authorityEntry",
      ctx: CTX,
      body: {
        revision: -1,
        operationId: "",
        kind: "NOT_A_KIND",
        material: {},
        nextControl: { kind: "COMMAND" },
        subsumes: "not-an-array",
      },
    };
    const result = validateInboundFrame(frame);
    expect(result.kind).toBe("protocol-violation");
    if (result.kind === "protocol-violation") {
      expect(result.frameType).toBe("authorityEntry");
      expect(result.issues).toEqual(
        expect.arrayContaining([
          "body.revision",
          "body.operationId",
          "body.kind",
          "body.material.digest",
          "body.material.payload",
          "body.subsumes",
        ]),
      );
      expect(result.issues.some(issue => issue.startsWith("body.nextControl."))).toBe(true);
    }
  });

  it("rejects an unknown next-control kind", () => {
    const frame = { v: 2, t: "authorityEntry", ctx: CTX, body: { ...ENTRY_BODY, nextControl: { kind: "WARP" } } };
    const result = validateInboundFrame(frame);
    expect(result.kind).toBe("protocol-violation");
    if (result.kind === "protocol-violation") {
      expect(result.issues).toContain("body.nextControl.kind: unknown control kind");
    }
  });

  it("names a malformed nested entry inside a recoveryBundle", () => {
    const frame = { v: 2, t: "recoveryBundle", ctx: CTX, body: { frontier: 1, entries: [{ revision: "bad" }] } };
    const result = validateInboundFrame(frame);
    expect(result.kind).toBe("protocol-violation");
    if (result.kind === "protocol-violation") {
      expect(result.issues.some(issue => issue.startsWith("body.entries[0]."))).toBe(true);
    }
  });

  it("rejects a bad ack stage", () => {
    const frame = { v: 2, t: "authorityReceipt", ctx: CTX, body: { revision: 1, operationId: "o", stage: "halfway" } };
    const result = validateInboundFrame(frame);
    expect(result.kind).toBe("protocol-violation");
    if (result.kind === "protocol-violation") {
      expect(result.issues).toContain("body.stage");
    }
  });
});

describe("authority-v2 boundary - classification", () => {
  it("an unknown frame type is a cosmetic-drop, never a violation", () => {
    const result = validateInboundFrame({ v: 2, t: "emote", ctx: CTX, body: { face: ":)" } });
    expect(result.kind).toBe("cosmetic-drop");
    if (result.kind === "cosmetic-drop") {
      expect(result.reason).toContain("emote");
    }
  });

  it("a wrong protocol version is a protocol-violation", () => {
    const frame = { v: 1, t: "terminal", ctx: CTX, body: { terminalId: "t", reason: "r" } };
    const result = validateInboundFrame(frame);
    expect(result.kind).toBe("protocol-violation");
    if (result.kind === "protocol-violation") {
      expect(result.frameType).toBeNull();
      expect(result.issues[0]).toContain("version");
    }
  });

  it("never throws and always classifies fuzz-ish malformed input", () => {
    const deepGarbage = { a: { b: { c: [{ d: Number.NaN }, null, [1, [2, [3]]]] } } };
    const garbage: unknown[] = [
      null,
      undefined,
      42,
      true,
      "not json {{{",
      "[]",
      "{}",
      "",
      [],
      [1, 2, 3],
      {},
      { v: 2 },
      { t: "authorityEntry" },
      { v: 2, t: 5, ctx: CTX, body: {} },
      { v: "2", t: "terminal", ctx: CTX, body: {} },
      { v: 2, t: "authorityEntry", ctx: CTX, body: null },
      { v: 2, t: "authorityEntry", ctx: null, body: ENTRY_BODY },
      { v: 3, t: "terminal", ctx: CTX, body: {} },
      deepGarbage,
      JSON.stringify(deepGarbage),
      JSON.stringify({ v: 2, t: "terminal", ctx: CTX, body: { terminalId: "ok", reason: "ok" } }),
    ];
    for (const raw of garbage) {
      expect(() => validateInboundFrame(raw)).not.toThrow();
      const result = validateInboundFrame(raw);
      expect(["valid", "cosmetic-drop", "protocol-violation"]).toContain(result.kind);
    }
  });
});

describe("authority-v2 frame context - equality + compatibility", () => {
  it("equal only when all eight fields match", () => {
    expect(frameContextsEqual(CTX, { ...CTX })).toBe(true);
    expect(frameContextsEqual(CTX, { ...CTX, connectionGeneration: 9 })).toBe(false);
  });

  it("compatible when only per-peer/per-connection fields differ", () => {
    const peer: CoopFrameContextV2 = { ...CTX, senderSeatId: 1, authoritySeatId: 1, connectionGeneration: 7 };
    expect(frameContextsCompatible(CTX, peer)).toBe(true);
    expect(frameContextsEqual(CTX, peer)).toBe(false);
  });

  it("incompatible on a wrong session epoch", () => {
    expect(frameContextsCompatible(CTX, { ...CTX, sessionEpoch: CTX.sessionEpoch + 1 })).toBe(false);
  });

  it("incompatible on a wrong membership revision", () => {
    expect(frameContextsCompatible(CTX, { ...CTX, membershipRevision: CTX.membershipRevision + 1 })).toBe(false);
  });

  it("incompatible across a different session / run / seat map", () => {
    expect(frameContextsCompatible(CTX, { ...CTX, sessionId: "other" })).toBe(false);
    expect(frameContextsCompatible(CTX, { ...CTX, runId: "other" })).toBe(false);
    expect(frameContextsCompatible(CTX, { ...CTX, seatMapId: "other" })).toBe(false);
  });
});

describe("authority-v2 frame context - bindFrameContext", () => {
  const runtime = {
    runtimeId: "rt-1",
    sessionId: "sess-1",
    runId: "run-1",
    epoch: 3,
    localSeatId: 1,
    authoritySeatId: 0,
    membershipRevision: 2,
  } as unknown as CoopRuntimeContext;

  it("mints a fully-formed, validated context from runtime + connection binding", () => {
    const ctx = bindFrameContext(runtime, { seatMapId: "seatmap-abc", connectionGeneration: 4 });
    expect(isFrameContextV2(ctx)).toBe(true);
    expect(ctx).toEqual({
      sessionId: "sess-1",
      runId: "run-1",
      sessionEpoch: 3,
      seatMapId: "seatmap-abc",
      membershipRevision: 2,
      senderSeatId: 1,
      authoritySeatId: 0,
      connectionGeneration: 4,
    });
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it("throws CoopFrameContextError naming the offending field on a bad connection binding", () => {
    expect(() => bindFrameContext(runtime, { seatMapId: "", connectionGeneration: 4 })).toThrow(CoopFrameContextError);
    try {
      bindFrameContext(runtime, { seatMapId: "", connectionGeneration: -1 });
    } catch (error) {
      expect(error).toBeInstanceOf(CoopFrameContextError);
      if (error instanceof CoopFrameContextError) {
        expect(error.issues).toEqual(expect.arrayContaining(["seatMapId", "connectionGeneration"]));
      }
    }
  });
});
