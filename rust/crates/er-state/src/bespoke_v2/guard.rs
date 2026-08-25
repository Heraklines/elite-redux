//! Canonical protect/endure/guard family state.
//!
//! Owns the closed typed state of the frozen M6 bespoke cluster
//! `PROTECT_ENDURE_GUARD` (see
//! `rust/fixtures/m6/bespoke-clusters-v1.json`): self-protection tags from the
//! catalog `ProtectAttr` move family, side-scoped conditional guard arena
//! tags, the ENDURING/ENDURE_TOKEN/STURDY survival flags, and the consecutive-use
//! chain depth that drives the exact success threshold
//! (`randBattleSeedInt(3^timesUsed) === 0` in the oracle).
//!
//! This module is data plus total validation only; battle transitions live in
//! `er-battle::m6::bespoke::guard`. State is closed and serializable: no
//! callbacks, JSON payloads, or untyped identifiers.

use er_types::battle_ids::BattleSide;
use er_types::mechanics::MechanicScope;
use er_types::SafeU53;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Schema version of the guard family's canonical state.
pub const GUARD_FAMILY_STATE_SCHEMA_VERSION: u32 = 1;

/// Frozen ceiling on the consecutive-use chain, shared with
/// `er_state::mechanic_state_v2` (`GUARD_CHAIN_MAX_DEPTH`). The oracle has no
/// explicit cap, but the success range grows as `3^depth`, so depth 6 already
/// bounds the success range at 729 within `u64`.
pub const GUARD_CHAIN_MAX_DEPTH: u8 = 6;

/// Closed self-protection kinds carried by the catalog `ProtectAttr` moves.
///
/// Provenance (`src/data/moves/move.ts`, oracle worktree): every variant maps
/// to one frozen `ProtectAttr` behavior unit in
/// `bespoke-clusters-v1.json` — MIND_READER (move 170), PROTECT (182),
/// DETECT (197), ENDURING/Endure (203), KINGS_SHIELD (588), SPIKY_SHIELD
/// (596), BANEFUL_BUNKER (661), MAX_GUARD (743), OBSTRUCT (792), SILK_TRAP
/// (852), BURNING_BULWARK (908). All of them join the consecutive-use chain;
/// only [`GuardKind::Endure`] sets a survival flag instead of a protection tag.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GuardKind {
    MindReader,
    Protect,
    Detect,
    Endure,
    KingsShield,
    SpikyShield,
    BanefulBunker,
    MaxGuard,
    Obstruct,
    SilkTrap,
    BurningBulwark,
}

impl GuardKind {
    /// Oracle `ProtectedTag::blockStatus`: contact stat-stage protects
    /// (King's Shield, Obstruct, Silk Trap) never block status-category
    /// moves; every other kind blocks damaging and status moves alike.
    pub const fn blocks_status(self) -> bool {
        !matches!(
            self,
            Self::KingsShield | Self::Obstruct | Self::SilkTrap
        )
    }

    /// Endure does not block incoming moves; it arms minimum-HP survival.
    pub const fn is_endure(self) -> bool {
        matches!(self, Self::Endure)
    }
}

/// Closed side-scoped guard kinds from the frozen cluster evidence.
///
/// QUICK_GUARD, WIDE_GUARD, CRAFTY_SHIELD and MAT_BLOCK are conditional
/// protection arena tags evaluated against each incoming move; SAFEGUARD is
/// tracked here for lifecycle/expiry ownership (its status-immunity decision
/// belongs to the suppression family) and exposes no block predicate.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SideGuardKind {
    QuickGuard,
    WideGuard,
    CraftyShield,
    MatBlock,
    Safeguard,
}

impl SideGuardKind {
    /// Oracle `ProtectAttr.getCondition` counts successful QUICK_GUARD and
    /// WIDE_GUARD uses into the consecutive-use chain without consuming the
    /// odds themselves; every other side guard breaks the chain when used.
    pub const fn extends_chain(self) -> bool {
        matches!(self, Self::QuickGuard | Self::WideGuard)
    }
}

