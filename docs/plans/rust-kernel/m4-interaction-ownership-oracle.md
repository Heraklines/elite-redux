# M4 Interaction Ownership Oracle

- Status: frozen M4-00 oracle evidence
- M4 base SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- TypeScript oracle SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- Evidence mode: read-only source extraction; observed behavior is distinguished from proposed Rust contracts and explicit gaps in the text below.

## Summary

Read-only oracle extraction for M4 interaction ownership at the supplied exact TypeScript oracle SHA. Observed production behavior is a two-seat, round-robin interaction counter (even→seat 0/host, odd→seat 1/guest), except Pokémon move learning is owned by the learning Pokémon’s `coopOwner` and wave/deterministic-biome progression is fixed to authority seat 0. Production Authority V2 interaction entries preserve the legacy four-field operation ID `${epoch}:${owner}:${kind}:${pinnedSeq}` and receive a separate dense global `AuthorityLog` revision. Reward/market action ordinals, Crossroads→biome pin reuse, proposal fingerprints, duplicate/stale/wrong-seat behavior, production wave IDs, RNG boundaries, concrete numeric protocol/content IDs, contradictions, and stop conditions are detailed below.

## Source evidence

### `src/data/elite-redux/coop/coop-session.ts`

`coopInteractionOwnerSeat`, `CoopInteractionTurn.ownerOf/advance/mergeRemote/restore`: seat round-robin, pinned idempotent advancement, deferred remote reconciliation, persistence.

### `src/data/elite-redux/coop/coop-session-controller.ts`

`isLocalOwnerAtCounter`, `interactionCounter`, `advanceInteraction`: controller-facing ownership and counter API.

### `src/data/elite-redux/coop/coop-operation-envelope.ts`

Canonical live legacy/cutover ID grammar, parser, operation kinds, reward/learn/wave payloads, reward-surface limits.

### `src/data/elite-redux/coop/coop-operation-address.ts`

Numeric action strides: reward/market 100,000; learn-independent ability/colosseum strides.

### `src/data/elite-redux/coop/coop-seq-registry.ts`

Central numeric relay sequences: reward 0, market 7,000,000, learn 9,100,000/9,150,000, Crossroads 9,600,000, biome pick 9,700,000, deterministic biome 9,800,001.

### `src/data/elite-redux/coop/coop-reward-operation.ts`

Reward/market per-stream action ordinals, action-slot encoding, parity validator, presentation/action IDs, watcher stale/duplicate/exact-ID gates.

### `src/phases/select-modifier-phase.ts`

Reward pin capture, owner/watcher split, exact guest proposal fingerprint, terminal result/material barrier, from-pinned counter advance.

### `src/phases/biome-shop-phase.ts`

Market owner/watcher flow, buy/leave proposal fingerprints, post-action result order, terminal from-pinned advance and Mystery suppression.

### `src/data/elite-redux/coop/coop-biome-operation.ts`

Crossroads/biome/deterministic-transition IDs, boundary validators, exact proposal-ID gate, stale/duplicate watcher behavior.

### `src/phases/er-crossroads-phase.ts`

Crossroads pin/control ownership; Stay advances once; Leave retains the same pin into SelectBiome and defers advancement.

### `src/phases/select-biome-phase.ts`

Natural/chained biome selection ownership, deterministic transition exception, proposal emission, mutation/commit/advance ordering, deterministic fallback RNG call.

### `src/data/elite-redux/coop/coop-learn-move-operation.ts`

Learn surface-local ordinal, prompt/result ID relation, owner-role commits, retry identity.

### `src/phases/learn-move-phase.ts`

Single move-learning owner comes from Pokémon `coopOwner`; exact prompt/result checks; host/guest mutation and callback order.

### `src/phases/learn-move-batch-phase.ts`

Batch learn ownership and host authoritative application; prompt/result settlement and fallback behavior.

### `src/phases/coop-replay-learn-move-batch.ts`

Guest-owned batch proposal emission with exact prompt+1 operation ID.

### `src/data/elite-redux/coop/coop-interaction-relay.ts`

Wire proposal fingerprint admission, FIFO/kind/reward-surface routing, duplicate/conflict handling, exact-wait limitation.

### `src/data/elite-redux/coop/authority-v2/proposal-admission.ts`

Session-epoch proposal ID→fingerprint first-writer ledger and capacity behavior.

### `src/data/elite-redux/coop/authority-v2/proposal-lease.ts`

