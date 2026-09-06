//! Focused party formation from two independent raw setup journeys.
//! This does not claim the pending current network setup handshake is integrated.
use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m9e_new_run_v6::{expand_cooperative_choices_v7, expand_cooperative_topology_v6};
use er_game::m72_bootstrap::RunBootstrapStageV1;
use er_kernel::game_kernel_v7::GameKernelV7;
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
