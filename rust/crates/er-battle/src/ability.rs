//! Selected M3 ability content resolution.
//!
//! Ability IDs are content, not an invitation to fall back to an empty
//! implementation.  This module resolves an ID through the immutable pack,
//! validates the selected definition, and exposes only the closed ability
//! effects admitted by the M3 content slice.  Trigger timing and battle-state
//! evaluation live in [`crate::ability_pipeline`].

use er_content::abilities::find_ability;
use er_content::pack::{ContentPack, ContentPackError};
use er_types::battle_ids::AbilityId;
use er_types::battle_model::{AbilityEffectDefinition, CapabilityStatus, UnsupportedReasonCode};
use er_types::ids::SafeU53;
use thiserror::Error;

/// The selected NONE ability ID.
pub const NONE_ABILITY_ID: AbilityId = selected_ability_id(0);

/// The selected Intimidate ability ID.
pub const INTIMIDATE_ABILITY_ID: AbilityId = selected_ability_id(22);

/// The selected Wonder Guard ability ID.
pub const WONDER_GUARD_ABILITY_ID: AbilityId = selected_ability_id(25);
/// The selected Aroma Veil ability ID.
pub const AROMA_VEIL_ABILITY_ID: AbilityId = selected_ability_id(165);

/// Short aliases for callers that use the canonical ability names as IDs.
pub const NONE: AbilityId = NONE_ABILITY_ID;
pub const INTIMIDATE: AbilityId = INTIMIDATE_ABILITY_ID;
pub const WONDER_GUARD: AbilityId = WONDER_GUARD_ABILITY_ID;
pub const AROMA_VEIL: AbilityId = AROMA_VEIL_ABILITY_ID;

/// A selected ability after immutable-content validation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ResolvedAbility {
    /// The exact content ID that was resolved.
    pub ability_id: AbilityId,
    /// The closed effect selected by immutable content.
    pub effect: AbilityEffectDefinition,
}

impl ResolvedAbility {
    /// Whether this resolution is the explicit content-defined NONE ability.
    pub const fn is_none(self) -> bool {
        matches!(self.effect, AbilityEffectDefinition::None)
    }

    /// Whether this resolution is the selected Intimidate-like effect.
    pub const fn is_intimidate(self) -> bool {
        matches!(
            self.effect,
            AbilityEffectDefinition::PostSummonAdjacentOpponentAttackMinusOne
        )
    }

    /// Whether this resolution is the selected Wonder Guard effect.
    pub const fn is_wonder_guard(self) -> bool {
        matches!(
            self.effect,
            AbilityEffectDefinition::NonSuperEffectiveAttackImmunity
        )
    }

    pub const fn blocks_mental_effects(self) -> bool {
        matches!(self.effect, AbilityEffectDefinition::MentalEffectImmunity)
    }
}

/// Why an ability ID cannot be admitted as selected content.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum AbilityUnsupportedReason {
    /// The ID was not present in the immutable selected ability collection.
    #[error("the ID is absent from the selected content pack")]
    Missing,
    /// Immutable content explicitly classified the ability as unsupported.
    #[error("the content capability is unsupported: {reason_code:?}")]
    Capability { reason_code: UnsupportedReasonCode },
    /// The definition was present but did not match the frozen selected data.
    #[error("the definition is not canonical: {source}")]
    Definition {
        #[source]
        source: er_content::abilities::AbilityDefinitionError,
    },
}

/// Fail-closed ability content resolution error.
#[derive(Debug, Error)]
pub enum AbilityError {
    /// The immutable pack failed its complete schema, content, or hash
    /// validation.  This is distinct from an unsupported requested ID.
    #[error("selected content pack is invalid: {source}")]
    InvalidContentPack {
        /// The exact full-pack validation failure.
        #[source]
        source: ContentPackError,
    },
    /// Missing, explicitly unsupported, or non-canonical IDs are all typed
    /// unsupported content.  In particular, none of these paths becomes
    /// [`NONE_ABILITY_ID`].
    #[error("ability {ability_id:?} is unsupported content: {reason}")]
    UnsupportedContent {
        /// The rejected ID, preserved for diagnostics and integration.
        ability_id: AbilityId,
        /// The immutable-content reason for rejection.
        reason: AbilityUnsupportedReason,
    },
}

impl AbilityError {
    /// Return the rejected ID for unsupported-content failures.  Whole-pack
    /// corruption has no truthful ability-local ID and therefore returns
    /// `None`.
    pub const fn ability_id(&self) -> Option<AbilityId> {
        match self {
            Self::InvalidContentPack { .. } => None,
            Self::UnsupportedContent { ability_id, .. } => Some(*ability_id),
        }
    }

    /// Whether this is specifically an unsupported-content failure.
    pub const fn is_unsupported_content(&self) -> bool {
        matches!(self, Self::UnsupportedContent { .. })
    }
}

/// Resolve one ability through the immutable selected content pack.
///
/// The lookup is deliberately separate from trigger evaluation.  It first
/// checks the pack's capability status, then validates the exact frozen
/// definition, so a malformed or missing ID cannot silently become NONE.
pub fn resolve_ability(
    content: &ContentPack,
    ability_id: AbilityId,
) -> Result<ResolvedAbility, AbilityError> {
    content
        .validate()
        .map_err(|source| AbilityError::InvalidContentPack { source })?;

    let definition = find_ability(&content.abilities, ability_id)
        .map_err(|_| unsupported(ability_id, AbilityUnsupportedReason::Missing))?;

    if let CapabilityStatus::Unsupported { reason_code } = &definition.capability {
        return Err(unsupported(
            ability_id,
            AbilityUnsupportedReason::Capability {
                reason_code: *reason_code,
            },
        ));
    }

    definition.validate().map_err(|source| {
        unsupported(ability_id, AbilityUnsupportedReason::Definition { source })
    })?;

    Ok(ResolvedAbility {
        ability_id,
        effect: definition.effect,
    })
}

/// Compatibility name for callers that describe content resolution as an
/// evaluation rather than a lookup.
pub fn evaluate_ability(
    content: &ContentPack,
    ability_id: AbilityId,
) -> Result<ResolvedAbility, AbilityError> {
    resolve_ability(content, ability_id)
}

/// Suppression sources understood by the selected ability pipeline.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AbilitySuppressionReason {
    /// The battle-wide ignore-abilities switch is active.
    Global,
    /// The source Pokémon's active ability is suppressed.
    Active,
}

const fn selected_ability_id(value: u64) -> AbilityId {
    match SafeU53::new(value) {
        Ok(value) => AbilityId::new(value),
        Err(_) => AbilityId::ZERO,
    }
}

fn unsupported(ability_id: AbilityId, reason: AbilityUnsupportedReason) -> AbilityError {
    AbilityError::UnsupportedContent { ability_id, reason }
}
