//! Local learning selection is a private projection of committed controls.
//! Navigation never changes the canonical GameState used by material replay.
use super::*;
use er_state::current_experience_settlement::CurrentLearnMoveBatchV1;
use er_state::current_victory_execution::CurrentVictoryDescendantV1;

pub(crate) fn current_batch(state: &GameStateV6) -> Option<&CurrentLearnMoveBatchV1> {
    state.current_battle_participation.as_ref()?.experience.as_ref()?.pending.iter()
        .find_map(|pending| match &pending.victory.as_ref()?.descendant {
            CurrentVictoryDescendantV1::LearnMoveBatch { batch } if !batch.complete => Some(batch),
            _ => None,
        })
}

pub(crate) fn validate_private_learning_control(
    state: &GameStateV6, private: Option<&GameControlPlanV2>, local_seat: SeatId,
) -> Result<(), GameKernelV7Error> {
    let Some(batch) = current_batch(state) else {
        return if private.is_none() { Ok(()) } else { Err(GameKernelV7Error::Invalid) };
    };
    let canonical = &state.active_run.as_ref().ok_or(GameKernelV7Error::Invalid)?.control;
    let context = canonical.action_context.as_ref().ok_or(GameKernelV7Error::Invalid)?;
    let expected = er_game::m7_progression_control::current_learn_move_batch_control(context, batch)
        .map_err(|_| GameKernelV7Error::Invalid)?;
    if *canonical != expected || canonical.kind != GameControlKindV2::MoveLearn
        || canonical.owner_seat != Some(local_seat) || context.authority_seat != local_seat
        || state.current_presentation.is_none() || state.current_turn_execution.is_none()
    { return Err(GameKernelV7Error::Invalid); }
    let Some(private) = private else { return Ok(()); };
    private.validate().map_err(|_| GameKernelV7Error::Invalid)?;
    let canonical_menu = canonical.menu.as_ref().ok_or(GameKernelV7Error::Invalid)?;
    let private_menu = private.menu.as_ref().ok_or(GameKernelV7Error::Invalid)?;
    if private_menu.selected_action().is_none() { return Err(GameKernelV7Error::Invalid); }
    let mut normalized = private.clone();
    normalized.menu.as_mut().ok_or(GameKernelV7Error::Invalid)?.selected_option_id =
        canonical_menu.selected_option_id.clone();
    if normalized != *canonical { return Err(GameKernelV7Error::Invalid); }
    Ok(())
}

impl GameKernelV7 {
    pub(super) fn navigate_current_learning_control(
        &mut self, direction: NavigationDirection,
    ) -> Result<Option<GameKernelStepV7>, GameKernelV7Error> {
        let Some(state) = self.state() else { return Ok(None); };
        if current_batch(state).is_none() { return Ok(None); }
        if self.role != GameKernelRoleV7::Authority || self.protocol.is_some()
            || self.private_battle_control.is_some()
        { return Err(GameKernelV7Error::Invalid); }
        validate_private_learning_control(state, self.private_learning_control.as_ref(), self.local_seat)?;
        let mut control = self.current_control().cloned().ok_or(GameKernelV7Error::Invalid)?;
        let menu = control.menu.as_mut().ok_or(GameKernelV7Error::Invalid)?;
        let Some(next) = menu.navigation.iter().find(|edge|
            edge.from == menu.selected_option_id && edge.direction == direction)
            .map(|edge| edge.to.clone()) else {
                // Actual source lists clamp. This does not invent a navigation
                // edge, allocate a menu, or change either canonical/private UI.
                return Ok(Some(GameKernelStepV7::default()));
            };
        menu.selected_option_id = next;
        validate_private_learning_control(state, Some(&control), self.local_seat)?;
        self.private_learning_control = Some(control.clone());
        Ok(Some(GameKernelStepV7 {
            effects: vec![GameKernelEffectV7::UiChanged(control)], internal_events: Vec::new(),
        }))
    }

    pub(super) fn current_learning_submission(
        &self, button: GameButton,
    ) -> Result<Option<(GameActionV1, GameActionContextV1)>, GameKernelV7Error> {
        let Some(state) = self.state() else { return Ok(None); };
        if current_batch(state).is_none() { return Ok(None); }
        if self.role != GameKernelRoleV7::Authority || self.protocol.is_some()
            || self.private_battle_control.is_some()
        { return Err(GameKernelV7Error::Invalid); }
        validate_private_learning_control(state, self.private_learning_control.as_ref(), self.local_seat)?;
        let control = self.current_control().ok_or(GameKernelV7Error::Invalid)?;
        let menu = control.menu.as_ref().ok_or(GameKernelV7Error::Invalid)?;
        let action = match button {
            GameButton::Action => menu.selected_action().cloned().ok_or(GameKernelV7Error::Invalid)?,
            GameButton::Cancel => match &menu.cancel {
                er_types::GameMenuCancelV2::Back { action }
                | er_types::GameMenuCancelV2::Close { action } => (**action).clone(),
                er_types::GameMenuCancelV2::Select { option_id } => menu.options.iter()
                    .find(|option| option.option_id == *option_id && option.visible && option.enabled)
                    .map(|option| option.action.clone()).ok_or(GameKernelV7Error::Invalid)?,
                er_types::GameMenuCancelV2::Disabled => return Err(GameKernelV7Error::Invalid),
            },
            _ => return Err(GameKernelV7Error::Invalid),
        };
        if !matches!(action, GameActionV1::CurrentLearnMoveBatch { .. }) {
            return Err(GameKernelV7Error::Invalid);
        }
        Ok(Some((action, control.action_context.clone().ok_or(GameKernelV7Error::Invalid)?)))
    }
}
