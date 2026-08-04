# Canonicalization oracle v1

Project: **PokéRogue Redux**. “Elite Redux” is a legacy source/path/protocol
identifier only; its appearance in paths such as `src/data/elite-redux/` and in
protocol `er-coop-47` does not name the current project.

Status: Wave 0 inventory for Milestones 0–2. This document records the behavior at
game SHA `3b534099919efae827019d4a3f3c4ab0ecd6d67b` and protocol `er-coop-47`.
The requested oracle branch is `ci/coop/v2-showdown-command-coordinate-20260720`.
The machine-readable contract is
[`schemas/kernel/source/canonicalization-v1.json`](../../../schemas/kernel/source/canonicalization-v1.json).

This is a compatibility inventory, not a protocol redesign. Every algorithm marked
`wire_exact` is an existing identity, digest, or ordering rule. Rust must reproduce
its observable output; it must not replace FNV-1a, FNV-1a-32, SHA-256, or the
existing JSON representation. No BLAKE3 implementation or BLAKE3 policy was
observed in the audited source, so none is part of this oracle.

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
Number.isInteger(number)     -> number.toString()
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
| `canonicalize` / `canonNumber` in `authority-v2/adapters/turn-command.ts#L740-L772` | Null/undefined become `null`; non-finite and signed zero become `0`; `Number.isInteger` selects `toString`; fractions use `toPrecision(12)`; strings use JSON.stringify; arrays preserve order; object keys use default `.sort()` | Canonical text; `computeTurnCommitDigest` hashes it | `wire_exact` |
| `canonicalize` / `canonNumber` in `authority-v2/adapters/interactions-learn.ts#L850-L882` | Same number/string/array/key rules as turn-command; undefined also becomes `null` | Canonical text; `interactionMaterialDigest` hashes it | `wire_exact` |
| `canonicalJson` in `authority-v2/adapters/faint-replacement.ts#L300-L315` | Primitive uses JSON.stringify with `"null"` fallback; object keys are sorted and recursively emitted. There is no explicit array branch in this helper; replacement input is an object image | Canonical text; `replacementImageDigest` hashes it | `wire_exact` |
| `canonicalJson` in `authority-v2/adapters/interactions-mystery.ts#L304-L318` | Primitive JSON.stringify/null fallback; arrays preserve order; object keys sorted | Canonical text; `interactionMaterialDigest` hashes it | `wire_exact` |
| `canonicalJson` in `authority-v2/adapters/interactions-reward.ts#L105-L119` | Primitive JSON.stringify/null fallback; arrays preserve order; object keys sorted | Canonical text; `digestOfInteractionMaterial` hashes it | `wire_exact` |
| `canonicalJson` in `authority-v2/adapters/wave-terminal.ts#L208-L222` | Primitive JSON.stringify/null fallback; arrays preserve order; object keys sorted | Canonical text; `digestOfMaterial` hashes it | `wire_exact` |
| `canonicalJson` in `authority-v2/adapters/control-open.ts#L334-L346` | Primitive JSON.stringify/null fallback; arrays preserve order; object keys sorted | Canonical text; command/interaction-open digests hash it | `wire_exact` |
| `canonicalJson` in `authority-v2/cutover-interaction.ts#L489-L501` | Primitive JSON.stringify/null fallback; arrays preserve order; object keys sorted | Canonical text; envelope digest and equality checks use it | `wire_exact` |
| `canonicalJson` in `coop-me-pin-state.ts#L169-L182` | Primitive JSON.stringify may return undefined; arrays preserve order; object keys sorted | Local active-control equality only | `local_only` |
| `canonicalMeOutcomeWithoutAuthority` in `coop-me-operation.ts#L480-L495` | Removes authoritative state and the publication-order `base.tick`, then calls core `canonicalize` | Local/operation outcome equivalence | `wire_exact` for the core canonical comparison |
| `canonicalize` use in `coop-wave-operation.ts#L726-L780` | Canonicalizes the staged envelope/payload after the operation-specific projection | Staged same-operation conflict/equality | `wire_exact` |
| `canonicalOperationValue` in `coop-operation-runtime.ts#L139-L170` | Undefined emits the literal unquoted text `undefined`; null and other primitives use `JSON.stringify(value) ?? "undefined"`; arrays preserve order; object keys default-sort and retain undefined-valued keys | Deterministic re-ack boundary comparison text. It is not necessarily valid JSON: `{a: undefined}` becomes `{"a":undefined}` | static source evidence only; `wire_exact` |