Non-authority retained proposal retries, same-ID duplicate/conflict rules, commit observation, 20-minute ceiling.

### `src/data/elite-redux/coop/authority-v2/cutover-interaction.ts`

Production global interaction-entry construction, preservation of legacy operation IDs, digest, exact successor controls, learn prompt+1 and Crossroads→biome successor.

### `src/data/elite-redux/coop/authority-v2/control-ledger.ts`

Exact owner/watcher/control installation and physical-human-input authorization; wrong-seat remote-wait refusal.

### `src/data/elite-redux/coop/authority-v2/authority-log.ts`

Dense global revision allocation and replica stale epoch, duplicate, revision conflict, gap, sender, and predecessor-control behavior.

### `src/data/elite-redux/coop/coop-wave-operation.ts`

Legacy compatibility WAVE_ADVANCE identity `${epoch}:0:WAVE_ADVANCE:${wave}`, fixed host ownership, staged duplicate/conflict and stale-wave rules.

### `src/data/elite-redux/coop/coop-runtime.ts`

Actual production Authority V2 wave/terminal IDs `V2/WAVE/.../tick...` and `V2/TERMINAL/.../tick...`, destination controls, deferred-boundary handling.

### `src/data/elite-redux/coop/authority-v2/adapters/interactions-reward.ts`

Competing adapter-only `IREW`/`IMKT`/`IBIO` grammars; important contradiction/non-production inventory.

### `src/battle-scene.ts`

`generateRandomBiome`: deterministic biome fallback weighting and seeded draw.

### `src/utils/common.ts`

`randSeedInt`/`randSeedItem`: global Phaser seeded RNG and inclusive integer semantics.

### `src/enums/biome-id.ts`

Concrete observed content IDs: Town 0, Plains 1, End 50.

## Architecture and contract guidance

## 1. Observed TypeScript ownership and counter contract

### Alternation
- `coop-session.ts:175-242,474-566`: two-player role/seat map is host=seat 0=authority and guest=seat 1. `coopInteractionOwnerSeat(counter, playerCount=2)` computes normalized `trunc(counter) mod 2`; therefore counter 0,2,… belongs to host and 1,3,… to guest. `CoopInteractionTurn.ownerOf` maps that seat back to the binary role.
- `CoopInteractionTurn.advance(fromCounter)` increments only when `fromCounter` is absent or equals the live counter. A duplicate terminal with an old pin is an idempotent no-op. After increment it folds a strictly larger deferred `pendingRemote`; then clears the deferred value. `mergeRemote` never changes the live counter: it records remote progress monotonically and wakes remote-counter barriers. Invalid/non-integer remote values do not change the live counter. Cold restore only moves forward; transactional rollback alone can restore an exact lower value.
- The counter is persisted as `coopControlPlane.interactionCounter` (`coop-control-plane.ts:7-20`; `coop-runtime.ts:8386-8389`).

### Surface owners
- Reward and market: owner seat = `coopInteractionOwnerSeat(pinned)` (`coop-reward-operation.ts:605-613,776-825`). The phase pins the current counter before owner/watcher branching (`select-modifier-phase.ts:415-440,561-573`; market `biome-shop-phase.ts:294-318`).
- Crossroads and interactive biome selection: same parity owner (`coop-biome-operation.ts:367-385,1026-1063`; `er-crossroads-phase.ts:353-400`; `select-biome-phase.ts:531-578`).
- Deterministic biome transition without human choice: fixed authority seat 0; it does not consume a fresh alternation counter (`coop-biome-operation.ts:377-385,1045-1063,1367-1407`). A deterministic terminal reached while completing a chained Crossroads Leave still completes that already-pinned interaction in `SelectBiomePhase`.
- Wave advance and terminal: fixed authority seat 0 because the host is the sole wave engine (`coop-wave-operation.ts:24-30,118-120,452-459`).
- Move learning is deliberately **not parity-owned**. `learn-move-phase.ts:328-408,475-590` reads `pokemon.coopOwner`, defaulting absent ownership to `"host"`; the mon owner drives the picker. Empty-slot learning is deterministic on both copies. For a full guest-owned moveset the guest picks and the host applies authoritatively. Batch learning uses the same Pokémon-owner rule and carries `ownerIsGuest` in the prompt (`learn-move-batch-phase.ts:304-389`; `coop-replay-learn-move-batch.ts:130-146`).

## 2. Centralized exact string/address grammars

### Canonical live interaction grammar
`coop-operation-envelope.ts:35-46,596-642` implements:

