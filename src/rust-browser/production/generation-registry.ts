import type {
  ProductionGenerationEntryV1,
  ProductionGenerationRegistryV1,
  ProductionGenerationStatusV1,
  ProductionReleaseManifestV2,
  ReleaseHealthSnapshotV1,
} from "./contracts";
import { validateProductionReleaseManifestV2 } from "./release-manifest";

const ASSIGNABLE = new Set<ProductionGenerationStatusV1>(["INTERNAL", "CANARY", "STABLE", "ROLLBACK"]);

export class BrowserProductionGenerationRegistryV1 {
  readonly #entries = new Map<string, ProductionGenerationEntryV1>();

  constructor(snapshot?: ProductionGenerationRegistryV1) {
    if (snapshot != null) {
      if (snapshot.schema_version !== 1 || snapshot.releases.length > 64) {
        throw new Error("production generation registry snapshot is invalid");
      }
      for (const entry of snapshot.releases) {
        this.add(entry.release, entry.status, entry.health, entry.assigned_new_sessions, entry.active_sessions);
      }
    }
  }

  add(
    release: ProductionReleaseManifestV2,
    status: ProductionGenerationStatusV1,
    health: ReleaseHealthSnapshotV1,
    assignedNewSessions = 0,
    activeSessions = 0,
  ): void {
    validateProductionReleaseManifestV2(release);
    validateHealth(health);
    if (
      this.#entries.has(release.release_id)
      || !safeCount(assignedNewSessions)
      || !safeCount(activeSessions)
      || (status === "STABLE" && [...this.#entries.values()].some(entry => entry.status === "STABLE"))
    ) {
      throw new Error("production generation registry entry is invalid or duplicate");
    }
    this.#entries.set(release.release_id, {
      release: structuredClone(release),
      status,
      assigned_new_sessions: assignedNewSessions,
      active_sessions: activeSessions,
      health: structuredClone(health),
    });
  }

  assignNewSession(releaseId: string): void {
    const entry = this.#required(releaseId);
    if (!ASSIGNABLE.has(entry.status) || entry.health.hard_stop) {
      throw new Error("production generation is not assignable");
    }
    entry.assigned_new_sessions = increment(entry.assigned_new_sessions);
    entry.active_sessions = increment(entry.active_sessions);
  }

  releasePin(releaseId: string): void {
    const entry = this.#required(releaseId);
    if (entry.active_sessions === 0) {
      throw new Error("production generation pin underflow");
    }
    entry.active_sessions -= 1;
  }

  transition(releaseId: string, next: ProductionGenerationStatusV1): void {
    const entry = this.#required(releaseId);
    if (!validTransition(entry.status, next)) {
      throw new Error("production generation status transition is invalid");
    }
    if (next === "STABLE") {
      for (const current of this.#entries.values()) {
        if (current.status === "STABLE") {
          current.status = "DRAINING";
        }
      }
    }
    entry.status = next;
  }

  updateHealth(releaseId: string, health: ReleaseHealthSnapshotV1): void {
    validateHealth(health);
    this.#required(releaseId).health = structuredClone(health);
  }

  evictionCandidates(maximumRetainedCompleteReleases = 3): string[] {
    const unpinned = [...this.#entries.values()]
      .filter(
        entry => entry.active_sessions === 0 && ["BUILT", "QUALIFIED", "DRAINING", "REVOKED"].includes(entry.status),
      )
      .sort((left, right) => left.release.release_epoch - right.release.release_epoch);
    const excess = Math.max(0, this.#entries.size - maximumRetainedCompleteReleases);
    return unpinned.slice(0, excess).map(entry => entry.release.release_id);
  }

  snapshot(): ProductionGenerationRegistryV1 {
    return {
      schema_version: 1,
      releases: [...this.#entries.values()]
        .sort((left, right) => left.release.release_epoch - right.release.release_epoch)
        .map(entry => structuredClone(entry)),
    };
  }

  #required(releaseId: string): ProductionGenerationEntryV1 {
    const entry = this.#entries.get(releaseId);
    if (entry == null) {
      throw new Error("production generation is unknown");
    }
    return entry;
  }
}

function validateHealth(health: ReleaseHealthSnapshotV1): void {
  if (
    health.schema_version !== 1
    || !safeCount(health.observed_sessions)
    || !safeCount(health.observed_minutes)
    || health.hard_stop !== (health.hard_stop_fingerprint != null)
  ) {
    throw new Error("release health snapshot is invalid");
  }
}

function validTransition(current: ProductionGenerationStatusV1, next: ProductionGenerationStatusV1): boolean {
  if (next === "REVOKED" || next === "ROLLBACK") {
    return current !== "REVOKED";
  }
  const order: ProductionGenerationStatusV1[] = ["BUILT", "QUALIFIED", "INTERNAL", "CANARY", "STABLE", "DRAINING"];
  return order.indexOf(next) === order.indexOf(current) + 1;
}

function safeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function increment(value: number): number {
  if (!safeCount(value) || value === Number.MAX_SAFE_INTEGER) {
    throw new Error("production generation counter overflow");
  }
  return value + 1;
}
