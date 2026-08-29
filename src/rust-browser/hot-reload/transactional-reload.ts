import type { BrowserRequestV1, BrowserResponseEnvelopeV1 } from "../contracts/browser-contracts";
import {
  type BrowserGenerationArtifactManifestV1,
  type BrowserKernelGenerationV1,
  type BrowserReloadDecisionV1,
  type BrowserReloadPlanV1,
  type BrowserReloadTailEventV1,
  browserResponseDigestV1,
  MAXIMUM_BROWSER_RELOAD_TAIL_V1,
  validateBrowserGenerationIdentityV1,
} from "./contracts";
import type { BrowserSnapshotMigrationRegistryV1 } from "./migration-registry";

export type BrowserGenerationFactoryV1 = (
  manifest: BrowserGenerationArtifactManifestV1,
  snapshotBytes: Uint8Array,
) => Promise<BrowserKernelGenerationV1>;

export class TransactionalBrowserReloadV1 implements BrowserKernelGenerationV1 {
  #active: BrowserKernelGenerationV1;
  #rollback: BrowserKernelGenerationV1 | null = null;
  #tail: BrowserReloadTailEventV1[] = [];
  #tailBase = 0;
  #gate: Promise<void> = Promise.resolve();
  #releaseGate: (() => void) | null = null;
  readonly #inFlight = new Set<Promise<unknown>>();
  #acceptanceRemaining = 0;
  #disposed = false;
  #reloadInProgress = false;
  #reloadOperation: Promise<BrowserReloadDecisionV1> | null = null;

  constructor(active: BrowserKernelGenerationV1) {
    validateBrowserGenerationIdentityV1(active.identity);
    this.#active = active;
  }

  get identity() {
    return this.#active.identity;
  }

  async dispatch(request: BrowserRequestV1): Promise<BrowserResponseEnvelopeV1[]> {
    await this.#gate;
    if (this.#disposed) {
      throw new Error("browser reload supervisor is disposed");
    }
    const routed = this.#active;
    const promise = routed.dispatch(request);
    this.#inFlight.add(promise);
    try {
      const responses = await promise;
      if (routed !== this.#active) {
        throw new Error("STALE_KERNEL_GENERATION_RESPONSE");
      }
      if (isReplayable(request)) {
        this.#appendTail({ request: structuredClone(request), active_digest: browserResponseDigestV1(responses) });
      }
      if (this.#acceptanceRemaining > 0 && isReplayable(request)) {
        this.#acceptanceRemaining -= 1;
        if (this.#acceptanceRemaining === 0) {
          await this.#retireRollback();
        }
      }
      return responses;
    } finally {
      this.#inFlight.delete(promise);
    }
  }

  snapshot(): Promise<Uint8Array> {
    return this.#active.snapshot();
  }

  async reload(
    manifest: BrowserGenerationArtifactManifestV1,
    plan: BrowserReloadPlanV1,
    migrations: BrowserSnapshotMigrationRegistryV1,
    factory: BrowserGenerationFactoryV1,
  ): Promise<BrowserReloadDecisionV1> {
    if (this.#reloadInProgress) {
      throw new Error("another browser kernel reload is already in progress");
    }
    this.#reloadInProgress = true;
    const operation = this.#reloadTransaction(manifest, plan, migrations, factory);
    this.#reloadOperation = operation;
    try {
      return await operation;
    } finally {
      this.#reloadOperation = null;
      this.#reloadInProgress = false;
    }
  }

