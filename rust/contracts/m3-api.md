# PokéRogue Redux Rust kernel M3 public contract

Status: G6 contract-freeze draft. It becomes normative at the exact hosted-green
freeze commit recorded as the base of every M3A branch.

Pinned inputs:

- M2 base: `7357166c19bdb5cf0e32c84b0f74f22e79d80798`;
- TypeScript oracle: `3b534099919efae827019d4a3f3c4ab0ecd6d67b`;
- Authority compatibility identifier: `er-coop-48`;
- schema versions: `rust/contracts/m3-contract.toml`;
- writer ownership: `rust/contracts/m3-ownership.toml`.

`elite-redux` remains only in legacy repository/source/protocol identifiers.
The project and the kernel are PokéRogue Redux.

## Change control

After the G6 freeze, workers may implement bodies and private helpers only in
their owned paths. They may not change a public item, serialization tag,
operation grammar, digest domain, content selection, crate dependency, or
failure outcome. A missing capability is a contract request to the integration
owner. Workers never create private wire messages or semantic campaign helpers.
CR-0020 is the integration-owner-approved exception for the doc-hidden staged
game mutation seam described below; it changes no external schema or outcome.

Production TypeScript and `rust/source-lock.toml` are read-only. Production
core contains no callback, async runtime, thread, wall-clock read, sleep,
filesystem/network/browser handle, Phaser value, dynamic content trait object,
or `serde_json::Value` in canonical battle state/material.

## Crate graph and ownership boundary

The dependency graph is acyclic:

```text
er-types
  ├─> er-canonical
  ├─> er-rng
  └─> er-content

er-types + er-canonical + er-rng
  └─> er-state

er-types + er-canonical + er-rng + er-content + er-state
  └─> er-battle
        └─> er-game

er-types + er-canonical
  └─> er-protocol

er-game + er-protocol + existing input/UI/scheduler code
  └─> er-kernel
        ├─> er-sim
        └─> er-wasm
```

- `er-types` owns shared serializable IDs and dependency-leaf DTO value types,
  including `ContentPackHash`; it contains no content tables or mechanics.
- `er-rng` owns exact Phaser state/streams/audits; it uses no Rust `rand`.
- `er-content` owns immutable selected definitions and capability closure.
- `er-state` owns serializable state, structural invariants, and mechanical
  snapshots; it contains no move/ability behavior.
- `er-battle` owns command/target legality and every mechanic. It contains no
  menu, protocol, timer, network, or renderer behavior.
- `er-game` owns logical controls, command collection, menu construction,
  scripted enemy policy, typed TURN/REPLACEMENT material DTOs and common
  appliers, and when the battle resolver is called.
- `er-protocol` remains the sole Authority V2 implementation and treats the M3
  canonical payload bytes as opaque. It validates generic Authority envelope,
  material digest, kind, revision, and operation identity but does not depend
  on `er-game` or deserialize battle mechanics.
- `er-kernel` owns one external-step transaction, raw input/UI adaptation,
  protocol composition, scheduler state, presentation barriers, and effects.
- `er-sim` executes effects and environment faults only; it never chooses a
  canonical outcome.
- `er-wasm` exposes the same production crates and serialized DTOs; it does not
  reimplement mechanics.

## Stable identifiers and topology

All public numeric IDs wrap `SafeU53` with private fields, checked constructors,
and transparent JSON. Raw integers are not accepted by battle APIs.

```rust
pub struct SpeciesId(SafeU53);
pub struct MoveId(SafeU53);
pub struct AbilityId(SafeU53);
pub struct PokemonId(SafeU53);
pub struct BattleId(SafeU53);
pub struct TurnIndex(SafeU53);
pub struct WaveIndex(SafeU53);
pub struct GameModeId(SafeU53);
pub struct MenuInstanceId(SafeU53);
pub struct FaintOccurrenceId(SafeU53);
pub struct AuthorityEpoch(SafeU53);
pub struct ArenaConditionId(String);
pub struct CanonicalHexBytes(String);
pub struct CanonicalU64Decimal(String);

pub struct BattlePresentationEventId {
    pub operation_id: OperationId,
    pub sequence: SafeU53,
}

pub struct PartyIndex(u8);
pub struct MoveSlotIndex(u8);

pub enum BattleSide {
    Player,
    Enemy,
}

pub struct FieldSlot {
    pub side: BattleSide,
    pub position: u8,
}

pub struct AdjacencyEdge {
    pub first: FieldSlot,
    pub second: FieldSlot,
}

pub struct BattleFormat {
    pub player_capacity: u8,
    pub enemy_capacity: u8,
    pub adjacency: Vec<AdjacencyEdge>,
}
```

`CanonicalU64Decimal` accepts only `0` or a nonzero ASCII decimal digit
followed by ASCII decimal digits, with no sign or leading zero, whose parsed
value is at most `18446744073709551615`. It exists only for inherited full-width
protocol/RNG counters that cannot be represented as a JSON safe integer.

`CanonicalHexBytes` is dependency-leaf `er-types` storage for exact opaque
bytes at protocol/network/storage snapshot boundaries: lowercase, even-length
hex with no prefix. It is never a mechanics payload substitute.

`FieldSlot` is the canonical actor/target address. `FieldIndex` or a fixed
magic battler-index enum is not a core M3 identity. Format/edge vectors are
validated, unique, normalized, and sorted. The representation accepts capacity
three without redesign; M3 initialization supports only `1/1` singles and
`2/2` forced co-op doubles and rejects every other capacity.

The selected ownership is fixed: singles player position zero belongs to seat
one; co-op player positions zero/one belong to seats one/two respectively;
seat one is the M3 authority. Enemy positions have no owner seat. The
representation can version data-driven ownership later without relabeling
`FieldSlot`.

`BattleId` is a Rust-owned identity, never an alias for battle seed, wave,
turn, operation ID, or a legacy TypeScript PID. `GameState.next_battle_id`
starts at one, is consumed exactly once when a battle is constructed, and is
then checked-incremented. Exhaustion fails initialization. The oracle exporter
maps its fixture battle to this deterministic allocation and records legacy
identities separately as provenance.

M3 coordinate convention version 1 is frozen as follows:

- `WaveIndex` and every public `TurnIndex` are positive and one-based;
- the oracle constructor's transient `Battle.turn = 0` exists before the first
  command boundary; M3 battle construction performs the oracle turn increment
  internally and first exposes command/resolution turn one;
- TURN command/result and REPLACEMENT operation IDs use that same public turn
  with no base conversion;
- a successful full turn advances `BattleState.turn` exactly once after all
  turn-end mechanics and faint discovery; replacements caused by that turn
  retain its pre-advance `resolved_turn` in their source address while the
  canonical after-state already carries the next command turn.

No worker may infer, clamp, or interchange these coordinate bases.

## Immutable content