`canonicalOperationValue` is deliberately different from both core canonical JSON
and native `JSON.stringify`: an undefined object member is retained as
`"key":undefined`, and an undefined array member is emitted as the same literal
token. Native number serialization applies on this path, so finite fractions use
ECMAScript JSON number spelling, `-0` becomes `0`, and non-finite numbers become
`null`.

`freezeInteractionWireMaterial` in
`authority-v2/cutover-interaction.ts#L521-L544` first performs
`JSON.parse(JSON.stringify(material))`; the digest is over that JSON-wire image,
not over an object retaining undefined properties. This round trip is an
intentional authority/replica compatibility boundary.

## Wire digests

The following are existing wire or authority identities. Their algorithms must be
matched exactly by a Rust implementation; no digest replacement is part of this
inventory.

### Legacy battle and persistence digests

| Symbol and source | Input shape and normalization/order | Output encoding; consumers | Tests; Rust |
| --- | --- | --- | --- |
| `checksumState` in `coop-battle-checksum.ts#L284-L286` | `CoopChecksumState`; object keys are core-sorted. Engine projects field mons sorted by `bi`, weather/terrain type only, arena tags by `(tagType, side)` with counters excluded, modifiers/held items/ball counts by their documented keys; party, bench, moves, and tags retain slot/list order | Always the raw lowercase 16-hex FNV-1a-64 result; this helper has no catch path and does not emit the error sentinel | checksum tests above; `wire_exact` |
| `captureCoopChecksum` in `coop-battle-engine.ts#L2492-L2526` | Captures `CoopChecksumState`, then calls `checksumState`; the wrapper catches any capture/hash error | Raw checksum on success; reserved wrapper error sentinel `0000000000000000` on failure so comparison is skipped | engine checksum/fault tests; `wire_exact` |
| `fnv1a64` in `coop-battle-checksum.ts#L275-L282` | UTF-16 code units of canonical text; BigInt mask after each multiply | Lowercase 16-hex string | checksum tests above; `wire_exact` |
| `captureCoopSaveDataDigest` in `coop-battle-engine.ts#L1915-L2249` | `getSessionSaveData`; excludes `playTime`, `timestamp`, `name`, `coopParticipants`, `coopRun`, `arena`, `party`, `enemyParty`, `enemyModifiers`, `mysteryEncounterSaveData`, `mysteryEncounterType`, `erAchievementRunState`, `trainer`, `score`, `playerFaints`, `erUsedTrainerKeys`, `waveIndex`, `battleType`, `coopControlPlane`. Map/relic/modifier/mon-keyed fields receive special projections; final core canonicalization sorts object keys and preserves arrays | Raw 16-hex FNV-1a-64; `CoopChecksumState.saveDataDigest` | determinism and fault tests; `wire_exact` |
| `hashMonMoveset` / `readBenchMovesDigest` in `coop-battle-engine.ts#L2285-L2339` | Moveset maps to `[moveId, ppUsed]` in move-slot order; bench entries retain party slot order | Each moveset is core FNV-1a-64 text; bench digest is the existing projected field digest | engine checksum tests; `wire_exact` |
| `coopWaveStartEntryEffectSignature` in `coop-battle-engine.ts#L2876-L2879` | Removes `tick` from the publication material, then core-canonicalizes the state; live capture is used if no state is passed | Canonical signature text (not a second digest) | wave/engine tests; `wire_exact` |
| `coopSnapshotControlDigest` in `coop-runtime.ts#L600-L617` | Builds `{checksum, sessionEpoch, membership, activeControl, journalHighWater: ?? {}}`, JSON round-trips to drop undefined exactly as transport does, then core-canonicalizes | Raw 16-hex FNV-1a-64; snapshot-control comparison | runtime/authority tests; `wire_exact` |
| `coopV2RecoveryMaterialDigest` in `coop-runtime.ts#L1385-L1395` | Core-canonicalizes the recovery payload as supplied by the V2 recovery path | Raw 16-hex FNV-1a-64 | authority recovery tests; `wire_exact` |
| Legacy battle-stream tombstone digest in `coop-battle-stream.ts#L1302-L1332`, `#L1881-L1936` | Core-canonicalizes normalized authority envelopes; canonical text is retained for equality/conflict checks | Raw 16-hex FNV-1a-64 in retired tombstones | battle-stream tests; `wire_exact` |
| Shadow wave/terminal `legacyDigest` in `coop-runtime.ts#L8362-L8414`, `authority-v2/shadow.ts#L811-L844` | Computes `fnv1a64(canonicalize(transition))` exactly. It is the fallback raw legacy token; when `legacyImage` is present, the shadow comparator instead computes `digestOfMaterial(legacyImage)` for like-for-like adapter parity | Raw lowercase 16-hex FNV-1a-64 fallback passed to the shadow tap | static source evidence only; `wire_exact` |

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
wire/content identities remain exact. This section inventories only algorithms
implemented in the audited source.

