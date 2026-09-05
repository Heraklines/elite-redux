# Native current-session capture

Exact remote qualification is recorded in the recovery ledger.

The normal native `agent` entry records each standalone current V7 session's
typed external events. Captures include accepted steps and observations, real
kernel rejections, absolute event positions, a preceding checkpoint and the
expected final snapshot digest. Capture is diagnostic: an unavailable capture
does not undo an accepted game action.

Run the following commands only on the authorized remote runner. Start the
native agent with a current V7 checkpoint and its matching V2 content:

```sh
er-cli agent --protocol jsonl --content /remote/content-v2.json --snapshot /remote/checkpoint-v7.json
```

The startup session is named `current`. Send one JSON request per line, using
a fresh request ID for each request:

```json
{"protocol_version":1,"id":"capture-hello","method":"protocol.hello","params":{}}
{"protocol_version":1,"id":"capture-status","method":"session.capsule.status","params":{"session":"current"}}
{"protocol_version":1,"id":"capture-export","method":"session.capsule.export","params":{"session":"current"}}
```

Check `result.capture.supported` in the hello response, then the session status.
An available export returns the capsule in `result.capsule`. Save that object
alone to a JSON file on the remote runner, then replay it with matching content:

```sh
er-cli replay --content /remote/content-v2.json --capsule /remote/capture.json
```

`capsule-validate` uses the same current replay checks. Both commands accept up to
4,096 retained attempts while preserving the 2 MiB serialized capsule bound and
4 MiB input-file/result bounds. The recorder default remains 256 events; the byte
cap may constrain a capture before its configured event ceiling. Replay verifies the
declared event suffix and quarantines platform effects; it does not perform the
recorded storage or network operations again.

Session create/import requests may set `capture_limits` with `maximum_events`
and `maximum_bytes`. Defaults are 256 events and 2 MiB per native recorder;
the native maximum is 4,096 events and 2 MiB. A checkpoint that cannot fit can
leave capture unavailable while the session remains usable. Rotation establishes
an explicit newer checkpoint and suffix; it never presents missing history as
complete. These are recorder payload limits, not a whole-process heap estimate.

Forks carry independent future histories. Restore starts a new checkpoint
boundary. A verified native capsule import retains its history; a verified
browser-origin import starts an explicit native suffix at the imported final
position. Closing a session removes its recorder; reused session names start a
new history.

Malformed or rejected ingress can mark a capture unavailable. An addressable
native session receives that gap; unaddressable discarded input conservatively
gaps all native owners. A later verified event may begin a new available suffix.
Read-only status/export failures do not erase valid capture. Consult the explicit
status and reason rather than assuming every failure is a replayable kernel event.

This capability covers standalone native sessions. Worker-backed sessions report
unsupported capture, and batch capture is not provided. Export is an inline
response; there is no durable recorder after process loss or stdout-delivery
acknowledgment guarantee. It does not implement proposal recovery or replay
minimization.