  async #reloadTransaction(
    manifest: BrowserGenerationArtifactManifestV1,
    plan: BrowserReloadPlanV1,
    migrations: BrowserSnapshotMigrationRegistryV1,
    factory: BrowserGenerationFactoryV1,
  ): Promise<BrowserReloadDecisionV1> {
    validatePlan(plan);
    validateCandidate(this.#active, manifest);
    if (plan.policy === "INCOMPATIBLE_REJECT") {
      throw new Error("reload policy forbids candidate activation");
    }
    const started = performance.now();
    await this.#acquireGate();
    let snapshot: Uint8Array;
    let tailStart: number;
    try {
      await this.#drain();
      snapshot = await this.#active.snapshot();
      tailStart = this.#tailBase + this.#tail.length;
    } finally {
      this.#release();
    }
    const sourceSchema = snapshotSchema(snapshot);
    const targetSchema = Math.max(sourceSchema, manifest.identity.minimum_snapshot_schema);
    if (targetSchema > manifest.identity.maximum_snapshot_schema) {
      snapshot.fill(0);
      throw new Error("candidate snapshot schema range is incompatible");
    }
    const migrated = await migrations.migrate(snapshot, sourceSchema, targetSchema);
    snapshot.fill(0);
    let candidate: BrowserKernelGenerationV1 | null = null;
    try {
      candidate = await factory(manifest, migrated.bytes);
      migrated.bytes.fill(0);
      await this.#acquireGate();
      try {
        await this.#drain();
        const replay = this.#tailSlice(tailStart);
        const divergentKinds = await replayCandidate(candidate, replay, plan);
        if (plan.policy === "EXACT_PRESERVATION") {
          const [activeSnapshot, candidateSnapshot] = await Promise.all([
            this.#active.snapshot(),
            candidate.snapshot(),
          ]);
          const equal = equalBytes(activeSnapshot, candidateSnapshot);
          activeSnapshot.fill(0);
          candidateSnapshot.fill(0);
          if (!equal) {
            throw new Error("candidate final snapshot differs from active snapshot");
          }
        }
        await this.#retireRollback();
        const previous = this.#active;
        this.#active = candidate;
        candidate = null;
        this.#rollback = previous;
        this.#acceptanceRemaining = plan.acceptance_events;
        if (this.#acceptanceRemaining === 0) {
          await this.#retireRollback();
        }
        return {
          accepted: true,
          previous: previous.identity,
          candidate: this.#active.identity,
          policy: plan.policy,
          replayed_events: replay.length,
          divergent_response_kinds: divergentKinds,
          elapsed_ms: performance.now() - started,
          reason: "candidate restored, replayed, validated, and atomically routed",
        };
      } finally {
        this.#release();
      }
    } catch (error) {
      migrated.bytes.fill(0);
      if (candidate != null) {
        await candidate.dispose().catch(() => undefined);
      }
      throw error;
    }
  }

  async rollback(reason: string): Promise<void> {
    if (this.#reloadInProgress) {
      throw new Error("cannot roll back while a reload is in progress");
    }
    if (reason.length === 0) {
      throw new Error("browser rollback reason is required");
    }
    await this.#acquireGate();
    try {
      await this.#drain();
      if (this.#rollback == null) {
        throw new Error("browser rollback window is closed");
      }
      const failed = this.#active;
      this.#active = this.#rollback;
      this.#rollback = null;
      this.#acceptanceRemaining = 0;
      await failed.dispose();
    } finally {
      this.#release();
    }
  }

  async dispose(): Promise<void> {
    const reload = this.#reloadOperation;
    if (reload != null) {
      await reload.catch(() => undefined);
    }
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    await this.#acquireGate();
    try {
      await this.#drain();
      await this.#retireRollback();
      await this.#active.dispose();
      this.#tail = [];
    } finally {
      this.#release();
    }
  }

  async #acquireGate(): Promise<void> {
    await this.#gate;
    this.#gate = new Promise(resolve => {
      this.#releaseGate = resolve;
    });
  }

  #release(): void {
    const release = this.#releaseGate;
    this.#releaseGate = null;
    release?.();
  }

  async #drain(): Promise<void> {
    await Promise.all([...this.#inFlight]);
  }

  #appendTail(event: BrowserReloadTailEventV1): void {
    if (this.#tail.length >= MAXIMUM_BROWSER_RELOAD_TAIL_V1) {
      this.#tail.shift();
      this.#tailBase += 1;
    }
    this.#tail.push(event);
  }

  #tailSlice(globalStart: number): BrowserReloadTailEventV1[] {
    const offset = globalStart - this.#tailBase;
    if (offset < 0 || offset > this.#tail.length) {
      throw new Error("browser reload tail rotated before candidate acceptance");
    }
    return this.#tail.slice(offset);
  }

  async #retireRollback(): Promise<void> {
    const rollback = this.#rollback;
    this.#rollback = null;
    if (rollback != null) {
      await rollback.dispose();
    }
  }
}

async function replayCandidate(
  candidate: BrowserKernelGenerationV1,
  replay: readonly BrowserReloadTailEventV1[],
  plan: BrowserReloadPlanV1,
): Promise<string[]> {
  const divergent = new Set<string>();
  for (const event of replay) {
    const responses = await candidate.dispatch(structuredClone(event.request));
    if (browserResponseDigestV1(responses) !== event.active_digest) {
      for (const response of responses) {
        divergent.add(response.response.kind);
      }
    }
  }
  if (plan.policy === "EXACT_PRESERVATION" && divergent.size > 0) {
    throw new Error("exact browser replay diverged");
  }
  if ([...divergent].some(kind => !plan.allowed_response_kinds.includes(kind))) {
    throw new Error("browser replay produced undeclared divergence");
  }
  return [...divergent].sort();
}

function validateCandidate(active: BrowserKernelGenerationV1, manifest: BrowserGenerationArtifactManifestV1): void {
  validateBrowserGenerationIdentityV1(manifest.identity);
  const current = active.identity;
  if (
    manifest.identity.session_id !== current.session_id
    || manifest.identity.generation <= current.generation
    || manifest.identity.worker_abi_version !== current.worker_abi_version
    || manifest.identity.content_identity !== current.content_identity
  ) {
    throw new Error("browser candidate generation/session/ABI/content fence failed");
  }
}

function validatePlan(plan: BrowserReloadPlanV1): void {
  if (
    plan.schema_version !== 1
    || !Number.isSafeInteger(plan.acceptance_events)
    || plan.acceptance_events < 0
    || plan.acceptance_events > MAXIMUM_BROWSER_RELOAD_TAIL_V1
    || (plan.policy === "EXACT_PRESERVATION" && plan.allowed_response_kinds.length > 0)
  ) {
    throw new Error("browser reload plan is invalid");
  }
}

function snapshotSchema(bytes: Uint8Array): number {
  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { schema_version?: unknown };
  if (!Number.isSafeInteger(parsed.schema_version) || Number(parsed.schema_version) < 1) {
    throw new Error("browser snapshot schema is missing");
  }
  return Number(parsed.schema_version);
}

function isReplayable(request: BrowserRequestV1): boolean {
  return !["INITIALIZE", "OBSERVE", "SNAPSHOT", "EXPORT_REPRO", "DISPOSE"].includes(request.kind);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}
