import type { BrowserRequestEnvelopeV1, BrowserResponseEnvelopeV1 } from "../contracts/browser-contracts";

const MAXIMUM_REQUEST_BYTES = 1_048_576;
const MAXIMUM_BATCH_REQUESTS = 256;

function postResponses(responses: BrowserResponseEnvelopeV1[]): void {
  const bytes = new TextEncoder().encode(JSON.stringify(responses));
  self.postMessage(bytes.buffer, { transfer: [bytes.buffer] });
}

function postProtocolFault(code: string, message: string): void {
  postResponses([
    {
      version: 1,
      request_id: 0,
      accepted_sequence: 0,
      after_mechanical_digest: "uninitialized-g39",
      response: {
        kind: "FAULT",
        value: {
          code,
          message,
          normalized_panic: null,
          repro_reference: null,
        },
      },
    },
  ]);
}

self.onmessage = (event: MessageEvent<unknown>) => {
  if (
    !(event.data instanceof ArrayBuffer)
    || event.data.byteLength === 0
    || event.data.byteLength > MAXIMUM_REQUEST_BYTES
  ) {
    postProtocolFault("INVALID_WORKER_MESSAGE", "worker message must be a bounded non-empty ArrayBuffer");
    return;
  }
  let requests: BrowserRequestEnvelopeV1[];
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(event.data);
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAXIMUM_BATCH_REQUESTS) {
      postProtocolFault("INVALID_REQUEST_BATCH", "worker request batch count is outside the frozen bounds");
      return;
    }
    requests = parsed as BrowserRequestEnvelopeV1[];
  } catch {
    postProtocolFault("MALFORMED_REQUEST_BYTES", "worker request bytes are not valid UTF-8 canonical JSON");
    return;
  }
  const responses: BrowserResponseEnvelopeV1[] = requests.map(request => ({
    version: 1,
    request_id: request.request_id,
    accepted_sequence: request.sequence,
    after_mechanical_digest: "uninitialized-g39",
    response: {
      kind: "FAULT",
      value: {
        code: "WORKER_NOT_INITIALIZED_G39_STUB",
        message: "browser worker runtime is not initialized before M8A",
        normalized_panic: null,
        repro_reference: null,
      },
    },
  }));
  postResponses(responses);
};
