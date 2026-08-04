# Canonicalization oracle v1

Status: Wave 0 inventory for Milestones 0–2. This document records the behavior at
game SHA `3b534099919efae827019d4a3f3c4ab0ecd6d67b` and protocol `er-coop-47`.
The requested oracle branch is `ci/coop/v2-showdown-command-coordinate-20260720`.
The machine-readable contract is
[`schemas/kernel/source/canonicalization-v1.json`](../../../schemas/kernel/source/canonicalization-v1.json).

This is a compatibility inventory, not a protocol redesign. Every algorithm marked
`wire_exact` is an existing identity, digest, or ordering rule. Rust must reproduce
its observable output; it must not replace FNV-1a, FNV-1a-32, SHA-256, or the
existing JSON representation. BLAKE3 is permissible only for a new, explicitly
non-wire bundle-content hash; no current wire algorithm in this inventory uses it.

## Scope and evidence

Source citations use `path#Lx-Ly` against the oracle game SHA. The source file
inventory and all algorithm records are duplicated in the JSON contract so a
kernel tool can consume the same evidence without parsing this prose.

| Area | Primary source | Direct test evidence |
| --- | --- | --- |
| Battle checksum and state projection | `src/data/elite-redux/coop/coop-battle-checksum.ts#L33-L286`, `src/data/elite-redux/coop/coop-battle-engine.ts#L1690-L2526` | `test/tests/elite-redux/coop/coop-battle-checksum.test.ts#L72-L151`, `test/node/coop-battle-checksum.test.ts#L61-L94`, `test/tests/elite-redux/coop/coop-battle-checksum-engine.test.ts#L126-L184` |
| Checkpoint wire shape | `src/data/elite-redux/coop/coop-battle-checkpoint.ts#L88-L295` | `test/tests/elite-redux/coop/coop-battle-checkpoint.test.ts#L38-L177`, `test/tests/elite-redux/coop/coop-duo-launch-terrain.test.ts#L13-L29` |
| Replay trace | `src/data/elite-redux/replay-trace.ts#L41-L61`, `#L158-L336` | `test/tools/replay-recorder-checkpoint.test.ts`, `test/tests/elite-redux/coop/coop-duo-replay.test.ts` |
| Authority V2 wire validation and identity | `src/data/elite-redux/coop/authority-v2/authority-entry.ts#L34-L254`, `src/data/elite-redux/coop/authority-v2/contract.ts#L110-L377`, `src/data/elite-redux/coop/authority-v2/frame-codec.ts#L142-L180` | `test/node/authority-v2-replacement.test.ts#L145-L194`, `test/node/authority-v2-log.test.ts#L291-L325`, `test/node/authority-v2-frames.test.ts#L328-L349` |
| Authority V2 control IDs and ordering | `src/data/elite-redux/coop/authority-v2/next-control.ts#L46-L107`, `#L511-L871`, `src/data/elite-redux/coop/authority-v2/command-frontier.ts#L98-L121` | `test/node/authority-v2-control.test.ts#L279-L344`, `test/node/authority-v2-control-open.test.ts#L167-L258` |
| Authority V2 material digests | `src/data/elite-redux/coop/authority-v2/adapters/*.ts` (symbols cited below) | `test/node/authority-v2-turn.test.ts#L171-L180`, `#L337-L373`; `authority-v2-interactions-learn.test.ts#L206-L221`; `authority-v2-replacement.test.ts#L255-L320`; `authority-v2-interactions-mystery.test.ts#L205-L205`; `authority-v2-interactions-reward.test.ts#L246-L246`; `authority-v2-wave.test.ts#L282-L295`; `authority-v2-control-open.test.ts#L167-L177`; `authority-v2-cutover-interaction.test.ts#L252-L252` |
| Membership, run, report, durability | `src/data/elite-redux/coop/coop-session-binding.ts#L94-L151`, `coop-run-identity.ts#L13-L45`, `coop-report-correlation.ts#L74-L143`, `coop-durability.ts#L317-L352`, `#L848-L895` | `test/tests/elite-redux/coop/coop-membership-v2.test.ts#L15-L33`, `test/utils/report-correlation.test.ts#L90-L109`, durability/co-op authority node tests |
| Protocol and diagnostics | `src/data/elite-redux/coop/coop-transport.ts#L135-L138`, `coop-rendezvous.ts#L41-L65`, `coop-mutation-ledger.ts#L64-L72`, `authority-v2/authority-log.ts#L1078-L1080` | `test/node/authority-v2-frames.test.ts`, `test/tests/elite-redux/coop/coop-rendezvous.test.ts`, `test/node/authority-v2-mutation-ledger.test.ts`, `test/node/authority-v2-log.test.ts` |

No co-op Vitest file was run locally. The tests cited above are source evidence for
the existing behavior; local verification is limited to JSON parsing and static
checks as required by the co-op instructions.

## Canonical JSON functions

### Core battle canonicalizer

`canonicalize(value)` in
`src/data/elite-redux/coop/coop-battle-checksum.ts#L223-L263` is the principal
canonical JSON function. It is deterministic and reproducible, subject to the
explicit undefined caveat below:

