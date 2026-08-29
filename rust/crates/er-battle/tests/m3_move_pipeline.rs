use std::cell::RefCell;
use std::error::Error;

use er_battle::ability::WONDER_GUARD_ABILITY_ID;
use er_battle::ability_pipeline::{
    DefensiveAbilityInput, DefensiveAbilityOutcome, evaluate_defensive_ability,
};
use er_battle::command::NormalizedBattleCommand;
use er_battle::damage::DamageInput;
use er_battle::move_effect::{
    DefensiveAbilityBlockReason, DefensiveAbilityGate, DefensiveAbilityGateError,
    DefensiveAbilityGateInput, DefensiveAbilityGateResult, DefensiveAbilityGateUnsupportedReason,
    MoveEffectError, NoDefensiveAbilityGate, TargetEffectDisposition, resolve_target_effect,
};
use er_battle::move_pipeline::{
    MovePipelineDisposition, MovePipelineError, TargetSelectionError, WrongCommandKind,
    resolve_move,
};
use er_battle::status::{ParalysisActivationOutcome, StatusApplicationOutcome, StatusRejection};
use er_content::moves::{MoveDefinition, find_move};
use er_content::pack::{ContentPack, selected_content_pack, selected_m4_content_pack};
use er_rng::audit::RngReason;
use er_rng::battle::{BattleRngState, RngRuntime};
use er_rng::phaser::{PhaserRdgState, RunRngState};
use er_state::battle::{BattleOutcome, BattleState, CommandCollectionState};
use er_state::conditions::{
    GlobalAbilitySuppressionState, TerrainKind, TerrainState, WeatherKind, WeatherState,
};
use er_state::field::{FieldSlotState, FieldState};
use er_state::format::{AdjacencyEdge, BattleFormat};
use er_state::pokemon::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonState, StatStages, StatusKind, StatusState,
};
use er_types::battle_ids::{
    AbilityId, BattleId, BattleSide, FaintOccurrenceId, FieldSlot, MoveId, MoveSlotIndex,
    PartyIndex, PokemonId, SpeciesId, TurnIndex, WaveIndex,
};
use er_types::battle_model::{BattleStat, MoveCategory, PokemonType, PokemonTyping};
use er_types::{OperationId, SafeU53, SeatId};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const PHYSICAL_RUN_STATE: &str = "!rnd,1,0.3811805066652596,0.9677629834040999,0.4383429931476712";
const ALWAYS_HIT_RUN_STATE: &str =
    "!rnd,1,0.18032378423959017,0.9995999033562839,0.20317641110159457";
const POISON_RUN_STATE: &str = "!rnd,1,0.8064481162000448,0.858695080736652,0.13650441309437156";
const FULL_STOP_RUN_STATE: &str = "!rnd,1,0.6266140460502356,0.847576079890132,0.8177344433497638";
const FULL_STOP_SAVED_SUBSTREAM: &str =
    "!rnd,1443036,0.583589319139719,0.47671497194096446,0.956423472147435";
const MISS_SAVED_SUBSTREAM: &str =
    "!rnd,1859127,0.5025886141229421,0.4581744347233325,0.6846395924221724";

fn safe(value: u64) -> TestResult<SafeU53> {
    Ok(SafeU53::new(value)?)
}

fn pokemon_id(value: u64) -> TestResult<PokemonId> {
    Ok(PokemonId::try_from_u64(value)?)
}

fn move_id(value: u64) -> TestResult<MoveId> {
    Ok(MoveId::try_from_u64(value)?)
}

fn species_id(value: u64) -> TestResult<SpeciesId> {
    Ok(SpeciesId::try_from_u64(value)?)
}

fn slot(side: BattleSide, position: u8) -> TestResult<FieldSlot> {
    Ok(FieldSlot::new(side, position)?)
}

fn status_state(kind: StatusKind) -> StatusState {
    StatusState {
        kind,
        toxic_turn_count: 0,
        sleep_turns_remaining: None,
    }
}

fn typing(primary: PokemonType, secondary: Option<PokemonType>) -> PokemonTyping {
    PokemonTyping { primary, secondary }
}

fn operation(name: &str) -> TestResult<OperationId> {
    Ok(OperationId::new(name.to_owned())?)
}

fn test_error(message: &'static str) -> std::io::Error {
    std::io::Error::other(message)
}