`<epoch>:<ownerSeat>:<KIND>:<pinnedSeq>`

`parseCoopOperationId` requires exactly four colon-separated fields; epoch, owner, and pinnedSeq need only be integers at this generic layer, and KIND must be in the closed union. Relevant surface/boundary validators subsequently require positive epoch and non-negative/banded addresses.

### Reward / market action identities
From `coop-operation-address.ts:15-19` and `coop-reward-operation.ts:176-240,690-700,776-825`:
- `ACTION_STRIDE = 100000`; `SURFACE_ACTION_STRIDE = 5000`.
- Ambient action slot: `pinned * 100000 + actionOrdinal`.
- Ordered Mystery reward surface `{ordinal:j,surfaceId}`: `pinned * 100000 + (j+1)*5000 + actionOrdinal`.
- `j` is 0..15, `surfaceId` is at most 64 chars and matches `^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$`, and actionOrdinal is 0..4999.
- Reward action: `${epoch}:${owner}:REWARD:${actionSlot}`.
- Market buy/leave: `${epoch}:${owner}:SHOP_BUY:${actionSlot}`.
- Presentation pools use the same slot function with `reroll` in the actionOrdinal position and kinds `REWARD_PRESENT` / `SHOP_PRESENT` (`coop-reward-operation.ts:1205-1302`). Market’s stock namespace reroll is 777 (`coop-interaction-relay.ts:251-254`).
- Owner ordinals are independent per `(pinned, operation kind, rewardSurface)` stream, start at 0, and increment when intent identity is prepared, before gameplay mutation. A terminal retains its allocated ordinal+operationId for exact retries. Watchers maintain their own ordinal per semantic stream and increment only after accepted/materialized action.
- Concrete fresh examples: epoch 1, pin 0, first ambient reward = `1:0:REWARD:0`; pin 1 = `1:1:REWARD:100000`; pin 1 market first buy = `1:1:SHOP_BUY:100000`; pin 1 market presentation at reroll 777 = `1:1:SHOP_PRESENT:100777`.
- Relay sequences are different from operation addresses: reward uses raw pin (base 0); market uses `7000000 + pin` (`coop-seq-registry.ts:36-53`). Leave=-1 and reroll=-2 (`coop-interaction-relay.ts:75-76,251-254`). A free reward action labeled `reward` is terminal even with an ordinary non-negative choice; market is terminal only on leave (`coop-reward-operation.ts:584-602`).

### Crossroads / biome identities
From `coop-seq-registry.ts:96-132` and `coop-biome-operation.ts:367-385`:
- Crossroads relay/address = `9600000 + pinned`; operation ID `${epoch}:${owner}:CROSSROADS_PICK:${9600000+pinned}`.
- Interactive biome relay/address = `9700000 + pinned`; operation ID `${epoch}:${owner}:BIOME_PICK:${9700000+pinned}`.
- Deterministic biome address = `9800001 + sourceWave`; operation ID `${epoch}:0:BIOME_PICK:${9800001+sourceWave}` and payload `nodeIndex=-1`.
- Crossroads Stay=choice 0; Leave=choice 1. Leave’s exact successor is the BIOME_PICK ID at `9700000 + the same pinned counter` (`cutover-interaction.ts:800-834`). Fresh epoch-1/pin-0 examples are `1:0:CROSSROADS_PICK:9600000` then `1:0:BIOME_PICK:9700000`. A deterministic source-wave-10 example is `1:0:BIOME_PICK:9800011`.

### Move-learning identities
`coop-learn-move-operation.ts:189-280` keeps a learn-surface ordinal, initially 0, over its restored surface revision floor. A newly minted prompt uses `pinnedSeq = revisionFloor + ++ordinal`; its exact decision keeps epoch/owner/kind and adds 1 to pinnedSeq. A supplied decision address must exceed the floor and advances local ordinal to at least its relative position. Thus a fresh epoch-1 guest-owned first prompt/decision is `1:1:LEARN_MOVE:1` then `1:1:LEARN_MOVE:2`; batch uses `LEARN_MOVE_BATCH` identically. These are operation ordinals, not the alternating interaction counter.
- Single proposal relay seq = `9100000 + partySlot`; batch = `9150000 + partySlot`; old fixed lockstep learn seq is 9500000 (`coop-seq-registry.ts:75-95,139-146`).
- Prompt payloads carry partySlot, moveId/maxMoveCount (single) or partySlot/learnableIds/ownerIsGuest (batch); results carry forgetSlot or assignment pairs. Decline sentinel is the Pokémon’s maxMoveCount; batch fallback sentinel is -1 (`learn-move-batch-phase.ts:45-49`).

