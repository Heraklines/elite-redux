//! M6D deterministic property, fuzz-style, and pairwise coverage over valid
//! complete-content states, commands, and faults.
//!
//! Every case is generated from a fixed corpus of 64-bit seeds with a
//! self-contained splitmix64 generator (proptest conventions without a fuzz
//! crate: bounded deterministic cases, failures shrink to the exact failing
//! seed, and every failure prints a replayable seed plus the full operation
//! trace up to the first divergence). All coverage drives production APIs
//! only: the immutable selected content pack, `GameState` construction and
//! validation, the atomic turn/replacement resolvers, the faint queue,
//! canonical snapshot encoding, and the closed bespoke mechanic families
//! (scheduled effects, guards, item lifecycle, ability suppression). No
//! source-text assertions, mocks, or fixture-authored results appear here.

use std::collections::BTreeSet;
use std::error::Error;
use std::fmt::Write as _;
use std::sync::LazyLock;

use er_battle::ability::INTIMIDATE_ABILITY_ID;
use er_battle::faint::{FaintCandidate, queue_faint, queue_faints};
use er_battle::legality::{
    build_command_offer, build_scripted_enemy_offer, validate_replacement_selection,
    validate_state_content,
};
use er_battle::m6::bespoke::guard::{
    AuditedGuardDraw, GuardActivation, GuardUseRequest, apply_guard_use, expire_turn_end,
};
use er_battle::m6::bespoke::item_lifecycle::{
    ConsumeRequest, GrantRequest, consume_item, grant_item,
};
use er_battle::m6::bespoke::scheduled_effects::{
    DelayedEffectRequest, FieldConditionRequest, SlotOccupants, UnavailableScopes,
    drain_due_events, schedule_delayed_effect, set_terrain, set_weather,
};
use er_battle::m6::bespoke::suppression_immunity::{
    AbilitySuppressibility, SlotSuppressionRequest, SuppressionCleanupEvent,
    advance_suppression_turns, apply_slot_suppression, clear_suppressions,
};
use er_battle::outcome::derive_battle_outcome;
use er_battle::resolver::BattleNextDecision;
use er_battle::{resolve_replacement, resolve_turn};
use er_content::moves::find_move;
use er_content::pack::{ContentPack, selected_m4_content_pack};
use er_content::species::find_species;
use er_mechanics::MechanicHookV2;
use er_mechanics::selector_operation_v2::{
    ScheduledEventCancellationPolicyV1, ScheduledEventPayloadV1,
};
use er_rng::battle::BattleRngState;
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::battle::{BattleOutcome, BattleState, CommandCollectionState, ReplacementProgress};
use er_state::bespoke_v2::guard::{GuardFamilyState, GuardKind};
use er_state::bespoke_v2::item_lifecycle::ItemLifecycleStateV2;
use er_state::bespoke_v2::scheduled_effects::{ScheduledEffectsState, TerrainId, WeatherId};
use er_state::bespoke_v2::suppression_immunity::{
    AbilitySlot, SuppressionImmunityStateV2, SuppressionOrigin,
};
use er_state::conditions::{
    GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind, WeatherState,
};
use er_state::digest::MechanicalStateDigest;
use er_state::field::{FieldSlotState, FieldState};
use er_state::format::{BattleFormat, canonical_slots, human_seats, validate_format};
use er_state::pokemon::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonState, StatStages, StatusState,
    validate_move_slot,
};
use er_state::snapshot::{GameState, canonical_game_state_bytes, decode_canonical_game_state};
use er_types::battle_command::{
    AcceptedBattleCommand, BattleCommand, BattleCommandProposalV1, BattleTargetSelection,
    CommandAdmissionSource, CommandFrontierEntry, CommandFrontierStatus, CommandSet,
    ReplacementSelection, ScriptedEnemyBattleCommandV1, player_command_operation_id,
    replacement_operation_id, scripted_enemy_command_operation_id, turn_result_operation_id,
};
use er_types::battle_ids::{
    AbilityId, AuthorityEpoch, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, GameModeId,
    MenuInstanceId, MoveId, MoveSlotIndex, PartyIndex, PokemonId, SpeciesId, TurnIndex, WaveIndex,
};
use er_types::battle_model::StatusKind;
use er_types::mechanics::{MechanicScope, SourceOrdinal};
use er_types::{
    BehaviorSourceId, BehaviorUnitId, BehaviorUnitKind, BehaviorUnitOrdinal, OperationId,
    ProvenanceHash, SafeU53, SeatId,
};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

/// Deterministic corpus: every test iterates exactly these seeds so CI is
/// reproducible and any failure names one replayable seed.
const SEEDS: [u64; 16] = [
    0xA11C_E001_0000_0001,
    0xB0B5_E002_0000_0002,
    0xC0FF_EE03_0000_0003,
    0xD10C_5004_0000_0004,
    0xE660_5005_0000_0005,
    0xFACE_DE06_0000_0006,
    0x5EED_0007_0000_0007,
    0xB105_F00D_0008_0008,
    0xCAFE_BABE_0009_0009,
    0xDEAD_BEEF_000A_000A,
    0x1234_ABCD_000B_000B,
    0x5678_9EF0_000C_000C,
    0x9ABC_DEF1_000D_000D,
    0x0FED_CBA9_000E_000E,
    0x7654_3210_000F_000F,
    0x0189_ABFE_0010_0010,
];

/// One attacking move known to exist in the frozen selected content pack
/// (the identity the M3 parity oracle cases fight with).
const ATTACK_MOVE: u64 = 589;

// ---------------------------------------------------------------------------
// Deterministic generator (splitmix64) — proptest-style strategy driver.
// ---------------------------------------------------------------------------

struct CaseRng(u64);

impl CaseRng {
    fn new(seed: u64) -> Self {
        Self(seed ^ 0x9E37_79B9_7F4A_7C15)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform value in `0..bound`; `bound` must be positive.
    fn below(&mut self, bound: u64) -> u64 {
        self.next_u64() % bound
    }

    fn range(&mut self, low: u64, high_inclusive: u64) -> u64 {
        low + self.below(high_inclusive - low + 1)
    }

    fn flip(&mut self) -> bool {
        self.next_u64() & 1 == 0
    }

    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len() as u64) as usize]
    }
}

// ---------------------------------------------------------------------------
// Shared fixtures and small constructors.
// ---------------------------------------------------------------------------

static CONTENT: LazyLock<ContentPack> =
    LazyLock::new(|| selected_m4_content_pack().expect("frozen selected content pack must load"));

fn content() -> &'static ContentPack {
    &CONTENT
}

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("property value must fit the safe-integer domain")
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn player_slot(position: u8) -> FieldSlot {
    FieldSlot::new(BattleSide::Player, position).expect("valid player field slot")
}

fn enemy_slot(position: u8) -> FieldSlot {
    FieldSlot::new(BattleSide::Enemy, position).expect("valid enemy field slot")
}

