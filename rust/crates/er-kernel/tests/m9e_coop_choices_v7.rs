//! Focused party formation from two independent raw setup journeys.
//! This does not claim the pending current network setup handshake is integrated.
use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_new_run_v6::{expand_cooperative_choices_v7, expand_cooperative_topology_v6};
use er_game::m72_bootstrap::RunBootstrapStageV1;
use er_kernel::game_kernel_v7::GameKernelV7;
use er_kernel::game_kernel_v7::{GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7};
use er_kernel::game_kernel_v7::current_coop_setup_v7::CurrentCoopFrameV1;
use er_kernel::initial_battle_protocol_snapshot_v2;
use er_kernel::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use er_protocol::authority_log::{AuthorityLogConfig, BackoffPolicy, PeerBinding};
use er_protocol::proposal::ProposalLeaseConfig;
use er_protocol::recovery::RecoveryTransactionConfig;
use er_protocol::replica::AuthorityReplicaConfig;
use er_types::{ConnectionGeneration, FrameContext, MembershipRevision, RunId, SessionId, TimeClass};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::GameKernelLifecycleSnapshotV7;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::{InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId, StarterSelectionV1};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("bounded fixture integer")
}

fn profile() -> Result<ProfileStateV1, Box<dyn Error>> {
    Ok(ProfileStateV1 {
        schema_version: PROFILE_STATE_SCHEMA_VERSION_V1,
        unlocks: Vec::new(),
        achievements: Vec::new(),
        challenges: Vec::new(),
        flags: Default::default(),
        statistics: ProfileStatistics {
            runs_started: SafeU53::ZERO,
            runs_won: SafeU53::ZERO,
            runs_lost: SafeU53::ZERO,
            battles_won: SafeU53::ZERO,
            pokemon_captured: SafeU53::ZERO,
            highest_wave: WaveIndex::new(safe(1))?,
        },
        dex: DexState::default(),
    })
}

fn press(kernel: &mut GameKernelV7, code: PhysicalKey) -> Result<(), Box<dyn Error>> {
    kernel.raw_input(RawInputEvent::KeyDown {
        code: code.clone(),
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    })?;
    kernel.raw_input(RawInputEvent::KeyUp { code })?;
    Ok(())
}

fn navigate(kernel: &mut GameKernelV7, id: &str) -> Result<(), Box<dyn Error>> {
    let bound = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .ok_or("missing natural menu")?
        .options
        .len()
        + 1;
    for _ in 0..bound {
        if kernel
            .current_control()
            .and_then(|control| control.menu.as_ref())
            .is_some_and(|menu| menu.selected_option_id.as_str() == id)
        {
            return Ok(());
        }
        press(kernel, PhysicalKey::ArrowDown)?;
    }
    let selected = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .map_or("<no-menu>", |menu| menu.selected_option_id.as_str());
    Err(format!("raw option {id} is unreachable from {selected}").into())
}