```rust
pub struct ContentPack {
    pub schema_version: u32,
    pub oracle_game_sha: String,
    pub hash: ContentPackHash,
    pub species: Vec<SpeciesDefinition>,
    pub moves: Vec<MoveDefinition>,
    pub abilities: Vec<AbilityDefinition>,
    pub type_chart: TypeChart,
    pub capability_manifest: CapabilityManifest,
}

pub struct ContentPackHash(String);

pub struct SpeciesDefinition {
    pub id: SpeciesId,
    pub base_types: PokemonTyping,
    pub base_stats: SpeciesBaseStats,
    pub capability: CapabilityStatus,
}

pub struct SpeciesBaseStats {
    pub hp: u32,
    pub attack: u32,
    pub defense: u32,
    pub special_attack: u32,
    pub special_defense: u32,
    pub speed: u32,
}

pub struct MoveDefinition {
    pub id: MoveId,
    pub category: MoveCategory,
    pub move_type: PokemonType,
    pub power: MovePower,
    pub accuracy: MoveAccuracy,
    pub base_pp: u16,
    pub effect_chance: EffectChance,
    pub priority: i8,
    pub target: MoveTarget,
    pub flags: Vec<MoveFlag>,
    pub effects: Vec<MoveEffectDefinition>,
    pub capability: CapabilityStatus,
}

pub struct AbilityDefinition {
    pub id: AbilityId,
    pub effect: AbilityEffectDefinition,
    pub capability: CapabilityStatus,
}

pub enum CapabilityStatus {
    Supported,
    Unsupported { reason_code: UnsupportedReasonCode },
}

pub struct CapabilityManifest {
    pub schema_version: u32,
    pub oracle_game_sha: String,
    pub entries: Vec<CapabilityEntry>,
}

pub struct CapabilityEntry {
    pub subject: CapabilitySubject,
    pub status: CapabilityStatus,
    pub required_positive_cases: Vec<String>,
    pub required_edge_cases: Vec<String>,
}

pub enum CapabilitySubject {
    Move(MoveId),
    Ability(AbilityId),
    Status(StatusKind),
    Weather(WeatherKind),
    Terrain(TerrainKind),
    ArenaCondition(ArenaConditionId),
}

pub enum UnsupportedReasonCode {
    OutsideSelectedContent,
    EffectVocabularyUnsupported,
    CallbackOrScriptRequired,
    DynamicSuppressionUnsupported,
    FieldConditionMechanicsUnsupported,
    StatusMechanicsUnsupported,
    TargetingUnsupported,
}

pub enum MovePower {
    None,
    Value(u16),
}

pub enum MoveAccuracy {
    AlwaysHits,
    Percent(u8),
}

pub enum EffectChance {
    None,
    Percent(u8),
}

pub enum WeatherKind {
    None,
    UnsupportedOracleCode(u16),
}

pub enum TerrainKind {
    None,
    UnsupportedOracleCode(u16),
}

pub enum AbilitySuppressionSource {
    ArenaIgnoreAbilities,
    FieldAbility(AbilityId),
    TimedSource(PokemonId),
}

pub enum PokemonType {
    Normal,
    Fire,
    Water,
    Electric,
    Grass,
    Ice,
    Fighting,
    Poison,
    Ground,
    Flying,
    Psychic,
    Bug,
    Rock,
    Ghost,
    Dragon,
    Dark,
    Steel,
    Fairy,
    Stellar,
}

pub enum MoveCategory {
    Physical,
    Special,
    Status,
}

pub enum MoveTarget {
    NearOther,
    AllNearEnemies,
}

pub enum MoveFlag {
    Contact,
    ThawsUserFreeze,
    Powder,
    Reflectable,
    IgnoreSubstitute,
}

pub enum MoveEffectDefinition {
    Damage,
    ApplyStatus(StatusKind),
    ChangeStatStage { stat: BattleStat, delta: i8 },
}

pub enum AbilityEffectDefinition {
    None,
    PostSummonAdjacentOpponentAttackMinusOne,
    NonSuperEffectiveAttackImmunity,
}

pub struct TypeChart {
    pub entries: Vec<TypeChartEntry>,
}

pub struct TypeChartEntry {
    pub attack: PokemonType,
    pub defense: PokemonType,
    pub multiplier: SingleTypeMultiplier,
}

pub enum SingleTypeMultiplier {
    Zero,
    Half,
    One,
    Two,
}

pub enum StatusKind {
    None,
    Poison,
    Toxic,
    Paralysis,
    Sleep,
    Burn,
}

pub enum BattleStat {
    Attack,
    Defense,
    SpecialAttack,
    SpecialDefense,
    Speed,
    Accuracy,
    Evasion,
}
```

`ContentPackHash` is declared in dependency-leaf `er-types`; `er-content` owns
the `ContentPack`, definitions, validation, and construction that produce it.
This lets `er-state` store the hash without depending on `er-content`.

Definitions contain closed data enums only. No callback, script string, trait
object, mutable cache, or hidden bespoke effect is allowed. IDs and exact
definitions come only from `m3-slice-manifest.json` and the generated content
fixture. Every reachable active or bench move/ability is capability-checked at
battle initialization. Unsupported content is an initialization error; it is
never converted to NONE or a no-op.

The selected manifest preserves the oracle's raw `-1` sentinels as source
evidence. Content loading normalizes `power = -1` to `MovePower::None`,
`accuracy = -1` to `MoveAccuracy::AlwaysHits`, and `effect_chance = -1` to
`EffectChance::None`; every other accepted value is range-checked. Status moves
must use `MovePower::None`, damaging moves must use `MovePower::Value`, and no
runtime API exposes a sentinel integer.

Capability entries are unique and sorted by subject kind then canonical
identity. Every supported entry names at least one positive and one edge-case
scenario from `m3-coverage-map.json`. Unsupported reachable entries fail battle
initialization; unsupported manifest entries need no fixture claims. The exact
selected classifications and reason codes are frozen in
`m3-capability-manifest.json`.

`TypeChart.entries` stores only non-neutral single-type pairs, sorted by attack
then defense and unique by that pair; an absent pair is `One`. Dual typing
multiplies primary then secondary in JavaScript `Number` order without an
intermediate round. The exact selected non-neutral entries are immutable in the
slice manifest. A type can be represented while its reachable mechanics remain
capability-rejected.

The selected effect vocabulary is closed to:

```text
ordinary physical damage
ordinary special damage
apply Burn, Poison, or Paralysis
selected status admission: existing-status, Fire/Poison/Steel/Electric type,
and Grass powder immunity checks
change one supported stat stage
NONE ability
selected Intimidate-like switch-in stat change
selected attack-type immunity
```

Move/ability hooks, held items, modifiers, weather/terrain mechanics, fixed or
OHKO damage, multi-hit, charging, recoil/drain, type-changing/Tera/Stellar,
Toxic/Sleep behavior, random target/effect selection, and unlisted effects are
unsupported even when a carrier type can represent future state.

For selected loadouts, Poison Powder and Stun Spore retain the POWDER flag;
Grass targets reject them. Poison/Steel reject Poison, Fire rejects Burn, and
Electric rejects Paralysis. Steel/Fire/Electric defenders are absent from the
selected species but the typed admission rule is frozen. Existing non-None
major status rejects a second status. Safeguard, Substitute, reflection,
unselected immunity abilities, Freeze thaw, and other status gates are rejected
by battle capability closure rather than silently ignored.

`ContentPackHash` is `blake3-v1:<64 lowercase hex>`. The 64-hex value is BLAKE3
of the compact strict-kernel canonical JSON bytes for one object containing
exactly `schema_version`, `oracle_game_sha`, `species`, `moves`, `abilities`,
`type_chart`, and `capability_manifest`—that is, the serialized `ContentPack`
with `hash` absent. There is no newline or additional domain byte in this
preimage; the `blake3-v1:` prefix is representation metadata, not hashed input.
Object keys use the frozen JavaScript-compatible canonical order, arrays retain
their declared order, and numbers use the strict signed-safe-integer path over
`-9_007_199_254_740_991..=9_007_199_254_740_991`. This includes PLAY NICE's
typed stat-stage `delta: -1`; no unsigned projection or compatibility
canonicalizer is permitted. It is an internal content identity, not an
Authority material digest.

## Canonical game and battle state

```rust
pub struct GameState {
    pub schema_version: u32,
    pub content_hash: ContentPackHash,
    pub mode: GameModeId,
    pub wave: WaveIndex,
    pub next_battle_id: BattleId,
    pub run_rng: RunRngState,
    pub battle: Option<BattleState>,
}

pub struct BattleState {
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub wave_seed: String,
    pub turn: TurnIndex,
    pub format: BattleFormat,
    pub authority_seat: SeatId,
    pub player_party: Vec<PokemonState>,
    pub enemy_party: Vec<PokemonState>,
    pub field: FieldState,
    pub weather: WeatherState,
    pub terrain: TerrainState,
    pub arena_conditions: Vec<ArenaConditionState>,
    pub global_ability_suppression: GlobalAbilitySuppressionState,
    pub battle_rng: BattleRngState,
    pub command_state: CommandCollectionState,
    pub faint_queue: Vec<FaintOccurrence>,
    pub next_faint_occurrence: FaintOccurrenceId,
    pub outcome: BattleOutcome,
}

pub struct FieldState {
    pub slots: Vec<FieldSlotState>,
}

pub struct FieldSlotState {
    pub slot: FieldSlot,
    pub occupant: Option<PokemonId>,
}

pub struct WeatherState {
    pub kind: WeatherKind,
    pub remaining_turns: u16,
}

pub struct TerrainState {
    pub kind: TerrainKind,
    pub remaining_turns: u16,
}

pub enum ArenaConditionScope {
    Both,
    Side(BattleSide),
}

pub struct ArenaConditionState {
    pub condition: ArenaConditionId,
    pub scope: ArenaConditionScope,
    pub turn_count: u16,
    pub layers: u8,
}

pub struct GlobalAbilitySuppressionState {
    pub ignore_abilities: bool,
    pub source: Option<AbilitySuppressionSource>,
}
```

`FieldState.slots` is the canonical sorted wire form because JSON object keys
cannot safely be composite Rust structs. It contains exactly one unique entry
for every format slot, sorted by side then position. Implementations may build a
private `BTreeMap` index. Full Pokémon objects are never duplicated in field
slots.

`BattleState.wave_seed` is the exact production `BattleScene.waveSeed` string
for this wave. It is distinct from `GameState.run_rng` and
`BattleRngState.battle_seed`: supported speed-tie ordering opens an isolated
seed-offset transaction from this original wave seed. A resolver must never
substitute the run seed, battle seed, or a transient RNG override. The string
is carried losslessly without operation-ID-style lexical normalization; the
closed struct shape makes omission fail deserialization.

