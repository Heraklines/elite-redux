import {
  BROWSER_WORKER_PROTOCOL_VERSION_V1,
  type BrowserRequestEnvelopeV1,
  type BrowserRequestV1,
  type BrowserResponseEnvelopeV1,
  isSafeBrowserInteger,
  MAXIMUM_BROWSER_BATCH_REQUESTS_V1,
  MAXIMUM_BROWSER_REQUEST_BYTES_V1,
} from "../contracts/browser-contracts";

const encoder = new TextEncoder();

function canonicalValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!isSafeBrowserInteger(value)) {
      throw new Error("browser protocol numbers must be nonnegative safe integers");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalValue(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("browser protocol value is not canonical JSON");
}

export function encodeCanonicalJsonV1(value: unknown): Uint8Array {
  return encoder.encode(canonicalValue(value));
}

export function encodeCanonicalBrowserBatch(envelopes: BrowserRequestEnvelopeV1[]): Uint8Array {
  if (envelopes.length === 0 || envelopes.length > MAXIMUM_BROWSER_BATCH_REQUESTS_V1) {
    throw new Error("browser request batch count is outside the frozen bounds");
  }
  const bytes = encodeCanonicalJsonV1(envelopes);
  if (bytes.byteLength > MAXIMUM_BROWSER_REQUEST_BYTES_V1) {
    throw new Error("browser request batch is oversized");
  }
  return bytes;
}

export class BrowserMessageSequencerV1 {
  #nextSequence = 1;
  #nextRequestId = 1;
  #lastAcceptedSequence = 0;
  #disposed = false;

  reserve(requests: readonly BrowserRequestV1[]): BrowserRequestEnvelopeV1[] {
    if (this.#disposed) {
      throw new Error("browser message sequencer is disposed");
    }
    if (requests.length === 0 || requests.length > MAXIMUM_BROWSER_BATCH_REQUESTS_V1) {
      throw new Error("browser request batch count is outside the frozen bounds");
    }
    const envelopes = requests.map(request => {
      if (!isSafeBrowserInteger(this.#nextSequence) || !isSafeBrowserInteger(this.#nextRequestId)) {
        throw new Error("browser request sequence exhausted");
      }
      const envelope: BrowserRequestEnvelopeV1 = {
        version: BROWSER_WORKER_PROTOCOL_VERSION_V1,
        request_id: this.#nextRequestId,
        sequence: this.#nextSequence,
        request: structuredClone(request),
      };
      this.#nextRequestId += 1;
      this.#nextSequence += 1;
      return envelope;
    });
    return envelopes;
  }

  rollback(envelopes: readonly BrowserRequestEnvelopeV1[]): void {
    const first = envelopes[0];
    const last = envelopes.at(-1);
    if (
      first == null
      || last == null
      || this.#nextSequence !== last.sequence + 1
      || this.#nextRequestId !== last.request_id + 1
    ) {
      throw new Error("browser request reservation cannot be rolled back after another reservation");
    }
    this.#nextSequence = first.sequence;
    this.#nextRequestId = first.request_id;
  }

  accept(expected: readonly BrowserRequestEnvelopeV1[], responses: readonly BrowserResponseEnvelopeV1[]): void {
    if (responses.length !== expected.length) {
      throw new Error("worker response count does not match the request batch");
    }
    for (let index = 0; index < expected.length; index += 1) {
      const request = expected[index];
      const response = responses[index];
      if (
        response.version !== BROWSER_WORKER_PROTOCOL_VERSION_V1
        || response.request_id !== request.request_id
        || response.accepted_sequence !== request.sequence
        || response.accepted_sequence !== this.#lastAcceptedSequence + 1
      ) {
        throw new Error("worker response sequence, version, or correlation is invalid");
      }
      this.#lastAcceptedSequence = response.accepted_sequence;
    }
  }

  dispose(): void {
    this.#disposed = true;
  }
}
