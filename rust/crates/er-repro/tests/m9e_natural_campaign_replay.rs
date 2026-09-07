use std::error::Error;
use std::io::Write;
use std::sync::Arc;

use er_env::current::{CurrentExternalEvent, CurrentGameSession};
use er_game::m9e_content_v2::{GameContentBundleV2, PreparedGameContentV2};
use er_kernel::game_kernel_v7::{
    GameKernelRoleV7, GameKernelStepV7, GameKernelV7, KernelPresentationOutcomeV2,
};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::{CoreGameKernelSnapshotV7, GameKernelLifecycleSnapshotV7};
use er_repro::current::{
    CurrentCaptureStatusV1, CurrentReproCapsuleV1, CurrentReproLimitsV1, CurrentReproRecorderV1,
};
use er_state::m7_state::{
    DexState, PROFILE_STATE_SCHEMA_VERSION_V1, ProfileStateV1, ProfileStatistics,
};
use er_types::battle_ids::WaveIndex;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use er_types::{GameActionV1, GameControlKindV2, RunOutcome, SafeU53, SeatId};

const BUNDLE: &[u8] =
    include_bytes!("../../../fixtures/m9/engineering/game-content-bundle-v2.json");

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("test value is safe")
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

fn content() -> Result<Arc<PreparedGameContentV2>, Box<dyn Error>> {
    let bundle: GameContentBundleV2 = serde_json::from_slice(BUNDLE)?;
    Ok(Arc::new(PreparedGameContentV2::prepare(Arc::new(bundle))?))
}

fn scheduler() -> KernelSchedulerSnapshotV2 {
    KernelSchedulerSnapshotV2 {
        next_timer_id: Some(SafeU53::ZERO),
        timers: Vec::new(),
        pauses: Vec::new(),
        disposed: false,
    }
}

// Every external input is captured. Consecutive bounded capsules cover the
// whole journey, with no rolling-window loss or uncaptured setup actions.
struct CampaignRecorder {
    session: CurrentGameSession,
    recorder: CurrentReproRecorderV1,
    content: Arc<PreparedGameContentV2>,
    checkpoint: CoreGameKernelSnapshotV7,
    base: u64,
    position: u64,
    segments: usize,
    presentations: usize,
}

impl std::ops::Deref for CampaignRecorder {
    type Target = GameKernelV7;

    fn deref(&self) -> &Self::Target {
        self.session
            .kernel_ref()
            .expect("campaign session remains live")
    }
}

impl CampaignRecorder {
    fn capture(&mut self, event: CurrentExternalEvent) -> Result<GameKernelStepV7, Box<dyn Error>> {
        let before = self.session.snapshot()?;
        let result = self.session.apply(event.clone());
        let after = self.session.snapshot()?;
        let observation = self.session.observe()?;
        let status = self
            .recorder
            .record(&before, event, result.as_ref(), &after, &observation);
        self.position += 1;
        assert_eq!(
            status,
            CurrentCaptureStatusV1::Available {
                base_position: self.base,
                final_position: self.position,
            }
        );
        let step = result?;
        // The first segment ends with Space still held, proving that decoding
        // and importing a capsule preserves input state before the key-up.
        // Starter catalogs make each bootstrap observation large. Export each
        // bootstrap event before the bounded recorder could rotate it away.
        if self.session.kernel_ref()?.state().is_none() || self.position - self.base == 64 {
            self.flush()?;
        }
        Ok(step)
    }

    fn raw_input(&mut self, input: RawInputEvent) -> Result<GameKernelStepV7, Box<dyn Error>> {
        self.capture(CurrentExternalEvent::RawInput { input })
    }

    fn settle_presentation(
        &mut self,
        event_id: er_types::PresentationEventId,
    ) -> Result<(), Box<dyn Error>> {
        self.capture(CurrentExternalEvent::PresentationOutcome {
            event_id,
            outcome: KernelPresentationOutcomeV2::Settled,
        })?;
        self.presentations += 1;
        Ok(())
    }

