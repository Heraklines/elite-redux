# M3-00B state oracle

Status: contract extraction only. This file does not implement mechanics, Rust
types, shared contracts, fixtures, workflows, or production TypeScript.

## Provenance and notation

The required M2 base and this worktree were checked before extraction:

- branch: wrk/rk-m3-00b-state
- base/starting HEAD: 7357166c19bdb5cf0e32c84b0f74f22e79d80798
- pinned TypeScript oracle object: 3b534099919efae827019d4a3f3c4ab0ecd6d67b
- owned path: docs/plans/rust-kernel/m3-state-oracle.md

Every O: citation below means the exact path and line range in the pinned
oracle object above, not the moving worktree branch. S-A: and S-B: refer to
the two supplied specifications:

- S-A: C:\Users\micha\.codex\attachments\7e00bf5e-bf63-4b3b-af75-9aaa20adab3f\pasted-text.txt
- S-B: C:\Users\micha\.codex\attachments\0101a579-a555-4616-868f-534582329ec2\pasted-text.txt

Observed means directly represented or normalized by the pinned source.
Contract means the M3 shape required by the specifications or a proposed
translation of an observed field. Gap means the pinned source does not expose
enough evidence to claim parity.

## 1. Canonical state boundary

The M3 specification assigns serializable state to GameState, BattleState,
PokemonState, FieldState, StatusState, MoveSlotState, TurnState, CommandSet,
and BattleFormat; mechanics remain outside that state layer.
[S-A:L212-L228]

The prescribed top-level state is:

- GameState: schema_version, content_hash, mode, wave, run_rng, and an
  optional battle.
- BattleState: battle_id, wave, turn, format, both parties, both field
  occupancies, weather, terrain, side conditions, battle RNG, command
  collection, faint queue, and outcome.
- A field slot contains a stable Pokémon ID, never a second full Pokémon
  object. The required invariants include bounded HP, fainted iff hp == 0,
  unique IDs, valid field references, seven bounded stat stages, valid
  content move IDs, PP bounds, and legal owner seats.
[S-A:L288-L389]

This is the mechanical state boundary. A restorable runtime snapshot is
wider: the second specification requires canonical game/battle state plus
pending commands, pending faint queue, current battle control, RNG, and any
prepared transaction. The pending control and transaction are therefore
snapshot state, not optional UI diagnostics.
[S-B:L231-L358]

The pinned co-op source has three different state carriers, which must not be
collapsed into one lossy schema:

1. CoopBattleCheckpoint is a small post-turn field/arena delta.
2. CoopFullBattleSnapshot is a heavy resync carrier.
3. CoopAuthoritativeBattleStateV1 is the full party/field authority image
   used by the newer authority path.
[O:src/data/elite-redux/coop/coop-transport.ts:L618-L645]
[O:src/data/elite-redux/coop/coop-transport.ts:L750-L849]
[O:src/data/elite-redux/coop/coop-transport.ts:L1001-L1049]

The Rust state should be total and typed even when a wire carrier is
delta-shaped. An omitted checkpoint field means “not carried by this carrier,”
not a canonical null, default, or instruction to overwrite state.

## 2. Identity and topology

### 2.1 Typed IDs

The M3 public contract requires SpeciesId, MoveId, AbilityId, and PokemonId
as SafeU53 newtypes; BattleId is also a SafeU53 newtype. FieldIndex and
PartyIndex are u8; TurnIndex and WaveIndex are SafeU53. Public battle APIs
must not expose raw integers.
[S-A:L288-L305]

The TypeScript runtime has numeric species, move, and ability identities:
PokemonData carries species, abilityIndex, and a moveset, while PokemonMove
carries a moveId.
[O:src/system/pokemon-data.ts:L19-L78]
[O:src/data/moves/pokemon-move.ts:L29-L45]

Pokemon.id is not a safe cross-client identity authority by itself. The
runtime documents it as a random 32-bit unsigned personality/PID and even
marks the use as a future cleanup; the co-op checkpoint deliberately uses
party index plus species identity rather than mon.id for the switch mirror.
[O:src/field/pokemon.ts:L341-L348]
[O:src/data/elite-redux/coop/coop-transport.ts:L550-L571]
[O:src/data/elite-redux/coop/coop-battle-engine.ts:L220-L236]

The newer authoritative carrier does copy mon.id into a field seat's
pokemonId, and its party entries are serialized PokemonData records. That is
an authority-image convention, not proof that the original per-process PID
is globally stable. The engine rejects duplicate IDs within one side but
explicitly allows reuse across opposing parties.
[O:src/data/elite-redux/coop/coop-battle-engine.ts:L2712-L2758]
[O:src/data/elite-redux/coop/coop-battle-engine.ts:L2754-L2777]

Contract decision 1. Rust PokemonId is the canonical identity and must be
unique across both parties, as required by the M3 invariant. The adapter must
map it to the pinned authority image explicitly; it must not use partyIndex,
species ID, or a transient Phaser object as the Rust identity. The stricter
cross-party uniqueness rule is intentional: it closes the gap between the M3
contract and the current engine's same-side-only duplicate check.

### 2.2 Battle/session identity

The pinned Battle object exposes waveIndex, turn, battleType, battleSeed, and
a private saved battle RNG state. It does not expose a battleId field; an
exact-object search for battleId in src/battle.ts, the checkpoint, and the
transport found no match.
[O:src/battle.ts:L68-L97]

Co-op authority identity instead has run/session identity, session epoch,
seat, authority seat, membership, and connection-generation axes.
Authenticated identity is deferred until the shared binding and membership
are available; the compatibility path uses a run ID plus epoch.
[O:src/data/elite-redux/coop/authority-v2/session-identity.ts:L21-L39]
[O:src/data/elite-redux/coop/authority-v2/session-identity.ts:L49-L85]

