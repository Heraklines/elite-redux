export interface BrowserSnapshotMigrationEdgeV1 {
  id: string;
  fromSchema: number;
  toSchema: number;
  maximumOutputBytes: number;
  migrate(bytes: Uint8Array): Uint8Array;
}

export interface BrowserSnapshotMigrationEvidenceV1 {
  id: string;
  fromSchema: number;
  toSchema: number;
  inputSha256: string;
  outputSha256: string;
  outputBytes: number;
}

export class BrowserSnapshotMigrationRegistryV1 {
  readonly #edges: BrowserSnapshotMigrationEdgeV1[] = [];

  register(edge: BrowserSnapshotMigrationEdgeV1): void {
    if (
      edge.id.length === 0
      || !Number.isSafeInteger(edge.fromSchema)
      || !Number.isSafeInteger(edge.toSchema)
      || edge.fromSchema < 1
      || edge.toSchema <= edge.fromSchema
      || edge.maximumOutputBytes < 1
      || this.#edges.some(
        current =>
          current.id === edge.id || (current.fromSchema === edge.fromSchema && current.toSchema === edge.toSchema),
      )
    ) {
      throw new Error("browser snapshot migration edge is invalid or duplicate");
    }
    this.#edges.push(edge);
    this.#edges.sort(
      (left, right) =>
        left.fromSchema - right.fromSchema || left.toSchema - right.toSchema || left.id.localeCompare(right.id),
    );
  }

  async migrate(
    input: Uint8Array,
    fromSchema: number,
    toSchema: number,
  ): Promise<{ bytes: Uint8Array; evidence: BrowserSnapshotMigrationEvidenceV1[] }> {
    if (fromSchema === toSchema) {
      return { bytes: input.slice(), evidence: [] };
    }
    const path = this.#uniquePath(fromSchema, toSchema);
    let bytes = Uint8Array.from(input);
    const evidence: BrowserSnapshotMigrationEvidenceV1[] = [];
    for (const edge of path) {
      const first = edge.migrate(bytes.slice());
      const second = edge.migrate(bytes.slice());
      if (first.byteLength === 0 || first.byteLength > edge.maximumOutputBytes || !equalBytes(first, second)) {
        throw new Error("browser snapshot migration is empty, oversized, or nondeterministic");
      }
      evidence.push({
        id: edge.id,
        fromSchema: edge.fromSchema,
        toSchema: edge.toSchema,
        inputSha256: await sha256(bytes),
        outputSha256: await sha256(first),
        outputBytes: first.byteLength,
      });
      bytes.fill(0);
      bytes = Uint8Array.from(first);
      first.fill(0);
      second.fill(0);
    }
    return { bytes, evidence };
  }

  #uniquePath(fromSchema: number, toSchema: number): BrowserSnapshotMigrationEdgeV1[] {
    const queue: Array<{ schema: number; path: BrowserSnapshotMigrationEdgeV1[] }> = [{ schema: fromSchema, path: [] }];
    const paths: BrowserSnapshotMigrationEdgeV1[][] = [];
    while (queue.length > 0) {
      const current = shiftRequired(queue);
      if (current.path.length > 8) {
        continue;
      }
      if (current.schema === toSchema) {
        paths.push(current.path);
        if (paths.length > 1) {
          throw new Error("browser snapshot migration route is ambiguous");
        }
        continue;
      }
      for (const edge of this.#edges) {
        if (edge.fromSchema === current.schema && edge.toSchema <= toSchema && !current.path.includes(edge)) {
          queue.push({ schema: edge.toSchema, path: [...current.path, edge] });
        }
      }
    }
    if (paths.length !== 1) {
      throw new Error("browser snapshot migration route is missing");
    }
    return paths[0];
  }
}

function shiftRequired<T>(values: T[]): T {
  const value = values.shift();
  if (value == null) {
    throw new Error("migration queue unexpectedly became empty");
  }
  return value;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
