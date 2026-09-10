//! Current daily selection ownership. Historical bootstrap absence stays unknown.
use super::*;
use er_rng::phaser::PhaserRdg;
use er_types::PlatformRequestId;

#[path = "current_starter_pokerus_pool.rs"]
mod pool;

pub const DATE_TIME_CLIP_MILLISECONDS: i64 = 8_640_000_000_000_000;
const DAY_MILLISECONDS: i64 = 86_400_000;
const MAXIMUM_DAILY_DRAWS: usize = 4096;

fn supported_profile(
    profile: Option<&er_state::current_friendship_profile::CurrentFriendshipProfileV1>,
    owner: SeatId,
) -> bool {
    profile.is_some_and(|profile| {
        profile.owner_seat == owner
            && profile.content_identity.oracle_sha.as_str()
                == er_state::current_friendship_profile::CURRENT_FRIENDSHIP_ORACLE_V1
            && profile.content_identity.progression_hash.as_str()
                == crate::current_friendship_profile::QUALIFIED_COMPLETE_PROGRESSION_HASH
    })
}

/// Actual source uses a temporary daily-seeded Phaser stream and restores the
/// scene stream. This isolated generator never borrows or advances battle RNG.
pub fn daily_starter_species(utc_milliseconds: i64) -> Result<Vec<u32>, RunBootstrapErrorV1> {
    let midnight = midnight(utc_milliseconds)?;
    let mut rng = PhaserRdg::from_seed(&midnight.to_string());
    let mut selected = Vec::with_capacity(pool::EFFECTIVE_COUNT);
    for _ in 0..MAXIMUM_DAILY_DRAWS {
        let index = rng
            .pick_index(pool::STARTERS.len())
            .map_err(|_| RunBootstrapErrorV1::Invalid)?;
        let species = pool::STARTERS[index];
        if !selected.contains(&species) {
            selected.push(species);
            if selected.len() == pool::EFFECTIVE_COUNT {
                return Ok(selected);
            }
        }
    }
    // Source's loop is unbounded. Exhaustion is explicitly unsupported, never
    // a fabricated shorter daily list or a partially committed clock callback.
    Err(RunBootstrapErrorV1::Overflow)
}

