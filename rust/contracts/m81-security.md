# M8.1 reload security

Generation manifests, executables, Wasm, content, snapshots, traces, migration output, worker frames, debug commands, and cache entries are untrusted. Verify byte/count/depth/time bounds and SHA-256 before parse or execution.

Native candidates execute as child processes from immutable hash-addressed artifact directories. Paths are canonicalized below the configured cache root; symlinks, traversal, mutable aliases, shell interpolation, inherited protocol file descriptors, and same-process library loading are forbidden. Spawn uses an argument vector and a minimal allowlisted environment. Standard output is protocol-only and bounded. Startup, request, CPU, memory, and termination deadlines are enforced by the supervisor.

Browser candidates load only a manifest-authorized same-origin module Worker and Wasm/content assets whose hashes, ABI, schemas, source SHA, and release identity match. Candidate Workers receive a private MessagePort; no unrestricted global reload hook ships in production. Developer controls require build authorization and bounded messages.

Snapshots never authorize filesystem, storage, account, seat, transport, or artifact selection. Those capabilities remain supervisor-owned. A candidate has no durable side effects during preflight; platform effects are quarantined until commit. Secrets and bearer credentials never enter snapshots, traces, manifests, or repro capsules.

Every generation transition records old/new identity, policy, migration chain, comparisons, decision, failure class, and cleanup result. Rejected artifacts remain non-executable. Cleanup proves zero retired processes/Workers, ports, listeners, timers, pending requests, quarantined effects, and mutable cache handles.