fn independent_setup(
    content: Arc<PreparedGameContentV2>,
    seat: SeatId,
    host: bool,
) -> Result<(GameKernelV7, Vec<StarterSelectionV1>), Box<dyn Error>> {
    let mode = content
        .bundle()
        .bootstrap
        .modes
        .iter()
        .find(|mode| mode.cooperative && mode.supported)
        .ok_or("missing cooperative source mode")?;
    let challenges = mode.challenge_selection && host;
    let mode = mode.mode;
    let mut kernel = GameKernelV7::natural_start(
        profile()?,
        "owned-starter-formation".to_owned(),
        seat,
        vec!["owned-starter-slot".to_owned()],
        host,
        content.clone(),
        KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO),
            timers: Vec::new(),
            pauses: Vec::new(),
            disposed: false,
        },
        None,
    )?;
    press(&mut kernel, PhysicalKey::Space)?;
    navigate(&mut kernel, &format!("bootstrap/mode/{}", mode.get()))?;
    press(&mut kernel, PhysicalKey::Space)?;
    let GameKernelLifecycleSnapshotV7::Bootstrap(after_mode) = kernel.snapshot()?.lifecycle else {
        return Err("mode selection was bypassed".into());
    };
    if challenges {
        assert_eq!(after_mode.stage, RunBootstrapStageV1::ChallengeSelect);
        navigate(&mut kernel, "bootstrap/challenge/done")?;
        press(&mut kernel, PhysicalKey::Space)?;
    } else {
        assert_eq!(after_mode.stage, RunBootstrapStageV1::StarterSelect);
    }
    let GameKernelLifecycleSnapshotV7::Bootstrap(before) = kernel.snapshot()?.lifecycle else {
        return Err("starter selection was bypassed".into());
    };
    assert_eq!(before.stage, RunBootstrapStageV1::StarterSelect);
    let count = if host { 1 } else { 2 };
    let mut remaining = before.catalog.maximum_starter_cost;
    let mut chosen = Vec::new();
    for starter in before
        .catalog
        .starters
        .iter()
        .skip(if host { 0 } else { 2 })
    {
        if starter.cost <= remaining {
            remaining -= starter.cost;
            chosen.push(starter.clone());
            if chosen.len() == count {
                break;
            }
        }
    }
    assert_eq!(
        chosen.len(),
        count,
        "source catalog must support this focused witness"
    );
    for starter in &chosen {
        navigate(
            &mut kernel,
            &format!("bootstrap/starter/{}", starter.pokemon_id.get()),
        )?;
        press(&mut kernel, PhysicalKey::Space)?;
    }
    navigate(&mut kernel, "bootstrap/starter/confirm")?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    let GameKernelLifecycleSnapshotV7::Bootstrap(confirmed) = kernel.snapshot()?.lifecycle else {
        return Err("confirmation failed to preserve setup ownership".into());
    };
    assert_eq!(confirmed.selections.starters, chosen);
    if host {
        for _ in 0..4 {
            if kernel.state().is_some() {
                break;
            }
            press(&mut kernel, PhysicalKey::Space)?;
        }
        assert!(kernel.state().is_some());
    } else {
        assert_eq!(confirmed.stage, RunBootstrapStageV1::WaitingForPartner);
        assert!(kernel.state().is_none());
    }
    Ok((kernel, chosen))
}

type SetupFixture = (
    Arc<PreparedGameContentV2>,
    GameKernelV7,
    GameKernelV7,
    Vec<StarterSelectionV1>,
);

fn fixtures() -> Result<SetupFixture, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let (host, _) = independent_setup(content.clone(), SeatId::new(safe(1)), true)?;
    let (guest, chosen) = independent_setup(content.clone(), SeatId::new(safe(2)), false)?;
    Ok((content, host, guest, chosen))
}

#[test]
fn confirmed_independent_raw_starters_form_exact_owned_party_and_preserve_host()
-> Result<(), Box<dyn Error>> {
    let (content, host, guest, chosen) = fixtures()?;
    let guest_before = guest.snapshot()?;
    let before = host.state().ok_or("host run missing")?.clone();
    let host_party = before
        .active_run
        .as_ref()
        .ok_or("host active run missing")?
        .party
        .clone();
    let mut state = before.clone();
    let seat = SeatId::new(safe(2));
    expand_cooperative_choices_v7(&mut state, content.as_ref(), seat, &chosen)?;
    state.validate_with(content.as_ref())?;
    let run = state.active_run.as_ref().ok_or("formed run missing")?;
    assert_eq!(&run.party[..host_party.len()], host_party.as_slice());
    let peers = run
        .party
        .iter()
        .filter(|pokemon| pokemon.owner_seat == Some(seat))
        .collect::<Vec<_>>();
    assert_eq!(peers.len(), chosen.len());
    for (pokemon, choice) in peers.iter().zip(&chosen) {
        assert_eq!(pokemon.species_id.get(), choice.species_id);
        assert_eq!(pokemon.form_index, choice.form_index);
    }
    assert_eq!(guest.snapshot()?, guest_before);
    assert_eq!(host.state(), Some(&before));
    let mut repeated = before.clone();
    expand_cooperative_choices_v7(&mut repeated, content.as_ref(), seat, &chosen)?;
    assert_eq!(
        state, repeated,
        "same confirmed choices preserve complete RNG/state determinism"
    );
    let mut historical_fixture = before;
    expand_cooperative_topology_v6(&mut historical_fixture, content.as_ref(), seat)?;
    assert_ne!(
        state, historical_fixture,
        "automatic fixture selection cannot satisfy the owned choices"
    );
    Ok(())
}

