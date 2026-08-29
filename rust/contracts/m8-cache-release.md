# M8 browser release and cache identity

`BrowserReleaseManifestV1` binds integration/browser/Rust/oracle SHAs, Wasm/content/asset hashes, protocol/ABI/worker versions, adapter versions, execution mode, and exact qualification evidence.

HTML loader, JS adapters, worker, Wasm, content, asset manifest, and release manifest form one atomic unit. The service worker stages a complete unit, verifies every hash/version, then atomically promotes it. Missing or mismatched artifacts keep the prior complete unit or fail closed.

Forbidden combinations include new JS with old Wasm, old JS with new content, new kernel with old assets, or old adapter with new worker protocol. Multi-tab activation is release-manifest fenced; an old tab stays on its complete unit until reload and cannot communicate with a new-version Rust peer.

Legacy remains default. Rust-local is development-only; staging authority requires build-time authorization. M8 does not change the production-default authority or deploy public production.