| Symbol and source | Input shape and normalization/order | Output encoding; consumers | Tests; Rust |
| --- | --- | --- | --- |
| `canonicalCoopSeatMapPayload` / `sha256Hex` in `coop-session-binding.ts#L84-L151` | Account IDs are validated for exact nonempty bounded/control-free strings, not normalized; exact originals default-sort by JS UTF-16 order and receive dense seat IDs. The object literal `{version:1, revision:1, seats:[...]}` is JSON-stringified in insertion order; SHA-256 hashes UTF-8 `TextEncoder` bytes | Lowercase 64-hex SHA-256 becomes `seatMapId`; validation recomputes the exact payload/hash | `coop-membership-v2.test.ts#L15-L33`, `coop-p33-client.test.ts#L264-L265`; `wire_exact` |
| `digestCoopResumeSession` in `coop-resume-marker.ts#L185-L188`, consumed at `#L257-L266` | Hashes the exact supplied `sessionJson` string without parse/re-serialization; `TextEncoder` supplies UTF-8 bytes | Lowercase 64-hex SHA-256 resume commitment | `coop-resume-fencing-adversarial.test.ts#L118-L132`, `#L251-L276`; `wire_exact` |
| `bundleFingerprint` in `authority-v2/recovery-channel.ts#L142-L160`, consumed at `#L627-L650` | Native `JSON.stringify` of a fixed insertion-order object `{requestId, frontier, frontierOperationId, material, nextControl, tail}`; `tail` maps `requiredTail` through `withoutEntryContext`, deliberately excluding each entry's envelope/membership context | Insertion-order JSON comparison string, not a cryptographic hash; correlates delayed/completed recovery responses across re-addressing | static source evidence plus `authority-v2-recovery.test.ts#L509-L525`; `wire_exact` |
| `computeErDataFingerprint` in `coop-data-fingerprint.ts#L83-L199` | Each section uses numeric ID sorting: move map, move data (name excluded), move names, movesets (species keys numeric; value arrays preserve order), ability data/name; absent section contributes FNV-1a-64 of empty text | `ErDataFingerprint` object with six `{n, hash}` sections; data negotiation/compatibility consumers | `test/tests/elite-redux/coop/coop-data-fingerprint.test.ts`; `wire_exact` |
| `hashOf` in `coop-data-fingerprint.ts#L83-L85` | Core-canonicalizes each already-normalized section and applies shared FNV-1a-64 | Lowercase 16-hex section hash consumed by all six data sections | `test/tests/elite-redux/coop/coop-data-fingerprint.test.ts`; `wire_exact` |
| `dexEntryFingerprint` in `coop-battle-engine.ts#L5024-L5033` | Entry fields in fixed order: `seenAttr|caughtAttr|natureAttr|seenCount|caughtCount|hatchedCount`; BigInt attributes use their decimal string form | Non-cryptographic comparison string used for dex baseline equality | No dedicated direct dex fingerprint test found by `rg`; static source evidence only; `wire_exact` |
| `captureCoopDexBaseline` / `captureCoopDexDelta` in `coop-battle-engine.ts#L5035-L5102`, apply at `#L5109-L5164` | `Object.entries` follows JS own-property enumeration; numeric species keys are integer-index keys and therefore enumerate ascending numerically. The numeric-key `dex`/`starter` records retain that JS integer-index order when `JSON.stringify({dex, starter})` runs. Starter values use native `JSON.stringify`; dex BigInt attributes become decimal strings and restore with `BigInt` | Existing JSON compressed with `compressToBase64`; not core canonical JSON or a digest | No dedicated direct dex delta test found by `rg`; static source evidence only; `wire_exact` |
| `captureCoopMeOutcome` in `coop-battle-engine.ts#L5470-L5475` | Party entries map in party order with native JSON.stringify; ME save data uses native JSON.stringify | Outcome object carrying insertion-order JSON strings | `test/tests/elite-redux/coop/coop-duo-me-operation.test.ts`; `wire_exact` |
| `snapshotMarksCanonical` in `coop-durability.ts#L874-L895` | Snapshot mark object keys are sorted first; records are safe nonnegative sequences; JSON.stringify then has deterministic constructed insertion order | Existing durability/snapshot comparison string | durability tests; `wire_exact` |
| Modifier reconciliation `instanceKey` in `coop-battle-engine.ts#L4411-L4426` | `className` becomes itself only when it is a string, otherwise null; `args` uses `?? []`; core-canonicalize `[classNameOrNull, argsOrEmpty]` in that fixed array order and apply shared FNV-1a-64 | `${typeId} ${16-hex FNV-1a-64}`; matches host and live player-wide non-held/non-form modifier instances | `coop-player-modifier-instance-reconcile.test.ts#L149-L227`; `wire_exact` |

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
| `coopBiomeOperationId` / interactive branch of `commitBiomeOwnerIntent` in `coop-biome-operation.ts#L365-L371`, `#L1028-L1056`; bands in `coop-seq-registry.ts#L90-L114` | Interactive caller first proves `seq = 9_700_000 + pinned` for `BIOME_PICK` or `seq = 9_600_000 + pinned` for `CROSSROADS_PICK`; owner is `coopInteractionOwnerSeat(pinned)` | `makeCoopOperationId(epoch, owner, seq, kind)` → `${epoch}:${owner}:${kind}:${seq}` | biome choice/operation tests; `wire_exact` |
| `coopAuthoritativeBiomeTransitionOperationId` / `commitAuthoritativeBiomeTransition` in `coop-biome-operation.ts#L375-L382`, `#L1260-L1305` | Validate safe nonnegative `sourceWave < COOP_MAX_REACHABLE_COUNTER`; set `seq = 9_800_001 + sourceWave`, host owner `0`, kind `BIOME_PICK` | `${epoch}:0:BIOME_PICK:${9800001 + sourceWave}` | `coop-transition-t2-biome.test.ts#L583-L684`, `#L817-L951`; `wire_exact` |
| `coopRewardOperationActionSlot` in `coop-reward-operation.ts#L173-L177`, `#L194-L236`; base stride in `coop-operation-address.ts#L22` | Validate safe nonnegative pin/action and reward surface; `surfaceOffset = rewardSurface == null ? 0 : (ordinal + 1) * 5000`; slot is `pinned * 100000 + surfaceOffset + actionOrdinal`, with action and total-band bounds | Safe numeric operation address or null | `coop-reward-surface-identity.test.ts#L22-L40`; `wire_exact` |
| Reward/market action producers `commitRewardOwnerIntent` / `adoptRewardWatcherChoice` in `coop-reward-operation.ts#L750-L770`, `#L1235-L1282` | Compute the action slot above; owner is `coopInteractionOwnerSeat(pinned)`; kind is `REWARD` for reward and `SHOP_BUY` for market. A retained terminal reuses its prior ID | `${epoch}:${owner}:REWARD|SHOP_BUY:${actionSlot}` | reward surface and biome-market continuation tests; `wire_exact` |
| Reward/market presentation producer `commitCoopRewardOptionsPresentation` in `coop-reward-operation.ts#L1046-L1100` | Uses `reroll` as the action ordinal in the same slot formula; owner is `coopInteractionOwnerSeat(pinned)`; kind is `REWARD_PRESENT` or `SHOP_PRESENT` | `${epoch}:${owner}:REWARD_PRESENT|SHOP_PRESENT:${actionSlot}` | reward presentation/surface tests; `wire_exact` |
| Mystery address helpers `ME_KIND_TAG`, `meOpAddr`, `ownerSeatFor` in `coop-me-operation.ts#L728-L750`, `#L917-L927` | Tags are `ME_PRESENT=0`, `ME_PICK=1`, `ME_SUB=2`, `ME_BUTTON=3`, `ME_TERMINAL=4`, `QUIZ_ANSWER=5`; address is `seq * 8000 + tag * 1000 + (((step % 1000) + 1000) % 1000)`. Presentation/terminal owner is `0`; other kinds use `coopInteractionOwnerSeat(pinned)`. The helper itself performs no integer/safe-integer validation; producer preconditions below are authoritative | Numeric address embedded as `pinnedSeq` in the generic four-component ID | Mystery operation tests; `wire_exact` |
| Mystery producer 1, `isCoopMeQuizAnswerOperationId` in `coop-me-operation.ts#L758-L785` | `makeCoopOperationId(epoch, ownerSeatFor("QUIZ_ANSWER", pinned), meOpAddr("QUIZ_ANSWER", seq, questionIndex), "QUIZ_ANSWER")` after safe/band checks | Exact quiz-answer operation ID equality predicate | `coop-duo-mystery.test.ts#L1083-L1091`; `wire_exact` |
| Mystery producer 2, `coopMeGuestAppliedPickContinuationAddress` in `coop-me-operation.ts#L852-L863` | `makeCoopOperationId(state.epoch, ownerSeatFor("ME_PICK", pinned), meOpAddr("ME_PICK", seq, step), "ME_PICK")` | Exact ID used to test whether the guest applied the pick before returning a continuation address | static source evidence only; `wire_exact` |
| Mystery producer 3, `commitMeOwnerIntent` in `coop-me-operation.ts#L961-L1037` | `step = params.step ?? 0`; owner is `ownerSeatFor(kind, pinned)`; address is `meOpAddr(kind, seq, step)` | `makeCoopOperationId(state.epoch, owner, address, kind)` | ME operation/terminal tests; `wire_exact` |
| Mystery producer 4, `commitMeAuthorityGuestIntent` in `coop-me-operation.ts#L1153-L1166` | Recomputes `makeCoopOperationId(state.epoch, ownerSeatFor(kind, pinned), meOpAddr(kind, seq, step), kind)` | Exact expected ID for guest proposal admission | ME guest-intent tests; `wire_exact` |
| Mystery producer 5, `adoptMeWatcherChoice` in `coop-me-operation.ts#L1263-L1303` | `step = params.step ?? 0`; recomputes owner and tagged address using the same helper formula | Derived exact operation ID for watcher adoption/range checks | ME watcher tests; `wire_exact` |
| Shadow terminal producer in `tapCoopV2ShadowWaveBoundary`, `coop-runtime.ts#L8346-L8375` | Uses the decimal `wave` directly; terminal material separately uses terminal ID `coop-v2-shadow-terminal:w${wave}` | Operation ID `WSHADOW/TERM/w${wave}` | static source evidence only; `wire_exact` |
| Shadow wave producer in `tapCoopV2ShadowWaveBoundary`, `coop-runtime.ts#L8378-L8414` | Uses the decimal `wave` directly and installs the same string as `afterOperationId` | Operation ID `WSHADOW/ADV/w${wave}` | static source evidence only; `wire_exact` |
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
the producer's string. There is no single cross-surface fingerprint algorithm:
the choice and Bargain producers below are separate source-exact formulas.