fn midnight(value: i64) -> Result<i64, RunBootstrapErrorV1> {
    if !(-DATE_TIME_CLIP_MILLISECONDS..=DATE_TIME_CLIP_MILLISECONDS).contains(&value) {
        return Err(RunBootstrapErrorV1::Invalid);
    }
    Ok(value.div_euclid(DAY_MILLISECONDS) * DAY_MILLISECONDS)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StarterPokerusClockV1 {
    pub menu_instance: MenuInstanceId,
    pub menu_revision: SafeU53,
    pub local_seat: SeatId,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingStarterPokerusClockV1 {
    pub request_id: PlatformRequestId,
    pub context: StarterPokerusClockV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct DailyReceipt {
    request: PendingStarterPokerusClockV1,
    utc_milliseconds: i64,
    midnight_milliseconds: i64,
    species: Vec<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(
    rename_all = "SCREAMING_SNAKE_CASE",
    tag = "kind",
    content = "value",
    deny_unknown_fields
)]
enum Display {
    Dormant,
    AwaitingClock,
    Pending(PendingStarterPokerusClockV1),
    Ready(DailyReceipt),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SelectedStarter {
    selection: StarterSelectionV1,
    receipt: DailyReceipt,
}

/// The single supported policy is the actual initialized pinned399d source.
/// Restore validates structural consistency and deterministic recomputation;
/// only the owning kernel callback transaction establishes wall-clock causality.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentStarterPokerusOwnerV1 {
    schema_version: u32,
    owner_seat: SeatId,
    pub next_platform_request_id: SafeU53,
    display: Display,
    selected: Vec<SelectedStarter>,
}

pub(super) fn control_entries(
    stage: RunBootstrapStageV1,
    owner: Option<&CurrentStarterPokerusOwnerV1>,
) -> Option<BootstrapControlEntries> {
    let owner = owner?;
    if stage != RunBootstrapStageV1::StarterSelect
        || !matches!(owner.display, Display::AwaitingClock | Display::Pending(_))
    {
        return None;
    }
    Some((
        GameControlKindV2::StarterSelect,
        vec![(
            "bootstrap/starter-clock/cancel".to_owned(),
            true,
            BootstrapActionV1::Cancel,
        )],
        Some(BootstrapActionV1::Cancel),
    ))
}

impl RunBootstrapMachineV1 {
    pub fn enable_current_starter_pokerus(&mut self) -> Result<(), RunBootstrapErrorV1> {
        self.validate()?;
        let owner = self
            .control
            .owner_seat
            .ok_or(RunBootstrapErrorV1::Invalid)?;
        if self.stage != RunBootstrapStageV1::Title
            || self.current_starter_pokerus.is_some()
            || !self.pressed_keys.is_empty()
            || !self.catalog.local_is_host
            || self.catalog.maximum_starters > 6
            || self.selections != RunBootstrapSelectionsV1::default()
            || !supported_profile(self.current_friendship_profile.as_ref(), owner)
        {
            return Err(RunBootstrapErrorV1::IllegalAction);
        }
        let mut candidate = self.clone();
        candidate.current_starter_pokerus = Some(CurrentStarterPokerusOwnerV1 {
            schema_version: 1,
            owner_seat: owner,
            next_platform_request_id: next_safe(SafeU53::ZERO)?,
            display: Display::Dormant,
            selected: Vec::new(),
        });
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    pub fn needs_starter_pokerus_clock(&self) -> bool {
        self.current_starter_pokerus
            .as_ref()
            .is_some_and(|owner| matches!(owner.display, Display::AwaitingClock))
    }

    pub fn current_starter_pokerus_pending(&self) -> Option<PendingStarterPokerusClockV1> {
        match &self.current_starter_pokerus.as_ref()?.display {
            Display::Pending(request) => Some(*request),
            _ => None,
        }
    }

    pub fn begin_starter_pokerus_clock(
        &mut self,
        request_id: PlatformRequestId,
        local_seat: SeatId,
    ) -> Result<StarterPokerusClockV1, RunBootstrapErrorV1> {
        self.validate()?;
        let context = self.starter_clock_context(local_seat)?;
        let mut candidate = self.clone();
        let owner = candidate
            .current_starter_pokerus
            .as_mut()
            .ok_or(RunBootstrapErrorV1::IllegalAction)?;
        if !matches!(owner.display, Display::AwaitingClock)
            || owner.owner_seat != local_seat
            || request_id.get() < owner.next_platform_request_id
        {
            return Err(RunBootstrapErrorV1::IllegalAction);
        }
        owner.next_platform_request_id = next_safe(request_id.get())?;
        owner.display = Display::Pending(PendingStarterPokerusClockV1 {
            request_id,
            context,
        });
        candidate.validate()?;
        *self = candidate;
        Ok(context)
    }

    pub fn accept_starter_pokerus_clock(
        &mut self,
        request_id: PlatformRequestId,
        utc_milliseconds: i64,
        local_seat: SeatId,
    ) -> Result<(), RunBootstrapErrorV1> {
        self.validate()?;
        let context = self.starter_clock_context(local_seat)?;
        let request = PendingStarterPokerusClockV1 {
            request_id,
            context,
        };
        if self.current_starter_pokerus_pending() != Some(request) {
            return Err(RunBootstrapErrorV1::IllegalAction);
        }
        let receipt = DailyReceipt {
            request,
            utc_milliseconds,
            midnight_milliseconds: midnight(utc_milliseconds)?,
            species: daily_starter_species(utc_milliseconds)?,
        };
        let mut candidate = self.clone();
        candidate
            .current_starter_pokerus
            .as_mut()
            .ok_or(RunBootstrapErrorV1::Invalid)?
            .display = Display::Ready(receipt);
        candidate.replace_control(local_seat)?;
        candidate.validate()?;
        *self = candidate;
        Ok(())
    }

    fn starter_clock_context(
        &self,
        local_seat: SeatId,
    ) -> Result<StarterPokerusClockV1, RunBootstrapErrorV1> {
        let menu = self
            .control
            .menu
            .as_ref()
            .ok_or(RunBootstrapErrorV1::Invalid)?;
        if self.stage != RunBootstrapStageV1::StarterSelect
            || self.control.owner_seat != Some(local_seat)
            || menu.owner_seat != local_seat
        {
            return Err(RunBootstrapErrorV1::IllegalAction);
        }
        Ok(StarterPokerusClockV1 {
            menu_instance: menu.instance_id,
            menu_revision: self.control.revision,
            local_seat,
        })
    }

    pub fn current_starter_pokerus_selections(
        &self,
    ) -> Result<Option<Vec<crate::m9e_new_run_v6::CurrentStarterPokerusV1>>, RunBootstrapErrorV1>
    {
        self.validate()?;
        let Some(owner) = &self.current_starter_pokerus else {
            return Ok(None);
        };
        if self.stage != RunBootstrapStageV1::Complete
            || !matches!(owner.display, Display::Ready(_))
        {
            return Err(RunBootstrapErrorV1::IllegalAction);
        }
        Ok(Some(
            owner
                .selected
                .iter()
                .map(|selected| crate::m9e_new_run_v6::CurrentStarterPokerusV1 {
                    selection: selected.selection.clone(),
                    pokerus: selected
                        .receipt
                        .species
                        .iter()
                        .any(|species| u64::from(*species) == selected.selection.species_id.get()),
                })
                .collect(),
        ))
    }

    pub(super) fn validate_starter_pokerus(&self) -> Result<(), RunBootstrapErrorV1> {
        let Some(owner) = &self.current_starter_pokerus else {
            return Ok(());
        };
        if owner.schema_version != 1
            || owner.next_platform_request_id == SafeU53::ZERO
            || !self.catalog.local_is_host
            || self.catalog.maximum_starters > 6
            || self
                .control
                .owner_seat
                .is_some_and(|seat| seat != owner.owner_seat)
            || !supported_profile(self.current_friendship_profile.as_ref(), owner.owner_seat)
            || self.selections.mode.is_some_and(|mode| {
                self.catalog
                    .modes
                    .iter()
                    .find(|entry| entry.mode == mode)
                    .is_none_or(|entry| !entry.supported || entry.cooperative)
            })
            || owner.selected.len() != self.selections.starters.len()
            || owner.selected.len() > 6
            || owner.selected.len() > self.catalog.maximum_starters
        {
            return Err(RunBootstrapErrorV1::Invalid);
        }
        for (selected, actual) in owner.selected.iter().zip(&self.selections.starters) {
            if &selected.selection != actual || actual.owner_seat != owner.owner_seat {
                return Err(RunBootstrapErrorV1::Invalid);
            }
            self.validate_daily_receipt(owner, &selected.receipt)?;
        }
        match &owner.display {
            Display::Dormant => {
                if !owner.selected.is_empty()
                    || matches!(
                        self.stage,
                        RunBootstrapStageV1::StarterSelect
                            | RunBootstrapStageV1::Confirmation
                            | RunBootstrapStageV1::DifficultySelect
                            | RunBootstrapStageV1::SaveSelect
                            | RunBootstrapStageV1::Complete
                    )
                {
                    return Err(RunBootstrapErrorV1::Invalid);
                }
            }
            Display::AwaitingClock | Display::Pending(_) => {
                if self.stage != RunBootstrapStageV1::StarterSelect {
                    return Err(RunBootstrapErrorV1::Invalid);
                }
                if let Display::Pending(request) = &owner.display
                    && (request.context != self.starter_clock_context(owner.owner_seat)?
                        || next_safe(request.request_id.get())? != owner.next_platform_request_id
                        || owner.selected.iter().any(|selected| {
                            selected.receipt.request.request_id >= request.request_id
                        }))
                {
                    return Err(RunBootstrapErrorV1::Invalid);
                }
            }
            Display::Ready(receipt) => {
                self.validate_daily_receipt(owner, receipt)?;
                if !matches!(
                    self.stage,
                    RunBootstrapStageV1::StarterSelect
                        | RunBootstrapStageV1::Confirmation
                        | RunBootstrapStageV1::DifficultySelect
                        | RunBootstrapStageV1::SaveSelect
                        | RunBootstrapStageV1::Complete
                ) || next_safe(receipt.request.request_id.get())?
                    != owner.next_platform_request_id
                    || owner.selected.iter().any(|selected| {
                        selected.receipt.request.request_id > receipt.request.request_id
                    })
                {
                    return Err(RunBootstrapErrorV1::Invalid);
                }
            }
        }
        let mut receipts = owner
            .selected
            .iter()
            .map(|selected| &selected.receipt)
            .collect::<Vec<_>>();
        if let Display::Ready(receipt) = &owner.display {
            receipts.push(receipt);
        }
        receipts.sort_by_key(|receipt| receipt.request.request_id);
        for pair in receipts.windows(2) {
            if pair[0].request.request_id == pair[1].request.request_id {
                if pair[0] != pair[1] {
                    return Err(RunBootstrapErrorV1::Invalid);
                }
            } else if pair[0].request.context.menu_instance >= pair[1].request.context.menu_instance
                || pair[0].request.context.menu_revision >= pair[1].request.context.menu_revision
            {
                return Err(RunBootstrapErrorV1::Invalid);
            }
        }
        let mut expected = build_control(
            self.stage,
            &self.selections,
            &self.catalog,
            owner.owner_seat,
            self.control.revision,
            self.menu_instance_high_water,
            (self.current_storage.as_ref(), Some(owner)),
        )?;
        if let (Some(expected_menu), Some(actual_menu)) = (&mut expected.menu, &self.control.menu) {
            expected_menu.selected_option_id = actual_menu.selected_option_id.clone();
        }
        if expected != self.control {
            return Err(RunBootstrapErrorV1::Invalid);
        }
        Ok(())
    }

    fn validate_daily_receipt(
        &self,
        owner: &CurrentStarterPokerusOwnerV1,
        receipt: &DailyReceipt,
    ) -> Result<(), RunBootstrapErrorV1> {
        let context = receipt.request.context;
        if context.local_seat != owner.owner_seat
            || context.menu_revision == SafeU53::ZERO
            || context.menu_revision > self.control.revision
            || context.menu_instance.get() == SafeU53::ZERO
            || context.menu_instance > self.menu_instance_high_water
            || receipt.request.request_id.get() == SafeU53::ZERO
            || receipt.request.request_id.get() >= owner.next_platform_request_id
            || receipt.midnight_milliseconds != midnight(receipt.utc_milliseconds)?
            || receipt.species != daily_starter_species(receipt.utc_milliseconds)?
        {
            return Err(RunBootstrapErrorV1::Invalid);
        }
        Ok(())
    }

    pub(super) fn check_starter_pokerus_action(
        &self,
        action: &BootstrapActionV1,
    ) -> Result<(), RunBootstrapErrorV1> {
        let Some(owner) = &self.current_starter_pokerus else {
            return Ok(());
        };
        if matches!(owner.display, Display::AwaitingClock | Display::Pending(_))
            && !matches!(action, BootstrapActionV1::Cancel)
        {
            return Err(RunBootstrapErrorV1::IllegalAction);
        }
        Ok(())
    }

    pub(super) fn synchronize_starter_pokerus(
        &mut self,
        before: RunBootstrapStageV1,
    ) -> Result<(), RunBootstrapErrorV1> {
        let Some(owner) = self.current_starter_pokerus.as_mut() else {
            return Ok(());
        };
        if self.stage == RunBootstrapStageV1::Title {
            owner.display = Display::Dormant;
            owner.selected.clear();
            return Ok(());
        }
        owner
            .selected
            .retain(|selected| self.selections.starters.contains(&selected.selection));
        for selection in &self.selections.starters {
            if !owner
                .selected
                .iter()
                .any(|selected| &selected.selection == selection)
            {
                let Display::Ready(receipt) = &owner.display else {
                    return Err(RunBootstrapErrorV1::IllegalAction);
                };
                owner.selected.push(SelectedStarter {
                    selection: selection.clone(),
                    receipt: receipt.clone(),
                });
            }
        }
        owner
            .selected
            .sort_by_key(|selected| selected.selection.pokemon_id);
        if self.stage == RunBootstrapStageV1::StarterSelect
            && (before != RunBootstrapStageV1::StarterSelect
                || matches!(owner.display, Display::Pending(_)))
        {
            owner.display = Display::AwaitingClock;
        }
        Ok(())
    }
}
