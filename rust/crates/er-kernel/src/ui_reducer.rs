//! Logical menu reducer.

use er_types::{
    ButtonEvent, MenuGeneration, MenuState, SafeU53, SeatId, UiIntent, UiRejectReason, UiState,
    UiViewKind, UiViewModel,
};

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
        let next = self.state.generation.get().get().saturating_add(1);
        let next = SafeU53::new(next).unwrap_or(SafeU53::MAX);
        self.state.generation = MenuGeneration::new(next);
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
        _event: ButtonEvent,
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
        Err(UiRejectReason::UnsupportedButton)
    }

    pub fn view(&self) -> UiViewModel {
        let kind = match self.state.stack.last() {
            None | Some(MenuState::None) => UiViewKind::None,
            Some(MenuState::Waiting(_)) => UiViewKind::Waiting,
            Some(MenuState::Message(_)) => UiViewKind::Message,
            Some(MenuState::Confirm(_)) => UiViewKind::Confirm,
            Some(MenuState::ChoiceList(_)) => UiViewKind::ChoiceList,
            Some(MenuState::Command(_)) => UiViewKind::Command,
            Some(MenuState::Replacement(_)) => UiViewKind::Replacement,
            Some(MenuState::Interaction(_)) => UiViewKind::Interaction,
            Some(MenuState::Terminal(_)) => UiViewKind::Terminal,
        };
        UiViewModel {
            generation: self.state.generation,
            owner_seat: self.state.owner_seat,
            actionable: self.state.actionable,
            kind,
            cursor: None,
            options: Vec::new(),
            prompt_key: None,
        }
    }
}

impl Default for UiReducer {
    fn default() -> Self {
        Self::new(UiState::default())
    }
}
