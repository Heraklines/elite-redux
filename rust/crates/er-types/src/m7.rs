//! M7 full-game identities and content bindings.

use std::fmt;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    BattleContentPackHashV3, CatalogHash, GameActionContextV1, GameMenuV2, OracleSha, SafeU53,
    SafeU53Error, SeatId,
};

macro_rules! safe_u53_id {
    ($($name:ident),+ $(,)?) => {
        $(
            #[derive(
                Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize,
                Deserialize,
            )]
            #[serde(transparent)]
            pub struct $name(SafeU53);

            impl $name {
                pub const ZERO: Self = Self(SafeU53::ZERO);

                pub const fn new(value: SafeU53) -> Self {
                    Self(value)
                }

                pub const fn get(self) -> SafeU53 {
                    self.0
                }

                pub fn try_from_u64(value: u64) -> Result<Self, SafeU53Error> {
                    SafeU53::new(value).map(Self::new)
                }
            }

            impl From<$name> for SafeU53 {
                fn from(value: $name) -> Self {
                    value.get()
                }
            }

            impl TryFrom<u64> for $name {
                type Error = SafeU53Error;

                fn try_from(value: u64) -> Result<Self, Self::Error> {
                    Self::try_from_u64(value)
                }
            }

            impl fmt::Display for $name {
                fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                    self.0.fmt(formatter)
                }
            }
        )+
    };
}

safe_u53_id!(
    AchievementId,
    AiPolicyId,
    ChallengeId,
    EvolutionId,
    FactionId,
    HeldItemInstanceId,
    InventoryItemId,
    ProfileFlagId,
    QuestId,
    RunFlagId,
    RunModifierInstanceId,
    RunProgramId,
    ScenarioId,
    ScenarioNodeId,
    StorageSlotId,
    UnlockId,
);

const BLAKE3_PREFIX: &str = "blake3-v1:";
const SHA256_PREFIX: &str = "sha256-v1:";
const HEX_LENGTH: usize = 64;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum M7IdentityError {
    #[error("identity must use the expected digest prefix and 64 lowercase hexadecimal digits")]
    Digest,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GameBehaviorUnitId(String);

impl GameBehaviorUnitId {
    pub fn parse(value: impl Into<String>) -> Result<Self, M7IdentityError> {
        let value = value.into();
        if value.len() != HEX_LENGTH
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(M7IdentityError::Digest);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for GameBehaviorUnitId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct GameContentBundleHash(String);

impl GameContentBundleHash {
    pub fn parse(value: impl Into<String>) -> Result<Self, M7IdentityError> {
        let value = value.into();
        validate_digest(&value, BLAKE3_PREFIX)?;
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for GameContentBundleHash {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SaveChecksum(String);

impl SaveChecksum {
    pub fn parse(value: impl Into<String>) -> Result<Self, M7IdentityError> {
        let value = value.into();
        validate_digest(&value, SHA256_PREFIX)?;
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SaveChecksum {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameContentIdentity {
    pub oracle_sha: OracleSha,
    pub content_hash: GameContentBundleHash,
    pub battle_content_hash: BattleContentPackHashV3,
    pub semantic_catalog_hash: CatalogHash,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameBehaviorStatus {
    Compiled,
    BespokeImplemented,
    SemanticallyInert,
    PlatformEffect,
    PresentationOnly,
}
pub const GAME_CONTROL_PLAN_SCHEMA_VERSION_V2: u32 = 2;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameControlKindV2 {
    Title,
    ModeSelect,
    StarterSelect,
    BattleCommand,
    BattleMove,
    BattleTarget,
    BattleSwitch,
    BattleReplacement,
    Capture,
    FullParty,
    Progression,
    MoveLearn,
    Evolution,
    Fusion,
    Reward,
    Market,
    Scenario,
    Quest,
    Faction,
    Biome,
    Route,
    Save,
    Waiting,
    Complete,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameControlPlanV2 {
    pub schema_version: u32,
    pub revision: SafeU53,
    pub kind: GameControlKindV2,
    pub owner_seat: Option<SeatId>,
    pub action_context: Option<GameActionContextV1>,
    pub menu: Option<GameMenuV2>,
    pub actionable: bool,
}

impl GameControlPlanV2 {
    pub fn validate(&self) -> Result<(), GameControlPlanV2Error> {
        if self.schema_version != GAME_CONTROL_PLAN_SCHEMA_VERSION_V2 {
            return Err(GameControlPlanV2Error::SchemaVersion {
                expected: GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
                actual: self.schema_version,
            });
        }
        if let Some(menu) = &self.menu {
            menu.validate().map_err(GameControlPlanV2Error::Menu)?;
            if self.owner_seat != Some(menu.owner_seat) {
                return Err(GameControlPlanV2Error::MenuOwner);
            }
        }
        if self.actionable && self.menu.is_none() {
            return Err(GameControlPlanV2Error::ActionableWithoutMenu);
        }
        if self.actionable {
            let context = self
                .action_context
                .as_ref()
                .ok_or(GameControlPlanV2Error::ActionableWithoutContext)?;
            let menu = self
                .menu
                .as_ref()
                .ok_or(GameControlPlanV2Error::ActionableWithoutMenu)?;
            if context.authority_revision != self.revision
                || context.menu_instance != menu.instance_id
            {
                return Err(GameControlPlanV2Error::ContextMismatch);
            }
        } else if self.action_context.is_some() {
            return Err(GameControlPlanV2Error::NonActionableContext);
        }
        if matches!(
            self.kind,
            GameControlKindV2::Waiting | GameControlKindV2::Complete
        ) && self.actionable
        {
            return Err(GameControlPlanV2Error::NonInteractiveActionable);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameControlPlanV2Error {
    #[error("GameControlPlanV2 schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("game menu is invalid: {0}")]
    Menu(crate::m7_menu::GameMenuError),
    #[error("logical menu owner does not match control owner")]
    MenuOwner,
    #[error("an actionable control requires a logical menu")]
    ActionableWithoutMenu,
    #[error("an actionable control requires an action context")]
    ActionableWithoutContext,
    #[error("control action context differs from control revision or menu instance")]
    ContextMismatch,
    #[error("a non-actionable control cannot retain an action context")]
    NonActionableContext,
    #[error("waiting and complete controls cannot be actionable")]
    NonInteractiveActionable,
}

fn validate_digest(value: &str, prefix: &str) -> Result<(), M7IdentityError> {
    let Some(hex) = value.strip_prefix(prefix) else {
        return Err(M7IdentityError::Digest);
    };
    if hex.len() != HEX_LENGTH
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(M7IdentityError::Digest);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{GameContentBundleHash, SaveChecksum};

    #[test]
    fn digest_identities_reject_wrong_prefix_case_and_length() {
        assert!(GameContentBundleHash::parse(format!("blake3-v1:{}", "a".repeat(64))).is_ok());
        assert!(GameContentBundleHash::parse(format!("sha256-v1:{}", "a".repeat(64))).is_err());
        assert!(GameContentBundleHash::parse(format!("blake3-v1:{}", "A".repeat(64))).is_err());
        assert!(SaveChecksum::parse(format!("sha256-v1:{}", "0".repeat(64))).is_ok());
        assert!(SaveChecksum::parse(format!("sha256-v1:{}", "0".repeat(63))).is_err());
    }
}