| Symbol and source | Input shape and normalization/order | Output encoding; consumers | Tests; Rust |
| --- | --- | --- | --- |
| Guest interaction fingerprint in `coop-interaction-relay.ts#L1991-L2005` | Exact expression `JSON.stringify([msg.seq, msg.kind, msg.choice, msg.data ?? null, msg.rewardSurface ?? null])`; array order is fixed, nested data order follows native JSON.stringify | Native insertion/order-sensitive text passed to `authorityProposalAdmissions.admit`; no hash | `test/tests/elite-redux/coop/coop-interaction-relay.test.ts#L333-L407`, `test/node/authority-v2-proposal-admission.test.ts#L11-L36`; `wire_exact` |
| Bargain outcome fingerprint in `coop-interaction-relay.ts#L2141-L2148` | Exact expression `JSON.stringify([msg.seq, msg.kind, msg.outcome])` | Native JSON.stringify text passed to proposal admission; no hash | relay tests above; `wire_exact` |
| `CoopV2ProposalAdmissionLedger.admit` in `authority-v2/proposal-admission.ts#L15-L62` | Operation ID and nonempty opaque fingerprint; same pair is duplicate, same operation with different fingerprint is conflict; capacity is a safe positive integer | No new encoding; stores caller-provided fingerprint exactly | `authority-v2-proposal-admission.test.ts#L11-L36`; `wire_exact` |
| `ProposalLeaseManager` fingerprint handling in `authority-v2/proposal-lease.ts#L36-L92` | Nonempty stable caller-provided fingerprint; same ID/fingerprint retains lease, different fingerprint conflicts | No new encoding; opaque equality | `test/node/authority-v2-proposal-lease.test.ts`; `wire_exact` |
| `stageCoopWaveAdvanceEnvelope` / `isExactStagedWavePayload` in `coop-wave-operation.ts#L726-L780` | Operation ID's staged envelope/payload is core-canonicalized; same operation with changed canonical payload conflicts | Canonical text retained for proposal/retry equality | wave operation tests; `wire_exact` |
| ME `identity` in `coop-me-operation.ts#L192-L215` | Core-canonicalizes `{pinned, step, payload}` for same-operation identity; outcome comparison separately strips authority/tick at `#L480-L495` | Canonical text, not a new digest | `test/tests/elite-redux/coop/coop-duo-me-operation.test.ts`; `wire_exact` |

