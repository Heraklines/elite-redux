# M9 signed production release manifest

`ProductionReleaseManifestV2` is the only executable production release identity. It contains release/channel, integration/Rust/browser/oracle SHAs, mechanical and diagnostic identities, kernel/worker/authority protocols, material/save schemas, complete artifact identities, previous Rust and legacy transition releases, platform API versions, and exact qualification evidence.

`ProductionArtifactSetV1` contains bootstrap JS, browser JS, Worker JS, Wasm, content, asset manifest, and service worker. Every identity includes an immutable same-origin content-addressed URL, SHA-256, and byte length. Browser glue JS is a first-class hashed artifact. No executable URL may be reconstructed from an unhashed sibling convention.

`SignedProductionManifestV1` carries key ID, payload, and a 64-byte Ed25519 signature. Verification signs domain-separated canonical JSON bytes: `er-m9:release-manifest-v1\0` followed by canonical payload bytes. Verification keys are pinned in the minimal bootstrap; unknown/revoked keys fail closed. Rust uses strict Ed25519 verification. Browser verification uses WebCrypto Ed25519 over the identical vectors.

A release is built once. Qualification, canary, stable, and rollback use identical bytes. Publication may upload bytes but cannot make them active. Promotion updates only a separately signed rollout policy. Every asset hash is checked before cache commit or execution. A missing, corrupt, cross-release, wrong-ABI, wrong-protocol, wrong-content, wrong-asset, or unqualified manifest fails before authority starts.

The previous complete Rust release and all actively pinned releases remain addressable. Deployment-time `latest`, branch heads, redirects to mutable content, and resolution of `er-assets/main` are forbidden.
