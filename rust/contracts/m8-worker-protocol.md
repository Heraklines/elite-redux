# M8 worker protocol

The dedicated module worker owns `BrowserKernelHostV1`. Main thread sends transferable canonical JSON `ArrayBuffer` batches. No nested `JsValue` hot path and no Rust-to-JavaScript callback during dispatch.

Mutations execute strictly serially. Observations queue behind prior mutations. Request ID and sequence are safe integers, monotonic, and session scoped. A bounded ledger retains duplicate fingerprints and encoded responses.

Requests: Initialize, RawInput, AdvanceTime, TimerWakeup, NetworkFrame, TransportChanged, StorageResult, PresentationSettled, Lifecycle, Observe, Snapshot, ExportRepro, Dispose.

Responses: Ready, Effects, Observation, Snapshot, Repro, Fault, Disposed.

Effects: UI, presentation, semantic scene delta, network, storage, asset, audio, terminal, telemetry summary, repro reference. Effects preserve order and carry the external sequence, after mechanical digest, observation, and next wakeup.

Maximum request bytes, effect bytes, pending count, artifact bytes, frame bytes, and presentation count come from `m8-contract.toml` and are checked before allocation. Worker close drains no mechanical work after Dispose and releases every Rust owner.
