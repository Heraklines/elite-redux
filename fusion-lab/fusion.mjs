/* Fusion Lab - fusion strategy engine. Each STRATEGIES entry is a pluggable
 * sprite-fusion algorithm: { id, label, params, fuse(a, b, p) -> { image, layers, meta } }
 * where A is the head donor and B is the body donor. Image primitives + the strategy
 * registry live here (kept dependency-free so they unit-test under `node --test`).
 * Stub for now - the algorithm lands in a later unit. */

export const STRATEGIES = [];
