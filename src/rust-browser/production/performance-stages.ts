export const M9_STARTUP_PERFORMANCE_SCHEMA_V1 = 1 as const;
export const M9_STARTUP_MAXIMUM_DURATION_MS = 600_000;
export const M9_STARTUP_MAXIMUM_SAMPLES = 256;

export const M9_STARTUP_STAGES_V1 = [
  "AUTHENTICATION_READY",
  "PLATFORM_CONTEXT_READY",
  "MANIFEST_VERIFIED",
  "ASSIGNMENT_VERIFIED",
  "ARTIFACT_DOWNLOAD_READY",
  "SAVE_READY",
  "WASM_COMPILED",
  "WASM_INSTANTIATED",
  "CONTENT_READY",
  "SESSION_READY",
  "FIRST_CONTROL_READY",
] as const;

export type M9StartupStageV1 = (typeof M9_STARTUP_STAGES_V1)[number];

export interface M9StartupStageSinkV1 {
  record(stage: M9StartupStageV1, atMs: number): void;
  classify(mode: M9StartupModeV1): void;
}
export type M9StartupModeV1 = "COLD" | "WARM";

export interface M9StartupStageSampleV1 {
  stage: M9StartupStageV1;
  at_ms: number;
  elapsed_ms: number;
  delta_ms: number;
}

export interface M9StartupJourneySnapshotV1 {
  schema_version: typeof M9_STARTUP_PERFORMANCE_SCHEMA_V1;
  journey_id: string;
  mode: M9StartupModeV1;
  started_at_ms: number;
  total_ms: number;
  stages: M9StartupStageSampleV1[];
}

export interface M9StartupDistributionV1 {
  minimum_ms: number;
  p50_ms: number;
  p95_ms: number;
  maximum_ms: number;
}

export interface M9StartupModeSummaryV1 {
  samples: number;
  total: M9StartupDistributionV1 | null;
  stage_deltas: Record<M9StartupStageV1, M9StartupDistributionV1 | null>;
}

export interface M9StartupPerformanceSummaryV1 {
  schema_version: typeof M9_STARTUP_PERFORMANCE_SCHEMA_V1;
  total_samples: number;
  cold: M9StartupModeSummaryV1;
  warm: M9StartupModeSummaryV1;
}

const JOURNEY_ID = /^[a-zA-Z0-9._:-]{1,128}$/u;

export class M9StartupJourneyRecorderV1 {
  readonly #journeyId: string;
  #mode: M9StartupModeV1 | null;
  readonly #startedAtMs: number;
  readonly #samples: M9StartupStageSampleV1[] = [];

  constructor(options: { journeyId: string; mode?: M9StartupModeV1; startedAtMs: number }) {
    if (
      !JOURNEY_ID.test(options.journeyId)
      || (options.mode != null && options.mode !== "COLD" && options.mode !== "WARM")
      || !validTime(options.startedAtMs)
    ) {
      throw new Error("M9 startup journey identity or start time is invalid");
    }
    this.#journeyId = options.journeyId;
    this.#mode = options.mode ?? null;
    this.#startedAtMs = options.startedAtMs;
  }

