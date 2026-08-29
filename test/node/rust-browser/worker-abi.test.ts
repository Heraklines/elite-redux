import { describe, expect, it } from "vitest";
import {
  BrowserExecutionModeV1,
  type BrowserResponseEnvelopeV1,
} from "../../../src/rust-browser/contracts/browser-contracts";
import {
  BrowserMessageSequencerV1,
  encodeCanonicalBrowserBatch,
} from "../../../src/rust-browser/host/message-sequencer";

describe("Rust browser worker ABI", () => {
  it("allocates exact monotonic request and sequence identities", () => {
    const sequencer = new BrowserMessageSequencerV1();
    const envelopes = sequencer.reserve([{ kind: "OBSERVE", value: { profile: "test" } }, { kind: "SNAPSHOT" }]);
    expect(envelopes.map(value => [value.request_id, value.sequence])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    const responses: BrowserResponseEnvelopeV1[] = envelopes.map(value => ({
      version: 1,
      request_id: value.request_id,
      accepted_sequence: value.sequence,
      after_mechanical_digest: `digest-${value.sequence}`,
      response: { kind: "OBSERVATION", value: [] },
    }));
    expect(() => sequencer.accept(envelopes, responses)).not.toThrow();
  });

  it("canonicalizes object keys without changing ordered batches", () => {
    const sequencer = new BrowserMessageSequencerV1();
    const envelopes = sequencer.reserve([
      {
        kind: "INITIALIZE",
        value: {
          mode: BrowserExecutionModeV1.RUST_LOCAL_AUTHORITY,
          execution_identity_bytes: [2, 1],
          session_start_bytes: [4, 3],
          maximum_pending_requests: 8,
        },
      },
    ]);
    const first = encodeCanonicalBrowserBatch(envelopes);
    const second = encodeCanonicalBrowserBatch(envelopes);
    expect(first).toEqual(second);
    expect(new TextDecoder().decode(first)).toBe(
      '[{"request":{"kind":"INITIALIZE","value":{"execution_identity_bytes":[2,1],"maximum_pending_requests":8,"mode":"RUST_LOCAL_AUTHORITY","session_start_bytes":[4,3]}},"request_id":1,"sequence":1,"version":1}]',
    );
  });

  it("rejects response count, correlation, and accepted-sequence drift", () => {
    const sequencer = new BrowserMessageSequencerV1();
    const [request] = sequencer.reserve([{ kind: "SNAPSHOT" }]);
    expect(() => sequencer.accept([request], [])).toThrow(/count/u);
    expect(() =>
      sequencer.accept(
        [request],
        [
          {
            version: 1,
            request_id: 2,
            accepted_sequence: 1,
            after_mechanical_digest: "digest",
            response: { kind: "SNAPSHOT", value: [] },
          },
        ],
      ),
    ).toThrow(/correlation/u);
  });

  it("rejects unsafe numeric payloads and oversized batches before transfer", () => {
    const sequencer = new BrowserMessageSequencerV1();
    const [request] = sequencer.reserve([{ kind: "ADVANCE_TIME", value: 1 }]);
    const unsafe = structuredClone(request);
    if (unsafe.request.kind === "ADVANCE_TIME") {
      unsafe.request.value = Number.MAX_SAFE_INTEGER + 1;
    }
    expect(() => encodeCanonicalBrowserBatch([unsafe])).toThrow(/safe integers/u);
    expect(() => encodeCanonicalBrowserBatch(Array.from({ length: 257 }, () => request))).toThrow(/count/u);
  });
});
