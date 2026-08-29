//! Typed explanations for why a visible action is enabled or disabled.

use std::collections::BTreeMap;

use er_types::{GameBehaviorUnitId, GameControlPlanV2, MenuOptionId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum ActionLegalityReasonV1 {
    StaleMenu {
        expected: u64,
        actual: u64,
    },
    UnknownOption,
    HiddenOption,
    DisabledOption,
    NoPp {
        current_pp: u8,
    },
    InvalidTarget {
        target: String,
    },
    ActorUnavailable {
        actor: String,
    },
    ActivePartySlot,
    FaintedPartySlot,
    DuplicatePartyOccupant,
    StarterCost {
        current: u16,
        required: u16,
        maximum: u16,
    },
    StarterChallenge {
        challenge: String,
    },
    FullParty {
        current: usize,
        maximum: usize,
    },
    InsufficientMoney {
        current: u64,
        required: u64,
    },
    RewardUnavailable {
        reward: String,
    },
    ProgressionPrecondition {
        requirement: String,
    },
    EvolutionPrecondition {
        requirement: String,
    },
    CapturePrecondition {
        requirement: String,
    },
    AuthorityOwnership {
        owner: String,
        caller: String,
    },
    RecoveryFence,
    PresentationBarrier,
    UnsupportedContent {
        identity: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionLegalityEvidenceV1 {
    pub option: MenuOptionId,
    pub enabled: bool,
    pub reasons: Vec<ActionLegalityReasonV1>,
    pub source_behaviors: Vec<GameBehaviorUnitId>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum LegalityEvidenceErrorV1 {
    #[error("control or menu instance is invalid")]
    Control,
    #[error("legality behavior identity is empty or duplicated")]
    Behavior,
    #[error("enabled action cannot retain rejection reasons")]
    EnabledReasons,
}

pub fn explain_control_option_v1(
    control: &GameControlPlanV2,
    requested_menu_instance: u64,
    option: MenuOptionId,
    mut domain_reasons: BTreeMap<MenuOptionId, Vec<ActionLegalityReasonV1>>,
    mut source_behaviors: Vec<GameBehaviorUnitId>,
) -> Result<ActionLegalityEvidenceV1, LegalityEvidenceErrorV1> {
    control
        .validate()
        .map_err(|_| LegalityEvidenceErrorV1::Control)?;
    source_behaviors.sort();
    source_behaviors.dedup();
    if source_behaviors
        .iter()
        .any(|behavior| behavior.as_str().is_empty())
    {
        return Err(LegalityEvidenceErrorV1::Behavior);
    }
    let menu = control
        .menu
        .as_ref()
        .ok_or(LegalityEvidenceErrorV1::Control)?;
    let mut reasons = if menu.instance_id.get().get() != requested_menu_instance {
        vec![ActionLegalityReasonV1::StaleMenu {
            expected: menu.instance_id.get().get(),
            actual: requested_menu_instance,
        }]
    } else if let Some(menu_option) = menu
        .options
        .iter()
        .find(|candidate| candidate.option_id == option)
    {
        if !menu_option.visible {
            vec![ActionLegalityReasonV1::HiddenOption]
        } else if !menu_option.enabled {
            domain_reasons
                .remove(&option)
                .filter(|reasons| !reasons.is_empty())
                .unwrap_or_else(|| vec![ActionLegalityReasonV1::DisabledOption])
        } else {
            Vec::new()
        }
    } else {
        vec![ActionLegalityReasonV1::UnknownOption]
    };
    if reasons.is_empty()
        && let Some(extra) = domain_reasons.remove(&option)
        && !extra.is_empty()
    {
        reasons = extra;
    }
    let enabled = reasons.is_empty();
    let evidence = ActionLegalityEvidenceV1 {
        option,
        enabled,
        reasons,
        source_behaviors,
    };
    evidence.validate()?;
    Ok(evidence)
}

impl ActionLegalityEvidenceV1 {
    pub fn validate(&self) -> Result<(), LegalityEvidenceErrorV1> {
        if self.enabled && !self.reasons.is_empty() {
            return Err(LegalityEvidenceErrorV1::EnabledReasons);
        }
        if self
            .source_behaviors
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
            || self
                .source_behaviors
                .iter()
                .any(|behavior| behavior.as_str().is_empty())
        {
            return Err(LegalityEvidenceErrorV1::Behavior);
        }
        Ok(())
    }
}
