//! Contract tests for the production local-battle lifecycle adapter.
//!
//! The source module is included with small public-module aliases because the
//! isolated C05 lane does not yet expose `local_battle` from the integration
//! crate root. The exercised implementation is still the owned production
//! source; there is no test-only runtime or resolver implementation.

mod internal_event {
    pub use er_game::internal_event::*;
}
mod material {
    pub use er_game::material::*;
}
mod runtime {
    pub use er_game::runtime::*;
}

#[path = "../src/local_battle.rs"]
mod local_battle;

use std::error::Error;
use std::sync::Arc;

use er_content::pack::selected_content_pack;
use er_game::internal_event::UiEventPayload;
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::digest::MechanicalStateDigest;
use er_state::pokemon::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonState, StatStages, StatusState,
};
use er_state::snapshot::GameState;
use er_types::SafeU53;
use er_types::SeatId;
use er_types::battle_command::{
    BattleCommand, BattleCommandProposalV1, BattleTargetSelection, CommandAdmissionSource,
    CommandFrontierStatus, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
    player_command_operation_id, scripted_enemy_command_operation_id,
};
use er_types::battle_control::BattleControl;
use er_types::battle_ids::{
    AbilityId, AuthorityEpoch, BattleId, BattleSide, FieldSlot, GameModeId, MoveSlotIndex,
    PartyIndex, PokemonId, TurnIndex, WaveIndex,
};

use local_battle::{
    BATTLE_START_SCHEMA_VERSION, BattleGameConfig, BattleStartV1, LocalBattleError,
    LocalBattleProgress, LocalBattleRequest, reduce_local_request,
};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const LOCAL_SOURCE: &str = include_str!("../src/local_battle.rs");
const RUNTIME_SOURCE: &str = include_str!("../src/runtime.rs");
const MATERIAL_SOURCE: &str = include_str!("../src/material.rs");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value must fit in a safe integer")
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn pokemon_id(value: u64) -> PokemonId {
    PokemonId::new(safe(value))
}

