//! Public captured clock completion and bounded automatic phase continuation.
use super::*;
use er_game::m9e_runtime_v6::GameOwnedPhaseV1;
use er_state::current_turn_execution::CurrentTurnStageV1;

pub(crate) fn victory_presentation(
    state: &GameStateV6,
    event_id: er_types::PresentationEventId,
) -> Option<crate::snapshot_v7::PendingVictoryAckV1> {
    use er_state::current_victory_execution::CurrentVictoryDescendantV1 as D;
    state
        .current_battle_participation
        .as_ref()?
        .experience
        .as_ref()?
        .pending
        .iter()
        .find_map(|pending| {
            let expected = match &pending.victory.as_ref()?.descendant {
                D::AwardPresentation { event_id, .. }
                | D::PartyAwardPresentation { event_id, .. }
                | D::LevelUpPresentation { event_id, .. }
                | D::HidePartyBarPresentation { event_id, .. } => *event_id,
                _ => return None,
            };
            (expected == event_id).then_some(crate::snapshot_v7::PendingVictoryAckV1 {
                pending: pending.id,
                event_id,
            })
        })
}

pub(crate) fn victory_receipt_matches(
    state: &GameStateV6,
    content: &PreparedGameContentV2,
    ack: crate::snapshot_v7::PendingVictoryAckV1,
) -> bool {
    use er_game::m9e_content_v2::{PresentationCueFamilyV1, PresentationSemanticIdV1};
    use er_game::m9e_material_v6::GamePresentationPayloadV1 as P;
    use er_state::current_victory_execution::CurrentVictoryDescendantV1 as D;
    let payload = (|| {
        let pending = state
            .current_battle_participation
            .as_ref()?
            .experience
            .as_ref()?
            .pending
            .iter()
            .find(|pending| pending.id == ack.pending)?;
        Some(match &pending.victory.as_ref()?.descendant {
            D::AwardPresentation { award, event_id } if *event_id == ack.event_id => {
                P::ExperienceGain {
                    holder: award.phase.pokemon,
                    amount: award.experience,
                    party_bar: false,
                }
            }
            D::PartyAwardPresentation {
                award, event_id, ..
            } if *event_id == ack.event_id => P::ExperienceGain {
                holder: award.phase.pokemon,
                amount: award.experience,
                party_bar: true,
            },
            D::LevelUpPresentation { end, event_id } if *event_id == ack.event_id => {
                let level = &end.level_up;
                let pokemon = state
                    .active_run
                    .as_ref()?
                    .party
                    .get(usize::from(level.award.phase.party_index))?;
                P::LevelStats {
                    holder: pokemon.id,
                    previous_level: level.previous_level,
                    level: level.new_level,
                    previous_stats: level.previous_stats,
                    stats: pokemon.stats,
                }
            }
            D::HidePartyBarPresentation { award, event_id } if *event_id == ack.event_id => {
                P::HidePartyExperience {
                    holder: award.phase.pokemon,
                }
            }
            _ => return None,
        })
    })();
    let Some(payload) = payload else {
        return false;
    };
    let semantic = PresentationSemanticIdV1::Cue(PresentationCueFamilyV1::Progression);
    let Some(mapping) = content.presentation(semantic) else {
        return false;
    };
    let effect = GamePresentationEffectV2 {
        event_id: ack.event_id,
        semantic,
        blocking: mapping.blocking,
        skip: mapping.skip,
        payload: Some(payload),
    };
    er_canonical::fixture_digest(&effect)
        .ok()
        .is_some_and(|hash| {
            state.current_presentation.as_ref().is_some_and(|owner| {
                owner.receipts.iter().any(|receipt| {
                    receipt.event_id == ack.event_id && receipt.effect_sha256 == hash
                })
            })
        })
}

pub(super) fn bootstrap_clock_effect(
    bootstrap: &RunBootstrapMachineV1,
) -> Option<GamePlatformEffectV2> {
    bootstrap.current_starter_pokerus_pending().map(|pending| {
        GamePlatformEffectV2::StarterPokerusClock {
            request: pending.request_id,
            context: pending.context,
        }
    })
}