```text
null                         -> "null"
finite number                -> canonNumber(number)
boolean                      -> "true" or "false"
string                       -> native JSON.stringify(string)
array                        -> "[" + members in caller order + "]"
plain object                 -> keys sorted with JS default UTF-16 order,
                                then JSON.stringify(key) and value recursion
undefined/function/symbol    -> "null" (state types forbid these values)
non-finite number            -> "0"
-0 or 0                      -> "0"
safe/integer-shaped number   -> number.toString()
other finite number          -> number.toPrecision(12)
```

Arrays are never sorted by this function. Callers must sort semantic sets before
passing them to `canonicalize`. Object-key sorting is explicit; it is different
from the insertion-order behavior of ordinary `JSON.stringify` described later.

The core hash `fnv1a64(text)` at
`src/data/elite-redux/coop/coop-battle-checksum.ts#L270-L282` consumes UTF-16
`charCodeAt` units, masks after each BigInt multiplication, and emits lowercase
16-character hexadecimal. Its constants are offset `0xcbf29ce484222325`, prime
`0x100000001b3`, mask `0xffffffffffffffff`.

The same core canonicalizer/hash is imported by the battle engine, data
fingerprints, operation staging, battle stream, and runtime adapters. It is not
safe to substitute a Rust JSON serializer with different number, Unicode, key, or
array behavior.

### Authority V2 local canonicalizers

Authority V2 has several private copies. Their similar names do not make them one
algorithm; retain the per-surface output format.

| Symbol and source | Input and normalization/order | Output and consumers | Rust rule |
| --- | --- | --- | --- |
| `canonicalize` in `authority-v2/adapters/turn-command.ts#L735-L760` | Null/undefined become `null`; non-finite and signed zero become `0`; integer uses `toString`; fractional uses `toPrecision(12)`; strings use JSON.stringify; arrays preserve order; object keys use default `.sort()` | Canonical text; `computeTurnCommitDigest` hashes it | `wire_exact` |
| `canonicalize` in `authority-v2/adapters/interactions-learn.ts#L845-L870` | Same number/string/array/key rules as turn-command; undefined also becomes `null` | Canonical text; `interactionMaterialDigest` hashes it | `wire_exact` |
| `canonicalJson` in `authority-v2/adapters/faint-replacement.ts#L300-L315` | Primitive uses JSON.stringify with `"null"` fallback; object keys are sorted and recursively emitted. There is no explicit array branch in this helper; replacement input is an object image | Canonical text; `replacementImageDigest` hashes it | `wire_exact` |
| `canonicalJson` in `authority-v2/adapters/interactions-mystery.ts#L304-L318` | Primitive JSON.stringify/null fallback; arrays preserve order; object keys sorted | Canonical text; `interactionMaterialDigest` hashes it | `wire_exact` |
| `canonicalJson` in `authority-v2/adapters/interactions-reward.ts#L105-L119` | Primitive JSON.stringify/null fallback; arrays preserve order; object keys sorted | Canonical text; `digestOfInteractionMaterial` hashes it | `wire_exact` |
| `canonicalJson` in `authority-v2/adapters/wave-terminal.ts#L208-L222` | Primitive JSON.stringify/null fallback; arrays preserve order; object keys sorted | Canonical text; `digestOfMaterial` hashes it | `wire_exact` |
| `canonicalJson` in `authority-v2/adapters/control-open.ts#L334-L346` | Primitive JSON.stringify/null fallback; arrays preserve order; object keys sorted | Canonical text; command/interaction-open digests hash it | `wire_exact` |
| `canonicalJson` in `authority-v2/cutover-interaction.ts#L489-L501` | Primitive JSON.stringify/null fallback; arrays preserve order; object keys sorted | Canonical text; envelope digest and equality checks use it | `wire_exact` |
| `canonicalJson` in `coop-me-pin-state.ts#L169-L182` | Primitive JSON.stringify may return undefined; arrays preserve order; object keys sorted | Local active-control equality only | `local_only` |
| `canonicalMeOutcomeWithoutAuthority` in `coop-me-operation.ts#L480-L495` | Removes authoritative state and the publication-order `base.tick`, then calls core `canonicalize` | Local/operation outcome equivalence | `wire_exact` for the core canonical comparison |
| `canonicalize` use in `coop-wave-operation.ts#L726-L780` | Canonicalizes the staged envelope/payload after the operation-specific projection | Staged same-operation conflict/equality | `wire_exact` |

`freezeInteractionWireMaterial` in
`authority-v2/cutover-interaction.ts#L521-L544` first performs
`JSON.parse(JSON.stringify(material))`; the digest is over that JSON-wire image,
not over an object retaining undefined properties. This round trip is an
intentional authority/replica compatibility boundary.

## Wire digests

The following are existing wire or authority identities. Their algorithms must be
matched exactly by a Rust implementation. `BLAKE3` is not an acceptable
replacement for any row in this section.

### Legacy battle and persistence digests