fn single_party_pokemon(id: u64, owner_seat: Option<SeatId>) -> TestResult<PokemonState> {
    let content = selected_content_pack()?;
    let species = content
        .species
        .first()
        .ok_or("selected content has no species")?;
    let move_id = content
        .moves
        .first()
        .ok_or("selected content has no moves")?
        .id;
    Ok(PokemonState::new(
        pokemon_id(id),
        owner_seat,
        species.id,
        0,
        25,
        species.base_types,
        BattleStats {
            hp: 100,
            attack: 100,
            defense: 100,
            special_attack: 100,
            special_defense: 100,
            speed: 100,
        },
        100,
        100,
        StatusState {
            kind: er_types::battle_model::StatusKind::None,
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
                move_id,
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

fn run_state() -> TestResult<GameState> {
    let content = selected_content_pack()?;
    Ok(GameState::new(
        content.hash,
        GameModeId::new(safe(1)),
        WaveIndex::new(safe(1))?,
        BattleId::new(safe(1)),
        RunRngState {
            rdg: PhaserRdg::from_seed("m3-local-lifecycle").state(),
        },
        None,
    )?)
}

fn valid_config() -> TestResult<BattleGameConfig> {
    let battle_id = BattleId::new(safe(1));
    let wave = WaveIndex::new(safe(1))?;
    let turn = TurnIndex::new(safe(1))?;
    let enemy_slot = FieldSlot::new(BattleSide::Enemy, 0)?;
    let enemy_command = BattleCommand::fight(
        pokemon_id(2),
        MoveSlotIndex::ZERO,
        BattleTargetSelection::implicit(),
    )?;
    let enemy_operation =
        scripted_enemy_command_operation_id(battle_id, wave, turn, enemy_slot, safe(0))?;
    let enemy_script = ScriptedEnemyBattleCommandV1::new(
        enemy_operation,
        battle_id,
        wave,
        turn,
        safe(0),
        pokemon_id(2),
        enemy_slot,
        enemy_command,
    )?;
    let next_turn = TurnIndex::new(safe(2))?;
    let next_operation =
        scripted_enemy_command_operation_id(battle_id, wave, next_turn, enemy_slot, safe(1))?;
    let next_enemy_script = ScriptedEnemyBattleCommandV1::new(
        next_operation,
        battle_id,
        wave,
        next_turn,
        safe(1),
        pokemon_id(2),
        enemy_slot,
        BattleCommand::fight(
            pokemon_id(2),
            MoveSlotIndex::ZERO,
            BattleTargetSelection::implicit(),
        )?,
    )?;
    Ok(BattleGameConfig {
        run_state: run_state()?,
        start: BattleStartV1 {
            schema_version: BATTLE_START_SCHEMA_VERSION,
            format: er_state::format::BattleFormat::single(),
            player_party: vec![single_party_pokemon(1, Some(seat(1)))?],
            enemy_party: vec![single_party_pokemon(2, None)?],
            player_leads: vec![PartyIndex::ZERO],
            enemy_leads: vec![PartyIndex::ZERO],
        },
        local_seat: seat(1),
        wave_seed: "m3-local-lifecycle-wave".to_owned(),
        scripted_enemy_policy: ScriptedEnemyPolicyV1::new(
            safe(0),
            vec![enemy_script, next_enemy_script],
        )?,
    })
}

fn runtime_with_live_command() -> TestResult<er_game::runtime::GameRuntime> {
    let content = selected_content_pack()?;
    let mut runtime =
        er_game::runtime::GameRuntime::new_battle(valid_config()?, Arc::new(content))?;
    let payload = {
        let seat = runtime.local_seat();
        let control = runtime
            .control()
            .seat(seat)
            .ok_or("local seat has no command-root control")?;
        let BattleControl::CommandRoot(root) = &control.control else {
            return Err("fresh runtime did not expose a command-root control".into());
        };
        UiEventPayload::activate(
            seat,
            root.menu.instance_id,
            root.menu.control_id.clone(),
            root.menu.selected_option_id.clone(),
        )
    };
    if !matches!(
        runtime.reduce_ui(payload)?,
        er_game::runtime::BattleUiResult::ControlChanged
    ) {
        return Err("Fight activation did not open the live move control".into());
    }
    Ok(runtime)
}

fn live_command_request(
    runtime: &er_game::runtime::GameRuntime,
) -> TestResult<BattleCommandProposalV1> {
    let seat = runtime.local_seat();
    let control = runtime
        .control()
        .seat(seat)
        .ok_or("local seat has no control")?;
    let BattleControl::MoveSelect(move_control) = &control.control else {
        return Err("runtime did not expose the activated move control".into());
    };
    let battle = runtime
        .state()
        .battle
        .as_ref()
        .ok_or("fresh runtime has no active battle")?;
    let operation_id = player_command_operation_id(
        battle.battle_id,
        battle.wave,
        battle.turn,
        move_control.field_slot,
        seat,
    )?;
    Ok(BattleCommandProposalV1::new(
        operation_id,
        battle.battle_id,
        battle.wave,
        battle.turn,
        seat,
        move_control.actor,
        move_control.field_slot,
        BattleCommand::fight(
            move_control.actor,
            MoveSlotIndex::ZERO,
            BattleTargetSelection::implicit(),
        )?,
        move_control.menu.instance_id,
        move_control.menu.control_id.clone(),
    )?)
}

#[test]
fn local_lane_has_one_canonical_runtime_boundary() {
    assert!(!LOCAL_SOURCE.contains("struct BattleGameConfig"));
    assert!(!LOCAL_SOURCE.contains("struct BattleStartV1"));
    assert!(!LOCAL_SOURCE.contains("LocalBattleConfigError"));
    assert!(!LOCAL_SOURCE.contains("struct BattleTurnMaterialV1"));
    assert!(!LOCAL_SOURCE.contains("struct BattleReplacementMaterialV1"));
    assert!(LOCAL_SOURCE.contains("pub(crate) use crate::runtime::{"));
    assert!(LOCAL_SOURCE.contains("BattleGameConfig"));
    assert!(RUNTIME_SOURCE.contains("pub wave_seed: String"));
    assert!(LOCAL_SOURCE.contains("LocalBattleRuntimeAdapter"));
    assert!(LOCAL_SOURCE.contains("PreparedBattleResolution"));
    assert!(LOCAL_SOURCE.contains("GameIntent::CommandProposal"));
    assert!(LOCAL_SOURCE.contains("GameIntent::ReplacementProposal"));
    assert!(LOCAL_SOURCE.contains("encode_turn_material"));
    assert!(LOCAL_SOURCE.contains("decode_turn_material"));
    assert!(LOCAL_SOURCE.contains("encode_replacement_material"));
    assert!(LOCAL_SOURCE.contains("decode_replacement_material"));
    assert!(LOCAL_SOURCE.contains("apply_turn_material"));
    assert!(LOCAL_SOURCE.contains("apply_replacement_material"));
    assert!(LOCAL_SOURCE.contains("install_resolution"));
    assert!(!LOCAL_SOURCE.contains("install_material("));
    assert!(LOCAL_SOURCE.contains("candidate_after_state != self.applied_after_state"));
    assert!(LOCAL_SOURCE.contains("candidate_control != self.applied_control"));
    assert!(!LOCAL_SOURCE.contains("trait LocalBattleRuntime"));
    assert!(!LOCAL_SOURCE.contains("resolve_turn("));
    assert!(!LOCAL_SOURCE.contains("resolve_replacement("));
    assert!(RUNTIME_SOURCE.contains("resolve_turn_trusted_with_finalizer"));
    assert!(!RUNTIME_SOURCE.contains("finalize_turn_frontier"));
    assert!(!LOCAL_SOURCE.contains("serde_json"));
    assert!(MATERIAL_SOURCE.contains("pub fn encode_turn_material"));
    assert!(MATERIAL_SOURCE.contains("pub fn decode_turn_material"));
    assert!(MATERIAL_SOURCE.contains("pub fn apply_turn_material"));
}

#[test]
fn canonical_runtime_config_carries_the_exact_wave_seed() -> TestResult {
    let mut runtime = runtime_with_live_command()?;
    let battle = runtime
        .state()
        .battle
        .as_ref()
        .ok_or("runtime constructor did not create a battle")?;
    assert_eq!(battle.wave_seed, "m3-local-lifecycle-wave");
    assert_eq!(runtime.local_seat(), seat(1));

    let request = live_command_request(&runtime)?;
    let before = runtime.clone();
    let mut invalid = request;
    invalid.control_id = "not-the-live-control".to_owned();
    assert!(matches!(
        reduce_local_request(
            &mut runtime,
            LocalBattleRequest::Command(invalid),
            AuthorityEpoch::new(safe(1)),
        ),
        Err(LocalBattleError::Runtime(_))
    ));
    assert_eq!(runtime, before, "a failed local stage must be atomic");
    Ok(())
}

#[test]
fn real_local_command_crosses_runtime_resolution_and_material_boundary() -> TestResult {
    let mut runtime = runtime_with_live_command()?;
    let request = live_command_request(&runtime)?;
    let progress = reduce_local_request(
        &mut runtime,
        LocalBattleRequest::Command(request),
        AuthorityEpoch::new(safe(1)),
    )?;
    let LocalBattleProgress::MaterialInstalled(material) = progress else {
        return Err("the complete single-seat command frontier must install material".into());
    };
    material.validate()?;
    assert_eq!(material.kind, local_battle::LocalMaterialKind::Turn);
    assert_eq!(runtime.state(), &material.applied_after_state);
    assert_eq!(runtime.control(), &material.applied_control);
    assert_eq!(
        material.candidate_next_decision,
        er_battle::BattleNextDecision::CommandFrontier
    );
    assert_eq!(
        material.candidate_after_digest,
        MechanicalStateDigest::compute(&material.candidate_after_state)?
    );
    let after_battle = material
        .candidate_after_state
        .battle
        .as_ref()
        .ok_or("candidate after-state has no battle")?;
    assert_eq!(after_battle.command_state.frontier.len(), 2);
    let player_entry = after_battle
        .command_state
        .frontier
        .iter()
        .find(|entry| entry.owner_seat == Some(seat(1)))
        .ok_or("finalized frontier is missing the player entry")?;
    assert!(matches!(
        &player_entry.status,
        CommandFrontierStatus::Pending
    ));
    assert_eq!(
        player_entry.operation_id,
        player_command_operation_id(
            after_battle.battle_id,
            after_battle.wave,
            after_battle.turn,
            player_entry.field_slot,
            seat(1),
        )?
    );
    let enemy_entry = after_battle
        .command_state
        .frontier
        .iter()
        .find(|entry| entry.owner_seat.is_none())
        .ok_or("finalized frontier is missing the scripted enemy entry")?;
    assert!(matches!(
        &enemy_entry.status,
        CommandFrontierStatus::Admitted {
            source: CommandAdmissionSource::ScriptedEnemy,
            ..
        }
    ));
    assert_eq!(
        enemy_entry.operation_id,
        scripted_enemy_command_operation_id(
            after_battle.battle_id,
            after_battle.wave,
            after_battle.turn,
            enemy_entry.field_slot,
            safe(1),
        )?
    );
    Ok(())
}

#[test]
fn no_legal_replacement_is_internal_only() -> TestResult {
    assert!(LOCAL_SOURCE.contains("InternalNoLegalReplacement"));
    assert!(LOCAL_SOURCE.contains("take_pending_no_legal_replacement"));
    assert!(LOCAL_SOURCE.contains("GameIntent::NoLegalReplacement"));
    assert!(LOCAL_SOURCE.contains("ExternalNoLegalReplacement"));
    assert!(!LOCAL_SOURCE.contains("LocalBattleRequest::NoLegalReplacement"));
    Ok(())
}