Gap G1 — BattleId. There is no pinned TypeScript field from which to extract
the prescribed BattleId. The Rust layer needs a deterministic
allocation/mapping rule, but no parity value is asserted here. Until that
rule is frozen, battleSeed, (wave, turn), and authority operationId must not
be silently relabeled as BattleId.

### 2.3 Format, slots, and occupancy

The pinned TypeScript format is data-driven: each side has a kind, capacity,
base flat index, mirroring flag, and optional team; the format also owns an
adjacency matrix. Singles use player index 0 and enemy index 2; doubles use
player indices 0/1 and enemy indices 2/3. The source also has a triple
format, but that is outside the M3 supported slice.
[O:src/data/battle-format.ts:L31-L75]
[O:src/data/battle-format.ts:L111-L135]
[O:src/data/battle-format.ts:L202-L238]

The M3 topology contract intentionally replaces fixed battler-index
assumptions with BattleSide, FieldSlot { side, position }, capacities, and
explicit adjacency. Singles and co-op doubles have capacities in {1,2} while
the representation must remain extensible to three.
[S-B:L618-L659]

The canonical occupancy is therefore:

- player_field[position] -> Option<PokemonId>;
- enemy_field[position] -> Option<PokemonId>;
- a validated FieldSlot -> Option<PokemonId> view for generic code;
- no duplicate full Pokémon copies in slots.

The checkpoint wire is flatter: it sends one CoopSerializedMonState for each
slot-present field occupant. The engine intentionally includes just-fainted
occupants on both sides, with hp == 0 and fainted == true, so absence cannot
be treated as the only representation of a vacant or fainted slot. The
authoritative seat carrier separately has presented; logical field membership
includes just-fainted and pre-intro occupants, and presentation must not be
inferred from the logical list.
[O:src/data/elite-redux/coop/coop-battle-engine.ts:L294-L307]
[O:src/data/elite-redux/coop/coop-transport.ts:L979-L999]

The co-op replacement address uses a side-local fieldIndex; enemy-side
indices are converted by subtracting the enemy offset before being placed in
the replacement address. That address is not the Rust topology key.
[O:src/data/elite-redux/coop/authority-v2/command-frontier.ts:L167-L219]

Contract decision 2. Keep FieldSlot as the Rust topology identity and perform
the legacy flat-bi conversion only at the TypeScript adapter. Keep logical
occupancy separate from presented presentation state. A field occupant must
resolve to a party member on the same side, and one Pokémon may occupy at most
one slot.

## 3. Canonical Pokémon state

### 3.1 Party membership and owner

The prescribed PokemonState fields are stable ID, optional owner seat,
species, form, level, types, battle stats, HP/max HP, status, seven stat
stages, moves, four-slot ability loadout, and fainted state.
[S-A:L334-L389]

The checkpoint exposes partyIndex, speciesId, and optional coopOwner
("host" | "guest"). partyIndex is a stable party-slot diagnostic and is not
the stable Pokémon identity. The full authority field seat adds side, bi,
partyIndex, pokemonId, presented, optional numeric ownerSeatId, optional
legacy owner role, and optional enemy boss-segment index.
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L28-L75]
[O:src/data/elite-redux/coop/coop-transport.ts:L979-L999]

The authoritative party image is ordered separately for player and enemy
parties. PokemonData also carries player/enemy, form, level, HP, stats,
moves, status, tera, boss, ownership, and summon/battle data.
[O:src/data/elite-redux/coop/coop-transport.ts:L1001-L1049]
[O:src/system/pokemon-data.ts:L19-L90]

Presence and nullability:

- Rust owner_seat is Option<SeatId>: an unowned AI enemy is allowed by the
  authority frontier, while a commandable human actor must have an owner.
- Wire coopOwner, owner, ownerSeatId, formIndex, and per-turn abilityId/moves
  are optional compatibility/delta fields.
- A canonical party member and canonical form index are not optional. An
  omitted delta must be filled from the preceding canonical state or a full
  authority image; it must not be converted into “unknown.”
- Wire partyIndex == -1 is an observed defensive sentinel for “not found in
  party.” It cannot be cast to Rust PartyIndex(u8); it is an invalid canonical
  field reference and must be rejected or represented as an explicit
  adapter-only absence.
[O:src/data/elite-redux/coop/coop-battle-engine.ts:L220-L236]
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L147-L166]

### 3.2 Types, form, level, and stats

The live Pokémon stores species, form index, ability index, level, HP, a
six-entry stats array, moveset, and nullable status. Its effective battle
stats can prefer in-battle summon overrides over base stats; getMaxHp()
returns the effective HP stat.
[O:src/field/pokemon.ts:L359-L375]
[O:src/field/pokemon.ts:L1831-L1847]
[O:src/field/pokemon.ts:L2244-L2252]

Effective typing also has more than the base species value: the source
considers summon typing overrides, an added type, fusion/transform state, and
tera typing when applicable.
[O:src/field/pokemon.ts:L2572-L2674]

The per-turn checkpoint does not carry types or the full stat array; it
carries numeric hp, maxHp, and stages. The full authoritative party
serializer explicitly stamps live base stats and live summon stat stages
into PokemonData before publication.
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L147-L166]
[O:src/data/elite-redux/coop/coop-battle-engine.ts:L2668-L2710]

Gap G2 — effective stats/types. A checkpoint alone cannot reconstruct the
complete canonical BattleStats or effective type vector. The oracle exporter
must capture the authoritative party image at a defined battle boundary and
resolve base versus summon-effective values. No parity data is fabricated
from maxHp alone.

