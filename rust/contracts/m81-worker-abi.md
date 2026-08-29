# M8.1 native kernel worker ABI

`er-kernel-worker` is a replaceable child process. The supervisor owns sessions, routing, artifact selection, persistence, build watching, rollback, and process lifetime. The child owns exactly one kernel generation and zero durable authority outside its process.

Frames are unsigned big-endian `u32` length plus canonical JSON bytes. Empty, oversized, truncated, unknown-version, duplicate-identity/different-fingerprint, out-of-order, or trailing-byte frames fail closed. Standard input/output carry protocol bytes only; diagnostics use standard error. The child never loads a dynamic library.

Every envelope carries ABI version, session ID, generation identity, request ID, sequence, and request fingerprint. Requests are `HELLO`, `RESTORE`, `APPLY`, `OBSERVE`, `SNAPSHOT`, `EXPORT_REPRO`, `HEALTH`, and `DISPOSE`. Responses are `READY`, `RESTORED`, `EFFECTS`, `OBSERVATION`, `SNAPSHOT`, `REPRO`, `HEALTH`, `FAULT`, and `DISPOSED`.

`RESTORE` accepts complete canonical snapshot and immutable content-bundle bytes. No live owner crosses the boundary. The worker validates artifact identity, content identity, schema, snapshot invariants, and resource bounds before constructing the kernel. `APPLY` is serial and accepts only external kernel inputs. Snapshot and response bytes are copied into owned bounded buffers before decode.

A generation may answer only envelopes addressed to its exact identity. The supervisor ignores and records late responses from retired generations. Dispose is idempotent and terminates with zero kernel-owned resources. Panic, EOF, timeout, malformed output, nonzero exit, or resource-limit breach faults only the candidate process; the active generation remains routable.