impl GameKernelV7 {
    pub fn apply_current_flash_egg_inputs(
        &mut self,
        input: er_state::current_achievement_execution::CurrentFlashEggInputsV1,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        self.require_current_rebind_gameplay()?;
        if self.role != GameKernelRoleV7::Authority || !input.valid() {
            return Err(GameKernelV7Error::Invalid);
        }
        let pending = self
            .pending_platform
            .get(&input.request)
            .ok_or(GameKernelV7Error::Invalid)?;
        if !matches!(&pending.effect, GamePlatformEffectV2::CurrentFlashEgg { request }
            if request.request == input.request && request.pending == input.pending)
        {
            return Err(GameKernelV7Error::Invalid);
        }
        let mut candidate = self.clone();
        candidate.pending_platform.remove(&input.request);
        let step = candidate.execute_owned_phase(GameOwnedPhaseV1::FlashEgg {
            input: Box::new(input),
        })?;
        candidate.validate()?;
        *self = candidate;
        Ok(step)
    }
    pub fn apply_current_utc_clock_result(
        &mut self,
        request_id: PlatformRequestId,
        utc_milliseconds: i64,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        self.require_current_rebind_gameplay()?;
        if self.role != GameKernelRoleV7::Authority
            || !(-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&utc_milliseconds)
        {
            return Err(GameKernelV7Error::Invalid);
        }
        let mut candidate = self.clone();
        let pending = candidate
            .pending_platform
            .get(&request_id)
            .ok_or(GameKernelV7Error::Invalid)?;
        if let GamePlatformEffectV2::StarterPokerusClock { request, context } = &pending.effect {
            let GameKernelLifecycleV7::Bootstrap(bootstrap) = &mut candidate.lifecycle else {
                return Err(GameKernelV7Error::Invalid);
            };
            if *request != request_id
                || context.local_seat != candidate.local_seat
                || bootstrap_clock_effect(bootstrap).as_ref() != Some(&pending.effect)
            {
                return Err(GameKernelV7Error::Invalid);
            }
            bootstrap
                .accept_starter_pokerus_clock(request_id, utc_milliseconds, candidate.local_seat)
                .map_err(|error| GameKernelV7Error::Bootstrap(error.to_string()))?;
            let control = bootstrap.control.clone();
            candidate.next_menu_instance_id = next_menu_after(bootstrap.menu_instance_high_water)?;
            candidate.pending_platform.remove(&request_id);
            candidate.advance_replay_sequence()?;
            candidate.validate()?;
            *self = candidate;
            return Ok(GameKernelStepV7 {
                effects: vec![GameKernelEffectV7::UiChanged(control)],
                internal_events: Vec::new(),
            });
        }
        let phase = match &pending.effect {
            GamePlatformEffectV2::CurrentFriendshipClock { request }
                if request.request == request_id =>
            {
                GameOwnedPhaseV1::FriendshipClock {
                    request: request.clone(),
                    utc_milliseconds,
                }
            }
            GamePlatformEffectV2::CurrentAchievementClock { request }
                if request.request == request_id =>
            {
                GameOwnedPhaseV1::AchievementClock {
                    request: *request,
                    utc_milliseconds,
                }
            }
            _ => return Err(GameKernelV7Error::Invalid),
        };
        // The exact retained source request is consumed only in the cloned
        // transaction. Callback rejection, material caps or output admission
        // preserve both the original clock and physical/private state.
        candidate.pending_platform.remove(&request_id);
        let step = candidate.execute_owned_phase(phase)?;
        candidate.validate()?;
        *self = candidate;
        Ok(step)
    }

