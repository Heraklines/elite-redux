//! Canonical substitute proxy-HP state (M6C `SUBSTITUTE_PROXY_HP` family).
//!
//! One live substitute doll ("proxy") per owning battler, created by the
//! `AddSubstituteAttr` move attributes (moves 164/880) and removed on break,
//! switch-out, faint, or `RemoveAllSubstitutesAttr` (move 882).
//!
//! Canonical invariant: a doll is active if and only if its proxy HP is
//! strictly positive and does not exceed the creation bound
//! `floor(owner_max_hp / 4)`. Broken dolls leave canonical state entirely;
//! zero-HP entries never persist.

use er_types::battle_ids::PokemonId;
use er_types::m6::{BehaviorUnitId, M6_MECHANIC_STATE_SCHEMA_VERSION};
use er_types::SafeU53;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// One live substitute doll in canonical V4 state.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubstituteProxyStateV2 {
    /// Battler the doll protects.
    pub owner: PokemonId,
    /// Remaining proxy HP; strictly positive while the doll is active.
    pub proxy_hp: SafeU53,
    /// Owner max HP captured at creation; fixes the proxy-size bound.
    pub owner_max_hp: SafeU53,
    /// Behavior-unit identity whose move attribute created this doll.
    pub source_behavior_unit: BehaviorUnitId,
}

/// Canonical root holding every live substitute doll, ordered by owner.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubstituteProxyStoreV2 {
    pub schema_version: u32,
    /// Strictly ordered by `owner`; at most one doll per battler.
    pub proxies: Vec<SubstituteProxyStateV2>,
}

impl Default for SubstituteProxyStoreV2 {
    fn default() -> Self {
        Self::new()
    }
}

impl SubstituteProxyStateV2 {
    /// Largest proxy HP a doll created against `owner_max_hp` may hold:
    /// `floor(owner_max_hp / 4)` per the oracle `SubstituteTag.onAdd`.
    #[must_use]
    pub fn proxy_bound(owner_max_hp: SafeU53) -> SafeU53 {
        SafeU53::new(owner_max_hp.get() / 4).unwrap_or(SafeU53::ZERO)
    }

    /// Validates one doll against the canonical invariants.
    ///
    /// # Errors
    /// Returns [`SubstituteProxyStateError`] when the owner max HP is zero,
    /// the proxy HP is zero, or the proxy HP exceeds its creation bound.
    pub fn validate(&self) -> Result<(), SubstituteProxyStateError> {
        if self.owner_max_hp == SafeU53::ZERO {
            return Err(SubstituteProxyStateError::ZeroOwnerMaxHp);
        }
        if self.proxy_hp == SafeU53::ZERO {
            return Err(SubstituteProxyStateError::ZeroProxyHp);
        }
        if self.proxy_hp > Self::proxy_bound(self.owner_max_hp) {
            return Err(SubstituteProxyStateError::ProxyHpAboveBound);
        }
        Ok(())
    }
}

impl SubstituteProxyStoreV2 {
    /// Creates an empty store at the current mechanic-state schema version.
    #[must_use]
    pub fn new() -> Self {
        Self {
            schema_version: M6_MECHANIC_STATE_SCHEMA_VERSION,
            proxies: Vec::new(),
        }
    }

    /// Returns the live doll protecting `owner`, if any.
    #[must_use]
    pub fn active_proxy(&self, owner: PokemonId) -> Option<&SubstituteProxyStateV2> {
        self.proxies.iter().find(|proxy| proxy.owner == owner)
    }

    /// True exactly when `owner` has an active doll. Canonical state admits
    /// only positive, bounded proxy HP, so this equals `active_proxy(..).is_some()`.
    #[must_use]
    pub fn is_active(&self, owner: PokemonId) -> bool {
        self.active_proxy(owner).is_some()
    }

    /// Inserts (or atomically replaces) the doll for its owner, keeping the
    /// deterministic owner order. Pure: consumes and returns the updated store.
    ///
    /// # Errors
    /// Returns [`SubstituteProxyStateError`] when the doll violates its
    /// invariants.
    #[must_use]
    pub fn upsert(
        mut self,
        proxy: SubstituteProxyStateV2,
    ) -> Result<Self, SubstituteProxyStateError> {
        proxy.validate()?;
        match self.proxies.binary_search_by(|probe| probe.owner.cmp(&proxy.owner)) {
            Ok(index) => self.proxies[index] = proxy,
            Err(index) => self.proxies.insert(index, proxy),
        }
        Ok(self)
    }

    /// Removes the doll for `owner`, keeping the deterministic order. Pure:
    /// consumes and returns the updated store plus the removed doll, if any.
    #[must_use]
    pub fn remove(mut self, owner: PokemonId) -> (Self, Option<SubstituteProxyStateV2>) {
        match self.proxies.binary_search_by(|probe| probe.owner.cmp(&owner)) {
            Ok(index) => {
                let removed = self.proxies.remove(index);
                (self, Some(removed))
            }
            Err(_) => (self, None),
        }
    }

    /// Removes every doll in deterministic owner order.
    #[must_use]
    pub fn remove_all(self) -> (Self, Vec<SubstituteProxyStateV2>) {
        let mut store = self;
        let removed = std::mem::take(&mut store.proxies);
        (store, removed)
    }

    /// Validates the whole store.
    ///
    /// # Errors
    /// Returns [`SubstituteProxyStateError`] when the schema version, owner
    /// ordering, or any doll invariant fails.
    pub fn validate(&self) -> Result<(), SubstituteProxyStateError> {
        if self.schema_version != M6_MECHANIC_STATE_SCHEMA_VERSION {
            return Err(SubstituteProxyStateError::SchemaVersion {
                expected: M6_MECHANIC_STATE_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        let mut previous: Option<PokemonId> = None;
        for proxy in &self.proxies {
            if previous.is_some_and(|owner| proxy.owner <= owner) {
                return Err(SubstituteProxyStateError::ProxiesOutOfOrder);
            }
            previous = Some(proxy.owner);
            proxy.validate()?;
        }
        Ok(())
    }
}

/// Canonical substitute-state invariant failures.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum SubstituteProxyStateError {
    #[error("substitute proxy state schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("substitute proxies must be strictly ordered by unique owner")]
    ProxiesOutOfOrder,
    #[error("substitute owner max HP must be positive")]
    ZeroOwnerMaxHp,
    #[error("substitute proxy HP must be positive; broken dolls leave state")]
    ZeroProxyHp,
    #[error("substitute proxy HP exceeds its creation bound")]
    ProxyHpAboveBound,
}