```rust
pub struct PokemonState {
    pub id: PokemonId,
    pub owner_seat: Option<SeatId>,
    pub species_id: SpeciesId,
    pub form_index: u16,
    pub level: u16,
    pub types: PokemonTyping,
    pub stats: BattleStats,
    pub hp: u32,
    pub max_hp: u32,
    pub status: StatusState,
    pub stat_stages: StatStages,
    pub moves: [Option<MoveSlotState>; 4],
    pub abilities: AbilityLoadout,
    pub fainted: bool,
}

pub struct PokemonTyping {
    pub primary: PokemonType,
    pub secondary: Option<PokemonType>,
}

pub struct BattleStats {
    pub hp: u32,
    pub attack: u32,
    pub defense: u32,
    pub special_attack: u32,
    pub special_defense: u32,
    pub speed: u32,
}

pub struct MoveSlotState {
    pub move_id: MoveId,
    pub pp_used: u16,
    pub pp_ups: u8,
    pub max_pp_override: Option<u16>,
}

pub struct AbilityLoadout {
    pub active: AbilityId,
    pub passives: [Option<AbilityId>; 3],
    pub active_suppressed: bool,
    pub passive_suppressed: [bool; 3],
}

pub struct StatusState {
    pub kind: StatusKind,
    pub toxic_turn_count: u16,
    pub sleep_turns_remaining: Option<u16>,
}

pub struct StatStages {
    pub attack: i8,
    pub defense: i8,
    pub special_attack: i8,
    pub special_defense: i8,
    pub speed: i8,
    pub accuracy: i8,
    pub evasion: i8,
}
```

`StatusKind` includes `None`, `Burn`, `Poison`, `Toxic`, `Paralysis`, and
`Sleep` so snapshots do not need immediate redesign. M3 initialization accepts
only None/Burn/Poison/Paralysis. Toxic and Sleep state is representable but its
mechanics capability is unsupported. Neutral weather and terrain, an empty
arena-condition list, and disabled global ability suppression are the only
M3-loadable values. The schema still preserves remaining durations, lossless
`Both` condition scope, and explicit global suppression; any active
unimplemented value fails load instead of being erased.

The pinned `Status.incrementTurn()` increments `toxic_turn_count` for every
post-turn Poison, Toxic, or Burn status, even though ordinary Poison/Burn damage
does not scale with it. M3 therefore preserves and increments that field for
Poison/Burn. None and Paralysis require it to be zero. Every supported status
requires `sleep_turns_remaining = None`; Toxic/Sleep mechanics remain rejected.
The exporter may not erase a sanitizer-carried companion value or coerce an
unsupported status to a selected one.

`PokemonState.types` and `PokemonState.stats` are the effective battle-boundary
values exported after all selected scenario overrides. `BattleStats.hp` equals
`max_hp`. Species base values remain immutable content and are never rebuilt
from HP checkpoints. `MoveSlotState` retains the oracle's PP Ups and optional
max-PP override; M3 selected fixtures use zero PP Ups and no override, but the
state shape and validator preserve both fields.

Effective typing contains exactly one primary and at most one secondary type.
An additional type, fusion/transform typing, or active Tera/Stellar typing is
unsupported reachable content and fails load; it is never truncated to fit.

For M3 finite-PP content, the exact maximum is
`override` when a positive override exists; otherwise it is
`base_pp + pp_ups * max(floor(base_pp / 5), 1)`. This preserves the pinned
`maxPpOverride || ...` and `toDmgValue` behavior without JavaScript truthiness
inside canonical state. Source override zero normalizes to `None`. Base PP or
override `-1` denotes unbounded PP in the oracle and is rejected as
`OUTSIDE_SELECTED_CONTENT` for M3; it is never wrapped into an unsigned value.

Minimum invariants, checked before and after every transition, include:

- schema/content identity matches the immutable pack;
- battle wave/turn agree with game and battle RNG coordinates;
- format and field slot closure is exact;
- Pokémon IDs are globally unique and an ID occupies at most one field slot;
- each occupant exists in the correct side's party;
- player ownership is valid for the format; enemy ownership is absent;
- `authority_seat` is one of the format's human seats and agrees with protocol
  role configuration on every endpoint;
- `0 <= hp <= max_hp`, `max_hp > 0`, and `fainted == (hp == 0)`;
- effective `stats.hp == max_hp`, and effective types/stats are total;
- party length is at most six and move slot count is exactly four;
- every species/move/ability exists and is supported for the reachable battle;
- passive order is exactly slot 0, 1, 2 and suppression arrays correspond;
- stages are in `[-6,6]`;
- status substate follows the exact selected status-turn rules above;
- PP used does not exceed content-derived maximum PP;
- PP Ups are in `0..=3`; a max-PP override, when present, is positive;
- command actors/slots/owners and faint occurrences are unique and current;
- outcome and live-party/field facts agree.

The remaining canonical state shapes are frozen as:

```rust
pub enum BattleOutcome {
    Ongoing,
    Victory,
    Defeat,
}

pub struct CommandCollectionState {
    pub frontier: Vec<CommandFrontierEntry>,
    pub tombstones: Vec<CommandFingerprintEntry>,
}

pub struct CommandFrontierEntry {
    pub operation_id: OperationId,
    pub owner_seat: Option<SeatId>,
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub offer: BattleCommandOffer,
    pub status: CommandFrontierStatus,
}

pub enum CommandFrontierStatus {
    Pending,
    Retained {
        command: AcceptedBattleCommand,
        source: CommandAdmissionSource,
    },
    Admitted {
        command: AcceptedBattleCommand,
        source: CommandAdmissionSource,
    },
}

pub enum CommandAdmissionSource {
    AuthorityLocalInternal,
    AuthorityRemoteProposal,
    ScriptedEnemy,
}

pub struct BattleCommandOffer {
    pub fight: Vec<OfferedMoveCommand>,
    pub switches: Vec<OfferedSwitchCommand>,
}

pub struct OfferedMoveCommand {
    pub move_slot: MoveSlotIndex,
    pub legal_targets: Vec<BattleTargetSelection>,
}

pub struct OfferedSwitchCommand {
    pub party_slot: PartyIndex,
    pub pokemon: PokemonId,
}

pub struct CommandFingerprintEntry {
    pub operation_id: OperationId,
    pub fingerprint: BattleCommandFingerprint,
}

pub struct ReplacementProposalFingerprintEntry {
    pub operation_id: OperationId,
    pub fingerprint: BattleReplacementProposalFingerprint,
}

pub struct FaintOccurrence {
    pub id: FaintOccurrenceId,
    pub source: FaintSource,
    pub slot: FieldSlot,
    pub pokemon: PokemonId,
    pub owner_seat: Option<SeatId>,
    pub replacement: ReplacementProgress,
}

pub struct FaintSource {
    pub epoch: AuthorityEpoch,
    pub wave: WaveIndex,
    pub resolved_turn: TurnIndex,
    pub turn_occurrence: u32,
}

pub enum ReplacementProgress {
    NotRequired,
    Pending,
    Selected {
        party_slot: PartyIndex,
        pokemon: PokemonId,
    },
    NoLegalReplacement,
    Applied,
}
```

`CommandCollectionState.frontier` is sorted by canonical format slot order;
each entry preserves the exact legal offer and any retained/admitted proposal
instead of reconstructing it from the current field. At resolution every human
and scripted-enemy entry is `Admitted`; `CommandSet` is projected in frontier
order. Tombstones sort by operation ID.

Admission source is authority-relative, never endpoint-relative: the authority
seat is `AuthorityLocalInternal`, a non-authority human seat is
`AuthorityRemoteProposal` even in that seat's own local snapshot, and enemies
are `ScriptedEnemy`. Human entries have `owner_seat = Some` and a Human accepted
command. Enemy entries have `owner_seat = None`, exactly one script-offered
command, and a ScriptedEnemy accepted command whose cursor matches the
restorable policy.
The queue order of `faint_queue` is causal and is never re-derived from a final
field scan. `FaintSource.turn_occurrence` starts at zero for each resolved turn.
`next_faint_occurrence` allocates globally unique diagnostic IDs; the operation
grammar uses `turn_occurrence`, not that global ID. Just-fainted occupants remain
in their field slots with HP zero until the corresponding faint occurrence is
resolved. A replacement tail is projected from the stored queue and never
regenerated by scanning the party.

## Commands, identity, and admission