#[allow(clippy::too_many_arguments)]
fn pokemon(
    id: u64,
    side: BattleSide,
    types: PokemonTyping,
    status: StatusKind,
    hp: u32,
    max_hp: u32,
    attack_stage: i8,
    moves: &[u64],
    pp_used: u16,
) -> TestResult<PokemonState> {
    let mut move_slots = [None, None, None, None];
    for (index, value) in moves.iter().copied().enumerate() {
        let destination = move_slots
            .get_mut(index)
            .ok_or_else(|| test_error("test fixture exceeded four move slots"))?;
        *destination = Some(MoveSlotState {
            move_id: move_id(value)?,
            pp_used,
            pp_ups: 0,
            max_pp_override: None,
        });
    }

    Ok(PokemonState::new(
        pokemon_id(id)?,
        match side {
            BattleSide::Player => Some(SeatId::new(safe(1)?)),
            BattleSide::Enemy => None,
        },
        species_id(19)?,
        0,
        100,
        types,
        BattleStats {
            hp: max_hp,
            attack: 148,
            defense: 106,
            special_attack: 134,
            special_defense: 98,
            speed: 180,
        },
        hp,
        max_hp,
        status_state(status),
        StatStages {
            attack: attack_stage,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
            accuracy: 0,
            evasion: 0,
        },
        move_slots,
        AbilityLoadout {
            active: AbilityId::ZERO,
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        hp == 0,
    )?)
}

fn battle_with_format(
    format: BattleFormat,
    player_party: Vec<PokemonState>,
    enemy_party: Vec<PokemonState>,
    occupants: Vec<Option<PokemonId>>,
) -> TestResult<BattleState> {
    let canonical_slots = match (format.player_capacity, format.enemy_capacity) {
        (1, 1) => vec![slot(BattleSide::Player, 0)?, slot(BattleSide::Enemy, 0)?],
        (2, 2) => vec![
            slot(BattleSide::Player, 0)?,
            slot(BattleSide::Player, 1)?,
            slot(BattleSide::Enemy, 0)?,
            slot(BattleSide::Enemy, 1)?,
        ],
        _ => return Err(test_error("unsupported test battle format").into()),
    };
    if canonical_slots.len() != occupants.len() {
        return Err(test_error("test occupancy does not match format").into());
    }
    let field = FieldState::new_for_format(
        &format,
        canonical_slots
            .into_iter()
            .zip(occupants)
            .map(|(field_slot, occupant)| FieldSlotState::new(field_slot, occupant))
            .collect(),
    )?;
    let turn = TurnIndex::new(safe(1)?)?;
    Ok(BattleState {
        battle_id: BattleId::new(safe(1)?),
        wave: WaveIndex::new(safe(1)?)?,
        wave_seed: "m3-move-pipeline-test".to_owned(),
        turn,
        format,
        authority_seat: SeatId::new(safe(1)?),
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
        battle_rng: BattleRngState::new("m3-move-pipeline-battle", turn),
        command_state: CommandCollectionState::new(Vec::new(), Vec::new())?,
        faint_queue: Vec::new(),
        next_faint_occurrence: FaintOccurrenceId::ZERO,
        outcome: BattleOutcome::Ongoing,
    })
}

fn single_battle(
    actor: PokemonState,
    target: PokemonState,
    actor_occupant: Option<PokemonId>,
    target_occupant: Option<PokemonId>,
) -> TestResult<BattleState> {
    battle_with_format(
        BattleFormat::single(),
        vec![actor],
        vec![target],
        vec![actor_occupant, target_occupant],
    )
}

fn double_battle(
    actor: PokemonState,
    target_zero: PokemonState,
    target_one: PokemonState,
) -> TestResult<BattleState> {
    battle_with_format(
        BattleFormat::coop_double(),
        vec![actor],
        vec![target_zero, target_one],
        vec![
            Some(pokemon_id(1)?),
            None,
            Some(pokemon_id(2)?),
            Some(pokemon_id(3)?),
        ],
    )
}

fn fight_command(move_value: u64, targets: Vec<FieldSlot>) -> TestResult<NormalizedBattleCommand> {
    Ok(NormalizedBattleCommand::Fight {
        operation_id: operation(&format!("test/move/{move_value}"))?,
        actor: pokemon_id(1)?,
        field_slot: slot(BattleSide::Player, 0)?,
        move_slot: MoveSlotIndex::ZERO,
        move_id: move_id(move_value)?,
        targets,
    })
}

fn switch_command() -> TestResult<NormalizedBattleCommand> {
    Ok(NormalizedBattleCommand::Switch {
        operation_id: operation("test/switch")?,
        actor: pokemon_id(1)?,
        field_slot: slot(BattleSide::Player, 0)?,
        party_slot: PartyIndex::new(1)?,
        incoming: pokemon_id(3)?,
    })
}

fn runtime_with(
    battle_seed: &str,
    run_state: &str,
    saved_substream: Option<&str>,
) -> TestResult<RngRuntime> {
    let run = RunRngState {
        rdg: PhaserRdgState::from_state_string(run_state)?,
    };
    let turn = TurnIndex::new(safe(1)?)?;
    let mut battle = BattleRngState::new(battle_seed, turn);
    battle.saved_substream = saved_substream
        .map(PhaserRdgState::from_state_string)
        .transpose()?;
    Ok(RngRuntime::from_states(run, Some(battle))?)
}

fn runtime_for_seed(battle_seed: &str) -> TestResult<RngRuntime> {
    runtime_with(battle_seed, PHYSICAL_RUN_STATE, None)
}

fn move_definition(content: &ContentPack, value: u64) -> TestResult<MoveDefinition> {
    Ok(find_move(&content.moves, move_id(value)?)?.clone())
}

fn target_slot() -> TestResult<FieldSlot> {
    slot(BattleSide::Enemy, 0)
}

fn assert_reasons(runtime: &RngRuntime, expected: &[RngReason]) {
    let actual: Vec<RngReason> = runtime
        .audit_entries()
        .iter()
        .map(|entry| entry.reason)
        .collect();
    assert_eq!(actual.as_slice(), expected);
}

fn direct_effect<G: DefensiveAbilityGate>(
    content: &ContentPack,
    move_value: u64,
    actor: &PokemonState,
    target: PokemonState,
    runtime: RngRuntime,
    gate: &G,
) -> TestResult<(
    er_battle::move_effect::MoveTargetResult,
    PokemonState,
    RngRuntime,
)> {
    let mut target = target;
    let mut runtime = runtime;
    let result = resolve_target_effect(
        &mut runtime,
        actor,
        target_slot()?,
        &mut target,
        &move_definition(content, move_value)?,
        content,
        1,
        false,
        gate,
    )?;
    Ok((result, target, runtime))
}

#[derive(Clone, Copy, Debug)]
enum GateBehavior {
    Pass,
    Block,
    Error,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct GateCall {
    move_category: MoveCategory,
    move_type: PokemonType,
    target_slot: FieldSlot,
    target: PokemonId,
    effectiveness: er_battle::type_effectiveness::TypeEffectiveness,
    abilities_ignored: bool,
}

#[derive(Debug)]
struct RecordingGate {
    behavior: GateBehavior,
    calls: RefCell<Vec<GateCall>>,
}

impl RecordingGate {
    fn new(behavior: GateBehavior) -> Self {
        Self {
            behavior,
            calls: RefCell::new(Vec::new()),
        }
    }

    fn calls(&self) -> Vec<GateCall> {
        self.calls.borrow().clone()
    }
}

impl DefensiveAbilityGate for RecordingGate {
    fn evaluate(
        &self,
        input: DefensiveAbilityGateInput<'_>,
    ) -> Result<DefensiveAbilityGateResult, DefensiveAbilityGateError> {
        self.calls.borrow_mut().push(GateCall {
            move_category: input.move_category,
            move_type: input.move_type,
            target_slot: input.target_slot,
            target: input.target.id,
            effectiveness: input.effectiveness,
            abilities_ignored: input.abilities_ignored,
        });
        match self.behavior {
            GateBehavior::Pass => Ok(DefensiveAbilityGateResult::Pass),
            GateBehavior::Block => Ok(DefensiveAbilityGateResult::Blocked {
                ability: Some(AbilityId::ZERO),
                reason: DefensiveAbilityBlockReason::NonSuperEffectiveAttack,
            }),
            GateBehavior::Error => Err(DefensiveAbilityGateError::Unsupported {
                reason: DefensiveAbilityGateUnsupportedReason::UnsupportedAbilityEffect,
            }),
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct RealAbilityGate<'a> {
    content: &'a ContentPack,
}

impl DefensiveAbilityGate for RealAbilityGate<'_> {
    fn evaluate(
        &self,
        input: DefensiveAbilityGateInput<'_>,
    ) -> Result<DefensiveAbilityGateResult, DefensiveAbilityGateError> {
        let outcome = evaluate_defensive_ability(
            DefensiveAbilityInput {
                ability_id: input.target.abilities.active,
                ability_suppressed: input.target.abilities.active_suppressed,
                global_suppressed: input.abilities_ignored,
                move_category: input.move_category,
                type_effectiveness: input.effectiveness,
            },
            self.content,
        )
        .map_err(|_| DefensiveAbilityGateError::InvalidContext)?;
        Ok(match outcome {
            DefensiveAbilityOutcome::Passed { .. } => DefensiveAbilityGateResult::Pass,
            DefensiveAbilityOutcome::Blocked { ability_id, .. } => {
                DefensiveAbilityGateResult::Blocked {
                    ability: Some(ability_id),
                    reason: DefensiveAbilityBlockReason::NonSuperEffectiveAttack,
                }
            }
        })
    }
}

#[test]
fn fight_is_accepted_and_switch_is_typed_wrong_kind_without_mutation() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[1],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut battle = single_battle(actor, target, Some(pokemon_id(1)?), Some(pokemon_id(2)?))?;
    let mut runtime = runtime_with("KIWqW1vfLsjwb6GG", PHYSICAL_RUN_STATE, None)?;
    let command = fight_command(1, vec![target_slot()?])?;
    let result = resolve_move(
        &mut battle,
        &command,
        &content,
        &mut runtime,
        &NoDefensiveAbilityGate,
    )?;
    assert_eq!(result.disposition, MovePipelineDisposition::Executed);
    assert_eq!(result.pp_mutation.map(|mutation| mutation.after), Some(1));

    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[1],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut switch_battle =
        single_battle(actor, target, Some(pokemon_id(1)?), Some(pokemon_id(2)?))?;
    let before_battle = switch_battle.clone();
    let mut switch_runtime = runtime_for_seed("switch-battle")?;
    let before_runtime = switch_runtime.clone();
    let error = resolve_move(
        &mut switch_battle,
        &switch_command()?,
        &content,
        &mut switch_runtime,
        &NoDefensiveAbilityGate,
    )
    .err()
    .ok_or_else(|| test_error("switch unexpectedly entered move resolution"))?;
    assert!(matches!(
        error,
        MovePipelineError::WrongCommandKind(WrongCommandKind::Switch)
    ));
    assert_eq!(switch_battle, before_battle);
    assert_eq!(switch_runtime, before_runtime);
    Ok(())
}

#[test]
fn inactive_actor_skips_before_content_pp_and_rng() -> TestResult {
    let valid_content = selected_content_pack()?;
    let mut invalid_content = valid_content.clone();
    invalid_content.schema_version = 0;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[999],
        35,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut battle = single_battle(actor, target, None, Some(pokemon_id(2)?))?;
    let before_battle = battle.clone();
    let mut runtime = runtime_for_seed("inactive-actor")?;
    let before_runtime = runtime.clone();
    let result = resolve_move(
        &mut battle,
        &fight_command(999, vec![target_slot()?])?,
        &invalid_content,
        &mut runtime,
        &NoDefensiveAbilityGate,
    )?;
    assert_eq!(
        result.disposition,
        MovePipelineDisposition::SkippedActorInactive
    );
    assert!(result.pp_mutation.is_none());
    assert_eq!(battle, before_battle);
    assert_eq!(runtime, before_runtime);
    assert!(runtime.audit_entries().is_empty());
    Ok(())
}

#[test]
fn unusable_pp_rejection_is_typed_and_does_not_consume_rng() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[1],
        35,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut battle = single_battle(actor, target, Some(pokemon_id(1)?), Some(pokemon_id(2)?))?;
    let before_battle = battle.clone();
    let mut runtime = runtime_for_seed("pp-unusable")?;
    let before_runtime = runtime.clone();
    let expected_move_id = move_id(1)?;
    let error = resolve_move(
        &mut battle,
        &fight_command(1, vec![target_slot()?])?,
        &content,
        &mut runtime,
        &NoDefensiveAbilityGate,
    )
    .err()
    .ok_or_else(|| test_error("unusable PP unexpectedly executed"))?;
    assert!(matches!(
        error,
        MovePipelineError::PpUnavailable {
            move_id,
            pp_used: 35,
            max_pp: 35,
            ..
        } if move_id == expected_move_id
    ));
    assert_eq!(battle, before_battle);
    assert_eq!(runtime, before_runtime);
    assert!(runtime.audit_entries().is_empty());
    Ok(())
}

#[test]
fn paralysis_full_stop_happens_before_pp_and_only_commits_activation_draw() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::Paralysis,
        200,
        200,
        0,
        &[1],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut battle = single_battle(actor, target, Some(pokemon_id(1)?), Some(pokemon_id(2)?))?;
    let before_battle = battle.clone();
    let mut runtime = runtime_with(
        "Cr68377BkZCjiHsT",
        FULL_STOP_RUN_STATE,
        Some(FULL_STOP_SAVED_SUBSTREAM),
    )?;
    let result = resolve_move(
        &mut battle,
        &fight_command(1, vec![target_slot()?])?,
        &content,
        &mut runtime,
        &NoDefensiveAbilityGate,
    )?;
    assert_eq!(
        result.disposition,
        MovePipelineDisposition::CancelledByParalysis
    );
    assert_eq!(result.pp_mutation, None);
    assert!(matches!(
        result.paralysis,
        Some(ParalysisActivationOutcome::FullyParalyzed { draw })
            if draw == SafeU53::ZERO
    ));
    assert_eq!(battle, before_battle);
    assert_eq!(runtime.audit_entries().len(), 1);
    assert_reasons(&runtime, &[RngReason::ParalysisActivation]);
    Ok(())
}