| Symbol and source | Input shape and normalization/order | Output encoding; consumers | Tests; Rust |
| --- | --- | --- | --- |
| `checksumState` in `coop-battle-checksum.ts#L284-L286` | `CoopChecksumState`; object keys are core-sorted. Engine projects field mons sorted by `bi`, weather/terrain type only, arena tags by `(tagType, side)` with counters excluded, modifiers/held items/ball counts by their documented keys; party, bench, moves, and tags retain slot/list order | Raw lowercase 16-hex FNV-1a-64; battle checksum comparisons and fault convergence | checksum tests above; `wire_exact` |
| `fnv1a64` in `coop-battle-checksum.ts#L275-L282` | UTF-16 code units of canonical text; BigInt mask after each multiply | Lowercase 16-hex string | checksum tests above; `wire_exact` |
| `captureCoopSaveDataDigest` in `coop-battle-engine.ts#L1915-L2249` | `getSessionSaveData`; excludes `playTime`, `timestamp`, `name`, `coopParticipants`, `coopRun`, `arena`, `party`, `enemyParty`, `enemyModifiers`, `mysteryEncounterSaveData`, `mysteryEncounterType`, `erAchievementRunState`, `trainer`, `score`, `playerFaints`, `erUsedTrainerKeys`, `waveIndex`, `battleType`, `coopControlPlane`. Map/relic/modifier/mon-keyed fields receive special projections; final core canonicalization sorts object keys and preserves arrays | Raw 16-hex FNV-1a-64; `CoopChecksumState.saveDataDigest` | determinism and fault tests; `wire_exact` |
| `hashMonMoveset` / `readBenchMovesDigest` in `coop-battle-engine.ts#L2285-L2339` | Moveset maps to `[moveId, ppUsed]` in move-slot order; bench entries retain party slot order | Each moveset is core FNV-1a-64 text; bench digest is the existing projected field digest | engine checksum tests; `wire_exact` |
| `coopWaveStartEntryEffectSignature` in `coop-battle-engine.ts#L2876-L2879` | Removes `tick` from the publication material, then core-canonicalizes the state; live capture is used if no state is passed | Canonical signature text (not a second digest) | wave/engine tests; `wire_exact` |
| `coopSnapshotControlDigest` in `coop-runtime.ts#L600-L617` | Builds `{checksum, sessionEpoch, membership, activeControl, journalHighWater: ?? {}}`, JSON round-trips to drop undefined exactly as transport does, then core-canonicalizes | Raw 16-hex FNV-1a-64; snapshot-control comparison | runtime/authority tests; `wire_exact` |
| `coopV2RecoveryMaterialDigest` in `coop-runtime.ts#L1385-L1395` | Core-canonicalizes the recovery payload as supplied by the V2 recovery path | Raw 16-hex FNV-1a-64 | authority recovery tests; `wire_exact` |
| Legacy battle-stream tombstone digest in `coop-battle-stream.ts#L1302-L1332`, `#L1881-L1936` | Core-canonicalizes normalized authority envelopes; canonical text is retained for equality/conflict checks | Raw 16-hex FNV-1a-64 in retired tombstones | battle-stream tests; `wire_exact` |
| Shadow wave/terminal `legacyDigest` in `coop-runtime.ts#L8362-L8420` | Core-canonicalizes the transition image before the adapter-specific digest is computed | Raw 16-hex FNV-1a-64 legacy parity digest | runtime/co-op boundary tests; `wire_exact` |

`captureCoopChecksumState` at
`coop-battle-engine.ts#L2343-L2412` is the authority-oriented projection, while
`captureVersusGuestChecksumState` at `#L2446-L2526` swaps field/arena orientation
and uses the enemy party for guest perspective. The orientation swap is part of
the digest contract, not a presentation detail.

### Authority V2 material digests

| Symbol and source | Input shape and normalization/order | Output encoding; consumers | Tests; Rust |
| --- | --- | --- | --- |
| `computeTurnCommitDigest` in `authority-v2/adapters/turn-command.ts#L294-L312` | Selected turn-resolution image plus checkpoint and present companions; private canonicalizer above | Raw lowercase 16-hex FNV-1a-64 | `authority-v2-turn.test.ts#L171-L180`, `#L337-L373`; `wire_exact` |
| `interactionMaterialDigest` in `authority-v2/adapters/interactions-learn.ts#L392-L400` | Learn material image; private canonicalizer above | `ic1-${surface}-${16-hex FNV-1a-64}` | `authority-v2-interactions-learn.test.ts#L206-L221`, `#L369-L370`; `wire_exact` |
| `replacementImageDigest` in `authority-v2/adapters/faint-replacement.ts#L300-L333` | Replacement commit image; sorted-object canonical text; private FNV-1a-32 uses `Math.imul` and UTF-16 units | `rc1-${canonical.length}-${8-hex FNV-1a-32}` | `authority-v2-replacement.test.ts#L255-L320`; `wire_exact` |
| `interactionMaterialDigest` in `authority-v2/adapters/interactions-mystery.ts#L304-L337` | Mystery interaction material; arrays preserve order and object keys sort | `ix1-${material.kind}-${canonical.length}-${8-hex FNV-1a-32}` | `authority-v2-interactions-mystery.test.ts#L205`; `wire_exact` |
| `digestOfInteractionMaterial` in `authority-v2/adapters/interactions-reward.ts#L105-L144` | Reward material; sorted object keys, order-preserving arrays | `${material.kind}:${8-hex FNV-1a-32}` | `authority-v2-interactions-reward.test.ts#L246`; `wire_exact` |
| `digestOfMaterial` in `authority-v2/adapters/wave-terminal.ts#L208-L242` | Wave-terminal material; sorted object keys, order-preserving arrays | `${material.kind}:${8-hex FNV-1a-32}` | `authority-v2-wave.test.ts#L282`, `#L295`; `wire_exact` |
| `commandOpenMaterialDigest` / `interactionOpenMaterialDigest` in `authority-v2/adapters/control-open.ts#L219-L224`, `#L334-L355` | Open-material image; sorted object keys and order-preserving arrays | `command-open:${8-hex FNV-1a-32}` or `interaction-open:${8-hex FNV-1a-32}` | `authority-v2-control-open.test.ts#L167-L177`, `#L230-L258`; `wire_exact` |
| `digestOfCoopV2InteractionEnvelope` in `authority-v2/cutover-interaction.ts#L489-L513` | Frozen JSON-wire material after stringify/parse; sorted object keys, order-preserving arrays | `interaction-envelope-v1:${8-hex FNV-1a-32}` | `authority-v2-cutover-interaction.test.ts#L252`, `#L646-L663`; `wire_exact` |