#[test]
fn invalid_peer_choices_preserve_entire_state_rng_and_allocator() -> Result<(), Box<dyn Error>> {
    let (content, host, _, chosen) = fixtures()?;
    let before = host.state().ok_or("host run missing")?.clone();
    let seat = SeatId::new(safe(2));
    let mut wrong_owner = chosen.clone();
    wrong_owner[0].owner_seat = SeatId::new(safe(1));
    let mut wrong_cost = chosen.clone();
    wrong_cost[0].cost = wrong_cost[0].cost.saturating_add(1);
    let mut wrong_form = chosen.clone();
    wrong_form[0].form_index = u16::MAX;
    for invalid in [
        Vec::new(),
        vec![chosen[0].clone(), chosen[0].clone()],
        wrong_owner,
        wrong_cost,
        wrong_form,
    ] {
        let mut state = before.clone();
        assert!(
            expand_cooperative_choices_v7(&mut state, content.as_ref(), seat, &invalid).is_err()
        );
        assert_eq!(state, before);
    }
    let mut exhausted = before;
    exhausted.identities.next_pokemon_id = safe((1_u64 << 53) - 2);
    exhausted.validate_with(content.as_ref())?;
    let frozen = exhausted.clone();
    assert!(
        expand_cooperative_choices_v7(&mut exhausted, content.as_ref(), seat, &chosen).is_err()
    );
    assert_eq!(
        exhausted, frozen,
        "late allocation failure must roll back the first generated partner and RNG"
    );
    Ok(())
}

fn frame(
    sender: SeatId,
    authority: SeatId,
    generation: ConnectionGeneration,
) -> Result<FrameContext, Box<dyn Error>> {
    Ok(FrameContext {
        session_id: SessionId::new("m9e-coop-session")?,
        run_id: RunId::new("m9e-coop-run")?,
        session_epoch: safe(1),
        seat_map_id: "m9e-coop-seat-map".to_owned(),
        membership_revision: MembershipRevision::new(safe(1)),
        sender_seat_id: sender,
        authority_seat_id: authority,
        connection_generation: generation,
    })
}

fn authority_protocol(
    host: SeatId,
    guest: SeatId,
    generation: ConnectionGeneration,
) -> Result<BattleProtocolConfig, Box<dyn Error>> {
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Authority {
            log: AuthorityLogConfig {
                local_context: frame(host, host, generation)?,
                peer_bindings: vec![PeerBinding {
                    seat_id: guest,
                    connection_generation: generation,
                }],
                owner_id: "m9e-coop-authority".to_owned(),
                retain_capacity: safe(32),
                delivery_backoff: BackoffPolicy {
                    initial_ms: safe(1),
                    maximum_ms: safe(64),
                    factor_numerator: safe(2),
                    factor_denominator: safe(1),
                },
                delivery_time_class: TimeClass::Connected,
                max_delivery_attempts: Some(safe(8)),
            },
            proposal_capacity: safe(64),
        },
    })
}

fn replica_protocol(
    host: SeatId,
    guest: SeatId,
    generation: ConnectionGeneration,
) -> Result<BattleProtocolConfig, Box<dyn Error>> {
    let context = frame(guest, host, generation)?;
    Ok(BattleProtocolConfig {
        role: BattleProtocolRoleConfig::Replica {
            replica: AuthorityReplicaConfig {
                receipt_context: context.clone(),
                authority_seat_id: host,
                authority_connection_generation: generation,
            },
            proposal_leases: ProposalLeaseConfig {
                owner_prefix: "m9e-coop-proposal".to_owned(),
                retry_initial_ms: safe(1),
                retry_maximum_ms: safe(64),
                absolute_ceiling_ms: safe(1_200_000),
            },
            recovery: RecoveryTransactionConfig {
                local_context: context,
                request_timeout_ms: safe(300_000),
                control_timeout_ms: safe(30_000),
                pacing_ms: safe(16),
                timer_owner_id: "m9e-coop-recovery".to_owned(),
            },
        },
    })
}