#[test]
fn selected_physical_and_special_damage_execute_and_consume_pp_once() -> TestResult {
    let content = selected_content_pack()?;
    assert_eq!(
        move_definition(&content, 1)?.category,
        MoveCategory::Physical
    );
    assert_eq!(
        move_definition(&content, 351)?.category,
        MoveCategory::Special
    );

    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[1],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut physical_battle =
        single_battle(actor, target, Some(pokemon_id(1)?), Some(pokemon_id(2)?))?;
    let mut physical_runtime = runtime_with("KIWqW1vfLsjwb6GG", PHYSICAL_RUN_STATE, None)?;
    let physical = resolve_move(
        &mut physical_battle,
        &fight_command(1, vec![target_slot()?])?,
        &content,
        &mut physical_runtime,
        &NoDefensiveAbilityGate,
    )?;
    assert_eq!(physical.disposition, MovePipelineDisposition::Executed);
    assert_eq!(
        physical
            .pp_mutation
            .map(|mutation| (mutation.before, mutation.after)),
        Some((0, 1))
    );
    let [physical_target] = physical.targets.as_slice() else {
        return Err(test_error("physical move did not produce one target").into());
    };
    assert_eq!(
        physical_target.disposition,
        TargetEffectDisposition::Executed
    );
    assert!(physical_target.damage.is_some());
    assert!(physical_target.hp_mutation.is_some());
    assert_eq!(
        physical_battle.player_party[0].moves[0].map(|m| m.pp_used),
        Some(1)
    );
    assert_reasons(
        &physical_runtime,
        &[
            RngReason::Accuracy,
            RngReason::CriticalHit,
            RngReason::DamageVariance,
        ],
    );

    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[351],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Water, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut special_battle =
        single_battle(actor, target, Some(pokemon_id(1)?), Some(pokemon_id(2)?))?;
    let mut special_runtime = runtime_with("7kmfnITLsaH6sVd8", ALWAYS_HIT_RUN_STATE, None)?;
    let special = resolve_move(
        &mut special_battle,
        &fight_command(351, vec![target_slot()?])?,
        &content,
        &mut special_runtime,
        &NoDefensiveAbilityGate,
    )?;
    assert_eq!(special.disposition, MovePipelineDisposition::Executed);
    assert_eq!(special.pp_mutation.map(|mutation| mutation.after), Some(1));
    let [special_target] = special.targets.as_slice() else {
        return Err(test_error("special move did not produce one target").into());
    };
    let special_damage = special_target
        .damage
        .ok_or_else(|| test_error("special move did not produce damage"))?;
    assert_eq!(special_damage.effectiveness_multiplier, 2.0);
    assert!(special_target.hp_mutation.is_some());
    assert_reasons(
        &special_runtime,
        &[RngReason::CriticalHit, RngReason::DamageVariance],
    );
    Ok(())
}