The `FNV-1a-32` rows use the source implementation's 32-bit `Math.imul`/shift
semantics and UTF-16 code units. The `FNV-1a-64` rows use the BigInt constants
listed above. Prefixes, decimal canonical-text lengths, and surface/kind strings
are all wire data.

## Content hashes and bundle fingerprints

These are content or dataset identities rather than battle-step checksums. Existing
wire/content identities remain exact. A future Rust-only bundle file may choose
BLAKE3, but that choice must not leak into any existing frame, digest, proposal,
seat-map, or replay identity.

| Symbol and source | Input shape and normalization/order | Output encoding; consumers | Tests; Rust |
| --- | --- | --- | --- |
| `canonicalCoopSeatMapPayload` / `sha256Hex` in `coop-session-binding.ts#L94-L151` | Validated account IDs are sorted by default JS UTF-16 lexical order, assigned dense seat IDs, then object literal `{version:1, revision:1, seats:[...]}` is JSON-stringified in insertion order. SHA-256 hashes UTF-8 `TextEncoder` bytes | Lowercase 64-hex SHA-256 becomes `seatMapId`; validation recomputes exact payload/hash | `coop-membership-v2.test.ts#L15-L33`, `coop-p33-client.test.ts#L264-L265`; `wire_exact` |
| `computeErDataFingerprint` in `coop-data-fingerprint.ts#L83-L199` | Each section uses numeric ID sorting: move map, move data (name excluded), move names, movesets (species keys numeric; value arrays preserve order), ability data/name; absent section contributes FNV-1a-64 of empty text | `ErDataFingerprint` object with six `{n, hash}` sections; data negotiation/compatibility consumers | `test/tests/elite-redux/coop/coop-data-fingerprint.test.ts`; `wire_exact` |
| `hashOf` in `coop-data-fingerprint.ts#L83-L85` | Core-canonicalizes each already-normalized section and applies shared FNV-1a-64 | Lowercase 16-hex section hash consumed by all six data sections | `test/tests/elite-redux/coop/coop-data-fingerprint.test.ts`; `wire_exact` |
| `dexEntryFingerprint` in `coop-battle-engine.ts#L5024-L5033` | Entry fields in fixed order: `seenAttr|caughtAttr|natureAttr|seenCount|caughtCount|hatchedCount`; BigInt attributes use their decimal string form | Non-cryptographic comparison string used for dex baseline equality | No dedicated direct dex fingerprint test found by `rg`; static source evidence only; `wire_exact` |
| `captureCoopDexBaseline` / delta JSON in `coop-battle-engine.ts#L5038-L5048`, `#L5000-L5010` | `Object.entries` data order is retained; starter entries use native `JSON.stringify`; dex BigInt attributes are converted to decimal strings for JSON/compression and restored with `BigInt` | Existing JSON/compressed delta wire payload; not a canonical digest | No dedicated direct dex delta test found by `rg`; static source evidence only; `wire_exact` |
| `captureCoopMeOutcome` in `coop-battle-engine.ts#L5470-L5475` | Party entries map in party order with native JSON.stringify; ME save data uses native JSON.stringify | Outcome object carrying insertion-order JSON strings | `test/tests/elite-redux/coop/coop-duo-me-operation.test.ts`; `wire_exact` |
| `snapshotMarksCanonical` in `coop-durability.ts#L874-L895` | Snapshot mark object keys are sorted first; records are safe nonnegative sequences; JSON.stringify then has deterministic constructed insertion order | Existing durability/snapshot comparison string | durability tests; `wire_exact` |

There is no observed BLAKE3 implementation in the audited paths. “BLAKE3 allowed”
therefore describes only a future non-wire content-bundle layer, not an optimization
for any row above.

## Operation IDs and identity strings

Operation and identity strings are not interchangeable with digests. Preserve their
exact separators, percent encoding, normalization, and numeric formatting.

