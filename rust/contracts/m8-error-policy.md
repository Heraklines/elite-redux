# M8 browser error policy

Every worker request is fail-atomic. Rejection leaves Rust state, request sequence, timers, effects, storage, transport, presentations, shadow state, and browser authority unchanged.

| Failure | Required result |
|---|---|
| Unknown ABI/version | Fault before decode/mutation |
| Oversized request/effect/frame | Reject before allocation/parse |
| Duplicate same request bytes | Return cached response |
| Duplicate ID with different bytes | Protocol fault |
| Sequence gap/reorder | Reject and retain expected sequence |
| Queue capacity | Backpressure or bounded fault |
| Worker panic | Normalized fault plus bounded repro |
| Worker termination | Reject pending requests; export latest evidence if possible |
| Shadow platform effect | Shadow invariant failure; effect never executes |
| Two authorities | Initialization failure |
| Mixed TS/Rust peer | Handshake rejection before gameplay |
| Content/mechanical mismatch | Compatibility rejection |
| Timer wakeup early/late | Rust decides due timers; no JS consequence |
| Storage conflict/quota/corruption/timeout | Typed result recorded in trace |
| Save bytes malformed | Rust rejection; browser does not inspect |
| RTC direct frame too large | Drop before string/JSON conversion |
| Stale connection generation | Drop without Rust delivery |
| Legacy unauthenticated co-op route | Forbidden for Rust modes |
| Presentation stale generation | Reject settlement |
| Presentation failure | Explicit Failed; never Rendered |
| Lifecycle hidden/frozen | Explicit event; no hidden JS continuation |
| Cache/release mismatch | Previous complete release or fail closed |
| Missing release artifact | Release not activated |
| Unauthorized forensic port | Reject; no global debug surface |
| Dispose repeated | Idempotent Disposed |

Rust-local and staging faults never fall back mid-session to TypeScript authority. Legacy remains the default only when selected before session initialization.