### 3.3 HP and faint

The co-op serializer clamps maxHp to at least 1, truncates it, clamps hp
into [0, maxHp], and forces fainted true when hp == 0, regardless of the
incoming flag. It truncates/sanitizes the numeric species, party index,
status, move IDs, and PP fields as shown below.
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L147-L211]

The authority boundary also clamps a live hp > maxHp before capture.
[O:src/data/elite-redux/coop/coop-battle-engine.ts:L398-L407]

The underlying TypeScript predicate is weaker/different at the raw engine
boundary: Pokemon.isFainted(false) is hp <= 0, while checkStatus=true
additionally requires the FAINT status. The Rust canonical invariant is the
specification's stricter fainted iff hp == 0 after normalization; negative HP
must never survive the state boundary.
[O:src/field/pokemon.ts:L717-L735]
[S-A:L370-L389]

StatusEffect.FAINT is a legacy status enum member, alongside none, poison,
toxic, paralysis, sleep, freeze, and burn.
[O:src/enums/status-effect.ts:L1-L12]

### 3.4 Status and deferred substate

The status object has an effect enum, a toxicTurnCount defaulting to zero,
and optional sleepTurnsRemaining; its constructor preserves those values.
[O:src/data/status-effect.ts:L6-L17]

The co-op checkpoint treats the two companions as separate optional fields:

- toxic is emitted only when the supplied value is finite, positive, and then
  truncated; all other values normalize to zero/omission;
- sleep is emitted when supplied finite and non-negative, then truncated;
  negative, non-finite, and undefined values become omission;
- the sanitizer does not require the status enum itself to be TOXIC or SLEEP.
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L119-L145]
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L197-L211]

The Rust shape must therefore retain StatusState.kind,
toxic_turn_count: u16, and sleep_turns_remaining: Option<u16>.
[S-B:L602-L615]

Contract decision 3. Preserve the two substate fields in canonical state even
when Toxic/Sleep mechanics are deferred. Do not silently erase them or coerce
an unsupported status to NONE. The cross-field rule “substate must match kind”
is not observed in the sanitizer and remains an explicit parity decision for
the fixture/exporter, not an invented invariant.

### 3.5 Stat stages

TypeScript uses seven battle stages in the order ATK, DEF, SPATK, SPDEF, SPD,
ACC, EVA. The summon data initializes seven zeros and setter writes clamp to
[-6, 6].
[O:src/data/pokemon/pokemon-data.ts:L260-L283]
[O:src/field/pokemon.ts:L1877-L1900]

The checkpoint always emits exactly seven entries: it pads missing entries
with zero, truncates excess entries, and clamps each value with truncation to
[-6,6]. The received state is normalized through the same shape.
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L97-L100]
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L147-L166]
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L265-L294]

The Rust canonical invariant is exactly seven finite bounded stages. A
non-finite source value is a malformed state even though the pinned
JavaScript clamp helper does not explicitly test NaN.

### 3.6 Moves and PP

Each TypeScript move slot contains moveId, ppUsed, ppUp, and an optional
maxPpOverride. Maximum PP is derived from the content move, PP Ups, or the
override; PP use is capped at that maximum, and a move is out of PP when
ppUsed >= maxPP unless the move has the unbounded -1 maximum.
[O:src/data/moves/pokemon-move.ts:L29-L45]
[O:src/data/moves/pokemon-move.ts:L97-L119]

The checkpoint's optional move list contains only { id, ppUsed } in moveset
slot order. Both are truncated and clamped non-negative by the serializer.
The full mon snapshot uses ordered [moveId, ppUsed] pairs.
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L178-L191]
[O:src/data/elite-redux/coop/coop-transport.ts:L580-L615]
[O:src/data/elite-redux/coop/coop-transport.ts:L683-L747]

Gap G3 — PP metadata. The per-turn and full-field co-op carriers do not carry
ppUp or maxPpOverride; the authoritative PokemonData.moveset can carry the
richer move objects, but that path is a plain JSON party image. The canonical
MoveSlotState must retain enough resolved max-PP information to validate
pp_used <= max_pp; the extractor must not infer it from ppUsed alone.

### 3.7 Ability loadout and suppression

The M3 specification requires exactly four modeled ability slots: one active
ID, three optional passive IDs, one active-suppressed flag, and three
passive-suppressed flags. An arbitrary unordered vector is not acceptable.
[S-B:L583-L600]

The live source resolves the active ability through summon override, runtime
overrides, custom data, form/species data, and a defensive NONE fallback. It
resolves three passive slots with per-slot overrides and may append additional
ER gift abilities after the three real selectable slots.
[O:src/field/pokemon.ts:L2695-L2772]
[O:src/field/pokemon.ts:L2774-L2847]
[O:src/field/pokemon.ts:L2850-L2931]

Summon state has abilitySuppressed, three erSuppressedInnateSlots,
source-aware timed ability suppressions, and transform ability/passive
overrides. suppressAbility() sets the broad suppression flag;
canApplyAbility() also gates by slot suppression, suppressed IDs, requested
field ability, arena ignore-abilities, Neutralizing Gas, HP/faint, and other
conditions.
[O:src/data/pokemon/pokemon-data.ts:L219-L257]
[O:src/data/pokemon/pokemon-data.ts:L260-L330]
[O:src/field/pokemon.ts:L3091-L3099]
[O:src/field/pokemon.ts:L3283-L3374]

