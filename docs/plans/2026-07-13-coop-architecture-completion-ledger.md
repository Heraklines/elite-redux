# Co-op architecture completion ledger

This is the release-claim ledger for the authoritative migration. `GREEN` means current exact-SHA evidence
proves the requirement. `IMPLEMENTED-UNVERIFIED` means code exists but the required external evidence has not
run. `PARTIAL` means only a subset is closed. `OPEN` means the target architecture is absent. Historical green
runs prove only their recorded SHA and scope.

The governing invariant is:

> Either every required renderer has applied the same addressed state and opened the same continuation
> surface, or every member enters a bounded shared recovery/terminal path. No member silently advances or
> waits forever.

## Current integration evidence

| Evidence | State | What it proves |
|---|---|---|
| Exact remote SHA `50531b460`, run `29213259047` | GREEN (historical) | 246 classified files, static, A/B/C/P/S/T, browser transport; 4m19s. Does not contain the local T2/T3/T5 work or P33. |
| Local/remote semantic merge `b7e96f9eb` | IMPLEMENTED-UNVERIFIED | Both incompatible P32 histories coexist behind `er-coop-33`; no external gate yet. |
| P33 address RED proof `1bb359024` | RED BY DESIGN | Reproduces accepted-frame aliasing across epoch/wave reuse for turn, live event, checkpoint, and finalized state. |
| P33 schema freeze `d48dd23ae` | CONTRACT ONLY | Stable account/seat/authority/membership/topology target; implementation remains. |
| CI acceleration `3caeb9e22` | STATIC-PROVEN | Dynamic exhaustive 33 test shards + browser + static = 35 jobs; no full execution at P33 SHA yet. |
| Public UI harness `abf278266` | IMPLEMENTED-UNVERIFIED | Two browser contexts/public lobby+canvas driver exists; deployed staging journeys have not run. |
| T5 server/client reconciliation | IN PROGRESS | Independent review found additional server materialization/identity defects; client regression pass is active. |

Nothing in this table is architecture-completion evidence yet.

## Original handoff work items

| # | Requirement | State | Completion evidence required |
|---:|---|---|---|
| 1 | Biome, reward/market, and Mystery production live materializers; single ledger | PARTIAL | Legacy relay dropped per surface; durable commit alone mutates the real guest state; both flag states; no watcher gameplay mutation. |
| 2 | Event-driven rendezvous and invalid command-source retry | GREEN at prior checkpoints; reverify P33 | Focused regression plus exact P33 gate. |
| 3 | Journal every non-cosmetic authority class or prove checkpoint healing | PARTIAL | Exhaustive class registry; per-class fault injection proves live-state convergence. |
| 4 | Lost intent automatic resend | PARTIAL | Drop first intent for every owner-driven surface; bounded resend; exactly-once authority result. |
| 5 | Snapshot/deep-gap production wiring | PARTIAL | Immutable boundary snapshot + journal fast-forward + executable control restore; drop/overflow/rejoin proof. |
| 6 | Replay loader restores recorded checkpoint, not original roster | PARTIAL | Evolved/caught/move-modified/inventory/RNG checkpoint replay reproduces submitted trace. |
| 7 | Bargain, Colosseum, ability, faint, revival, learn, catch-full, Stormglass, lobby/resume templates | PARTIAL | Typed intent, exactly-once commit, retained result, renderer projection, capability, both flag states for each. |
| 8 | Renderer mutation allowlist enforce | PARTIAL | Both peers negotiate enforce; zero would-block across full gate/nightly; capability-bound renderer API. |
| 9 | Gate closure, checksum blind spots, exhaustive surfaces, deeper Lane P | PARTIAL | No quarantine; registry-to-test completeness; 35+ wave no-heal; every active visual/UI surface classified. |
| 10 | Full proof and honest handoff | OPEN | Exact final SHA full gate + public browser journeys + every-class fault campaign + six nightly profiles; evidence recorded here. |

## Independent-audit transaction P0s

| Requirement | State | Required proof |
|---|---|---|
| Full-address internal buffering | IN PROGRESS | Turn/inbox/live/checkpoint/finalized state keyed by epoch+wave+turn(+revision); delayed old frame cannot surface after boundary reuse. |
| `stateApplied` separate from `continuationReady` | OPEN | Host retains until next public command/reward/UI/terminal surface is open and correct owner can drive it. |
| Retained complete wave-end transaction | OPEN | One final post-BattleEnd commit contains material + next control; drop/reorder/reconnect/late receiver cannot advance without it. |
| Retained complete Mystery terminal | PARTIAL | Comprehensive result and terminal share one retained transaction; raw `meResync` cannot race durable terminal. |
| Recovery restores executable surface | PARTIAL | Adopt phase/pending command/barrier/waiter/UI owner and re-enter registry surface; no diagnostic-only restore. |
| Shadow-atomic material/control apply | OPEN | Failed reconstruction leaves prior model/tick/control intact; crash cannot observe partial apply. |
| One runtime/generation-scoped terminal supervisor | OPEN | No module-global latch; retained terminal, exact peer/quorum ACK, bounded teardown, duplicate idempotence. |
| No dual-run shared UI mutation | OPEN | Reward/market, biome/crossroads, Mystery/nested pickers use intent -> host result -> renderer projection only. |
| Presentation/control postconditions | PARTIAL | Sprite, bar, trainer chrome, menu, owner, enabled input, and phase projection have typed assertions. |

