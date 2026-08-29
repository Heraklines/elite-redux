# M9 production security

All release, policy, assignment, rollback, save, frame, cache, telemetry, and migration inputs are untrusted. Bounds are checked before decode/allocation; canonical form, signature, channel, key status, expiry, anti-rollback floor, identity, schema, and hash are checked before use.

Production trusts only pinned Ed25519 public keys in the minimal bootstrap. Missing/unknown/revoked keys, invalid/noncanonical signatures, wrong domains/channels, expired artifacts, old epochs, debug builds, and unsigned fallback fail to a non-mutating unavailable state. They never start TypeScript.

Execution uses the verified complete release cohort. Worker, Wasm glue, Wasm, browser entry, content, asset manifest, bootstrap, and service worker each have signed URL/path, bytes, length, MIME, and SHA-256 identity. The loader reverifies cached bytes at use and never derives an executable sibling URL. Incomplete/mixed releases never execute.

Native artifact names are fixed platform basenames. Absolute, parent, nested, slash/backslash, drive, UNC, device, alternate-stream, normalization, symlink, reparse, and replacement cases fail. Final canonical parent must equal the hash directory.

Production import graphs exclude legacy mechanics, dev registry, fixtures, local/staging/shadow entries, hot-reload controls, source maps, and page-reload authority update code. Rust failure has no legacy fallback.

Public co-op frames authenticate session, participant/seat, release, connection generation, monotonic sequence, kind, and payload digest before Rust delivery. Cloud saves bind authenticated account/slot, release/generation, mechanical/content identity, schema, payload hash, and CAS revision.

Cookies, auth headers, refresh tokens, pairing bearers, deployment credentials, and private signing keys never enter Rust, Workers, saves, caches, telemetry, capsules, URLs, logs, or developer commands. Negative tests prove absence.
