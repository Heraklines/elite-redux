//! Natural owned co-op campaign from independent Title journeys.
//! All decisions, deliveries and restored states use the current runtime.
use std::error::Error;
use std::sync::Arc;

use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_game::m72_bootstrap::RunBootstrapStageV1;
use er_kernel::game_kernel_v7::GameKernelV7;
use er_kernel::game_kernel_v7::{GameKernelEffectV7, GameKernelRoleV7, GameKernelStepV7};
use er_kernel::initial_battle_protocol_snapshot_v2;
use er_kernel::kernel::{BattleProtocolConfig, BattleProtocolRoleConfig};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::GameKernelLifecycleSnapshotV7;
use er_protocol::authority_log::{AuthorityLogConfig, BackoffPolicy, PeerBinding};
use er_protocol::proposal::ProposalLeaseConfig;
use er_protocol::recovery::RecoveryTransactionConfig;
use er_protocol::replica::AuthorityReplicaConfig;
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::{
    ConnectionGeneration, FrameContext, MembershipRevision, RunId, SessionId, TimeClass,
};
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

fn owned_title(
    content: Arc<PreparedGameContentV2>,
    host: bool,
) -> Result<GameKernelV7, Box<dyn Error>> {
    let authority = SeatId::new(safe(1));
    let replica = SeatId::new(safe(2));
    let seat = if host { authority } else { replica };
    let generation = ConnectionGeneration::new(safe(1));
    let config = if host {
        authority_protocol(authority, replica, generation)?
    } else {
        replica_protocol(authority, replica, generation)?
    };
    let protocol = initial_battle_protocol_snapshot_v2(&config, seat)?;
    let mut kernel = GameKernelV7::natural_start(
        profile()?,
        "owned-startup".to_owned(),
        seat,
        vec!["owned-save".to_owned()],
        host,
        content,
        KernelSchedulerSnapshotV2 {
            next_timer_id: Some(SafeU53::ZERO),
            timers: Vec::new(),
            pauses: Vec::new(),
            disposed: false,
        },
        Some(protocol),
    )?;
    let before = kernel.snapshot()?;
    assert!(
        before.current_coop_setup.is_none(),
        "capability must not activate by default"
    );
    kernel.enable_current_coop_setup()?;
    assert!(kernel.current_control().is_some());
    Ok(kernel)
}

fn capture_press(
    kernel: &mut GameKernelV7,
    frames: &mut Vec<Vec<u8>>,
) -> Result<(), Box<dyn Error>> {
    for input in [
        RawInputEvent::KeyDown {
            code: PhysicalKey::Space,
            printable: false,
            browser_repeat: false,
            focus: InputFocus::Game,
        },
        RawInputEvent::KeyUp {
            code: PhysicalKey::Space,
        },
    ] {
        for effect in kernel.raw_input(input)?.effects {
            match effect {
                GameKernelEffectV7::ProposalReady { bytes, .. }
                | GameKernelEffectV7::AuthorityMaterial { bytes, .. } => frames.push(bytes),
                _ => {}
            }
        }
    }
    Ok(())
}

type OwnedChoicePublication = (Vec<StarterSelectionV1>, Vec<Vec<u8>>);

