# M4 oracle export contract

## Immutable source

All M4 fixtures are exported from exact TypeScript SHA `45c89493e7edec9c4da247a98cd7858b1f015c09`. Production TypeScript and `rust/source-lock.toml` are read-only. Test-only instrumentation may observe production code but cannot patch its behavior.

## Export outputs

The exporter publishes, at minimum:

```text
rust/fixtures/m4/oracle-manifest.json
rust/fixtures/m4/run-content-pack-v1.json
rust/fixtures/m4/rng-vectors-v1.json
rust/fixtures/m4/run-segments/*.json
rust/fixtures/m4/progression/*.json
rust/fixtures/m4/rewards/*.json
rust/fixtures/m4/markets/*.json
rust/fixtures/m4/biomes/*.json
rust/fixtures/m4/encounters/*.json
```

Each fixture contains exact provenance, initial canonical state and every RNG state, raw semantic decisions as observed input to TypeScript, ordered RNG calls, ordered action/transition evidence, mutations, presentation, final canonical state, final RNG state, and next logical surface/control. Unsupported or unobservable values are explicit gaps; they are never fabricated.

## Composed parity segment

The wave-9-to-wave-11 M4 parity fixture is explicitly labeled `oracle-composed`. Its wave-9 state and each reward, progression, route, market, encounter, and battle vector are independently captured from the pinned oracle, then joined only where before/after state and all content/RNG identities match exactly. The Rust campaign drives the composed segment through raw physical keys. The manifest cannot claim a natural single-seed TypeScript journey unless a fresh-process exporter demonstrates it.

## Instrumentation

Test-only instrumentation records every run-affecting Phaser RNG boundary and exact state before/after. It covers reward tier/pool/reroll, biome length, route extras, market stock, encounter selection/materialization, growth/stat generation when used, and any selected modifier probability. If Phaser RNG state changes without a recorded draw, export fails.

Draw reasons map to the closed Rust vocabulary only through an exporter-owned callsite map. Stack traces are diagnostic, not canonical reasons.

## Fresh-process determinism

Every publication job performs two independent clean checkouts of the exact oracle SHA and executes the exporter in separate fresh Node processes. Canonical output must be byte-identical. It records:

- repository and exporter SHAs;
- Node and Phaser versions;
- OS/runner image, locale, and timezone;
- battle/run content hashes;
- fixture path, byte length, and SHA-256;
- complete gap/capability classification.

A branch-aware hosted publication job emits an attestation artifact. Foundation and differential gates consume only fixtures whose attestation SHA matches the candidate contract lock.

## M3 preservation and migration companions

Published M3 fixture bytes and manifests are immutable. M4 publishes typed migration companion data keyed by fixture, state side (`initial` or `final`), and stable `PokemonId`. Companions contain exact observed progression, owner, and stable roster-order fields. The exporter fails if any one of the 38 M3 cases or supporting schema vectors lacks a companion.

## First-divergence policy

Differential failures report the earliest divergent RNG draw, mutation, presentation event, state field, surface option, action ordinal, or control. Final-state equality cannot excuse a different causal sequence.