| Symbol and source | Input shape and normalization/order | Output encoding; consumers | Tests; Rust |
| --- | --- | --- | --- |
| `makeCoopOperationId` / `parseCoopOperationId` in `coop-operation-envelope.ts#L596-L635` | Four components: epoch, owner, kind, pinned sequence. Parser splits exactly four pieces, converts numeric pieces with `Number`, checks `Number.isInteger`, and validates known kind | `${epoch}:${owner}:${kind}:${pinnedSeq}`; all operation modules and authority admission | operation-envelope, wave, ME, and authority node tests; `wire_exact` |
| `isValidOperationId` / `hasValidDigest` in `authority-v2/authority-entry.ts#L34-L69` | Nonempty bounded string (max 256) with no ASCII C0/DEL control characters; digest uses the same bounded string policy | Boolean validation, original text unchanged | `authority-v2-replacement.test.ts#L145-L194`; `wire_exact` |
| `controlIdOf` in `authority-v2/next-control.ts#L46-L107` | Kind-specific address; numeric wave/turn/seat/index/occurrence segments are decimal; opaque IDs/surface/kind/terminal are `encodeURIComponent`-encoded. Command targets and allowed address lists are canonicalized before encoding | Complete control address string used as `activeControl`, next-control, and receipt identity | `authority-v2-control.test.ts#L279-L344`; `wire_exact` |
| `canonicalCommandTargets` in `authority-v2/next-control.ts#L552-L558` | Clone then numeric sort by `fieldIndex`, `ownerSeatId`, `pokemonId` | Canonical command target list embedded in control ID | control tests; `wire_exact` |
| `replacementOperationId` in `authority-v2/adapters/faint-replacement.ts#L347-L365` | Stable operation-window address plus owner; selected result/resolution is deliberately excluded | Replacement proposal/operation ID | `authority-v2-replacement.test.ts#L255-L320`; `wire_exact` |
| `canonicalCoopParticipantPair` / `normalizeCoopIdentity` in `coop-run-identity.ts#L13-L33` | Compare NFKC-normalized, lowercased identities with JS relational UTF-16 ordering, but return original strings in ordered pair | Pair identity for participant/run consumers | session-controller/resume-marker tests; `wire_exact` |
| `runtimeId` construction in `authority-v2/session-identity.ts#L35-L90` | Authenticated binding uses `${sessionId}:seat${localSeatId}`; unbound loopback uses `${runId}:seat${localSeatId}` and shadow seat-map ID | Runtime identity plus session/run/seat-map binding | `authority-v2-session-identity.test.ts#L58-L132`; `wire_exact` |
| `operationCausalId` in `coop-durability.ts#L848-L862` | Ordinary IDs matching the bounded format are preserved; anomalous IDs are represented with epoch/sequence plus an FNV-1a-32 UTF-16 digest and source length | Durable causal/log diagnostic identity | durability tests; `wire_exact` |
| `pairKey` / `formatCoopReportCorrelation` in `coop-report-correlation.ts#L74-L143` | Pair key uses encoded session/run/epoch/seed; missing values use `-`; correlation object uses explicit null for absent binding/membership/seat and native JSON.stringify | `coop-v1|...` marker and newline JSON diagnostic payload | `test/utils/report-correlation.test.ts#L90-L109`; `wire_exact` |
| `mintCoopRunId` in `coop-run-identity.ts#L36-L45` | UUID/getRandomValues source, bounded by `[A-Za-z0-9_-]{16,128}` | Volatile ASCII run ID used by session/resume identity | membership/session tests; `wire_exact` for format |
| `isSameSessionIdentity` / `receiptMatchesEntry` in `authority-v2/authority-entry.ts#L227-L236` | Exact sessionId/runId/seatMapId or revision/operationId equality | Boolean authority identity predicates | authority frame/replacement tests; `wire_exact` |
| `boundedRendezvousPoint` / `rendezvousPointAddress` in `coop-rendezvous.ts#L41-L65` | Bounded lowercase point passes unchanged; otherwise FNV-1a-32 UTF-16 fallback includes source length; wave/turn extraction accepts safe nonnegative integers | `point#${8-hex}:len=${length}` diagnostic point or optional address coordinates | `test/tests/elite-redux/coop/coop-rendezvous.test.ts`; `wire_exact` for externally compared point text |
| `COOP_ABILITY_ACTION_STRIDE`, `COOP_COLOSSEUM_ACTION_STRIDE`, `COOP_REWARD_ACTION_STRIDE` in `coop-operation-address.ts#L16-L22` | Fixed allocation strides 100, 100, and 100000 | Numeric operation address allocation constants | operation address consumers; `wire_exact` |

`coop-operation-envelope.ts` has a comment describing the operation ID as three
components, but the implementation and parser require four. The implementation is
the compatibility rule; see risk `operation-id-comment` below.

## Proposal fingerprints and admission identity

Proposal admission stores an opaque fingerprint and proves only that one operation
ID is consistently paired with one fingerprint. It does not canonicalize or hash
the producer's string.

