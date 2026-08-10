//! Deterministic M3 Battle-kernel workloads.
//!
//! The test harness reports only workload identity, input counts, and a
//! deterministic checksum.  Wall time, RSS, and acceptance are intentionally
//! owned by `scripts/benchmark-kernel-m3.mjs` on a hosted runner; this source
//! does not contain fabricated performance values or a local baseline.

use std::error::Error;
use std::io::{self, Write};
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
    ConnectionGeneration, FrameContext, InputFocus, MembershipRevision, PhysicalKey,
    RawInputEvent, RunId, SafeU53, SeatId, SessionId, TimeClass,
};
use serde::Serialize;
use serde_json::{Value, json};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const EVENTWISE_ITERATIONS: u64 = 128;
const TEARDOWN_ITERATIONS: u64 = 128;
const CAMPAIGN_STEPS: u64 = 512;
const BENCHMARK_SEED: &str = "81985529216486895";
const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

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

fn battle_kernel(seed: &str, iteration: u64) -> TestResult<GameKernel> {
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
    let enemy_operation = scripted_enemy_command_operation_id(
        battle_id,
        wave,
        turn,
        enemy_slot,
        safe(0),
    )?;
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
            rdg: PhaserRdg::from_seed(seed).state(),
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
        wave_seed: format!("{seed}/wave/{iteration}"),
        scripted_enemy_policy: ScriptedEnemyPolicyV1::new(safe(0), vec![enemy_script])?,
    };
    let context = FrameContext {
        session_id: SessionId::new(format!("m3-benchmark-session-{iteration}"))?,
        run_id: RunId::new(format!("m3-benchmark-run-{iteration}"))?,
        session_epoch: safe(1),
        seat_map_id: "m3-benchmark-single-seat".to_owned(),
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
                owner_id: format!("m3-benchmark-authority-{iteration}"),
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

fn raw_input(event: RawInputEvent) -> KernelInput {
    KernelInput::RawInput {
        seat: seat(1),
        event,
    }
}

fn absorb<T: Serialize>(checksum: &mut u64, value: &T) -> TestResult {
    for byte in serde_json::to_vec(value)? {
        *checksum ^= u64::from(byte);
        *checksum = checksum.wrapping_mul(FNV_PRIME);
    }
    Ok(())
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

fn assert_eventwise_kernel_parity(
    left: &GameKernel,
    right: &GameKernel,
    left_effects: &[KernelEffect],
    right_effects: &[KernelEffect],
) {
    assert_eq!(left_effects, right_effects, "event effects diverged");
    assert_eq!(left.snapshot(), right.snapshot(), "event snapshots diverged");
    assert_eq!(
        left.state_digest(),
        right.state_digest(),
        "event state digests diverged"
    );
    assert_eq!(
        left.battle_ui_projection(),
        right.battle_ui_projection(),
        "event Battle UI projections diverged"
    );
    assert_eq!(
        left.live_resources(),
        right.live_resources(),
        "event live-resource projections diverged"
    );
}

fn report(
    scenario_id: &str,
    seed: &str,
    iterations: u64,
    steps: u64,
    checksum: u64,
    details: Value,
) -> TestResult {
    assert_ne!(checksum, FNV_OFFSET, "benchmark checksum must include work");
    let marker = json!({
        "scenario_id": scenario_id,
        "seed": seed,
        "iterations": iterations,
        "schedules": 0,
        "steps": steps,
        "checksum": format!("{checksum:016x}"),
        "success": true,
        "details": details,
    });
    let mut stdout = io::stdout().lock();
    writeln!(
        stdout,
        "M3_BENCHMARK_RESULT {}",
        serde_json::to_string(&marker)?
    )?;
    stdout.flush()?;
    Ok(())
}

#[test]
fn m3_eventwise_battle_replay() -> TestResult {
    let mut checksum = FNV_OFFSET;
    for iteration in 0..EVENTWISE_ITERATIONS {
        let mut left = battle_kernel(BENCHMARK_SEED, iteration)?;
        let mut right = battle_kernel(BENCHMARK_SEED, iteration)?;
        for code in [PhysicalKey::Enter, PhysicalKey::Backspace] {
            let pressed = raw_input(key_down(code.clone()));
            let left_effects = left.step(pressed.clone())?;
            let right_effects = right.step(pressed)?;
            assert_eventwise_kernel_parity(&left, &right, &left_effects, &right_effects);
            assert_no_legacy_success_effects(&left_effects);
            absorb(&mut checksum, &left_effects)?;
            absorb(&mut checksum, &left.snapshot())?;
            absorb(&mut checksum, &left.battle_ui_projection())?;
            absorb(&mut checksum, &left.live_resources())?;

            let released = raw_input(key_up(code));
            let left_effects = left.step(released.clone())?;
            let right_effects = right.step(released)?;
            assert_eventwise_kernel_parity(&left, &right, &left_effects, &right_effects);
            assert_no_legacy_success_effects(&left_effects);
            absorb(&mut checksum, &left_effects)?;
            absorb(&mut checksum, &left.snapshot())?;
            absorb(&mut checksum, &left.battle_ui_projection())?;
            absorb(&mut checksum, &left.live_resources())?;
        }
        let left_dispose = left.dispose("m3 benchmark eventwise teardown");
        let right_dispose = right.dispose("m3 benchmark eventwise teardown");
        assert_eq!(left_dispose, right_dispose);
        assert_no_legacy_success_effects(&left_dispose);
        assert_eq!(
            left.live_resources(),
            er_types::LiveResourceSnapshot::default()
        );
        assert_eq!(
            right.live_resources(),
            er_types::LiveResourceSnapshot::default()
        );
        absorb(&mut checksum, &left_dispose)?;
    }
    report(
        "eventwise-battle-replay",
        BENCHMARK_SEED,
        EVENTWISE_ITERATIONS,
        0,
        checksum,
        json!({"external_events_per_iteration": 4}),
    )
}

#[test]
fn m3_zero_resource_teardown() -> TestResult {
    let mut checksum = FNV_OFFSET;
    for iteration in 0..TEARDOWN_ITERATIONS {
        let mut kernel = battle_kernel(BENCHMARK_SEED, iteration)?;
        let effects = kernel.step(raw_input(key_down(PhysicalKey::Enter)))?;
        assert_no_legacy_success_effects(&effects);
        absorb(&mut checksum, &effects)?;
        let dispose_effects = kernel.dispose("m3 benchmark zero-resource teardown");
        assert_no_legacy_success_effects(&dispose_effects);
        assert!(kernel.is_disposed());
        assert_eq!(
            kernel.live_resources(),
            er_types::LiveResourceSnapshot::default()
        );
        assert!(kernel.dispose("m3 benchmark repeated teardown").is_empty());
        assert!(
            kernel
                .step(raw_input(key_down(PhysicalKey::Enter)))
                .is_err(),
            "zero-resource workload accepted input after teardown"
        );
        absorb(&mut checksum, &dispose_effects)?;
        absorb(&mut checksum, &kernel.live_resources())?;
    }
    report(
        "zero-resource-teardown",
        BENCHMARK_SEED,
        TEARDOWN_ITERATIONS,
        0,
        checksum,
        json!({"resource_projection": "LiveResourceSnapshot::default"}),
    )
}

#[test]
fn m3_raw_event_campaign() -> TestResult {
    let mut checksum = FNV_OFFSET;
    let mut kernel = battle_kernel(BENCHMARK_SEED, CAMPAIGN_STEPS)?;
    for cycle in 0..(CAMPAIGN_STEPS / 4) {
        let code = if cycle % 2 == 0 {
            PhysicalKey::Enter
        } else {
            PhysicalKey::Backspace
        };
        for event in [key_down(code.clone()), key_up(code)] {
            let effects = kernel.step(raw_input(event))?;
            assert_no_legacy_success_effects(&effects);
            absorb(&mut checksum, &effects)?;
            absorb(&mut checksum, &kernel.state_digest())?;
            absorb(&mut checksum, &kernel.live_resources())?;
        }
        let navigation = if cycle % 2 == 0 {
            PhysicalKey::ArrowDown
        } else {
            PhysicalKey::ArrowUp
        };
        for event in [key_down(navigation.clone()), key_up(navigation)] {
            let effects = kernel.step(raw_input(event))?;
            assert_no_legacy_success_effects(&effects);
            absorb(&mut checksum, &effects)?;
            absorb(&mut checksum, &kernel.state_digest())?;
            absorb(&mut checksum, &kernel.live_resources())?;
        }
    }
    let dispose_effects = kernel.dispose("m3 benchmark campaign teardown");
    assert_no_legacy_success_effects(&dispose_effects);
    assert_eq!(
        kernel.live_resources(),
        er_types::LiveResourceSnapshot::default()
    );
    absorb(&mut checksum, &dispose_effects)?;
    report(
        "raw-event-campaign",
        BENCHMARK_SEED,
        0,
        CAMPAIGN_STEPS,
        checksum,
        json!({"events": "raw key down/up only"}),
    )
}
