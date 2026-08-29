import {
  type CanonicalShadowProjectionV1,
  projectShadowBoundary,
  type ShadowBoundaryKindV1,
} from "./common-projection";

export interface TypeScriptBoundaryEventV1 {
  boundary: ShadowBoundaryKindV1;
  operationId: string;
  payload: unknown;
}

export type TypeScriptBoundaryObserverV1 = (projection: CanonicalShadowProjectionV1) => void;

export class TypeScriptBoundaryCaptureV1 {
  readonly #observers = new Set<TypeScriptBoundaryObserverV1>();
  readonly #retained: CanonicalShadowProjectionV1[] = [];
  readonly #maximumRetained: number;
  #nextSequence = 1;
  #disposed = false;

  constructor(maximumRetained = 2_048) {
    if (!Number.isSafeInteger(maximumRetained) || maximumRetained <= 0 || maximumRetained > 10_000) {
      throw new Error("TypeScript shadow capture retention is outside the frozen bounds");
    }
    this.#maximumRetained = maximumRetained;
  }

  subscribe(observer: TypeScriptBoundaryObserverV1): () => void {
    if (this.#disposed) {
      throw new Error("TypeScript shadow capture is disposed");
    }
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  capture(event: TypeScriptBoundaryEventV1): CanonicalShadowProjectionV1 {
    if (this.#disposed) {
      throw new Error("TypeScript shadow capture is disposed");
    }
    const projection = projectShadowBoundary(
      "TYPESCRIPT",
      this.#nextSequence,
      event.boundary,
      event.operationId,
      event.payload,
    );
    this.#nextSequence += 1;
    this.#retained.push(projection);
    if (this.#retained.length > this.#maximumRetained) {
      this.#retained.shift();
    }
    for (const observer of this.#observers) {
      observer(projection);
    }
    return projection;
  }

  retained(): readonly CanonicalShadowProjectionV1[] {
    return this.#retained;
  }

  dispose(): void {
    this.#disposed = true;
    this.#observers.clear();
    this.#retained.length = 0;
  }
}
