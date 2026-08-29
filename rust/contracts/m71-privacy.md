# M7.1 Observation, Privacy, and Redaction

## Visibility lattice

`Player ⊆ Agent ⊆ Debug ⊆ Forensic`. A session fixes the maximum profile at creation. Requests above it fail without returning partial data. Observation is pure and cannot install controls, submit options, advance time, or alter evidence retention.

## Player

Player projection contains only information available to the requested seat through the current M7 UI and presentation contract:

* player-visible party, field, inventory, status, HP, control, and messages;
* visible opponent information already revealed by gameplay;
* current selected visible option and player-facing option labels;
* settled/non-secret presentation state.

It excludes hidden enemy party data, scripted policies, RNG state, protocol internals, storage payloads, timers, digests, behavior IDs, model internals, adapter diagnostics, and account identity.

## Agent

Agent adds navigation fidelity without hidden state:

* stable visible option IDs and menu instance;
* exact directional navigation edges among visible options;
* enabled/actionable flags already represented by the logical menu;
* accepted physical input patterns;
* actionable seat;
* visible-state deltas.

Agent does not receive the typed semantic action behind an option, hidden option IDs, hidden subtree digests, or APIs that submit semantic actions.

## Debug

Debug requires `allow_hidden_state`. It may include canonical game state, RNG audit, protocol snapshot, scheduler, input router, pending material/control, presentation ownership, resource inventory, and full build identity. Debug artifacts remain local unless capsule export is separately allowed.

## Forensic

Forensic additionally includes bounded causal graph, diagnostic digest tree, recent external/internal events, performance evidence, source provenance, platform/render diagnostics, and normalized failure evidence.

## Secret data

The following never enter observations, telemetry, traces, capsules, artifact names, causal addresses, or diagnostic digests:

```text
passwords
session cookies and authorization tokens
OAuth secrets and raw login URLs
Discord/Google provider IDs
co-op identity tickets
platform credentials
filesystem credentials
browser storage secrets
raw account email or third-party identity
```

Usernames, account IDs, session IDs, run IDs, and peer names are redacted by default using stable capsule-local aliases. Redaction must not change mechanical bytes embedded as opaque blobs; instead the containing blob is excluded or access is denied when safe redaction is impossible.

## Digest side channels

Player and Agent profiles expose no hidden leaf or subsystem digest from which hidden state can be probed. Mechanical digests are Debug/Forensic only. Artifact references visible below Debug use opaque session-local handles rather than content digests when the digest would reveal equality of hidden payloads.

## Redaction manifest

Every exported capsule contains a manifest listing:

* redaction policy version;
* fields removed;
* fields aliased;
* blobs omitted because they could not be safely transformed;
* whether replay requires externally supplied private content;
* salt-free deterministic alias scope local to the capsule.

No credential can be preserved by an override.

## Retention

Evidence, telemetry, checkpoints, and artifacts are byte- and count-bounded. Oldest unpinned entries evict first. The most recent valid checkpoint is pinned. Teardown clears session-local aliases, artifact handles, model requests, telemetry, evidence, and pair network queues.

## Security tests

Required tests prove:

* profile subset relations;
* Agent cannot observe hidden enemy information or hidden digests;
* Debug/Forensic require permission;
* observation is mutation-free across all profiles;
* raw secrets are absent from serialized observations, capsules, and telemetry;
* artifact paths cannot escape the configured root;
* oversized or malformed requests cannot bypass redaction;
* pair observations enforce requested-seat ownership;
* redaction remains deterministic for the same capsule input;
* teardown leaves no retained sensitive payloads.
