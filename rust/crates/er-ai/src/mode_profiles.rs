//! Canonical Ghost presentation and Moody runtime save state.
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const GHOST_NAME_MAX_V1: usize = 24;
pub const GHOST_TITLE_MAX_V1: usize = 32;
pub const GHOST_DIALOGUE_MAX_V1: usize = 80;
pub const MOODY_FORMATION_SAVE_VERSION_V1: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GhostApproachEffectV1 {
    Default,
    FromShadow,
    AppearsSuddenly,
    WandersIn,
    BlocksPath,
    FromAbove,
    RiseFromGround,
    FogMaterialize,
    FlashIn,
    ReverseDissolve,
}

pub fn is_ghost_approach_effect_v1(value: &str) -> bool {
    matches!(
        value,
        "default"
            | "fromShadow"
            | "appearsSuddenly"
            | "wandersIn"
            | "blocksPath"
            | "fromAbove"
            | "riseFromGround"
            | "fogMaterialize"
            | "flashIn"
            | "reverseDissolve"
    )
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GhostDialogueV1 {
    pub intro: Option<String>,
    pub defeat_player: Option<String>,
    pub defeated: Option<String>,
    pub after_win: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GhostProfileV1 {
    pub trainer_type: Option<u32>,
    pub female: Option<bool>,
    pub display_name: Option<String>,
    pub title: Option<String>,
    pub dialogue: Option<GhostDialogueV1>,
    pub tint_color: Option<i64>,
    pub aura: Option<String>,
    pub show_aura_in_battle: Option<bool>,
    pub approach: Option<GhostApproachEffectV1>,
    pub fx_speed_milli: Option<u16>,
    pub fx_intensity_milli: Option<u16>,
    pub music: Option<String>,
}

pub fn clamp_ghost_fx_tuning_v1(value_milli: i64, min_milli: u16, max_milli: u16) -> u16 {
    u16::try_from(value_milli)
        .ok()
        .filter(|value| *value >= min_milli && *value <= max_milli)
        .unwrap_or(1_000)
}

pub fn clamp_ghost_line_v1(value: Option<String>, max: usize) -> Option<String> {
    let cleaned = value?
        .chars()
        .filter(|character| !character.is_control() && *character != '\u{7f}')
        .collect::<String>()
        .trim()
        .chars()
        .take(max)
        .collect::<String>();
    (!cleaned.is_empty()).then_some(cleaned)
}

pub fn sanitize_ghost_profile_v1(mut raw: GhostProfileV1) -> Option<GhostProfileV1> {
    raw.display_name = clamp_ghost_line_v1(raw.display_name, GHOST_NAME_MAX_V1);
    raw.title = clamp_ghost_line_v1(raw.title, GHOST_TITLE_MAX_V1);
    raw.music = clamp_ghost_line_v1(raw.music, 64);
    if let Some(dialogue) = &mut raw.dialogue {
        dialogue.intro = clamp_ghost_line_v1(dialogue.intro.take(), GHOST_DIALOGUE_MAX_V1);
        dialogue.defeat_player =
            clamp_ghost_line_v1(dialogue.defeat_player.take(), GHOST_DIALOGUE_MAX_V1);
        dialogue.defeated = clamp_ghost_line_v1(dialogue.defeated.take(), GHOST_DIALOGUE_MAX_V1);
        dialogue.after_win = clamp_ghost_line_v1(dialogue.after_win.take(), GHOST_DIALOGUE_MAX_V1);
        if *dialogue == GhostDialogueV1::default() {
            raw.dialogue = None;
        }
    }
    if raw.approach == Some(GhostApproachEffectV1::Default) {
        raw.approach = None;
    }
    (raw != GhostProfileV1::default()).then_some(raw)
}

pub fn resolve_ghost_dialogue_v1(line: &str, context: &GhostDialogueContextV1) -> String {
    line.replace("{player}", context.player.as_deref().unwrap_or("Trainer"))
        .replace("{lead}", context.lead.as_deref().unwrap_or("your Pokemon"))
        .replace("{ace}", context.ace.as_deref().unwrap_or("your ace"))
        .replace(
            "{slayer}",
            context.slayer.as_deref().unwrap_or("your Pokemon"),
        )
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct GhostDialogueContextV1 {
    pub player: Option<String>,
    pub lead: Option<String>,
    pub ace: Option<String>,
    pub slayer: Option<String>,
}

pub fn default_ghost_profile_v1() -> GhostProfileV1 {
    GhostProfileV1::default()
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GhostTeamStoreV1 {
    pub local_team: Option<Vec<u8>>,
    pub shared_cache: BTreeMap<String, Vec<u8>>,
}

impl GhostTeamStoreV1 {
    pub fn save_local_ghost_team(&mut self, bytes: Vec<u8>) -> bool {
        if bytes.is_empty() {
            return false;
        }
        self.local_team = Some(bytes);
        true
    }

    pub fn save_shared_ghost_cache(&mut self, key: String, bytes: Vec<u8>) -> bool {
        if key.is_empty() || bytes.is_empty() {
            return false;
        }
        self.shared_cache.insert(key, bytes);
        true
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoodyRuntimeStateV1 {
    pub counters: BTreeMap<String, i64>,
    pub flags: BTreeMap<String, bool>,
    pub values: BTreeMap<String, i64>,
    pub lists: BTreeMap<String, Vec<i64>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoodyFormationEffectV1 {
    pub instance_id: String,
    pub boon_id: String,
    pub rank: u8,
    pub evolution_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoodyFormationBindingV1 {
    pub effect: MoodyFormationEffectV1,
    pub state: MoodyRuntimeStateV1,
    pub active: bool,
    pub acquisition_order: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoodyFormationSessionV1 {
    pub version: u32,
    pub sequence: u64,
    pub bindings: Vec<MoodyFormationBindingV1>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MoodyResetBoundaryV1 {
    Run,
    Battle,
    Other,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum MoodySaveErrorV1 {
    #[error("unsupported Moody save version")]
    Version,
    #[error("duplicate or empty Moody formation instance")]
    Binding,
}

pub fn create_moody_formation_session_v1(
    effects: Vec<MoodyFormationEffectV1>,
) -> Result<MoodyFormationSessionV1, MoodySaveErrorV1> {
    let bindings = effects
        .into_iter()
        .enumerate()
        .map(|(index, effect)| MoodyFormationBindingV1 {
            effect,
            state: MoodyRuntimeStateV1::default(),
            active: true,
            acquisition_order: index as u32,
        })
        .collect();
    serialize_moody_formation_session_v1(MoodyFormationSessionV1 {
        version: MOODY_FORMATION_SAVE_VERSION_V1,
        sequence: 0,
        bindings,
    })
}

pub fn serialize_moody_formation_session_v1(
    mut session: MoodyFormationSessionV1,
) -> Result<MoodyFormationSessionV1, MoodySaveErrorV1> {
    validate_bindings_v1(&session.bindings)?;
    session.bindings.sort_by(|left, right| {
        left.acquisition_order
            .cmp(&right.acquisition_order)
            .then_with(|| left.effect.instance_id.cmp(&right.effect.instance_id))
    });
    Ok(session)
}

pub fn hydrate_moody_formation_session_v1(
    saved: MoodyFormationSessionV1,
) -> Result<MoodyFormationSessionV1, MoodySaveErrorV1> {
    if saved.version != MOODY_FORMATION_SAVE_VERSION_V1 {
        return Err(MoodySaveErrorV1::Version);
    }
    serialize_moody_formation_session_v1(saved)
}

pub fn reset_moody_formation_session_v1(
    mut session: MoodyFormationSessionV1,
    boundary: MoodyResetBoundaryV1,
) -> Result<MoodyFormationSessionV1, MoodySaveErrorV1> {
    match boundary {
        MoodyResetBoundaryV1::Run => {
            session.sequence = 0;
            for binding in &mut session.bindings {
                binding.state = MoodyRuntimeStateV1::default();
            }
        }
        MoodyResetBoundaryV1::Battle => {
            for binding in &mut session.bindings {
                binding
                    .state
                    .counters
                    .retain(|key, _| !key.starts_with("battle."));
                binding
                    .state
                    .flags
                    .retain(|key, _| !key.starts_with("battle."));
                binding
                    .state
                    .values
                    .retain(|key, _| !key.starts_with("battle."));
                binding
                    .state
                    .lists
                    .retain(|key, _| !key.starts_with("battle."));
            }
        }
        MoodyResetBoundaryV1::Other => {}
    }
    serialize_moody_formation_session_v1(session)
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoodyModeSaveV1 {
    pub seed: u32,
    pub formation_runtime: Option<MoodyFormationSessionV1>,
    pub formation_engine: Option<Vec<u8>>,
    pub field_runtime: MoodyRuntimeStateV1,
}

impl MoodyModeSaveV1 {
    pub fn get_save_data(&self) -> Self {
        self.clone()
    }

    pub fn set_formation_runtime(
        &mut self,
        runtime: MoodyFormationSessionV1,
    ) -> Result<(), MoodySaveErrorV1> {
        self.formation_runtime = Some(serialize_moody_formation_session_v1(runtime)?);
        Ok(())
    }

    pub fn set_formation_engine(&mut self, bytes: Vec<u8>) {
        self.formation_engine = Some(bytes);
    }

    pub fn set_runtime_field(&mut self, field: MoodyRuntimeStateV1) -> bool {
        self.field_runtime = field;
        true
    }

    pub fn attach_runtime_field(&mut self, field: MoodyRuntimeStateV1) {
        self.field_runtime = field;
    }

    pub fn extract_runtime_field(&self) -> MoodyRuntimeStateV1 {
        self.field_runtime.clone()
    }

    pub fn mutate_save_for_command(&mut self, key: String, value: i64) -> bool {
        if key.is_empty() {
            return false;
        }
        self.field_runtime.values.insert(key, value);
        true
    }

    pub fn reconcile_session(
        &mut self,
        runtime: MoodyFormationSessionV1,
    ) -> Result<(), MoodySaveErrorV1> {
        self.set_formation_runtime(runtime)
    }
}

fn validate_bindings_v1(bindings: &[MoodyFormationBindingV1]) -> Result<(), MoodySaveErrorV1> {
    let mut ids = BTreeSet::new();
    if bindings.iter().any(|binding| {
        binding.effect.instance_id.is_empty() || !ids.insert(binding.effect.instance_id.clone())
    }) {
        return Err(MoodySaveErrorV1::Binding);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ghost_profile_sanitizes_lines_tokens_and_effects() {
        let profile = sanitize_ghost_profile_v1(GhostProfileV1 {
            display_name: Some(format!("  {}\u{0007}  ", "x".repeat(30))),
            approach: Some(GhostApproachEffectV1::Default),
            dialogue: Some(GhostDialogueV1 {
                intro: Some("Hello {player}".to_owned()),
                ..GhostDialogueV1::default()
            }),
            ..GhostProfileV1::default()
        })
        .expect("profile");
        assert_eq!(profile.display_name.expect("name").len(), GHOST_NAME_MAX_V1);
        assert_eq!(profile.approach, None);
        assert_eq!(
            resolve_ghost_dialogue_v1(
                "Hello {player}, bring {lead}",
                &GhostDialogueContextV1::default()
            ),
            "Hello Trainer, bring your Pokemon"
        );
        assert_eq!(clamp_ghost_fx_tuning_v1(9_000, 250, 3_000), 1_000);
    }

    #[test]
    fn moody_sessions_sort_validate_reset_and_round_trip() {
        let mut session = create_moody_formation_session_v1(vec![
            MoodyFormationEffectV1 {
                instance_id: "b".to_owned(),
                boon_id: "boon-b".to_owned(),
                rank: 1,
                evolution_id: None,
            },
            MoodyFormationEffectV1 {
                instance_id: "a".to_owned(),
                boon_id: "boon-a".to_owned(),
                rank: 1,
                evolution_id: None,
            },
        ])
        .expect("session");
        session.bindings[0]
            .state
            .values
            .insert("battle.damage".to_owned(), 4);
        session.bindings[0]
            .state
            .values
            .insert("run.total".to_owned(), 8);
        let reset =
            reset_moody_formation_session_v1(session, MoodyResetBoundaryV1::Battle).expect("reset");
        assert!(!reset.bindings[0].state.values.contains_key("battle.damage"));
        assert_eq!(reset.bindings[0].state.values.get("run.total"), Some(&8));
        assert_eq!(
            hydrate_moody_formation_session_v1(reset.clone()).expect("hydrate"),
            reset
        );
    }
}
