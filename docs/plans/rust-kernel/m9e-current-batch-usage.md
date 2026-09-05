# Current native batches

Source contract for the M9 recovery candidate; qualification is tracked in the recovery ledger. Run game commands only on the authorized remote runner during this recovery.

Start the normal current agent with the runner's prepared V2 content:

```sh
er-cli agent --protocol jsonl --content /remote/path/game-content-bundle-v2.json --maximum-sessions 256
```

Send one JSON object per line on stdin. The protocol version remains 1; the returned game kernel version is 7. Native batches require this in-process backend. A worker-configured agent rejects batch methods because its generation currently owns a single session.

This minimal sequence creates a natural Title session, forks it and advances both environments in the supplied global order:

```jsonl
{"protocol_version":1,"id":"create-1","method":"batch.create","params":{"batch":"experiment","environments":[{"environment":1,"start":{"kind":"NATURAL","profile":{"schema_version":1,"unlocks":[],"achievements":[],"challenges":[],"flags":[],"statistics":{"runs_started":0,"runs_won":0,"runs_lost":0,"battles_won":0,"pokemon_captured":0,"highest_wave":1},"dex":{"entries":[]}},"seed":"experiment-1","owner_seat":1,"save_slots":["preview-slot"],"local_is_host":true}}]}}
{"protocol_version":1,"id":"fork-1","method":"batch.fork","params":{"batch":"experiment","source_environment":1,"target_environment":2}}
{"protocol_version":1,"id":"time-1","method":"batch.advance_time","params":{"batch":"experiment","advances":[{"environment":2,"milliseconds":249},{"environment":1,"milliseconds":250},{"environment":2,"milliseconds":1}]}}
{"protocol_version":1,"id":"observe-1","method":"batch.observe","params":{"batch":"experiment","environments":[2,1,2]}}
{"protocol_version":1,"id":"close-1","method":"batch.close","params":{"batch":"experiment"}}
```

Time advancement at Title is only an API example. A held navigation timer needs an actual directional key-down in a supported control; the remote tests exercise its 249/1 ms boundary and resulting effects.

Each response echoes the request ID and contains `result`, `artifact` and `error`; successful batch results stay inline. Use a fresh request ID for a corrected request. Request-ID duplicate admission is separate from batch transaction rollback.

| Method | Parameters in addition to `batch` | Result behavior |
| --- | --- | --- |
| `batch.create` | `environments: [{environment, start}]`, optional `limits` | Creates an isolated batch with shared immutable prepared content. |
| `batch.reset` | `environments: [{environment, start}]` | Atomically replaces all environments and preserves the batch's limits. |
| `batch.events` | `events: [{environment, event}]` | Accepts the current typed external-event enum, preserving global input order. |
| `batch.raw_input` | `inputs: [{environment, input}]` | Wraps each typed raw input as a current external event. |
| `batch.advance_time` | `advances: [{environment, milliseconds}]` | Wraps each typed time advancement. |
| `batch.observe` | `environments: [id, ...]` | Returns observations in requested order, including repeated IDs. |
| `batch.snapshot` | `environments: [id, ...]` | Returns complete current snapshots in requested order. |
| `batch.fork` | `source_environment`, `target_environment` | Copies mutable session state into an unused environment ID; content remains shared. |
| `batch.close` | None | Disposes the batch and releases all its mutable environments. |

Environment IDs are safe unsigned JSON integers. Batch names are nonempty strings of at most 128 UTF-8 bytes. An environment has its own snapshot, timers and endpoint state. Batch environments do not alias standalone agent sessions.

Starts support `NATURAL` as above, `SNAPSHOT` with `snapshot`, `owner_seat` and `role`, or `CAPSULE` with a current causal `capsule`. Capsule replay is validated privately before publication; recorded effects are evidence and are not delivered again while importing.

Optional limits contain all three fields: `maximum_environments` (1-256), `maximum_events` (1-4096 per call), and `maximum_result_bytes` (2-16777216). Defaults are 256 environments, 256 events and 4194304 serialized result-array bytes. The agent's total standalone-plus-batch environment quota is also enforced, and complete batch success responses have a separate 4 MiB JSONL envelope limit, including the escaped request ID and newline. Large snapshots can therefore require smaller read groups even when the event count fits.

For event calls, only affected sessions are privately forked. A missing ID, rejected event, result-array overflow or complete success-envelope overflow publishes none of the candidate state or returned effects. Successful results include each event's ordinal, environment, full typed step and observation. Deliver returned effects in that order; this batch layer does not perform storage, network or presentation settlement. Feed actual outcomes back through the typed external-event method.

These limits bound admitted counts and serialized payloads. They do not establish an exact process heap bound or measured simulation throughput. Current batch evidence must come from its six core tests, two actual CLI tests, protocol admission tests and required cross-entry remote qualification.