/// One active self-protection tag.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActiveSelfGuardEntry {
    pub kind: GuardKind,
    /// Must be a [`MechanicScope::Pokemon`] owner.
    pub owner: MechanicScope,
    pub creation_ordinal: SafeU53,
}

/// One active side-scoped guard tag.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActiveSideGuardEntry {
    pub kind: SideGuardKind,
    /// Must be a [`MechanicScope::Side`] owner.
    pub owner: MechanicScope,
    pub creation_ordinal: SafeU53,
}

/// Canonical state of the protect/endure/guard family.
///
/// All owner vectors are strictly ordered by their natural scope order with
/// unique entries; creation ordinals are unique, increasing, and always below
/// `next_creation_ordinal`. The chain depth survives turn-end expiry and only
/// resets when a non-protect-family move succeeds, a chained activation
/// fails its audited draw, or an explicit reset transition runs.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuardFamilyState {
    pub schema_version: u32,
    /// Consecutive successful protect-family/side-chain-guard uses.
    pub chain_depth: u8,
    /// Active self-protection tags, creation order preserved.
    pub self_guards: Vec<ActiveSelfGuardEntry>,
    /// Active side guards, creation order preserved.
    pub side_guards: Vec<ActiveSideGuardEntry>,
    /// Owners carrying the ENDURING battler tag (Endure move) this turn.
    pub enduring_owners: Vec<MechanicScope>,
    /// Owners carrying the ENDURE_TOKEN battler tag this turn.
    pub endure_token_owners: Vec<MechanicScope>,
    /// Owners carrying the STURDY battler tag this turn (innate Sturdy or
    /// the full-HP endure ability attribute).
    pub sturdy_owners: Vec<MechanicScope>,
    pub next_creation_ordinal: SafeU53,
}

impl Default for GuardFamilyState {
    fn default() -> Self {
        Self {
            schema_version: GUARD_FAMILY_STATE_SCHEMA_VERSION,
            chain_depth: 0,
            self_guards: Vec::new(),
            side_guards: Vec::new(),
            enduring_owners: Vec::new(),
            endure_token_owners: Vec::new(),
            sturdy_owners: Vec::new(),
            next_creation_ordinal: SafeU53::new(1)
                .expect("ordinal 1 fits the safe-integer domain"),
        }
    }
}

/// Total validation failures for [`GuardFamilyState`].
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GuardFamilyStateError {
    #[error("guard family schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("guard chain depth {actual} exceeds the frozen ceiling of {max}")]
    ChainTooDeep { actual: u8, max: u8 },
    #[error("next guard creation ordinal must be positive")]
    ZeroNextCreationOrdinal,
    #[error("active self guard owner must be a Pokemon scope")]
    SelfGuardOwnerNotAPokemon,
    #[error("active side guard owner must be a Side scope")]
    SideGuardOwnerNotASide,
    #[error("guard creation ordinal must stay below the next creation ordinal")]
    CreationOrdinalNotAhead,
    #[error("active guards must stay ordered by creation ordinal")]
    GuardsOutOfOrder,
    #[error("a Pokemon cannot hold two active self guards at once")]
    DuplicateSelfGuardOwner,
    #[error("a side cannot hold the same guard kind twice at once")]
    DuplicateSideGuardKind,
    #[error("endure flag owners must stay ordered and unique")]
    EndureOwnersOutOfOrder,
    #[error("endure token owners must stay ordered and unique")]
    EndureTokenOwnersOutOfOrder,
    #[error("sturdy owners must stay ordered and unique")]
    SturdyOwnersOutOfOrder,
}