```rust
pub enum BattleCommand {
    Fight {
        actor: PokemonId,
        move_slot: MoveSlotIndex,
        targets: BattleTargetSelection,
    },
    Switch {
        actor: PokemonId,
        party_slot: PartyIndex,
    },
}

pub enum BattleTargetSelection {
    Implicit,
    Selected(Vec<FieldSlot>),
}

pub struct BattleCommandProposalV1 {
    pub schema_version: u32,
    pub operation_id: OperationId,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub turn: TurnIndex,
    pub owner_seat: SeatId,
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub command: BattleCommand,
    pub menu_instance_id: MenuInstanceId,
    pub control_id: String,
}

pub struct BattleReplacementProposalV1 {
    pub schema_version: u32,
    pub operation_id: OperationId,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub resolved_turn: TurnIndex,
    pub owner_seat: SeatId,
    pub occurrence: FaintOccurrenceId,
    pub turn_occurrence: u32,
    pub field_slot: FieldSlot,
    pub selection: ReplacementSelection,
    pub menu_instance_id: MenuInstanceId,
    pub control_id: String,
}

pub enum AcceptedBattleCommand {
    Human {
        proposal: BattleCommandProposalV1,
        fingerprint: BattleCommandFingerprint,
    },
    ScriptedEnemy {
        command: ScriptedEnemyBattleCommandV1,
        fingerprint: BattleCommandFingerprint,
    },
}

pub struct ScriptedEnemyBattleCommandV1 {
    pub schema_version: u32,
    pub operation_id: OperationId,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub turn: TurnIndex,
    pub script_cursor: SafeU53,
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub command: BattleCommand,
}

pub struct ScriptedEnemyPolicyV1 {
    pub schema_version: u32,
    pub cursor: SafeU53,
    pub commands: Vec<ScriptedEnemyBattleCommandV1>,
}

pub struct BattleCommandFingerprint(String);
pub struct BattleReplacementProposalFingerprint(String);

pub struct CommandSet {
    pub entries: Vec<AcceptedBattleCommand>,
}
```

`CommandSet.entries` is sorted by the format's canonical command-frontier slot
order, not packet arrival. Every command is fully revalidated immediately
before resolution. Invalid/stale/unsupported commands consume no PP or RNG.

`BattleTargetSelection::Implicit` is legal only when the move has exactly one
deterministic fixed target. `Selected` is non-empty, duplicate-free, sorted by
canonical `FieldSlot`, and must exactly equal one legal single selection or the
complete candidate set for a supported multiple-target move. Legacy attacker
sentinels and flat battler indices are converted only in the oracle adapter and
never enter Rust command identity.

Operation IDs address decision windows, never selected results:

```text
command:
battle/{battleId}/wave/{wave}/turn/{turn}/command/player/{position}/seat/{seat}

scripted enemy:
battle/{battleId}/wave/{wave}/turn/{turn}/command/enemy/{position}/script/{cursor}

turn result:
battle/{battleId}/wave/{wave}/turn/{turn}/result

replacement (extends the pinned Authority V2 adapter component grammar):
RC/e{epoch}/b{battleId}/w{wave}/t{turn}/o{turnOccurrence}/f{fieldPosition}/s{ownerSeat}
```

All numeric components are canonical unsigned decimal without padding or sign.
The command/result grammar uses no percent-encoded component. Replacement is
player-side only in M3, so its `f` component is the player position. Every
string must satisfy the existing Authority operation-token rules. `b` is
mandatory: authority epoch alone is not a battle identity, and omitting
`battleId` would allow replacement and presentation-event collisions across
two battles at the same wave/turn/occurrence coordinates.

`BattleCommandFingerprint` is
`bc1-<canonical UTF-16 length>-<FNV-1a64 lowercase 16-hex>` over canonical JSON
of the explicitly tagged Human or ScriptedEnemy accepted-command envelope. A
human preimage contains every field in `BattleCommandProposalV1`, including
operation ID, selected move/party/target, menu instance, and control ID. An
enemy preimage contains every field in `ScriptedEnemyBattleCommandV1`, including
the immutable script cursor and typed command, and has no invented seat/menu.
Object keys sort; arrays keep order; safe integers emit canonical decimal. Same
identity+fingerprint is idempotent; same identity with a different fingerprint
is a protocol violation.
The authority's own proposal enters the same ledger and reducer as a remote
proposal; only delivery is internal instead of a proposal lease.

`BattleReplacementProposalV1` uses the exact REPLACEMENT operation grammar.
Its `occurrence` is the globally unique queue identity used to resolve the
stored `FaintOccurrence`; its `turn_occurrence` is the source-local sequence
used exclusively for the operation ID's `o` component. Admission requires the
stored occurrence's source epoch, wave, resolved turn, and `turn_occurrence`,
plus its owner and field slot, to equal the proposal and parsed operation
address exactly. The two occurrence identities are never interchangeable. An
external proposal may contain only `ReplacementSelection::Selected`;
`NoLegalReplacement` is an internal deterministic decision and never a human
or network-supplied default. Its fingerprint is
`brp1-<canonical UTF-16 length>-<FNV-1a64 lowercase 16-hex>` over every field
above. Local and remote replacement selections use the same admission ledger;
same identity+fingerprint is idempotent and a conflicting fingerprint fails
closed.

The deterministic M3 enemy policy is a serializable script of already-typed
commands with a cursor. It uses ordinary legality/admission and does not expose
an AI callback or semantic campaign method.

## Menu graph and logical controls

```rust
pub enum BattleControl {
    CommandRoot(CommandRootControl),
    MoveSelect(MoveSelectControl),
    TargetSelect(TargetSelectControl),
    PartySelect(PartySelectControl),
    PartyOptionSelect(PartyOptionSelectControl),
    ReplacementSelect(ReplacementSelectControl),
    Waiting(WaitingControl),
    Complete(BattleOutcome),
}

pub struct BattleControlPlan {
    pub schema_version: u32,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub turn: TurnIndex,
    pub seats: Vec<SeatBattleControl>,
    pub menu_allocators: Vec<SeatMenuInstanceAllocator>,
}

pub struct SeatBattleControl {
    pub seat: SeatId,
    pub decision_operation_id: Option<OperationId>,
    pub control: BattleControl,
}

pub struct SeatMenuInstanceAllocator {
    pub seat: SeatId,
    pub next_menu_instance_id: MenuInstanceId,
}

pub struct CommandRootControl {
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub menu: BattleMenu,
}

pub struct MoveSelectControl {
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub menu: BattleMenu,
    pub cancel_to: Box<BattleControl>,
}

pub struct TargetSelectControl {
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub move_slot: MoveSlotIndex,
    pub multiple: bool,
    pub candidate_targets: Vec<FieldSlot>,
    pub menu: BattleMenu,
    pub cancel_to: Box<BattleControl>,
}

pub struct PartySelectControl {
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub menu: BattleMenu,
    pub last_left_option_id: MenuOptionId,
    pub last_right_option_id: MenuOptionId,
    pub cancel_to: Box<BattleControl>,
}

pub struct PartyOptionSelectControl {
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub selected_party_slot: PartyIndex,
    pub menu: BattleMenu,
    pub cancel_to: Box<BattleControl>,
}

pub struct ReplacementSelectControl {
    pub occurrence: FaintOccurrenceId,
    pub source: FaintSource,
    pub actor: PokemonId,
    pub field_slot: FieldSlot,
    pub owner_seat: SeatId,
    pub menu: BattleMenu,
    pub last_left_option_id: MenuOptionId,
    pub last_right_option_id: MenuOptionId,
}

pub struct WaitingControl {
    pub reason: WaitingReason,
    pub operation_ids: Vec<OperationId>,
}

pub enum WaitingReason {
    PartnerCommand,
    AuthorityEntry,
    ReplacementOwner,
    RecoveryFence,
}

pub struct BattleMenu {
    pub instance_id: MenuInstanceId,
    pub owner_seat: SeatId,
    pub control_id: String,
    pub selected_option_id: MenuOptionId,
    pub options: Vec<BattleMenuOption>,
    pub navigation: Vec<MenuNavigationEdge>,
}

pub struct BattleMenuOption {
    pub option_id: MenuOptionId,
    pub label_key: String,
    pub visibility: MenuOptionVisibility,
    pub enabled: bool,
    pub layout: MenuOptionLayout,
}

pub enum MenuOptionVisibility {
    Visible,
    Hidden,
}

pub struct MenuOptionLayout {
    pub option_id: MenuOptionId,
    pub row: u16,
    pub column: u16,
    pub page: u16,
}

pub struct MenuNavigationEdge {
    pub from: MenuOptionId,
    pub direction: NavigationDirection,
    pub to: MenuOptionId,
}
```

