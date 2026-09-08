import { expect, it } from "vitest";
import {
  decodeBrowserResponseEnvelopeV2,
  encodeBrowserRequestEnvelopeV2,
  encodeCanonicalJsonV2,
} from "../../../../src/rust-browser/contracts/browser-contracts-v2";

it("current V2 canonical payload preserves signed state values", () => {
  // Actual Rust payload field/value families; this is a transport codec test,
  // not a fabricated active snapshot claimed to pass kernel restoration.
  const payload = { stat_stages: { speed: -6, attack: -1, defense: 0, special_attack: 6,
    special_defense: 0, accuracy: -2, evasion: 1 }, standing: { rival: -12 },
    signed: Number.MIN_SAFE_INTEGER, text: "quoted \"\\\n", empty: null };
  const encoded = new TextDecoder().decode(encodeCanonicalJsonV2(payload));
  expect(JSON.parse(encoded)).toEqual(payload);
  expect(encoded).toBe(JSON.stringify({ empty: null, signed: Number.MIN_SAFE_INTEGER, standing: { rival: -12 },
    stat_stages: { accuracy: -2, attack: -1, defense: 0, evasion: 1, special_attack: 6,
      special_defense: 0, speed: -6 }, text: payload.text }));
});

it("current V2 canonical payload rejects ambiguous numeric values", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.5,
    Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
    expect(() => encodeCanonicalJsonV2({ stat_stages: { attack: value } })).toThrow("signed safe integers");
  }
  expect(() => encodeCanonicalJsonV2({ value: undefined })).toThrow("not canonical JSON");
  expect(() => encodeCanonicalJsonV2(Array(2))).toThrow("not canonical JSON");
  for (const literal of ["9007199254740993", "-9007199254740993", "0.5", "1e999"]) {
    const bytes = new TextEncoder().encode('{"version":2,"request_id":1,"accepted_sequence":0,'
      + '"response":{"kind":"SNAPSHOT","snapshot":{"schema_version":7,"nested":{"signed":'
      + literal + '}}}}');
    expect(() => decodeBrowserResponseEnvelopeV2(bytes.buffer)).toThrow("signed safe integers");
  }
  const signed = new TextEncoder().encode('{"version":2,"request_id":1,"accepted_sequence":0,'
    + '"response":{"kind":"SNAPSHOT","snapshot":{"schema_version":7,"nested":{"signed":-6}}}}');
  expect(decodeBrowserResponseEnvelopeV2(signed.buffer).response).toEqual({ kind: "SNAPSHOT",
    snapshot: { schema_version: 7, nested: { signed: -6 } } });
});

it("current V2 envelope keeps correlation IDs nonnegative", () => {
  for (const [request_id, sequence] of [[-1, 0], [0, -1], [Number.MAX_SAFE_INTEGER + 1, 0]]) {
    expect(() => encodeBrowserRequestEnvelopeV2({ version: 2, request_id, sequence,
      request: { kind: "SNAPSHOT" } })).toThrow("nonnegative correlation");
  }
  expect(JSON.parse(new TextDecoder().decode(encodeBrowserRequestEnvelopeV2({ version: 2,
    request_id: 1, sequence: 0, request: { kind: "ADVANCE_TIME", milliseconds: 1 } })))).toEqual({
    version: 2, request_id: 1, sequence: 0, request: { kind: "ADVANCE_TIME", milliseconds: 1 },
  });
});

it("current V2 rebind codec preserves typed controls and exact output bytes", () => {
  for (const control of [{ kind: "BEGIN" }, { kind: "RETRY" },
    { kind: "RECEIVE", generation: 2, bytes: [0, 1, 127, 255] }] as const) {
    const encoded = encodeBrowserRequestEnvelopeV2({ version: 2, request_id: 2, sequence: 1,
      request: { kind: "COOP_REBIND", control: structuredClone(control) as any } });
    expect(JSON.parse(new TextDecoder().decode(encoded)).request).toEqual({ kind: "COOP_REBIND", control });
  }
  for (const frames of [[], [[0, 1, 127, 255]]]) {
    const response = { version: 2, request_id: 2, accepted_sequence: 1, response: { kind: "REBIND",
      output: { generation: 2, frames }, observation: { kernel_version: 7, control: null } } };
    expect(decodeBrowserResponseEnvelopeV2(encodeCanonicalJsonV2(response).buffer as ArrayBuffer)).toEqual(response);
  }
});

it("current V2 rebind codec rejects malformed generation frames and observation", () => {
  const valid = { version: 2, request_id: 2, accepted_sequence: 1, response: { kind: "REBIND",
    output: { generation: 2, frames: [[0, 255]] }, observation: { kernel_version: 7 } } };
  for (const output of [null, { generation: 0, frames: [] }, { generation: -1, frames: [] },
    { generation: 2, frames: null }, { generation: 2, frames: [[]] },
    { generation: 2, frames: [[256]] }, { generation: 2, frames: [[-1]] },
    { generation: 2, frames: [new Array(16 * 1024 + 1).fill(0)] }]) {
    const value = { ...valid, response: { ...valid.response, output } };
    expect(() => decodeBrowserResponseEnvelopeV2(encodeCanonicalJsonV2(value).buffer as ArrayBuffer))
      .toThrow("rebind result is invalid");
  }
  for (const observation of [null, [], { kernel_version: 6 }]) {
    const value = { ...valid, response: { ...valid.response, observation } };
    expect(() => decodeBrowserResponseEnvelopeV2(encodeCanonicalJsonV2(value).buffer as ArrayBuffer))
      .toThrow("rebind result is invalid");
  }
});
