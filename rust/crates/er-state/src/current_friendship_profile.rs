//! Canonical current friendship accounts. Absence means unknown historical data.
use er_types::{GameContentIdentityV2, SafeU53, battle_ids::SpeciesId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const MAX_CURRENT_FRIENDSHIP_ACCOUNTS_V1: usize = 4_096;
pub const CURRENT_FRIENDSHIP_ORACLE_V1: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentFriendshipAccountV1 {
    pub species: SpeciesId,
    pub friendship_progress: SafeU53,
    pub candy_count: SafeU53,
    pub passive_attr: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentFriendshipProfileOriginV1 {
    Fresh,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentFriendshipProfileV1 {
    pub schema_version: u32,
    pub content_identity: GameContentIdentityV2,
    pub origin: CurrentFriendshipProfileOriginV1,
    pub owner_seat: er_types::SeatId,
    pub accounts: Vec<CurrentFriendshipAccountV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
#[error("current friendship profile or complete source account catalog is invalid")]
pub struct CurrentFriendshipProfileError;

impl CurrentFriendshipProfileV1 {
    /// The caller must supply the complete source seed catalog, not selected starters.
    pub fn fresh(
        content_identity: GameContentIdentityV2,
        species: Vec<SpeciesId>,
        owner_seat: er_types::SeatId,
    ) -> Result<Self, CurrentFriendshipProfileError> {
        let value = Self {
            schema_version: 1,
            content_identity,
            origin: CurrentFriendshipProfileOriginV1::Fresh,
            owner_seat,
            accounts: species
                .into_iter()
                .map(|species| CurrentFriendshipAccountV1 {
                    species,
                    friendship_progress: SafeU53::ZERO,
                    candy_count: SafeU53::ZERO,
                    passive_attr: 0,
                })
                .collect(),
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), CurrentFriendshipProfileError> {
        if self.schema_version != 1
            || self.content_identity.oracle_sha.as_str() != CURRENT_FRIENDSHIP_ORACLE_V1
            || self.owner_seat.get() == SafeU53::ZERO
            || self.accounts.is_empty()
            || self.accounts.len() > MAX_CURRENT_FRIENDSHIP_ACCOUNTS_V1
            || self
                .accounts
                .iter()
                .any(|entry| entry.species.get() == SafeU53::ZERO || entry.passive_attr > 63)
            || self
                .accounts
                .windows(2)
                .any(|pair| pair[0].species >= pair[1].species)
        {
            return Err(CurrentFriendshipProfileError);
        }
        Ok(())
    }

    pub fn validate_catalog(
        &self,
        identity: &GameContentIdentityV2,
        expected: &[SpeciesId],
    ) -> Result<(), CurrentFriendshipProfileError> {
        self.validate()?;
        if &self.content_identity != identity
            || !self
                .accounts
                .iter()
                .map(|entry| entry.species)
                .eq(expected.iter().copied())
        {
            return Err(CurrentFriendshipProfileError);
        }
        Ok(())
    }
}
