//! Deterministic session/profile persistence orchestration without platform I/O.
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::profile::{ProfilePersistenceV1, ShowdownTeamPresetV1};

pub const SESSION_PERSISTENCE_SCHEMA_VERSION_V1: u32 = 1;
pub const SESSION_SLOT_COUNT_V1: u8 = 5;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoopParticipantsV1 {
    pub players: [String; 2],
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionRecordV1 {
    pub slot: u8,
    pub name: String,
    pub account: String,
    pub bytes: Vec<u8>,
    pub participants: Option<CoopParticipantsV1>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SessionImportRelationV1 {
    SameBytes,
    SameRunDifferentBytes,
    ReplacementTombstone,
    Ordinary,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportableSaveBundleV1 {
    pub system: Vec<u8>,
    pub sessions: Vec<SessionRecordV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum PersistenceEffectV1 {
    Write { key: String, bytes: Vec<u8> },
    Delete { key: String },
    WarnStorageFull,
    CloudWrite { bytes: Vec<u8>, force: bool },
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SessionPersistenceErrorV1 {
    #[error("session slot is outside 0..5")]
    Slot,
    #[error("account and session names cannot be empty")]
    Identity,
    #[error("session persistence lease is already held")]
    LeaseHeld,
    #[error("session bytes are empty or malformed")]
    Malformed,
    #[error("co-op participants do not match the live pair")]
    ParticipantMismatch,
    #[error("storage capacity was exceeded")]
    Capacity,
    #[error("session save version or numeric field is invalid")]
    Version,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionMigrationResultV1 {
    pub money: i64,
    pub applied_migrator_versions: Vec<String>,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionPersistenceRuntimeV1 {
    pub schema_version: u32,
    pub account: String,
    pub profile: ProfilePersistenceV1,
    pub system_bytes: Option<Vec<u8>>,
    pub sessions: BTreeMap<u8, SessionRecordV1>,
    pub fun_debug_baseline: Option<Vec<u8>>,
    pub warned_storage_full: bool,
    pub local_storage_capacity: usize,
    lease_held: bool,
}

impl SessionPersistenceRuntimeV1 {
    pub fn new(
        account: String,
        local_storage_capacity: usize,
    ) -> Result<Self, SessionPersistenceErrorV1> {
        if account.is_empty() {
            return Err(SessionPersistenceErrorV1::Identity);
        }
        Ok(Self {
            schema_version: SESSION_PERSISTENCE_SCHEMA_VERSION_V1,
            account,
            profile: ProfilePersistenceV1::default(),
            system_bytes: None,
            sessions: BTreeMap::new(),
            fun_debug_baseline: None,
            warned_storage_full: false,
            local_storage_capacity,
            lease_held: false,
        })
    }

    pub fn get_system_save_data(&self) -> Option<&[u8]> {
        self.fun_debug_baseline
            .as_deref()
            .or(self.system_bytes.as_deref())
    }

    pub fn begin_fun_debug_baseline(&mut self) -> bool {
        if self.fun_debug_baseline.is_some() {
            return false;
        }
        let Some(bytes) = self.system_bytes.clone() else {
            return false;
        };
        self.fun_debug_baseline = Some(bytes);
        true
    }

    pub fn save_showdown_team_preset(
        &mut self,
        preset: ShowdownTeamPresetV1,
        index: Option<usize>,
    ) -> usize {
        self.profile.save_showdown_team_preset(preset, index)
    }

    pub fn warn_local_storage_full(&mut self) -> Option<PersistenceEffectV1> {
        if self.warned_storage_full {
            return None;
        }
        self.warned_storage_full = true;
        Some(PersistenceEffectV1::WarnStorageFull)
    }

    pub fn try_set_local_storage_item(
        &mut self,
        key: String,
        bytes: Vec<u8>,
    ) -> Result<PersistenceEffectV1, SessionPersistenceErrorV1> {
        if key.is_empty() {
            return Err(SessionPersistenceErrorV1::Identity);
        }
        let occupied = self
            .system_bytes
            .as_ref()
            .map_or(0, Vec::len)
            .checked_add(
                self.sessions
                    .values()
                    .map(|session| session.bytes.len())
                    .sum(),
            )
            .ok_or(SessionPersistenceErrorV1::Capacity)?;
        if occupied
            .checked_add(bytes.len())
            .is_none_or(|size| size > self.local_storage_capacity)
        {
            return Err(SessionPersistenceErrorV1::Capacity);
        }
        self.warned_storage_full = false;
        Ok(PersistenceEffectV1::Write { key, bytes })
    }

    pub fn save_system(
        &mut self,
        bytes: Vec<u8>,
        force_sync: bool,
    ) -> Result<Vec<PersistenceEffectV1>, SessionPersistenceErrorV1> {
        if bytes.is_empty() {
            return Err(SessionPersistenceErrorV1::Malformed);
        }
        if self
            .system_bytes
            .as_ref()
            .is_some_and(|current| !current.is_empty())
            && bytes == b"{}"
        {
            return Err(SessionPersistenceErrorV1::Malformed);
        }
        let local =
            self.try_set_local_storage_item(format!("data_{}", self.account), bytes.clone())?;
        self.system_bytes = Some(bytes.clone());
        Ok(vec![
            local,
            PersistenceEffectV1::CloudWrite {
                bytes,
                force: force_sync,
            },
        ])
    }

    pub fn save_all(
        &mut self,
        system: Vec<u8>,
        session: Option<SessionRecordV1>,
    ) -> Result<Vec<PersistenceEffectV1>, SessionPersistenceErrorV1> {
        let mut effects = self.save_system(system, false)?;
        if let Some(session) = session {
            effects.push(self.update_session_bounded(session)?);
        }
        Ok(effects)
    }

    pub fn parse_session_data(
        &self,
        slot: u8,
        name: String,
        bytes: Vec<u8>,
        participants: Option<CoopParticipantsV1>,
    ) -> Result<SessionRecordV1, SessionPersistenceErrorV1> {
        validate_slot(slot)?;
        if name.is_empty() || bytes.is_empty() || !looks_like_json_object(&bytes) {
            return Err(SessionPersistenceErrorV1::Malformed);
        }
        Ok(SessionRecordV1 {
            slot,
            name,
            account: self.account.clone(),
            bytes,
            participants,
        })
    }

    pub fn get_session(
        &self,
        slot: u8,
    ) -> Result<Option<&SessionRecordV1>, SessionPersistenceErrorV1> {
        validate_slot(slot)?;
        Ok(self.sessions.get(&slot))
    }

    pub fn load_session(
        &self,
        slot: u8,
        live_participants: Option<&CoopParticipantsV1>,
    ) -> Result<Option<&SessionRecordV1>, SessionPersistenceErrorV1> {
        let Some(session) = self.get_session(slot)? else {
            return Ok(None);
        };
        if session.participants.as_ref() != live_participants {
            return Err(SessionPersistenceErrorV1::ParticipantMismatch);
        }
        Ok(Some(session))
    }

    pub fn init_session_from_data(
        &mut self,
        session: SessionRecordV1,
    ) -> Result<(), SessionPersistenceErrorV1> {
        validate_session(&session, &self.account)?;
        self.sessions.insert(session.slot, session);
        Ok(())
    }

    pub fn rename_session(
        &mut self,
        slot: u8,
        name: String,
    ) -> Result<(), SessionPersistenceErrorV1> {
        validate_slot(slot)?;
        if name.is_empty() {
            return Err(SessionPersistenceErrorV1::Identity);
        }
        let session = self
            .sessions
            .get_mut(&slot)
            .ok_or(SessionPersistenceErrorV1::Malformed)?;
        session.name = name;
        Ok(())
    }

    pub fn with_session_persistence_lease<T>(
        &mut self,
        operation: impl FnOnce(&mut Self) -> Result<T, SessionPersistenceErrorV1>,
    ) -> Result<T, SessionPersistenceErrorV1> {
        if self.lease_held {
            return Err(SessionPersistenceErrorV1::LeaseHeld);
        }
        self.lease_held = true;
        let result = operation(self);
        self.lease_held = false;
        result
    }

    pub fn update_session_bounded(
        &mut self,
        session: SessionRecordV1,
    ) -> Result<PersistenceEffectV1, SessionPersistenceErrorV1> {
        validate_session(&session, &self.account)?;
        let effect = self.try_set_local_storage_item(
            session_key(&self.account, session.slot),
            session.bytes.clone(),
        )?;
        self.sessions.insert(session.slot, session);
        Ok(effect)
    }

    pub fn clear_session_bounded(
        &mut self,
        slot: u8,
    ) -> Result<Option<PersistenceEffectV1>, SessionPersistenceErrorV1> {
        validate_slot(slot)?;
        if self.sessions.remove(&slot).is_none() {
            return Ok(None);
        }
        Ok(Some(PersistenceEffectV1::Delete {
            key: session_key(&self.account, slot),
        }))
    }

    pub fn delete_session_bounded(
        &mut self,
        slot: u8,
    ) -> Result<Option<PersistenceEffectV1>, SessionPersistenceErrorV1> {
        self.clear_session_bounded(slot)
    }

    pub fn classify_session_json_for_exact_delete(
        &self,
        slot: u8,
        candidate: &[u8],
    ) -> Result<bool, SessionPersistenceErrorV1> {
        validate_slot(slot)?;
        Ok(self
            .sessions
            .get(&slot)
            .is_some_and(|session| session.bytes == candidate))
    }

    pub fn assess_import_over_local_session(
        &self,
        slot: u8,
        imported: &SessionRecordV1,
    ) -> Result<SessionImportRelationV1, SessionPersistenceErrorV1> {
        validate_session(imported, &self.account)?;
        let Some(local) = self.sessions.get(&slot) else {
            return Ok(SessionImportRelationV1::Ordinary);
        };
        if local.bytes == imported.bytes {
            return Ok(SessionImportRelationV1::SameBytes);
        }
        if local.name == imported.name && local.participants == imported.participants {
            return Ok(SessionImportRelationV1::SameRunDifferentBytes);
        }
        if imported.bytes == b"{}" {
            return Ok(SessionImportRelationV1::ReplacementTombstone);
        }
        Ok(SessionImportRelationV1::Ordinary)
    }

    pub fn find_importable_local_save<'a>(
        &self,
        candidates: &'a BTreeMap<String, Vec<u8>>,
    ) -> Option<(&'a String, &'a Vec<u8>)> {
        candidates.iter().find(|(key, bytes)| {
            !key.ends_with("_bak")
                && key.starts_with("data_")
                && !bytes.is_empty()
                && looks_like_json_object(bytes)
        })
    }

    pub fn find_importable_local_session_saves(
        &self,
        candidates: &BTreeMap<String, Vec<u8>>,
    ) -> Vec<SessionRecordV1> {
        (0..SESSION_SLOT_COUNT_V1)
            .filter_map(|slot| {
                let key = session_key(&self.account, slot);
                let bytes = candidates.get(&key)?.clone();
                self.parse_session_data(slot, format!("Session {}", slot + 1), bytes, None)
                    .ok()
            })
            .collect()
    }

    pub fn find_importable_local_save_bundle(
        &self,
        candidates: &BTreeMap<String, Vec<u8>>,
    ) -> Option<ImportableSaveBundleV1> {
        let (_, system) = self.find_importable_local_save(candidates)?;
        Some(ImportableSaveBundleV1 {
            system: system.clone(),
            sessions: self.find_importable_local_session_saves(candidates),
        })
    }

    pub fn import_system_save_string(
        &mut self,
        bytes: Vec<u8>,
    ) -> Result<(), SessionPersistenceErrorV1> {
        if bytes.is_empty() || !looks_like_json_object(&bytes) {
            return Err(SessionPersistenceErrorV1::Malformed);
        }
        self.system_bytes = Some(bytes);
        Ok(())
    }

    pub fn import_local_save_bundle(
        &mut self,
        bundle: ImportableSaveBundleV1,
    ) -> Result<(), SessionPersistenceErrorV1> {
        self.import_system_save_string(bundle.system)?;
        for session in bundle.sessions {
            self.init_session_from_data(session)?;
        }
        Ok(())
    }

    pub fn decrypt_importable_local_save<'a>(
        &self,
        guest_decoded: Option<&'a [u8]>,
        authenticated_decoded: Option<&'a [u8]>,
    ) -> Result<&'a [u8], SessionPersistenceErrorV1> {
        guest_decoded
            .filter(|bytes| looks_like_json_object(bytes))
            .or_else(|| authenticated_decoded.filter(|bytes| looks_like_json_object(bytes)))
            .ok_or(SessionPersistenceErrorV1::Malformed)
    }

    pub fn apply_session_version_migration(
        &self,
        source_version: &str,
        latest_version: &str,
        money: f64,
    ) -> Result<SessionMigrationResultV1, SessionPersistenceErrorV1> {
        let source = parse_semver_v1(source_version).ok_or(SessionPersistenceErrorV1::Version)?;
        let latest = parse_semver_v1(latest_version).ok_or(SessionPersistenceErrorV1::Version)?;
        if !money.is_finite() || money.floor() < i64::MIN as f64 || money.floor() > i64::MAX as f64
        {
            return Err(SessionPersistenceErrorV1::Version);
        }
        let applied_migrator_versions = if source < latest {
            [[1, 0, 4], [1, 0, 4], [1, 7, 0], [1, 9, 0], [1, 10, 0]]
                .into_iter()
                .filter(|version| *version > source && *version <= latest)
                .map(|version| format!("{}.{}.{}", version[0], version[1], version[2]))
                .collect()
        } else {
            Vec::new()
        };
        Ok(SessionMigrationResultV1 {
            money: money.floor() as i64,
            applied_migrator_versions,
        })
    }

    pub fn exact_digest(bytes: &[u8]) -> String {
        format!("sha256-v1:{:x}", Sha256::digest(bytes))
    }
}

fn validate_slot(slot: u8) -> Result<(), SessionPersistenceErrorV1> {
    if slot >= SESSION_SLOT_COUNT_V1 {
        return Err(SessionPersistenceErrorV1::Slot);
    }
    Ok(())
}

fn validate_session(
    session: &SessionRecordV1,
    account: &str,
) -> Result<(), SessionPersistenceErrorV1> {
    validate_slot(session.slot)?;
    if session.name.is_empty() || session.account != account || session.bytes.is_empty() {
        return Err(SessionPersistenceErrorV1::Identity);
    }
    if !looks_like_json_object(&session.bytes) {
        return Err(SessionPersistenceErrorV1::Malformed);
    }
    Ok(())
}

fn looks_like_json_object(bytes: &[u8]) -> bool {
    bytes.first() == Some(&b'{') && bytes.last() == Some(&b'}')
}

fn session_key(account: &str, slot: u8) -> String {
    format!("session_{slot}_{account}")
}

fn parse_semver_v1(value: &str) -> Option<[u32; 3]> {
    let mut parts = value.split('.');
    let parsed = [
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    ];
    parts.next().is_none().then_some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(slot: u8, name: &str, bytes: &[u8]) -> SessionRecordV1 {
        SessionRecordV1 {
            slot,
            name: name.to_owned(),
            account: "alice".to_owned(),
            bytes: bytes.to_vec(),
            participants: None,
        }
    }

    #[test]
    fn session_persistence_is_bounded_leased_and_exact_delete_safe() {
        let mut runtime =
            SessionPersistenceRuntimeV1::new("alice".to_owned(), 4096).expect("runtime");
        let system_effects = runtime
            .save_system(b"{\"profile\":1}".to_vec(), false)
            .expect("system");
        assert_eq!(system_effects.len(), 2);
        runtime
            .with_session_persistence_lease(|runtime| {
                runtime.update_session_bounded(session(0, "run", b"{\"wave\":1}"))?;
                Ok(())
            })
            .expect("leased update");
        assert!(
            runtime
                .classify_session_json_for_exact_delete(0, b"{\"wave\":1}")
                .expect("classify")
        );
        assert!(
            !runtime
                .classify_session_json_for_exact_delete(0, b"{\"wave\":2}")
                .expect("classify")
        );
        runtime
            .rename_session(0, "renamed".to_owned())
            .expect("rename");
        assert_eq!(
            runtime.get_session(0).expect("slot").expect("session").name,
            "renamed"
        );
        assert!(runtime.delete_session_bounded(0).expect("delete").is_some());
        assert!(runtime.get_session(0).expect("slot").is_none());
    }

    #[test]
    fn imports_and_coop_participants_fail_closed() {
        let mut runtime =
            SessionPersistenceRuntimeV1::new("alice".to_owned(), 4096).expect("runtime");
        let participants = CoopParticipantsV1 {
            players: ["alice".to_owned(), "bob".to_owned()],
        };
        let record = runtime
            .parse_session_data(
                1,
                "duo".to_owned(),
                b"{\"wave\":2}".to_vec(),
                Some(participants.clone()),
            )
            .expect("parse");
        runtime.init_session_from_data(record).expect("init");
        assert!(
            runtime
                .load_session(1, Some(&participants))
                .expect("load")
                .is_some()
        );
        let wrong = CoopParticipantsV1 {
            players: ["alice".to_owned(), "carol".to_owned()],
        };
        assert_eq!(
            runtime.load_session(1, Some(&wrong)),
            Err(SessionPersistenceErrorV1::ParticipantMismatch)
        );
        let candidates = BTreeMap::from([
            ("data_alice".to_owned(), b"{\"profile\":1}".to_vec()),
            ("session_0_alice".to_owned(), b"{\"wave\":3}".to_vec()),
        ]);
        let bundle = runtime
            .find_importable_local_save_bundle(&candidates)
            .expect("bundle");
        assert_eq!(bundle.sessions.len(), 1);
    }

    #[test]
    fn session_version_migration_orders_pinned_migrators_and_floors_money() {
        let runtime = SessionPersistenceRuntimeV1::new("alice".to_owned(), 4096).expect("runtime");
        let migrated = runtime
            .apply_session_version_migration("1.6.0", "1.11.19", 42.9)
            .expect("migration");
        assert_eq!(migrated.money, 42);
        assert_eq!(
            migrated.applied_migrator_versions,
            vec!["1.7.0", "1.9.0", "1.10.0"]
        );
        let current = runtime
            .apply_session_version_migration("1.11.19", "1.11.19", 7.0)
            .expect("current");
        assert!(current.applied_migrator_versions.is_empty());
    }
}
