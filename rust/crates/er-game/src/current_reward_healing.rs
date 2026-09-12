//! Source399d consumable HP effect and durable replay relation.
//! This is an internal effect primitive, not authorization to select an offer.
//! The reward owner must bind its ordinal/generated type and healing context.
use er_state::m7_state::PokemonStateV5;
use er_state::mechanic_state_v2::MechanicStateStoreV2;
use er_types::battle_model::StatusKind;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum HealingItem {
    Potion,
    SuperPotion,
    HyperPotion,
    MaxPotion,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum EffectError {
    Invalid,
    UnresolvedSource,
}

/// Explicit neutral multiplier is a caller-owned fact, never inferred from an
/// absent historical modifier record. Non-neutral healing remains unresolved.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum HealingContext {
    SourceNeutralMultiplierOne,
}

impl HealingItem {
    #[cfg(test)]
    #[allow(dead_code)]
    pub(crate) fn source_id(self) -> &'static str {
        match self {
            Self::Potion => "POTION",
            Self::SuperPotion => "SUPER_POTION",
            Self::HyperPotion => "HYPER_POTION",
            Self::MaxPotion => "MAX_POTION",
        }
    }
    fn amount(self, max_hp: u32) -> Result<u32, EffectError> {
        let (points, percent) = match self {
            Self::Potion => (20_u64, 10_u64),
            Self::SuperPotion => (50, 25),
            Self::HyperPotion => (200, 50),
            Self::MaxPotion => (0, 100),
        };
        // Exact for the admitted integral neutral context. Source takes floor
        // before max, then ceil and minimum1; integer arithmetic is sufficient.
        u32::try_from((u64::from(max_hp) * percent / 100).max(points).max(1))
            .map_err(|_| EffectError::Invalid)
    }
}

/// PokemonHpRestoreModifier.apply's ordinary non-fainted branch. Reject ER
/// ailments before mutation because any healing also removes ER_BLEED. A caller
/// must not erase those effects by pretending the mechanic store was empty.
pub(crate) fn heal(
    before: &PokemonStateV5,
    item: HealingItem,
    context: HealingContext,
) -> Result<PokemonStateV5, EffectError> {
    let HealingContext::SourceNeutralMultiplierOne = context;
    if before.max_hp == 0 || before.hp > before.max_hp || before.hp == 0 || before.fainted {
        return Err(EffectError::Invalid);
    }
    if before.mechanics != MechanicStateStoreV2::default() || before.status.kind != StatusKind::None
    {
        return Err(EffectError::UnresolvedSource);
    }
    let mut after = before.clone();
    after.hp = u32::try_from(
        (u64::from(before.hp) + u64::from(item.amount(before.max_hp)?))
            .min(u64::from(before.max_hp)),
    )
    .map_err(|_| EffectError::Invalid)?;
    // Source returns true even if already full. Selection UI eligibility is a
    // separate checked owner rule; this primitive faithfully retains apply().
    Ok(after)
}

/// Retain the full preimage, not just HP. Comparing replay to the complete live
/// Pokemon prevents a heal receipt from permitting unrelated XP/stat/move edits.
/// The retained XP validator must validate this preimage, while the reward
/// validator replays this operation and compares its result to live state.
#[cfg(test)]
#[allow(dead_code)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HealingReceipt {
    pub(crate) item: HealingItem,
    pub(crate) context: HealingContext,
    pub(crate) before: Box<PokemonStateV5>,
}
#[cfg(test)]
#[allow(dead_code)]
impl HealingReceipt {
    pub(crate) fn apply(
        before: &PokemonStateV5,
        item: HealingItem,
        context: HealingContext,
    ) -> Result<(Self, PokemonStateV5), EffectError> {
        let after = heal(before, item, context)?;
        Ok((
            Self {
                item,
                context,
                before: Box::new(before.clone()),
            },
            after,
        ))
    }
    pub(crate) fn validate_live(&self, live: &PokemonStateV5) -> Result<(), EffectError> {
        if heal(&self.before, self.item, self.context)? != *live {
            return Err(EffectError::Invalid);
        }
        Ok(())
    }
}