| Symbol and source | Input shape and normalization/order | Output encoding; consumers | Tests; Rust |
| --- | --- | --- | --- |
| Guest interaction fingerprint in `coop-interaction-relay.ts#L1991-L2005` | Fixed array `[msg.seq, msg.kind, msg.choice, msg.data ?? null, msg.rewardSurface ?? null]`; array order is fixed, nested data order follows native JSON.stringify | Native insertion/order-sensitive `JSON.stringify` text passed to `authorityProposalAdmissions.admit` | `test/tests/elite-redux/coop/coop-interaction-relay.test.ts#L333-L407`, `test/node/authority-v2-proposal-admission.test.ts#L11-L36`; `wire_exact` |
| Bargain outcome fingerprint in `coop-interaction-relay.ts#L2141-L2148` | Fixed array `[msg.seq, msg.kind, msg.outcome]` | Native JSON.stringify text passed to proposal admission | relay tests above; `wire_exact` |
| `CoopV2ProposalAdmissionLedger.admit` in `authority-v2/proposal-admission.ts#L15-L62` | Operation ID and nonempty opaque fingerprint; same pair is duplicate, same operation with different fingerprint is conflict; capacity is a safe positive integer | No new encoding; stores caller-provided fingerprint exactly | `authority-v2-proposal-admission.test.ts#L11-L36`; `wire_exact` |
| `ProposalLeaseManager` fingerprint handling in `authority-v2/proposal-lease.ts#L36-L92` | Nonempty stable caller-provided fingerprint; same ID/fingerprint retains lease, different fingerprint conflicts | No new encoding; opaque equality | `test/node/authority-v2-proposal-lease.test.ts`; `wire_exact` |
| `stageCoopWaveAdvanceEnvelope` / `isExactStagedWavePayload` in `coop-wave-operation.ts#L726-L780` | Operation ID's staged envelope/payload is core-canonicalized; same operation with changed canonical payload conflicts | Canonical text retained for proposal/retry equality | wave operation tests; `wire_exact` |
| ME `identity` in `coop-me-operation.ts#L192-L215` | Core-canonicalizes `{pinned, step, payload}` for same-operation identity; outcome comparison separately strips authority/tick at `#L480-L495` | Canonical text, not a new digest | `test/tests/elite-redux/coop/coop-duo-me-operation.test.ts`; `wire_exact` |

Do not “improve” the legacy proposal arrays by sorting object keys or replacing
their JSON text with a digest: the admission ledger intentionally treats the
producer's existing fingerprint as opaque wire identity.

## Ordering rules

The following distinctions are essential to a Rust port.

| Rule | Exact behavior and source evidence |
| --- | --- |
| Core object keys | `Object.keys(obj).sort()` using JS default UTF-16 code-unit ordering, then recursive values; `coop-battle-checksum.ts#L231-L240`. |
| Local V2 object keys | Each listed `canonicalize`/`canonicalJson` copy also uses default `.sort()`; none uses locale collation. |
| Core arrays | Preserve caller order. Semantic sets are sorted by their caller (`sortCoopChecksumTagIds`, `sortCoopChecksumArenaTags`, engine projections); `coop-battle-checksum.ts#L33-L42`, `#L223-L246`. |
| Field/party/bench order | Field mons sort by `bi`; party species/levels, bench HP, bench moves, move slots, and other list-shaped state retain slot order; `coop-battle-engine.ts#L1696-L1910`, `#L2255-L2339`. |
| Arena/modifier/item order | Arena tags sort `(tagType, side)` and omit counters; weather/terrain keep type identity only; modifiers sort type ID; held items sort `(bi, typeId, stackCount)`; ball counts sort numeric ball type; same engine ranges. |
| Save-data maps | The session projection iterates entries, applies special normalizers, and final core canonicalization sorts object keys; arrays remain ordered. Keyed mon entries sort by their canonicalized entry text; modifier blobs sort type ID then canonicalized args; `coop-battle-engine.ts#L2020-L2175`. |
| Control command targets | Numeric `(fieldIndex, ownerSeatId, pokemonId)` ascending; `next-control.ts#L552-L558`. |
| Control kinds/addresses | Successor kinds use the declared `AUTHORITY_ENTRY_KIND_ORDER`; interaction kinds and opaque IDs use default lexical `.sort()`; allowed addresses use default lexical sort; `next-control.ts#L827-L871`. |
| Control `remaining` | The supplied sequence is preserved and validated for strictly increasing occurrence; it is not sorted by control ID; `next-control.ts#L650-L720`. |
| Membership seats | Account IDs are normalized for validation and sorted default UTF-16 lexical before dense seat assignment; seat array order is then preserved in the payload; `coop-session-binding.ts#L94-L110`. |
| Identity pair | NFKC+lowercase is used for comparison only; original identity strings are returned in normalized order; `coop-run-identity.ts#L13-L33`. |
| Replay | Events are ordered; roster/party arrays are ordered; owner derives from sequence parity; `replay-trace.ts#L158-L243`, `#L268-L336`. |
| Checkpoint | `mons`, moves, tags, and event-like arrays preserve caller order; sanitization truncates/clamps values but does not sort; `coop-battle-checkpoint.ts#L155-L277`. |
| Ordinary JSON.stringify | Frame encoding, session-map payload, proposal fingerprints, report correlation, durability messages, dex/starter data, and `modifierInstanceKey` use native JavaScript property-enumeration/array-order semantics (including integer-index key behavior); `frame-codec.ts#L142`, `coop-session-binding.ts#L105-L117`, relay/durability/engine citations above. They are not interchangeable with core canonical JSON. |
| Control owners | `controlOwnerSeatIds` deduplicates and numerically sorts command owners; terminal/await controls have no owners; `next-control.ts#L511-L520`. |
| Modifier identity | `modifierInstanceKey` concatenates `typeId`, `className`, and two insertion-order JSON arrays with `|`; `coop-battle-engine.ts#L3211-L3212`. |
| Authority pending identity | `authority-log.ts#L1078-L1080` compares the material digest and native JSON.stringify of `nextControl`/`subsumes`; it does not apply core key sorting. |
| Diagnostic labels | `CoopMutationLedger.snapshot` sorts active labels with default lexical order; `coop-mutation-ledger.ts#L64-L72`. |
| Hash text encoding | FNV rows consume UTF-16 code units; the seat-map SHA-256 row consumes UTF-8 TextEncoder bytes. |