fn owned_title(content: Arc<PreparedGameContentV2>, host: bool) -> Result<GameKernelV7, Box<dyn Error>> {
    let authority = SeatId::new(safe(1));
    let replica = SeatId::new(safe(2));
    let seat = if host { authority } else { replica };
    let generation = ConnectionGeneration::new(safe(1));
    let config = if host { authority_protocol(authority, replica, generation)? } else { replica_protocol(authority, replica, generation)? };
    let protocol = initial_battle_protocol_snapshot_v2(&config, seat)?;
    let mut kernel = GameKernelV7::natural_start(profile()?, "owned-startup".to_owned(), seat,
        vec!["owned-save".to_owned()], host, content, KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO), timers: Vec::new(), pauses: Vec::new(), disposed: false,
        }, Some(protocol))?;
    let before = kernel.snapshot()?;
    assert!(before.current_coop_setup.is_none(), "capability must not activate by default");
    kernel.enable_current_coop_setup()?;
    assert!(kernel.current_control().is_some());
    Ok(kernel)
}

fn capture_press(kernel: &mut GameKernelV7, frames: &mut Vec<Vec<u8>>) -> Result<(), Box<dyn Error>> {
    for input in [RawInputEvent::KeyDown { code: PhysicalKey::Space, printable: false, browser_repeat: false, focus: InputFocus::Game },
                  RawInputEvent::KeyUp { code: PhysicalKey::Space }] {
        for effect in kernel.raw_input(input)?.effects {
            match effect {
                GameKernelEffectV7::ProposalReady { bytes, .. } | GameKernelEffectV7::AuthorityMaterial { bytes, .. } => frames.push(bytes),
                _ => {}
            }
        }
    }
    Ok(())
}

fn choose_owned(kernel: &mut GameKernelV7, content: &PreparedGameContentV2, host: bool) -> Result<(Vec<StarterSelectionV1>, Vec<Vec<u8>>), Box<dyn Error>> {
    let mode = content.bundle().bootstrap.modes.iter().find(|mode| mode.cooperative && mode.supported).ok_or("co-op mode missing")?;
    let mut frames = Vec::new();
    capture_press(kernel, &mut frames)?;
    navigate(kernel, &format!("bootstrap/mode/{}", mode.mode.get()))?;
    capture_press(kernel, &mut frames)?;
    if mode.challenge_selection && host {
        navigate(kernel, "bootstrap/challenge/done")?;
        capture_press(kernel, &mut frames)?;
    }
    let GameKernelLifecycleSnapshotV7::Bootstrap(before) = kernel.snapshot()?.lifecycle else { return Err("raw setup bypassed".into()); };
    assert_eq!(before.stage, RunBootstrapStageV1::StarterSelect);
    let count = if host { 1 } else { 2 };
    let mut budget = before.catalog.maximum_starter_cost;
    let mut selected = Vec::new();
    for starter in before.catalog.starters.iter().skip(if host { 0 } else { 2 }) {
        if starter.cost <= budget {
            budget -= starter.cost;
            selected.push(starter.clone());
            if selected.len() == count { break; }
        }
    }
    assert_eq!(selected.len(), count);
    for starter in &selected {
        navigate(kernel, &format!("bootstrap/starter/{}", starter.pokemon_id.get()))?;
        capture_press(kernel, &mut frames)?;
    }
    navigate(kernel, "bootstrap/starter/confirm")?;
    capture_press(kernel, &mut frames)?;
    capture_press(kernel, &mut frames)?;
    if host {
        for _ in 0..4 {
            if kernel.state().is_some() || matches!(kernel.snapshot()?.lifecycle, GameKernelLifecycleSnapshotV7::Bootstrap(ref bootstrap) if bootstrap.stage == RunBootstrapStageV1::Complete) { break; }
            capture_press(kernel, &mut frames)?;
        }
    } else {
        assert!(matches!(kernel.snapshot()?.lifecycle, GameKernelLifecycleSnapshotV7::Bootstrap(ref bootstrap) if bootstrap.stage == RunBootstrapStageV1::WaitingForPartner));
        assert_eq!(frames.len(), 1, "confirmation itself publishes exactly one peer selection");
    }
    Ok((selected, frames))
}

