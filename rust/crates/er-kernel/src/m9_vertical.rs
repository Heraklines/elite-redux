//! Raw-input M9 vertical-slice orchestration over production M7 state/material owners.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use er_game::m7_content::PreparedGameContentV1;
use er_game::m7_runtime::{GameRuntimeSnapshotV5, GameRuntimeV5};
use er_game::m9_new_run::{
    M9NewRunError, prepare_m9_new_run_material, resolve_m9_vertical_turn,
    scripted_enemy_policy_for_m9, settle_m9_victory_and_start_next_encounter,
};
use er_game::m72_bootstrap::{RunBootstrapMachineV1, RunBootstrapStageV1};
use er_game::m72_new_run_material::apply_serialized_new_run_material_v1;
use er_state::m7_state::{GAME_STATE_SCHEMA_VERSION_V5, GameStateV5};
use er_types::battle_command::ScriptedEnemyPolicyV1;
use er_types::battle_model::BattleOutcome;
use er_types::input::{InputFocus, PhysicalKey, RawInputEvent};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum M9VerticalControlV1 {
    Bootstrap,
    CommandRoot,
    MoveSelect,
    Reward,
}

#[derive(Debug, Error)]
pub enum M9VerticalKernelErrorV1 {
    #[error("M9 bootstrap failed: {0}")]
    Bootstrap(String),
    #[error("M9 new-run or battle transition failed: {0}")]
    Game(#[from] M9NewRunError),
    #[error("M9 new-run material application failed: {0}")]
    Material(String),
    #[error("M9 runtime construction failed: {0}")]
    Runtime(String),
}

#[derive(Clone, Debug)]
pub struct M9VerticalSliceKernelV1 {
    bootstrap: RunBootstrapMachineV1,
    content: Arc<PreparedGameContentV1>,
    starter_oracle: Vec<u8>,
    runtime: Option<GameRuntimeV5>,
    enemy_policy: Option<ScriptedEnemyPolicyV1>,
    pressed_keys: BTreeSet<PhysicalKey>,
    control: M9VerticalControlV1,
    policy_cursor: usize,
    completed_battles: u32,
}

impl M9VerticalSliceKernelV1 {
    pub fn new(
        bootstrap: RunBootstrapMachineV1,
        content: Arc<PreparedGameContentV1>,
        starter_oracle: Vec<u8>,
    ) -> Result<Self, M9VerticalKernelErrorV1> {
        bootstrap
            .validate()
            .map_err(|error| M9VerticalKernelErrorV1::Bootstrap(error.to_string()))?;
        Ok(Self {
            bootstrap,
            content,
            starter_oracle,
            runtime: None,
            enemy_policy: None,
            pressed_keys: BTreeSet::new(),
            control: M9VerticalControlV1::Bootstrap,
            policy_cursor: 0,
            completed_battles: 0,
        })
    }