## P33 identity, seats, membership, and topology

| Requirement | State | Required proof |
|---|---|---|
| Opaque authenticated account IDs and signaling tickets | OPEN | Username spoof/case/NFKC/rename tests; Worker pairing binds peer hello to account IDs. |
| Transport role separated from authority role | OPEN | Both invitation directions resolve one authority without changing seats. |
| Stable run seat map | OPEN | Authority seat 0/1 resume; ownership survives reversed invitation. |
| P31/P32 role-tag migration | OPEN | Detached exact migration under reversed authority; unordered legacy visibly blocked. |
| Membership generation and frozen ACK quorum | OPEN | 2/3/6-seat model; stale/wrong/duplicate ACK rejected; disconnect never waives commit. |
| Seat+Pokémon command authorization | OPEN | Field transposition and duplicate species cannot spoof ownership. |
| Explicit battle topology | PARTIAL | Current triple indices accepted; authoritative topology carried in launch/turn/replacement/wave/recovery. |
| Six-player transport/gameplay | OUT OF CURRENT P33 RUNTIME, schema prerequisite open | Do not raise player-count constants until seat, membership, quorum, and topology proofs are green. |

## Save/resume correctness

| Requirement | State | Required proof |
|---|---|---|
| Host CAS before guest replication | IN PROGRESS | Deterministic host conflict emits no guest checkpoint; transient failure sends local-only mirrored debt. |
| Full local/cloud classification | IN PROGRESS | Solo/valid/invalid/opaque/missing/tombstoned/unavailable all fail or reconcile deterministically. |
| Duplicate convergence | IN PROGRESS | Same identity/seat only; highest revision or exact equal bytes; 3+, race, symmetric delete. |
| Tombstone exactness | IN PROGRESS | Exact backend proof before local/head/evidence removal; stale run cannot resurrect. |
| Immutable exact resume bytes | IN PROGRESS | Discovery carries selected raw JSON; commitment digest matches transmitted/materialized bytes. |
| Provisional versus committed checkpoint | OPEN (P33) | Only full persistence quorum promotes cold-resume head; previous committed head survives partial mirror. |
| Public resume with reversed invitation | OPEN | A invites B/save; B invites A/resume via UI; both retain owned Pokémon and continuation rights. |

## Human-production fidelity

| Journey/oracle | State | Required variants |
|---|---|---|
| Fresh lobby -> wave 1 -> reward/shop -> wave 2 | HARNESS EXISTS, NOT RUN | Both inviter directions; normal/fast/slow/asymmetric inputs; drop/delay/reorder/rejoin. |
| Save -> cold resume -> same continuation | HARNESS EXISTS, NOT RUN | Both authority seats; exact UI ownership and sprites. |
| Faint/replacement | HARNESS SCAFFOLD, fixture needed | Either owner faints; turn N/N+1 race; duplicate species; sprite/bar/command readiness. |
| Boss -> biome shop -> crossroads stay/leave -> next biome | PARTIAL engine harness | Wave 10 and 20; every choice; map and biome equality; public canvas input. |
| Mystery families | PARTIAL engine campaigns | Nonbattle, battle handoff, nested subpick, quiz, Delve repeats, Safari/catch-full, leave, post-event shop. |
| Trainer/wild presentation transition | PARTIAL | Trainer chrome clears/appears, both Pokémon sprites and bars present, delayed assets. |
| Browser hot rejoin | TRANSPORT ONLY | Same binding/seat generation plus live gameplay/control resume. |
| Distributed schedule replay | OPEN | Record send/deliver/apply/ACK/UI timestamps and replay delivery schedule across processes. |

## Assurance systems

| System | State | Definition of done |
|---|---|---|
| Cross-client causal tracing | PARTIAL | One causal ID from public input through intent, commit, material, renderer, readiness ACK, next surface. |
| Fault scheduler | PARTIAL | Drop/duplicate/delay/reorder/corrupt/reconnect every authority class and transition. |
| Mutation assurance | OPEN | Removing address/retention/apply stage/ACK/rollback/registry/postcondition causes a fast mandatory failure. |
| Semantic replay | PARTIAL | Submitted logs regenerate exact material/control boundary. |
| Browser render oracle | PARTIAL | Stable semantic markers plus screenshots for sprites, bars, menus, trainer chrome, map/biome. |
| CI sharding | IMPLEMENTED-UNVERIFIED | Exact final SHA finishes exhaustive aggregate green; no empty/duplicate assignment; compact artifacts. |
| Nightly campaigns | HISTORICAL ONLY | Six profiles green at exact final SHA, including Mystery/asymmetric and thirteen-event/biome journey. |

## Staging policy

An intermediate staging checkpoint may be promoted when its exact SHA has a green sharded aggregate including
static and browser transport, and its focused changed-surface proofs are green. It must remain functional for
multiplayer testers and be labeled with its known residuals. Architecture completion additionally requires all
OPEN/PARTIAL rows above to become GREEN with direct evidence at the final SHA. Production deployment remains
forbidden without explicit maintainer authorization.