fn wire(step: &GameKernelStepV7) -> Result<Vec<u8>, Box<dyn Error>> {
    let bytes = step.effects.iter().filter_map(|effect| match effect {
        GameKernelEffectV7::ProposalReady { bytes, .. } | GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes.clone()), _ => None,
    }).collect::<Vec<_>>();
    assert_eq!(bytes.len(), 1);
    Ok(bytes[0].clone())
}

fn restored(kernel: &GameKernelV7, content: Arc<PreparedGameContentV2>, host: bool) -> Result<GameKernelV7, Box<dyn Error>> {
    let snapshot = kernel.snapshot()?;
    let encoded = er_canonical::canonical_bytes(&snapshot)?;
    let restored = GameKernelV7::from_snapshot(serde_json::from_slice(&encoded)?, SeatId::new(safe(if host { 1 } else { 2 })),
        if host { GameKernelRoleV7::Authority } else { GameKernelRoleV7::Replica }, content)?;
    assert_eq!(snapshot, restored.snapshot()?);
    Ok(restored)
}

#[test]
fn natural_owned_startup_waits_for_both_orders_restores_and_retries_without_reexecution() -> Result<(), Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let generation = ConnectionGeneration::new(safe(1));
    for guest_first in [false, true] {
        let mut host = owned_title(content.clone(), true)?;
        let mut guest = owned_title(content.clone(), false)?;
        let (guest_choices, publications) = choose_owned(&mut guest, content.as_ref(), false)?;
        let choices = publications[0].clone();
        guest = restored(&guest, content.clone(), false)?;
        assert_eq!(wire(&guest.retry_current_coop_setup()?)?, choices);
        let (host_choices, started) = if guest_first {
            let early = host.ingest_network_frame(generation, &choices)?;
            assert!(early.effects.iter().all(|effect| matches!(effect, GameKernelEffectV7::UiChanged(_))));
            assert!(host.state().is_none());
            host = restored(&host, content.clone(), true)?;
            let (selected, frames) = choose_owned(&mut host, content.as_ref(), true)?;
            assert_eq!(frames.len(), 1);
            (selected, frames[0].clone())
        } else {
            let (selected, frames) = choose_owned(&mut host, content.as_ref(), true)?;
            assert!(frames.is_empty());
            assert!(host.state().is_none(), "host may not invent a guest party");
            host = restored(&host, content.clone(), true)?;
            (selected, wire(&host.ingest_network_frame(generation, &choices)?)?)
        };
        host = restored(&host, content.clone(), true)?;
        let before = host.snapshot()?;
        let duplicate = host.ingest_network_frame(generation, &choices)?;
        assert_eq!(wire(&duplicate)?, started, "lost startup reply must be byte-identical");
        assert_eq!(duplicate.effects.len(), 1, "retry must not repeat presentation or storage");
        assert_eq!(before, host.snapshot()?);
        assert_eq!(wire(&host.retry_current_coop_setup()?)?, started);
        let applied = guest.ingest_network_frame(generation, &started)?;
        assert!(applied.effects.iter().all(|effect| !matches!(effect, GameKernelEffectV7::Platform(_) | GameKernelEffectV7::AuthorityMaterial { .. })));
        assert_eq!(host.state(), guest.state());
        assert_eq!(host.snapshot()?.pending_presentations, guest.snapshot()?.pending_presentations);
        assert!(guest.snapshot()?.pending_platform.is_empty());
        let run = host.state().and_then(|state| state.active_run.as_ref()).ok_or("owned run missing")?;
        assert_eq!(run.party.len(), host_choices.len() + guest_choices.len());
        for (pokemon, selected) in run.party.iter().zip(host_choices.iter().chain(&guest_choices)) {
            assert_eq!(pokemon.owner_seat, Some(selected.owner_seat));
            assert_eq!(pokemon.species_id.get(), selected.species_id);
            assert_eq!(pokemon.form_index, selected.form_index);
        }
        guest = restored(&guest, content.clone(), false)?;
        let before = guest.snapshot()?;
        assert!(guest.ingest_network_frame(generation, &started)?.effects.is_empty());
        assert_eq!(guest.snapshot()?, before);
        assert!(guest.retry_current_coop_setup()?.effects.is_empty());
    }
    Ok(())
}