#[test]
fn spread_multiplier_and_crit_variance_order_are_explicit() -> TestResult {
    let mut single_runtime = runtime_for_seed("spread-damage")?;
    let mut spread_runtime = single_runtime.clone();
    let single = DamageInput::new(100, MoveCategory::Physical, 40.0, 148.0, 106.0)
        .with_stab_multiplier(1.5)
        .calculate(&mut single_runtime)?;
    let spread = DamageInput::new(100, MoveCategory::Physical, 40.0, 148.0, 106.0)
        .with_stab_multiplier(1.5)
        .with_target_multiplier(0.75)
        .calculate(&mut spread_runtime)?;
    assert_eq!(single.variance, spread.variance);
    assert_eq!(spread.target_multiplier, 0.75);
    assert!(spread.damage <= single.damage);
    assert_reasons(&spread_runtime, &[RngReason::DamageVariance]);

    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut target = target;
    let mut runtime = runtime_with("KIWqW1vfLsjwb6GG", PHYSICAL_RUN_STATE, None)?;
    let gate = RecordingGate::new(GateBehavior::Pass);
    let result = resolve_target_effect(
        &mut runtime,
        &actor,
        target_slot()?,
        &mut target,
        &move_definition(&content, 1)?,
        &content,
        1,
        false,
        &gate,
    )?;
    assert_eq!(result.disposition, TargetEffectDisposition::Executed);
    assert!(result.critical.is_some());
    assert!(
        result
            .damage
            .is_some_and(|damage| damage.variance.is_some())
    );
    assert_reasons(
        &runtime,
        &[
            RngReason::Accuracy,
            RngReason::CriticalHit,
            RngReason::DamageVariance,
        ],
    );
    let calls = gate.calls();
    assert_eq!(calls.len(), 1);
    let [call] = calls.as_slice() else {
        return Err(test_error("defensive gate call was not recorded").into());
    };
    assert_eq!(call.move_category, MoveCategory::Physical);
    assert_eq!(call.move_type, PokemonType::Normal);
    assert_eq!(call.target_slot, target_slot()?);
    assert_eq!(call.target, pokemon_id(2)?);
    assert!(call.effectiveness.is_neutral());
    assert!(!call.abilities_ignored);
    Ok(())
}

#[test]
fn native_immunity_and_defensive_block_precede_all_later_random_draws() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let immune_target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Ground, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let before_target = immune_target.clone();
    let mut immune_target = immune_target;
    let mut immune_runtime = runtime_for_seed("native-immunity")?;
    let immune_before_runtime = immune_runtime.clone();
    let immune_gate = RecordingGate::new(GateBehavior::Block);
    let immune = resolve_target_effect(
        &mut immune_runtime,
        &actor,
        target_slot()?,
        &mut immune_target,
        &move_definition(&content, 351)?,
        &content,
        1,
        false,
        &immune_gate,
    )?;
    assert_eq!(
        immune.disposition,
        TargetEffectDisposition::NativeTypeImmune
    );
    assert_eq!(immune_target, before_target);
    assert_eq!(immune_runtime, immune_before_runtime);
    assert!(immune_runtime.audit_entries().is_empty());
    assert!(immune_gate.calls().is_empty());

    let blocked_target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let blocked_before_target = blocked_target.clone();
    let mut blocked_target = blocked_target;
    let mut blocked_runtime = runtime_for_seed("ability-block")?;
    let blocked_before_runtime = blocked_runtime.clone();
    let blocked_gate = RecordingGate::new(GateBehavior::Block);
    let blocked = resolve_target_effect(
        &mut blocked_runtime,
        &actor,
        target_slot()?,
        &mut blocked_target,
        &move_definition(&content, 1)?,
        &content,
        1,
        false,
        &blocked_gate,
    )?;
    assert_eq!(
        blocked.disposition,
        TargetEffectDisposition::DefensiveAbilityBlocked {
            ability: Some(AbilityId::ZERO),
            reason: DefensiveAbilityBlockReason::NonSuperEffectiveAttack,
        }
    );
    assert_eq!(blocked_target, blocked_before_target);
    assert_eq!(blocked_runtime, blocked_before_runtime);
    assert!(blocked_runtime.audit_entries().is_empty());
    assert_eq!(blocked_gate.calls().len(), 1);
    Ok(())
}

#[test]
fn miss_consumes_only_accuracy_and_always_hit_skips_accuracy() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let before_target = target.clone();
    let mut miss_target = target;
    let mut miss_runtime = runtime_with(
        "Uq64enRikQt0xgcb",
        "!rnd,1,0.2884788236115128,0.2677236401941627,0.32724559400230646",
        Some(MISS_SAVED_SUBSTREAM),
    )?;
    let miss_gate = RecordingGate::new(GateBehavior::Pass);
    let miss = resolve_target_effect(
        &mut miss_runtime,
        &actor,
        target_slot()?,
        &mut miss_target,
        &move_definition(&content, 77)?,
        &content,
        1,
        false,
        &miss_gate,
    )?;
    assert_eq!(miss.disposition, TargetEffectDisposition::Missed);
    assert!(miss.critical.is_none());
    assert!(miss.damage.is_none());
    assert_eq!(miss_target, before_target);
    assert_reasons(&miss_runtime, &[RngReason::Accuracy]);
    assert!(miss_gate.calls().is_empty());

    let always_target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Water, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut always_target = always_target;
    let mut always_runtime = runtime_with("7kmfnITLsaH6sVd8", ALWAYS_HIT_RUN_STATE, None)?;
    let always_gate = RecordingGate::new(GateBehavior::Pass);
    let always = resolve_target_effect(
        &mut always_runtime,
        &actor,
        target_slot()?,
        &mut always_target,
        &move_definition(&content, 351)?,
        &content,
        1,
        false,
        &always_gate,
    )?;
    assert_eq!(always.disposition, TargetEffectDisposition::Executed);
    assert!(
        always
            .accuracy
            .is_some_and(|accuracy| accuracy.draw().is_none())
    );
    assert_reasons(
        &always_runtime,
        &[RngReason::CriticalHit, RngReason::DamageVariance],
    );
    assert_eq!(always_gate.calls().len(), 1);
    Ok(())
}