Do not “improve” either producer array by sorting object keys or replacing its JSON
text with a digest: admission and leasing intentionally treat each producer's
existing fingerprint as opaque identity and do not unify the two formulas.

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
| Control kinds/addresses | Successor kinds deduplicate then use `AUTHORITY_ENTRY_KIND_ORDER`; interaction kinds and opaque IDs deduplicate then default-sort. Allowed interaction/control address helpers map, default-sort, and join without deduplicating; accepted controls separately reject duplicate addresses during validation; `next-control.ts#L827-L871`, `#L874-L965`. |
| Control `remaining` | The supplied sequence is preserved and validated for strictly increasing occurrence; it is not sorted by control ID; `next-control.ts#L650-L720`. |
| Membership seats | Account IDs are validated but never trimmed, case-folded, or Unicode-normalized. Exact original strings default-sort by JS UTF-16 order before dense seat assignment; seat array order is preserved; `coop-session-binding.ts#L84-L110`. |
| Identity pair | NFKC+lowercase is used for comparison only; original identity strings are returned in normalized order; `coop-run-identity.ts#L13-L33`. |
| Replay | Events are ordered; roster/party arrays are ordered; owner derives from sequence parity; `replay-trace.ts#L158-L243`, `#L268-L336`. |
| Checkpoint | `mons`, moves, tags, and event-like arrays preserve caller order; sanitization truncates/clamps values but does not sort; `coop-battle-checkpoint.ts#L155-L277`. |
| Ordinary JSON.stringify | Frame encoding, session-map payload, proposal fingerprints, recovery `bundleFingerprint`, report correlation, durability messages, dex/starter data, and `modifierInstanceKey` use native JavaScript property-enumeration/array-order semantics. Numeric dex/starter record keys are integer-index properties and enumerate ascending numerically; `frame-codec.ts#L142`, `coop-session-binding.ts#L105-L117`, `recovery-channel.ts#L142-L160`, `coop-battle-engine.ts#L5035-L5102`. These are not interchangeable with core canonical JSON. |
| Control owners | `controlOwnerSeatIds` deduplicates and numerically sorts command owners; terminal/await controls have no owners; `next-control.ts#L511-L520`. |
| Modifier identity | `modifierInstanceKey` concatenates `typeId`, `className`, and two insertion-order JSON arrays with `|`; `coop-battle-engine.ts#L3211-L3212`. |
| FNV modifier instance identity | Player-wide reconciliation uses `${typeId} ${fnv1a64(canonicalize([classNameOrNull, args ?? []]))}`; fixed array order feeds core key sorting recursively; `coop-battle-engine.ts#L4411-L4426`. This is a different identity from `modifierInstanceKey`. |
| Operation re-ack comparison | `canonicalOperationValue` preserves array order, default-sorts object keys, and retains undefined-valued keys using literal `undefined`; `coop-operation-runtime.ts#L139-L170`. |
| Authority pending identity | `authority-log.ts#L1078-L1080` compares the material digest and native JSON.stringify of `nextControl`/`subsumes`; it does not apply core key sorting. |
| Diagnostic labels | `CoopMutationLedger.snapshot` sorts active labels with default lexical order; `coop-mutation-ledger.ts#L64-L72`. |
| Hash text encoding | FNV rows consume UTF-16 code units; seat-map and resume SHA-256 consume UTF-8 `TextEncoder` bytes. The recovery bundle fingerprint is unhashed native JSON text. |

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
5. Replay `coop`, `endState`, and `checkpoint` are absent when not supplied. The
   optional `target` belongs only to a `ReplayCommandKind` move and is a
   `BattlerIndex`, not a checkpoint target; validation accepts only undefined or
   an integer (`replay-trace.ts#L58-L75`, `#L318-L330`).
