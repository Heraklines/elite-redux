//! Logical menu reducer and immutable renderer projection.

use er_types::{
    ButtonEvent, CancelPolicy, GameButton, MenuGeneration, MenuOption, MenuOptionId,
    MenuOptionView, MenuState, SafeU53, SeatId, UiIntent, UiRejectReason, UiState, UiViewKind,
    UiViewModel,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CursorDirection {
    Previous,
    Next,
}

#[derive(Clone, Debug)]
pub struct UiReducer {
    state: UiState,
}

impl UiReducer {
    pub fn new(state: UiState) -> Self {
        Self { state }
    }

    pub fn state(&self) -> &UiState {
        &self.state
    }

    pub fn replace_menu(
        &mut self,
        owner_seat: Option<SeatId>,
        actionable: bool,
        menu: MenuState,
    ) -> MenuGeneration {
        self.state.generation = Self::next_generation(self.state.generation);
        self.state.owner_seat = owner_seat;
        self.state.actionable = actionable;
        self.state.stack = vec![menu];
        self.state.generation
    }

    pub fn set_actionable(&mut self, actionable: bool) {
        self.state.actionable = actionable;
    }

    pub fn reduce(
        &mut self,
        seat: SeatId,
        event: ButtonEvent,
    ) -> Result<Vec<UiIntent>, UiRejectReason> {
        self.reduce_at(seat, self.state.generation, event)
    }

    pub fn reduce_at(
        &mut self,
        seat: SeatId,
        expected_generation: MenuGeneration,
        event: ButtonEvent,
    ) -> Result<Vec<UiIntent>, UiRejectReason> {
        if expected_generation != self.state.generation {
            return Err(UiRejectReason::StaleGeneration);
        }
        if self.state.owner_seat.is_some_and(|owner| owner != seat) {
            return Err(UiRejectReason::WrongSeat);
        }
        if !self.state.actionable {
            return Err(UiRejectReason::NonActionable);
        }

        let generation = self.state.generation;
        let button = match event {
            ButtonEvent::Pressed(button) => button,
            ButtonEvent::Released(_) => return Err(UiRejectReason::UnsupportedButton),
        };

        match button {
            GameButton::Up | GameButton::Left => {
                self.move_cursor(seat, generation, CursorDirection::Previous)
            }
            GameButton::Down | GameButton::Right => {
                self.move_cursor(seat, generation, CursorDirection::Next)
            }
            GameButton::Submit | GameButton::Action => self.submit(seat, generation),
            GameButton::Cancel => self.cancel(seat, generation),
            GameButton::Menu => {
                if self.is_none_menu() {
                    Ok(vec![UiIntent::MenuOpened { seat, generation }])
                } else {
                    Err(UiRejectReason::UnsupportedButton)
                }
            }
            GameButton::Stats
            | GameButton::CycleShiny
            | GameButton::CycleForm
            | GameButton::CycleGender
            | GameButton::CycleAbility
            | GameButton::CycleNature
            | GameButton::CycleTera
            | GameButton::SpeedUp
            | GameButton::SlowDown
            | GameButton::DevCustom => Err(UiRejectReason::UnsupportedButton),
        }
    }

    pub fn view(&self) -> UiViewModel {
        let mut view = UiViewModel {
            generation: self.state.generation,
            owner_seat: self.state.owner_seat,
            actionable: self.state.actionable,
            kind: UiViewKind::None,
            cursor: None,
            options: Vec::new(),
            prompt_key: None,
        };

        match self.state.stack.last() {
            None | Some(MenuState::None) => {}
            Some(MenuState::Waiting(menu)) => {
                view.kind = UiViewKind::Waiting;
                view.prompt_key = menu.prompt_key.clone();
            }
            Some(MenuState::Message(menu)) => {
                view.kind = UiViewKind::Message;
                view.prompt_key = menu.prompt_key.clone();
            }
            Some(MenuState::Confirm(menu)) => {
                view.kind = UiViewKind::Confirm;
                view.cursor = Some(menu.cursor);
                view.options = Self::option_views(&menu.options, menu.cursor);
            }
            Some(MenuState::ChoiceList(menu)) => {
                view.kind = UiViewKind::ChoiceList;
                view.cursor = Some(menu.cursor);
                view.options = Self::option_views(&menu.options, menu.cursor);
            }
            Some(MenuState::Command(menu)) => {
                view.kind = UiViewKind::Command;
                view.cursor = Some(menu.cursor);
                view.options = Self::option_views(&menu.options, menu.cursor);
            }
            Some(MenuState::Replacement(menu)) => {
                view.kind = UiViewKind::Replacement;
                view.cursor = Some(menu.cursor);
                view.options = Self::option_views(&menu.options, menu.cursor);
            }
            Some(MenuState::Interaction(menu)) => {
                view.kind = UiViewKind::Interaction;
                view.cursor = Some(menu.choice.cursor);
                view.options = Self::option_views(&menu.choice.options, menu.choice.cursor);
            }
            Some(MenuState::Terminal(menu)) => {
                view.kind = UiViewKind::Terminal;
                view.prompt_key = menu.prompt_key.clone();
            }
        }

        view
    }

    fn next_generation(generation: MenuGeneration) -> MenuGeneration {
        let next = generation.get().get().saturating_add(1);
        let next = match SafeU53::new(next) {
            Ok(value) => value,
            Err(_) => SafeU53::MAX,
        };
        MenuGeneration::new(next)
    }

    fn is_none_menu(&self) -> bool {
        matches!(self.state.stack.last(), None | Some(MenuState::None))
    }

    fn cursor_snapshot(&self) -> Option<(SafeU53, bool, &[MenuOption])> {
        match self.state.stack.last() {
            Some(MenuState::Confirm(menu)) => Some((menu.cursor, true, &menu.options)),
            Some(MenuState::ChoiceList(menu)) => Some((menu.cursor, menu.wrap, &menu.options)),
            Some(MenuState::Command(menu)) => Some((menu.cursor, false, &menu.options)),
            Some(MenuState::Replacement(menu)) => Some((menu.cursor, false, &menu.options)),
            Some(MenuState::Interaction(menu)) => {
                Some((menu.choice.cursor, menu.choice.wrap, &menu.choice.options))
            }
            None
            | Some(MenuState::None)
            | Some(MenuState::Waiting(_))
            | Some(MenuState::Message(_))
            | Some(MenuState::Terminal(_)) => None,
        }
    }

    fn move_cursor(
        &mut self,
        seat: SeatId,
        generation: MenuGeneration,
        direction: CursorDirection,
    ) -> Result<Vec<UiIntent>, UiRejectReason> {
        let (cursor, wrap, options) = self
            .cursor_snapshot()
            .ok_or(UiRejectReason::UnsupportedButton)?;
        let current = Self::cursor_index(cursor, options.len())?;
        let visible_indices: Vec<usize> = options
            .iter()
            .enumerate()
            .filter(|(_, option)| option.visible)
            .map(|(index, _)| index)
            .collect();

        if visible_indices.is_empty() {
            return Err(UiRejectReason::DisabledOption);
        }

        let target = match visible_indices.iter().position(|index| *index == current) {
            Some(position) => {
                Self::adjacent_index(position, visible_indices.len(), direction, wrap)
            }
            None => match direction {
                CursorDirection::Previous => visible_indices
                    .iter()
                    .rposition(|index| *index < current)
                    .or_else(|| wrap.then_some(visible_indices.len() - 1)),
                CursorDirection::Next => visible_indices
                    .iter()
                    .position(|index| *index > current)
                    .or_else(|| wrap.then_some(0)),
            },
        };
        let Some(target_position) = target else {
            return Ok(Vec::new());
        };

        let target_index = visible_indices
            .get(target_position)
            .copied()
            .ok_or(UiRejectReason::InvalidCursor)?;
        let target_cursor = Self::index_cursor(target_index)?;
        if target_cursor == cursor {
            return Ok(Vec::new());
        }

        self.set_cursor(target_cursor)?;
        Ok(vec![UiIntent::CursorChanged {
            seat,
            generation,
            cursor: target_cursor,
        }])
    }

    fn adjacent_index(
        position: usize,
        length: usize,
        direction: CursorDirection,
        wrap: bool,
    ) -> Option<usize> {
        match direction {
            CursorDirection::Previous if position > 0 => Some(position - 1),
            CursorDirection::Previous if wrap => Some(length - 1),
            CursorDirection::Next if position + 1 < length => Some(position + 1),
            CursorDirection::Next if wrap => Some(0),
            CursorDirection::Previous | CursorDirection::Next => None,
        }
    }

    fn set_cursor(&mut self, cursor: SafeU53) -> Result<(), UiRejectReason> {
        match self.state.stack.last_mut() {
            Some(MenuState::Confirm(menu)) => menu.cursor = cursor,
            Some(MenuState::ChoiceList(menu)) => menu.cursor = cursor,
            Some(MenuState::Command(menu)) => menu.cursor = cursor,
            Some(MenuState::Replacement(menu)) => menu.cursor = cursor,
            Some(MenuState::Interaction(menu)) => menu.choice.cursor = cursor,
            None
            | Some(MenuState::None)
            | Some(MenuState::Waiting(_))
            | Some(MenuState::Message(_))
            | Some(MenuState::Terminal(_)) => return Err(UiRejectReason::UnsupportedButton),
        }
        Ok(())
    }

    fn submit(
        &self,
        seat: SeatId,
        generation: MenuGeneration,
    ) -> Result<Vec<UiIntent>, UiRejectReason> {
        match self.state.stack.last() {
            Some(MenuState::Message(_)) => Ok(vec![UiIntent::MessageAdvanced { seat, generation }]),
            Some(MenuState::Confirm(menu)) => {
                let (index, _) = Self::selected_option(&menu.options, menu.cursor)?;
                Ok(vec![UiIntent::Confirmed {
                    seat,
                    generation,
                    accepted: Self::confirmation_value(&menu.options, index),
                }])
            }
            Some(MenuState::ChoiceList(menu)) => {
                let _ = Self::selected_option(&menu.options, menu.cursor)?;
                Ok(vec![UiIntent::MenuOpened { seat, generation }])
            }
            Some(MenuState::Command(menu)) => {
                let (_, option) = Self::selected_option(&menu.options, menu.cursor)?;
                Ok(vec![UiIntent::CommandSubmitted {
                    seat,
                    generation,
                    operation_id: menu.operation_id.clone(),
                    control_id: menu.control_id.clone(),
                    option_id: option.id.clone(),
                }])
            }
            Some(MenuState::Replacement(menu)) => {
                let (_, option) = Self::selected_option(&menu.options, menu.cursor)?;
                Ok(vec![UiIntent::ReplacementSubmitted {
                    seat,
                    generation,
                    operation_id: menu.operation_id.clone(),
                    control_id: menu.control_id.clone(),
                    option_id: option.id.clone(),
                }])
            }
            Some(MenuState::Interaction(menu)) => {
                let (_, option) = Self::selected_option(&menu.choice.options, menu.choice.cursor)?;
                Ok(vec![UiIntent::InteractionSubmitted {
                    seat,
                    generation,
                    operation_id: menu.operation_id.clone(),
                    control_id: menu.control_id.clone(),
                    option_id: option.id.clone(),
                }])
            }
            None
            | Some(MenuState::None)
            | Some(MenuState::Waiting(_))
            | Some(MenuState::Terminal(_)) => Err(UiRejectReason::UnsupportedButton),
        }
    }

    fn cancel(
        &mut self,
        seat: SeatId,
        generation: MenuGeneration,
    ) -> Result<Vec<UiIntent>, UiRejectReason> {
        let policy = match self.state.stack.last() {
            Some(MenuState::Message(menu)) => Some(menu.cancel.clone()),
            Some(MenuState::Confirm(menu)) => Some(menu.cancel.clone()),
            Some(MenuState::ChoiceList(menu)) => Some(menu.cancel.clone()),
            Some(MenuState::Command(menu)) => Some(menu.cancel.clone()),
            Some(MenuState::Replacement(menu)) => Some(menu.cancel.clone()),
            Some(MenuState::Interaction(menu)) => Some(menu.choice.cancel.clone()),
            Some(MenuState::Waiting(_)) => return Err(UiRejectReason::UnsupportedButton),
            Some(MenuState::Terminal(_)) => return Ok(self.close_menu(seat, generation)),
            None | Some(MenuState::None) => None,
        };

        match policy {
            Some(CancelPolicy::Disabled) => Err(UiRejectReason::UnsupportedButton),
            Some(CancelPolicy::Close) => Ok(self.close_menu(seat, generation)),
            Some(CancelPolicy::Back) => Ok(self.back_menu(seat, generation)),
            Some(CancelPolicy::Select(option_id)) => {
                self.submit_option(seat, generation, &option_id)
            }
            None => Err(UiRejectReason::UnsupportedButton),
        }
    }

    fn submit_option(
        &self,
        seat: SeatId,
        generation: MenuGeneration,
        option_id: &MenuOptionId,
    ) -> Result<Vec<UiIntent>, UiRejectReason> {
        if let Some((cursor, _, options)) = self.cursor_snapshot() {
            let _ = Self::cursor_index(cursor, options.len())?;
        }
        match self.state.stack.last() {
            Some(MenuState::Confirm(menu)) => {
                let (index, _) = Self::option_by_id(&menu.options, option_id)?;
                Ok(vec![UiIntent::Confirmed {
                    seat,
                    generation,
                    accepted: Self::confirmation_value(&menu.options, index),
                }])
            }
            Some(MenuState::ChoiceList(menu)) => {
                let _ = Self::option_by_id(&menu.options, option_id)?;
                Ok(vec![UiIntent::MenuOpened { seat, generation }])
            }
            Some(MenuState::Command(menu)) => {
                let (_, option) = Self::option_by_id(&menu.options, option_id)?;
                Ok(vec![UiIntent::CommandSubmitted {
                    seat,
                    generation,
                    operation_id: menu.operation_id.clone(),
                    control_id: menu.control_id.clone(),
                    option_id: option.id.clone(),
                }])
            }
            Some(MenuState::Replacement(menu)) => {
                let (_, option) = Self::option_by_id(&menu.options, option_id)?;
                Ok(vec![UiIntent::ReplacementSubmitted {
                    seat,
                    generation,
                    operation_id: menu.operation_id.clone(),
                    control_id: menu.control_id.clone(),
                    option_id: option.id.clone(),
                }])
            }
            Some(MenuState::Interaction(menu)) => {
                let (_, option) = Self::option_by_id(&menu.choice.options, option_id)?;
                Ok(vec![UiIntent::InteractionSubmitted {
                    seat,
                    generation,
                    operation_id: menu.operation_id.clone(),
                    control_id: menu.control_id.clone(),
                    option_id: option.id.clone(),
                }])
            }
            Some(MenuState::Message(_))
            | None
            | Some(MenuState::None)
            | Some(MenuState::Waiting(_))
            | Some(MenuState::Terminal(_)) => Err(UiRejectReason::DisabledOption),
        }
    }

    fn close_menu(&mut self, seat: SeatId, generation: MenuGeneration) -> Vec<UiIntent> {
        self.state.generation = Self::next_generation(generation);
        self.state.owner_seat = None;
        self.state.actionable = false;
        self.state.stack = vec![MenuState::None];
        vec![UiIntent::MenuClosed { seat, generation }]
    }

    fn back_menu(&mut self, seat: SeatId, generation: MenuGeneration) -> Vec<UiIntent> {
        if self.state.stack.len() <= 1 {
            return vec![UiIntent::CancelRequested { seat, generation }];
        }

        self.state.stack.truncate(self.state.stack.len() - 1);
        self.state.generation = Self::next_generation(generation);
        vec![UiIntent::MenuClosed { seat, generation }]
    }

    fn cursor_index(cursor: SafeU53, option_count: usize) -> Result<usize, UiRejectReason> {
        let index = usize::try_from(cursor.get()).map_err(|_| UiRejectReason::InvalidCursor)?;
        if index >= option_count {
            return Err(UiRejectReason::InvalidCursor);
        }
        Ok(index)
    }

    fn index_cursor(index: usize) -> Result<SafeU53, UiRejectReason> {
        let value = u64::try_from(index).map_err(|_| UiRejectReason::InvalidCursor)?;
        SafeU53::new(value).map_err(|_| UiRejectReason::InvalidCursor)
    }

    fn selected_option(
        options: &[MenuOption],
        cursor: SafeU53,
    ) -> Result<(usize, &MenuOption), UiRejectReason> {
        let index = Self::cursor_index(cursor, options.len())?;
        let option = options.get(index).ok_or(UiRejectReason::InvalidCursor)?;
        if !option.visible || !option.enabled {
            return Err(UiRejectReason::DisabledOption);
        }
        Ok((index, option))
    }

    fn option_by_id<'a>(
        options: &'a [MenuOption],
        option_id: &MenuOptionId,
    ) -> Result<(usize, &'a MenuOption), UiRejectReason> {
        let Some((index, option)) = options
            .iter()
            .enumerate()
            .find(|(_, option)| option.id.as_str() == option_id.as_str())
        else {
            return Err(UiRejectReason::DisabledOption);
        };
        if !option.visible || !option.enabled {
            return Err(UiRejectReason::DisabledOption);
        }
        Ok((index, option))
    }

    fn confirmation_value(options: &[MenuOption], index: usize) -> bool {
        let Some(option) = options.get(index) else {
            return false;
        };
        let id = option.id.as_str();
        if id.eq_ignore_ascii_case("yes")
            || id.eq_ignore_ascii_case("accept")
            || id.eq_ignore_ascii_case("confirm")
            || id.eq_ignore_ascii_case("ok")
        {
            return true;
        }
        if id.eq_ignore_ascii_case("no")
            || id.eq_ignore_ascii_case("cancel")
            || id.eq_ignore_ascii_case("decline")
        {
            return false;
        }
        index == 0
    }

    fn option_views(options: &[MenuOption], cursor: SafeU53) -> Vec<MenuOptionView> {
        options
            .iter()
            .enumerate()
            .map(|(index, option)| MenuOptionView {
                id: option.id.clone(),
                label_key: option.label_key.clone(),
                enabled: option.enabled,
                visible: option.visible,
                selected: option.visible
                    && match u64::try_from(index) {
                        Ok(index) => index == cursor.get(),
                        Err(_) => false,
                    },
            })
            .collect()
    }
}

