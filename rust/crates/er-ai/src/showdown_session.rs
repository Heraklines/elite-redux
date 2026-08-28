//! Deterministic Showdown negotiation, pending-battle state, and profile-set persistence.
use std::collections::BTreeMap;

use er_canonical::canonical_bytes;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::showdown::ShowdownTeamV1;

pub const SHOWDOWN_PROTO_VERSION_V1: u32 = 3;
pub const SHOWDOWN_PICK_WAIT_MS_V1: u64 = 600_000;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ShowdownBattleFormatV1 {
    Singles,
    Doubles,
    Triples,
}

impl ShowdownBattleFormatV1 {
    pub const fn field_width(self) -> usize {
        match self {
            Self::Singles => 1,
            Self::Doubles => 2,
            Self::Triples => 3,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ShowdownRejectReasonV1 {
    IllegalTeam,
    HashMismatch,
    Void,
    Timeout,
    ProtoMismatch,
    FormatMismatch,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum ShowdownFrameV1 {
    Team {
        manifest: ShowdownTeamV1,
        profile: Option<String>,
        protocol: u32,
        format: ShowdownBattleFormatV1,
    },
    Ready {
        team_hash: String,
    },
    Void {
        reason: ShowdownRejectReasonV1,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShowdownNegotiationResultV1 {
    pub own_manifest: ShowdownTeamV1,
    pub opponent_manifest: ShowdownTeamV1,
    pub opponent_team_hash: String,
    pub battle_format: ShowdownBattleFormatV1,
    pub opponent_profile: Option<String>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ShowdownNegotiationErrorV1 {
    #[error("showdown negotiation rejected: {0:?}")]
    Rejected(ShowdownRejectReasonV1),
    #[error("showdown session is disposed or already negotiating")]
    State,
    #[error("showdown team could not be canonically hashed")]
    Hash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ShowdownGateV1 {
    Waiting,
    ArriveBarrier,
    Resolved(ShowdownNegotiationResultV1),
    Rejected(ShowdownRejectReasonV1),
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShowdownSessionV1 {
    own_manifest: Option<ShowdownTeamV1>,
    own_profile: Option<String>,
    own_format: Option<ShowdownBattleFormatV1>,
    opponent_manifest: Option<ShowdownTeamV1>,
    opponent_profile: Option<String>,
    opponent_protocol: Option<u32>,
    opponent_format: Option<ShowdownBattleFormatV1>,
    opponent_team_hash: Option<String>,
    received_void: Option<ShowdownRejectReasonV1>,
    crossing_barrier: bool,
    handshake_echoed: bool,
    done: bool,
    disposed: bool,
}

impl ShowdownSessionV1 {
    pub fn negotiate(
        &mut self,
        own_manifest: ShowdownTeamV1,
        own_profile: Option<String>,
        battle_format: ShowdownBattleFormatV1,
    ) -> Result<Vec<ShowdownFrameV1>, ShowdownNegotiationErrorV1> {
        if self.disposed || self.done || self.own_manifest.is_some() {
            return Err(ShowdownNegotiationErrorV1::State);
        }
        if own_manifest.members.len() < battle_format.field_width()
            || own_manifest.members.len() > 6
        {
            self.done = true;
            return Ok(vec![ShowdownFrameV1::Void {
                reason: ShowdownRejectReasonV1::IllegalTeam,
            }]);
        }
        self.own_profile = sanitize_profile_v1(own_profile);
        self.own_format = Some(battle_format);
        self.own_manifest = Some(own_manifest);
        self.resend_handshake()
    }

    pub fn handle(
        &mut self,
        frame: ShowdownFrameV1,
    ) -> Result<(Vec<ShowdownFrameV1>, ShowdownGateV1), ShowdownNegotiationErrorV1> {
        if self.disposed || self.done {
            return Ok((Vec::new(), ShowdownGateV1::Waiting));
        }
        let mut outgoing = Vec::new();
        match frame {
            ShowdownFrameV1::Team {
                manifest,
                profile,
                protocol,
                format,
            } => {
                self.opponent_manifest = Some(manifest);
                self.opponent_profile = sanitize_profile_v1(profile);
                self.opponent_protocol = Some(protocol);
                self.opponent_format = Some(format);
            }
            ShowdownFrameV1::Ready { team_hash } => {
                if self.opponent_team_hash.is_none() && !self.handshake_echoed {
                    self.handshake_echoed = true;
                    outgoing.extend(self.resend_handshake()?);
                }
                self.opponent_team_hash = Some(team_hash);
            }
            ShowdownFrameV1::Void { reason } => self.received_void = Some(reason),
        }
        let gate = self.try_gate()?;
        if let ShowdownGateV1::Rejected(reason) = gate {
            outgoing.push(ShowdownFrameV1::Void { reason });
        }
        Ok((outgoing, gate))
    }

    pub fn try_gate(&mut self) -> Result<ShowdownGateV1, ShowdownNegotiationErrorV1> {
        if self.done || self.disposed || self.own_manifest.is_none() {
            return Ok(ShowdownGateV1::Waiting);
        }
        if let Some(reason) = self.received_void {
            return Ok(self.finish_reject(reason));
        }
        if self.opponent_manifest.is_some()
            && self.opponent_protocol != Some(SHOWDOWN_PROTO_VERSION_V1)
        {
            return Ok(self.finish_reject(ShowdownRejectReasonV1::ProtoMismatch));
        }
        if self.opponent_manifest.is_some() && self.opponent_format != self.own_format {
            return Ok(self.finish_reject(ShowdownRejectReasonV1::FormatMismatch));
        }
        let (Some(opponent), Some(committed_hash), Some(format)) = (
            self.opponent_manifest.as_ref(),
            self.opponent_team_hash.as_ref(),
            self.own_format,
        ) else {
            return Ok(ShowdownGateV1::Waiting);
        };
        if opponent.members.len() < format.field_width() || opponent.members.len() > 6 {
            return Ok(self.finish_reject(ShowdownRejectReasonV1::IllegalTeam));
        }
        if showdown_team_hash_v1(opponent)? != *committed_hash {
            return Ok(self.finish_reject(ShowdownRejectReasonV1::HashMismatch));
        }
        if !self.crossing_barrier {
            self.crossing_barrier = true;
            return Ok(ShowdownGateV1::ArriveBarrier);
        }
        Ok(ShowdownGateV1::Waiting)
    }

    pub fn finish_resolve(&mut self) -> Result<ShowdownGateV1, ShowdownNegotiationErrorV1> {
        if self.done || !self.crossing_barrier {
            return Err(ShowdownNegotiationErrorV1::State);
        }
        let result = ShowdownNegotiationResultV1 {
            own_manifest: self
                .own_manifest
                .clone()
                .ok_or(ShowdownNegotiationErrorV1::State)?,
            opponent_manifest: self
                .opponent_manifest
                .clone()
                .ok_or(ShowdownNegotiationErrorV1::State)?,
            opponent_team_hash: self
                .opponent_team_hash
                .clone()
                .ok_or(ShowdownNegotiationErrorV1::State)?,
            battle_format: self.own_format.ok_or(ShowdownNegotiationErrorV1::State)?,
            opponent_profile: self.opponent_profile.clone(),
        };
        self.done = true;
        Ok(ShowdownGateV1::Resolved(result))
    }

    pub fn timeout(&mut self) -> ShowdownGateV1 {
        self.finish_reject(ShowdownRejectReasonV1::Timeout)
    }

    pub fn void_and_reject(
        &mut self,
        reason: ShowdownRejectReasonV1,
    ) -> (ShowdownFrameV1, ShowdownGateV1) {
        (
            ShowdownFrameV1::Void {
                reason: ShowdownRejectReasonV1::IllegalTeam,
            },
            self.finish_reject(reason),
        )
    }

    pub fn finish_reject(&mut self, reason: ShowdownRejectReasonV1) -> ShowdownGateV1 {
        if !self.done {
            self.done = true;
        }
        ShowdownGateV1::Rejected(reason)
    }

    pub fn resend_handshake(&self) -> Result<Vec<ShowdownFrameV1>, ShowdownNegotiationErrorV1> {
        let Some(manifest) = self.own_manifest.clone() else {
            return Ok(Vec::new());
        };
        let format = self.own_format.ok_or(ShowdownNegotiationErrorV1::State)?;
        let hash = showdown_team_hash_v1(&manifest)?;
        Ok(vec![
            ShowdownFrameV1::Team {
                manifest,
                profile: self.own_profile.clone(),
                protocol: SHOWDOWN_PROTO_VERSION_V1,
                format,
            },
            ShowdownFrameV1::Ready { team_hash: hash },
        ])
    }

    pub fn dispose(&mut self) -> bool {
        if self.disposed {
            return false;
        }
        self.disposed = true;
        self.done = true;
        true
    }

    pub fn own_field_width(&self) -> usize {
        self.own_format
            .unwrap_or(ShowdownBattleFormatV1::Singles)
            .field_width()
    }
}

pub fn showdown_pick_wait_ms_v1(test_mode: bool) -> u64 {
    if test_mode {
        50
    } else {
        SHOWDOWN_PICK_WAIT_MS_V1
    }
}

pub fn default_schedule_v1(now_ms: u64, wait_ms: u64) -> Option<u64> {
    now_ms.checked_add(wait_ms)
}

pub fn showdown_team_hash_v1(team: &ShowdownTeamV1) -> Result<String, ShowdownNegotiationErrorV1> {
    let bytes = canonical_bytes(team).map_err(|_| ShowdownNegotiationErrorV1::Hash)?;
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    Ok(format!("{hash:016x}"))
}

fn sanitize_profile_v1(profile: Option<String>) -> Option<String> {
    profile.and_then(|value| {
        let sanitized = value
            .chars()
            .filter(|character| !character.is_control())
            .take(80)
            .collect::<String>();
        (!sanitized.is_empty()).then_some(sanitized)
    })
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct PendingShowdownStateV1 {
    pub session: Option<ShowdownSessionV1>,
    pub opponent_profile: Option<String>,
    pub field_opponent_profiles: BTreeMap<u8, String>,
}

impl PendingShowdownStateV1 {
    pub fn set_pending_showdown_session(&mut self, session: ShowdownSessionV1) {
        self.session = Some(session);
    }

    pub fn dispose_pending_showdown_session(&mut self) -> bool {
        let Some(mut session) = self.session.take() else {
            return false;
        };
        session.dispose();
        true
    }

    pub fn showdown_opponent_profile(&self) -> Option<&str> {
        self.opponent_profile.as_deref()
    }

    pub fn showdown_field_opponent_profile(&self, field_index: u8) -> Option<&str> {
        self.field_opponent_profiles
            .get(&field_index)
            .map(String::as_str)
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShowdownProfileSetsV1 {
    pub named_species_sets: BTreeMap<String, Vec<u8>>,
    pub species_sets: BTreeMap<u32, Vec<Vec<u8>>>,
    pub winning_sets: Vec<Vec<u8>>,
}

impl ShowdownProfileSetsV1 {
    pub fn save_species_sets(&mut self, species: u32, sets: Vec<Vec<u8>>) -> bool {
        if sets.is_empty() {
            return false;
        }
        self.species_sets.insert(species, sets);
        true
    }

    pub fn save_named_species_set(&mut self, name: String, set: Vec<u8>) -> bool {
        if name.is_empty() || set.is_empty() {
            return false;
        }
        self.named_species_sets.insert(name, set);
        true
    }

    pub fn save_winning_sets(&mut self, sets: Vec<Vec<u8>>) {
        self.winning_sets = sets;
    }
}

pub fn swap_showdown_session_data_v1<T>(left: &mut T, right: &mut T) {
    std::mem::swap(left, right);
}

#[cfg(test)]
mod tests {
    use er_types::SafeU53;
    use er_types::battle_ids::{AbilityId, MoveId, SpeciesId};
    use er_types::run_ids::NatureId;

    use super::*;
    use crate::showdown::ShowdownPokemonV1;

    fn team(species: u64) -> ShowdownTeamV1 {
        ShowdownTeamV1 {
            members: vec![ShowdownPokemonV1 {
                species: SpeciesId::new(SafeU53::new(species).expect("species")),
                form_index: 0,
                level: 50,
                nature: NatureId::new(1),
                moves: vec![MoveId::new(SafeU53::new(1).expect("move"))],
                active_ability: AbilityId::new(SafeU53::new(1).expect("ability")),
                passive_abilities: [None, None, None],
                held_items: Vec::new(),
                tera_type: None,
            }],
        }
    }

    #[test]
    fn showdown_negotiation_rejects_protocol_format_and_hash_drift() {
        let own = team(1);
        let opponent = team(2);
        let opponent_hash = showdown_team_hash_v1(&opponent).expect("hash");
        let mut session = ShowdownSessionV1::default();
        assert_eq!(
            session
                .negotiate(
                    own,
                    Some("peer\u{0007}".to_owned()),
                    ShowdownBattleFormatV1::Singles
                )
                .expect("negotiate")
                .len(),
            2
        );
        let (_, gate) = session
            .handle(ShowdownFrameV1::Team {
                manifest: opponent.clone(),
                profile: Some("opponent".to_owned()),
                protocol: SHOWDOWN_PROTO_VERSION_V1,
                format: ShowdownBattleFormatV1::Singles,
            })
            .expect("team");
        assert_eq!(gate, ShowdownGateV1::Waiting);
        let (_, gate) = session
            .handle(ShowdownFrameV1::Ready {
                team_hash: opponent_hash,
            })
            .expect("ready");
        assert_eq!(gate, ShowdownGateV1::ArriveBarrier);
        assert!(matches!(
            session.finish_resolve(),
            Ok(ShowdownGateV1::Resolved(_))
        ));

        let mut stale = ShowdownSessionV1::default();
        stale
            .negotiate(team(1), None, ShowdownBattleFormatV1::Singles)
            .expect("negotiate");
        let (_, gate) = stale
            .handle(ShowdownFrameV1::Team {
                manifest: team(2),
                profile: None,
                protocol: 2,
                format: ShowdownBattleFormatV1::Singles,
            })
            .expect("handle");
        assert_eq!(
            gate,
            ShowdownGateV1::Rejected(ShowdownRejectReasonV1::ProtoMismatch)
        );
    }

    #[test]
    fn pending_and_profile_set_state_is_idempotent() {
        let mut pending = PendingShowdownStateV1::default();
        pending.set_pending_showdown_session(ShowdownSessionV1::default());
        assert!(pending.dispose_pending_showdown_session());
        assert!(!pending.dispose_pending_showdown_session());
        let mut sets = ShowdownProfileSetsV1::default();
        assert!(sets.save_named_species_set("lead".to_owned(), vec![1]));
        assert!(sets.save_species_sets(1, vec![vec![2]]));
        sets.save_winning_sets(vec![vec![3]]);
        assert_eq!(sets.winning_sets, vec![vec![3]]);
        let mut left = 1;
        let mut right = 2;
        swap_showdown_session_data_v1(&mut left, &mut right);
        assert_eq!((left, right), (2, 1));
    }
}