#[test]
fn status_moves_bypass_type_chart_and_defensive_gate_then_apply_selected_statuses() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;

    let gate = RecordingGate::new(GateBehavior::Error);
    let (poison_result, poison_target, poison_runtime) = direct_effect(
        &content,
        77,
        &actor,
        pokemon(
            2,
            BattleSide::Enemy,
            typing(PokemonType::Ground, None),
            StatusKind::None,
            200,
            200,
            0,
            &[],
            0,
        )?,
        runtime_with("4PucwtNu01bY4OWX", POISON_RUN_STATE, None)?,
        &gate,
    )?;
    assert_eq!(poison_result.disposition, TargetEffectDisposition::Executed);
    assert!(matches!(
        poison_result.status_effects.as_slice(),
        [StatusApplicationOutcome::Applied { mutation }]
            if mutation.after.kind == StatusKind::Poison
    ));
    assert_eq!(poison_target.status.kind, StatusKind::Poison);
    assert_reasons(&poison_runtime, &[RngReason::Accuracy]);
    assert!(gate.calls().is_empty());

    let gate = RecordingGate::new(GateBehavior::Error);
    let (paralysis_result, paralysis_target, _) = direct_effect(
        &content,
        78,
        &actor,
        pokemon(
            2,
            BattleSide::Enemy,
            typing(PokemonType::Normal, None),
            StatusKind::None,
            200,
            200,
            0,
            &[],
            0,
        )?,
        runtime_for_seed("stun-spore")?,
        &gate,
    )?;
    assert!(matches!(
        paralysis_result.status_effects.as_slice(),
        [StatusApplicationOutcome::Applied { mutation }]
            if mutation.after.kind == StatusKind::Paralysis
    ));
    assert_eq!(paralysis_target.status.kind, StatusKind::Paralysis);
    assert!(gate.calls().is_empty());

    let gate = RecordingGate::new(GateBehavior::Pass);
    let (burn_result, burn_target, burn_runtime) = direct_effect(
        &content,
        52,
        &actor,
        pokemon(
            2,
            BattleSide::Enemy,
            typing(PokemonType::Normal, None),
            StatusKind::None,
            200,
            200,
            0,
            &[],
            0,
        )?,
        runtime_with("HfAYhMb5ofBnvpAa", POISON_RUN_STATE, None)?,
        &gate,
    )?;
    assert_eq!(burn_result.disposition, TargetEffectDisposition::Executed);
    assert!(burn_result.damage.is_some());
    assert!(matches!(
        burn_result.status_effects.as_slice(),
        [StatusApplicationOutcome::Applied { mutation }]
            if mutation.after.kind == StatusKind::Burn
    ));
    assert_eq!(burn_target.status.kind, StatusKind::Burn);
    assert_reasons(
        &burn_runtime,
        &[
            RngReason::Accuracy,
            RngReason::CriticalHit,
            RngReason::DamageVariance,
        ],
    );
    let calls = gate.calls();
    assert_eq!(calls.len(), 1);
    let [call] = calls.as_slice() else {
        return Err(test_error("Ember defensive gate call was not recorded").into());
    };
    assert_eq!(call.move_category, MoveCategory::Special);
    assert_eq!(call.move_type, PokemonType::Fire);
    assert_eq!(call.target_slot, target_slot()?);
    assert_eq!(call.target, pokemon_id(2)?);
    assert!(call.effectiveness.is_neutral());
    assert!(!call.abilities_ignored);
    Ok(())
}

#[test]
fn powder_type_and_existing_status_immunities_reject_without_target_mutation() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let cases = [
        (
            typing(PokemonType::Poison, None),
            StatusKind::None,
            StatusRejection::TypeImmunity {
                status: StatusKind::Poison,
                immune_type: PokemonType::Poison,
            },
        ),
        (
            typing(PokemonType::Grass, None),
            StatusKind::None,
            StatusRejection::PowderImmunity {
                immune_type: PokemonType::Grass,
            },
        ),
        (
            typing(PokemonType::Normal, None),
            StatusKind::Burn,
            StatusRejection::ExistingMajorStatus {
                existing: StatusKind::Burn,
            },
        ),
    ];
    for (types, status, expected_reason) in cases {
        let target = pokemon(2, BattleSide::Enemy, types, status, 200, 200, 0, &[], 0)?;
        let before_target = target.clone();
        let gate = RecordingGate::new(GateBehavior::Block);
        let (result, target, runtime) = direct_effect(
            &content,
            77,
            &actor,
            target,
            runtime_with("4PucwtNu01bY4OWX", POISON_RUN_STATE, None)?,
            &gate,
        )?;
        assert_eq!(result.disposition, TargetEffectDisposition::Executed);
        assert_eq!(
            result.status_effects.as_slice(),
            &[StatusApplicationOutcome::Rejected {
                reason: expected_reason,
            }]
        );
        assert_eq!(target, before_target);
        assert_reasons(&runtime, &[RngReason::Accuracy]);
        assert!(gate.calls().is_empty());
    }
    Ok(())
}

#[test]
fn play_nice_uses_canonical_spread_targets_and_stage_floor_noop() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[589],
        0,
    )?;
    let enemy_zero = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let enemy_one = pokemon(
        3,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut battle = double_battle(actor, enemy_zero, enemy_one)?;
    let mut runtime = runtime_with("7kmfnITLsaH6sVd8", ALWAYS_HIT_RUN_STATE, None)?;
    let command = fight_command(
        589,
        vec![slot(BattleSide::Enemy, 0)?, slot(BattleSide::Enemy, 1)?],
    )?;
    let result = resolve_move(
        &mut battle,
        &command,
        &content,
        &mut runtime,
        &NoDefensiveAbilityGate,
    )?;
    assert_eq!(result.targets.len(), 2);
    let [zero, one] = result.targets.as_slice() else {
        return Err(test_error("Play Nice did not resolve both canonical targets").into());
    };
    for target_result in [zero, one] {
        assert_eq!(target_result.disposition, TargetEffectDisposition::Executed);
        assert!(matches!(
            target_result.stat_stage_effects.as_slice(),
            [mutation]
                if mutation.stat == BattleStat::Attack
                    && mutation.before == 0
                    && mutation.after == -1
                    && mutation.changed
        ));
    }
    assert_eq!(battle.enemy_party[0].stat_stages.attack, -1);
    assert_eq!(battle.enemy_party[1].stat_stages.attack, -1);
    assert!(runtime.audit_entries().is_empty());

    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[589],
        0,
    )?;
    let enemy_zero = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        -6,
        &[],
        0,
    )?;
    let enemy_one = pokemon(
        3,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        -6,
        &[],
        0,
    )?;
    let mut floor_battle = double_battle(actor, enemy_zero, enemy_one)?;
    let mut floor_runtime = runtime_with("7kmfnITLsaH6sVd8", ALWAYS_HIT_RUN_STATE, None)?;
    let floor_result = resolve_move(
        &mut floor_battle,
        &fight_command(
            589,
            vec![slot(BattleSide::Enemy, 0)?, slot(BattleSide::Enemy, 1)?],
        )?,
        &content,
        &mut floor_runtime,
        &NoDefensiveAbilityGate,
    )?;
    let [floor_zero, floor_one] = floor_result.targets.as_slice() else {
        return Err(test_error("Play Nice floor case did not resolve both targets").into());
    };
    for target_result in [floor_zero, floor_one] {
        assert!(matches!(
            target_result.stat_stage_effects.as_slice(),
            [mutation]
                if mutation.before == -6
                    && mutation.after == -6
                    && !mutation.changed
        ));
    }
    assert_eq!(floor_battle.enemy_party[0].stat_stages.attack, -6);
    assert_eq!(floor_battle.enemy_party[1].stat_stages.attack, -6);
    assert!(floor_runtime.audit_entries().is_empty());
    Ok(())
}