The checkpoint interface permits an optional active abilityId, but the current
field reader does not populate passive slots or suppression flags; the full
mon snapshot carries a required active abilityId but still has no
passive-loadout or suppression fields of its own.
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L48-L75]
[O:src/data/elite-redux/coop/coop-battle-engine.ts:L240-L277]
[O:src/data/elite-redux/coop/coop-transport.ts:L683-L747]

Gap G4 — ability parity carrier. A checkpoint/full-field read cannot by
itself prove the four-slot loadout or suppression state. The authoritative
party summonData is richer, but the authority validator types it as
Record<string, unknown>[] and does not validate these nested fields.
[O:src/data/elite-redux/coop/coop-transport.ts:L1001-L1049]
[O:src/data/elite-redux/coop/coop-authority-state-validator.ts:L9-L51]

Contract decision 4. Freeze the Rust four-slot loadout as the canonical
state. Capture the active/passive IDs and structural suppression flags from
the authoritative party/summon image. Treat dynamic suppression sources
(arena/global suppression, timed source records, requested field ability,
transform/gift additions) as explicit additional state or unsupported
content; never turn an unobserved ability into NONE.

## 4. Field conditions

### 4.1 Weather and terrain

The arena owns nullable weather and terrain objects, exposes numeric
weatherType/terrainType values with NONE as the fallback, and may report
terrain as inactive while retaining the underlying terrain object under field
effect suppression.
[O:src/field/arena.ts:L169-L190]
[O:src/field/arena.ts:L214-L238]

The checkpoint and authoritative carriers expose weather and terrain enum
numbers plus separate remaining-turn counters. Checkpoint construction
truncates and clamps all four scalars to non-negative values; the authoritative
validator requires the scalars to be finite, while it does not validate enum
ranges.
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L213-L227]
[O:src/data/elite-redux/coop/coop-authority-state-validator.ts:L25-L49]

The Rust state should retain both type and duration. Weather/terrain mechanics
are outside this state-extraction task; no effect is inferred from a numeric
enum.
[S-A:L50-L70]

### 4.2 Side conditions and ability suppression context

The arena has a flat list of active tags across both sides. The co-op wire
identity is tagType: string, side: number (0 both, 1 player, 2 enemy),
turnCount, and layers. Checkpoint serialization clamps side/turnCount to
non-negative truncated values and keeps at least one layer; empty
arenaTags: [] is a meaningful “clear all carried tags” signal, while omitted
arenaTags means an older sender left local tags unchanged.
[O:src/field/arena.ts:L169-L182]
[O:src/data/elite-redux/coop/coop-transport.ts:L538-L547]
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L88-L100]
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L231-L240]

The checksum intentionally hashes only tag identity (tagType, side), not tag
counters; it also excludes weather/terrain remaining-turn counters. Those
durations remain canonical state and are force-set for rendering, but are not
deterministic digest inputs in the pinned co-op checksum.
[O:src/data/elite-redux/coop/coop-battle-checksum.ts:L20-L29]
[O:src/data/elite-redux/coop/coop-battle-checksum.ts:L111-L160]

Arena.ignoreAbilities and its ignoring-effect source are separate arena
fields, and are not present in the checkpoint or authoritative V1 field
schema. This is material to ability suppression because canApplyAbility()
checks the arena flag.
[O:src/field/arena.ts:L169-L190]
[O:src/field/pokemon.ts:L3360-L3374]
[O:src/data/elite-redux/coop/coop-transport.ts:L1001-L1049]

Gap G5 — side-condition encoding and global suppression. The Rust
specification names [SideConditions; 2], while the pinned wire uses one flat
list with a BOTH side and carries no explicit ignoreAbilities bit. Freeze a
lossless BOTH representation and an explicit global ability suppression
representation before claiming ability/field parity.

## 5. Commands and restorable control state

### 5.1 Canonical command collection

The M3 command contract is a typed Fight { actor, move_slot, target } or
Switch { actor, party_slot }, with every command revalidated at resolution.
Enemy commands are deterministic scripted policy during M3.
[S-A:L664-L686]

The legacy TypeScript battle stores a TurnCommand with a command enum,
optional cursor/move/targets/skip/args, in a numeric map keyed by active flat
battler indices. incrementTurn() increments the turn, recreates command maps
for the format's active indices, and clears the saved battle substream.
[O:src/battle.ts:L50-L66]
[O:src/battle.ts:L281-L288]

The co-op wire SerializedCommand has command, cursor, optional moveId,
numeric targets, stable target references { side, pokemonId }, useMode,
baton, and tera. The host-authored offer contains legal move slots/target
sets, switch slots, ball types/targets, and run permission.
[O:src/data/elite-redux/coop/coop-transport.ts:L260-L306]

The pinned validator requires safe-integer command/cursor values; a Fight must
match an offered move ID, normal use mode, allowed tera, and an offered target
set; a switch must contain no Fight fields and must match an offered legal
party slot. The validator also accepts BALL and RUN in the legacy wire.
[O:src/data/elite-redux/coop/coop-battle-command-offer.ts:L46-L87]
[O:src/data/elite-redux/coop/coop-battle-command-offer.ts:L115-L137]

Contract decision 5. The Rust command collection is keyed by canonical actor
PokemonId and current TurnIndex; it stores only the M3 Fight/Switch semantic
command. Numeric cursor, flat bi, target indices, baton, and legacy command
enum values remain adapter fields. BALL and RUN are explicit out-of-scope
commands for this slice, not silently accepted as no-ops.

### 5.2 Co-op pending commands

The co-op relay's pending command request contains fieldIndex, turn, and
legal moveSlots, with optional offer, owner role, and an optional
{ epoch, wave, pokemonId } address. A restorable active-control snapshot
contains the same pending-command fields and also phase/interactions/barrier
metadata.
[O:src/data/elite-redux/coop/coop-battle-sync.ts:L45-L75]
[O:src/data/elite-redux/coop/coop-transport.ts:L910-L931]