6. Relay proposal arrays deliberately normalize absent `data` and
   `rewardSurface` with `?? null`; this is distinct from the omitted optional
   fields in checkpoint/replay (`coop-interaction-relay.ts#L1991-L2005`).
7. `AWAIT_SUCCESSOR.allowedKinds` is required, nonempty, and not nullable; it has
   no `*` encoding. `SHARED_INTERACTION.successor.operationIds` and
   `AWAIT_SUCCESSOR.expectedOperationId` are required nullable fields whose null
   value encodes `*`. The two allowed-address lists are optional: the encoder's
   `addresses == null` check makes omission/undefined and a directly supplied
   null both encode `*`, although the validator rejects explicit null because the
   contract permits only an omitted field or an array. A nullable operation ID
   inside an allowed control address also encodes `*`
   (`authority-v2/contract.ts#L311-L369`, `next-control.ts#L86-L101`,
   `#L841-L871`, `#L874-L965`).
8. `coopSnapshotControlDigest` applies `snapshot.journalHighWater ?? {}` before
   the JSON round trip, so both null and undefined become `{}` for that field.
   Other undefined object properties are dropped by the round trip while their
   explicit null values survive (`coop-runtime.ts#L600-L617`).
9. `canonicalOperationValue` does not collapse absence to null: undefined is the
   literal unquoted token `undefined`, including in arrays and object properties
   (`coop-operation-runtime.ts#L139-L154`).

