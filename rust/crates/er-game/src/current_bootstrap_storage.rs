//! Opt-in current Title storage ownership; navigation stays in the shared bootstrap.
use super::*;
use crate::m9e_material_v6::GamePlatformEffectV2;
use er_types::PlatformRequestId;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value", deny_unknown_fields)]
pub enum BootstrapStorageKindV1 { List, Read { slot: String } }

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingBootstrapStorageV1 {
    pub request_id: PlatformRequestId,
    pub kind: BootstrapStorageKindV1,
    pub source_menu: MenuInstanceId,
    pub source_revision: SafeU53,
    pub waiting_menu: MenuInstanceId,
    pub waiting_revision: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentBootstrapStorageV1 {
    pub owner_seat: SeatId,
    pub next_platform_request_id: SafeU53,
    pub slots: Vec<String>,
    pub missing_slot: Option<String>,
    pub pending: Option<PendingBootstrapStorageV1>,
}

fn slot_valid(slot: &str) -> bool { !slot.is_empty() && slot.len() <= 256 }
fn slots_valid(slots: &[String]) -> bool {
    slots.len() <= 64 && slots.iter().all(|slot| slot_valid(slot))
        && slots.windows(2).all(|pair| pair[0] < pair[1])
}
fn storage_stage(stage: RunBootstrapStageV1) -> bool {
    matches!(stage, RunBootstrapStageV1::ExistingSaveListing | RunBootstrapStageV1::ExistingSaveSelect
        | RunBootstrapStageV1::ExistingSaveLoading)
}

pub(super) fn control_entries(stage: RunBootstrapStageV1, storage: Option<&CurrentBootstrapStorageV1>)
    -> Result<Option<BootstrapControlEntries>, RunBootstrapErrorV1> {
    let Some(storage) = storage else {
        return if storage_stage(stage) { Err(RunBootstrapErrorV1::Invalid) } else { Ok(None) };
    };
    if stage == RunBootstrapStageV1::Title {
        return Ok(Some((GameControlKindV2::Title, vec![
            ("bootstrap/title/new-game".to_owned(), true, BootstrapActionV1::OpenNewGame),
            ("bootstrap/title/existing-saves".to_owned(), true, BootstrapActionV1::OpenExistingSaves),
        ], None)));
    }
    if !storage_stage(stage) { return Ok(None); }
    let mut rows = Vec::new();
    if stage == RunBootstrapStageV1::ExistingSaveSelect {
        rows.extend(storage.slots.iter().enumerate().map(|(index, slot)|
            (format!("bootstrap/existing/{index:04}"), true, BootstrapActionV1::SelectExistingSave(slot.clone()))));
    }
    rows.push(("bootstrap/existing/cancel".to_owned(), true, BootstrapActionV1::Cancel));
    Ok(Some((GameControlKindV2::Save, rows, Some(BootstrapActionV1::Cancel))))
}

impl RunBootstrapMachineV1 {
    pub fn enable_current_storage(&mut self) -> Result<(), RunBootstrapErrorV1> {
        if self.stage != RunBootstrapStageV1::Title || self.current_storage.is_some()
            || !self.pressed_keys.is_empty() || !self.catalog.local_is_host
            || self.control.revision != next_safe(SafeU53::ZERO)?
            || self.selections != RunBootstrapSelectionsV1::default() {
            return Err(RunBootstrapErrorV1::IllegalAction);
        }
        let mut candidate = self.clone();
        let owner = candidate.control.owner_seat.ok_or(RunBootstrapErrorV1::Invalid)?;
        candidate.current_storage = Some(CurrentBootstrapStorageV1 { owner_seat: owner,
            next_platform_request_id: next_safe(SafeU53::ZERO)?, slots: Vec::new(), missing_slot: None, pending: None });
        candidate.control = build_control(candidate.stage, &candidate.selections, &candidate.catalog, owner,
            candidate.control.revision, candidate.menu_instance_high_water, candidate.current_storage.as_ref())?;
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    pub fn current_storage_effect(&self) -> Option<GamePlatformEffectV2> {
        let pending = self.current_storage.as_ref()?.pending.as_ref()?;
        Some(match &pending.kind {
            BootstrapStorageKindV1::List => GamePlatformEffectV2::StorageList { request: pending.request_id },
            BootstrapStorageKindV1::Read { slot } => GamePlatformEffectV2::StorageRead { request: pending.request_id, slot: slot.clone() },
        })
    }

    pub(super) fn apply_current_storage_action(&mut self, action: &BootstrapActionV1) -> Result<bool, RunBootstrapErrorV1> {
        let kind = match (self.stage, action) {
            (RunBootstrapStageV1::Title, BootstrapActionV1::OpenExistingSaves) => BootstrapStorageKindV1::List,
            (RunBootstrapStageV1::ExistingSaveSelect, BootstrapActionV1::SelectExistingSave(slot)) => {
                if !self.current_storage.as_ref().is_some_and(|storage| storage.slots.contains(slot)) {
                    return Err(RunBootstrapErrorV1::IllegalAction);
                }
                BootstrapStorageKindV1::Read { slot: slot.clone() }
            }
            (stage, BootstrapActionV1::Cancel) if storage_stage(stage) => {
                let storage = self.current_storage.as_mut().ok_or(RunBootstrapErrorV1::IllegalAction)?;
                storage.pending = None;
                storage.slots.clear();
                storage.missing_slot = None;
                self.stage = RunBootstrapStageV1::Title;
                self.selections = RunBootstrapSelectionsV1::default();
                return Ok(true);
            }
            _ => return Ok(false),
        };
        let storage = self.current_storage.as_mut().ok_or(RunBootstrapErrorV1::IllegalAction)?;
        if storage.pending.is_some() { return Err(RunBootstrapErrorV1::IllegalAction); }
        let request_id = PlatformRequestId::new(storage.next_platform_request_id);
        storage.next_platform_request_id = next_safe(storage.next_platform_request_id)?;
        storage.missing_slot = None;
        self.stage = match kind { BootstrapStorageKindV1::List => RunBootstrapStageV1::ExistingSaveListing,
            BootstrapStorageKindV1::Read { .. } => RunBootstrapStageV1::ExistingSaveLoading };
        storage.pending = Some(PendingBootstrapStorageV1 { request_id, kind,
            source_menu: self.menu_instance_high_water, source_revision: self.control.revision,
            waiting_menu: next_menu(self.menu_instance_high_water)?, waiting_revision: next_safe(self.control.revision)? });
        Ok(true)
    }

    pub fn accept_current_slots(&mut self, request: PlatformRequestId, slots: Vec<String>) -> Result<(), RunBootstrapErrorV1> {
        self.validate()?;
        if !slots_valid(&slots) || self.current_storage_effect() != Some(GamePlatformEffectV2::StorageList { request }) {
            return Err(RunBootstrapErrorV1::IllegalAction);
        }
        let mut candidate = self.clone();
        let storage = candidate.current_storage.as_mut().ok_or(RunBootstrapErrorV1::Invalid)?;
        storage.pending = None;
        storage.slots = slots;
        storage.missing_slot = None;
        let owner = storage.owner_seat;
        candidate.stage = RunBootstrapStageV1::ExistingSaveSelect;
        candidate.replace_control(owner)?;
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    pub fn accept_current_missing(&mut self, request: PlatformRequestId) -> Result<(), RunBootstrapErrorV1> {
        self.validate()?;
        let Some(GamePlatformEffectV2::StorageRead { request: owned, slot }) = self.current_storage_effect() else {
            return Err(RunBootstrapErrorV1::IllegalAction);
        };
        if owned != request { return Err(RunBootstrapErrorV1::IllegalAction); }
        let mut candidate = self.clone();
        let storage = candidate.current_storage.as_mut().ok_or(RunBootstrapErrorV1::Invalid)?;
        storage.pending = None;
        storage.slots.retain(|item| item != &slot);
        storage.missing_slot = Some(slot);
        let owner = storage.owner_seat;
        candidate.stage = RunBootstrapStageV1::ExistingSaveSelect;
        candidate.replace_control(owner)?;
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    pub(super) fn validate_current_storage(&self) -> Result<(), RunBootstrapErrorV1> {
        let Some(storage) = &self.current_storage else {
            return if storage_stage(self.stage) { Err(RunBootstrapErrorV1::Invalid) } else { Ok(()) };
        };
        if storage.next_platform_request_id == SafeU53::ZERO || self.control.revision == SafeU53::ZERO
            || !self.catalog.local_is_host || !slots_valid(&storage.slots)
            || self.catalog.starters.iter().any(|starter| starter.owner_seat != storage.owner_seat)
            || self.selections.mode.is_some_and(|mode| self.catalog.modes.iter().find(|entry| entry.mode == mode).is_none_or(|entry| !entry.supported || entry.cooperative))
            || storage.missing_slot.as_ref().is_some_and(|slot| !slot_valid(slot) || storage.slots.contains(slot))
            || (storage.missing_slot.is_some() && self.stage != RunBootstrapStageV1::ExistingSaveSelect)
            || (!storage_stage(self.stage) && (!storage.slots.is_empty() || storage.pending.is_some()))
            || (storage_stage(self.stage) && self.selections != RunBootstrapSelectionsV1::default()) {
            return Err(RunBootstrapErrorV1::Invalid);
        }
        match (&storage.pending, self.stage) {
            (Some(pending), stage) => {
                let kind_valid = match (&pending.kind, stage) {
                    (BootstrapStorageKindV1::List, RunBootstrapStageV1::ExistingSaveListing) => storage.slots.is_empty(),
                    (BootstrapStorageKindV1::Read { slot }, RunBootstrapStageV1::ExistingSaveLoading) => storage.slots.contains(slot),
                    _ => false,
                };
                if !kind_valid || pending.request_id.get() == SafeU53::ZERO
                    || pending.source_menu == MenuInstanceId::ZERO || pending.source_revision == SafeU53::ZERO
                    || next_safe(pending.request_id.get())? != storage.next_platform_request_id
                    || next_menu(pending.source_menu)? != pending.waiting_menu
                    || next_safe(pending.source_revision)? != pending.waiting_revision
                    || pending.waiting_menu != self.menu_instance_high_water || pending.waiting_revision != self.control.revision {
                    return Err(RunBootstrapErrorV1::Invalid);
                }
            }
            (None, RunBootstrapStageV1::ExistingSaveListing | RunBootstrapStageV1::ExistingSaveLoading) => return Err(RunBootstrapErrorV1::Invalid),
            _ => {}
        }
        let mut expected = build_control(self.stage, &self.selections, &self.catalog, storage.owner_seat,
            self.control.revision, self.menu_instance_high_water, Some(storage))?;
        if let (Some(expected_menu), Some(actual_menu)) = (&mut expected.menu, &self.control.menu) {
            if !expected_menu.options.iter().any(|option| option.option_id == actual_menu.selected_option_id) {
                return Err(RunBootstrapErrorV1::Invalid);
            }
            expected_menu.selected_option_id = actual_menu.selected_option_id.clone();
        }
        if expected != self.control { return Err(RunBootstrapErrorV1::Invalid); }
        Ok(())
    }
}