For a fully addressed request, the relay key includes epoch, wave, owner (or
legacy field index), Pokémon identity, and turn. The relay retains pending
requests, buffered inbox commands, and local outbox decisions; it can
describe pending requests for recovery and rejects malformed/stale restored
surfaces.
[O:src/data/elite-redux/coop/coop-battle-sync.ts:L292-L315]
[O:src/data/elite-redux/coop/coop-battle-sync.ts:L434-L469]
[O:src/data/elite-redux/coop/coop-battle-sync.ts:L846-L923]

Authority V2 replaces the relay's flat pending map with a canonical
COMMAND_FRONTIER containing every human command target
{ ownerSeatId, pokemonId, fieldIndex }. Only presented, living human actors
enter the frontier; an ownerless enemy remains AI and a missing owner is an
unresolved issue rather than a guessed seat.
[O:src/data/elite-redux/coop/authority-v2/contract.ts:L245-L290]
[O:src/data/elite-redux/coop/authority-v2/command-frontier.ts:L71-L123]

Contract decision 6. A runtime snapshot must preserve the exact pending
command collection and current control frontier, including actor identity,
epoch/wave/turn address, legal offer, and retained local decision. Do not
rebuild pending commands from a phase name or current field position.

## 6. Faint and replacement state

### 6.1 What the TypeScript engine records

FaintPhase captures wave, turn, and a per-turn faint occurrence at the faint
event source, then carries that immutable address through later switch phases.
Its legacy source address has no session epoch and no typed field-side object.
[O:src/phases/faint-phase.ts:L50-L70]
[O:src/phases/faint-phase.ts:L119-L123]

After a player faint, the phase checks legal remaining party members: no legal
member queues GameOverPhase; a legal off-field member queues SwitchPhase with
the captured source address. For an enemy faint it queues VictoryPhase and,
when a reserve exists, an enemy switch/summon path. These are phase-queue
branches, not one serializable faint_queue field.
[O:src/phases/faint-phase.ts:L239-L274]
[O:src/phases/faint-phase.ts:L280-L301]

The visible completion later sets status FAINT and calls leaveField().
[O:src/phases/faint-phase.ts:L342-L355]

### 6.2 Authority V2 replacement address

Authority V2 gives one faint a typed source address:

- positive epoch, wave, turn;
- non-negative occurrence distinguishing same-turn/chained faints;
- non-negative side-local fieldIndex.

The proposal also carries a non-negative owner seat and either a selected
{ partySlot, speciesId } or explicit null for “no legal replacement.”
[O:src/data/elite-redux/coop/authority-v2/adapters/faint-replacement.ts:L66-L109]

The replacement successor is explicit: resume a command frontier, open the
next same-turn replacement, wait for an ordered successor, or terminate. A
replacement tail is not nullable local continuation; it is carried in the
REPLACEMENT control and only its head is executable.
[O:src/data/elite-redux/coop/authority-v2/adapters/faint-replacement.ts:L126-L157]
[O:src/data/elite-redux/coop/authority-v2/contract.ts:L259-L290]

The replacement validator rejects non-objects, non-safe/non-positive
epoch/wave/turn, negative occurrence/field/party positions, invalid owner
seats, and non-positive species IDs. It accepts selected: null as a valid
explicit resolution.
[O:src/data/elite-redux/coop/authority-v2/adapters/faint-replacement.ts:L219-L292]

When deriving a chain, the authority enumerates settled faint events in their
input order, filters to living human-owned field seats with legal bench
replacements, numbers the events by occurrence, and stores all later
addresses in remaining. AI-enemy faints do not open a human replacement
picker.
[O:src/data/elite-redux/coop/authority-v2/command-frontier.ts:L160-L220]

Contract decision 7. The Rust faint_queue is an ordered vector of typed faint
occurrences, each carrying the field slot, owner seat, source
(epoch,wave,turn,occurrence), and replacement status/selection. It must
preserve event order and encode no-legal-replacement explicitly. The
authority-stated replacement tail is the control projection of that vector;
it must not be regenerated by local party scanning.

Gap G6 — no single TS queue. The legacy engine's pending faint work lives in
phase objects, while Authority V2 derives a typed ordered tail from turn
events. An oracle exporter must capture the event order and pending successor
at the turn boundary; a final field snapshot cannot prove replacement order.

## 7. Outcome

The legacy engine reaches victory by entering VictoryPhase when the relevant
enemy party has no remaining non-fainted member; it queues BattleEndPhase and
co-op wave resolution. Player exhaustion enters GameOverPhase from
FaintPhase. GameOverPhase stores only an isVictory boolean and publishes the
co-op game-over result.
[O:src/phases/victory-phase.ts:L145-L195]
[O:src/phases/faint-phase.ts:L239-L244]
[O:src/phases/game-over-phase.ts:L49-L58]
[O:src/phases/game-over-phase.ts:L90-L123]

Authority V2 has a richer boundary vocabulary: a wave transition outcome is
win | capture | flee, while a terminal commit reason is game-over | final-flee
| final-boss-credits | shared-fault; the transition also carries next wave,
biome-change, egg-lapse, and victory-kind material.
[O:src/data/elite-redux/coop/authority-v2/adapters/wave-terminal.ts:L66-L116]
[O:src/data/elite-redux/coop/authority-v2/adapters/wave-terminal.ts:L163-L181]

Captures, flee, rewards, and other run-boundary mechanics are explicitly
deferred by the M3 scope.
[S-A:L50-L70]

