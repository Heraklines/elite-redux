//! Public captured clock completion and bounded automatic phase continuation.
use super::*;
use er_game::m9e_runtime_v6::GameOwnedPhaseV1;
use er_state::current_turn_execution::CurrentTurnStageV1;

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
                // The Faint/Victory descendants are not wired in this first
                // diagnostic cut. Do not jump to friendship or release a
                // retained move before their real source-ordered execution.
                return Err(GameKernelV7Error::Invalid);
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