#[test]
fn inactive_target_skips_without_draw_and_faint_request_has_no_occurrence_identity() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[351],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Water, None),
        StatusKind::None,
        0,
        200,
        0,
        &[],
        0,
    )?;
    let target_before = target.clone();
    let actor_for_direct = actor.clone();
    let mut inactive_target = target;
    let mut inactive_runtime = runtime_for_seed("inactive-target")?;
    let inactive_before_runtime = inactive_runtime.clone();
    let inactive = resolve_target_effect(
        &mut inactive_runtime,
        &actor_for_direct,
        target_slot()?,
        &mut inactive_target,
        &move_definition(&content, 351)?,
        &content,
        1,
        false,
        &NoDefensiveAbilityGate,
    )?;
    assert_eq!(
        inactive.disposition,
        TargetEffectDisposition::SkippedTargetInactive
    );
    assert_eq!(inactive_target, target_before);
    assert_eq!(inactive_runtime, inactive_before_runtime);
    assert!(inactive_runtime.audit_entries().is_empty());

    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[351],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Water, None),
        StatusKind::None,
        1,
        200,
        0,
        &[],
        0,
    )?;
    let mut battle = single_battle(actor, target, Some(pokemon_id(1)?), Some(pokemon_id(2)?))?;
    let mut runtime = runtime_with("7kmfnITLsaH6sVd8", ALWAYS_HIT_RUN_STATE, None)?;
    let result = resolve_move(
        &mut battle,
        &fight_command(351, vec![target_slot()?])?,
        &content,
        &mut runtime,
        &NoDefensiveAbilityGate,
    )?;
    let [target_result] = result.targets.as_slice() else {
        return Err(test_error("faint case did not produce one target").into());
    };
    let request = target_result
        .faint_request
        .ok_or_else(|| test_error("faint case did not produce a semantic request"))?;
    assert_eq!(request.pokemon, pokemon_id(2)?);
    assert_eq!(request.slot, target_slot()?);
    assert_eq!(request.source, pokemon_id(1)?);
    assert_eq!(request.move_id, move_id(351)?);
    assert_eq!(result.faint_requests, vec![request]);
    assert_eq!(battle.enemy_party[0].hp, 0);
    assert!(battle.enemy_party[0].fainted);
    assert!(battle.faint_queue.is_empty());
    assert_eq!(battle.next_faint_occurrence, FaintOccurrenceId::ZERO);
    assert_reasons(
        &runtime,
        &[RngReason::CriticalHit, RngReason::DamageVariance],
    );
    Ok(())
}

#[test]
fn unsupported_move_and_invalid_content_fail_closed_with_typed_errors() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[999],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut battle = single_battle(actor, target, Some(pokemon_id(1)?), Some(pokemon_id(2)?))?;
    let before_battle = battle.clone();
    let mut runtime = runtime_for_seed("unsupported-move")?;
    let before_runtime = runtime.clone();
    let expected_move_id = move_id(999)?;
    let unsupported = resolve_move(
        &mut battle,
        &fight_command(999, vec![target_slot()?])?,
        &content,
        &mut runtime,
        &NoDefensiveAbilityGate,
    )
    .err()
    .ok_or_else(|| test_error("unsupported move unexpectedly resolved"))?;
    assert!(matches!(
        unsupported,
        MovePipelineError::UnsupportedMove { move_id } if move_id == expected_move_id
    ));
    assert_eq!(battle, before_battle);
    assert_eq!(runtime, before_runtime);

    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[1],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut invalid_content = content.clone();
    invalid_content.schema_version = 0;
    let mut invalid_battle =
        single_battle(actor, target, Some(pokemon_id(1)?), Some(pokemon_id(2)?))?;
    let invalid_before_battle = invalid_battle.clone();
    let mut invalid_runtime = runtime_for_seed("invalid-content")?;
    let invalid_before_runtime = invalid_runtime.clone();
    let invalid = resolve_move(
        &mut invalid_battle,
        &fight_command(1, vec![target_slot()?])?,
        &invalid_content,
        &mut invalid_runtime,
        &NoDefensiveAbilityGate,
    )
    .err()
    .ok_or_else(|| test_error("invalid content unexpectedly resolved"))?;
    assert!(matches!(
        invalid,
        MovePipelineError::Content(er_content::pack::ContentPackError::SchemaVersionMismatch {
            expected: 1,
            actual: 0,
        })
    ));
    assert_eq!(invalid_battle, invalid_before_battle);
    assert_eq!(invalid_runtime, invalid_before_runtime);

    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let target_before = target.clone();
    let mut direct_runtime = runtime_for_seed("invalid-definition")?;
    let direct_before_runtime = direct_runtime.clone();
    let mut invalid_definition = move_definition(&content, 1)?;
    invalid_definition.id = move_id(999)?;
    let direct = resolve_target_effect(
        &mut direct_runtime,
        &actor,
        target_slot()?,
        &mut target,
        &invalid_definition,
        &content,
        1,
        false,
        &NoDefensiveAbilityGate,
    )
    .err()
    .ok_or_else(|| test_error("invalid move definition unexpectedly resolved"))?;
    assert!(matches!(
        direct,
        MoveEffectError::InvalidMoveDefinition { .. }
    ));
    assert_eq!(target, target_before);
    assert_eq!(direct_runtime, direct_before_runtime);
    Ok(())
}

#[test]
fn defensive_gate_error_is_typed_and_atomic_for_battle_and_rng() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[1],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut battle = single_battle(actor, target, Some(pokemon_id(1)?), Some(pokemon_id(2)?))?;
    let before_battle = battle.clone();
    let mut runtime = runtime_with("KIWqW1vfLsjwb6GG", PHYSICAL_RUN_STATE, None)?;
    let before_runtime = runtime.clone();
    let gate = RecordingGate::new(GateBehavior::Error);
    let error = resolve_move(
        &mut battle,
        &fight_command(1, vec![target_slot()?])?,
        &content,
        &mut runtime,
        &gate,
    )
    .err()
    .ok_or_else(|| test_error("defensive gate error unexpectedly passed"))?;
    assert!(matches!(
        error,
        MovePipelineError::Effect(MoveEffectError::DefensiveAbility(
            DefensiveAbilityGateError::Unsupported {
                reason: DefensiveAbilityGateUnsupportedReason::UnsupportedAbilityEffect,
            }
        ))
    ));
    assert_eq!(battle, before_battle);
    assert_eq!(runtime, before_runtime);
    assert!(runtime.audit_entries().is_empty());
    assert_eq!(gate.calls().len(), 1);
    Ok(())
}

