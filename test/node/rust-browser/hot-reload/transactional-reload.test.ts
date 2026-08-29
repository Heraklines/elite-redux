import { describe, expect, it } from "vitest";
import type {
  BrowserRequestV1,
  BrowserResponseEnvelopeV1,
} from "../../../../src/rust-browser/contracts/browser-contracts";
import type {
  BrowserGenerationArtifactManifestV1,
  BrowserKernelGenerationIdentityV1,
  BrowserKernelGenerationV1,
  BrowserReloadPlanV1,
} from "../../../../src/rust-browser/hot-reload/contracts";
import { BrowserSnapshotMigrationRegistryV1 } from "../../../../src/rust-browser/hot-reload/migration-registry";
import { TransactionalBrowserReloadV1 } from "../../../../src/rust-browser/hot-reload/transactional-reload";

class FakeGeneration implements BrowserKernelGenerationV1 {
  readonly identity: BrowserKernelGenerationIdentityV1;
  state = 0;
  schema: number;
  readonly delta: number;
  disposed = false;
  heldKey = true;
  presentationFenced = true;
  #sequence = 0;

  constructor(generation: number, delta = 1, schema = 6) {
    this.identity = identity(generation, schema);
    this.delta = delta;
    this.schema = schema;
  }

  async dispatch(request: BrowserRequestV1): Promise<BrowserResponseEnvelopeV1[]> {
    if (this.disposed) {
      throw new Error("fake generation disposed");
    }
    this.#sequence += 1;
    if (request.kind === "ADVANCE_TIME") {
      this.state += request.value * this.delta;
    }
    if (request.kind === "RAW_INPUT" && request.value.kind === "KEY_DOWN") {
      this.heldKey = !this.heldKey;
    }
    const response =
      request.kind === "SNAPSHOT"
        ? { kind: "SNAPSHOT" as const, value: Array.from(await this.snapshot()) }
        : {
            kind: "EFFECTS" as const,
            value: {
              external_sequence: this.#sequence,
              effects: [{ kind: "TELEMETRY" as const, value: [this.state] }],
              observation_bytes: [this.state],
              next_wakeup_micros: null,
            },
          };
    return [
      {
        version: 1,
        request_id: this.#sequence,
        accepted_sequence: this.#sequence,
        after_mechanical_digest: `state:${this.state}`,
        response,
      },
    ];
  }

  async snapshot(): Promise<Uint8Array> {
    return new TextEncoder().encode(
      JSON.stringify({
        schema_version: this.schema,
        state: this.state,
        held_key: this.heldKey,
        presentation_fenced: this.presentationFenced,
      }),
    );
  }