### Production global wave IDs
Actual cutover grammar is in `coop-runtime.ts:10397-10468`, not the legacy wave operation module:
- Nonterminal: `V2/WAVE/e<sessionEpoch>/w<wave>/tick<authoritativeState.tick>`.
- Terminal: `V2/TERMINAL/e<sessionEpoch>/w<wave>/tick<authoritativeState.tick>`; this same string is `terminalId` and operationId.
- Example only with stated coordinates: e=1,w=10,tick=123 → `V2/WAVE/e1/w10/tick123`.
The legacy compatibility surface separately mints `${epoch}:0:WAVE_ADVANCE:${wave}` (`coop-wave-operation.ts:905-957`). Under V2 wave cutover it is suppressed as retained authority (`authority-v2/cutover-wave.ts:70-88`).

### Global revision
`authority-v2/authority-log.ts:839-985`: every mechanical entry receives `headRevision+1`; the revision becomes real only after retention and local successor reservation succeed, so refusal does not burn a number. A deferred entry preserves that exact candidate revision/body for retry. A different body cannot replace an outstanding deferred entry. Operation ID and global revision are separate: production interaction cutover embeds the surface envelope but uses its operation ID unchanged, while `AuthorityLog` assigns the one global revision (`cutover-interaction.ts:990-1036,1058-1138`).

## 3. Mutation and causal order
- Reward/market streamed action: pin owner → allocate per-stream ordinal/ID and retain intent → non-authority proposal is sent/retried or authority acts locally → host validates exact owner/address and executes once → phase proves its exact terminal/continuing handler state → complete post-action authority state is captured → global interaction entry commits → replica materializes → terminal counter advances from the captured pin. Continuing buys/lock/check/transfer actions do not advance it. `SelectModifierPhase` host terminal waits for peer material-applied before ending/advancing (`select-modifier-phase.ts:1926-1991`). Market V2 host leave advances first so that advancement belongs to the complete terminal transaction, then captures/retains the result (`biome-shop-phase.ts:757-864`); both sides use idempotent `advance(fromPinned)`.
- Reward/market embedded inside an open Mystery does not advance; the Mystery terminal owns the sole alternation advance (`select-modifier-phase.ts:2193-2225`; `biome-shop-phase.ts:939-959`).
- Crossroads: input ID/control is established before actionable input. Stay mutates `erMarkBiomeStay`, advances from pin, settles operation, then captures/commits result. Leave mutates `setErLeaveBiomeNow`, stores the same pin, queues SelectBiome, settles/commits Crossroads, and does **not** advance. SelectBiome later picks/receives destination, queues SwitchBiome and associated host transition effects, advances the preserved pin once, clears the chain pin, settles, and captures/commits (`er-crossroads-phase.ts:1033-1109`; `select-biome-phase.ts:1520-1668`).
- Natural multi-node biome choice pins only after the preceding shop boundary barrier, then advances once at map terminal. Pure deterministic natural travel uses owner seat 0 and does not consume alternation (`select-biome-phase.ts:521-578,1520-1668`).
- Single learn: prompt commits before public control. The owner callback fixes the decision ID; host applies the forget/learn mutation; at phase terminal `settleCoopV2InteractionOperation` runs and the complete result is committed (`learn-move-phase.ts:214-327,604-687,700-790`). Batch follows the same prompt→owner choice→host authoritative assignments/form-change→settle→result commit order (`learn-move-batch-phase.ts:304-573`).
- Wave: complete settled state and transition already exist; runtime constructs a tick-addressed immutable entry and authority-stated destination. A predecessor-control deferral retains the exact entry; a different boundary is refused. Replica staging advances ordering separately from DATA-at-BattleEnd and continuation-ready latches (`coop-wave-operation.ts:723-865,1128-1200`; `coop-runtime.ts:10397-10546`).