#[test]
fn target_selection_failure_is_typed_and_atomic_before_pp_or_rng() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[1],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut battle = single_battle(actor, target, Some(pokemon_id(1)?), Some(pokemon_id(2)?))?;
    let before_battle = battle.clone();
    let mut runtime = runtime_for_seed("empty-targets")?;
    let before_runtime = runtime.clone();
    let error = resolve_move(
        &mut battle,
        &fight_command(1, Vec::new())?,
        &content,
        &mut runtime,
        &NoDefensiveAbilityGate,
    )
    .err()
    .ok_or_else(|| test_error("empty target selection unexpectedly resolved"))?;
    assert!(matches!(
        error,
        MovePipelineError::TargetSelection(TargetSelectionError::Empty)
    ));
    assert_eq!(battle, before_battle);
    assert_eq!(runtime, before_runtime);
    assert!(runtime.audit_entries().is_empty());
    Ok(())
}

#[test]
fn target_slot_outside_format_is_typed_and_atomic_before_pp_or_rng() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[1],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut battle = single_battle(actor, target, Some(pokemon_id(1)?), Some(pokemon_id(2)?))?;
    let before_battle = battle.clone();
    let mut runtime = runtime_for_seed("outside-format-target")?;
    let before_runtime = runtime.clone();
    let invalid_slot = slot(BattleSide::Enemy, 1)?;
    let error = resolve_move(
        &mut battle,
        &fight_command(1, vec![invalid_slot])?,
        &content,
        &mut runtime,
        &NoDefensiveAbilityGate,
    )
    .err()
    .ok_or_else(|| test_error("outside-format target unexpectedly resolved"))?;
    assert!(matches!(
        error,
        MovePipelineError::TargetSelection(TargetSelectionError::SlotOutsideCapacity { slot })
            if slot == invalid_slot
    ));
    assert_eq!(battle, before_battle);
    assert_eq!(runtime, before_runtime);
    assert!(runtime.audit_entries().is_empty());
    Ok(())
}

#[test]
fn near_other_rejects_empty_and_nonadjacent_targets_before_pp_or_rng() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[1],
        0,
    )?;
    let enemy_zero = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let enemy_one = pokemon(
        3,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let rejected_slot = slot(BattleSide::Enemy, 1)?;

    let mut empty = double_battle(actor.clone(), enemy_zero.clone(), enemy_one.clone())?;
    empty
        .field
        .slots
        .iter_mut()
        .find(|entry| entry.slot == rejected_slot)
        .ok_or_else(|| test_error("missing empty-target fixture slot"))?
        .occupant = None;
    let before_empty = empty.clone();
    let mut empty_runtime = runtime_for_seed("empty-near-other-target")?;
    let before_empty_runtime = empty_runtime.clone();
    let empty_error = resolve_move(
        &mut empty,
        &fight_command(1, vec![rejected_slot])?,
        &content,
        &mut empty_runtime,
        &NoDefensiveAbilityGate,
    )
    .err()
    .ok_or_else(|| test_error("empty near-other target unexpectedly resolved"))?;
    assert!(matches!(
        empty_error,
        MovePipelineError::TargetSelection(TargetSelectionError::NearOtherNotCanonical {
            slot,
        }) if slot == rejected_slot
    ));
    assert_eq!(empty, before_empty);
    assert_eq!(empty_runtime, before_empty_runtime);
    assert!(empty_runtime.audit_entries().is_empty());

    let actor_slot = slot(BattleSide::Player, 0)?;
    let adjacent_target = slot(BattleSide::Enemy, 0)?;
    let nonadjacent_format =
        BattleFormat::new(2, 2, vec![AdjacencyEdge::new(actor_slot, adjacent_target)?])?;
    let mut nonadjacent = battle_with_format(
        nonadjacent_format,
        vec![actor],
        vec![enemy_zero, enemy_one],
        vec![
            Some(pokemon_id(1)?),
            None,
            Some(pokemon_id(2)?),
            Some(pokemon_id(3)?),
        ],
    )?;
    let before_nonadjacent = nonadjacent.clone();
    let mut nonadjacent_runtime = runtime_for_seed("nonadjacent-near-other-target")?;
    let before_nonadjacent_runtime = nonadjacent_runtime.clone();
    let nonadjacent_error = resolve_move(
        &mut nonadjacent,
        &fight_command(1, vec![rejected_slot])?,
        &content,
        &mut nonadjacent_runtime,
        &NoDefensiveAbilityGate,
    )
    .err()
    .ok_or_else(|| test_error("nonadjacent near-other target unexpectedly resolved"))?;
    assert!(matches!(
        nonadjacent_error,
        MovePipelineError::TargetSelection(TargetSelectionError::NearOtherNotCanonical {
            slot,
        }) if slot == rejected_slot
    ));
    assert_eq!(nonadjacent, before_nonadjacent);
    assert_eq!(nonadjacent_runtime, before_nonadjacent_runtime);
    assert!(nonadjacent_runtime.audit_entries().is_empty());
    Ok(())
}

#[test]
fn near_other_rejects_zero_hp_nonfainted_target_before_pp_or_rng() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[1],
        0,
    )?;
    let enemy_zero = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let enemy_one = pokemon(
        3,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let rejected_slot = slot(BattleSide::Enemy, 1)?;
    let mut battle = double_battle(actor, enemy_zero, enemy_one)?;
    battle.enemy_party[1].hp = 0;
    assert!(!battle.enemy_party[1].fainted);

    let before_battle = battle.clone();
    let mut runtime = runtime_for_seed("zero-hp-near-other-target")?;
    let before_runtime = runtime.clone();
    let error = resolve_move(
        &mut battle,
        &fight_command(1, vec![rejected_slot])?,
        &content,
        &mut runtime,
        &NoDefensiveAbilityGate,
    )
    .err()
    .ok_or_else(|| test_error("zero-HP near-other target unexpectedly resolved"))?;
    assert!(matches!(
        error,
        MovePipelineError::TargetSelection(TargetSelectionError::NearOtherNotCanonical {
            slot,
        }) if slot == rejected_slot
    ));
    assert_eq!(battle, before_battle);
    assert_eq!(runtime, before_runtime);
    assert!(runtime.audit_entries().is_empty());
    Ok(())
}

