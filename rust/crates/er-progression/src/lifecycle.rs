//! Atomic capture, party, storage, release, and held-item ownership transitions.

use er_state::m7_state::{CaptureMetadataV1, GameStateV5, PokemonStateV5, StoredPokemonV1};
use er_types::battle_ids::{BattleSide, FieldSlot, PokemonId};
use er_types::{InventoryItemId, SafeU53, SeatId, StorageSlotId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::PreparedProgressionContentV1;

pub const PARTY_CAPACITY: usize = 6;

pub trait AuditedCaptureRng {
    fn draw_capture(&mut self, upper_exclusive: u32) -> Result<u32, LifecycleError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CaptureDestinationV1 {
    Party,
    Storage,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CaptureOutcomeV1 {
    Failed,
    Captured { destination: CaptureDestinationV1 },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureTransitionV1 {
    pub after_state: GameStateV5,
    pub target: PokemonId,
    pub ball: InventoryItemId,
    pub threshold: u32,
    pub draw: u32,
    pub outcome: CaptureOutcomeV1,
    pub mutations: Vec<LifecycleMutationV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum LifecycleMutationV1 {
    InventoryChanged {
        item: InventoryItemId,
        before: u32,
        after: u32,
    },
    FieldChanged {
        slot: FieldSlot,
        before: Option<PokemonId>,
        after: Option<PokemonId>,
    },
    PokemonCaptured {
        pokemon: PokemonId,
        destination: CaptureDestinationV1,
    },
    PartyReordered {
        pokemon: PokemonId,
        before: usize,
        after: usize,
    },
    PokemonReleased {
        pokemon: PokemonId,
    },
    HeldItemsTransferred {
        source: PokemonId,
        target: PokemonId,
        count: usize,
    },
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum LifecycleError {
    #[error("game state is invalid: {0}")]
    State(String),
    #[error("no active battle exists")]
    NoBattle,
    #[error("capture target is absent, fainted, player-owned, or not active")]
    CaptureTarget,
    #[error("capture ball is absent or not classified as a ball")]
    CaptureBall,
    #[error("capture content is absent for the target species/form")]
    CaptureContent,
    #[error("capture RNG returned {draw} outside 0..{upper}")]
    CaptureDraw { draw: u32, upper: u32 },
    #[error("capture calculation overflowed")]
    Overflow,
    #[error("party/storage operation is invalid")]
    Party,
}

pub fn attempt_capture<R: AuditedCaptureRng>(
    before: &GameStateV5,
    content: &PreparedProgressionContentV1,
    target_id: PokemonId,
    ball_id: InventoryItemId,
    owner_seat: SeatId,
    rng: &mut R,
) -> Result<CaptureTransitionV1, LifecycleError> {
    before
        .validate()
        .map_err(|error| LifecycleError::State(error.to_string()))?;
    let mut after = before.clone();
    let run = after.active_run.as_mut().ok_or(LifecycleError::NoBattle)?;
    let battle = run.battle.as_mut().ok_or(LifecycleError::NoBattle)?;
    let target_index = battle
        .enemy_party
        .iter()
        .position(|pokemon| pokemon.id == target_id && !pokemon.fainted)
        .ok_or(LifecycleError::CaptureTarget)?;
    let active_slot = battle
        .field
        .slots
        .iter()
        .position(|entry| entry.slot.side == BattleSide::Enemy && entry.occupant == Some(target_id))
        .ok_or(LifecycleError::CaptureTarget)?;
    let target = battle.enemy_party[target_index].clone();
    let ball = content
        .capture_ball(ball_id)
        .ok_or(LifecycleError::CaptureBall)?;
    let species = content
        .species(target.species_id, target.form_index)
        .ok_or(LifecycleError::CaptureContent)?;
    let inventory_index = run
        .inventory
        .entries
        .iter()
        .position(|entry| entry.item == ball_id && entry.count > 0)
        .ok_or(LifecycleError::CaptureBall)?;
    let before_count = run.inventory.entries[inventory_index].count;
    let after_count = before_count - 1;
    if after_count == 0 {
        run.inventory.entries.remove(inventory_index);
    } else {
        run.inventory.entries[inventory_index].count = after_count;
    }
    let threshold = capture_threshold(&target, species.catch_rate, ball)?;
    let draw = rng.draw_capture(256)?;
    if draw >= 256 {
        return Err(LifecycleError::CaptureDraw { draw, upper: 256 });
    }
    let mut mutations = vec![LifecycleMutationV1::InventoryChanged {
        item: ball_id,
        before: before_count,
        after: after_count,
    }];
    let outcome = if draw >= threshold {
        CaptureOutcomeV1::Failed
    } else {
        let mut captured = battle.enemy_party.remove(target_index);
        captured.owner_seat = Some(owner_seat);
        captured.capture = Some(CaptureMetadataV1 {
            ball: ball_id,
            wave: run.wave,
            original_owner_seat: target.owner_seat,
            original_trainer_id: None,
        });
        battle.field.slots[active_slot].occupant = None;
        mutations.push(LifecycleMutationV1::FieldChanged {
            slot: battle.field.slots[active_slot].slot,
            before: Some(target_id),
            after: None,
        });
        let destination = if run.party.len() < PARTY_CAPACITY {
            run.party.push(captured);
            CaptureDestinationV1::Party
        } else {
            let slot_number = u64::try_from(run.storage.len())
                .ok()
                .and_then(|value| value.checked_add(1))
                .and_then(|value| SafeU53::new(value).ok())
                .ok_or(LifecycleError::Overflow)?;
            run.storage.push(StoredPokemonV1 {
                slot: StorageSlotId::new(slot_number),
                pokemon: captured,
            });
            CaptureDestinationV1::Storage
        };
        mutations.push(LifecycleMutationV1::PokemonCaptured {
            pokemon: target_id,
            destination,
        });
        CaptureOutcomeV1::Captured { destination }
    };
    after
        .validate()
        .map_err(|error| LifecycleError::State(error.to_string()))?;
    Ok(CaptureTransitionV1 {
        after_state: after,
        target: target_id,
        ball: ball_id,
        threshold,
        draw,
        outcome,
        mutations,
    })
}

pub fn reorder_party(
    before: &GameStateV5,
    from: usize,
    to: usize,
) -> Result<(GameStateV5, LifecycleMutationV1), LifecycleError> {
    let mut after = before.clone();
    let run = after.active_run.as_mut().ok_or(LifecycleError::Party)?;
    if from >= run.party.len() || to >= run.party.len() {
        return Err(LifecycleError::Party);
    }
    let pokemon = run.party[from].id;
    let entry = run.party.remove(from);
    run.party.insert(to, entry);
    after
        .validate()
        .map_err(|error| LifecycleError::State(error.to_string()))?;
    Ok((
        after,
        LifecycleMutationV1::PartyReordered {
            pokemon,
            before: from,
            after: to,
        },
    ))
}

pub fn release_stored_pokemon(
    before: &GameStateV5,
    slot: StorageSlotId,
) -> Result<(GameStateV5, LifecycleMutationV1), LifecycleError> {
    let mut after = before.clone();
    let run = after.active_run.as_mut().ok_or(LifecycleError::Party)?;
    let index = run
        .storage
        .iter()
        .position(|stored| stored.slot == slot)
        .ok_or(LifecycleError::Party)?;
    let pokemon = run.storage.remove(index).pokemon.id;
    after
        .validate()
        .map_err(|error| LifecycleError::State(error.to_string()))?;
    Ok((after, LifecycleMutationV1::PokemonReleased { pokemon }))
}

pub fn transfer_all_held_items(
    before: &GameStateV5,
    source: PokemonId,
    target: PokemonId,
) -> Result<(GameStateV5, LifecycleMutationV1), LifecycleError> {
    if source == target {
        return Err(LifecycleError::Party);
    }
    let mut after = before.clone();
    let run = after.active_run.as_mut().ok_or(LifecycleError::Party)?;
    let source_index = run
        .party
        .iter()
        .position(|pokemon| pokemon.id == source)
        .ok_or(LifecycleError::Party)?;
    let target_index = run
        .party
        .iter()
        .position(|pokemon| pokemon.id == target)
        .ok_or(LifecycleError::Party)?;
    let transferred = std::mem::take(&mut run.party[source_index].held_items);
    let count = transferred.len();
    run.party[target_index].held_items.extend(transferred);
    run.party[target_index]
        .held_items
        .sort_by_key(|item| item.instance_id);
    if run.party[target_index]
        .held_items
        .windows(2)
        .any(|pair| pair[0].instance_id >= pair[1].instance_id)
    {
        return Err(LifecycleError::Party);
    }
    after
        .validate()
        .map_err(|error| LifecycleError::State(error.to_string()))?;
    Ok((
        after,
        LifecycleMutationV1::HeldItemsTransferred {
            source,
            target,
            count,
        },
    ))
}

fn capture_threshold(
    target: &PokemonStateV5,
    catch_rate: u16,
    ball: &crate::CaptureBallDefinitionV1,
) -> Result<u32, LifecycleError> {
    let max_hp = u64::from(target.max_hp);
    if max_hp == 0 || ball.catch_multiplier_denominator == 0 {
        return Err(LifecycleError::Overflow);
    }
    let doubled_hp = u64::from(target.hp)
        .checked_mul(2)
        .ok_or(LifecycleError::Overflow)?;
    let hp_factor = max_hp
        .checked_mul(3)
        .and_then(|value| value.checked_sub(doubled_hp))
        .ok_or(LifecycleError::Overflow)?;
    let numerator = u64::from(catch_rate)
        .checked_mul(u64::from(ball.catch_multiplier_numerator))
        .and_then(|value| value.checked_mul(hp_factor))
        .ok_or(LifecycleError::Overflow)?;
    let denominator = u64::from(ball.catch_multiplier_denominator)
        .checked_mul(max_hp)
        .and_then(|value| value.checked_mul(3))
        .ok_or(LifecycleError::Overflow)?;
    let threshold = numerator
        .checked_div(denominator)
        .ok_or(LifecycleError::Overflow)?
        .min(255);
    u32::try_from(threshold).map_err(|_| LifecycleError::Overflow)
}