`BattleControlPlan.seats` contains exactly one unique entry for each human seat
in canonical seat order. `decision_operation_id` is `Some` with the exact
per-seat command or REPLACEMENT window identity for an actionable picker and
is `None` for `Waiting` or `Complete`; there is no ambiguous plan-wide
operation ID. Validation reconstructs and byte-compares that identity from the
typed plan/control coordinates; checking only a non-empty prefix or a matching
`/control/...` suffix is insufficient. A local endpoint projects only its own
seat entry. At each
material-install boundary both endpoints install and digest the same complete
plan; endpoint-local navigation between boundaries may make their kernel
digests differ without changing the mechanical digest.

Replacement control copies the stored faint source and actor. Its `source.wave`
and `source.resolved_turn` equal the plan coordinates, and its exact operation
ID is reconstructed from `source.epoch`, plan `battle_id`,
`source.turn_occurrence`, player field position, and owner seat. The one
projector and state validator bind `occurrence`, `source`, `actor`, field slot,
and owner to the stored `FaintOccurrence`; no value is regenerated by scanning
the party. The global occurrence remains diagnostic/queue identity and is never
substituted for the per-turn `/o` component.

`menu_allocators` also has exactly one canonical-seat-order entry per human
seat. At `new_battle`, every seat allocator starts at one and the same
`er-game` projector independently produces byte-identical initial plans on both
endpoints; pair construction rejects a mismatch. Later menu IDs are
authority-issued in every TURN/REPLACEMENT material plan. Local navigation
consumes only the local seat's monotonic allocator. A submitted command or
replacement proposal carries its final menu ID; admission advances the
authority's corresponding per-seat
high-water mark to exactly checked `id + 1` when greater. The next published
plan allocates beyond that mark, and every receiver installs its stated
high-water marks. Overflow, regression, duplicate seat entries, or a plan menu
ID not below its seat's next value fails closed. Thus the same material plan
has identical IDs while stale-key fences remain endpoint-local and collision
free.

`MenuInstanceId` uniqueness is seat-scoped. Every lookup, held-input binding,
timer owner, stale fence, snapshot key, and comparison uses
`(owner_seat, menu_instance_id)`; an ID from one seat can never unlock or stale
another seat's menu.

Recursive `cancel_to` controls are bounded to depth three, must reference the
same battle/wave/turn/seat/actor frontier and decision operation, and preserve
the exact immutable menu to restore while a fresh `MenuInstanceId` is
allocated at restoration. `ReplacementSelectControl.actor` makes the
replacement-parent actor comparison explicit rather than deferring it to an
untyped field-slot lookup.

Exact identity, navigation, edge sorting, cancel history, hidden/disabled
behavior, and held-key binding are in `m3-ui-navigation.md`; extracted oracle
edges are in `m3-command-ui-oracle.md`. The root exposes only supported Fight
and Switch. The party flow includes the explicit SEND_OUT/Cancel option
submenu. Baton Pass, Shift, item options, Ball, Run, Tera, Reset, capture, and
flee are absent, not disabled fallbacks. The renderer receives immutable
labels/layout/selection but never uses layout to derive a missing input edge.

The UI reducer owns only graph traversal and accepted Action/Cancel conversion.
`er-game` owns menu construction/history and semantic option lookup.
`er-battle` owns no menu type or behavior. `UiIntent` is a private internal
event and can never be supplied as `KernelInput` or by a campaign.

Every logical menu replacement, including Cancel restoration, allocates a new
`MenuInstanceId`. Physical held locks/repeat timers remain bound to the
instance receiving keydown. A stale old-instance press/repeat cannot traverse
or submit the new menu.

## Dynamic action and transition evidence

The oracle does not define one flattened ordering tuple. M3 preserves staged
command construction, phase insertion, dynamic queue reorder/pop, move
post-speed reorder/pop, actor eligibility, and causal faint insertion.

```rust
pub enum ResolvedActionKind {
    Switch,
    Move,
    ResidualStatus,
    Faint,
    Replacement,
}

pub struct ResolvedAction {
    pub sequence: SafeU53,
    pub kind: ResolvedActionKind,
    pub actor: PokemonId,
    pub source_slot: FieldSlot,
    pub command_operation_id: Option<OperationId>,
    pub effective_speed: u32,
    pub timing_modifier: i8,
    pub move_priority: i8,
    pub bracket_modifier: i8,
    pub tie_order: SafeU53,
    pub disposition: ActionDisposition,
}

pub enum ActionDisposition {
    Executed,
    SkippedActorInactive,
    SkippedTargetInactive,
    CancelledByParalysis,
    Missed,
    NoEffect,
}
```

An entry is appended when the dynamic action is popped/evaluated, with live
effective speed and eligibility. Stable equal-key order preserves the seeded
Fisher-Yates group order; no actor/field ID fallback is invented. Exact
ordering and unsupported branches are frozen in `m3-action-order-oracle.md`.

For the M3 selected slice, Pursuit/interception, self-switching moves, Trick
Room, explicit `setOrder`, Baton/Shift, trainer-slot auto-switch policy, and
every other special ordering branch are capability-rejected. Ordinary
Fight/Switch construction, live speed/stage/paralysis recomputation, selected
move priority, seeded speed ties, residual insertion, and stored faint-chain
order are supported. `tie_order` is the zero-based seeded group position before
stable equal-key sorting; it is never an actor/slot fallback.

The oracle catalog contains named same-side and mixed-side simultaneous-faint
cases. M3B faint/replacement implementation is gated on their published causal
fixtures. The Rust resolver preserves the exported faint insertion order and
the Authority-stated replacement tail; it does not invent a global mixed-side
replacement comparator.

```rust
pub enum BattleMutation {
    PpChanged { pokemon: PokemonId, move_slot: MoveSlotIndex, before: u16, after: u16 },
    HpChanged { pokemon: PokemonId, before: u32, after: u32 },
    StatusChanged { pokemon: PokemonId, before: StatusState, after: StatusState },
    StatStageChanged { pokemon: PokemonId, stat: BattleStat, before: i8, after: i8 },
    FieldChanged { slot: FieldSlot, before: Option<PokemonId>, after: Option<PokemonId> },
    CommandCollectionChanged { before: CommandCollectionState, after: CommandCollectionState },
    FaintQueued { occurrence: FaintOccurrence },
    FaintProgressChanged { occurrence: FaintOccurrenceId, before: ReplacementProgress, after: ReplacementProgress },
    FaintResolved { occurrence: FaintOccurrenceId },
    BattleRngChanged { before: BattleRngState, after: BattleRngState },
    TurnAdvanced { before: TurnIndex, after: TurnIndex },
    OutcomeChanged { before: BattleOutcome, after: BattleOutcome },
}
```

Mutation order is mechanical evidence, not a replacement for canonical state.
Every mutation must replay to the same after-state; a canonical leaf change
without matching evidence is a resolver invariant failure.

## Presentation DTO

```rust
pub struct BattlePresentationEvent {
    pub event_id: BattlePresentationEventId,
    pub policy: PresentationBlockingPolicy,
    pub skip_policy: PresentationSkipPolicy,
    pub kind: BattlePresentationKind,
}

pub enum BattlePresentationKind {
    MoveUsed { actor: PokemonId, move_id: MoveId, targets: Vec<FieldSlot> },
    AbilityActivated { pokemon: PokemonId, ability_id: AbilityId },
    HpChanged { pokemon: PokemonId, before: u32, after: u32 },
    StatusApplied { pokemon: PokemonId, before: StatusState, after: StatusState },
    StatStageChanged { pokemon: PokemonId, stat: BattleStat, before: i8, after: i8 },
    Switched { slot: FieldSlot, outgoing: Option<PokemonId>, incoming: PokemonId },
    Fainted { pokemon: PokemonId, occurrence: FaintOccurrenceId },
    BattleWon,
    BattleLost,
}
```

Events contain stable typed values only and cannot mutate mechanics. Their
order and policy form `PresentationPlanDigest`. Logical control installation,
receipt retirement, actionability, settlement, skip, failure, snapshot, and
teardown rules are frozen in `m3-presentation-control.md`.

Event IDs are allocator-free: `operation_id` is the TURN or REPLACEMENT
material operation that caused the plan, and `sequence` is the zero-based
position in that exact ordered plan. IDs must equal their material/array
position, so host and guest derive identical settlement identities without a
presentation allocator or any presentation identity inside the mechanical
digest. Converting the zero-based array position to `SafeU53` is checked;
overflow rejects the staged resolver result before material encoding or any
effect publication.

## Battle resolver and common material applier