#[test]
fn near_other_accepts_one_canonical_adjacent_ally() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[1],
        0,
    )?;
    let mut ally = pokemon(
        4,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    ally.owner_seat = Some(SeatId::new(safe(2)?));
    let enemy_zero = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let enemy_one = pokemon(
        3,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let ally_slot = slot(BattleSide::Player, 1)?;
    let mut battle = battle_with_format(
        BattleFormat::coop_double(),
        vec![actor, ally],
        vec![enemy_zero, enemy_one],
        vec![
            Some(pokemon_id(1)?),
            Some(pokemon_id(4)?),
            Some(pokemon_id(2)?),
            Some(pokemon_id(3)?),
        ],
    )?;
    let ally_hp_before = battle.player_party[1].hp;
    let mut runtime = runtime_for_seed("adjacent-ally-near-other")?;
    let result = resolve_move(
        &mut battle,
        &fight_command(1, vec![ally_slot])?,
        &content,
        &mut runtime,
        &NoDefensiveAbilityGate,
    )?;
    assert_eq!(result.disposition, MovePipelineDisposition::Executed);
    assert_eq!(result.targets.len(), 1);
    assert_eq!(result.targets[0].slot, ally_slot);
    assert!(battle.player_party[1].hp < ally_hp_before);
    assert!(result.pp_mutation.is_some());
    Ok(())
}

#[test]
fn incomplete_play_nice_spread_is_typed_and_atomic_before_pp_or_rng() -> TestResult {
    let content = selected_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[589],
        0,
    )?;
    let enemy_zero = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let enemy_one = pokemon(
        3,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let mut battle = double_battle(actor, enemy_zero, enemy_one)?;
    let before_battle = battle.clone();
    let mut runtime = runtime_for_seed("incomplete-play-nice")?;
    let before_runtime = runtime.clone();
    let error = resolve_move(
        &mut battle,
        &fight_command(589, vec![slot(BattleSide::Enemy, 0)?])?,
        &content,
        &mut runtime,
        &NoDefensiveAbilityGate,
    )
    .err()
    .ok_or_else(|| test_error("incomplete Play Nice spread unexpectedly resolved"))?;
    assert!(matches!(
        error,
        MovePipelineError::TargetSelection(TargetSelectionError::AllEnemiesNotCanonical)
    ));
    assert_eq!(battle, before_battle);
    assert_eq!(runtime, before_runtime);
    assert!(runtime.audit_entries().is_empty());
    Ok(())
}

#[test]
fn direct_invalid_content_is_typed_and_atomic_before_rng_or_target_mutation() -> TestResult {
    let content = selected_content_pack()?;
    let mut invalid_content = content.clone();
    invalid_content.schema_version = 0;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let target_before = target.clone();
    let mut target = target;
    let mut runtime = runtime_for_seed("direct-invalid-content")?;
    let before_runtime = runtime.clone();
    let error = resolve_target_effect(
        &mut runtime,
        &actor,
        target_slot()?,
        &mut target,
        &move_definition(&content, 1)?,
        &invalid_content,
        1,
        false,
        &NoDefensiveAbilityGate,
    )
    .err()
    .ok_or_else(|| test_error("direct invalid content unexpectedly resolved"))?;
    assert!(matches!(
        error,
        MoveEffectError::Content(er_content::pack::ContentPackError::SchemaVersionMismatch {
            expected: 1,
            actual: 0,
        })
    ));
    assert_eq!(target, target_before);
    assert_eq!(runtime, before_runtime);
    assert!(runtime.audit_entries().is_empty());
    Ok(())
}

#[test]
fn real_ability_adapter_blocks_wonder_guard_neutral_and_passes_super_effective() -> TestResult {
    let content = selected_content_pack()?;

    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[1],
        0,
    )?;
    let mut target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    target.abilities.active = WONDER_GUARD_ABILITY_ID;
    let mut neutral_battle =
        single_battle(actor, target, Some(pokemon_id(1)?), Some(pokemon_id(2)?))?;
    let mut neutral_runtime = runtime_with("wonder-guard-neutral", PHYSICAL_RUN_STATE, None)?;
    let neutral_target_before = neutral_battle.enemy_party[0].clone();
    let neutral_runtime_before = neutral_runtime.clone();
    let neutral_gate = RealAbilityGate { content: &content };
    let neutral = resolve_move(
        &mut neutral_battle,
        &fight_command(1, vec![target_slot()?])?,
        &content,
        &mut neutral_runtime,
        &neutral_gate,
    )?;
    let [neutral_target] = neutral.targets.as_slice() else {
        return Err(test_error("Wonder Guard neutral case did not produce one target").into());
    };
    assert_eq!(
        neutral_target.disposition,
        TargetEffectDisposition::DefensiveAbilityBlocked {
            ability: Some(WONDER_GUARD_ABILITY_ID),
            reason: DefensiveAbilityBlockReason::NonSuperEffectiveAttack,
        }
    );
    assert!(neutral_target.hp_mutation.is_none());
    assert_eq!(neutral_battle.enemy_party[0], neutral_target_before);
    assert_eq!(
        neutral_battle.player_party[0].moves[0]
            .as_ref()
            .ok_or_else(|| test_error("neutral Wonder Guard actor lost its move slot"))?
            .pp_used,
        1
    );
    assert_eq!(neutral_runtime, neutral_runtime_before);
    assert!(neutral_runtime.audit_entries().is_empty());

    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[351],
        0,
    )?;
    let mut target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Water, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    target.abilities.active = WONDER_GUARD_ABILITY_ID;
    let mut super_battle =
        single_battle(actor, target, Some(pokemon_id(1)?), Some(pokemon_id(2)?))?;
    let mut super_runtime =
        runtime_with("wonder-guard-super-effective", ALWAYS_HIT_RUN_STATE, None)?;
    let super_gate = RealAbilityGate { content: &content };
    let super_effective = resolve_move(
        &mut super_battle,
        &fight_command(351, vec![target_slot()?])?,
        &content,
        &mut super_runtime,
        &super_gate,
    )?;
    let [super_target] = super_effective.targets.as_slice() else {
        return Err(
            test_error("Wonder Guard super-effective case did not produce one target").into(),
        );
    };
    assert_eq!(super_target.disposition, TargetEffectDisposition::Executed);
    assert_eq!(
        super_target
            .effectiveness
            .map(|effectiveness| effectiveness.multiplier),
        Some(er_battle::type_effectiveness::EffectivenessMultiplier::Two)
    );
    assert_eq!(
        super_target.defensive_gate,
        Some(DefensiveAbilityGateResult::Pass)
    );
    assert!(super_target.hp_mutation.is_some());
    assert_reasons(
        &super_runtime,
        &[RngReason::CriticalHit, RngReason::DamageVariance],
    );
    Ok(())
}

#[test]
fn m4_hyper_fang_flinch_is_audited_and_marked_for_later_action_cancellation() -> TestResult {
    let content = selected_m4_content_pack()?;
    let actor = pokemon(
        1,
        BattleSide::Player,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let base_target = pokemon(
        2,
        BattleSide::Enemy,
        typing(PokemonType::Normal, None),
        StatusKind::None,
        200,
        200,
        0,
        &[],
        0,
    )?;
    let gate = RecordingGate::new(GateBehavior::Pass);
    let mut flinch_seed = None;
    for index in 0..512 {
        let seed = format!("m4-hyper-fang-{index}");
        let mut runtime = runtime_for_seed(&seed)?;
        let mut target = base_target.clone();
        let result = resolve_target_effect(
            &mut runtime,
            &actor,
            target_slot()?,
            &mut target,
            &move_definition(&content, 158)?,
            &content,
            1,
            false,
            &gate,
        )?;
        if result.flinched {
            assert!(
                runtime
                    .audit_entries()
                    .iter()
                    .any(|draw| draw.reason == RngReason::SecondaryEffect)
            );
            flinch_seed = Some(seed);
            break;
        }
    }
    assert!(
        flinch_seed.is_some(),
        "no deterministic Hyper Fang flinch found in 512 seeds"
    );
    Ok(())
}