## 4. Proposal fingerprints and duplicate behavior
- Wire choice fingerprint at authority receive (`coop-interaction-relay.ts:1981-2010`) is exactly `JSON.stringify([seq, kind, choice, data ?? null, rewardSurface ?? null])`.
- Sender leases use the same tuple for reward (`select-modifier-phase.ts:1750-1803`) and market buy/leave (`biome-shop-phase.ts:842-875,1505-1512`). Therefore exact examples are Crossroads `[9600000+p,"crossroads",0|1,null,null]`, biome `[9700000+p,"biomePick",nodeIndex,[biomeId],null]`, single learn `[9100000+slot,"learnMove",forgetSlot,null,null]`, and batch `[9150000+slot,"learnMoveBatch",choice,dataOrNull,null]` after JSON serialization.
- `CoopV2ProposalAdmissionLedger` is first-writer-wins for one epoch: new ID/fingerprint=`admitted`; identical retry=`duplicate` and is dropped before FIFO delivery; same ID/different fingerprint=`conflict`; invalid values and capacity 8192 fail closed. It never allocates revision or authorizes mutation (`proposal-admission.ts:14-55`). Reset occurs on relay clear/epoch transition (`coop-interaction-relay.ts:1653-1705`).
- Non-authority `ProposalLeaseManager`: same active ID+same fingerprint=`already-retained` and refreshes callbacks/resends; different fingerprint=`conflict`; after exact ordered operation observed=`already-committed`; active proposals retry with 250ms exponential backoff capped at 5s and have a non-pausable 1,200,000ms ceiling (`proposal-lease.ts:21-145,180-238`). Proposal traffic is non-mechanical and consumes no global revision.
- Surface-level exactness is still mandatory after generic admission: reward and biome host adoption derive the expected operation ID and reject `proposal-operation-id-mismatch` (`coop-reward-operation.ts:1458-1467`; `coop-biome-operation.ts:1462-1467`); single/batch learn host requires decision ID=prompt ID+1 (`learn-move-phase.ts:649-681`; `learn-move-batch-phase.ts:500-526`).
- Global replica duplicates (`authority-log.ts:1385-1548`): wrong session/seat map hard reject; same session/different epoch=`staleEpoch`; membership or non-authority sender mismatch rejects; completed revision=`duplicate-complete` without reapply; pending revision retries only missing material/control and must be byte-identical or reject `revision-identity-conflict`; gaps request the missing tail; next revision must satisfy predecessor control.

## 5. Wrong-seat, stale, and failure behavior
- Physical human input is allowed only if active control ownerSeatId equals localSeatId and the exact installed executable phase token, handler token/name/mode are still active/actionable (`control-ledger.ts:685-704`). A watcher can project an active cosmetic handler but cannot receive human-input authority. Authority-side remote proposal wait is rejected if authority’s local seat is itself the owner; it must exactly match control operation ID plus derived seq, ordered accepted kinds, reward surface, and waiter generation (`control-ledger.ts:548-610`; `coop-runtime.ts:5634-5794`).
- Reward watcher rejects a pin below the highest adopted pin or at/below that stream’s terminal pin. Wrong derived owner returns `host-wrong-owner`; wrong exact proposal ID rejects; a complete/in-flight exact operation is not executed twice (`coop-reward-operation.ts:1384-1545`).
- Biome watcher rejects pins below lastAppliedPinned and duplicate operation IDs after the live materialization receipt is released. Durable/V2 committed mismatches remain closed and retry exact receipt; only legacy/no-commit timeout paths may choose deterministic fallback (`coop-biome-operation.ts:1441-1669`; phase retry branches in `er-crossroads-phase.ts:734-883` and `select-biome-phase.ts:799-1024`).
- Learn V2 missing/wrong prompt-result identity fails the shared session; the documented timeout “keep current moves” fallback is reached only outside exact V2 identity enforcement because V2 checks `res?.operationId` first. Batch behaves the same.
- Wave fixed-seat validation rejects nonzero owner. Legacy watcher treats older/already-applied wave as stale skip; malformed/gap/absent exact retained payload is fail-loud. Global V2 additionally rejects wrong authenticated authority sender/context and predecessor-control mismatch.

## 6. RNG source/draw order/rounding
- Ownership, counter advancement, operation IDs, action ordinals, proposal fingerprints, duplicate classification, move ownership, and wave IDs consume **zero RNG draws**.
- Crossroads timeout fallback uses `erHasNotoriety(sourceWave)` and consumes no RNG (`er-crossroads-phase.ts:838-850`; `er-biome-notoriety.ts:70-72`).
- Biome legacy/test deterministic fallback (`select-biome-phase.ts:979-990,1081-1083`) returns content ID `END=50` at next-wave multiples of 50 with zero draws. Otherwise `BattleScene.generateRandomBiome` (`battle-scene.ts:3253-3275`) uses global `Phaser.Math.RND`: filter out Town=0 and End=50; compute `relWave=wave%250`; depth weights; each biome weight is `Math.ceil(depthWeight/depthDivisor)`; sum thresholds; exactly one `randSeedInt(totalWeight)` draw, which is inclusive integer [0,totalWeight-1], and select first threshold strictly greater than the draw. The final `randSeedItem` fallback would add a second global-seed draw only if no threshold matched; normal positive summed thresholds make that branch unreachable from the observed arithmetic, so M4 must not assume a second draw without a concrete oracle case. Concrete observed biome content IDs: Town 0, Plains 1, End 50 (`enums/biome-id.ts:3-39`).