```rust
pub enum BattleAfterStateFailure {
    State(StateValidationError),
    MutationEvidenceMismatch { index: usize },
    PresentationSequenceOverflow { index: usize },
}

pub enum BattleInvariantError {
    InvalidBeforeState { source: StateValidationError },
    UnsupportedEffectReached { subject: CapabilitySubject },
    InvalidAfterState { source: BattleAfterStateFailure },
}

pub enum BattleResolveError {
    Invariant(BattleInvariantError),
    Legality(CommandLegalityError),
    Content(ContentPackError),
    Rng(RngError),
    Digest(MechanicalDigestError),
    Canonical(CanonicalError),
}

pub fn resolve_turn(
    before: &GameState,
    commands: &CommandSet,
    authority_epoch: AuthorityEpoch,
    material_operation_id: &OperationId,
    content: &ContentPack,
) -> Result<BattleTransition, BattleResolveError>;

pub struct BattleTransition {
    pub before_state: GameState,
    pub after_state: GameState,
    pub before_digest: MechanicalStateDigest,
    pub after_digest: MechanicalStateDigest,
    pub accepted_commands: CommandSet,
    pub action_order: Vec<ResolvedAction>,
    pub mutations: Vec<BattleMutation>,
    pub presentation: Vec<BattlePresentationEvent>,
    pub rng_audit: Vec<RngDraw>,
    pub outcome: BattleOutcome,
    pub next_decision: BattleNextDecision,
}

pub enum BattleNextDecision {
    CommandFrontier,
    Replacement { occurrence: FaintOccurrenceId },
    Complete(BattleOutcome),
}

pub fn resolve_replacement(
    before: &GameState,
    occurrence: FaintOccurrenceId,
    selection: &ReplacementSelection,
    material_operation_id: &OperationId,
    content: &ContentPack,
) -> Result<BattleReplacementTransition, BattleResolveError>;

pub struct BattleReplacementTransition {
    pub before_state: GameState,
    pub after_state: GameState,
    pub before_digest: MechanicalStateDigest,
    pub after_digest: MechanicalStateDigest,
    pub occurrence: FaintOccurrence,
    pub selection: ReplacementSelection,
    pub mutations: Vec<BattleMutation>,
    pub presentation: Vec<BattlePresentationEvent>,
    pub outcome: BattleOutcome,
    pub next_decision: BattleNextDecision,
}
```

`resolve_turn` is pure over its arguments. `authority_epoch` is the exact
authenticated Authority V2 epoch of the command frontier being resolved; every
new `FaintSource` created by the turn stores that value without defaulting,
parsing, or local allocation. It requires `before.battle` and may
mutate only the cloned canonical game/battle values required by the transition,
including battle RNG. It validates both complete `GameState` values, computes
mechanical digests over those values, preserves the exact JavaScript/RNG
contracts, validates that `material_operation_id` is the exact deterministic
TURN-result grammar for the before-state, and returns no partial result.
`resolve_replacement` follows the same pure clone/validate rule, validates the
exact deterministic REPLACEMENT grammar from the stored occurrence, and
consumes no RNG. The operation argument exists solely to assign allocator-free
presentation IDs; neither function reads protocol runtime state. Neither
function owns a menu, UI, timer, or environment state. `er-game` maps the typed
`BattleNextDecision` to the exact `BattleControlPlan` carried by material.

The integration-only doc-hidden `er-battle` TURN seam accepts a typed `FnOnce`
finalizer for the cloned after-state and mutation evidence. `GameRuntime` uses
it to insert the exact next command frontier before the resolver's one final
state/content validation, after-state digest, and mutation-evidence replay.
The seam returns only the fully proved `BattleTransition`; it does not expose
an unvalidated transition or a mutable digest proof. Public `resolve_turn` and
`resolve_turn_trusted` continue to use a no-op finalizer and retain the public
signatures and behavior described above.

Before-state validation, including the state error returned by command
legality, maps to `InvalidBeforeState`. A reachable capability classified as
unsupported maps to `UnsupportedEffectReached`. Candidate-state validation,
mutation-evidence disagreement, and presentation sequence overflow map to the
corresponding nested `InvalidAfterState` reason. All other command-legality
errors remain `Legality`; content, RNG, digest, and canonical failures retain
their typed source. `NoLegalReplacement` is a valid next decision, not an
error.

```rust
pub struct BattleTurnMaterialV1 {
    pub schema_version: u32,
    pub oracle_game_sha: String,
    pub content_hash: ContentPackHash,
    pub operation_id: OperationId,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub resolved_turn: TurnIndex,
    pub before_digest: MechanicalStateDigest,
    pub after_digest: MechanicalStateDigest,
    pub commands: CommandSet,
    pub action_order: Vec<ResolvedAction>,
    pub mutations: Vec<BattleMutation>,
    pub presentation: Vec<BattlePresentationEvent>,
    pub presentation_digest: PresentationPlanDigest,
    pub rng_before: BattleRngState,
    pub rng_after: BattleRngState,
    pub rng_audit: Vec<RngDraw>,
    pub before_state: GameState,
    pub after_state: GameState,
    pub outcome: BattleOutcome,
    pub next_decision: BattleNextDecision,
    pub menu_allocators_before: Vec<SeatMenuInstanceAllocator>,
    pub next_control: BattleControlPlan,
}

pub struct BattleReplacementMaterialV1 {
    pub schema_version: u32,
    pub oracle_game_sha: String,
    pub content_hash: ContentPackHash,
    pub operation_id: OperationId,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub resolved_turn: TurnIndex,
    pub occurrence: FaintOccurrence,
    pub selection: ReplacementSelection,
    pub before_digest: MechanicalStateDigest,
    pub after_digest: MechanicalStateDigest,
    pub mutations: Vec<BattleMutation>,
    pub presentation: Vec<BattlePresentationEvent>,
    pub presentation_digest: PresentationPlanDigest,
    pub before_state: GameState,
    pub after_state: GameState,
    pub outcome: BattleOutcome,
    pub next_decision: BattleNextDecision,
    pub menu_allocators_before: Vec<SeatMenuInstanceAllocator>,
    pub next_control: BattleControlPlan,
}

pub enum ReplacementSelection {
    Selected {
        party_slot: PartyIndex,
        pokemon: PokemonId,
    },
    NoLegalReplacement,
}
```

The typed payload is serialized to canonical JSON only when inserted into the
existing Authority `Material.payload: serde_json::Value`. No other M3 DTO uses
`Value`. TURN uses the pinned turn-adapter digest: FNV-1a64 over its sorted-key,
ordered-array canonical payload, returned as 16 lowercase hex. REPLACEMENT
uses the pinned replacement-adapter digest
`rc1-<canonical UTF-16 length>-<FNV-1a32 8-hex>`. Neither substitutes BLAKE3.

`BattleTurnMaterialV1`, `BattleReplacementMaterialV1`, their canonical codecs,
and the two public appliers live in `er-game`. `er-kernel` invokes them after
`er-protocol` admits the opaque Authority envelope. `er-protocol` never imports
`er-game`, `er-state`, or `er-battle`; this is the frozen dependency boundary.
CR-0021 aligns the generic opaque TURN successor address with that boundary:
legacy material may supply top-level `turn`, while frozen M3 material supplies
top-level `resolved_turn`. Exactly one spelling must be present. Both or
neither fail closed, and the selected safe-integer coordinate must still equal
the predecessor control's exact turn. This does not rename or broaden the M3
material schema; its full validator continues to require only
`resolved_turn`.

`NoLegalReplacement` is valid only when the exact owner has no living,
off-field, same-owner party member. It preserves the empty slot and advances
the stored replacement chain to its next control or explicit defeat. It is not
an omitted selection, timeout, default, or local party-scan fallback.

```rust
pub struct BattleMaterialApplyContext {
    pub current_state: GameState,
    pub local_seat: SeatId,
    pub menu_allocators: Vec<SeatMenuInstanceAllocator>,
}

pub enum BattleMaterialApplyError {
    MalformedIdentity,
    SchemaVersionMismatch,
    OracleIdentityMismatch,
    ContentHashMismatch,
    InvalidMaterialBeforeDigest,
    LocalBeforeStateMismatch,
    InvalidEvidence,
    InvalidAfterState,
    InvalidControlProjection,
    MenuAllocatorMismatch,
    Invariant,
}

pub fn apply_turn_material(
    current: &BattleMaterialApplyContext,
    material: &BattleTurnMaterialV1,
    content: &ContentPack,
) -> Result<MaterialApplyResult, BattleMaterialApplyError>;

pub fn apply_replacement_material(
    current: &BattleMaterialApplyContext,
    material: &BattleReplacementMaterialV1,
    content: &ContentPack,
) -> Result<MaterialApplyResult, BattleMaterialApplyError>;

pub struct MaterialApplyResult {
    pub after_state: GameState,
    pub after_digest: MechanicalStateDigest,
    pub presentation: Vec<BattlePresentationEvent>,
    pub presentation_digest: PresentationPlanDigest,
    pub outcome: BattleOutcome,
    pub next_decision: BattleNextDecision,
    pub next_control: BattleControlPlan,
    pub menu_allocators: Vec<SeatMenuInstanceAllocator>,
}
```