fn behavior_unit() -> BehaviorUnitId {
    BehaviorUnitId {
        source: BehaviorSourceId::Move {
            numeric_id: safe(ATTACK_MOVE),
        },
        unit_kind: BehaviorUnitKind::IntrinsicMoveRule,
        ordinal: BehaviorUnitOrdinal::ZERO,
        provenance_hash: ProvenanceHash::parse("0".repeat(64)).expect("fixture provenance hash"),
    }
}

fn pokemon_scope(id: PokemonId) -> MechanicScope {
    MechanicScope::Pokemon { pokemon: id }
}

fn generated_pokemon(
    id: u64,
    owner_seat: Option<SeatId>,
    status_kind: StatusKind,
    speed: u32,
    hp_full: bool,
) -> TestResult<PokemonState> {
    let pack = content();
    let species = find_species(&pack.species, SpeciesId::new(safe(19)))?;
    let max_hp = 100_u32;
    Ok(PokemonState::new(
        PokemonId::new(safe(id)),
        owner_seat,
        species.id,
        0,
        25,
        species.base_types,
        BattleStats {
            hp: max_hp,
            attack: 100,
            defense: 100,
            special_attack: 100,
            special_defense: 100,
            speed,
        },
        if hp_full { max_hp } else { 25 },
        max_hp,
        StatusState {
            kind: status_kind,
            toxic_turn_count: 0,
            sleep_turns_remaining: None,
        },
        StatStages {
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
            accuracy: 0,
            evasion: 0,
        },
        [
            Some(MoveSlotState {
                move_id: MoveId::new(safe(ATTACK_MOVE)),
                pp_used: 0,
                pp_ups: 0,
                max_pp_override: None,
            }),
            None,
            None,
            None,
        ],
        AbilityLoadout {
            active: AbilityId::ZERO,
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        false,
    )?)
}

/// Generate one fully valid singles battle state from a seed. The scripted
/// enemy side carries exactly one battler, matching the oracle campaign shape:
/// an enemy faint therefore always decides the battle, and every forced
/// replacement window belongs to the player side that the public resolver owns.
struct GeneratedBattle {
    state: GameState,
    label: String,
}

fn generated_single_battle(seed: u64, player_party_size: u64) -> TestResult<GeneratedBattle> {
    let mut rng = CaseRng::new(seed);
    let pack = content();
    let format = BattleFormat::single();
    let mut player_party = Vec::new();
    for index in 0..player_party_size {
        let status = *rng.pick(&[StatusKind::None, StatusKind::None, StatusKind::Burn]);
        let speed = rng.range(50, 200) as u32;
        player_party.push(generated_pokemon(
            100 + index,
            Some(seat(1)),
            status,
            speed,
            true,
        )?);
    }
    let enemy_status = *rng.pick(&[StatusKind::None, StatusKind::Poison]);
    let enemy_speed = rng.range(50, 200) as u32;
    let enemy_party = vec![generated_pokemon(
        200,
        None,
        enemy_status,
        enemy_speed,
        true,
    )?];
    let wave = WaveIndex::new(safe(1))?;
    let turn = TurnIndex::new(safe(1))?;
    let field = FieldState::new_for_format(
        &format,
        vec![
            FieldSlotState::new(player_slot(0), Some(player_party[0].id)),
            FieldSlotState::new(enemy_slot(0), Some(enemy_party[0].id)),
        ],
    )?;
    let battle = BattleState {
        battle_id: BattleId::new(safe(1)),
        wave,
        wave_seed: format!("m6d-properties-wave-{seed}"),
        turn,
        format,
        authority_seat: seat(1),
        player_party,
        enemy_party,
        field,
        weather: WeatherState {
            kind: WeatherKind::None,
            remaining_turns: 0,
        },
        terrain: TerrainState {
            kind: TerrainKind::None,
            remaining_turns: 0,
        },
        arena_conditions: Vec::new(),
        global_ability_suppression: GlobalAbilitySuppressionState {
            ignore_abilities: false,
            source: None,
        },
        battle_rng: BattleRngState::new(format!("m6d-properties-battle-{seed}"), turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::ZERO,
        outcome: BattleOutcome::Ongoing,
    };
    Ok(GeneratedBattle {
        state: GameState::new(
            pack.hash.clone(),
            GameModeId::new(safe(1)),
            wave,
            BattleId::new(safe(2)),
            RunRngState {
                rdg: PhaserRdg::from_seed(&format!("m6d-properties-run-{seed}")).state(),
            },
            Some(battle),
        )?,
        label: format!("single/party={player_party_size}/seed={seed}"),
    })
}

// ---------------------------------------------------------------------------
// Command admission (production offer/proposal/frontier path).
// ---------------------------------------------------------------------------

fn fight_command(actor: PokemonId, target: FieldSlot) -> TestResult<BattleCommand> {
    Ok(BattleCommand::fight(
        actor,
        MoveSlotIndex::ZERO,
        BattleTargetSelection::selected(vec![target])?,
    )?)
}

fn admit_singles_fight(state: &mut GameState, epoch_seed: u64) -> TestResult<CommandSet> {
    let pack = content();
    let current = state.battle.as_ref().expect("battle present");
    let (battle_id, wave, turn) = (current.battle_id, current.wave, current.turn);
    let player_actor = current
        .field
        .occupant(&current.format, player_slot(0))?
        .ok_or("the player field slot is empty")?;
    let enemy_actor = current
        .field
        .occupant(&current.format, enemy_slot(0))?
        .ok_or("the enemy field slot is empty")?;

    let player_command = fight_command(player_actor, enemy_slot(0))?;
    let enemy_command = fight_command(enemy_actor, player_slot(0))?;
    let player_offer = build_command_offer(state, player_slot(0), pack)?;
    let enemy_offer = build_scripted_enemy_offer(state, enemy_slot(0), &enemy_command, pack)?;
    let player_operation =
        player_command_operation_id(battle_id, wave, turn, player_slot(0), seat(1))?;
    let enemy_operation = scripted_enemy_command_operation_id(
        battle_id,
        wave,
        turn,
        enemy_slot(0),
        safe(epoch_seed),
    )?;
    let player_proposal = BattleCommandProposalV1::new(
        player_operation.clone(),
        battle_id,
        wave,
        turn,
        seat(1),
        player_actor,
        player_slot(0),
        player_command,
        MenuInstanceId::new(safe(1)),
        "m6d-properties/player",
    )?;
    let scripted = ScriptedEnemyBattleCommandV1::new(
        enemy_operation.clone(),
        battle_id,
        wave,
        turn,
        safe(epoch_seed),
        enemy_actor,
        enemy_slot(0),
        enemy_command,
    )?;
    let frontier = vec![
        CommandFrontierEntry::new(
            player_operation,
            Some(seat(1)),
            player_actor,
            player_slot(0),
            player_offer,
            CommandFrontierStatus::Admitted {
                command: AcceptedBattleCommand::human(player_proposal.clone()),
                source: CommandAdmissionSource::AuthorityLocalInternal,
            },
        )?,
        CommandFrontierEntry::new(
            enemy_operation,
            None,
            enemy_actor,
            enemy_slot(0),
            enemy_offer,
            CommandFrontierStatus::Admitted {
                command: AcceptedBattleCommand::scripted_enemy(scripted.clone()),
                source: CommandAdmissionSource::ScriptedEnemy,
            },
        )?,
    ];
    state.battle.as_mut().expect("battle present").command_state =
        CommandCollectionState::new(frontier, Vec::new())?;
    Ok(CommandSet::new(vec![
        AcceptedBattleCommand::human(player_proposal),
        AcceptedBattleCommand::scripted_enemy(scripted),
    ])?)
}

fn turn_operation(state: &GameState) -> TestResult<OperationId> {
    let current = state.battle.as_ref().expect("battle present");
    Ok(turn_result_operation_id(
        current.battle_id,
        current.wave,
        current.turn,
    )?)
}

// ---------------------------------------------------------------------------
// Invariant checking with replayable failure reports.
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct TraceStep {
    label: String,
    before_digest: String,
    after_digest: String,
    detail: String,
}

impl TraceStep {
    fn new(label: &str, before: &GameState, after: &GameState, detail: String) -> Self {
        Self {
            label: label.to_owned(),
            before_digest: format!(
                "{:?}",
                MechanicalStateDigest::compute(before).expect("digest computes")
            ),
            after_digest: format!(
                "{:?}",
                MechanicalStateDigest::compute(after).expect("digest computes")
            ),
            detail,
        }
    }
}

fn replay_report(seed: u64, case: &str, trace: &[TraceStep], reason: &str) -> String {
    let mut report = format!(
        "M6D property violation\n  replay: cargo test -p er-testkit --test m6_properties\n  seed: {seed}\n  case: {case}\n"
    );
    for (index, step) in trace.iter().enumerate() {
        let _ = writeln!(
            report,
            "  step {:02}: {} | before={} after={} | {}",
            index, step.label, step.before_digest, step.after_digest, step.detail
        );
    }
    let _ = writeln!(report, "  violation: {reason}");
    report
}

fn fail(seed: u64, case: &str, trace: &[TraceStep], reason: &str) -> String {
    replay_report(seed, case, trace, reason)
}

/// Complete-content validity plus HP/PP/faint/topology bounds for one state.
fn check_state_invariants(
    seed: u64,
    case: &str,
    trace: &[TraceStep],
    state: &GameState,
) -> TestResult {
    let pack = content();
    validate_state_content(state, pack).map_err(|error| -> Box<dyn Error> {
        fail(
            seed,
            case,
            trace,
            &format!("complete-content validation rejected the state: {error}"),
        )
        .into()
    })?;
    let battle = state
        .battle
        .as_ref()
        .ok_or_else(|| fail(seed, case, trace, "generated state lost its battle"))?;

    // Topology uniqueness: no battler may occupy two field slots at once.
    let mut occupant_ids = BTreeSet::new();
    for entry in battle.field.slots.iter() {
        if let Some(occupant) = entry.occupant
            && !occupant_ids.insert(occupant)
        {
            return Err(fail(seed, case, trace, "field topology assigned occupant twice").into());
        }
    }

    for (party_name, party) in [
        ("player", &battle.player_party),
        ("enemy", &battle.enemy_party),
    ] {
        for member in party.iter() {
            if member.hp > member.max_hp || (!member.fainted && member.hp == 0) {
                return Err(fail(
                    seed,
                    case,
                    trace,
                    &format!(
                        "{party_name} party member violates HP bounds (hp={}, max={}, fainted={})",
                        member.hp, member.max_hp, member.fainted
                    ),
                )
                .into());
            }
            for slot in member.moves.iter().flatten() {
                let definition =
                    find_move(&pack.moves, slot.move_id).map_err(|error| -> Box<dyn Error> {
                        fail(
                            seed,
                            case,
                            trace,
                            &format!("move slot references absent content move: {error}"),
                        )
                        .into()
                    })?;
                let max_pp = validate_move_slot(slot, definition.base_pp).map_err(
                    |error| -> Box<dyn Error> {
                        fail(
                            seed,
                            case,
                            trace,
                            &format!("PP bounds violated on a party member: {error}"),
                        )
                        .into()
                    },
                )?;
                if slot.pp_used > max_pp {
                    return Err(fail(
                        seed,
                        case,
                        trace,
                        &format!("pp_used {} exceeds resolved maximum {max_pp}", slot.pp_used),
                    )
                    .into());
                }
            }
        }
    }

    // Faint queue: unique ids, ordered allocation, members of the right party.
    let mut seen_ids = BTreeSet::new();
    let mut previous_id: Option<FaintOccurrenceId> = None;
    for occurrence in battle.faint_queue.iter() {
        if let Some(previous) = previous_id {
            assert!(occurrence.id > previous);
        }
        if !seen_ids.insert(occurrence.id) {
            return Err(fail(seed, case, trace, "faint occurrence id appears twice").into());
        }
        previous_id = Some(occurrence.id);
        assert!(occurrence.id < battle.next_faint_occurrence);
        let party = match occurrence.slot.side {
            BattleSide::Player => &battle.player_party,
            BattleSide::Enemy => &battle.enemy_party,
        };
        if !party.iter().any(|member| member.id == occurrence.pokemon) {
            return Err(fail(
                seed,
                case,
                trace,
                "faint occurrence references a battler outside its side party",
            )
            .into());
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

#[test]
fn m6d_generated_states_pass_complete_content_validation_and_snapshot_round_trip() -> TestResult {
    for &seed in &SEEDS {
        let player_party_size = 1 + CaseRng::new(seed).below(3);
        let generated = generated_single_battle(seed, player_party_size)?;
        let case = generated.label.clone();
        let state = generated.state;
        check_state_invariants(seed, &case, &[], &state)?;

        // Digest computation is pure: recomputing never changes anything.
        let first = MechanicalStateDigest::compute(&state)?;
        let second = MechanicalStateDigest::compute(&state)?;
        assert_eq!(
            first, second,
            "digest recomputation diverged for seed {seed}"
        );

        // Canonical snapshot round trip restores an identical state.
        let bytes = canonical_game_state_bytes(&state)?;
        let decoded = decode_canonical_game_state(&bytes)?;
        assert_eq!(decoded, state, "snapshot decode diverged for seed {seed}");
        assert_eq!(
            canonical_game_state_bytes(&decoded)?,
            bytes,
            "canonical encoding is unstable for seed {seed}"
        );
    }
    Ok(())
}

#[test]
fn m6d_turn_resolution_is_pure_and_deterministic_across_the_corpus() -> TestResult {
    for &seed in &SEEDS {
        let player_party_size = 1 + CaseRng::new(seed).below(3);
        let generated = generated_single_battle(seed, player_party_size)?;
        let case = generated.label;
        let mut admitted = generated.state;
        let commands = admit_singles_fight(&mut admitted, seed % 97)?;
        let before = admitted.clone();

        // Purity: resolution consumes nothing from the caller's state.
        let first = resolve_turn(
            &before,
            &commands,
            AuthorityEpoch::new(safe(seed % 13 + 1)),
            &turn_operation(&before)?,
            content(),
        )?;
        assert_eq!(
            before, admitted,
            "resolve_turn mutated its input for seed {seed}"
        );

        // Determinism: two independent runs agree bit-for-bit.
        let second = resolve_turn(
            &before,
            &commands,
            AuthorityEpoch::new(safe(seed % 13 + 1)),
            &turn_operation(&before)?,
            content(),
        )?;
        if first != second {
            return Err(replay_report(
                seed,
                &case,
                &[TraceStep::new(
                    "resolve_turn",
                    &before,
                    &first.after_state,
                    format!(
                        "outcome={:?} decision={:?}",
                        first.outcome, first.next_decision
                    ),
                )],
                "two identical resolutions produced different transitions",
            )
            .into());
        }

        check_state_invariants(seed, &case, &[], &first.after_state)?;

        // Terminal consistency: the derived outcome matches the recorded one
        // and a decided battle always completes its next decision.
        let after_battle = first
            .after_state
            .battle
            .as_ref()
            .expect("property battle fixture retains its battle");
        assert_eq!(derive_battle_outcome(after_battle), first.outcome);
        match (&first.outcome, &first.next_decision) {
            (BattleOutcome::Ongoing, _) => {}
            (decided, BattleNextDecision::Complete(completed)) => {
                assert_eq!(decided, completed, "terminal mismatch for seed {seed}");
            }
            (decided, other) => {
                return Err(replay_report(
                    seed,
                    &case,
                    &[TraceStep::new(
                        "resolve_turn",
                        &before,
                        &first.after_state,
                        format!("decision={other:?}"),
                    )],
                    &format!("decided outcome {decided:?} did not complete the next decision"),
                )
                .into());
            }
        }
    }
    Ok(())
}

#[test]
fn m6d_pairwise_factor_matrix_keeps_all_invariants_after_resolution() -> TestResult {
    // Full-factor enumeration of a bounded pairwise matrix: every pair of
    // factor levels co-occurs in at least one resolved battle.
    let statuses = [StatusKind::None, StatusKind::Burn, StatusKind::Paralysis];
    let speeds = [200_u32, 50_u32]; // player-first vs enemy-first ordering
    let hp_levels = [true, false]; // full vs low attacker HP
    for status in statuses {
        for speed in speeds {
            for hp_full in hp_levels {
                let player = generated_pokemon(300, Some(seat(1)), status, speed, hp_full)?;
                let enemy_status = if status == StatusKind::None {
                    StatusKind::Poison
                } else {
                    StatusKind::None
                };
                let enemy = generated_pokemon(301, None, enemy_status, 300 - speed, true)?;
                let pack = content();
                let wave = WaveIndex::new(safe(1))?;
                let turn = TurnIndex::new(safe(1))?;
                let field = FieldState::new_for_format(
                    &BattleFormat::single(),
                    vec![
                        FieldSlotState::new(player_slot(0), Some(player.id)),
                        FieldSlotState::new(enemy_slot(0), Some(enemy.id)),
                    ],
                )?;
                let battle = BattleState {
                    battle_id: BattleId::new(safe(1)),
                    wave,
                    wave_seed: "m6d-pairwise".to_owned(),
                    turn,
                    format: BattleFormat::single(),
                    authority_seat: seat(1),
                    player_party: vec![player.clone()],
                    enemy_party: vec![enemy.clone()],
                    field,
                    weather: WeatherState {
                        kind: WeatherKind::None,
                        remaining_turns: 0,
                    },
                    terrain: TerrainState {
                        kind: TerrainKind::None,
                        remaining_turns: 0,
                    },
                    arena_conditions: Vec::new(),
                    global_ability_suppression: GlobalAbilitySuppressionState {
                        ignore_abilities: false,
                        source: None,
                    },
                    battle_rng: BattleRngState::new("m6d-pairwise-battle", turn),
                    command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
                    faint_queue: Vec::new(),
                    next_faint_occurrence: FaintOccurrenceId::ZERO,
                    outcome: BattleOutcome::Ongoing,
                };
                let mut state = GameState::new(
                    pack.hash.clone(),
                    GameModeId::new(safe(1)),
                    wave,
                    BattleId::new(safe(2)),
                    RunRngState {
                        rdg: PhaserRdg::from_seed("m6d-pairwise-run").state(),
                    },
                    Some(battle),
                )?;
                let commands = admit_singles_fight(&mut state, 7)?;
                let before = state.clone();
                let transition = resolve_turn(
                    &before,
                    &commands,
                    AuthorityEpoch::new(safe(3)),
                    &turn_operation(&before)?,
                    pack,
                )?;
                let case = format!("pairwise/status={status:?}/speed={speed}/hp_full={hp_full}");
                check_state_invariants(0, &case, &[], &transition.after_state)?;
                let after_battle = transition
                    .after_state
                    .battle
                    .as_ref()
                    .expect("property battle fixture retains its battle");
                assert_eq!(derive_battle_outcome(after_battle), transition.outcome);
            }
        }
    }
    Ok(())
}

#[test]
fn m6d_campaigns_chain_turns_with_bounds_faint_replacement_and_terminal_consistency() -> TestResult
{
    for &seed in &SEEDS {
        let player_party_size = 1 + CaseRng::new(seed).below(3);
        let generated = generated_single_battle(seed, player_party_size)?;
        let case = generated.label;
        let mut trace: Vec<TraceStep> = Vec::new();
        let mut state = generated.state;

        while trace.len() < 12 {
            check_state_invariants(seed, &case, &trace, &state)?;
            if derive_battle_outcome(
                state
                    .battle
                    .as_ref()
                    .expect("property battle fixture retains its battle"),
            ) != BattleOutcome::Ongoing
            {
                break;
            }
            let commands = admit_singles_fight(&mut state, seed % 89 + trace.len() as u64)?;
            let before = state.clone();
            let transition = resolve_turn(
                &before,
                &commands,
                AuthorityEpoch::new(safe(seed % 13 + 1 + trace.len() as u64)),
                &turn_operation(&before)?,
                content(),
            )?;
            trace.push(TraceStep::new(
                "resolve_turn",
                &before,
                &transition.after_state,
                format!(
                    "outcome={:?} decision={:?}",
                    transition.outcome, transition.next_decision
                ),
            ));
            check_state_invariants(seed, &case, &trace, &transition.after_state)?;
            let after_battle = transition
                .after_state
                .battle
                .as_ref()
                .expect("property battle fixture retains its battle");
            assert_eq!(
                derive_battle_outcome(after_battle),
                transition.outcome,
                "{}",
                replay_report(
                    seed,
                    &case,
                    &trace,
                    "recorded outcome diverged from derived outcome"
                )
            );

            state = match &transition.next_decision {
                BattleNextDecision::CommandFrontier => transition.after_state,
                BattleNextDecision::Complete(_) => break,
                BattleNextDecision::Replacement { occurrence } => resolve_campaign_replacement(
                    seed,
                    &case,
                    &mut trace,
                    transition.after_state,
                    *occurrence,
                )?,
            };
        }

        // Terminal consistency at campaign end: whenever the final state has a
        // decided outcome its recorded outcome completed identically.
        let final_battle = state
            .battle
            .as_ref()
            .expect("property battle fixture retains its battle");
        let final_outcome = derive_battle_outcome(final_battle);
        if final_outcome != BattleOutcome::Ongoing {
            assert_eq!(final_outcome, final_battle.outcome);
        }
    }
    Ok(())
}

/// Resolve one forced-replacement window through the public resolver with a
/// legal selection (or the explicit no-candidate decision), proving illegal
/// selections fail closed along the way.
fn resolve_campaign_replacement(
    seed: u64,
    case: &str,
    trace: &mut Vec<TraceStep>,
    pending: GameState,
    occurrence_id: FaintOccurrenceId,
) -> TestResult<GameState> {
    let pack = content();
    let battle = pending
        .battle
        .as_ref()
        .ok_or_else(|| fail(seed, case, trace, "pending state lost its battle"))?;
    let occurrence = *battle
        .faint_queue
        .iter()
        .find(|entry| entry.id == occurrence_id)
        .ok_or_else(|| {
            fail(
                seed,
                case,
                trace,
                "next decision referenced an unknown occurrence",
            )
        })?;
    assert_eq!(
        occurrence.slot.side,
        BattleSide::Player,
        "{}",
        fail(
            seed,
            case,
            trace,
            "the public resolver only owns player-side replacements"
        )
    );
    let owner_seat = occurrence
        .owner_seat
        .ok_or_else(|| fail(seed, case, trace, "replacement occurrence lacks an owner"))?;
    let party = &battle.player_party;

    // Legal selection: the lowest-index non-fainted reserve; otherwise the
    // explicit internal no-candidate decision.
    let reserve = party
        .iter()
        .enumerate()
        .find(|(_, member)| !member.fainted && member.id != occurrence.pokemon)
        .map(|(index, member)| {
            (
                PartyIndex::try_from(index as u64).expect("reserve index fits six party slots"),
                member.id,
            )
        });
    let selection = reserve
        .as_ref()
        .map(|(party_index, pokemon_id)| ReplacementSelection::Selected {
            party_slot: *party_index,
            pokemon: *pokemon_id,
        })
        .unwrap_or(ReplacementSelection::NoLegalReplacement);

    let illegal = ReplacementSelection::selected(PartyIndex::ZERO, occurrence.pokemon);
    if reserve.is_some()
        && validate_replacement_selection(&pending, occurrence_id, &illegal, pack).is_ok()
    {
        return Err(fail(
            seed,
            case,
            trace,
            "an illegal replacement selection was accepted",
        )
        .into());
    }
    validate_replacement_selection(&pending, occurrence_id, &selection, pack).map_err(
        |error| -> Box<dyn Error> {
            fail(
                seed,
                case,
                trace,
                &format!("a legal replacement selection was rejected: {error}"),
            )
            .into()
        },
    )?;

    let material = replacement_operation_id(
        occurrence.source.epoch,
        battle.battle_id,
        occurrence.source.wave,
        occurrence.source.resolved_turn,
        occurrence.source.turn_occurrence,
        occurrence.slot,
        owner_seat,
    )?;
    let before = pending.clone();
    let transition = resolve_replacement(&pending, occurrence_id, &selection, &material, pack)?;
    trace.push(TraceStep::new(
        "resolve_replacement",
        &before,
        &transition.after_state,
        format!("selection={selection:?} outcome={:?}", transition.outcome),
    ));

    // Replacements never consume turns or RNG and always mark their window.
    let before_battle = before
        .battle
        .as_ref()
        .expect("property battle fixture retains its battle");
    let after_battle = transition
        .after_state
        .battle
        .as_ref()
        .expect("property battle fixture retains its battle");
    assert_eq!(after_battle.turn, before_battle.turn);
    assert_eq!(after_battle.battle_rng, before_battle.battle_rng);
    let resolved = after_battle
        .faint_queue
        .iter()
        .find(|entry| entry.id == occurrence_id)
        .expect("resolved occurrence stays queued");
    assert_ne!(
        resolved.replacement,
        ReplacementProgress::Pending,
        "{}",
        fail(
            seed,
            case,
            trace,
            "the replacement window stayed pending after resolution"
        )
    );
    check_state_invariants(seed, case, trace, &transition.after_state)?;
    Ok(transition.after_state)
}

#[test]
fn m6d_faulted_inputs_fail_closed_without_mutating_their_input() -> TestResult {
    for &seed in &SEEDS {
        let generated = generated_single_battle(seed, 2)?;
        let case = format!("{}/faults", generated.label);
        let mut admitted = generated.state;
        let commands = admit_singles_fight(&mut admitted, seed % 97)?;
        let before = admitted.clone();

        // Fault A: a stale turn operation id must never be admitted.
        let stale = {
            let current = before
                .battle
                .as_ref()
                .expect("property battle fixture retains its battle");
            let wrong_turn = turn_result_operation_id(
                current.battle_id,
                current.wave,
                TurnIndex::new(safe(current.turn.get().get() + 40))?,
            )?;
            resolve_turn(
                &before,
                &commands,
                AuthorityEpoch::new(safe(seed % 13 + 1)),
                &wrong_turn,
                content(),
            )
        };
        if stale.is_ok() {
            return Err(fail(seed, &case, &[], "a stale turn operation id was admitted").into());
        }
        assert_eq!(
            before, admitted,
            "a rejected fault mutated its input for seed {seed}"
        );

        // Fault B: queueing a faint with the zero epoch fails closed.
        let mut faulted = before.clone();
        let queue_result = {
            let battle = faulted
                .battle
                .as_mut()
                .expect("property battle fixture retains its battle");
            queue_faint(
                battle,
                FaintCandidate::new(battle.enemy_party[0].id, enemy_slot(0)),
                AuthorityEpoch::ZERO,
                0,
            )
        };
        assert!(
            queue_result.is_err(),
            "a zero-epoch faint was queued for seed {seed}"
        );
        assert_eq!(faulted, before);

        // Fault C: a replacement against a tampered material id is rejected.
        let mut with_faint = before.clone();
        {
            let battle = with_faint
                .battle
                .as_mut()
                .expect("property battle fixture retains its battle");
            battle.player_party[0].hp = 0;
            battle.player_party[0].fainted = true;
            queue_faint(
                battle,
                FaintCandidate::new(battle.player_party[0].id, player_slot(0)),
                AuthorityEpoch::new(safe(9)),
                0,
            )?;
        }
        let stored = *with_faint
            .battle
            .as_ref()
            .expect("property battle fixture retains its battle")
            .faint_queue
            .first()
            .expect("queue_faint inserted the property fixture occurrence");
        let battle_ref = with_faint
            .battle
            .as_ref()
            .expect("property battle fixture retains its battle");
        let wrong_material = replacement_operation_id(
            stored.source.epoch,
            battle_ref.battle_id,
            stored.source.wave,
            stored.source.resolved_turn,
            stored.source.turn_occurrence + 77,
            stored.slot,
            stored
                .owner_seat
                .expect("player occurrence carries its owner"),
        )?;
        let reserve = battle_ref
            .player_party
            .iter()
            .enumerate()
            .find(|(_, member)| !member.fainted)
            .map(|(index, member)| {
                ReplacementSelection::selected(
                    PartyIndex::try_from(index as u64).expect("reserve index fits six slots"),
                    member.id,
                )
            })
            .ok_or_else(|| fail(seed, &case, &[], "the fault case requires a live reserve"))?;
        assert!(
            resolve_replacement(&with_faint, stored.id, &reserve, &wrong_material, content())
                .is_err(),
            "a tampered replacement material was accepted for seed {seed}"
        );
        assert_eq!(
            with_faint
                .battle
                .as_ref()
                .expect("property battle fixture retains its battle")
                .faint_queue
                .len(),
            1
        );
    }
    Ok(())
}

#[test]
fn m6d_topology_slots_are_unique_and_field_occupancy_is_unique_per_format() -> TestResult {
    for format in [BattleFormat::single(), BattleFormat::coop_double()] {
        validate_format(&format)?;
        let slots = canonical_slots(&format)?;
        let unique: BTreeSet<_> = slots.iter().collect();
        assert_eq!(
            unique.len(),
            slots.len(),
            "canonical slots repeat for capacity {}/{}",
            format.player_capacity,
            format.enemy_capacity
        );
        let seats = human_seats(&format)?;
        let unique_seats: BTreeSet<_> = seats.iter().collect();
        assert_eq!(unique_seats.len(), seats.len(), "human seats repeat");

        // Duplicate occupancy across two distinct slots must fail closed.
        let duplicated_occupant = PokemonId::new(safe(999));
        let first_available = slots[0];
        let second_available = slots
            .iter()
            .copied()
            .find(|slot| {
                slot.side != first_available.side || slot.position != first_available.position
            })
            .ok_or("topology requires at least two distinct slots")?;
        let attempt = FieldState::new_for_format(
            &format,
            vec![
                FieldSlotState::new(first_available, Some(duplicated_occupant)),
                FieldSlotState::new(second_available, Some(duplicated_occupant)),
            ],
        );
        assert!(
            attempt.is_err(),
            "duplicate field occupancy was accepted for capacity {}/{}",
            format.player_capacity,
            format.enemy_capacity
        );
    }
    Ok(())
}

#[test]
fn m6d_faint_queue_allocates_ordered_unique_occurrences_across_batches() -> TestResult {
    let generated = generated_single_battle(42, 3)?;
    let mut state = generated.state;
    if state
        .battle
        .as_ref()
        .is_some_and(|battle| battle.next_faint_occurrence == FaintOccurrenceId::ZERO)
    {
        state
            .battle
            .as_mut()
            .expect("battle exists")
            .next_faint_occurrence = FaintOccurrenceId::new(safe(1));
    }
    let epoch = AuthorityEpoch::new(safe(11));

    let batch_one = {
        let battle = state
            .battle
            .as_mut()
            .expect("property battle fixture retains its battle");
        battle.enemy_party[0].hp = 0;
        battle.enemy_party[0].fainted = true;
        queue_faints(
            battle,
            &[FaintCandidate::new(battle.enemy_party[0].id, enemy_slot(0))],
            epoch,
            0,
        )?
    };

    let batch_two = {
        let battle = state
            .battle
            .as_mut()
            .expect("property battle fixture retains its battle");
        battle.player_party[0].hp = 0;
        battle.player_party[0].fainted = true;
        queue_faints(
            battle,
            &[FaintCandidate::new(
                battle.player_party[0].id,
                player_slot(0),
            )],
            epoch,
            2,
        )?
    };

    let battle = state
        .battle
        .as_ref()
        .expect("property battle fixture retains its battle");
    let mut previous: Option<FaintOccurrenceId> = None;
    for occurrence in battle.faint_queue.iter() {
        if let Some(previous) = previous {
            assert!(
                occurrence.id > previous,
                "queued occurrences must allocate in increasing order"
            );
        }
        previous = Some(occurrence.id);
        assert!(occurrence.id < battle.next_faint_occurrence);
    }
    assert_eq!(batch_one.len(), 1);
    assert_eq!(batch_two.len(), 1);
    assert!(
        batch_one[0].occurrence.id < batch_two[0].occurrence.id,
        "the global allocator must stay independent of per-turn occurrence numbering"
    );

    // Selecting an already-fainted candidate for any queued window fails closed.
    for occurrence in battle.faint_queue.iter().copied() {
        let fainted_self = ReplacementSelection::selected(PartyIndex::ZERO, occurrence.pokemon);
        let verdict =
            validate_replacement_selection(&state, occurrence.id, &fainted_self, content());
        assert!(
            verdict.is_err(),
            "selecting the already-fainted candidate must fail closed"
        );
    }
    Ok(())
}

#[test]
fn m6d_scheduled_effects_deliver_every_event_exactly_once_with_unique_stable_ids() -> TestResult {
    for &seed in &SEEDS {
        let mut rng = CaseRng::new(seed);
        let owner = PokemonId::new(safe(700 + seed % 5));
        let mut state = ScheduledEffectsState::default();
        let mut delivered: BTreeSet<u64> = BTreeSet::new();
        let mut next_event_id: u64 = 1;
        let turns = rng.range(4, 8);

        for turn in 0..turns {
            let scheduled_this_turn = rng.range(1, 3);
            for _ in 0..scheduled_this_turn {
                let event_id = next_event_id;
                next_event_id += 1;
                let request = DelayedEffectRequest {
                    event_id,
                    source_behavior_unit: behavior_unit(),
                    owner: pokemon_scope(owner),
                    stored_target: None,
                    delay_turns: rng.range(1, 3) as u32,
                    delivery_hook: MechanicHookV2::AfterMove,
                    payload: ScheduledEventPayloadV1::DelayedHeal {
                        amount: rng.range(1, 50) as u32,
                    },
                    cancellation_policy: ScheduledEventCancellationPolicyV1::Never,
                };
                let outcome =
                    schedule_delayed_effect(&state, turn as u32, request).map_err(|error| {
                        fail(
                            seed,
                            "scheduled-effects",
                            &[],
                            &format!("valid delayed-effect scheduling failed closed: {error}"),
                        )
                    })?;
                state = outcome.state;
            }

            // Weather/terrain ownership stays coherent under seeded replacement.
            if rng.flip() {
                let field_request = FieldConditionRequest {
                    source_behavior_unit: behavior_unit(),
                    owner: MechanicScope::Battle,
                    duration_turns: rng.range(1, 4) as u16,
                };
                let weather = if rng.flip() {
                    WeatherId::Sunny
                } else {
                    WeatherId::Rain
                };
                state = set_weather(&state, weather, field_request.clone())
                    .map_err(|error| {
                        fail(
                            seed,
                            "scheduled-effects",
                            &[],
                            &format!("weather application failed closed: {error}"),
                        )
                    })?
                    .state;
                state = set_terrain(&state, TerrainId::Electric, field_request)
                    .map_err(|error| {
                        fail(
                            seed,
                            "scheduled-effects",
                            &[],
                            &format!("terrain application failed closed: {error}"),
                        )
                    })?
                    .state;
            }

            state.validate().map_err(|error| {
                fail(
                    seed,
                    "scheduled-effects",
                    &[],
                    &format!("family state invalidated mid-campaign: {error}"),
                )
            })?;

            let drained = drain_due_events(
                &state,
                turn as u32,
                &SlotOccupants::default(),
                &UnavailableScopes::default(),
            )
            .map_err(|error| {
                fail(
                    seed,
                    "scheduled-effects",
                    &[],
                    &format!("drain failed closed: {error}"),
                )
            })?;
            for record in drained.records.iter() {
                assert!(
                    delivered.insert(record.event_id),
                    "event {} was delivered twice",
                    record.event_id
                );
            }
            state = drained.state;
        }

        // A far-future drain retires everything exactly once.
        let drained = drain_due_events(
            &state,
            turns as u32 + 64,
            &SlotOccupants::default(),
            &UnavailableScopes::default(),
        )?;
        for record in drained.records.iter() {
            assert!(
                delivered.insert(record.event_id),
                "event {} was delivered twice in the tail drain",
                record.event_id
            );
        }
        state = drained.state;
        assert_eq!(
            delivered.len() as u64,
            next_event_id - 1,
            "some scheduled event was never delivered"
        );
        assert!(
            state
                .scheduled_event_ids
                .windows(2)
                .all(|pair| pair[0] < pair[1]),
            "consumed stable IDs must stay strictly ascending and unique"
        );
        assert!(
            state.pending_events.is_empty(),
            "no pending events may survive the tail drain"
        );

        // Fault: consumed stable IDs are never reusable.
        let replayed = schedule_delayed_effect(
            &state,
            0,
            DelayedEffectRequest {
                event_id: 1,
                source_behavior_unit: behavior_unit(),
                owner: pokemon_scope(owner),
                stored_target: None,
                delay_turns: 1,
                delivery_hook: MechanicHookV2::AfterMove,
                payload: ScheduledEventPayloadV1::DelayedHeal { amount: 1 },
                cancellation_policy: ScheduledEventCancellationPolicyV1::Never,
            },
        );
        assert!(
            replayed.is_err(),
            "a consumed stable event id was reused for seed {seed}"
        );
    }
    Ok(())
}

#[test]
fn m6d_guard_chain_follows_audited_draw_thresholds_and_validates_throughout() -> TestResult {
    for &seed in &SEEDS {
        let mut rng = CaseRng::new(seed);
        let owner = pokemon_scope(PokemonId::new(safe(800 + seed % 3)));
        let mut state = GuardFamilyState::default();

        for step in 0..rng.range(3, 6) {
            let depth = state.chain_depth;
            assert!(depth < 40, "chain depth grew unreasonably at step {step}");
            let want_success = depth == 0 || rng.flip();
            let draw = if depth == 0 {
                // Depth 0 is guaranteed success and rejects any supplied draw.
                None
            } else if want_success {
                Some(AuditedGuardDraw::new(SafeU53::ZERO, 3_u64.pow(depth)))
            } else {
                let threshold = 3_u64.pow(depth);
                let roll = rng.range(1, threshold - 1);
                Some(AuditedGuardDraw::new(
                    SafeU53::new(roll).expect("draw roll fits"),
                    threshold,
                ))
            };
            let request = GuardUseRequest {
                owner,
                activation: GuardActivation::SelfGuard(GuardKind::Protect),
            };
            let transition = apply_guard_use(&state, &request, draw).map_err(|error| {
                fail(
                    seed,
                    "guard-chain",
                    &[],
                    &format!("guard activation failed closed unexpectedly: {error}"),
                )
            })?;
            let expected_success = depth == 0 || want_success;
            assert_eq!(
                transition.evidence.succeeded, expected_success,
                "the audited guard draw disagreed with its threshold at depth {depth}"
            );
            assert_eq!(
                transition.state.chain_depth,
                if expected_success { depth + 1 } else { 0 },
                "chain depth must advance on success and reset on failure"
            );
            state = transition.state;
            // Turn-end expiry clears active tags while preserving chain depth,
            // so the next seeded activation starts from a clean field.
            let expired = expire_turn_end(&state).map_err(|error| {
                fail(
                    seed,
                    "guard-chain",
                    &[],
                    &format!("turn-end expiry failed closed: {error}"),
                )
            })?;
            assert_eq!(expired.state.chain_depth, state.chain_depth);
            assert!(expired.state.self_guards.is_empty());
            state = expired.state;
            state.validate().map_err(|error| {
                fail(
                    seed,
                    "guard-chain",
                    &[],
                    &format!("guard family state invalidated: {error}"),
                )
            })?;
        }
    }
    Ok(())
}

#[test]
fn m6d_item_lifecycle_keeps_stack_charge_and_ledger_bounds_under_seeded_activity() -> TestResult {
    for &seed in &SEEDS {
        let mut rng = CaseRng::new(seed);
        let owners = [PokemonId::new(safe(900)), PokemonId::new(safe(901))];
        let keys = ["m6d-property-berry-a", "m6d-property-berry-b"];
        let mut state = ItemLifecycleStateV2::default();

        for _step in 0..rng.range(6, 12) {
            let owner = *rng.pick(&owners);
            let key = (*rng.pick(&keys)).to_owned();
            if rng.flip() || state.find_instance(owner, &key).is_none() {
                let request = GrantRequest {
                    owner,
                    registry_key: key.clone(),
                    stacks: rng.range(1, 3) as u16,
                    charges: rng.flip().then(|| rng.range(1, 3) as u16),
                    source_ordinal: SourceOrdinal::ZERO,
                    transferable: false,
                };
                let transition = grant_item(&state, &request).map_err(|error| {
                    fail(
                        seed,
                        "item-lifecycle",
                        &[],
                        &format!("a valid grant failed closed: {error}"),
                    )
                })?;
                if transition.evidence.merged {
                    assert_eq!(
                        transition.evidence.stacks_after,
                        transition.evidence.stacks_before + request.stacks,
                        "a merged grant must add exactly its stacks"
                    );
                } else {
                    assert_eq!(transition.evidence.stacks_after, request.stacks);
                }
                state = transition.state;
            } else {
                let request = ConsumeRequest {
                    owner,
                    registry_key: key.clone(),
                    preserve: rng.flip(),
                    current_turn: rng.range(0, 20) as u32,
                };
                let transition = consume_item(&state, &request).map_err(|error| {
                    fail(
                        seed,
                        "item-lifecycle",
                        &[],
                        &format!("consume against tracked inventory failed closed: {error}"),
                    )
                })?;
                if let Some(stacks_after) = transition.evidence.stacks_after {
                    assert!(
                        stacks_after <= transition.evidence.stacks_before,
                        "consumption grew the stack"
                    );
                }
                state = transition.state;
            }

            state.validate().map_err(|error| {
                fail(
                    seed,
                    "item-lifecycle",
                    &[],
                    &format!("item family state invalidated: {error}"),
                )
            })?;
            // Instances stay unique per (owner, registry key) with sane stacks.
            let mut pairs: BTreeSet<(PokemonId, &str)> = BTreeSet::new();
            for instance in state.instances.iter() {
                assert!(
                    instance.stacks >= 1,
                    "a live instance dropped below one stack"
                );
                assert!(
                    instance.charges.is_none_or(|charges| charges >= 1),
                    "a live charged instance dropped below one charge"
                );
                assert!(
                    pairs.insert((instance.owner, instance.registry_key.as_str())),
                    "duplicate instance for one owner/key pair"
                );
            }
            let mut ordinals: BTreeSet<SafeU53> = BTreeSet::new();
            for entry in state.consume_ledger.iter() {
                assert!(
                    ordinals.insert(entry.ledger_ordinal),
                    "ledger ordinals must stay unique"
                );
            }
        }
    }
    Ok(())
}

#[test]
fn m6d_suppression_overlays_preserve_ability_identity_and_expire_deterministically() -> TestResult {
    for &seed in &SEEDS {
        let mut rng = CaseRng::new(seed);
        let owners = [PokemonId::new(safe(950)), PokemonId::new(safe(951))];
        let origins = [
            SuppressionOrigin::GlobalIgnore,
            SuppressionOrigin::FieldAbility {
                source_pokemon: PokemonId::new(safe(952)),
            },
            SuppressionOrigin::MoveApplied {
                source_move: MoveId::new(safe(ATTACK_MOVE)),
            },
        ];
        let mut state = SuppressionImmunityStateV2::new();

        for _step in 0..rng.range(4, 10) {
            let owner = *rng.pick(&owners);
            let origin = rng.pick(&origins).clone();
            let remaining = if rng.flip() {
                None
            } else {
                Some(rng.range(1, 4) as u16)
            };
            let request = SlotSuppressionRequest {
                owner,
                slot: *rng.pick(&[AbilitySlot::Active, AbilitySlot::Passive0]),
                origin,
                remaining_turns: remaining,
                current_ability: INTIMIDATE_ABILITY_ID,
                suppressibility: AbilitySuppressibility::Suppressible,
            };
            let transition = apply_slot_suppression(&state, &request).map_err(|error| {
                fail(
                    seed,
                    "suppression",
                    &[],
                    &format!("a valid suppression overlay failed closed: {error}"),
                )
            })?;
            assert_eq!(
                transition.evidence.ability_preserved, INTIMIDATE_ABILITY_ID,
                "suppression overlays must never rewrite the covered ability identity"
            );
            state = transition.state;

            // Timed windows expire deterministically: exactly the entries at
            // one remaining turn are removed by one advance.
            if rng.flip() {
                let expiring = state
                    .slot_suppressions
                    .iter()
                    .filter(|entry| entry.remaining_turns == Some(1))
                    .count();
                let advanced = advance_suppression_turns(&state).map_err(|error| {
                    fail(
                        seed,
                        "suppression",
                        &[],
                        &format!("timed-window advance failed closed: {error}"),
                    )
                })?;
                assert_eq!(advanced.evidence.removed.len(), expiring);
                state = advanced.state;
            }

            // Owner-scoped cleanup removes exactly that owner's overlays.
            if rng.flip() {
                let target = *rng.pick(&owners);
                let matching = state
                    .slot_suppressions
                    .iter()
                    .filter(|entry| entry.owner == target)
                    .count();
                let cleared =
                    clear_suppressions(&state, SuppressionCleanupEvent::OwnerLeftField(target))
                        .map_err(|error| {
                            fail(
                                seed,
                                "suppression",
                                &[],
                                &format!("owner cleanup failed closed: {error}"),
                            )
                        })?;
                assert_eq!(cleared.evidence.removed.len(), matching);
                state = cleared.state;
            }

            state.validate().map_err(|error| {
                fail(
                    seed,
                    "suppression",
                    &[],
                    &format!("suppression family state invalidated: {error}"),
                )
            })?;
            let mut triples: BTreeSet<(PokemonId, AbilitySlot, SuppressionOrigin)> =
                BTreeSet::new();
            for entry in state.slot_suppressions.iter() {
                assert_ne!(entry.remaining_turns, Some(0), "zero windows are invalid");
                assert!(
                    triples.insert((entry.owner, entry.slot, entry.origin.clone())),
                    "overlapping identical origins must refresh instead of stacking"
                );
            }
        }
    }
    Ok(())
}

#[test]
fn m6d_snapshot_continuation_reproduces_uninterrupted_campaign_digests_exactly() -> TestResult {
    for &seed in &SEEDS {
        let generated = generated_single_battle(seed, 2)?;
        let case = format!("{}/continuation", generated.label);

        // Advance the campaign two turns, then snapshot canonically.
        let mut original = generated.state;
        let mut prefix_trace: Vec<TraceStep> = Vec::new();
        for _ in 0..2 {
            if derive_battle_outcome(
                original
                    .battle
                    .as_ref()
                    .expect("property battle fixture retains its battle"),
            ) != BattleOutcome::Ongoing
            {
                break;
            }
            original = advance_one_turn(seed, &case, &mut prefix_trace, original)?;
        }
        let bytes = canonical_game_state_bytes(&original)?;
        let restored = decode_canonical_game_state(&bytes)?;

        // Non-canonical bytes fail closed: decode admits only exact encodings.
        let mut padded = bytes.clone();
        padded.push(b' ');
        assert!(
            decode_canonical_game_state(&padded).is_err(),
            "non-canonical snapshot bytes were accepted for seed {seed}"
        );

        // Continue both branches over identical future commands.
        let mut uninterrupted = original.clone();
        let mut continued = restored;
        let mut full_trace: Vec<TraceStep> = prefix_trace.clone();
        for _ in 0..3 {
            if derive_battle_outcome(
                uninterrupted
                    .battle
                    .as_ref()
                    .expect("property battle fixture retains its battle"),
            ) != BattleOutcome::Ongoing
            {
                break;
            }
            uninterrupted = advance_one_turn(seed, &case, &mut full_trace, uninterrupted)?;
            continued = advance_one_turn(seed, &case, &mut full_trace, continued)?;
        }
        assert_eq!(
            MechanicalStateDigest::compute(&uninterrupted)?,
            MechanicalStateDigest::compute(&continued)?,
            "{}",
            replay_report(
                seed,
                &case,
                &full_trace,
                "the restored continuation diverged from the uninterrupted campaign",
            )
        );
        assert_eq!(uninterrupted, continued);
    }
    Ok(())
}

fn advance_one_turn(
    seed: u64,
    case: &str,
    trace: &mut Vec<TraceStep>,
    state: GameState,
) -> TestResult<GameState> {
    let mut admitted = state;
    let commands = admit_singles_fight(&mut admitted, seed % 89 + trace.len() as u64)?;
    let before = admitted.clone();
    let transition = resolve_turn(
        &before,
        &commands,
        AuthorityEpoch::new(safe(seed % 17 + 1 + trace.len() as u64)),
        &turn_operation(&before)?,
        content(),
    )?;
    trace.push(TraceStep::new(
        "advance_one_turn",
        &before,
        &transition.after_state,
        format!("decision={:?}", transition.next_decision),
    ));
    check_state_invariants(seed, case, trace, &transition.after_state)?;
    match &transition.next_decision {
        BattleNextDecision::CommandFrontier | BattleNextDecision::Complete(_) => {
            Ok(transition.after_state)
        }
        BattleNextDecision::Replacement { occurrence } => {
            resolve_campaign_replacement(seed, case, trace, transition.after_state, *occurrence)
        }
    }
}
