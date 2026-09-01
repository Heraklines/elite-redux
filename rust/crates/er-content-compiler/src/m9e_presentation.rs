//! Complete closed semantic presentation mapping for M9-E.

use er_game::m9e_content_v2::{
    PRESENTATION_CONTENT_SCHEMA_VERSION_V1, PresentationAssetIdentityV1, PresentationAudioCueV1,
    PresentationContentPackV1, PresentationCueFamilyV1, PresentationSemanticIdV1,
    PresentationSemanticMappingV1, PresentationUiRoleV1, ReducedPresentationPolicyV1,
    all_presentation_semantics_v1,
};
use er_types::battle_ui::{PresentationBlockingPolicy, PresentationSkipPolicy};
use er_types::{CatalogHash, GameControlKindV2, OracleSha};
use thiserror::Error;

pub const M9_PRESENTATION_ORACLE_SHA: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PresentationBuildErrorV1 {
    #[error("presentation identity is invalid")]
    Identity,
    #[error("presentation pack validation failed: {0}")]
    Validation(String),
}

pub fn build_m9_engineering_presentation_v1()
-> Result<PresentationContentPackV1, PresentationBuildErrorV1> {
    let oracle_sha = OracleSha::parse(M9_PRESENTATION_ORACLE_SHA)
        .map_err(|_| PresentationBuildErrorV1::Identity)?;
    let mappings = all_presentation_semantics_v1()
        .into_iter()
        .map(mapping)
        .collect();
    let mut pack = PresentationContentPackV1 {
        schema_version: PRESENTATION_CONTENT_SCHEMA_VERSION_V1,
        oracle_sha: oracle_sha.clone(),
        content_hash: CatalogHash::parse("0".repeat(64))
            .map_err(|_| PresentationBuildErrorV1::Identity)?,
        mappings,
    };
    pack.content_hash = pack
        .recompute_hash()
        .map_err(|error| PresentationBuildErrorV1::Validation(error.to_string()))?;
    pack.validate(&oracle_sha)
        .map_err(|error| PresentationBuildErrorV1::Validation(error.to_string()))?;
    Ok(pack)
}

fn mapping(semantic: PresentationSemanticIdV1) -> PresentationSemanticMappingV1 {
    match semantic {
        PresentationSemanticIdV1::Control(control) => control_mapping(control),
        PresentationSemanticIdV1::Cue(cue) => cue_mapping(cue),
        PresentationSemanticIdV1::UiRole(role) => role_mapping(role),
    }
}

fn control_mapping(control: GameControlKindV2) -> PresentationSemanticMappingV1 {
    use GameControlKindV2 as Control;
    use PresentationAssetIdentityV1 as Asset;
    use PresentationAudioCueV1 as Audio;

    let assets = match control {
        Control::BattleCommand
        | Control::BattleMove
        | Control::BattleTarget
        | Control::BattleSwitch
        | Control::BattleReplacement
        | Control::Capture => vec![Asset::InterfaceWindow, Asset::PokemonSprite],
        Control::StarterSelect
        | Control::FullParty
        | Control::Progression
        | Control::MoveLearn
        | Control::Evolution
        | Control::Fusion => vec![Asset::InterfaceWindow, Asset::PartyIcon],
        Control::Reward | Control::Market => vec![Asset::InterfaceWindow, Asset::ItemIcon],
        Control::Scenario => vec![Asset::InterfaceWindow, Asset::ScenarioSprite],
        Control::Biome | Control::Route => vec![Asset::InterfaceWindow, Asset::WorldBackdrop],
        Control::Complete => vec![Asset::TerminalOverlay],
        _ => vec![Asset::InterfaceWindow],
    };
    let audio_cue = match control {
        Control::Complete => Some(Audio::Terminal),
        Control::Waiting => None,
        _ => Some(Audio::Confirm),
    };
    PresentationSemanticMappingV1 {
        semantic: PresentationSemanticIdV1::Control(control),
        text_key: format!("m9.control.{control:?}").to_ascii_lowercase(),
        assets,
        audio_cue,
        blocking: PresentationBlockingPolicy::NonBlocking,
        skip: PresentationSkipPolicy::Forbidden,
        reduced: ReducedPresentationPolicyV1::Essential,
    }
}