impl GuardFamilyState {
    /// Total validation: schema, chain ceiling, active-guard coherence, and
    /// ordinal monotonicity.
    pub fn validate(&self) -> Result<(), GuardFamilyStateError> {
        if self.schema_version != GUARD_FAMILY_STATE_SCHEMA_VERSION {
            return Err(GuardFamilyStateError::SchemaVersion {
                expected: GUARD_FAMILY_STATE_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if self.chain_depth > GUARD_CHAIN_MAX_DEPTH {
            return Err(GuardFamilyStateError::ChainTooDeep {
                actual: self.chain_depth,
                max: GUARD_CHAIN_MAX_DEPTH,
            });
        }
        if self.next_creation_ordinal == SafeU53::ZERO {
            return Err(GuardFamilyStateError::ZeroNextCreationOrdinal);
        }

        let mut previous_ordinal: Option<SafeU53> = None;
        let mut previous_owner: Option<&MechanicScope> = None;
        for entry in &self.self_guards {
            if !matches!(entry.owner, MechanicScope::Pokemon { .. }) {
                return Err(GuardFamilyStateError::SelfGuardOwnerNotAPokemon);
            }
            if entry.creation_ordinal == SafeU53::ZERO
                || entry.creation_ordinal >= self.next_creation_ordinal
            {
                return Err(GuardFamilyStateError::CreationOrdinalNotAhead);
            }
            if previous_ordinal.is_some_and(|ordinal| entry.creation_ordinal <= ordinal) {
                return Err(GuardFamilyStateError::GuardsOutOfOrder);
            }
            if previous_owner.is_some_and(|owner| *owner == entry.owner) {
                return Err(GuardFamilyStateError::DuplicateSelfGuardOwner);
            }
            previous_ordinal = Some(entry.creation_ordinal);
            previous_owner = Some(&entry.owner);
        }

        let mut previous_ordinal: Option<SafeU53> = None;
        let mut previous_kind_side: Option<(SideGuardKind, BattleSide)> = None;
        for entry in &self.side_guards {
            let MechanicScope::Side { side } = entry.owner else {
                return Err(GuardFamilyStateError::SideGuardOwnerNotASide);
            };
            if entry.creation_ordinal == SafeU53::ZERO
                || entry.creation_ordinal >= self.next_creation_ordinal
            {
                return Err(GuardFamilyStateError::CreationOrdinalNotAhead);
            }
            if previous_ordinal.is_some_and(|ordinal| entry.creation_ordinal <= ordinal) {
                return Err(GuardFamilyStateError::GuardsOutOfOrder);
            }
            if previous_kind_side == Some((entry.kind, side)) {
                return Err(GuardFamilyStateError::DuplicateSideGuardKind);
            }
            previous_ordinal = Some(entry.creation_ordinal);
            previous_kind_side = Some((entry.kind, side));
        }

        Self::validate_owner_vector(
            &self.enduring_owners,
            GuardFamilyStateError::EndureOwnersOutOfOrder,
        )?;
        Self::validate_owner_vector(
            &self.endure_token_owners,
            GuardFamilyStateError::EndureTokenOwnersOutOfOrder,
        )?;
        Self::validate_owner_vector(
            &self.sturdy_owners,
            GuardFamilyStateError::SturdyOwnersOutOfOrder,
        )?;
        Ok(())
    }

    fn validate_owner_vector(
        owners: &[MechanicScope],
        disorder: GuardFamilyStateError,
    ) -> Result<(), GuardFamilyStateError> {
        let mut previous: Option<&MechanicScope> = None;
        for owner in owners {
            if previous.is_some_and(|prior| prior >= owner) {
                return Err(disorder);
            }
            previous = Some(owner);
        }
        Ok(())
    }

    /// Active self guard held by `owner`, if any.
    pub fn self_guard_for(&self, owner: &MechanicScope) -> Option<&ActiveSelfGuardEntry> {
        self.self_guards.iter().find(|entry| &entry.owner == owner)
    }

    /// Whether any side guard of `kind` is active for `side`.
    pub fn has_side_guard(&self, side: BattleSide, kind: SideGuardKind) -> bool {
        self.active_side_guards_for(side)
            .iter()
            .any(|entry| entry.kind == kind)
    }

    /// All side guards active for `side`, creation order preserved.
    pub fn active_side_guards_for(&self, side: BattleSide) -> Vec<&ActiveSideGuardEntry> {
        self.side_guards
            .iter()
            .filter(|entry| {
                matches!(
                    &entry.owner,
                    MechanicScope::Side { side: owner_side } if *owner_side == side
                )
            })
            .collect()
    }
    /// Whether `owner` carries the given survival flag.
    pub fn has_survival_flag(&self, owner: &MechanicScope, flag: SurvivalFlag) -> bool {
        match flag {
            SurvivalFlag::Enduring => self.enduring_owners.contains(owner),
            SurvivalFlag::EndureToken => self.endure_token_owners.contains(owner),
            SurvivalFlag::Sturdy => self.sturdy_owners.contains(owner),
        }
    }
}

/// Closed survival-flag identity used by queries and transitions.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SurvivalFlag {
    Enduring,
    EndureToken,
    Sturdy,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pokemon_scope(id: u64) -> MechanicScope {
        MechanicScope::Pokemon {
            pokemon: er_types::battle_ids::PokemonId::new(SafeU53::new(id).unwrap()),
        }
    }

    fn side_scope(side: BattleSide) -> MechanicScope {
        MechanicScope::Side { side }
    }

    fn ordinal(value: u64) -> SafeU53 {
        SafeU53::new(value).unwrap()
    }

    #[test]
    fn default_state_validates() {
        GuardFamilyState::default().validate().unwrap();
    }

    #[test]
    fn rejects_chain_depth_above_ceiling() {
        let mut state = GuardFamilyState::default();
        state.chain_depth = GUARD_CHAIN_MAX_DEPTH + 1;
        assert_eq!(
            state.validate(),
            Err(GuardFamilyStateError::ChainTooDeep {
                actual: GUARD_CHAIN_MAX_DEPTH + 1,
                max: GUARD_CHAIN_MAX_DEPTH,
            })
        );
    }

    #[test]
    fn rejects_wrong_schema_version() {
        let mut state = GuardFamilyState::default();
        state.schema_version = GUARD_FAMILY_STATE_SCHEMA_VERSION + 1;
        assert_eq!(
            state.validate(),
            Err(GuardFamilyStateError::SchemaVersion {
                expected: GUARD_FAMILY_STATE_SCHEMA_VERSION,
                actual: GUARD_FAMILY_STATE_SCHEMA_VERSION + 1,
            })
        );
    }

    #[test]
    fn rejects_self_guard_on_non_pokemon_scope() {
        let mut state = GuardFamilyState::default();
        state.self_guards.push(ActiveSelfGuardEntry {
            kind: GuardKind::Protect,
            owner: side_scope(BattleSide::Player),
            creation_ordinal: ordinal(1),
        });
        assert_eq!(
            state.validate(),
            Err(GuardFamilyStateError::SelfGuardOwnerNotAPokemon)
        );
    }

    #[test]
    fn rejects_duplicate_self_guard_owner() {
        let mut state = GuardFamilyState::default();
        state.self_guards.push(ActiveSelfGuardEntry {
            kind: GuardKind::Protect,
            owner: pokemon_scope(7),
            creation_ordinal: ordinal(1),
        });
        state.self_guards.push(ActiveSelfGuardEntry {
            kind: GuardKind::Detect,
            owner: pokemon_scope(7),
            creation_ordinal: ordinal(2),
        });
        assert_eq!(
            state.validate(),
            Err(GuardFamilyStateError::DuplicateSelfGuardOwner)
        );
    }

    #[test]
    fn rejects_out_of_order_or_disjoint_guard_ordinals() {
        let mut unordered = GuardFamilyState::default();
        unordered.self_guards.push(ActiveSelfGuardEntry {
            kind: GuardKind::Protect,
            owner: pokemon_scope(9),
            creation_ordinal: ordinal(2),
        });
        unordered.self_guards.push(ActiveSelfGuardEntry {
            kind: GuardKind::Detect,
            owner: pokemon_scope(10),
            creation_ordinal: ordinal(1),
        });
        assert_eq!(unordered.validate(), Err(GuardFamilyStateError::GuardsOutOfOrder));

        let mut beyond_next = GuardFamilyState::default();
        beyond_next.self_guards.push(ActiveSelfGuardEntry {
            kind: GuardKind::Protect,
            owner: pokemon_scope(9),
            creation_ordinal: ordinal(5),
        });
        assert_eq!(
            beyond_next.validate(),
            Err(GuardFamilyStateError::CreationOrdinalNotAhead)
        );

        let mut zero_ordinal = GuardFamilyState::default();
        zero_ordinal.self_guards.push(ActiveSelfGuardEntry {
            kind: GuardKind::Protect,
            owner: pokemon_scope(9),
            creation_ordinal: SafeU53::ZERO,
        });
        assert_eq!(
            zero_ordinal.validate(),
            Err(GuardFamilyStateError::CreationOrdinalNotAhead)
        );
    }

    #[test]
    fn rejects_side_guard_kind_duplication_and_bad_scope() {
        let mut duplicated = GuardFamilyState::default();
        duplicated.side_guards.push(ActiveSideGuardEntry {
            kind: SideGuardKind::WideGuard,
            owner: side_scope(BattleSide::Player),
            creation_ordinal: ordinal(1),
        });
        duplicated.side_guards.push(ActiveSideGuardEntry {
            kind: SideGuardKind::WideGuard,
            owner: side_scope(BattleSide::Player),
            creation_ordinal: ordinal(2),
        });
        assert_eq!(
            duplicated.validate(),
            Err(GuardFamilyStateError::DuplicateSideGuardKind)
        );

        let mut wrong_scope = GuardFamilyState::default();
        wrong_scope.side_guards.push(ActiveSideGuardEntry {
            kind: SideGuardKind::QuickGuard,
            owner: pokemon_scope(3),
            creation_ordinal: ordinal(1),
        });
        assert_eq!(
            wrong_scope.validate(),
            Err(GuardFamilyStateError::SideGuardOwnerNotASide)
        );
    }

    #[test]
    fn rejects_unordered_endure_owner_vectors() {
        let mut state = GuardFamilyState::default();
        state.enduring_owners = vec![pokemon_scope(4), pokemon_scope(3)];
        assert_eq!(
            state.validate(),
            Err(GuardFamilyStateError::EndureOwnersOutOfOrder)
        );
    }

    #[test]
    fn coherent_state_with_mixed_activity_validates_and_queries() {
        let mut state = GuardFamilyState::default();
        state.chain_depth = GUARD_CHAIN_MAX_DEPTH;
        state.self_guards.push(ActiveSelfGuardEntry {
            kind: GuardKind::KingsShield,
            owner: pokemon_scope(11),
            creation_ordinal: ordinal(1),
        });
        state.side_guards.push(ActiveSideGuardEntry {
            kind: SideGuardKind::QuickGuard,
            owner: side_scope(BattleSide::Enemy),
            creation_ordinal: ordinal(2),
        });
        state.enduring_owners = vec![pokemon_scope(12)];
        state.sturdy_owners = vec![pokemon_scope(13)];
        state.next_creation_ordinal = ordinal(3);
        state.validate().unwrap();

        assert!(state.has_side_guard(BattleSide::Enemy, SideGuardKind::QuickGuard));
        assert!(!state.has_side_guard(BattleSide::Player, SideGuardKind::QuickGuard));
        assert_eq!(
            state.self_guard_for(&pokemon_scope(11)).map(|entry| entry.kind),
            Some(GuardKind::KingsShield)
        );
        assert!(state.has_survival_flag(&pokemon_scope(12), SurvivalFlag::Enduring));
        assert!(!state.has_survival_flag(&pokemon_scope(12), SurvivalFlag::Sturdy));
    }

    #[test]
    fn guard_kind_classification_matches_oracle_block_status() {
        assert!(GuardKind::Protect.blocks_status());
        assert!(GuardKind::BanefulBunker.blocks_status());
        assert!(!GuardKind::KingsShield.blocks_status());
        assert!(!GuardKind::Obstruct.blocks_status());
        assert!(!GuardKind::SilkTrap.blocks_status());
        assert!(GuardKind::Endure.is_endure());
        assert!(!GuardKind::Detect.is_endure());
    }

    #[test]
    fn side_guard_chain_extension_matches_oracle_counter_rule() {
        assert!(SideGuardKind::QuickGuard.extends_chain());
        assert!(SideGuardKind::WideGuard.extends_chain());
        assert!(!SideGuardKind::CraftyShield.extends_chain());
        assert!(!SideGuardKind::MatBlock.extends_chain());
        assert!(!SideGuardKind::Safeguard.extends_chain());
    }
}