  classify(mode: M9StartupModeV1): void {
    if ((mode !== "COLD" && mode !== "WARM") || (this.#mode != null && this.#mode !== mode)) {
      throw new Error("M9 startup journey mode is invalid or already classified");
    }
    this.#mode = mode;
  }

  record(stage: M9StartupStageV1, atMs: number): void {
    const expected = M9_STARTUP_STAGES_V1[this.#samples.length];
    if (expected == null) {
      throw new Error("M9 startup journey is already complete");
    }
    if (stage !== expected) {
      throw new Error(`M9 startup stage is out of order: expected ${expected}, received ${stage}`);
    }
    const previousAt = this.#samples.at(-1)?.at_ms ?? this.#startedAtMs;
    const elapsed = atMs - this.#startedAtMs;
    const delta = atMs - previousAt;
    if (!validTime(atMs) || delta < 0 || elapsed < 0 || elapsed > M9_STARTUP_MAXIMUM_DURATION_MS) {
      throw new Error("M9 startup stage time is invalid or unbounded");
    }
    this.#samples.push({ stage, at_ms: atMs, elapsed_ms: elapsed, delta_ms: delta });
  }

  snapshot(): M9StartupJourneySnapshotV1 {
    if (this.#samples.length !== M9_STARTUP_STAGES_V1.length || this.#mode == null) {
      throw new Error("M9 startup journey is incomplete or unclassified");
    }
    return {
      schema_version: M9_STARTUP_PERFORMANCE_SCHEMA_V1,
      journey_id: this.#journeyId,
      mode: this.#mode,
      started_at_ms: this.#startedAtMs,
      total_ms: this.#samples.at(-1)?.elapsed_ms ?? 0,
      stages: structuredClone(this.#samples),
    };
  }
}

export class M9StartupPerformanceSuiteV1 {
  readonly #journeys = new Map<string, M9StartupJourneySnapshotV1>();

  add(snapshot: M9StartupJourneySnapshotV1): void {
    validateSnapshot(snapshot);
    if (this.#journeys.has(snapshot.journey_id)) {
      throw new Error("M9 startup journey identity is duplicated");
    }
    if (this.#journeys.size >= M9_STARTUP_MAXIMUM_SAMPLES) {
      throw new Error("M9 startup sample bound is exceeded");
    }
    this.#journeys.set(snapshot.journey_id, structuredClone(snapshot));
  }

  summary(): M9StartupPerformanceSummaryV1 {
    const journeys = [...this.#journeys.values()];
    return {
      schema_version: M9_STARTUP_PERFORMANCE_SCHEMA_V1,
      total_samples: journeys.length,
      cold: summarizeMode(journeys.filter(journey => journey.mode === "COLD")),
      warm: summarizeMode(journeys.filter(journey => journey.mode === "WARM")),
    };
  }
}

function validateSnapshot(snapshot: M9StartupJourneySnapshotV1): void {
  if (
    snapshot.schema_version !== M9_STARTUP_PERFORMANCE_SCHEMA_V1
    || !JOURNEY_ID.test(snapshot.journey_id)
    || (snapshot.mode !== "COLD" && snapshot.mode !== "WARM")
    || !validTime(snapshot.started_at_ms)
    || !validDuration(snapshot.total_ms)
    || snapshot.stages.length !== M9_STARTUP_STAGES_V1.length
  ) {
    throw new Error("M9 startup snapshot is invalid");
  }
  let previous = snapshot.started_at_ms;
  for (const [index, sample] of snapshot.stages.entries()) {
    if (
      sample.stage !== M9_STARTUP_STAGES_V1[index]
      || !validTime(sample.at_ms)
      || sample.at_ms < previous
      || sample.elapsed_ms !== sample.at_ms - snapshot.started_at_ms
      || sample.delta_ms !== sample.at_ms - previous
      || !validDuration(sample.elapsed_ms)
      || !validDuration(sample.delta_ms)
    ) {
      throw new Error("M9 startup snapshot stage is invalid");
    }
    previous = sample.at_ms;
  }
  if (snapshot.total_ms !== snapshot.stages.at(-1)?.elapsed_ms) {
    throw new Error("M9 startup snapshot total is inconsistent");
  }
}

function summarizeMode(journeys: M9StartupJourneySnapshotV1[]): M9StartupModeSummaryV1 {
  const stageDeltas = Object.fromEntries(
    M9_STARTUP_STAGES_V1.map((stage, index) => [
      stage,
      distribution(journeys.map(journey => journey.stages[index]?.delta_ms ?? 0)),
    ]),
  ) as Record<M9StartupStageV1, M9StartupDistributionV1 | null>;
  return {
    samples: journeys.length,
    total: distribution(journeys.map(journey => journey.total_ms)),
    stage_deltas: stageDeltas,
  };
}

function distribution(values: number[]): M9StartupDistributionV1 | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    minimum_ms: sorted[0] ?? 0,
    p50_ms: percentile(sorted, 0.5),
    p95_ms: percentile(sorted, 0.95),
    maximum_ms: sorted.at(-1) ?? 0,
  };
}

function percentile(sorted: number[], percentileValue: number): number {
  return sorted[Math.ceil(percentileValue * sorted.length) - 1] ?? 0;
}

function validTime(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function validDuration(value: number): boolean {
  return validTime(value) && value <= M9_STARTUP_MAXIMUM_DURATION_MS;
}