fn cue_mapping(cue: PresentationCueFamilyV1) -> PresentationSemanticMappingV1 {
    use PresentationAssetIdentityV1 as Asset;
    use PresentationAudioCueV1 as Audio;
    use PresentationCueFamilyV1 as Cue;

    let assets = match cue {
        Cue::Move | Cue::Ability | Cue::HeldItem | Cue::Hp | Cue::Status | Cue::Stat => {
            vec![Asset::PokemonSprite, Asset::BattleEffect]
        }
        Cue::Switch | Cue::Faint | Cue::Capture => vec![Asset::PokemonSprite],
        Cue::Progression | Cue::Evolution | Cue::Fusion => {
            vec![Asset::PartyIcon, Asset::BattleEffect]
        }
        Cue::Reward | Cue::Market => vec![Asset::ItemIcon],
        Cue::World => vec![Asset::WorldBackdrop],
        Cue::Scenario => vec![Asset::ScenarioSprite],
        Cue::Terminal | Cue::Error => vec![Asset::TerminalOverlay],
        Cue::Save | Cue::Waiting => vec![Asset::InterfaceWindow],
    };
    let audio_cue = match cue {
        Cue::Move
        | Cue::Ability
        | Cue::HeldItem
        | Cue::Hp
        | Cue::Status
        | Cue::Stat
        | Cue::Switch
        | Cue::Faint => Some(Audio::Battle),
        Cue::Capture => Some(Audio::Capture),
        Cue::Progression | Cue::Reward | Cue::Market => Some(Audio::Reward),
        Cue::Evolution | Cue::Fusion => Some(Audio::Evolution),
        Cue::Terminal => Some(Audio::Terminal),
        Cue::Error => Some(Audio::Error),
        Cue::World | Cue::Scenario | Cue::Save | Cue::Waiting => None,
    };
    let blocking = match cue {
        Cue::Waiting | Cue::Save | Cue::World => PresentationBlockingPolicy::NonBlocking,
        _ => PresentationBlockingPolicy::BlocksHumanInput,
    };
    let skip = match cue {
        Cue::Terminal | Cue::Error => PresentationSkipPolicy::Forbidden,
        _ => PresentationSkipPolicy::Allowed,
    };
    let reduced = match cue {
        Cue::Terminal | Cue::Error | Cue::Capture | Cue::Evolution => {
            ReducedPresentationPolicyV1::Essential
        }
        Cue::Waiting | Cue::Save => ReducedPresentationPolicyV1::Omit,
        _ => ReducedPresentationPolicyV1::Reducible,
    };
    PresentationSemanticMappingV1 {
        semantic: PresentationSemanticIdV1::Cue(cue),
        text_key: format!("m9.cue.{cue:?}").to_ascii_lowercase(),
        assets,
        audio_cue,
        blocking,
        skip,
        reduced,
    }
}

fn role_mapping(role: PresentationUiRoleV1) -> PresentationSemanticMappingV1 {
    use PresentationAssetIdentityV1 as Asset;
    use PresentationAudioCueV1 as Audio;
    use PresentationUiRoleV1 as Role;

    let assets = match role {
        Role::Cursor => vec![Asset::Cursor],
        Role::PartyMember | Role::Target | Role::Status => vec![Asset::PartyIcon],
        Role::Item => vec![Asset::ItemIcon],
        _ => vec![Asset::InterfaceWindow],
    };
    PresentationSemanticMappingV1 {
        semantic: PresentationSemanticIdV1::UiRole(role),
        text_key: format!("m9.ui.{role:?}").to_ascii_lowercase(),
        assets,
        audio_cue: (role == Role::Cursor).then_some(Audio::Cursor),
        blocking: PresentationBlockingPolicy::NonBlocking,
        skip: PresentationSkipPolicy::Forbidden,
        reduced: ReducedPresentationPolicyV1::Essential,
    }
}
