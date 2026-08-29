//! Production M7.2 pre-run bootstrap driven by raw physical input.

use std::collections::{BTreeMap, BTreeSet};

use er_state::m7_state::ProfileStateV1;
use er_types::battle_ids::{GameModeId, MenuInstanceId};
use er_types::m7_action::{GameActionContextV1, GameActionV1};
use er_types::m7_menu::{GameMenuCancelV2, GameMenuOptionV2, GameMenuV2};
use er_types::ui_menu::{MenuNavigationEdge, MenuOptionLayout, NavigationDirection};
use er_types::{
    BootstrapActionV1, GameButton, GameControlKindV2, GameControlPlanV2, InputFocus, MenuOptionId,
    OperationId, PhysicalKey, RawInputEvent, RunDifficultyV1, SafeU53, SeatId, SetupChoiceIdV1,
    SetupChoiceValueV1, StarterSelectionV1,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const RUN_BOOTSTRAP_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunBootstrapStageV1 {
    Title,
    ModeSelect,
    ChallengeSelect,
    StarterSelect,
    Confirmation,
    DifficultySelect,
    SaveSelect,
    WaitingForPartner,
    Complete,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunBootstrapSelectionsV1 {
    pub mode: Option<GameModeId>,
    pub starters: Vec<StarterSelectionV1>,
    pub choices: BTreeMap<SetupChoiceIdV1, SetupChoiceValueV1>,
    pub difficulty: Option<RunDifficultyV1>,
    pub save_slot: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BootstrapModePolicyV1 {
    pub mode: GameModeId,
    pub challenge_selection: bool,
    pub cooperative: bool,
    pub supported: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BootstrapCatalogV1 {
    pub modes: Vec<BootstrapModePolicyV1>,
    pub challenges: Vec<(SetupChoiceIdV1, SetupChoiceValueV1)>,
    pub starters: Vec<StarterSelectionV1>,
    pub save_slots: Vec<String>,
    pub automatic_coop_save_slot: Option<String>,
    pub maximum_starter_cost: u16,
    pub maximum_starters: usize,
    pub local_is_host: bool,
    pub developer_mode: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunBootstrapMachineV1 {
    pub schema_version: u32,
    pub profile: ProfileStateV1,
    pub seed: String,
    pub stage: RunBootstrapStageV1,
    pub selections: RunBootstrapSelectionsV1,
    pub control: GameControlPlanV2,
    pub menu_instance_high_water: MenuInstanceId,
    pub catalog: BootstrapCatalogV1,
    pub pressed_keys: BTreeSet<PhysicalKey>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RunBootstrapErrorV1 {
    #[error("bootstrap schema, identity, or bound is invalid")]
    Invalid,
    #[error("bootstrap menu/control is invalid: {0}")]
    Control(String),
    #[error("raw input is stale, repeated, unfocused, or unsupported")]
    RejectedInput,
    #[error("bootstrap action is not legal at the current stage")]
    IllegalAction,
    #[error("startup mode is unsupported")]
    UnsupportedMode,
    #[error("starter selection exceeds party or cost bounds")]
    StarterLegality,
    #[error("bootstrap counter overflowed")]
    Overflow,
}

impl RunBootstrapMachineV1 {
    pub fn new(
        profile: ProfileStateV1,
        seed: String,
        owner_seat: SeatId,
        mut catalog: BootstrapCatalogV1,
    ) -> Result<Self, RunBootstrapErrorV1> {
        if seed.is_empty()
            || catalog.maximum_starter_cost == 0
            || catalog.maximum_starters == 0
            || catalog.modes.is_empty()
            || catalog.starters.is_empty()
            || catalog.save_slots.is_empty()
        {
            return Err(RunBootstrapErrorV1::Invalid);
        }
        catalog.modes.sort_by_key(|entry| entry.mode);
        catalog
            .challenges
            .sort_by(|left, right| left.0.cmp(&right.0));
        catalog.starters.sort_by_key(|entry| entry.pokemon_id);
        catalog.save_slots.sort();
        if catalog
            .modes
            .windows(2)
            .any(|pair| pair[0].mode == pair[1].mode)
            || catalog
                .challenges
                .windows(2)
                .any(|pair| pair[0].0 == pair[1].0)
            || catalog
                .starters
                .windows(2)
                .any(|pair| pair[0].pokemon_id == pair[1].pokemon_id)
            || catalog.save_slots.windows(2).any(|pair| pair[0] == pair[1])
            || catalog.save_slots.iter().any(String::is_empty)
            || catalog
                .automatic_coop_save_slot
                .as_ref()
                .is_some_and(|slot| !catalog.save_slots.contains(slot))
            || catalog.starters.iter().any(|starter| starter.cost == 0)
        {
            return Err(RunBootstrapErrorV1::Invalid);
        }
        let first_instance =
            MenuInstanceId::new(SafeU53::new(1).map_err(|_| RunBootstrapErrorV1::Overflow)?);
        let mut value = Self {
            schema_version: RUN_BOOTSTRAP_SCHEMA_VERSION_V1,
            profile,
            seed,
            stage: RunBootstrapStageV1::Title,
            selections: RunBootstrapSelectionsV1::default(),
            control: non_actionable_control(GameControlKindV2::Title, SafeU53::ZERO),
            menu_instance_high_water: first_instance,
            catalog,
            pressed_keys: BTreeSet::new(),
        };
        value.replace_control(owner_seat)?;
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), RunBootstrapErrorV1> {
        if self.schema_version != RUN_BOOTSTRAP_SCHEMA_VERSION_V1 || self.seed.is_empty() {
            return Err(RunBootstrapErrorV1::Invalid);
        }
        self.control
            .validate()
            .map_err(|error| RunBootstrapErrorV1::Control(error.to_string()))?;
        if self.stage == RunBootstrapStageV1::Complete
            && (self.selections.mode.is_none()
                || self.selections.starters.is_empty()
                || self.selections.difficulty.is_none()
                || self.selections.save_slot.is_none())
        {
            return Err(RunBootstrapErrorV1::Invalid);
        }
        self.validate_starters()
    }

    pub fn raw_input(&mut self, input: RawInputEvent) -> Result<bool, RunBootstrapErrorV1> {
        match input {
            RawInputEvent::KeyDown {
                code,
                browser_repeat,
                focus,
                ..
            } => {
                if browser_repeat || focus != InputFocus::Game || self.pressed_keys.contains(&code)
                {
                    return Err(RunBootstrapErrorV1::RejectedInput);
                }
                let button = bootstrap_button(&code).ok_or(RunBootstrapErrorV1::RejectedInput)?;
                self.pressed_keys.insert(code);
                self.button(button)
            }
            RawInputEvent::KeyUp { code } => Ok(self.pressed_keys.remove(&code)),
            RawInputEvent::WindowBlurred | RawInputEvent::FocusChanged(InputFocus::TextEntry) => {
                self.pressed_keys.clear();
                Ok(false)
            }
            RawInputEvent::WindowFocused | RawInputEvent::FocusChanged(InputFocus::Game) => {
                Ok(false)
            }
            RawInputEvent::GamepadDown { .. } | RawInputEvent::GamepadUp { .. } => {
                Err(RunBootstrapErrorV1::RejectedInput)
            }
        }
    }

    pub fn button(&mut self, button: GameButton) -> Result<bool, RunBootstrapErrorV1> {
        let menu = self
            .control
            .menu
            .as_mut()
            .ok_or(RunBootstrapErrorV1::IllegalAction)?;
        match button {
            GameButton::Up | GameButton::Down | GameButton::Left | GameButton::Right => {
                let direction = match button {
                    GameButton::Up => NavigationDirection::Up,
                    GameButton::Down => NavigationDirection::Down,
                    GameButton::Left => NavigationDirection::Left,
                    GameButton::Right => NavigationDirection::Right,
                    _ => return Err(RunBootstrapErrorV1::RejectedInput),
                };
                if let Some(edge) = menu.navigation.iter().find(|edge| {
                    edge.from == menu.selected_option_id && edge.direction == direction
                }) {
                    menu.selected_option_id = edge.to.clone();
                    return Ok(true);
                }
                Ok(false)
            }
            GameButton::Submit | GameButton::Action => {
                let action = menu
                    .selected_action()
                    .cloned()
                    .ok_or(RunBootstrapErrorV1::IllegalAction)?;
                self.apply_game_action(action)?;
                Ok(true)
            }
            GameButton::Cancel => {
                let action = menu
                    .cancel_action()
                    .cloned()
                    .ok_or(RunBootstrapErrorV1::IllegalAction)?;
                self.apply_game_action(action)?;
                Ok(true)
            }
            _ => Err(RunBootstrapErrorV1::RejectedInput),
        }
    }

    pub fn apply_game_action(&mut self, action: GameActionV1) -> Result<(), RunBootstrapErrorV1> {
        let GameActionV1::Bootstrap { action } = action else {
            return Err(RunBootstrapErrorV1::IllegalAction);
        };
        action
            .validate(self.catalog.developer_mode)
            .map_err(|_| RunBootstrapErrorV1::IllegalAction)?;
        self.apply_action(action)?;
        if self.stage != RunBootstrapStageV1::Complete {
            let owner = self
                .control
                .owner_seat
                .ok_or(RunBootstrapErrorV1::Invalid)?;
            self.replace_control(owner)?;
        } else {
            let revision = next_safe(self.control.revision)?;
            self.control = non_actionable_control(GameControlKindV2::Complete, revision);
        }
        self.validate()
    }

    fn apply_action(&mut self, action: BootstrapActionV1) -> Result<(), RunBootstrapErrorV1> {
        match (self.stage, action) {
            (RunBootstrapStageV1::Title, BootstrapActionV1::OpenNewGame) => {
                self.stage = RunBootstrapStageV1::ModeSelect;
            }
            (RunBootstrapStageV1::ModeSelect, BootstrapActionV1::SelectMode(mode)) => {
                let policy = self
                    .catalog
                    .modes
                    .iter()
                    .find(|entry| entry.mode == mode)
                    .ok_or(RunBootstrapErrorV1::IllegalAction)?;
                if !policy.supported {
                    return Err(RunBootstrapErrorV1::UnsupportedMode);
                }
                self.selections.mode = Some(mode);
                self.stage = if policy.challenge_selection && self.catalog.local_is_host {
                    RunBootstrapStageV1::ChallengeSelect
                } else {
                    RunBootstrapStageV1::StarterSelect
                };
            }
            (
                RunBootstrapStageV1::ChallengeSelect,
                BootstrapActionV1::SelectChallenge { id, value },
            ) => {
                if !self
                    .catalog
                    .challenges
                    .iter()
                    .any(|entry| entry.0 == id && entry.1 == value)
                {
                    return Err(RunBootstrapErrorV1::IllegalAction);
                }
                self.selections.choices.insert(id, value);
            }
            (RunBootstrapStageV1::ChallengeSelect, BootstrapActionV1::Confirm) => {
                self.stage = RunBootstrapStageV1::StarterSelect;
            }
            (RunBootstrapStageV1::StarterSelect, BootstrapActionV1::SelectStarter(starter)) => {
                if !self.catalog.starters.contains(&starter)
                    || self
                        .selections
                        .starters
                        .iter()
                        .any(|selected| selected.pokemon_id == starter.pokemon_id)
                {
                    return Err(RunBootstrapErrorV1::StarterLegality);
                }
                self.selections.starters.push(starter);
                self.selections
                    .starters
                    .sort_by_key(|entry| entry.pokemon_id);
                self.validate_starters()?;
            }
            (RunBootstrapStageV1::StarterSelect, BootstrapActionV1::RemoveStarter(id)) => {
                let index = self
                    .selections
                    .starters
                    .iter()
                    .position(|starter| starter.pokemon_id == id)
                    .ok_or(RunBootstrapErrorV1::IllegalAction)?;
                self.selections.starters.remove(index);
            }
            (RunBootstrapStageV1::StarterSelect, BootstrapActionV1::ConfirmStarters) => {
                if self.selections.starters.is_empty() {
                    return Err(RunBootstrapErrorV1::StarterLegality);
                }
                self.stage = RunBootstrapStageV1::Confirmation;
            }
            (RunBootstrapStageV1::Confirmation, BootstrapActionV1::Confirm) => {
                self.stage =
                    if self.selected_mode_policy()?.cooperative && !self.catalog.local_is_host {
                        RunBootstrapStageV1::WaitingForPartner
                    } else {
                        RunBootstrapStageV1::DifficultySelect
                    };
            }
            (RunBootstrapStageV1::Confirmation, BootstrapActionV1::Cancel) => {
                self.stage = RunBootstrapStageV1::StarterSelect;
            }
            (
                RunBootstrapStageV1::DifficultySelect,
                BootstrapActionV1::SelectDifficulty(difficulty),
            ) => {
                self.selections.difficulty = Some(difficulty);
                let cooperative = self.selected_mode_policy()?.cooperative;
                if cooperative && let Some(slot) = self.catalog.automatic_coop_save_slot.clone() {
                    self.selections.save_slot = Some(slot);
                    self.stage = RunBootstrapStageV1::Complete;
                } else {
                    self.stage = RunBootstrapStageV1::SaveSelect;
                }
            }
            (RunBootstrapStageV1::DifficultySelect, BootstrapActionV1::Cancel) => {
                self.stage = RunBootstrapStageV1::StarterSelect;
            }
            (RunBootstrapStageV1::SaveSelect, BootstrapActionV1::SelectSaveSlot(slot)) => {
                if !self.catalog.save_slots.contains(&slot) {
                    return Err(RunBootstrapErrorV1::IllegalAction);
                }
                self.selections.save_slot = Some(slot);
                self.stage = RunBootstrapStageV1::Complete;
            }
            (RunBootstrapStageV1::SaveSelect, BootstrapActionV1::Cancel) => {
                self.stage = RunBootstrapStageV1::Title;
                self.selections = RunBootstrapSelectionsV1::default();
            }
            (RunBootstrapStageV1::ModeSelect, BootstrapActionV1::Cancel) => {
                self.stage = RunBootstrapStageV1::Title;
            }
            (RunBootstrapStageV1::ChallengeSelect, BootstrapActionV1::Cancel) => {
                self.stage = RunBootstrapStageV1::ModeSelect;
                self.selections.mode = None;
                self.selections.choices.clear();
            }
            (RunBootstrapStageV1::StarterSelect, BootstrapActionV1::Cancel) => {
                if let Some(last) = self.selections.starters.pop() {
                    let _ = last;
                } else {
                    self.stage = RunBootstrapStageV1::Title;
                    self.selections = RunBootstrapSelectionsV1::default();
                }
            }
            _ => return Err(RunBootstrapErrorV1::IllegalAction),
        }
        Ok(())
    }

    pub fn apply_partner_config(
        &mut self,
        difficulty: RunDifficultyV1,
        choices: BTreeMap<SetupChoiceIdV1, SetupChoiceValueV1>,
    ) -> Result<(), RunBootstrapErrorV1> {
        if self.stage != RunBootstrapStageV1::WaitingForPartner
            || self.catalog.local_is_host
            || !self.selected_mode_policy()?.cooperative
            || (!difficulty.production() && !self.catalog.developer_mode)
            || choices.iter().any(|(id, value)| {
                !self
                    .catalog
                    .challenges
                    .iter()
                    .any(|entry| &entry.0 == id && &entry.1 == value)
            })
        {
            return Err(RunBootstrapErrorV1::IllegalAction);
        }
        let save_slot = self
            .catalog
            .automatic_coop_save_slot
            .clone()
            .ok_or(RunBootstrapErrorV1::Invalid)?;
        self.selections.difficulty = Some(difficulty);
        self.selections.choices = choices;
        self.selections.save_slot = Some(save_slot);
        self.stage = RunBootstrapStageV1::Complete;
        let revision = next_safe(self.control.revision)?;
        self.control = non_actionable_control(GameControlKindV2::Complete, revision);
        self.validate()
    }

    fn validate_starters(&self) -> Result<(), RunBootstrapErrorV1> {
        let cost = self
            .selections
            .starters
            .iter()
            .try_fold(0_u16, |total, starter| total.checked_add(starter.cost))
            .ok_or(RunBootstrapErrorV1::StarterLegality)?;
        if cost > self.catalog.maximum_starter_cost
            || self.selections.starters.len() > self.catalog.maximum_starters
            || self
                .selections
                .starters
                .windows(2)
                .any(|pair| pair[0].pokemon_id >= pair[1].pokemon_id)
        {
            return Err(RunBootstrapErrorV1::StarterLegality);
        }
        Ok(())
    }

    fn selected_mode_policy(&self) -> Result<&BootstrapModePolicyV1, RunBootstrapErrorV1> {
        let mode = self
            .selections
            .mode
            .ok_or(RunBootstrapErrorV1::IllegalAction)?;
        self.catalog
            .modes
            .iter()
            .find(|entry| entry.mode == mode)
            .ok_or(RunBootstrapErrorV1::IllegalAction)
    }

    fn replace_control(&mut self, owner: SeatId) -> Result<(), RunBootstrapErrorV1> {
        let revision = next_safe(self.control.revision)?;
        let instance = next_menu(self.menu_instance_high_water)?;
        self.menu_instance_high_water = instance;
        self.control = build_control(
            self.stage,
            &self.selections,
            &self.catalog,
            owner,
            revision,
            instance,
        )?;
        Ok(())
    }
}

fn build_control(
    stage: RunBootstrapStageV1,
    selections: &RunBootstrapSelectionsV1,
    catalog: &BootstrapCatalogV1,
    owner: SeatId,
    revision: SafeU53,
    instance: MenuInstanceId,
) -> Result<GameControlPlanV2, RunBootstrapErrorV1> {
    let (kind, entries, cancel) = match stage {
        RunBootstrapStageV1::Title => (
            GameControlKindV2::Title,
            vec![(
                "bootstrap/title/new-game".to_owned(),
                true,
                BootstrapActionV1::OpenNewGame,
            )],
            None,
        ),
        RunBootstrapStageV1::ModeSelect => (
            GameControlKindV2::ModeSelect,
            catalog
                .modes
                .iter()
                .map(|mode| {
                    (
                        format!("bootstrap/mode/{}", mode.mode.get()),
                        mode.supported,
                        BootstrapActionV1::SelectMode(mode.mode),
                    )
                })
                .collect(),
            Some(BootstrapActionV1::Cancel),
        ),
        RunBootstrapStageV1::ChallengeSelect => {
            let mut entries = catalog
                .challenges
                .iter()
                .map(|(id, value)| {
                    (
                        format!("bootstrap/challenge/{}", id.0),
                        true,
                        BootstrapActionV1::SelectChallenge {
                            id: id.clone(),
                            value: value.clone(),
                        },
                    )
                })
                .collect::<Vec<_>>();
            entries.push((
                "bootstrap/challenge/done".to_owned(),
                true,
                BootstrapActionV1::Confirm,
            ));
            (
                GameControlKindV2::ModeSelect,
                entries,
                Some(BootstrapActionV1::Cancel),
            )
        }
        RunBootstrapStageV1::StarterSelect => {
            let mut entries = catalog
                .starters
                .iter()
                .map(|starter| {
                    let selected = selections
                        .starters
                        .iter()
                        .any(|value| value.pokemon_id == starter.pokemon_id);
                    (
                        format!("bootstrap/starter/{}", starter.pokemon_id.get()),
                        true,
                        if selected {
                            BootstrapActionV1::RemoveStarter(starter.pokemon_id)
                        } else {
                            BootstrapActionV1::SelectStarter(starter.clone())
                        },
                    )
                })
                .collect::<Vec<_>>();
            entries.push((
                "bootstrap/starter/confirm".to_owned(),
                !selections.starters.is_empty(),
                BootstrapActionV1::ConfirmStarters,
            ));
            (
                GameControlKindV2::StarterSelect,
                entries,
                Some(BootstrapActionV1::Cancel),
            )
        }
        RunBootstrapStageV1::Confirmation => (
            GameControlKindV2::StarterSelect,
            vec![
                (
                    "bootstrap/confirm/yes".to_owned(),
                    true,
                    BootstrapActionV1::Confirm,
                ),
                (
                    "bootstrap/confirm/no".to_owned(),
                    true,
                    BootstrapActionV1::Cancel,
                ),
            ],
            Some(BootstrapActionV1::Cancel),
        ),
        RunBootstrapStageV1::DifficultySelect => (
            GameControlKindV2::StarterSelect,
            [
                RunDifficultyV1::Youngster,
                RunDifficultyV1::Ace,
                RunDifficultyV1::Elite,
                RunDifficultyV1::Hell,
                RunDifficultyV1::Mystery,
            ]
            .into_iter()
            .filter(|difficulty| difficulty.production() || catalog.developer_mode)
            .map(|difficulty| {
                (
                    format!("bootstrap/difficulty/{difficulty:?}").to_ascii_lowercase(),
                    true,
                    BootstrapActionV1::SelectDifficulty(difficulty),
                )
            })
            .collect(),
            Some(BootstrapActionV1::Cancel),
        ),
        RunBootstrapStageV1::SaveSelect => (
            GameControlKindV2::Save,
            catalog
                .save_slots
                .iter()
                .map(|slot| {
                    (
                        format!("bootstrap/save/{slot}"),
                        true,
                        BootstrapActionV1::SelectSaveSlot(slot.clone()),
                    )
                })
                .collect(),
            Some(BootstrapActionV1::Cancel),
        ),
        RunBootstrapStageV1::WaitingForPartner => {
            return Ok(non_actionable_control(GameControlKindV2::Waiting, revision));
        }
        RunBootstrapStageV1::Complete => {
            return Ok(non_actionable_control(
                GameControlKindV2::Complete,
                revision,
            ));
        }
    };
    let mut options = Vec::with_capacity(entries.len());
    let mut ids = Vec::with_capacity(entries.len());
    for (row, (id, enabled, action)) in entries.into_iter().enumerate() {
        let option_id = MenuOptionId::new(id).map_err(|_| RunBootstrapErrorV1::Invalid)?;
        let row = u16::try_from(row).map_err(|_| RunBootstrapErrorV1::Invalid)?;
        options.push(
            GameMenuOptionV2::new(
                option_id.clone(),
                enabled,
                true,
                GameActionV1::Bootstrap { action },
                Some(MenuOptionLayout::new(option_id.clone(), row, 0, 0)),
            )
            .map_err(|error| RunBootstrapErrorV1::Control(error.to_string()))?,
        );
        ids.push(option_id);
    }
    let selected = ids.first().cloned().ok_or(RunBootstrapErrorV1::Invalid)?;
    let mut navigation = Vec::new();
    for pair in ids.windows(2) {
        navigation.push(MenuNavigationEdge::new(
            pair[0].clone(),
            NavigationDirection::Down,
            pair[1].clone(),
        ));
        navigation.push(MenuNavigationEdge::new(
            pair[1].clone(),
            NavigationDirection::Up,
            pair[0].clone(),
        ));
    }
    let cancel = cancel.map_or(GameMenuCancelV2::Disabled, |action| {
        GameMenuCancelV2::Back {
            action: Box::new(GameActionV1::Bootstrap { action }),
        }
    });
    let menu = GameMenuV2::new(
        instance,
        owner,
        format!("bootstrap/{stage:?}/{}", revision.get()).to_ascii_lowercase(),
        selected,
        options,
        navigation,
        cancel,
    )
    .map_err(|error| RunBootstrapErrorV1::Control(error.to_string()))?;
    let action_context = GameActionContextV1 {
        operation_id: OperationId::new(
            format!("bootstrap/{stage:?}/{}", revision.get()).to_ascii_lowercase(),
        )
        .map_err(|_| RunBootstrapErrorV1::Invalid)?,
        authority_seat: owner,
        authority_revision: revision,
        menu_instance: instance,
    };
    let control = GameControlPlanV2 {
        schema_version: er_types::m7::GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
        revision,
        kind,
        owner_seat: Some(owner),
        action_context: Some(action_context),
        menu: Some(menu),
        actionable: true,
    };
    control
        .validate()
        .map_err(|error| RunBootstrapErrorV1::Control(error.to_string()))?;
    Ok(control)
}

fn bootstrap_button(key: &PhysicalKey) -> Option<GameButton> {
    match key {
        PhysicalKey::ArrowUp => Some(GameButton::Up),
        PhysicalKey::ArrowDown => Some(GameButton::Down),
        PhysicalKey::ArrowLeft => Some(GameButton::Left),
        PhysicalKey::ArrowRight => Some(GameButton::Right),
        PhysicalKey::Enter | PhysicalKey::Space => Some(GameButton::Submit),
        PhysicalKey::Escape | PhysicalKey::Backspace => Some(GameButton::Cancel),
        _ => None,
    }
}

fn next_safe(value: SafeU53) -> Result<SafeU53, RunBootstrapErrorV1> {
    SafeU53::new(
        value
            .get()
            .checked_add(1)
            .ok_or(RunBootstrapErrorV1::Overflow)?,
    )
    .map_err(|_| RunBootstrapErrorV1::Overflow)
}

fn next_menu(value: MenuInstanceId) -> Result<MenuInstanceId, RunBootstrapErrorV1> {
    Ok(MenuInstanceId::new(next_safe(value.get())?))
}

fn non_actionable_control(kind: GameControlKindV2, revision: SafeU53) -> GameControlPlanV2 {
    GameControlPlanV2 {
        schema_version: er_types::m7::GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
        revision,
        kind,
        owner_seat: None,
        action_context: None,
        menu: None,
        actionable: false,
    }
}