#[test]
fn owned_startup_rejects_forged_frames_and_snapshots_atomically() -> Result<(), Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let generation = ConnectionGeneration::new(safe(1));
    let mut host = owned_title(content.clone(), true)?;
    let mut guest = owned_title(content.clone(), false)?;
    let (_, publications) = choose_owned(&mut guest, content.as_ref(), false)?;
    let choices = &publications[0];
    let frame: CurrentCoopFrameV1 = serde_json::from_slice(choices)?;
    let CurrentCoopFrameV1::CurrentCoopChoices { choices: original } = frame else { return Err("wrong raw publication".into()); };
    for index in 0..14 {
        let mut forged = original.clone();
        match index {
            0 => forged.context.session_id = SessionId::new("wrong-session")?,
            1 => forged.context.run_id = RunId::new("wrong-run")?,
            2 => forged.context.session_epoch = safe(2),
            3 => forged.context.seat_map_id = "wrong-map".to_owned(),
            4 => forged.context.membership_revision = MembershipRevision::new(safe(2)),
            5 => forged.context.sender_seat_id = SeatId::new(safe(3)),
            6 => forged.context.authority_seat_id = SeatId::new(safe(2)),
            7 => forged.context.connection_generation = ConnectionGeneration::new(safe(2)),
            8 => forged.seed = "wrong-seed".to_owned(),
            9 => forged.starters[0].cost = u16::MAX,
            10 => forged.starters[0].owner_seat = SeatId::new(safe(1)),
            11 => forged.starters[0].ability_index = u8::MAX,
            12 => forged.starters = Vec::new(),
            _ => forged.starters.push(forged.starters[0].clone()),
        }
        let bytes = er_canonical::canonical_bytes(&CurrentCoopFrameV1::CurrentCoopChoices { choices: forged })?;
        let before = host.snapshot()?;
        assert!(host.ingest_network_frame(generation, &bytes).is_err(), "forgery {index} accepted");
        assert_eq!(before, host.snapshot()?);
    }
    let mut unknown: serde_json::Value = serde_json::from_slice(choices)?;
    unknown["choices"]["context"]["unowned"] = true.into();
    let unknown = er_canonical::canonical_bytes(&unknown)?;
    let before = host.snapshot()?;
    assert!(host.ingest_network_frame(generation, &unknown).is_err());
    assert!(host.ingest_network_frame(ConnectionGeneration::new(safe(2)), choices).is_err());
    assert!(host.ingest_network_frame(generation, &vec![b' '; 1_048_577]).is_err());
    assert_eq!(before, host.snapshot()?);
    choose_owned(&mut host, content.as_ref(), true)?;
    let started = wire(&host.ingest_network_frame(generation, choices)?)?;
    let mut forged: CurrentCoopFrameV1 = serde_json::from_slice(&started)?;
    let CurrentCoopFrameV1::CurrentCoopStarted { choices: peer, .. } = &mut forged else { return Err("wrong startup receipt".into()); };
    peer.starters.reverse();
    let before = guest.snapshot()?;
    assert!(guest.ingest_network_frame(generation, &er_canonical::canonical_bytes(&forged)?).is_err());
    assert_eq!(before, guest.snapshot()?);
    let mut corrupt = before.clone();
    corrupt.current_coop_setup.as_mut().ok_or("owner missing")?.choices = None;
    assert!(GameKernelV7::from_snapshot(corrupt, SeatId::new(safe(2)), GameKernelRoleV7::Replica, content.clone()).is_err());
    guest.ingest_network_frame(generation, &started)?;
    let mut corrupt = guest.snapshot()?;
    corrupt.current_coop_setup.as_mut().ok_or("owner missing")?.started = None;
    assert!(GameKernelV7::from_snapshot(corrupt, SeatId::new(safe(2)), GameKernelRoleV7::Replica, content).is_err());
    Ok(())
}