Both functions are pure and role-neutral. Before inspecting endpoint-local
state, they recompute the digest of `material.before_state` and require it to
equal `material.before_digest`; failure is
`InvalidMaterialBeforeDigest`, never a recoverable local-frontier mismatch.
They then validate identity, schema/content, local before-state compatibility,
every evidence/state consistency rule, and the recomputed after digest. The
authority serializes, deserializes, and applies through these exact functions;
the replica deserializes and applies the same bytes/functions. Mandatory test
equality is resolver candidate == authority material-applied == replica
material-applied. The guest never calls `resolve_turn` for an authority entry.
The authority maps every `BattleMaterialApplyError` to
`AtomicTransitionError::MaterialApply` and discards its unpublished staged
transaction. Replica mapping is exact:

- `LocalBeforeStateMismatch` becomes recoverable
  `ReplicaApplyError::BeforeDigestMismatch`;
- `ContentHashMismatch` becomes `ProtocolViolation::ContentHashMismatch` and
  shared terminal `M3_CONTENT_HASH_MISMATCH`;
- `MalformedIdentity`, `SchemaVersionMismatch`, and `OracleIdentityMismatch`
  become `ProtocolViolation::MalformedBattleMaterial` and shared terminal
  `M3_MALFORMED_BATTLE_MATERIAL`;
- `InvalidMaterialBeforeDigest`, `InvalidEvidence`, `InvalidAfterState`,
  `InvalidControlProjection`, `MenuAllocatorMismatch`, and `Invariant` become
  invalid authenticated authority material and shared terminal
  `M3_INVALID_AUTHORITY_MATERIAL`.

No caller may map an error to a fallback or broader recovery class.

TURN material's `before_state` is the authority's complete command-frontier
state used by the resolver. A receiver may currently hold a compatible partial
frontier because partner proposals are authority-bound, not peer-broadcast.
Before checking `before_digest`, the common applier requires every canonical
field other than `command_state` to equal `before_state`, requires current
offers/window identities to equal it, and requires every locally
retained/admitted command to be a matching subset. It then installs the exact
material command frontier on the staged clone, revalidates every command and
offer against content/state, and recomputes `before_digest`. A conflicting
local command, changed offer, or any non-command mismatch fails closed. The
authority path is the same reconciliation with an already-complete frontier.
REPLACEMENT requires exact full `before_state` equality because replacement
proposal admission lives in the game/protocol ledger rather than canonical
mechanical state.

`menu_allocators_before` is the authority's canonical per-seat high-water
vector after command/replacement admission and before next-control allocation.
The applier first validates material-internal allocator evidence without using
endpoint state: exact canonical seat inventory, no duplicate/regressing/zero
high-water mark, every material menu ID below its owning seat's stated next
value, and an exact deterministic projection from `menu_allocators_before` to
`next_control.menu_allocators`. Any failure here is
`MenuAllocatorMismatch` and invalid authority material.

Only after that self-validation does an endpoint compare its current
allocators. Its local seat's current value must equal the material-before value;
each non-local value may lag but must not exceed it. Any endpoint-current
disagreement with otherwise valid material is `LocalBeforeStateMismatch` and
uses correlated recovery; it is never `MenuAllocatorMismatch`. Projection then
starts from the valid material vector, consumes exactly the menu IDs present
in `next_control`, and produces its exact stated allocator high-water vector.
The applier returns those values for atomic installation.
This permits endpoint-local menu history between material boundaries without a
second control builder or ID collision.

The applier also validates that `next_decision` is derivable from the stored
outcome/faint queue and that the complete `next_control` is the exact `er-game`
projection for that decision. A menu graph is therefore material evidence but
never battle-resolver behavior.

## Digest domains

```rust
pub struct MechanicalStateDigest(String);
pub struct KernelDeterminismDigest(String);
pub struct PresentationPlanDigest(String);
```

Each is `blake3-v1:<64 lowercase hex>` over canonical bytes with a distinct
domain/version prefix included in the preimage:

- `pokerogue-redux/m3/mechanical/v1` includes the complete canonical
  `GameState`: battle/RNG state, admitted command collection, battle/faint
  allocators, and outcome. Because the user-supplied M3 digest contract
  explicitly includes command collection, immutable admitted proposal
  identity/fingerprint fields inside that collection are included even when
  they record menu/control provenance. It excludes the mutable logical
  control/menu graph/history itself, pending presentation/actionability state,
  protocol transport/lease state, timers, network, and renderer state. Those
  deterministic owners belong to the kernel digest.
- `pokerogue-redux/m3/kernel-determinism/v1` includes the complete deterministic
  endpoint snapshot: mechanical state, protocol, input router, UI/menu/history,
  scheduler, presentation barriers/tombstones, terminal/disposed state, and all
  allocators. It excludes append-only diagnostics.
- `pokerogue-redux/m3/presentation-plan/v1` includes ordered typed presentation
  events and both blocking/skip policies; it excludes renderer geometry,
  localized text, and settlement timing.

The Authority material digest is a fourth compatibility value and is never
interchanged with these three.

Pair-trace clock and live-resource projections identify a timer by
`(endpoint, timer_id)`. Numeric timer IDs are scheduler-local, so independent
host and guest schedulers may retain the same numeric value concurrently.

## Typed Battle-mode external boundary

M3 extends the existing integration-owned enums without changing M2 variants:

```rust
pub struct BattleUiProjection {
    pub schema_version: u32,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub turn: TurnIndex,
    pub seat_control: SeatBattleControl,
    pub actionable: bool,
}

// New KernelInput variant.
BattlePresentationOutcome {
    endpoint: SeatId,
    event_id: BattlePresentationEventId,
    outcome: PresentationSettlementOutcome,
}

// New KernelEffect variants.
BattleUiChanged {
    endpoint: SeatId,
    projection: BattleUiProjection,
}
PresentBattle {
    endpoint: SeatId,
    event: BattlePresentationEvent,
}

// New PairOperation variant.
BattlePresentationOutcome {
    endpoint: PairEndpoint,
    event_id: BattlePresentationEventId,
    outcome: PresentationSettlementOutcome,
}
```

These typed variants are the only Battle-mode renderer/presenter boundary.
Battle mode never coerces a `BattlePresentationEvent` into the legacy
`PresentationEvent.payload: serde_json::Value`, and a presenter outcome must
carry the exact composite battle event ID. Existing raw-input, network, timer,
transport, storage, suspend, and resume variants remain the other closed
external inputs.

CR-0023 freezes terminal presenter disposal: pending Battle events and every
legacy presenter value are released, while settled typed Battle outcomes and
their exact tombstones remain as inert diagnostic evidence. They own no live
resource and cannot emit another completion. A restorable pair requires those
presenter outcomes to equal each endpoint kernel's retained settled outcomes
exactly, including after shared-terminal disposal and reconstruction.

## Game runtime and kernel composition

`GameRuntime` owns canonical `GameState`, current logical `BattleControlPlan`,
menu history, admitted commands, operation fingerprints, deterministic enemy
script cursor, faint/replacement progress, and all game-owned allocators. It
turns private `UiIntent` values into proposals/commands and invokes the resolver
only when the exact command frontier is complete.

Battle configuration is explicit:

```rust
pub struct BattleGameConfig {
    pub run_state: GameState,
    pub wave_seed: String,
    pub start: BattleStartV1,
    pub local_seat: SeatId,
    pub scripted_enemy_policy: ScriptedEnemyPolicyV1,
}

pub struct BattleStartV1 {
    pub schema_version: u32,
    pub format: BattleFormat,
    pub player_party: Vec<PokemonState>,
    pub enemy_party: Vec<PokemonState>,
    pub player_leads: Vec<PartyIndex>,
    pub enemy_leads: Vec<PartyIndex>,
}

pub struct BattleProtocolConfig {
    pub role: BattleProtocolRoleConfig,
}

pub enum BattleProtocolRoleConfig {
    Authority {
        log: AuthorityLogConfig,
        proposal_capacity: SafeU53,
    },
    Replica {
        replica: AuthorityReplicaConfig,
        proposal_leases: ProposalLeaseConfig,
        recovery: RecoveryTransactionConfig,
    },
}

pub fn GameKernel::new_battle(
    config: BattleGameConfig,
    protocol: BattleProtocolConfig,
    content: Arc<ContentPack>,
) -> Result<GameKernel, BattleInitializationError>;
```

`GameKernel::step` accepts one existing external `KernelInput`, clones every
deterministic subsystem, processes the private FIFO to quiescence, validates,
then swaps and emits effects. The exact queue/budget is
`m3-internal-event-loop.md`; publication/application/control/timer atomicity is
`m3-atomic-transition.md`; typed outcomes are `m3-error-policy.md`.

