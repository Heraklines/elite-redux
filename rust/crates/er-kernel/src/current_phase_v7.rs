//! Public captured clock completion and bounded automatic phase continuation.
use super::*;
use er_game::m9e_runtime_v6::GameOwnedPhaseV1;
use er_state::current_turn_execution::CurrentTurnStageV1;
use er_state::current_victory_execution::CurrentVictoryDescendantV1;
use er_state::m9e_state_v6::GameStateV6;

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
        let GamePlatformEffectV2::CurrentFriendshipClock { request } = &pending.effect else {
            return Err(GameKernelV7Error::Invalid);
        };
        if request.request != request_id {
            return Err(GameKernelV7Error::Invalid);
        }
        let phase = GameOwnedPhaseV1::FriendshipClock {
            request: request.clone(),
            utc_milliseconds,
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
        let Some(turn) = &state.current_turn_execution else {
            return Ok(());
        };
        let phase = match &turn.stage {
            CurrentTurnStageV1::ReadyForMove => {
                if usize::from(turn.next_action) < turn.actions.len() {
                    GameOwnedPhaseV1::TurnStep
                } else {
                    GameOwnedPhaseV1::TurnFinish
                }
            }
            CurrentTurnStageV1::AwaitingInterlude { .. } => {
                let Some(phase) = self.next_intermission_phase(state)? else {
                    return Ok(());
                };
                phase
            }
            CurrentTurnStageV1::Complete => return Ok(()),
        };
        let step = self.execute_owned_phase(phase)?;
        output.effects.extend(step.effects);
        output.internal_events.extend(step.internal_events);
        Ok(())
    }

    /// The next retained interlude step for the oldest unresolved pending.
    /// `None` means an external edge owns the next step: an outstanding
    /// friendship clock request, an unacknowledged retained prompt, or an
    /// actionable learn/evolution control that belongs to the human owner.
    fn next_intermission_phase(
        &self,
        state: &GameStateV6,
    ) -> Result<Option<GameOwnedPhaseV1>, GameKernelV7Error> {
        let owner = state
            .current_battle_participation
            .as_ref()
            .and_then(|value| value.experience.as_ref())
            .ok_or(GameKernelV7Error::Invalid)?;
        let Some(pending) = owner.pending.iter().find(|pending| {
            !pending
                .victory
                .as_ref()
                .is_some_and(|victory| victory.descendant == CurrentVictoryDescendantV1::Complete)
        }) else {
            return Ok(Some(GameOwnedPhaseV1::PendingResolve));
        };
        if let Some(friendship) = &pending.friendship {
            if !friendship.complete {
                if let Some(request) = &friendship.clock {
                    let issued = self.pending_platform.values().any(|pending| {
                        matches!(
                            &pending.effect,
                            GamePlatformEffectV2::CurrentFriendshipClock {
                                request: issued
                            } if issued == request
                        )
                    });
                    return if issued {
                        Ok(None)
                    } else {
                        Err(GameKernelV7Error::Invalid)
                    };
                }
                return Ok(Some(GameOwnedPhaseV1::FriendshipBegin));
            }
        }
        let Some(victory) = &pending.victory else {
            return Ok(Some(GameOwnedPhaseV1::VictoryBegin));
        };
        Ok(match &victory.descendant {
            CurrentVictoryDescendantV1::Ready => Some(GameOwnedPhaseV1::AwardBegin),
            CurrentVictoryDescendantV1::AwardPresentation { event_id, .. } => {
                if self.pending_presentations.contains_key(event_id) {
                    None
                } else {
                    Some(GameOwnedPhaseV1::AwardApply)
                }
            }
            CurrentVictoryDescendantV1::LevelUpStart { .. } => Some(GameOwnedPhaseV1::LevelUpApply),
            CurrentVictoryDescendantV1::LevelUpPresentation { event_id, .. } => {
                if self.pending_presentations.contains_key(event_id) {
                    None
                } else {
                    Some(GameOwnedPhaseV1::LevelUpChildren)
                }
            }
            CurrentVictoryDescendantV1::LevelUpChildren { .. } => {
                Some(GameOwnedPhaseV1::VictoryDescendant)
            }
            CurrentVictoryDescendantV1::LearnMoveBatch { batch } if batch.complete => {
                Some(GameOwnedPhaseV1::VictoryDescendant)
            }
            CurrentVictoryDescendantV1::LearnMoveBatch { .. }
            | CurrentVictoryDescendantV1::Evolution { .. } => None,
            CurrentVictoryDescendantV1::Complete => return Err(GameKernelV7Error::Invalid),
        })
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