Contract decision 8. Keep BattleOutcome explicit in canonical state:
in-progress, victory, or defeat for the supported battle slice. Keep
wave/terminal reason and next-control material separate from the mechanical
outcome. Do not derive outcome from an empty field, a phase name, or the
one-bit legacy isVictory. Mapping Authority V2 win/game-over into this slice
is still an adapter decision; capture/flee remain unsupported.

## 8. RNG and turn/wave identity

### 8.1 Observed TypeScript RNG behavior

Battle starts with turn = 0, a seeded 16-character battleSeed, and a nullable
saved battle substream. incrementTurn() increments the turn, recreates
command maps, and clears that saved substream.
[O:src/battle.ts:L80-L97]
[O:src/battle.ts:L281-L288]

Battle.randSeedInt() returns min without drawing when range <= 1. Otherwise
it saves the ambient Phaser RNG state, restores the saved battle substream or
sows shiftCharCodes(battleSeed, turn << 6), sets the temporary seed override,
draws through the seeded integer helper, saves the resulting battle state,
restores the ambient RNG state, and restores the prior override.
[O:src/battle.ts:L610-L633]
[O:src/utils/common.ts:L97-L107]

The M3 RNG contract requires exact Phaser state fields state_string, s0_bits,
s1_bits, s2_bits, and carry; run and battle RNG state are separate, and every
draw has typed stream/reason/range/result plus before/after fingerprints. The
bit fields are hexadecimal IEEE-754 patterns, not JSON numbers.
[S-A:L395-L463]

Contract decision 9. Preserve a run RNG and battle RNG separately. Persist the
battle seed, normalized turn, and optional saved substream; record draw audits
with a closed reason enum. Do not substitute Rust rand, serialize RNG floats
as JSON numbers, or consume a draw for an invalid or unsupported command.

### 8.2 Coordinate gap

The live Battle.turn begins at zero, while the Authority V2 replacement source
documents positive one-based wave/turn addresses and the authoritative state
validator accepts non-negative state addresses. These are different coordinate
conventions in the pinned source.
[O:src/battle.ts:L80-L85]
[O:src/data/elite-redux/coop/authority-v2/adapters/faint-replacement.ts:L72-L84]
[O:src/data/elite-redux/coop/coop-authority-state-validator.ts:L25-L44]

Gap G7 — turn/wave normalization. Freeze one Rust convention and record the
exact adapter conversion for initial turn, settled turn, replacement addresses,
and next-wave turn 1. No numeric base is inferred in this file.

## 9. Co-op carrier field inventory

### 9.1 Per-turn CoopBattleCheckpoint

The interface has optional tick, required field, required weather and terrain
values with durations, optional arenaTags, and optional money.
[O:src/data/elite-redux/coop/coop-transport.ts:L618-L645]

Each field mon has required:

- bi, partyIndex, speciesId, hp, maxHp, status;
- seven statStages;
- fainted.

It may carry:

- moves: { id, ppUsed }[] in slot order;
- isTerastallized, teraType;
- coopOwner;
- toxic and sleep substate;
- formIndex;
- active abilityId;
- ER tag entries { type, turns }.
[O:src/data/elite-redux/coop/coop-transport.ts:L550-L615]

The pure checkpoint builder makes the wire semantics concrete:

- maxHp is at least 1 and truncated; hp is truncated into [0,maxHp];
- partyIndex defaults to -1 and truncates; speciesId defaults to 0 and
  clamps non-negative; status clamps non-negative;
- stages are always seven and clamped;
- moves are optional, ordered, and per-entry ID/PP values clamp non-negative;
- optional form/ability/tera/owner fields are emitted only when their
  type/value checks pass;
- optional ER tags are filtered to string types and non-negative truncated
  turns;
- toxic/sleep follow the substate rules in section 3.4.
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L147-L211]

buildCheckpoint() truncates/clamps arena scalars, includes money only when
finite and non-negative, and includes arenaTags whenever the caller provides
the field, including an empty array. normalizeMonState() routes a received
mon back through the same serializer.
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L213-L257]
[O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L265-L294]

### 9.2 Full CoopFullBattleSnapshot

The full snapshot carries optional tick/session epoch/checksum/membership/
active-control/journal-high-water/control-digest, required field mon
snapshots, weather/terrain plus durations, required arena tags, ordered
player-party species IDs, money, required modifier arrays, and optional lock
tiers, player modifier blobs, ball counts, bench party, biome/seed/wave seed,
ER substrates, and an optional authoritative V1 state.
[O:src/data/elite-redux/coop/coop-transport.ts:L750-L849]

Full field mons require bi, party index, species ID, HP/max HP, status, seven
stages, fainted, active ability ID, form index, ordered [id,ppUsed] moves,
and may carry toxic/sleep state, tera, level/exp, boss segments, held-item
blobs, and a nullable transform image.
[O:src/data/elite-redux/coop/coop-transport.ts:L683-L747]

The transform payload carries copied species/form, moves, types, active
ability, gender, and stats. It is a resync carrier for transform/Imposter
identity, not part of the supported M3 mechanics.
[O:src/data/elite-redux/coop/coop-transport.ts:L647-L680]

### 9.3 Full authoritative V1 state

CoopAuthoritativeBattleStateV1 requires version, tick, wave, turn,
player/enemy PokemonData record arrays, field seats, weather/terrain plus
durations, arena tags, money, ball counts, and player/enemy modifier blobs.
It optionally carries double, score, biome, seed/wave seed, and ER substrates.
[O:src/data/elite-redux/coop/coop-transport.ts:L1001-L1049]