    fn flush(&mut self) -> Result<(), Box<dyn Error>> {
        if self.position == self.base {
            return Ok(());
        }
        let capsule = self.recorder.export()?;
        assert_eq!(capsule.base_position, self.base);
        assert_eq!(capsule.final_position, self.position);
        assert_eq!(capsule.attempts.len() as u64, self.position - self.base);
        assert_eq!(*capsule.checkpoint, self.checkpoint);
        let expected = self.session.snapshot()?;
        let expected_observation = self.session.observe()?;
        let encoded = serde_json::to_vec(&capsule)?;
        assert!(encoded.len() <= CurrentReproLimitsV1::default().maximum_bytes);
        let decoded: CurrentReproCapsuleV1 = serde_json::from_slice(&encoded)?;
        assert_eq!(decoded, capsule);
        let (imported, resumed) = CurrentReproRecorderV1::from_capsule(
            decoded.clone(),
            self.content.clone(),
            CurrentReproLimitsV1::default(),
        )?;
        assert_eq!(imported.export()?, decoded);
        assert_eq!(resumed.snapshot()?, expected);
        assert_eq!(resumed.observe()?, expected_observation);
        resumed.validate()?;
        // Continue the actual policy on the isolated replay result, so every
        // following wave depends on correctly restored persistent state.
        self.session = resumed;
        self.checkpoint = expected;
        self.base = self.position;
        self.recorder = CurrentReproRecorderV1::new_at_position(
            self.checkpoint.clone(),
            SeatId::new(safe(1)),
            GameKernelRoleV7::Authority,
            self.content.clone(),
            CurrentReproLimitsV1::default(),
            self.position,
        )?;
        self.segments += 1;
        if self.segments % 64 == 0 {
            let wave = self.session.kernel_ref()?.state().and_then(|state| state.active_run.as_ref())
                .map(|run| run.wave.get().get()).unwrap_or(0);
            writeln!(std::io::stdout().lock(), "M9E_REPLAY_PROGRESS events={} segments={} wave={wave}", self.position, self.segments)?;
        }
        Ok(())
    }
}

fn kernel(content: Arc<PreparedGameContentV2>) -> Result<CampaignRecorder, Box<dyn Error>> {
    let session = CurrentGameSession::natural_start_with_scheduler(
        profile()?,
        "m9e-natural-campaign-200-v1".to_owned(),
        SeatId::new(safe(1)),
        vec!["preview-slot".to_owned()],
        true,
        content.clone(),
        scheduler(),
        None,
    )?;
    let checkpoint = session.snapshot()?;
    let recorder = CurrentReproRecorderV1::new(
        checkpoint.clone(),
        SeatId::new(safe(1)),
        GameKernelRoleV7::Authority,
        content.clone(),
        CurrentReproLimitsV1::default(),
    )?;
    Ok(CampaignRecorder {
        session,
        recorder,
        content,
        checkpoint,
        base: 0,
        position: 0,
        segments: 0,
        presentations: 0,
    })
}

fn key_down(key: PhysicalKey) -> RawInputEvent {
    RawInputEvent::KeyDown {
        code: key,
        printable: false,
        browser_repeat: false,
        focus: InputFocus::Game,
    }
}

fn press(
    kernel: &mut CampaignRecorder,
    key: PhysicalKey,
) -> Result<GameKernelStepV7, Box<dyn Error>> {
    let step = kernel.raw_input(key_down(key.clone()))?;
    kernel.raw_input(RawInputEvent::KeyUp { code: key })?;
    Ok(step)
}

fn navigate_to(kernel: &mut CampaignRecorder, option: &str) -> Result<(), Box<dyn Error>> {
    // Use only the navigation graph exposed by the actual current control.
    // Preserve the same starter/move choices without walking the long way
    // around the catalog or omitting any event from causal recording.
    let route = {
        let menu = kernel.current_control().and_then(|control| control.menu.as_ref())
            .ok_or("current control has no menu")?;
        let start = menu.selected_option_id.as_str();
        let mut adjacent = std::collections::BTreeMap::<&str, Vec<_>>::new();
        for edge in &menu.navigation {
            adjacent.entry(edge.from.as_str()).or_default().push(edge);
        }
        let mut queue = std::collections::VecDeque::from([start]);
        let mut seen = std::collections::BTreeSet::from([start]);
        let mut previous = std::collections::BTreeMap::new();
        while let Some(node) = queue.pop_front() {
            if node == option {
                break;
            }
            for edge in adjacent.get(node).into_iter().flatten() {
                if seen.insert(edge.to.as_str()) {
                    let key = match edge.direction {
                        er_types::NavigationDirection::Up => PhysicalKey::ArrowUp,
                        er_types::NavigationDirection::Down => PhysicalKey::ArrowDown,
                        er_types::NavigationDirection::Left => PhysicalKey::ArrowLeft,
                        er_types::NavigationDirection::Right => PhysicalKey::ArrowRight,
                    };
                    previous.insert(edge.to.as_str(), (node, key));
                    queue.push_back(edge.to.as_str());
                }
            }
        }
        let mut keys = Vec::new();
        let mut cursor = option;
        while cursor != start {
            let (parent, key) = previous.get(cursor).ok_or("offered option is not reachable")?;
            keys.push(key.clone());
            cursor = parent;
        }
        keys.reverse();
        keys
    };
    for key in route {
        press(kernel, key)?;
    }
    if !kernel.current_control().and_then(|control| control.menu.as_ref())
        .is_some_and(|menu| menu.selected_option_id == option) {
        return Err("raw navigation did not reach its offered option".into());
    }
    Ok(())
}