## 7. Proposed M4-supported subset (not observed TS behavior)
- Model exactly two seats, explicit ownerSeatId, persisted non-negative interaction counter, and from-pinned idempotent advance.
- Support ambient reward and market streams plus ordered reward surfaces with the exact 100000/5000 slot grammar; free reward terminal, paid continuing actions, leave terminal, and Mystery-owned no-advance.
- Support Crossroads Stay and Leave→interactive/deterministic biome continuation with the same pinned owner and one total advance; natural interactive and fixed-seat deterministic biome selection.
- Support single and batch level-up move learning keyed by explicit Pokémon owner and partySlot; preserve numeric moveId as opaque content ID until another oracle selects concrete moves.
- Support production global V2 wave/terminal tick IDs, fixed authority owner, dense global revisions, and separate material/control completion.
- Fixture examples may use biome IDs Town=0, Plains=1, End=50 and the fresh IDs enumerated above. No concrete Pokémon species or move content ID was present in the ownership code read; selecting one here would be guessing.

## 8. Contradiction inventory / explicit gaps
1. `coop-operation-envelope.ts:41-46` correctly documents four ID fields, but its helper comment at lines 592-600 says “three components” and shows a three-part template while implementation emits four. Implementation is oracle.
2. `authority-v2/adapters/interactions-reward.ts:296-303,626-630` exports alternate `IREW/e…/w…/s…/a…`, `IMKT/...`, and `IBIO/...` grammars. Production interaction cutover does **not** mint them: `buildCoopV2InteractionEnvelopeEntry` explicitly preserves `wireOperation.id`, which is the four-field legacy/cutover grammar. Adapter grammars are pure adapter/shadow defaults and must not become Rust production oracle IDs.
3. Shadow relay taps mint synthetic `IX/RELAY/<kind>/e…/w…/t…/s…/q…` (`authority-v2/shadow.ts:965-968`). They are evidence-only, not production interaction IDs.
4. Wave has two real TypeScript identities: legacy compatibility `${epoch}:0:WAVE_ADVANCE:${wave}` and cutover `V2/WAVE/e…/w…/tick…`; under V2 the latter is authoritative. Rust must not merge them or use the legacy grammar for global V2 wave fixtures.
5. `coop-seq-registry.ts:8-27` says relay kind is advisory/never compared, but current `CoopInteractionRelay.awaitInteractionChoice` does validate expected kind and reward surface (`coop-interaction-relay.ts:396-417,810-1000`). Numeric seq alone is no longer the whole acceptance rule.
6. Generic proposal ingress checks only `isValidOperationId` (nonempty, bounded, no controls) and fingerprints the tuple; `deliverInteractionChoice` matches seq/kind/rewardSurface but not the proposal operation ID to the active control (`coop-interaction-relay.ts:1771-1804,1981-2010`). Exact ID is enforced downstream by migrated reward/biome/learn surfaces. Therefore generic ingress alone is **not** an oracle for wrong-seat/exact-control authorization; an unrecognized callback-driven surface without a downstream exact-ID check is a stop condition.
7. Missing Pokémon `coopOwner` is observed to default to host. Whether Rust should preserve that legacy default or require explicit owner is a migration decision, not derivable from this oracle. For M4 fixtures, carry owner explicitly.
8. UI choice contents are callback-driven. The oracle establishes who may invoke the callback and when settlement occurs, not which option a human chooses. No outcome should be invented. Likewise reward/market option-pool RNG belongs to the reward RNG oracle, not this identity oracle.
9. `getCoopPendingWaveAdvanceBoundary` deliberately returns null when zero or multiple unresolved wave transactions exist (`coop-wave-operation.ts:205-221`). Multiple unresolved boundaries are ambiguous and are a hard stop, not a selection rule.
10. The adapter `interactions-reward.ts` address includes wave but production reward action ID encodes pinned interaction/action slot and no wave. Wave remains in the enveloped authority state/control coordinate. Rust must preserve this separation.