## Absent and null rules

1. Core `canonicalize` maps an encountered `undefined`, function, or symbol to the
   text `null`, but the battle state type and Authority V2 wire validator do not
   permit these values. This fallback is not an absent-preserving encoding
   (`coop-battle-checksum.ts#L223-L246`; `authority-entry.ts#L80-L145`).
2. `isWireStableJsonValue` rejects undefined, non-finite numbers, sparse arrays,
   cycles, symbols/functions, and non-plain prototypes. Arrays must be dense and
   object properties must be JSON-stable (`authority-entry.ts#L80-L145`).
3. Native `JSON.stringify` omits object properties whose value is undefined and
   serializes undefined array entries/non-finite array values as null. It therefore
   cannot be treated as the core canonicalizer. `freezeInteractionWireMaterial`
   deliberately performs stringify/parse first so the digest sees the transport
   image (`cutover-interaction.ts#L521-L544`).
4. Checkpoint serializers omit optional values when absent/undefined. Explicitly
   supplied `arenaTags: []` remains present, while absent `arenaTags` is omitted;
   optional form, ability, tera, owner, status substate, and tags follow the same
   omission rules (`coop-battle-checkpoint.ts#L155-L277`).
5. Replay `coop`, `endState`, `checkpoint`, and optional checkpoint target are
   absent when not supplied; target is only accepted as undefined or an integer
   (`replay-trace.ts#L214-L243`, `#L268-L336`).
6. Relay proposal arrays deliberately normalize absent `data` and
   `rewardSurface` with `?? null`; this is distinct from the omitted optional
   fields in checkpoint/replay (`coop-interaction-relay.ts#L1991-L2005`).
7. Authority V2 control fields use explicit null as a wildcard: null
   `operationIds`, allowed kinds, or allowed addresses encode as `*`; a missing
   field is not a wildcard (`authority-v2/contract.ts#L317-L377`,
   `next-control.ts#L827-L871`).
8. `coopSnapshotControlDigest` JSON-round-trips `journalHighWater: ?? {}` so
   undefined properties are removed exactly as on the wire; explicit null is
   retained (`coop-runtime.ts#L600-L617`).

## Integer assumptions and observed floats

The code does not compare against a literal `Number.MAX_SAFE_INTEGER`; it uses
`Number.isSafeInteger` at the authoritative boundaries. A Rust port must still use
the JS-safe range `[-(2^53-1), 2^53-1]` where the source says safe integer.

| Source rule | Evidence and consequence |
| --- | --- |
| Authority entry/context | Revisions, session epoch, membership revision, sender/authority seats, connection generation, and subsumption revisions require safe integers; revisions are positive; `authority-entry.ts#L48-L69`, `#L176-L220`. |
| Authority controls/ledger | Wave/turn/index/seat/occurrence coordinates and bounded revision windows validate safe integer ranges; command frontier filters/sorts safe `bi`; `next-control.ts#L580-L606`, `authority-ledger.ts#L56-L164`, `command-frontier.ts#L98-L121`. |
| Engine authoritative state | Checkpoint tick/wave/turn, seat `bi`/partyIndex/pokemonId, and array entries use `Number.isSafeInteger` validation around `coop-battle-engine.ts#L2732`, `#L3153`, `#L3450-L3613`. |
| Replay | Uses `Number.isInteger`, not `Number.isSafeInteger`, for wave/turn/slot/sequence/choice/indices; `replay-trace.ts#L268-L336`. This weaker legacy boundary is intentional compatibility behavior. |
| Operation ID parser | `parseCoopOperationId` uses `Number.isInteger`, not `Number.isSafeInteger`; `coop-operation-envelope.ts#L606-L635`. Callers may add safe checks, but the parser itself is weaker. |
| Checkpoint coercion | HP/max HP, money, move PP, stage values, status counters, arena turns/layers, and weather/terrain counters are finite/truncated/floored/clamped as specified; `coop-battle-checkpoint.ts#L95-L218`, `#L222-L277`. |
| Core canonical float path | Finite fractional values use `toPrecision(12)`; `-0` becomes `0`; NaN/Infinity become text `0`; `coop-battle-checksum.ts#L249-L263`. |
| V2 canonical float paths | Turn/learn private canonicalizers use the same `toPrecision(12)`/nonfinite-to-zero rule. Other adapter canonicalJson helpers defer primitive behavior to JSON.stringify, where non-finite primitives become `null`; validators reject non-finite committed material first. |
| BigInt | FNV-64 uses BigInt internally but emits a string. Dex `seenAttr`/`caughtAttr` are BigInt and use decimal strings in JSON/delta transport; `coop-battle-engine.ts#L5000-L5033`. |
| Relevant observed float use | The canonical state paths allow/observe fractional-number normalization only in `canonNumber` and private turn/learn copies. Checkpoint inputs may be fractional before truncation. Other gameplay floats/backoff calculations are outside canonical state and must not be inferred as wire fields. |

