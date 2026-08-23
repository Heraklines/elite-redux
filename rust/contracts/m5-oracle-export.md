# M5 oracle export

## Immutable source

The candidate source checkout is detached at `328824692f95b1aa1b38af85b54a6b72d9259eb4`, tree `55ea78195244827bbacb21f7e0531b0827eae137`. Export tooling and fixture selectors are copied into that separate checkout as test-only untracked paths. The overlay refuses any `src/**` write. The M5 integration branch preserves production TypeScript byte-for-byte from the M4 final SHA.

## Bootstrap refresh

Before oracle acceptance:

1. regenerate all M3 battle fixtures in two fresh Linux/x64 processes at the candidate SHA;
2. regenerate all M4 run fixtures in two fresh Linux/x64 processes at the same SHA;
3. require exact output inventory and byte identity between fresh processes;
4. compare every generated JSON file with the frozen M3/M4 fixture;
5. classify each file as identical, provenance-only, or semantic change with the first structural difference;
6. accept or reject the candidate source cut explicitly.

No M3/M4 fixture is overwritten in place. Refreshed evidence is published under M5 until the source-cut decision is committed.

## Source catalog

`SourceCatalogV1` is AST-derived from explicit mechanics roots and exact enum registries. It records IDs, registrations, modifier keys, class inheritance, attribute attachments, dispatcher call sites, RNG call sites, and per-file SHA-256. Output is canonical JSON outside both worktrees and must be byte-identical on a second run.

Catalog extraction is evidence, not translation. The compiler additionally consumes post-initialization runtime captures to observe patched definitions and concrete operands.

## Mechanics oracle cases

Each admitted primitive/family fixture records initial V3 state, commands, exact program/content hashes, ordered source collection, ordered queries and modifiers, RNG draws, conditions/selectors, operations, mutations, presentations, final V3 state, and next control. A final-state match cannot excuse an ordering, RNG, mutation, or event difference.

## Environment

Publication requires Linux/x64, repository-pinned Node and pnpm, `LC_ALL=C`, `LANG=C`, and `TZ=UTC`. The attestation records Node, Phaser, oracle SHA/tree, exporter commit, input/output digests, catalog counts, and compiler versions. Host path and wall-clock timestamp are excluded from canonical output.
