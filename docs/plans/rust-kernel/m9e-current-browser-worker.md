# Current V7 development Worker

The explicit development factory in
`src/rust-browser/routes/rust-current-worker-entry.ts` creates a dedicated module
Worker and a `CurrentRustBrowserHostV2`. The Worker loads the verified current
Wasm/glue/content cohort and constructs Rust `BrowserKernelHostV2`. Its sole game
entry point is the current ABI2 `process` method. The production route selection
does not use this factory automatically.

Supply exact same-origin URLs and SHA-256 hashes for Wasm, glue and content.
The loader bounds streamed downloads, rejects redirects and hash mismatches,
checks the ABI2 constructor, and releases temporary byte buffers. The remote
builder produces a separate hashed Worker file and a source-bound manifest;
the test gate verifies the actual emitted files and loaded Worker URL.

`dispatch(request)` resolves with the Rust response after matching its request ID,
sequence and response kind. Callers then route any effect batch through
`BrowserEffectRouterV2`. Presentation and storage adapters own real completion:
they submit the corresponding typed callback using the actual pending effect ID.
A presentation callback may await the transport, but its returned effect batch
must be deferred until the outer router batch has finished. Recursively awaiting
the same router would violate its batch order.

The transport serializes one in-flight request. Defaults are16 pending requests,
16MiB aggregate retained request payloads and a120-second response deadline;
maximum configuration is32 pending requests and240 seconds. Complete envelopes
also retain the existing request/response byte limits. The queue includes active
request ownership and rejects new work before admission when full.

A Rust transactional rejection carries `HOST_REJECTED`, the original request
correlation and the unchanged accepted sequence. It permits a subsequent request
at that same sequence. A crash, deadline, malformed response or unknown correlation
fences the owner and rejects pending work. Unknown acceptance is not retried.
`dispose()` requires the normal Rust acknowledgement; hard `terminate()` settles
pending work and closes the Worker without claiming that acknowledgement.

Current payloads support signed JavaScript-safe integers, including stat stages.
Correlation IDs remain nonnegative safe integers. Unsafe integers, fractions,
nonfinite values, undefined values and sparse arrays reject instead of losing
information. Response decoding rejects unsafe numeric payloads before publishing
them. This boundary does not support the entire Rust i64 range.

Remote qualification requires two actual Worker witnesses and three codec tests
in addition to existing native, Wasm, in-page Chromium, typed-effect and CLI
replay witnesses. The Worker tests cover natural Title-to-BattleCommand input,
actual presentation ownership/settlement, held-navigation timing, full snapshot
conservation on kernel rejection, acknowledgement/disposal, wrong ABI/invalid
correlation and external termination with two pending requests.

This capability alone does not establish RTC co-op, IndexedDB persistence,
reconnect, recovery after lost replies, a renderer, or production rollout.
Those require their own connected implementations and platform evidence.
