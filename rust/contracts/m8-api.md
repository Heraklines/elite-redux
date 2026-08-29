# M8 browser integration API

## Execution modes

```rust
pub enum BrowserExecutionModeV1 {
    LegacyTypeScript,
    TypeScriptWithRustShadow,
    RustLocalAuthority,
    RustStagingAuthority,
}
```

Legacy TypeScript is the default and starts no Rust worker. Shadow has TypeScript as sole authority and quarantines every Rust effect. Rust local/staging have Rust as sole authority. No runtime can hold two authorities.

## Worker boundary

The browser passes canonical UTF-8 JSON bytes in transferable `ArrayBuffer` values. One batch contains ordered requests; one response contains ordered effects. No callback enters JavaScript during a Rust transition. No semantic action export exists.

```rust
pub struct BrowserRequestEnvelopeV1 {
    pub version: u32,
    pub request_id: SafeU53,
    pub sequence: SafeU53,
    pub request: BrowserRequestV1,
}

pub struct BrowserResponseEnvelopeV1 {
    pub version: u32,
    pub request_id: SafeU53,
    pub accepted_sequence: SafeU53,
    pub after_mechanical_digest: String,
    pub response: BrowserResponseV1,
}
```

Requests are initialize, raw input, advance time, timer wakeup, network frame, transport change, storage result, presentation settlement, lifecycle, observe, snapshot, repro, and dispose. Responses are ready, effects, observation, snapshot, repro, fault, and disposed.

Requests are strictly serial and monotonic. Identical duplicate bytes are idempotent. Conflicting duplicates, gaps, oversized messages, unknown versions, or queue overflow fail before mutation. Observation never overtakes mutation.

## Effects

Effect batches carry UI changes, semantic presentation, scene changes, network frames, storage requests, asset/audio requests, terminal, bounded telemetry, repro references, observation, and next wakeup. The browser executes effects but cannot reinterpret them into mechanics.

## Wasm host

`er-web::BrowserKernelHostV1` owns one browser session, execution identity, request ledger, effect queue, bounded evidence, snapshot, and disposal. `create`, `dispatch_batch`, `snapshot`, `export_repro`, and `dispose` are the only hot boundary. `er-wasm` remains parity/test-only.

## Main-thread bridge

`src/rust-browser/` owns mode selection, worker loading, request sequencing, adapters, shadow, presenters, routes, and diagnostics. The kernel never runs on the main thread. `src/main.ts` keeps Legacy TypeScript default and loads Rust only from a build-authorized private route/mode.

## Authority and compatibility

Handshake compares worker protocol, Authority V2 protocol, mechanical identity, content hash, material/save schemas, browser kernel ABI, and active model identity. Rust and TypeScript authority peers cannot pair. Shadow is not a peer authority.

## Debug bridge

Development/staging may expose a bounded authorized `MessagePort` for observation, repro, platform trace, and render trace. Production builds expose no unrestricted global debug handle.