impl Default for UiReducer {
    fn default() -> Self {
        Self::new(UiState::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::{
        ChoiceListMenu, CommandMenu, ConfirmMenu, InteractionMenu, MessageMenu, ReplacementMenu,
        TerminalMenu, WaitingMenu,
    };

    fn safe(value: u64) -> SafeU53 {
        match SafeU53::new(value) {
            Ok(value) => value,
            Err(_) => SafeU53::MAX,
        }
    }

    fn seat(value: u64) -> SeatId {
        SeatId::new(safe(value))
    }

    fn generation(value: u64) -> MenuGeneration {
        MenuGeneration::new(safe(value))
    }

    fn option(id: &str, enabled: bool, visible: bool) -> Option<MenuOption> {
        Some(MenuOption {
            id: MenuOptionId::new(id).ok()?,
            label_key: format!("label.{id}"),
            enabled,
            visible,
        })
    }

    fn operation(id: &str) -> Option<er_types::OperationId> {
        er_types::OperationId::new(id).ok()
    }

    fn pressed(button: GameButton) -> ButtonEvent {
        ButtonEvent::Pressed(button)
    }

    fn two_options() -> Vec<MenuOption> {
        let Some(first) = option("yes", true, true) else {
            return Vec::new();
        };
        let Some(second) = option("no", true, true) else {
            return Vec::new();
        };
        vec![first, second]
    }

    #[test]
    fn ownership_generation_and_actionability_rejections_do_not_mutate() {
        let mut reducer = UiReducer::default();
        let owner = seat(1);
        let other = seat(2);
        let current_generation = reducer.replace_menu(
            Some(owner),
            true,
            MenuState::Message(MessageMenu {
                prompt_key: Some("message.prompt".to_owned()),
                cancel: CancelPolicy::Back,
            }),
        );
        let before = reducer.state().clone();

        assert_eq!(
            reducer.reduce_at(other, current_generation, pressed(GameButton::Action)),
            Err(UiRejectReason::WrongSeat)
        );
        assert_eq!(reducer.state(), &before);
        assert_eq!(
            reducer.reduce_at(owner, generation(0), pressed(GameButton::Action)),
            Err(UiRejectReason::StaleGeneration)
        );
        assert_eq!(reducer.state(), &before);

        reducer.set_actionable(false);
        let before = reducer.state().clone();
        assert_eq!(
            reducer.reduce(owner, pressed(GameButton::Action)),
            Err(UiRejectReason::NonActionable)
        );
        assert_eq!(reducer.state(), &before);
    }

    #[test]
    fn replacement_increments_generation_and_saturates_at_safe_maximum() {
        let mut reducer = UiReducer::new(UiState {
            generation: generation(SafeU53::MAX.get() - 1),
            owner_seat: None,
            actionable: true,
            stack: vec![MenuState::None],
        });
        let generation = reducer.replace_menu(None, true, MenuState::None);
        assert_eq!(generation, MenuGeneration::new(SafeU53::MAX));
        assert_eq!(
            reducer.replace_menu(None, true, MenuState::None),
            MenuGeneration::new(SafeU53::MAX)
        );
    }

    #[test]
    fn choice_list_moves_over_visible_options_and_wraps() {
        let Some(hidden) = option("hidden", true, false) else {
            return;
        };
        let Some(first) = option("first", true, true) else {
            return;
        };
        let Some(disabled) = option("disabled", false, true) else {
            return;
        };
        let Some(last) = option("last", true, true) else {
            return;
        };
        let mut reducer = UiReducer::new(UiState {
            generation: generation(4),
            owner_seat: Some(seat(1)),
            actionable: true,
            stack: vec![MenuState::ChoiceList(ChoiceListMenu {
                cursor: safe(1),
                page: safe(0),
                wrap: true,
                options: vec![hidden, first, disabled, last],
                cancel: CancelPolicy::Back,
            })],
        });

        assert_eq!(
            reducer.reduce(seat(1), pressed(GameButton::Up)),
            Ok(vec![UiIntent::CursorChanged {
                seat: seat(1),
                generation: generation(4),
                cursor: safe(3),
            }])
        );
        assert_eq!(
            reducer.reduce(seat(1), pressed(GameButton::Down)),
            Ok(vec![UiIntent::CursorChanged {
                seat: seat(1),
                generation: generation(4),
                cursor: safe(1),
            }])
        );
        assert_eq!(reducer.view().cursor, Some(safe(1)));
        assert_eq!(reducer.view().options[0].selected, false);
        assert_eq!(reducer.view().options[2].enabled, false);
    }

    #[test]
    fn hidden_or_disabled_submit_and_invalid_cursor_reject_without_mutation() {
        let Some(hidden) = option("hidden", true, false) else {
            return;
        };
        let Some(disabled) = option("disabled", false, true) else {
            return;
        };
        let mut reducer = UiReducer::new(UiState {
            generation: generation(1),
            owner_seat: None,
            actionable: true,
            stack: vec![MenuState::Confirm(ConfirmMenu {
                cursor: safe(0),
                options: vec![hidden, disabled],
                cancel: CancelPolicy::Disabled,
            })],
        });
        let before = reducer.state().clone();
        assert_eq!(
            reducer.reduce(seat(0), pressed(GameButton::Action)),
            Err(UiRejectReason::DisabledOption)
        );
        assert_eq!(reducer.state(), &before);

        let Some(operation_id) = operation("op") else {
            return;
        };
        reducer.state.stack = vec![MenuState::Command(CommandMenu {
            operation_id,
            control_id: "control".to_owned(),
            cursor: safe(4),
            options: vec![],
            cancel: CancelPolicy::Disabled,
        })];
        let before = reducer.state().clone();
        assert_eq!(
            reducer.reduce(seat(0), pressed(GameButton::Action)),
            Err(UiRejectReason::InvalidCursor)
        );
        assert_eq!(reducer.state(), &before);
    }

    #[test]
    fn non_wrapping_command_edges_are_no_ops_and_ids_are_stable() {
        let Some(first) = option("fight", true, true) else {
            return;
        };
        let Some(second) = option("run", true, true) else {
            return;
        };
        let first_id = first.id.clone();
        let Some(operation_id) = operation("operation-1") else {
            return;
        };
        let mut reducer = UiReducer::new(UiState {
            generation: generation(2),
            owner_seat: Some(seat(7)),
            actionable: true,
            stack: vec![MenuState::Command(CommandMenu {
                operation_id: operation_id.clone(),
                control_id: "control-1".to_owned(),
                cursor: safe(0),
                options: vec![first, second],
                cancel: CancelPolicy::Disabled,
            })],
        });

        assert_eq!(
            reducer.reduce(seat(7), pressed(GameButton::Up)),
            Ok(Vec::new())
        );
        assert_eq!(
            reducer.reduce(seat(7), pressed(GameButton::Action)),
            Ok(vec![UiIntent::CommandSubmitted {
                seat: seat(7),
                generation: generation(2),
                operation_id: operation_id.clone(),
                control_id: "control-1".to_owned(),
                option_id: first_id,
            }])
        );
    }

    #[test]
    fn message_confirm_and_all_submission_kinds_have_semantic_intents() {
        let mut message = UiReducer::new(UiState {
            generation: generation(1),
            owner_seat: None,
            actionable: true,
            stack: vec![MenuState::Message(MessageMenu {
                prompt_key: None,
                cancel: CancelPolicy::Close,
            })],
        });
        assert_eq!(
            message.reduce(seat(0), pressed(GameButton::Submit)),
            Ok(vec![UiIntent::MessageAdvanced {
                seat: seat(0),
                generation: generation(1),
            }])
        );

        let mut confirm = UiReducer::new(UiState {
            generation: generation(2),
            owner_seat: None,
            actionable: true,
            stack: vec![MenuState::Confirm(ConfirmMenu {
                cursor: safe(1),
                options: two_options(),
                cancel: CancelPolicy::Disabled,
            })],
        });
        assert_eq!(
            confirm.reduce(seat(0), pressed(GameButton::Action)),
            Ok(vec![UiIntent::Confirmed {
                seat: seat(0),
                generation: generation(2),
                accepted: false,
            }])
        );

        let Some(operation_id) = operation("shared-operation") else {
            return;
        };
        let Some(choice) = option("choice", true, true) else {
            return;
        };
        let mut replacement = UiReducer::new(UiState {
            generation: generation(3),
            owner_seat: None,
            actionable: true,
            stack: vec![MenuState::Replacement(ReplacementMenu {
                operation_id: operation_id.clone(),
                control_id: "replacement-control".to_owned(),
                field_index: safe(1),
                cursor: safe(0),
                options: vec![choice.clone()],
                cancel: CancelPolicy::Disabled,
            })],
        });
        assert!(matches!(
            replacement.reduce(seat(0), pressed(GameButton::Submit)),
            Ok(intents) if intents == vec![UiIntent::ReplacementSubmitted {
                seat: seat(0),
                generation: generation(3),
                operation_id: operation_id.clone(),
                control_id: "replacement-control".to_owned(),
                option_id: choice.id.clone(),
            }]
        ));

        let mut interaction = UiReducer::new(UiState {
            generation: generation(4),
            owner_seat: None,
            actionable: true,
            stack: vec![MenuState::Interaction(InteractionMenu {
                operation_id: operation_id.clone(),
                control_id: "interaction-control".to_owned(),
                surface_class: "surface".to_owned(),
                operation_kind: "kind".to_owned(),
                choice: ChoiceListMenu {
                    cursor: safe(0),
                    page: safe(0),
                    wrap: false,
                    options: vec![choice.clone()],
                    cancel: CancelPolicy::Disabled,
                },
            })],
        });
        assert_eq!(
            interaction.reduce(seat(0), pressed(GameButton::Action)),
            Ok(vec![UiIntent::InteractionSubmitted {
                seat: seat(0),
                generation: generation(4),
                operation_id,
                control_id: "interaction-control".to_owned(),
                option_id: choice.id,
            }])
        );
    }

    #[test]
    fn cancel_policies_close_back_select_and_disabled_are_distinct() {
        let Some(select) = option("select", true, true) else {
            return;
        };
        let Some(operation_id) = operation("cancel-operation") else {
            return;
        };

        let mut disabled = UiReducer::new(UiState {
            generation: generation(1),
            owner_seat: None,
            actionable: true,
            stack: vec![MenuState::Message(MessageMenu {
                prompt_key: None,
                cancel: CancelPolicy::Disabled,
            })],
        });
        let before = disabled.state().clone();
        assert_eq!(
            disabled.reduce(seat(0), pressed(GameButton::Cancel)),
            Err(UiRejectReason::UnsupportedButton)
        );
        assert_eq!(disabled.state(), &before);

        let mut close = UiReducer::new(UiState {
            generation: generation(2),
            owner_seat: Some(seat(0)),
            actionable: true,
            stack: vec![MenuState::Message(MessageMenu {
                prompt_key: None,
                cancel: CancelPolicy::Close,
            })],
        });
        assert_eq!(
            close.reduce(seat(0), pressed(GameButton::Cancel)),
            Ok(vec![UiIntent::MenuClosed {
                seat: seat(0),
                generation: generation(2),
            }])
        );
        assert_eq!(close.state().generation, generation(3));
        assert_eq!(close.state().stack, vec![MenuState::None]);
        assert!(!close.state().actionable);

        let mut back = UiReducer::new(UiState {
            generation: generation(5),
            owner_seat: None,
            actionable: true,
            stack: vec![
                MenuState::Message(MessageMenu {
                    prompt_key: None,
                    cancel: CancelPolicy::Back,
                }),
                MenuState::ChoiceList(ChoiceListMenu {
                    cursor: safe(0),
                    page: safe(0),
                    wrap: true,
                    options: vec![select.clone()],
                    cancel: CancelPolicy::Back,
                }),
            ],
        });
        assert_eq!(
            back.reduce(seat(0), pressed(GameButton::Cancel)),
            Ok(vec![UiIntent::MenuClosed {
                seat: seat(0),
                generation: generation(5),
            }])
        );
        assert_eq!(back.state().generation, generation(6));
        assert_eq!(back.view().kind, UiViewKind::Message);

        let mut select_reducer = UiReducer::new(UiState {
            generation: generation(7),
            owner_seat: None,
            actionable: true,
            stack: vec![MenuState::Command(CommandMenu {
                operation_id: operation_id.clone(),
                control_id: "cancel-control".to_owned(),
                cursor: safe(0),
                options: vec![select.clone()],
                cancel: CancelPolicy::Select(select.id.clone()),
            })],
        });
        assert_eq!(
            select_reducer.reduce(seat(0), pressed(GameButton::Cancel)),
            Ok(vec![UiIntent::CommandSubmitted {
                seat: seat(0),
                generation: generation(7),
                operation_id,
                control_id: "cancel-control".to_owned(),
                option_id: select.id,
            }])
        );
    }

    #[test]
    fn projection_covers_every_menu_kind_and_clones_nested_data() {
        let Some(operation_id) = operation("view-operation") else {
            return;
        };
        let Some(option) = option("view-option", true, true) else {
            return;
        };
        let cases = vec![
            (MenuState::None, UiViewKind::None, None, 0),
            (
                MenuState::Waiting(WaitingMenu {
                    prompt_key: Some("waiting".to_owned()),
                }),
                UiViewKind::Waiting,
                Some("waiting"),
                0,
            ),
            (
                MenuState::Message(MessageMenu {
                    prompt_key: Some("message".to_owned()),
                    cancel: CancelPolicy::Back,
                }),
                UiViewKind::Message,
                Some("message"),
                0,
            ),
            (
                MenuState::Confirm(ConfirmMenu {
                    cursor: safe(0),
                    options: vec![option.clone()],
                    cancel: CancelPolicy::Back,
                }),
                UiViewKind::Confirm,
                None,
                1,
            ),
            (
                MenuState::ChoiceList(ChoiceListMenu {
                    cursor: safe(0),
                    page: safe(2),
                    wrap: true,
                    options: vec![option.clone()],
                    cancel: CancelPolicy::Back,
                }),
                UiViewKind::ChoiceList,
                None,
                1,
            ),
            (
                MenuState::Command(CommandMenu {
                    operation_id: operation_id.clone(),
                    control_id: "command".to_owned(),
                    cursor: safe(0),
                    options: vec![option.clone()],
                    cancel: CancelPolicy::Back,
                }),
                UiViewKind::Command,
                None,
                1,
            ),
            (
                MenuState::Replacement(ReplacementMenu {
                    operation_id: operation_id.clone(),
                    control_id: "replacement".to_owned(),
                    field_index: safe(2),
                    cursor: safe(0),
                    options: vec![option.clone()],
                    cancel: CancelPolicy::Back,
                }),
                UiViewKind::Replacement,
                None,
                1,
            ),
            (
                MenuState::Interaction(InteractionMenu {
                    operation_id: operation_id.clone(),
                    control_id: "interaction".to_owned(),
                    surface_class: "surface".to_owned(),
                    operation_kind: "kind".to_owned(),
                    choice: ChoiceListMenu {
                        cursor: safe(0),
                        page: safe(0),
                        wrap: false,
                        options: vec![option.clone()],
                        cancel: CancelPolicy::Back,
                    },
                }),
                UiViewKind::Interaction,
                None,
                1,
            ),
            (
                MenuState::Terminal(TerminalMenu {
                    terminal_id: "terminal".to_owned(),
                    prompt_key: Some("terminal".to_owned()),
                }),
                UiViewKind::Terminal,
                Some("terminal"),
                0,
            ),
        ];

        for (menu, expected_kind, expected_prompt, option_count) in cases {
            let mut reducer = UiReducer::new(UiState {
                generation: generation(10),
                owner_seat: Some(seat(3)),
                actionable: true,
                stack: vec![menu],
            });
            let view = reducer.view();
            assert_eq!(view.kind, expected_kind);
            assert_eq!(view.prompt_key.as_deref(), expected_prompt);
            assert_eq!(view.options.len(), option_count);
            assert_eq!(view.owner_seat, Some(seat(3)));
            assert_eq!(view.generation, generation(10));
            if option_count == 1 {
                assert_eq!(view.options[0].id, option.id);
                assert!(view.options[0].selected);
            }
            reducer.replace_menu(None, true, MenuState::None);
            assert_eq!(view.options.len(), option_count);
        }
    }

    #[test]
    fn unsupported_buttons_and_released_events_are_rejected() {
        let mut reducer = UiReducer::new(UiState {
            generation: generation(1),
            owner_seat: None,
            actionable: true,
            stack: vec![MenuState::Waiting(WaitingMenu { prompt_key: None })],
        });
        let before = reducer.state().clone();
        assert_eq!(
            reducer.reduce(seat(0), pressed(GameButton::Stats)),
            Err(UiRejectReason::UnsupportedButton)
        );
        assert_eq!(
            reducer.reduce(seat(0), ButtonEvent::Released(GameButton::Action)),
            Err(UiRejectReason::UnsupportedButton)
        );
        assert_eq!(reducer.state(), &before);

        assert_eq!(
            reducer.reduce(seat(0), pressed(GameButton::Cancel)),
            Err(UiRejectReason::UnsupportedButton)
        );
    }
}