fn submit_strongest_move(
    kernel: &mut CampaignRecorder,
    content: &PreparedGameContentV2,
) -> Result<GameKernelStepV7, Box<dyn Error>> {
    let menu = kernel
        .current_control()
        .and_then(|control| control.menu.as_ref())
        .ok_or("move menu is absent")?;
    let state = kernel.state().ok_or("state is absent")?;
    let run = state.active_run.as_ref().ok_or("run is absent")?;
    let battle = run.battle.as_ref().ok_or("battle is absent")?;
    let source_slot = battle
        .field
        .slots
        .iter()
        .find(|slot| {
            slot.slot.side == er_types::battle_ids::BattleSide::Player && slot.occupant.is_some()
        })
        .ok_or("player field is absent")?
        .slot;
    let target_slot = battle
        .field
        .slots
        .iter()
        .find(|slot| {
            slot.slot.side == er_types::battle_ids::BattleSide::Enemy && slot.occupant.is_some()
        })
        .ok_or("enemy field is absent")?
        .slot;
    let target_option = menu
        .options
        .iter()
        .filter_map(|option| {
            let GameActionV1::Battle {
                action: er_types::BattleUiActionV1::SelectMove { move_slot, .. },
            } = option.action
            else {
                return None;
            };
            let damage = er_battle::m7_resolver::query_simulated_move_damage_v5(
                &content.battle,
                run,
                source_slot,
                move_slot,
                target_slot,
            )
            .ok()?;
            Some((damage, option.option_id.clone()))
        })
        .max_by_key(|(damage, _)| *damage)
        .map(|(_, option)| option)
        .or_else(|| {
            menu.options
                .iter()
                .find(|option| {
                    let GameActionV1::Battle {
                        action: er_types::BattleUiActionV1::SelectMove { move_slot, .. },
                    } = option.action
                    else {
                        return false;
                    };
                    let Some(actor) = run.party.iter().find(|pokemon| {
                        battle.field.slots.iter().any(|slot| {
                            slot.slot == source_slot && slot.occupant == Some(pokemon.id)
                        })
                    }) else {
                        return false;
                    };
                    let Some(slot) = actor.moves[usize::from(move_slot.get())] else {
                        return false;
                    };
                    let Ok(definition) = content.battle.move_definition(slot.move_id) else {
                        return false;
                    };
                    er_state::pokemon::calculate_max_pp(
                        definition.base_pp,
                        slot.pp_ups,
                        slot.max_pp_override,
                    )
                    .is_ok_and(|maximum| slot.pp_used < maximum)
                })
                .map(|option| option.option_id.clone())
        })
        .ok_or_else(|| {
            format!(
                "no offered move: actions={:?}; party={:?}",
                menu.options
                    .iter()
                    .map(|option| &option.action)
                    .collect::<Vec<_>>(),
                run.party
                    .iter()
                    .map(|pokemon| (pokemon.id, pokemon.species_id, pokemon.hp, pokemon.moves))
                    .collect::<Vec<_>>()
            )
        })?;
    navigate_to(kernel, target_option.as_str())?;
    press(kernel, PhysicalKey::Space)
}