The field-seat structure is the only V1 carrier that explicitly carries
pokemonId, owner-seat metadata, and a presented bit. Its party records are
plain JSON maps, so the canonical Rust state must decode and validate them
before treating them as mechanical state.
[O:src/data/elite-redux/coop/coop-transport.ts:L979-L999]

The shared co-op authority validator only admits a complete envelope when
version is 1, tick is a positive safe integer, wave/turn match the expected
address, double and lock-tier values are booleans, weather/terrain/money
scalars are finite, seed/wave seed are strings, and all required collections
are arrays. It does not validate nested Pokémon/status/ability elements.
[O:src/data/elite-redux/coop/coop-authority-state-validator.ts:L9-L51]

The engine-coupled apply path does additional checks: party IDs and HP must
be numeric, stats finite, IVs in [0,31], moves must have numeric IDs, field
seats must have valid side/safe integer coordinates/presented flags and refer
to a party ID, and arena tags must have string/finite scalar members.
[O:src/data/elite-redux/coop/coop-battle-engine.ts:L3440-L3609]

### 9.4 Checksum coverage versus canonical state

CoopChecksumState is fully concrete (no optionals). It hashes occupied field
mon identity/HP/status/stages/active ability/form/tera/boss/moves/tags/
transform identity, weather and terrain type, arena tag identity, ordered
party species and levels, bench HP/faint, bench moves digest, money,
modifier/held-item digests, ball counts, biome, seed, and save-data digest.
[O:src/data/elite-redux/coop/coop-battle-checksum.ts:L44-L212]

The checksum deliberately excludes weather/terrain durations and per-tag turn
counters, and canonicalizes object keys, array order, and numbers
deterministically. That is a digest policy, not permission to omit those
durations from Rust canonical state.
[O:src/data/elite-redux/coop/coop-battle-checksum.ts:L20-L29]
[O:src/data/elite-redux/coop/coop-battle-checksum.ts:L217-L287]

## 10. Validation matrix and explicit gaps

| State area | Observed oracle rule | M3 consequence |
|---|---|---|
| HP/faint | Checkpoint normalizes maxHp >= 1, 0 <= hp <= maxHp, and forces fainted at zero. [O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L147-L166] | Validate before and after every transition; enforce the stricter Rust fainted iff hp == 0. |
| Party IDs | Engine rejects duplicate IDs within each side; the M3 spec requires uniqueness across both parties. [O:src/data/elite-redux/coop/coop-battle-engine.ts:L2754-L2777] [S-A:L370-L389] | Enforce cross-party uniqueness in Rust and surface a mapping error for legacy collisions. |
| Field references | Engine apply checks side, safe integer bi/party index/ID, unique side:bi, and party membership. [O:src/data/elite-redux/coop/coop-battle-engine.ts:L3547-L3580] | Convert to FieldSlot; reject missing-party or duplicate-slot occupancy. |
| Stages | Exactly seven entries, clamped to [-6,6]. [O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L97-L100] [O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L147-L166] | Reject malformed canonical arrays; do not silently pad a Rust state after admission. |
| PP/content | Wire IDs/PP clamp non-negative; TypeScript computes max PP from move, PP Ups, or override. [O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L178-L191] [O:src/data/moves/pokemon-move.ts:L97-L119] | Require content-resolved move IDs and pp_used <= max_pp; richer PP metadata needs authority export. |
| Form | A separate helper accepts only safe non-negative indexes and checks species form count. [O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L108-L115] | Validate form_index against the content pack; absent per-turn form is delta absence only. |
| Commands | Host offer validation checks safe integer command/cursor and exact offered move/target or switch slot. [O:src/data/elite-redux/coop/coop-battle-command-offer.ts:L46-L87] [O:src/data/elite-redux/coop/coop-battle-command-offer.ts:L115-L137] | Revalidate complete canonical commands at turn resolution; no draw before rejection. |
| Replacement | Authority V2 rejects holes/non-finite coordinates and treats selected null as explicit no replacement. [O:src/data/elite-redux/coop/authority-v2/adapters/faint-replacement.ts:L219-L292] | Use named typed fields, ordered occurrence, and explicit null; no sparse arrays. |
| Authority envelope | Shared validator checks only the top-level V1 envelope and required collection types. [O:src/data/elite-redux/coop/coop-authority-state-validator.ts:L9-L51] | Rust must not rely on this shallow predicate for nested canonical validation. |
| Digest | Co-op checksum excludes duration counters and requires concrete/no-optional checksum state. [O:src/data/elite-redux/coop/coop-battle-checksum.ts:L20-L29] | Keep full state and digest projections as distinct typed views. |

### 10.1 Deferred or nonportable fields

The following are present in the pinned carriers or runtime but are not
portable M3 mechanical state for the supported slice, unless a future fixture
explicitly promotes one:

- capture, flee, rewards/markets, Mystery encounters, run progression, saves,
  browser/Wasm/Phaser adapter details, and non-scripted AI; these are
  explicitly deferred by the M3 scope.
  [S-A:L50-L70]
- experience/level progression, move learning, evolution, and form changes
  beyond what is necessary to represent the current form; the full snapshot
  carries level/exp/bench party because the legacy renderer needs them, not
  because M3 mechanics are frozen here.
  [S-A:L50-L70]
  [O:src/data/elite-redux/coop/coop-transport.ts:L683-L747]
- held items, persistent modifiers, ball inventory, money, score, biome, run
  seed/wave seed, and ER module-let/save substrates; they occur in full
  authority images and checksum coverage but are outside the M3 battle-state
  mechanics contract.
  [O:src/data/elite-redux/coop/coop-transport.ts:L750-L849]
  [S-A:L50-L70]
