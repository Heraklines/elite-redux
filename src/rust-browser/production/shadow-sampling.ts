import type { ShadowSamplingPolicyV1 } from "./health-event";
import { productionCohortBucketV1 } from "./rollout";

export class ProductionShadowSamplerV1 {
  readonly #policy: ShadowSamplingPolicyV1;
  #events = 0;

  constructor(policy: ShadowSamplingPolicyV1) {
    if (
      policy.schema_version !== 1
      || policy.percentage_basis_points < 0
      || policy.percentage_basis_points > 10_000
      || policy.maximum_events < 1
      || policy.maximum_events > 10_000
      || policy.maximum_cpu_overhead_percent > 25
    ) {
      throw new Error("production shadow sampling policy is invalid");
    }
    this.#policy = policy;
  }

  async eligible(ring: string, stickyIdentity: string): Promise<boolean> {
    return (
      this.#policy.eligible_rings.includes(ring)
      && (await productionCohortBucketV1("shadow-sample-v1", stickyIdentity)) < this.#policy.percentage_basis_points
    );
  }

  compare(sample: {
    reference_digest: string;
    canonical_rust_digest: string;
    authoritative_elapsed_micros: number;
    shadow_elapsed_micros: number;
    side_effects: number;
  }): void {
    if (this.#events >= this.#policy.maximum_events) {
      throw new Error("production shadow event budget exceeded");
    }
    if (
      !/^[0-9a-f]{64}$/u.test(sample.reference_digest)
      || !/^[0-9a-f]{64}$/u.test(sample.canonical_rust_digest)
      || !Number.isSafeInteger(sample.authoritative_elapsed_micros)
      || sample.authoritative_elapsed_micros < 1
      || !Number.isSafeInteger(sample.shadow_elapsed_micros)
      || sample.shadow_elapsed_micros < 0
      || !Number.isSafeInteger(sample.side_effects)
      || sample.side_effects < 0
    ) {
      throw new Error("production shadow sample is invalid");
    }
    if (sample.side_effects !== 0) {
      throw new Error("SHADOW_SIDE_EFFECT");
    }
    const overheadPercent = Math.max(
      0,
      Math.ceil(
        ((sample.shadow_elapsed_micros - sample.authoritative_elapsed_micros) / sample.authoritative_elapsed_micros)
          * 100,
      ),
    );
    if (overheadPercent > this.#policy.maximum_cpu_overhead_percent) {
      throw new Error("production shadow CPU budget exceeded");
    }
    this.#events += 1;
    if (sample.reference_digest !== sample.canonical_rust_digest) {
      throw new Error("MECHANICAL_DIVERGENCE");
    }
  }

  get consumedEvents(): number {
    return this.#events;
  }
}