CR-0020 freezes one doc-hidden cross-crate optimization boundary. `BattleMode`
stores the already-validated game owner as `Arc<GameRuntime>` and the first
semantic mutation in an external input uses `Arc::make_mut`. The seven staged
method names are exactly:

```text
sync_battle_ui_selection_in_kernel_transaction
reduce_ui_in_kernel_transaction
retain_replica_command_in_kernel_transaction
retain_replica_replacement_in_kernel_transaction
reduce_game_in_kernel_transaction
install_material_in_kernel_transaction
take_pending_no_legal_replacement_in_kernel_transaction
```

They are callable only on the private candidate owned by `BattleTransaction`.
They do not clone, validate, publish, or recover independently; an error causes
the whole candidate to be discarded. The enclosing kernel drains the typed
FIFO and performs one complete game validation before swap. The original
public atomic reducers retain clone/validate/swap behavior for every caller
outside that enclosing transaction. The process-local `Arc` and dirty flag are
not serialized and cannot change snapshot, trace, digest, material, or wire
identity.

CR-0022 freezes a second doc-hidden integration optimization. The production
kernel may use the following exact trusted-content function names only with
the immutable `ContentPack` retained by a `GameRuntime` that validated it at
construction or snapshot restore:

```text
build_command_offer_trusted
build_scripted_enemy_offer_trusted
validate_preserved_offer_trusted
validate_command_proposal_trusted
normalize_command_set_trusted
validate_replacement_selection_trusted
validate_replacement_proposal_trusted
resolve_turn_trusted
resolve_replacement_trusted
admit_command_proposal_with_context_trusted
admit_scripted_enemy_frontier_trusted
project_scripted_policy_for_material_trusted
complete_command_frontier_trusted
apply_turn_material_trusted
apply_reducer_issued_turn_material_trusted
apply_replacement_material_trusted
```

Trusted-content status by itself skips only repeated `ContentPack::validate()`
and canonical content-hash recomputation; the separately sealed reducer-issued
TURN capability below may also reuse its exact retained digest evidence.
Complete state/content membership, capability,
command, evidence, material-digest, control-projection, allocator, endpoint,
and final transactional validation remain mandatory. Public counterparts
still perform full content validation. The staged common-applier installation
may reuse the exact after digest and projected control already proved by that
applier in the same private kernel transaction; independently callable
installation recomputes them. Mechanical-state digest computation validates
the state and encodes its frozen domain-separated canonical preimage once;
discarding a second standalone state encoding cannot change digest bytes.
The validated core shared by `resolve_turn` and `resolve_turn_trusted` may use
crate-private action-queue, move-pipeline, and target-effect helpers after the
selected public or trusted entry point has completed its state/content guard;
these helpers are not callable cross-crate and add no trusted function name.

The game reducer creates an opaque, non-serialized `TurnDigestEvidence` only
after resolver output and final command-frontier projection have fixed the
transition's before/after digests. `GameRuntime::prepare_authority_turn` keeps
that wrapper attached to a sealed `PreparedAuthorityTurn`; other crates receive
immutable transition/control/admission access but no constructor, mutable
field, raw transition handoff, or skip flag. The authority-only
`apply_reducer_issued_turn_material_trusted` entry point first requires the
decoded material's exact before state, before digest, after state, and after
digest to equal that retained evidence, then reuses the reducer-owned digest
work. All identity, content, mutation, command, RNG, presentation, frontier,
allocator, endpoint, and control checks remain. Public, local, replica, recovery,
and ordinary trusted material paths independently recompute both material
digests. Exact-state authority reconciliation may return before rebuilding and
hashing an identical frontier, while partial replica frontiers retain the
complete reconciliation path.

Authority preparation retains one canonical material byte vector after typed
decode and canonical-`Value` round-trip proof. The material digest and internal
prepared-entry bytes derive from that vector, which is moved rather than
deep-copied at the private event boundary, without changing the frozen
`Material { digest, payload }` wire shape. Presentation-only Battle
transactions copy the retained authority log by `Arc`; its immutable retained
`AuthorityEntry` payloads are also `Arc` shared, and generation rebind detaches
an entry with `Arc::make_mut` before changing its context. Synchronous authority
publication validation borrows the already-installed game/control/policy
instead of cloning them. The enclosing clone/validate/swap remains the rollback
owner, while all public log actions, recovery slices, and snapshots continue to
carry owned entries. The public cross-crate `PreparedAuthorityEntry` DTO has one
crate-private production authority-preparation construction seam. Its
`material_bytes` field is construction-correlated diagnostic evidence; it is not
a second canonicalization or publication payload. The prepared AuthorityLog
`Material { digest, payload }` remains the publication input.

The canonical-`Value` proof operates directly on the already-parsed `Value` and
compares its frozen canonical string bytes with the original typed canonical
bytes. It does not serialize through ordinary JSON ordering, remove the typed
decode/equality check, or allocate a second deep `Value` clone.

`new_battle` requires `run_state.battle = None`, a positive one-based run wave,
an exact non-empty production `BattleScene.waveSeed`, and a valid unconsumed
`next_battle_id`. The wave seed is supplied explicitly because CR-0017 proves
that it cannot be reconstructed from the persisted run RNG or battle seed; no
adapter may derive, substitute, or default it. `new_battle` assigns the battle
ID itself, checked-
increments the run allocator, derives battle RNG from the run RNG/wave through
the frozen `er-rng` constructor, creates public turn one, and builds neutral
weather/terrain/conditions, empty command/faint state, and `Ongoing` outcome.
Lead vectors have exactly the format capacity, contain unique in-range living
party slots, and create the initial field. Singles ownership is seat one;
co-op positions zero/one are seats one/two; authority is seat one. A caller
cannot supply battle ID, turn, outcome, command state, faint allocator, or
arena state. Mid-battle construction uses only `from_snapshot`.

In Battle mode:

- `ControlMenuPlan`, `MenuProposalPlan`, and `AuthorityResolutionPlan` are not
  configuration fields or runtime state;
- external `MaterialApplied` and `ControlProjected` compatibility inputs are
  rejected;
- `ApplyAuthorityMaterial`, `ProjectAuthorityControl`, and causal `UiIntent`
  effects are never emitted;
- material application, logical control installation, and receipt staging are
  completed inside the staged Rust transaction.

M2 fixture causality moves to `er-testkit::ProtocolFixtureHarness` behind a
testkit-only compatibility feature. Production Battle construction cannot
enable or reference it. Shared crate roots and `GameKernel::step` remain solely
integration-owned.

## Restorable snapshots and traces

The public constructors are:

```rust
pub fn GameKernel::from_snapshot(
    snapshot: RestorableKernelSnapshotV2,
    content: Arc<ContentPack>,
) -> Result<GameKernel, SnapshotError>;

pub fn SimulatedPair::from_snapshot(
    snapshot: RestorablePairSnapshotV2,
    content: Arc<ContentPack>,
) -> Result<SimulatedPair, SnapshotError>;
```

Snapshot DTOs, quiescent boundary, complete owner inventory, fail-atomic
validation, and continuation matrix are frozen in `m3-snapshot-trace.md`.
The endpoint snapshot itself carries the original local seat and complete
`BattleProtocolConfig`; neither constructor accepts or derives those values
from ambient defaults.
KernelTrace V2 records every external event, ordered effects, all three
digests, RNG/internal-event audits, live resources, seed, and virtual time.

## Representative campaign surface

The public `SimulatedPair`/driver surface is closed to:

```text
key_down, key_up, press, hold_for, blur, focus
advance virtual time
deliver, drop, duplicate, delay, reorder, corrupt packet
disconnect, reconnect, suspend, resume
presentation settlement/failure/authorized skip
storage outcome
read-only snapshots, traces, digests, UI view, and live-resource evidence
teardown
```

There is no `select_move`, `select_target`, `submit_command`,
`select_party_slot`, `choose_replacement`, `resolve_turn`, cursor setter,
mutable kernel/game/battle/protocol handle, or semantic-input injection.
A helper may inspect the immutable menu graph and calculate arrow presses, but
it executes and records them through raw physical input.

## Acceptance invariants

The hosted gate must structurally fail if Battle mode contains fixture plans,
accepts external canonical-success acknowledgments, emits canonical-work
effects, exposes semantic campaign operations, uses numeric cursor identity,
loses any restorable owner, takes different host/guest applier paths, or permits
unsupported content to no-op.

Native and wasm32/Node use the same crates and replay the same traces after
every external event. Differential oracle evidence compares initial state/RNG,
commands, each RNG draw, dynamic action order, mutations, presentation, final
state/RNG, and next control, reporting the first divergence. Teardown is
idempotent and leaves zero timers, input locks, protocol leases, retained
entries, packets, presentation barriers/events, storage requests, command
collections, replacement occurrences, or staged transactions.