## Compatibility risks and stop-condition evidence

The current algorithms are reproducible from source, so the “cannot reproduce
canonicalization” stop condition was not triggered. The following boundaries must be
carried forward verbatim:

| ID | Evidence | Impact and required action |
| --- | --- | --- |
| `duplicate-canonicalizers` | Core, turn/learn, and six other V2 adapters each implement a private canonicalizer; citations in the canonical JSON table | Small semantic differences exist (undefined handling, primitive non-finite handling, and faint replacement's lack of an array branch). Keep one explicit implementation per wire surface and test against its source behavior. |
| `json-order-is-not-canonical` | `frame-codec.encodeFrameV2`, seat-map payload, relay proposals, durability messages, report correlation, dex/starter data, and `modifierKey` call native JSON.stringify | Do not route insertion-order wire identities through core key sorting. Rust must reproduce JS property/array emission for those existing payloads. |
| `absent-vs-null` | Core undefined fallback is null; JSON.stringify omits object undefined; Authority V2 rejects undefined; cutover freezes by stringify/parse | Raw core canonicalization cannot preserve absence. Apply the source-layer validator/round trip first and preserve explicit null. |
| `unsafe-operation-parser` | `parseCoopOperationId` checks `Number.isInteger`, while authority entries and engine validation check `Number.isSafeInteger` | A mathematically valid but JS-unsafe operation ID can parse; do not silently strengthen the parser in a compatibility path. Validate at the same caller boundary as the source. |
| `operation-id-comment` | `makeCoopOperationId` emits four components although its comment describes three; parser requires four (`coop-operation-envelope.ts#L596-L635`) | Use emitted four-component form as oracle. |
| `mixed-hash-encodings` | Core/V2 FNV hashes consume UTF-16; seat-map SHA-256 consumes UTF-8; V2 prefixes/lengths differ | Do not replace existing wire digests or normalize all hashes to one Rust primitive. |
| `wildcard-null` | V2 contract has nullable `operationIds`/allowed domains and `next-control` encodes null as `*` | Preserve null wildcard versus omitted field. |
| `remaining-order` | `next-control` validates increasing occurrence in supplied `remaining` sequence instead of sorting it | Preserve sequence order; sorting changes control IDs. |
| `legacy-fingerprint-opacity` | Proposal admission/lease compares producer fingerprint strings for equality and never re-canonicalizes them | Keep relay `JSON.stringify` fingerprints exactly; do not replace with a new digest. |
| `seat-map-sha` | Membership binds `seatMapId` to SHA-256 of a specific UTF-8 JSON payload | BLAKE3 is not permitted for this identity. |
| `source-branch-availability` | The requested oracle branch name was supplied by the task, but is not a local ref in the worker checkout; inventory is anchored to the explicit base SHA | Any branch-only delta must be audited separately before changing this oracle. |

No contradictory identity formatting was found in the audited rules beyond the
operation-ID comment/implementation mismatch documented above. The source does
provide enough information to reproduce current canonical text and wire digests;
the remaining risk is implementation drift between duplicated helpers.

## Layer classification

| Layer | Symbols | Classification and Rust requirement |
| --- | --- | --- |
| Legacy battle wire | `canonicalize`, `fnv1a64`, `checksumState`, engine checksum/save/bench projections, runtime snapshot and battle-stream tombstone digests | Existing cross-peer/checkpoint identity; `wire_exact`. |
| Authority V2 wire | Adapter material digests, `controlIdOf`, control frontier ordering, `isWireStableJsonValue`, frame JSON encoding, proposal admission/lease | Existing authority/replica/control identity; `wire_exact`. |
| Membership/run identity | Seat-map SHA-256, seat assignment, session runtime ID, normalized participant pair | Existing authenticated/session identity; `wire_exact`. |
| Persistence/replay | Checkpoint serializer, replay validation/ordering, durability canonical comparisons, dex delta/fingerprint, data fingerprint | Existing save/replay/data compatibility; `wire_exact` for current payloads and comparisons. |
| Local/diagnostic | `coop-me-pin-state.canonicalJson`, mutation-ledger sorted labels, rendezvous fallback FNV address, report formatting outside its pair-key identity | Local equality or diagnostic presentation; not a new gameplay digest. Keep exact where externally compared, otherwise `local_only`. |
| Future bundle content | No current source symbol | `bundle_content_blake3_allowed` only for a newly specified non-wire bundle hash; never use it to replace a row above. |