    pub fn raw_input(&mut self, event: RawInputEvent) -> Result<bool, M9VerticalKernelErrorV1> {
        if self.runtime.is_none() {
            let changed = self
                .bootstrap
                .raw_input(event)
                .map_err(|error| M9VerticalKernelErrorV1::Bootstrap(error.to_string()))?;
            if self.bootstrap.stage == RunBootstrapStageV1::Complete {
                self.activate_new_run()?;
            }
            return Ok(changed);
        }
        match event {
            RawInputEvent::KeyDown {
                code,
                browser_repeat,
                focus,
                ..
            } => {
                if browser_repeat
                    || focus != InputFocus::Game
                    || !self.pressed_keys.insert(code.clone())
                {
                    return Ok(false);
                }
                if !matches!(code, PhysicalKey::Space | PhysicalKey::Enter) {
                    return Ok(false);
                }
                match self.control {
                    M9VerticalControlV1::Bootstrap => Ok(false),
                    M9VerticalControlV1::CommandRoot => {
                        self.control = M9VerticalControlV1::MoveSelect;
                        Ok(true)
                    }
                    M9VerticalControlV1::MoveSelect => {
                        let runtime = self.runtime.as_mut().ok_or_else(|| {
                            M9VerticalKernelErrorV1::Runtime("runtime missing".to_owned())
                        })?;
                        let policy = self.enemy_policy.as_ref().ok_or_else(|| {
                            M9VerticalKernelErrorV1::Runtime("enemy policy missing".to_owned())
                        })?;
                        let prepared =
                            resolve_m9_vertical_turn(runtime, policy, self.policy_cursor)?;
                        self.policy_cursor =
                            self.policy_cursor.checked_add(1).ok_or_else(|| {
                                M9VerticalKernelErrorV1::Runtime(
                                    "enemy policy cursor overflowed".to_owned(),
                                )
                            })?;
                        self.control = if prepared.material.outcome == BattleOutcome::Victory {
                            M9VerticalControlV1::Reward
                        } else {
                            M9VerticalControlV1::CommandRoot
                        };
                        Ok(true)
                    }
                    M9VerticalControlV1::Reward => {
                        let runtime = self.runtime.as_ref().ok_or_else(|| {
                            M9VerticalKernelErrorV1::Runtime("runtime missing".to_owned())
                        })?;
                        let next = settle_m9_victory_and_start_next_encounter(
                            runtime.state(),
                            runtime.content(),
                        )?;
                        let policy = scripted_enemy_policy_for_m9(&next)?;
                        self.runtime =
                            Some(GameRuntimeV5::new(next, self.content.clone()).map_err(
                                |error| M9VerticalKernelErrorV1::Runtime(error.to_string()),
                            )?);
                        self.enemy_policy = Some(policy);
                        self.policy_cursor = 0;
                        self.completed_battles =
                            self.completed_battles.checked_add(1).ok_or_else(|| {
                                M9VerticalKernelErrorV1::Runtime(
                                    "completed battle count overflowed".to_owned(),
                                )
                            })?;
                        self.control = M9VerticalControlV1::CommandRoot;
                        Ok(true)
                    }
                }
            }
            RawInputEvent::KeyUp { code } => Ok(self.pressed_keys.remove(&code)),
            RawInputEvent::FocusChanged(InputFocus::TextEntry) | RawInputEvent::WindowBlurred => {
                self.pressed_keys.clear();
                Ok(false)
            }
            RawInputEvent::FocusChanged(InputFocus::Game)
            | RawInputEvent::WindowFocused
            | RawInputEvent::GamepadDown { .. }
            | RawInputEvent::GamepadUp { .. } => Ok(false),
        }
    }

    pub const fn control(&self) -> M9VerticalControlV1 {
        self.control
    }

    pub const fn completed_battles(&self) -> u32 {
        self.completed_battles
    }

    pub fn state(&self) -> Option<&GameStateV5> {
        self.runtime.as_ref().map(GameRuntimeV5::state)
    }

    pub fn snapshot(&self) -> Option<GameRuntimeSnapshotV5> {
        self.runtime.as_ref().map(GameRuntimeV5::snapshot)
    }

    fn activate_new_run(&mut self) -> Result<(), M9VerticalKernelErrorV1> {
        let material =
            prepare_m9_new_run_material(&self.bootstrap, &self.content, &self.starter_oracle)?;
        let bytes = material
            .encode()
            .map_err(|error| M9VerticalKernelErrorV1::Material(error.to_string()))?;
        let mut state = GameStateV5 {
            schema_version: GAME_STATE_SCHEMA_VERSION_V5,
            content_identity: self.content.identity().clone(),
            profile: self.bootstrap.profile.clone(),
            active_run: None,
        };
        let mut applied = BTreeMap::new();
        apply_serialized_new_run_material_v1(&mut state, &self.content, &bytes, &mut applied)
            .map_err(|error| M9VerticalKernelErrorV1::Material(error.to_string()))?;
        let policy = scripted_enemy_policy_for_m9(&state)?;
        self.runtime = Some(
            GameRuntimeV5::new(state, self.content.clone())
                .map_err(|error| M9VerticalKernelErrorV1::Runtime(error.to_string()))?,
        );
        self.enemy_policy = Some(policy);
        self.control = M9VerticalControlV1::CommandRoot;
        Ok(())
    }
}