## Integer assumptions and observed floats

The code does not compare against a literal `Number.MAX_SAFE_INTEGER`; authoritative
wire boundaries use `Number.isSafeInteger`. Canonical number-formatting helpers use
the weaker `Number.isInteger` only to choose an output spelling, not to validate a
wire integer. A Rust port must preserve both distinctions and use the JS-safe range
`[-(2^53-1), 2^53-1]` only where the source says safe integer.

| Source rule | Evidence and consequence |
| --- | --- |
| Authority entry/context | Revisions, session epoch, membership revision, sender/authority seats, connection generation, and subsumption revisions require safe integers; revisions are positive; `authority-entry.ts#L48-L69`, `#L176-L220`. |
| Authority controls/ledger | Wave/turn/index/seat/occurrence coordinates and bounded revision windows validate safe integer ranges; command frontier filters/sorts safe `bi`; `next-control.ts#L580-L606`, `authority-ledger.ts#L56-L164`, `command-frontier.ts#L98-L121`. |
| Engine authoritative state | Checkpoint tick/wave/turn, seat `bi`/partyIndex/pokemonId, and array entries use `Number.isSafeInteger` validation around `coop-battle-engine.ts#L2732`, `#L3153`, `#L3450-L3613`. |
| Replay | Uses `Number.isInteger`, not `Number.isSafeInteger`, for wave/turn/slot/sequence/choice/indices; `replay-trace.ts#L268-L336`. This weaker legacy boundary is intentional compatibility behavior. |
| Operation ID parser | `parseCoopOperationId` uses `Number.isInteger`, not `Number.isSafeInteger`; `coop-operation-envelope.ts#L606-L635`. Callers may add safe checks, but the parser itself is weaker. |
| Checkpoint coercion | HP/max HP, money, move PP, stage values, status counters, arena turns/layers, and weather/terrain counters are finite/truncated/floored/clamped as specified; `coop-battle-checkpoint.ts#L95-L218`, `#L222-L277`. |
| Core canonical number path | `canonNumber` uses `Number.isInteger`, not `Number.isSafeInteger`; any finite value for which that predicate is true uses `toString`. Finite fractions use `toPrecision(12)`; `-0` becomes `0`; NaN/Infinity become text `0`; `coop-battle-checksum.ts#L249-L263`. This is formatting, not admission. |
| V2 canonical number paths | Turn and learn copies also use `Number.isInteger` only for formatting, then `toPrecision(12)` for finite fractions and `0` for non-finite/zero (`turn-command.ts#L740-L772`, `interactions-learn.ts#L850-L882`). Other adapter `canonicalJson` helpers and `canonicalOperationValue` defer primitives to native JSON.stringify: finite fractions use native JSON spelling, `-0` becomes `0`, and non-finite primitives become `null`; authoritative wire validation rejects non-finite material first. |
| BigInt | FNV-64 uses BigInt internally but emits a string. Dex `seenAttr`/`caughtAttr` are BigInt and use decimal strings in JSON/delta transport; `coop-battle-engine.ts#L5024-L5032`, `#L5061-L5102`. |
| Relevant observed float-capable paths | Audited canonical behavior has three explicit fractional paths: core/turn/learn `toPrecision(12)`, native JSON number emission in insertion-order/canonicalOperationValue records, and checkpoint inputs that are truncated/floored/clamped before emission. Replay/operation-address/authority coordinate paths require integer predicates. Gameplay timing/backoff floats are outside canonical state and are not inferred as wire fields. |

## Compatibility risks and stop-condition evidence

The current algorithms are reproducible from source, so the “cannot reproduce
canonicalization” stop condition was not triggered. The following boundaries must be
carried forward verbatim:

