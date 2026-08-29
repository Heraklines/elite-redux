import { describe, expect, it } from "vitest";
import { projectShadowBoundary } from "../../../src/rust-browser/shadow/common-projection";
import { compareShadowProjection } from "../../../src/rust-browser/shadow/shadow-comparator";

const ITERATIONS = 1_000;
const MECHANICS_OPERATIONS_PER_BOUNDARY = 32_768;

function gameplayWork(sequence: number): {
  checksum: number;
  payload: { mechanical_state: { hp: number; turn: number } };
} {
  let checksum = sequence;
  for (let index = 0; index < MECHANICS_OPERATIONS_PER_BOUNDARY; index += 1) {
    checksum = (Math.imul(checksum ^ index, 1_664_525) + 1_013_904_223) >>> 0;
  }
  return { checksum, payload: { mechanical_state: { hp: checksum % 300, turn: sequence } } };
}

function baseline(): number {
  let checksum = 0;
  for (let sequence = 1; sequence <= ITERATIONS; sequence += 1) {
    const work = gameplayWork(sequence);
    checksum ^= work.checksum;
    JSON.stringify(work.payload);
  }
  return checksum;
}

function withShadow(): number {
  let checksum = 0;
  for (let sequence = 1; sequence <= ITERATIONS; sequence += 1) {
    const work = gameplayWork(sequence);
    checksum ^= work.checksum;
    const typescript = projectShadowBoundary("TYPESCRIPT", sequence, "TURN", `turn/${sequence}`, work.payload);
    const rust = projectShadowBoundary("RUST", sequence, "TURN", `turn/${sequence}`, work.payload);
    if (compareShadowProjection(typescript, rust).classification !== "EQUAL") {
      throw new Error("shadow benchmark diverged");
    }
  }
  return checksum;
}

function timed(work: () => number): { elapsed: number; checksum: number } {
  const before = performance.now();
  const checksum = work();
  return { elapsed: performance.now() - before, checksum };
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

describe("Rust shadow overhead", () => {
  it("stays within the frozen 25 percent CPU ceiling", () => {
    baseline();
    withShadow();
    const baselineSamples: number[] = [];
    const shadowSamples: number[] = [];
    let checksum = 0;
    for (let sample = 0; sample < 7; sample += 1) {
      const first = sample % 2 === 0 ? timed(baseline) : timed(withShadow);
      const second = sample % 2 === 0 ? timed(withShadow) : timed(baseline);
      baselineSamples.push(sample % 2 === 0 ? first.elapsed : second.elapsed);
      shadowSamples.push(sample % 2 === 0 ? second.elapsed : first.elapsed);
      checksum ^= first.checksum ^ second.checksum;
    }
    const baselineMedianMs = median(baselineSamples);
    const shadowMedianMs = median(shadowSamples);
    const ratio = shadowMedianMs / baselineMedianMs;
    process.stdout.write(
      `${JSON.stringify({
        profile: "M8_SHADOW_NODE_PURE",
        repetitions: 7,
        boundaries_per_repetition: ITERATIONS,
        mechanics_operations_per_boundary: MECHANICS_OPERATIONS_PER_BOUNDARY,
        baseline_median_ms: baselineMedianMs,
        shadow_median_ms: shadowMedianMs,
        overhead_ratio: ratio,
        rss_bytes: process.memoryUsage().rss,
        checksum,
      })}\n`,
    );
    expect(checksum).toBe(0);
    expect(ratio).toBeLessThanOrEqual(1.25);
  });
});
