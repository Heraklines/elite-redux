import type { BrowserRequestV1, BrowserResponseEnvelopeV1 } from "../contracts/browser-contracts";
import { RustBrowserHost, type RustBrowserHostOptionsV1 } from "../host/rust-browser-host";
import { type CanonicalShadowProjectionV1, decodeRustShadowProjection } from "./common-projection";
import { compareShadowProjection, type ShadowComparisonV1 } from "./shadow-comparator";

export interface RustShadowObservationV1 {
  typescript: CanonicalShadowProjectionV1;
  rust: CanonicalShadowProjectionV1;
  comparison: ShadowComparisonV1;
  quarantined_effect_count: number;
}

export class RustShadowHostV1 {
  readonly #host: RustBrowserHost;
  #firstDivergence: RustShadowObservationV1 | null = null;
  #disposed = false;

  private constructor(host: RustBrowserHost) {
    this.#host = host;
  }

  static async create(options: RustBrowserHostOptionsV1): Promise<RustShadowHostV1> {
    return new RustShadowHostV1(await RustBrowserHost.create(options));
  }

  async observe(typescript: CanonicalShadowProjectionV1, request: BrowserRequestV1): Promise<RustShadowObservationV1> {
    if (this.#disposed) {
      throw new Error("Rust shadow host is disposed");
    }
    if (this.#firstDivergence != null) {
      return this.#firstDivergence;
    }
    const responses = await this.#host.dispatch(request);
    const observation = observationBytes(responses);
    const rust = decodeRustShadowProjection(
      typescript.sequence,
      typescript.boundary,
      typescript.operation_id,
      observation.bytes,
    );
    const result: RustShadowObservationV1 = {
      typescript,
      rust,
      comparison: compareShadowProjection(typescript, rust),
      quarantined_effect_count: observation.quarantinedEffects,
    };
    if (result.comparison.classification === "MECHANICAL_DIVERGENCE") {
      this.#firstDivergence = result;
    }
    return result;
  }

  firstDivergence(): RustShadowObservationV1 | null {
    return this.#firstDivergence;
  }

  async exportRustRepro(): Promise<Uint8Array> {
    return this.#host.exportRepro();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#firstDivergence = null;
    await this.#host.dispose();
  }
}

function observationBytes(responses: readonly BrowserResponseEnvelopeV1[]): {
  bytes: Uint8Array;
  quarantinedEffects: number;
} {
  let bytes: Uint8Array | null = null;
  let quarantinedEffects = 0;
  for (const envelope of responses) {
    if (envelope.response.kind === "FAULT") {
      throw new Error(`${envelope.response.value.code}: ${envelope.response.value.message}`);
    }
    if (envelope.response.kind === "OBSERVATION") {
      bytes = Uint8Array.from(envelope.response.value);
    } else if (envelope.response.kind === "EFFECTS") {
      bytes = Uint8Array.from(envelope.response.value.observation_bytes);
      quarantinedEffects += envelope.response.value.effects.length;
    }
  }
  if (bytes == null) {
    throw new Error("Rust shadow response contained no observation bytes");
  }
  return { bytes, quarantinedEffects };
}
