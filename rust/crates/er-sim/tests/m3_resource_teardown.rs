//! M3 Battle-kernel teardown evidence.
//!
//! The test constructs the production Battle kernel, crosses raw input and
//! menu boundaries, and then disposes the owner graph twice.  The post-dispose
//! resource projection is compared with the typed zero value instead of
//! checking only timers; this covers presentation barriers, controls, waits,
//! protocol leases, retained revisions, storage requests, and packets.

use std::error::Error;
use std::sync::Arc;

use er_content::pack::selected_content_pack;
use er_game::runtime::BATTLE_START_SCHEMA_VERSION;
use er_kernel::{
    BattleGameConfig, BattleProtocolConfig, BattleProtocolRoleConfig, BattleStartV1, GameKernel,
    KernelEffect, KernelInput,
};
use er_protocol::{AuthorityLogConfig, BackoffPolicy};
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_state::format::BattleFormat;
use er_state::pokemon::{
    AbilityLoadout, BattleStats, MoveSlotState, PokemonState, StatStages, StatusState,
};
use er_state::snapshot::GameState;
use er_types::battle_command::{
    BattleCommand, BattleTargetSelection, ScriptedEnemyBattleCommandV1, ScriptedEnemyPolicyV1,
    scripted_enemy_command_operation_id,
};
use er_types::battle_ids::{
    BattleId, BattleSide, FieldSlot, GameModeId, MoveSlotIndex, PartyIndex, PokemonId, TurnIndex,
    WaveIndex,
};
use er_types::{
    ConnectionGeneration, FrameContext, InputFocus, MembershipRevision, PhysicalKey, RawInputEvent,
    RunId, SafeU53, SeatId, SessionId, TimeClass,
};

type TestResult<T> = Result<T, Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn seat(value: u64) -> SeatId {
    SeatId::new(safe(value))
}

fn pokemon_id(value: u64) -> PokemonId {
    PokemonId::new(safe(value))
}

fn single_party_pokemon(
    content: &er_content::pack::ContentPack,
    id: u64,
    owner_seat: Option<SeatId>,
) -> TestResult<PokemonState> {
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
            active: er_types::battle_ids::AbilityId::ZERO,
            passives: [None, None, None],
            active_suppressed: false,
            passive_suppressed: [false, false, false],
        },
        false,
    )?)
}

fn battle_kernel() -> TestResult<GameKernel> {
    let content = selected_content_pack()?;
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
    let run_state = GameState::new(
        content.hash.clone(),
        GameModeId::new(safe(1)),
        wave,
        battle_id,
        RunRngState {
            rdg: PhaserRdg::from_seed("m3-resource-teardown").state(),
        },
        None,
    )?;
    let config = BattleGameConfig {
        run_state,
        start: BattleStartV1 {
            schema_version: BATTLE_START_SCHEMA_VERSION,
            format: BattleFormat::single(),
            player_party: vec![single_party_pokemon(&content, 1, Some(seat(1)))?],
            enemy_party: vec![single_party_pokemon(&content, 2, None)?],
            player_leads: vec![PartyIndex::ZERO],
            enemy_leads: vec![PartyIndex::ZERO],
        },
        local_seat: seat(1),
        wave_seed: "m3-resource-teardown-wave".to_owned(),
        scripted_enemy_policy: ScriptedEnemyPolicyV1::new(safe(0), vec![enemy_script])?,
    };
    let context = FrameContext {
        session_id: SessionId::new("m3-resource-teardown-session")?,
        run_id: RunId::new("m3-resource-teardown-run")?,
        session_epoch: safe(1),
        seat_map_id: "m3-resource-teardown-single-seat".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: seat(1),
        authority_seat_id: seat(1),
        connection_generation: ConnectionGeneration::ZERO,
    };
    let protocol = BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: context,
                peer_bindings: Vec::new(),
                owner_id: "m3-resource-teardown-authority".to_owned(),
                retain_capacity: safe(32),
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(250),
                    maximum_ms: safe(5_000),
                    factor_numerator: safe(2),
                    factor_denominator: safe(1),
                },
                delivery_time_class: TimeClass::Connected,
                max_delivery_attempts: Some(safe(8)),
            },
            proposal_capacity: safe(32),
        },
    };
    Ok(GameKernel::new_battle(config, protocol, Arc::new(content))?)
}

fn key_down(code: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyDown {
        code,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    }
}

fn key_up(code: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyUp { code }
}

fn assert_no_legacy_success_effects(effects: &[KernelEffect]) {
    assert!(effects.iter().all(|effect| {
        !matches!(
            effect,
            KernelEffect::ApplyAuthorityMaterial { .. }
                | KernelEffect::ProjectAuthorityControl { .. }
                | KernelEffect::UiIntent { .. }
        )
    }));
}

fn assert_zero_live_resources(kernel: &GameKernel) {
    let resources = kernel.live_resources();
    assert!(resources.timers.is_empty());
    assert!(resources.presentations.is_empty());
    assert!(resources.battle_presentations.is_empty());
    assert!(resources.storage_requests.is_empty());
    assert!(resources.delivery_leases.is_empty());
    assert!(resources.proposal_leases.is_empty());
    assert!(resources.recovery_transactions.is_empty());
    assert!(resources.waits.is_empty());
    assert!(resources.retained_revisions.is_empty());
    assert!(resources.controls.is_empty());
    assert!(resources.network_packets.is_empty());
    assert_eq!(resources, er_types::LiveResourceSnapshot::default());
}

#[test]
fn m3_dispose_clears_every_live_resource_and_is_idempotent() -> TestResult<()> {
    let mut kernel = battle_kernel()?;
    assert!(!kernel.live_resources().controls.is_empty());

    for code in [PhysicalKey::Enter, PhysicalKey::Backspace] {
        let pressed = kernel.step(KernelInput::RawInput {
            seat: seat(1),
            event: key_down(code.clone()),
        })?;
        assert_no_legacy_success_effects(&pressed);
        let released = kernel.step(KernelInput::RawInput {
            seat: seat(1),
            event: key_up(code),
        })?;
        assert_no_legacy_success_effects(&released);
    }

    let held = kernel.step(KernelInput::RawInput {
        seat: seat(1),
        event: key_down(PhysicalKey::ArrowDown),
    })?;
    assert_no_legacy_success_effects(&held);
    assert!(
        !kernel.live_resources().timers.is_empty(),
        "held physical input must own a live repeat timer before teardown"
    );

    let dispose_effects = kernel.dispose("m3 final-evidence teardown");
    assert_no_legacy_success_effects(&dispose_effects);
    assert!(kernel.is_disposed());
    assert_zero_live_resources(&kernel);
    assert!(kernel.dispose("m3 repeated teardown").is_empty());
    assert_zero_live_resources(&kernel);
    assert!(
        kernel
            .step(KernelInput::RawInput {
                seat: seat(1),
                event: key_down(PhysicalKey::Enter),
            })
            .is_err(),
        "disposed Battle kernel accepted a post-teardown input"
    );
    Ok(())
}