| ID | Evidence | Impact and required action |
| --- | --- | --- |
| `duplicate-canonicalizers` | Core, turn/learn, and six other V2 adapters each implement a private canonicalizer; citations in the canonical JSON table | Small semantic differences exist (undefined handling, primitive non-finite handling, and faint replacement's lack of an array branch). Keep one explicit implementation per wire surface and test against its source behavior. |
| `json-order-is-not-canonical` | `frame-codec.encodeFrameV2`, seat-map payload, relay proposals, recovery bundle fingerprint, durability messages, report correlation, dex/starter data, and `modifierKey` call native JSON.stringify | Do not route insertion-order wire identities through core key sorting. Rust must reproduce JS property/array emission, including integer-index key enumeration, for those existing payloads. |
| `absent-vs-null` | Core undefined fallback is null; JSON.stringify omits object undefined; Authority V2 rejects undefined; cutover freezes by stringify/parse | Raw core canonicalization cannot preserve absence. Apply the source-layer validator/round trip first and preserve explicit null. |
| `unsafe-operation-parser` | `parseCoopOperationId` checks `Number.isInteger`, while authority entries and engine validation check `Number.isSafeInteger` | A mathematically valid but JS-unsafe operation ID can parse; do not silently strengthen the parser in a compatibility path. Validate at the same caller boundary as the source. |
| `operation-id-comment` | `makeCoopOperationId` emits four components although its comment describes three; parser requires four (`coop-operation-envelope.ts#L596-L635`) | Use emitted four-component form as oracle. |
| `mixed-hash-encodings` | Core/V2 FNV hashes consume UTF-16; seat-map SHA-256 consumes UTF-8; V2 prefixes/lengths differ | Do not replace existing wire digests or normalize all hashes to one Rust primitive. |
| `wildcard-null` | Required nullable `operationIds`/`expectedOperationId` encode null as `*`; optional allowed-address encoders use `== null`, so omission and null both encode `*`, while validation rejects explicit null; `allowedKinds` is required/nonnullable | Reproduce the encoder and validator as separate boundaries; do not invent a nullable `allowedKinds` or distinguish null from omission in optional address encoding. |
| `address-sort-without-dedup` | Allowed-address canonicalizers map, sort, and join without a Set; validation rejects duplicates before accepted wire use | Do not add deduplication inside the identity helper or infer that it changes duplicate multiplicity. |
| `remaining-order` | `next-control` validates increasing occurrence in supplied `remaining` sequence instead of sorting it | Preserve sequence order; sorting changes control IDs. |
| `legacy-fingerprint-opacity` | Choice and Bargain producers use two distinct exact `JSON.stringify` arrays; proposal admission/lease compares each caller string opaquely and never hashes or re-canonicalizes it | Keep both source formulas exactly; do not invent one cross-surface algorithm or replace either with a digest. |
| `account-id-exactness` | Seat-map account IDs are validated and exact-sorted; no trim, case fold, or Unicode normalization occurs | Preserve original account strings in seat assignment and payload hashing. |
| `seat-map-sha` | Membership binds `seatMapId` to SHA-256 of a specific UTF-8 JSON payload | Preserve SHA-256 and the exact insertion-order payload. |
| `source-branch-availability` | The requested oracle branch name was supplied by the task, but is not a local ref in the worker checkout; inventory is anchored to the explicit base SHA | Any branch-only delta must be audited separately before changing this oracle. |

No contradictory identity formatting was found in the audited rules beyond the
operation-ID comment/implementation mismatch documented above. The source does
provide enough information to reproduce current canonical text and wire digests;
the remaining risk is implementation drift between duplicated helpers.

## Layer classification

| Layer | Symbols | Classification and Rust requirement |
| --- | --- | --- |
| Legacy battle wire | `canonicalize`, `fnv1a64`, `checksumState`, `captureCoopChecksum`, engine checksum/save/bench projections, modifier FNV identity, runtime snapshot/shadow IDs/shadow legacy digest, operation re-ack comparison, and battle-stream tombstone digests | Existing cross-peer/checkpoint identity; `wire_exact`. |
| Authority V2 wire | Adapter material digests, recovery `bundleFingerprint`, `controlIdOf`, control frontier/address ordering, `isWireStableJsonValue`, frame JSON encoding, proposal admission/lease | Existing authority/replica/control identity; `wire_exact`. |
| Membership/run identity | Seat-map SHA-256, exact account-ID seat assignment, resume SHA-256, session runtime ID, normalized participant pair | Existing authenticated/session identity; `wire_exact`. |
| Persistence/replay | Checkpoint serializer, replay validation/ordering, durability canonical comparisons, dex delta/fingerprint, data fingerprint | Existing save/replay/data compatibility; `wire_exact` for current payloads and comparisons. |
| Local/diagnostic | `coop-me-pin-state.canonicalJson`, mutation-ledger sorted labels, rendezvous fallback FNV address, report formatting outside its pair-key identity | Local equality or diagnostic presentation; not a new gameplay digest. Keep exact where externally compared, otherwise `local_only`. |