    pub(super) fn resume_owned_phase(
        &mut self,
        output: &mut GameKernelStepV7,
    ) -> Result<(), GameKernelV7Error> {
        if self.role != GameKernelRoleV7::Authority
            || self.pending_presentations.values().any(|pending| {
                pending.blocking
                    == er_types::battle_ui::PresentationBlockingPolicy::BlocksHumanInput
            })
        {
            return Ok(());
        }
        let GameKernelLifecycleV7::Active(runtime) = &self.lifecycle else {
            return Ok(());
        };
        let Some(state) = runtime.state() else {
            return Ok(());
        };
        if let Some(pending) = state
            .current_battle_participation
            .as_ref()
            .and_then(|p| p.experience.as_ref())
            .and_then(|o| o.pending.first())
            && let Some(tail) = &pending.victory_tail
        {
            if tail
                .flash
                .as_ref()
                .is_some_and(|flash| flash.clock.is_some() || flash.egg_request.is_some())
            {
                return Ok(());
            }
            use er_state::current_initial_victory_tail::CurrentInitialVictoryTailPhaseV1 as T;
            if matches!(&tail.phase, T::RewardSelectionPending { .. }) {
                if tail.reward.is_none() {
                    if self.pending_current_phase_ack.is_some() {
                        return Err(GameKernelV7Error::Invalid);
                    }
                    let phase = GameOwnedPhaseV1::RewardBegin {
                        pending: pending.id,
                        menu_instance: self.next_menu_instance_id,
                    };
                    let step = self.execute_owned_phase(phase)?;
                    output.effects.extend(step.effects);
                    output.internal_events.extend(step.internal_events);
                }
                // Choices wait for physical input. Applied receipts remain owned
                // until the subsequent encounter has its own causal transition.
                return Ok(());
            }
            if matches!(
                &tail.phase,
                T::TurnSettlement { .. } | T::BattleEnd { .. } | T::EggLapse { .. }
            ) {
                if self.pending_current_phase_ack.is_some() {
                    return Err(GameKernelV7Error::Invalid);
                }
                let phase = GameOwnedPhaseV1::VictoryTail {
                    pending: pending.id,
                };
                let step = self.execute_owned_phase(phase)?;
                output.effects.extend(step.effects);
                output.internal_events.extend(step.internal_events);
                return Ok(());
            }
        }
        let Some(turn) = &state.current_turn_execution else {
            return Ok(());
        };
        if current_learning_control_v7::current_batch(state).is_some() {
            current_learning_control_v7::validate_private_learning_control(
                state,
                self.private_learning_control.as_ref(),
                self.local_seat,
            )?;
            // Human learning choices are never synthesized by the phase pump.
            return Ok(());
        }
        if let Some(ack) = self.pending_current_phase_ack {
            if !current_phase_receipt_v7::receipt_matches(state, &self.content, ack) {
                return Err(GameKernelV7Error::Invalid);
            }
            // AdvanceTime already operates on a cloned kernel transaction.
            // Consume before transition validation; errors discard the clone.
            self.pending_current_phase_ack = None;
            use crate::snapshot_v7::CurrentPhasePresentationKindV1 as K;
            let phase = match ack.kind {
                K::Victory => GameOwnedPhaseV1::VictoryPresentation {
                    pending: ack.pending,
                    event_id: ack.event_id,
                },
                K::FaintAnimation | K::FaintMessage => GameOwnedPhaseV1::FaintPresentation {
                    pending: ack.pending,
                    event_id: ack.event_id,
                    animation: ack.kind == K::FaintAnimation,
                },
            };
            let step = self.execute_owned_phase(phase)?;
            output.effects.extend(step.effects);
            output.internal_events.extend(step.internal_events);
            return Ok(());
        }
        let phase = match &turn.stage {
            CurrentTurnStageV1::ReadyForMove => {
                if usize::from(turn.next_action) < turn.actions.len() {
                    GameOwnedPhaseV1::TurnStep
                } else {
                    GameOwnedPhaseV1::TurnFinish
                }
            }
            CurrentTurnStageV1::AwaitingInterlude { .. } => {
                use er_state::current_faint_execution::CurrentFaintPhaseV1 as F;
                let owner = state
                    .current_battle_participation
                    .as_ref()
                    .and_then(|owner| owner.experience.as_ref())
                    .ok_or(GameKernelV7Error::Invalid)?;
                let pending = owner.pending.first().ok_or(GameKernelV7Error::Invalid)?;
                let source = owner
                    .source_progression
                    .as_ref()
                    .ok_or(GameKernelV7Error::Invalid)?;
                match &source.initial_faint.phase {
                    None => GameOwnedPhaseV1::FaintBegin {
                        pending: pending.id,
                    },
                    Some(F::Animation { .. } | F::Message { .. }) => return Ok(()),
                    Some(F::MessageReady { .. }) => return Err(GameKernelV7Error::Invalid),
                    Some(F::ReadyForVictory { address }) => {
                        if address.pending_id != pending.id {
                            return Err(GameKernelV7Error::Invalid);
                        }
                        let friendship = pending
                            .friendship
                            .as_ref()
                            .ok_or(GameKernelV7Error::Invalid)?;
                        if pending
                            .victory
                            .as_ref()
                            .and_then(|v| v.level_achievements.as_ref())
                            .and_then(|v| v.clock.as_ref())
                            .is_some()
                        {
                            return Ok(());
                        }
                        if friendship.complete {
                            GameOwnedPhaseV1::Victory {
                                pending: pending.id,
                                menu_instance: self.next_menu_instance_id,
                            }
                        } else if friendship.clock.is_some() {
                            return Ok(());
                        } else {
                            GameOwnedPhaseV1::FriendshipBegin
                        }
                    }
                }
            }
            CurrentTurnStageV1::Complete => return Ok(()),
        };
        let step = self.execute_owned_phase(phase)?;
        output.effects.extend(step.effects);
        output.internal_events.extend(step.internal_events);
        Ok(())
    }

    fn execute_owned_phase(
        &mut self,
        phase: GameOwnedPhaseV1,
    ) -> Result<GameKernelStepV7, GameKernelV7Error> {
        let runtime = self.active_runtime()?;
        let state = runtime.state().ok_or(GameKernelV7Error::Invalid)?;
        let run = state
            .active_run
            .as_ref()
            .ok_or(GameKernelV7Error::Invalid)?;
        let authority_seat = run
            .battle
            .as_ref()
            .ok_or(GameKernelV7Error::Invalid)?
            .authority_seat;
        let operation_id = OperationId::new(format!(
            "current/phase/{}/{}/{}",
            run.run_id.get().get(),
            run.wave.get().get(),
            runtime.next_authority_revision().get()
        ))
        .map_err(|_| GameKernelV7Error::Invalid)?;
        let mut staged = GameRuntimeV6::from_snapshot_with_retention(
            runtime.snapshot(),
            self.content.clone(),
            MATERIAL_RETENTION_V7,
        )
        .map_err(runtime_error)?;
        let mut step = execute_current_transaction(
            &mut staged,
            GameInternalEventV2::OwnedPhaseRequested {
                operation_id,
                authority_seat,
                phase,
            },
        )?;
        self.install_step_effects(&step.effects)?;
        self.lifecycle = GameKernelLifecycleV7::Active(staged);
        self.synchronize_menu_allocator()?;
        self.advance_replay_sequence()?;
        self.synchronize_terminal(&mut step)?;
        Ok(step)
    }
}