fn wire(step: &GameKernelStepV7) -> Result<Vec<u8>, Box<dyn Error>> {
    let bytes = step
        .effects
        .iter()
        .filter_map(|effect| match effect {
            GameKernelEffectV7::ProposalReady { bytes, .. }
            | GameKernelEffectV7::AuthorityMaterial { bytes, .. } => Some(bytes.clone()),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(bytes.len(), 1);
    Ok(bytes[0].clone())
}

fn restored(
    kernel: &GameKernelV7,
    content: Arc<PreparedGameContentV2>,
    host: bool,
) -> Result<GameKernelV7, Box<dyn Error>> {
    let snapshot = kernel.snapshot()?;
    let encoded = er_canonical::canonical_bytes(&snapshot)?;
    let restored = GameKernelV7::from_snapshot(
        serde_json::from_slice(&encoded)?,
        SeatId::new(safe(if host { 1 } else { 2 })),
        if host {
            GameKernelRoleV7::Authority
        } else {
            GameKernelRoleV7::Replica
        },
        content,
    )?;
    assert_eq!(snapshot, restored.snapshot()?);
    Ok(restored)
}

fn play_press(kernel: &mut GameKernelV7) -> Result<GameKernelStepV7, Box<dyn Error>> {
    let step = kernel.raw_input(RawInputEvent::KeyDown {
        code: PhysicalKey::Space,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    })?;
    let released = kernel.raw_input(RawInputEvent::KeyUp {
        code: PhysicalKey::Space,
    })?;
    assert!(released.effects.iter().all(|effect| !matches!(
        effect,
        GameKernelEffectV7::ProposalReady { .. } | GameKernelEffectV7::AuthorityMaterial { .. }
    )));
    Ok(step)
}

fn choose_play_move(
    kernel: &mut GameKernelV7,
    content: &PreparedGameContentV2,
    seat: SeatId,
) -> Result<(), Box<dyn Error>> {
    let run = kernel
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or("run absent")?;
    let battle = run.battle.as_ref().ok_or("battle absent")?;
    let actor = battle
        .field
        .slots
        .iter()
        .find(|slot| {
            run.party.iter().any(|pokemon| {
                Some(pokemon.id) == slot.occupant && pokemon.owner_seat == Some(seat)
            })
        })
        .ok_or("owned field actor absent")?
        .slot;
    let target = battle
        .field
        .slots
        .iter()
        .find(|slot| {
            battle
                .enemy_party
                .iter()
                .any(|pokemon| Some(pokemon.id) == slot.occupant && !pokemon.fainted)
        })
        .ok_or("living opponent absent")?
        .slot;
    let menu = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .ok_or("moves absent")?;
    let selected = menu
        .options
        .iter()
        .filter_map(|option| {
            let er_types::GameActionV1::Battle {
                action: er_types::BattleUiActionV1::SelectMove { move_slot, .. },
            } = option.action
            else {
                return None;
            };
            let damage = er_battle::m7_resolver::query_simulated_move_damage_v5(
                &content.battle,
                run,
                actor,
                move_slot,
                target,
            )
            .ok()?;
            Some((damage, option.option_id.clone()))
        })
        .max_by_key(|(damage, _)| *damage)
        .map(|(_, id)| id)
        .ok_or("no legal damage query for offered moves")?;
    navigate(kernel, selected.as_str())
}

fn deliver_play_step(
    host: &mut GameKernelV7,
    guest: &mut GameKernelV7,
    step: GameKernelStepV7,
    from_host: bool,
    receipt: bool,
) -> Result<(usize, usize), Box<dyn Error>> {
    let generation = ConnectionGeneration::new(safe(1));
    let mut queue = std::collections::VecDeque::from([(step, from_host, receipt)]);
    let mut proposals = 0;
    let mut materials = 0;
    while let Some((step, from_host, receipt)) = queue.pop_front() {
        assert!(
            proposals + materials < 16,
            "unexpected network feedback loop"
        );
        for effect in step.effects {
            match effect {
                GameKernelEffectV7::ProposalReady { bytes, .. } => {
                    assert!(!from_host);
                    proposals += 1;
                    let response = host.ingest_network_frame(generation, &bytes).map_err(|error| {
                        let retained = host.snapshot().ok().and_then(|snapshot| snapshot.protocol)
                            .and_then(|protocol| protocol.proposal_admission)
                            .map(|admission| (admission.capacity.get(), admission.fingerprints.len()));
                        format!("authority proposal admission failed with capacity/retained={retained:?}: {error}")
                    })?;
                    assert!(response.effects.iter().any(|effect| matches!(
                        effect,
                        GameKernelEffectV7::AuthorityMaterial { .. }
                    )));
                    let committed = host.snapshot()?;
                    let retried = host.ingest_network_frame(generation, &bytes)?;
                    assert_eq!(
                        host.snapshot()?,
                        committed,
                        "duplicate proposal reran authority work"
                    );
                    assert!(
                        retried.effects.is_empty()
                            || retried.effects.iter().all(|effect| matches!(
                                effect,
                                GameKernelEffectV7::AuthorityMaterial { .. }
                            ))
                    );
                    queue.push_back((response, true, true));
                }
                GameKernelEffectV7::AuthorityMaterial { bytes, .. } => {
                    assert!(from_host);
                    materials += 1;
                    let applied = if receipt {
                        guest.ingest_network_frame(generation, &bytes)?
                    } else {
                        guest.apply_authority_material(&bytes)?
                    };
                    let once = guest.snapshot()?;
                    let duplicate = if receipt {
                        guest.ingest_network_frame(generation, &bytes)?
                    } else {
                        guest.apply_authority_material(&bytes)?
                    };
                    assert!(
                        duplicate.effects.is_empty(),
                        "duplicate material repeated effects"
                    );
                    assert_eq!(
                        once,
                        guest.snapshot()?,
                        "duplicate material changed endpoint state"
                    );
                    assert_eq!(
                        host.state(),
                        guest.state(),
                        "committed shared game diverged"
                    );
                    assert_eq!(
                        host.snapshot()?.pending_presentations,
                        guest.snapshot()?.pending_presentations
                    );
                    queue.push_back((applied, false, false));
                }
                GameKernelEffectV7::Platform(_) => {
                    return Err("unexpected persistence during battle witness".into());
                }
                _ => {}
            }
        }
    }
    Ok((proposals, materials))
}

fn choose_combat_party(
    kernel: &mut GameKernelV7,
    content: &PreparedGameContentV2,
    host: bool,
) -> Result<OwnedChoicePublication, Box<dyn Error>> {
    let mode = content
        .bundle()
        .bootstrap
        .modes
        .iter()
        .find(|mode| mode.cooperative && mode.supported)
        .ok_or("co-op mode missing")?;
    let mut frames = Vec::new();
    capture_press(kernel, &mut frames)?;
    navigate(kernel, &format!("bootstrap/mode/{}", mode.mode.get()))?;
    capture_press(kernel, &mut frames)?;
    if mode.challenge_selection && host {
        navigate(kernel, "bootstrap/challenge/done")?;
        capture_press(kernel, &mut frames)?;
    }
    let GameKernelLifecycleSnapshotV7::Bootstrap(before) = kernel.snapshot()?.lifecycle else {
        return Err("raw setup bypassed".into());
    };
    assert_eq!(before.stage, RunBootstrapStageV1::StarterSelect);
    let budget = usize::from(before.catalog.maximum_starter_cost);
    let capacity = 6.min(before.catalog.maximum_starters);
    // Evaluate only the actual catalog and level-five starting moves. The
    // previous base-stat-only choice had just five damaging PP; a party needs
    // enough usable attacks as well as strength to reach its next checkpoint.
    let mut choices = Vec::new();
    for starter in &before.catalog.starters {
        let species_id = er_types::battle_ids::SpeciesId::new(starter.species_id);
        let species = content.battle.species(species_id)?;
        let progression = content
            .progression
            .species(species_id, starter.form_index)
            .ok_or("starter progression absent")?;
        let mut moves = Vec::new();
        for entry in &progression.level_moves {
            if entry.level > 0 && entry.level <= 5 && !moves.contains(&entry.move_id) {
                moves.push(entry.move_id);
            }
        }
        let mut damaging_pp = 0_u64;
        let mut best_attack = 0_u64;
        for move_id in moves.into_iter().rev().take(4) {
            let definition = content.battle.move_definition(move_id)?;
            let er_types::battle_model::MovePower::Value(power) = definition.power else {
                continue;
            };
            if power == 0 {
                continue;
            }
            damaging_pp += u64::from(definition.base_pp);
            let offense = match definition.category {
                er_types::battle_model::MoveCategory::Physical => species.base_stats.attack,
                er_types::battle_model::MoveCategory::Special => species.base_stats.special_attack,
                er_types::battle_model::MoveCategory::Status => continue,
            };
            best_attack = best_attack.max(u64::from(power) * u64::from(offense));
        }
        if best_attack == 0 || damaging_pp == 0 {
            continue;
        }
        let bulk = u64::from(species.base_stats.hp)
            + u64::from(species.base_stats.defense)
            + u64::from(species.base_stats.special_defense);
        let score = best_attack * bulk * (20 + damaging_pp.min(120));
        choices.push((score, starter));
    }
    choices.sort_by_key(|(_, starter)| starter.pokemon_id);
    let mut plans = vec![vec![None; capacity + 1]; budget + 1];
    plans[0][0] = Some((0_u64, Vec::new()));
    for (score, starter) in choices {
        let cost = usize::from(starter.cost);
        if cost > budget {
            continue;
        }
        for spent in (cost..=budget).rev() {
            for count in (1..=capacity).rev() {
                let Some((previous_score, previous_party)) = plans[spent - cost][count - 1].clone()
                else {
                    continue;
                };
                let candidate_score = previous_score + score;
                if plans[spent][count]
                    .as_ref()
                    .is_none_or(|(best, _)| candidate_score > *best)
                {
                    let mut party = previous_party;
                    party.push(starter.pokemon_id);
                    plans[spent][count] = Some((candidate_score, party));
                }
            }
        }
    }
    let starters = plans
        .into_iter()
        .flatten()
        .flatten()
        .max_by_key(|(score, _)| *score)
        .ok_or("no affordable combat-ready party")?
        .1;
    assert!(
        !starters.is_empty(),
        "no legal offered starter fits the budget"
    );
    let selected = starters
        .iter()
        .map(|id| {
            before
                .catalog
                .starters
                .iter()
                .find(|starter| starter.pokemon_id == *id)
                .cloned()
                .ok_or("selected starter disappeared")
        })
        .collect::<Result<Vec<_>, _>>()?;
    for starter in &selected {
        navigate(
            kernel,
            &format!("bootstrap/starter/{}", starter.pokemon_id.get()),
        )?;
        capture_press(kernel, &mut frames)?;
    }
    navigate(kernel, "bootstrap/starter/confirm")?;
    capture_press(kernel, &mut frames)?;
    capture_press(kernel, &mut frames)?;
    if host {
        for _ in 0..4 {
            if kernel.state().is_some()
                || matches!(kernel.snapshot()?.lifecycle, GameKernelLifecycleSnapshotV7::Bootstrap(ref bootstrap) if bootstrap.stage == RunBootstrapStageV1::Complete)
            {
                break;
            }
            capture_press(kernel, &mut frames)?;
        }
    } else {
        assert!(
            matches!(kernel.snapshot()?.lifecycle, GameKernelLifecycleSnapshotV7::Bootstrap(ref bootstrap) if bootstrap.stage == RunBootstrapStageV1::WaitingForPartner)
        );
        assert_eq!(
            frames.len(),
            1,
            "confirmation itself publishes exactly one peer selection"
        );
    }
    Ok((selected, frames))
}

// The focused producer binds these bounded progress and completion receipts.
#[allow(clippy::print_stdout)]
#[test]
fn natural_owned_cooperative_campaign_reaches_wave_200_victory() -> Result<(), Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    let content = Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?);
    let generation = ConnectionGeneration::new(safe(1));
    let host_seat = SeatId::new(safe(1));
    let guest_seat = SeatId::new(safe(2));
    let mut host = owned_title(content.clone(), true)?;
    let mut guest = owned_title(content.clone(), false)?;
    let choose = choose_combat_party;
    let (guest_choices, frames) = choose(&mut guest, &content, false)?;
    let (host_choices, waiting) = choose(&mut host, &content, true)?;
    assert!(waiting.is_empty() && host.state().is_none());
    let started = wire(&host.ingest_network_frame(generation, &frames[0])?)?;
    guest.ingest_network_frame(generation, &started)?;
    assert_eq!(host.state(), guest.state());
    let initial_party = host
        .state()
        .and_then(|state| state.active_run.as_ref())
        .ok_or("run absent")?
        .party
        .clone();
    assert_eq!(
        initial_party.len(),
        host_choices.len() + guest_choices.len()
    );
    let mut remembered_proposals = std::collections::VecDeque::new();
    let mut retired_rejected = false;
    let mut proposals = 0;
    let mut materials = 0;
    let mut settled = 0;
    let mut rewards = 0;
    let mut progression = 0;
    let mut retained_human_commands = 0;
    let mut disconnected = false;
    let mut maximum_wave = 1;
    let mut replacements = 0;
    let mut saw_fainted_enemy = false;
    for decision in 0..30_000 {
        for kernel in [&mut host, &mut guest] {
            for pending in kernel.snapshot()?.pending_presentations {
                kernel.settle_presentation(pending.event_id)?;
                settled += 1;
            }
        }
        let run = host
            .state()
            .and_then(|state| state.active_run.as_ref())
            .ok_or("run absent")?;
        let wave = run.wave.get().get();
        assert!(
            wave == maximum_wave || wave == maximum_wave + 1,
            "natural wave skipped"
        );
        if wave != maximum_wave && wave % 10 == 0 {
            println!("cooperative campaign wave={wave} decisions={decision} proposals={proposals}");
        }
        maximum_wave = wave;
        if run.outcome == er_types::RunOutcome::Victory {
            assert_eq!(wave, 200);
            assert!(retired_rejected, "campaign must cross the unchanged proposal-history bound");
            assert!(disconnected && proposals >= 200 && materials >= 400 && settled >= 400);
            assert!(rewards >= 199 && progression >= 199 && retained_human_commands >= 200);
            assert_eq!(host.state(), guest.state());
            host = restored(&host, content.clone(), true)?;
            guest = restored(&guest, content.clone(), false)?;
            assert_eq!(host.state(), guest.state());
            println!(
                "M9E_NATURAL_COOP_CAMPAIGN wave=200 outcome=Victory decisions={decision} proposals={proposals} materials={materials} presentations={settled} rewards={rewards} progression={progression} replacements={replacements} fainted_enemy={saw_fainted_enemy}"
            );
            return Ok(());
        }
        assert_eq!(
            run.outcome,
            er_types::RunOutcome::InProgress,
            "natural cooperative campaign ended before wave200 Victory: wave={wave}, decision={decision}, party={:?}",
            run.party
        );
        let battle = run.battle.as_ref().ok_or("natural battle absent")?;
        saw_fainted_enemy |= battle.enemy_party.iter().any(|pokemon| pokemon.fainted);
        assert_eq!(battle.format.player_capacity, 2);
        assert_eq!(battle.format.enemy_capacity, 2);
        assert_eq!(battle.enemy_party.len(), 2);
        for (pokemon, initial) in run.party.iter().zip(&initial_party) {
            assert_eq!(
                (pokemon.id, pokemon.owner_seat),
                (initial.id, initial.owner_seat)
            );
        }
        if wave == 2 && !disconnected {
            let shared = host.state().cloned();
            host.transport_changed(generation, false)?;
            guest.transport_changed(generation, false)?;
            host = restored(&host, content.clone(), true)?;
            guest = restored(&guest, content.clone(), false)?;
            host.transport_changed(generation, true)?;
            guest.transport_changed(generation, true)?;
            assert_eq!(host.state(), shared.as_ref());
            assert_eq!(host.state(), guest.state());
            disconnected = true;
            continue;
        }
        let previous_turn = battle.turn;
        let control = host.current_control().ok_or("canonical control absent")?;
        let owner = control.owner_seat.unwrap_or(host_seat);
        assert!(owner == host_seat || owner == guest_seat);
        let is_host = owner == host_seat;
        let kernel = if is_host { &mut host } else { &mut guest };
        let kind = kernel.current_control().ok_or("owned control absent")?.kind;
        match kind {
            er_types::GameControlKindV2::BattleMove => choose_play_move(kernel, &content, owner)?,
            er_types::GameControlKindV2::Reward => rewards += 1,
            er_types::GameControlKindV2::Progression | er_types::GameControlKindV2::MoveLearn
            | er_types::GameControlKindV2::Evolution => progression += 1,
            er_types::GameControlKindV2::BattleReplacement => replacements += 1,
            er_types::GameControlKindV2::BattleCommand | er_types::GameControlKindV2::BattleTarget
            | er_types::GameControlKindV2::BattleSwitch => {}
            other => return Err(format!("unhandled natural cooperative control {other:?} at wave={wave}, decision={decision}").into()),
        }
        let step = play_press(kernel).map_err(|error| format!("natural cooperative input wave={wave}, decision={decision}, owner={owner:?}, kind={kind:?}: {error}"))?;
        for effect in &step.effects {
            if let GameKernelEffectV7::ProposalReady { bytes, .. } = effect {
                let envelope: er_kernel::game_kernel_v7::GameProposalEnvelopeV2 = serde_json::from_slice(bytes)?;
                if remembered_proposals.len() == 65 {
                    remembered_proposals.pop_front();
                }
                remembered_proposals.push_back((envelope.proposal.context.operation_id, bytes.clone()));
            }
        }
        let (new_proposals, new_materials) = deliver_play_step(&mut host, &mut guest, step, is_host, false)
            .map_err(|error| format!("natural cooperative delivery wave={wave}, decision={decision}, kind={kind:?}: {error}"))?;
        proposals += new_proposals;
        materials += new_materials;
        let snapshot = host.snapshot()?;
        let admission = snapshot.protocol.as_ref().and_then(|protocol| protocol.proposal_admission.as_ref())
            .ok_or("authority admission state absent")?;
        assert_eq!(admission.capacity.get(), 64);
        assert!(admission.fingerprints.len() <= 64);
        if proposals > 64 && !retired_rejected {
            if let Some((_, stale)) = remembered_proposals.iter().find(|(operation, _)|
                !admission.fingerprints.iter().any(|entry| &entry.operation_id == operation)) {
                assert!(host.ingest_network_frame(generation, stale).is_err());
                assert_eq!(host.snapshot()?, snapshot, "retired proposal changed authority state");
                host = restored(&host, content.clone(), true)?;
                guest = restored(&guest, content.clone(), false)?;
                assert_eq!(host.state(), guest.state());
                retired_rejected = true;
            }
        }
        if let Some(battle) = host
            .state()
            .and_then(|state| state.active_run.as_ref())
            .and_then(|run| run.battle.as_ref())
            && battle.wave.get().get() == wave
            && battle.command_state.frontier.len() == 1
        {
            assert_eq!(
                battle.turn, previous_turn,
                "first human command prematurely resolved turn"
            );
            retained_human_commands += 1;
        }
    }
    Err(format!("natural cooperative decisions exhausted at wave={maximum_wave}").into())
}