- boss segment counters, tera state, transform/Imposter copied identity, ER
  battler tags, and presentation-only presented/switch animation data; the
  wire has carriers for them, but no supported M3 mechanics contract was
  supplied for them.
  [O:src/data/elite-redux/coop/coop-transport.ts:L647-L747]
  [O:src/data/elite-redux/coop/coop-transport.ts:L979-L999]
- persistent Pokémon metadata such as nickname, shiny/variant, friendship,
  met fields, IVs/nature, fusion, and pokéball. PokemonData serializes these
  for save/resync purposes, but they are not required by the prescribed
  supported singles/co-op-doubles battle state.
  [O:src/system/pokemon-data.ts:L19-L78]
- Arena.ignoreAbilities, the suppressor source, timed ability-suppression
  provenance, requested-field ability, and other dynamic ability gates until
  the authority carrier proves their exact state.
  [O:src/field/arena.ts:L169-L190]
  [O:src/data/pokemon/pokemon-data.ts:L219-L257]
  [O:src/field/pokemon.ts:L3283-L3374]
- battleType, trainer metadata, participant IDs, faint history, last move,
  battle score, money-scatter, and other Battle bookkeeping. They are
  observable runtime fields but are not fields of the prescribed BattleState;
  promote only if a supported oracle fixture proves a mechanical dependency.
  [O:src/battle.ts:L68-L117]

No deferred field may be silently mapped to a neutral/default mechanic. The
specification explicitly requires unsupported content to fail closed rather
than become NONE, ignored status, or no effect.
[S-A:L470-L579]

## 11. Proposed contract decisions for freeze

1. Typed identity: use SafeU53 newtypes; allocate a Rust BattleId separately
   from battleSeed; map legacy TypeScript PIDs through an authority adapter and
   enforce uniqueness across both parties.
   [S-A:L288-L305]
   [O:src/field/pokemon.ts:L341-L348]
2. Topology: use FieldSlot(side, position) plus explicit adjacency and ID-only
   occupancy; keep flat bi as an adapter coordinate.
   [S-B:L618-L659]
   [O:src/data/battle-format.ts:L31-L75]
3. Total Pokémon record: make canonical form, level, effective types, battle
   stats, HP/max HP, status, stages, ordered moves, four ability slots, owner
   option, and faint flag total. Wire omission is delta omission, not
   canonical null.
   [S-A:L334-L389]
4. Abilities: freeze active plus exactly three passive slots and suppression
   flags; require an authoritative exporter for missing passives, suppression
   context, and dynamic overrides.
   [S-B:L583-L600]
   [O:src/data/pokemon/pokemon-data.ts:L219-L257]
5. Status: retain toxic and sleep substate now, preserve sanitized values, and
   fail closed on unsupported effects rather than erasing them.
   [S-B:L602-L615]
   [O:src/data/elite-redux/coop/coop-battle-checkpoint.ts:L119-L145]
6. Conditions: retain weather/terrain durations and side-condition counters in
   state; keep a separate checksum projection that excludes duration counters
   exactly as the pinned checksum does.
   [O:src/data/elite-redux/coop/coop-battle-checksum.ts:L20-L29]
7. Commands/control: canonical commands are actor-ID Fight/Switch values;
   snapshots preserve exact pending offers, addresses, retained decisions, and
   current authority control; no local phase reconstruction.
   [S-B:L231-L358]
   [O:src/data/elite-redux/coop/authority-v2/contract.ts:L245-L290]
8. Faints/replacements: use typed ordered occurrences and explicit replacement
   selections/null; carry the authority's remaining tail instead of scanning
   parties locally.
   [O:src/data/elite-redux/coop/authority-v2/adapters/faint-replacement.ts:L66-L109]
9. Outcome: use an explicit supported-slice outcome and keep co-op wave or
   terminal reason separate; do not infer from phase queue or field emptiness.
   [O:src/data/elite-redux/coop/authority-v2/adapters/wave-terminal.ts:L74-L116]
10. RNG: preserve the two streams, Phaser state fingerprints, battle
    seed/substream behavior, and typed draw audit; invalid commands consume no
    draw.
    [S-A:L395-L463]
    [O:src/battle.ts:L610-L633]
11. Validation: validate canonical state before and after every transition,
    including duplicate IDs, field references, HP/faint, stages, PP/content,
    owner legality, status substate representation, command offers, and
    replacement addresses.
    [S-A:L370-L389]
    [S-A:L954-L1022]

## 12. Unresolved gaps at handoff

- G1: no pinned BattleId; allocation/mapping and turn/wave base conversion are
  not observed.
- G2: checkpoint lacks full effective stats and types; exporter boundary must
  be frozen.
- G3: co-op move carriers omit ppUp/maxPpOverride; max-PP parity needs
  authoritative party export.
- G4: per-turn/full-field carriers omit passive loadout and suppression state;
  authoritative summonData extraction is required.
- G5: Rust [SideConditions; 2] has no specified lossless mapping for the
  TypeScript BOTH side or arena-wide ability suppression.
- G6: legacy TypeScript has no single serializable faint queue; event order and
  pending replacement tail must be captured at the authority boundary.
- G7: live turn coordinates begin at zero while authority replacement
  addresses are positive/one-based; exact normalization is unresolved.
- The pinned source has no per-draw typed RNG audit record or closed reason
  vocabulary; the exporter must instrument the existing seeded API without
  changing production TypeScript, as required by the specification.
  [S-A:L930-L948]

These gaps are intentionally left as gaps. This document does not claim
mechanics parity, choose unsupported content behavior, or invent oracle
fixture values.