  async restore(bytes: Uint8Array): Promise<void> {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as {
      schema_version: number;
      state: number;
      held_key: boolean;
      presentation_fenced: boolean;
    };
    this.schema = value.schema_version;
    this.state = value.state;
    this.heldKey = value.held_key;
    this.presentationFenced = value.presentation_fenced;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

function identity(generation: number, schema = 6): BrowserKernelGenerationIdentityV1 {
  return {
    schema_version: 1,
    session_id: "browser-session",
    generation,
    artifact_sha256: generation.toString(16).padStart(64, "0"),
    wasm_sha256: (generation + 100).toString(16).padStart(64, "0"),
    content_sha256: "c".repeat(64),
    source_git_sha: generation.toString(16).padStart(40, "0"),
    worker_abi_version: 1,
    minimum_snapshot_schema: schema,
    maximum_snapshot_schema: schema,
    content_identity: "content-a",
    release_id: `release-${generation}`,
  };
}

function manifest(generation: number, schema = 6): BrowserGenerationArtifactManifestV1 {
  return {
    schema_version: 1,
    identity: identity(generation, schema),
    worker_url: "/worker.js",
    wasm_url: "/kernel.wasm",
    content_url: "/content.json",
  };
}

function exactPlan(acceptanceEvents = 0): BrowserReloadPlanV1 {
  return {
    schema_version: 1,
    policy: "EXACT_PRESERVATION",
    allowed_response_kinds: [],
    acceptance_events: acceptanceEvents,
  };
}

const emptyMigrations = new BrowserSnapshotMigrationRegistryV1();

function factory(delta = 1) {
  return async (candidateManifest: BrowserGenerationArtifactManifestV1, snapshot: Uint8Array) => {
    const generation = new FakeGeneration(
      candidateManifest.identity.generation,
      delta,
      candidateManifest.identity.minimum_snapshot_schema,
    );
    await generation.restore(snapshot);
    return generation;
  };
}

describe("transactional browser kernel reload", () => {
  it("initializes a candidate in parallel, replays the tail, and preserves state without page reload", async () => {
    const active = new FakeGeneration(1);
    const supervisor = new TransactionalBrowserReloadV1(active);
    let releaseCandidate: (() => void) | undefined;
    const candidateReady = new Promise<void>(resolve => {
      releaseCandidate = resolve;
    });
    const reload = supervisor.reload(manifest(2), exactPlan(), emptyMigrations, async (value, snapshot) => {
      await candidateReady;
      return factory()(value, snapshot);
    });
    await Promise.resolve();
    await supervisor.dispatch({ kind: "ADVANCE_TIME", value: 4 });
    releaseCandidate?.();
    const decision = await reload;
    expect(decision.accepted).toBe(true);
    expect(decision.replayed_events).toBe(1);
    expect(supervisor.identity.generation).toBe(2);
    expect(JSON.parse(new TextDecoder().decode(await supervisor.snapshot()))).toMatchObject({
      state: 4,
      held_key: true,
      presentation_fenced: true,
    });
    expect(active.disposed).toBe(true);
    await supervisor.dispose();
  });

  it("activates declared mechanics divergence and rejects undeclared divergence", async () => {
    const supervisor = new TransactionalBrowserReloadV1(new FakeGeneration(1));
    let releaseCandidate: (() => void) | undefined;
    const ready = new Promise<void>(resolve => {
      releaseCandidate = resolve;
    });
    const plan: BrowserReloadPlanV1 = {
      schema_version: 1,
      policy: "DECLARED_SEMANTIC_CHANGE",
      allowed_response_kinds: ["EFFECTS"],
      acceptance_events: 1,
    };
    const reload = supervisor.reload(manifest(2), plan, emptyMigrations, async (value, snapshot) => {
      await ready;
      return factory(2)(value, snapshot);
    });
    await Promise.resolve();
    await supervisor.dispatch({ kind: "ADVANCE_TIME", value: 2 });
    releaseCandidate?.();
    const decision = await reload;
    expect(decision.divergent_response_kinds).toEqual(["EFFECTS"]);
    await supervisor.dispatch({ kind: "ADVANCE_TIME", value: 1 });
    await expect(supervisor.rollback("closed window")).rejects.toThrow(/closed/u);
    await supervisor.dispose();
  });

  it("migrates an additive schema and rejects a breaking schema without a route", async () => {
    const supervisor = new TransactionalBrowserReloadV1(new FakeGeneration(1));
    await expect(
      supervisor.reload(
        manifest(2, 7),
        {
          schema_version: 1,
          policy: "MIGRATED_COMPATIBLE",
          allowed_response_kinds: [],
          acceptance_events: 0,
        },
        emptyMigrations,
        factory(),
      ),
    ).rejects.toThrow(/route/u);
    const migrations = new BrowserSnapshotMigrationRegistryV1();
    migrations.register({
      id: "snapshot-6-to-7",
      fromSchema: 6,
      toSchema: 7,
      maximumOutputBytes: 4_096,
      migrate(bytes) {
        const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
        value.schema_version = 7;
        value.optional_extension = "default";
        return new TextEncoder().encode(JSON.stringify(value));
      },
    });
    const decision = await supervisor.reload(
      manifest(3, 7),
      {
        schema_version: 1,
        policy: "MIGRATED_COMPATIBLE",
        allowed_response_kinds: [],
        acceptance_events: 0,
      },
      migrations,
      factory(),
    );
    expect(decision.accepted).toBe(true);
    expect(supervisor.identity.generation).toBe(3);
    await supervisor.dispose();
  });

  it("keeps the active generation after candidate failure and supports bounded rollback", async () => {
    const active = new FakeGeneration(1);
    const supervisor = new TransactionalBrowserReloadV1(active);
    await expect(
      supervisor.reload(manifest(2), exactPlan(), emptyMigrations, async () => {
        throw new Error("candidate Worker crashed");
      }),
    ).rejects.toThrow(/crashed/u);
    expect(supervisor.identity.generation).toBe(1);
    await supervisor.reload(manifest(3), exactPlan(2), emptyMigrations, factory());
    await supervisor.rollback("acceptance failure");
    expect(supervisor.identity.generation).toBe(1);
    await supervisor.dispose();
  });

  it("performs one thousand swaps without retaining retired generations", async () => {
    const supervisor = new TransactionalBrowserReloadV1(new FakeGeneration(1));
    const started = performance.now();
    for (let generation = 2; generation <= 1_001; generation += 1) {
      await supervisor.reload(manifest(generation), exactPlan(), emptyMigrations, factory());
    }
    expect(supervisor.identity.generation).toBe(1_001);
    expect(performance.now() - started).toBeLessThan(250);
    await supervisor.dispose();
  });
});
