# Current browser platform boundary follow-up

Status: SOURCE_INVESTIGATION_ONLY. No V2 platform implementation or execution
qualification is claimed by this note.

The existing RustBrowserHost creates a module Worker, but rust-kernel-worker.ts
constructs BrowserKernelHostV1 and invokes dispatch_batch. That Rust host owns
GameKernelV6; its loader export requirements are also V1. The current V7
m9e-v7-corrective browser test instead constructs BrowserKernelHostV2 directly in
the page, including both cooperative hosts. Current V2 TS consists of effect
contracts/router, without a concrete current Worker client/loader/controller.

The historical full-coop.spec.ts provides reusable real infrastructure: two
isolated browser contexts, one Worker and one RTCPeerConnection per context,
signed ordered data channels, manual SDP exchange and teardown. Preserve its
historical identity. RustBrowserTransportAdapterV1 emits V1 request shapes and
signaling validation explicitly requires browser worker protocol 1. Reuse signed
opaque-frame handling through explicit V2 compatibility and request adaptation;
do not relabel V1 transport as current evidence.

BrowserStorageAdapter already provides real IndexedDB reads, CAS writes,
revision-checked deletes and disposal. Typed V2 storage-completion wiring is
missing, and the provider does not expose LIST. Worker termination, data-channel
closure/generation fencing, peer-connection closure and IndexedDB closure already
exist in their separate owners; a current controller must coordinate them.

A bounded implementation cut needs a V2 host/Worker loader using current
single-envelope process, explicit V2 transport compatibility/admission, and a
controller connecting network, presentation settlement and typed storage results.
Then use existing naturally derived V7 cooperative checkpoints in a new current
real-platform witness. Prove game traffic crosses actual data channels into
Workers, both seats submit commands, replica presentation arrives once and is
settled, duplicate material preserves full snapshots and teardown closes both
Workers/connections. Trigger and verify a separate real storage operation before
claiming storage coverage. Manual local peer signaling does not establish a
deployed signaling service or TURN connectivity. Existing payload bounds still
apply; no chunking or arbitrary-sized frame support is inferred.

All browser workloads and platform checks must run remotely. This follow-up does
not authorize deployment, new infrastructure or legacy player-save access.