/// One deterministic policy attempt from genuine empty Title setup. A loss,
/// unsupported handler, capacity failure, or shortened run is not completion.
#[test]
fn natural_current_campaign_replays_every_external_input_and_resumes_to_wave_200()
-> Result<(), Box<dyn Error>> {
    let content = content()?;
    let mut kernel = kernel(content.clone())?;
    press(&mut kernel, PhysicalKey::Space)?;
    press(&mut kernel, PhysicalKey::Space)?;
    let GameKernelLifecycleSnapshotV7::Bootstrap(bootstrap) = kernel.snapshot()?.lifecycle else {
        return Err("natural starter setup missing".into());
    };
    let budget = usize::from(bootstrap.catalog.maximum_starter_cost);
    let capacity = 6.min(bootstrap.catalog.maximum_starters);
    // Evaluate only the actual catalog and level-five starting moves. The
    // previous base-stat-only choice had just five damaging PP; a party needs
    // enough usable attacks as well as strength to reach its next checkpoint.
    let mut choices = Vec::new();
    for starter in &bootstrap.catalog.starters {
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
    for starter in starters {
        navigate_to(&mut kernel, &format!("bootstrap/starter/{}", starter.get()))?;
        press(&mut kernel, PhysicalKey::Space)?;
    }
    navigate_to(&mut kernel, "bootstrap/starter/confirm")?;
    for _ in 0..4 {
        press(&mut kernel, PhysicalKey::Space)?;
    }
    let mut recent_decisions = std::collections::VecDeque::new();
    let mut maximum_wave = 0;
    let mut saw_reward = false;
    let mut saw_progression = false;
    for step_index in 0..20_000 {
        for pending in kernel.snapshot()?.pending_presentations {
            kernel.settle_presentation(pending.event_id)?;
        }
        let state = kernel.state().ok_or("current campaign state absent")?;
        let run = state
            .active_run
            .as_ref()
            .ok_or("current campaign run absent")?;
        let wave = run.wave.get().get();
        if wave > maximum_wave {
            assert_eq!(wave, maximum_wave + 1, "campaign skipped a natural wave");
            maximum_wave = wave;
        }
        let party = run
            .party
            .iter()
            .map(|pokemon| {
                (
                    pokemon.id.get().get(),
                    pokemon.species_id.get().get(),
                    pokemon.level,
                    pokemon.hp,
                    pokemon
                        .moves
                        .map(|slot| slot.map(|value| (value.move_id.get().get(), value.pp_used))),
                )
            })
            .collect::<Vec<_>>();
        let enemy = run
            .battle
            .as_ref()
            .map(|battle| {
                battle
                    .enemy_party
                    .iter()
                    .map(|pokemon| {
                        (
                            pokemon.id.get().get(),
                            pokemon.species_id.get().get(),
                            pokemon.level,
                            pokemon.hp,
                            pokemon.moves.map(|slot| {
                                slot.map(|value| (value.move_id.get().get(), value.pp_used))
                            }),
                        )
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if recent_decisions.len() == 8 {
            recent_decisions.pop_front();
        }
        recent_decisions.push_back(format!(
            "decision={step_index}; wave={wave}; party={party:?}; enemy={enemy:?}"
        ));
        if run.outcome != RunOutcome::InProgress {
            assert_eq!(
                wave, 200,
                "short campaign is not the full policy witness: {recent_decisions:?}"
            );
            assert_eq!(run.outcome, RunOutcome::Victory, "campaign did not win");
            assert!(
                saw_reward && saw_progression,
                "campaign bypassed progression or rewards"
            );
            assert_eq!(
                kernel.current_control().map(|control| control.kind),
                Some(GameControlKindV2::Complete)
            );
            kernel.snapshot()?.validate(&content)?;
            kernel.flush()?;
            assert_eq!(kernel.base, kernel.position);
            assert!(kernel.position > 800 && kernel.segments > 10 && kernel.presentations > 0);
            writeln!(
                std::io::stdout().lock(),
                "M9E_CAMPAIGN_REPLAY events={} segments={} presentations={} wave=200 outcome=Victory",
                kernel.position,
                kernel.segments,
                kernel.presentations
            )?;
            return Ok(());
        }
        let kind = kernel
            .current_control()
            .map(|control| control.kind)
            .ok_or("campaign control absent")?;
        let action = match kind {
            GameControlKindV2::BattleMove => submit_strongest_move(&mut kernel, &content),
            GameControlKindV2::BattleCommand
            | GameControlKindV2::BattleTarget
            | GameControlKindV2::BattleSwitch
            | GameControlKindV2::BattleReplacement => press(&mut kernel, PhysicalKey::Space),
            GameControlKindV2::Progression
            | GameControlKindV2::MoveLearn
            | GameControlKindV2::Evolution => {
                saw_progression = true;
                press(&mut kernel, PhysicalKey::Space)
            }
            GameControlKindV2::Reward => {
                saw_reward = true;
                press(&mut kernel, PhysicalKey::Space)
            }
            other => return Err(format!(
                "unhandled natural campaign control {other:?} at wave={wave}, decision={step_index}"
            )
            .into()),
        };
        action.map_err(|error| format!("natural campaign failed at wave={wave}, decision={step_index}, control={kind:?}: {error}"))?;
    }
    Err(format!("natural campaign exhausted decision bound at wave={maximum_wave}").into())
}
