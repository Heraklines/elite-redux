//! Closed bespoke mechanic families required by the M6 semantic catalog.

pub mod action_lock;
pub mod boss;
pub mod forms;
pub mod guard;
pub mod item_lifecycle;
pub mod move_copy;
pub mod pivot_redirect;
pub mod scheduled_effects;
pub mod special_damage;
pub mod substitute;
pub mod suppression_immunity;
pub mod transform_imposter;

use er_types::BespokeMechanicId;

/// Closed production handler identities. A cluster can fan into multiple
/// handlers only where its frozen catalog intentionally groups related
/// mechanics under one coarse extraction label.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum BespokeHandlerId {
    ActionLock,
    Boss,
    Forms,
    Guard,
    ItemLifecycle,
    MoveCopy,
    PivotRedirect,
    ScheduledEffects,
    SpecialDamage,
    Substitute,
    SuppressionImmunity,
    TransformImposter,
}

const ACTION_LOCK_HANDLERS: &[BespokeHandlerId] = &[
    BespokeHandlerId::ActionLock,
    BespokeHandlerId::SuppressionImmunity,
];
const BOSS_HANDLERS: &[BespokeHandlerId] = &[BespokeHandlerId::Boss];
const CUSTOM_DISPATCH_HANDLERS: &[BespokeHandlerId] = &[
    BespokeHandlerId::Forms,
    BespokeHandlerId::MoveCopy,
    BespokeHandlerId::SuppressionImmunity,
    BespokeHandlerId::Boss,
];
const FORMS_HANDLERS: &[BespokeHandlerId] = &[
    BespokeHandlerId::TransformImposter,
    BespokeHandlerId::Forms,
    BespokeHandlerId::SuppressionImmunity,
];
const GUARD_HANDLERS: &[BespokeHandlerId] = &[BespokeHandlerId::Guard];
const ITEM_HANDLERS: &[BespokeHandlerId] = &[BespokeHandlerId::ItemLifecycle];
const REDIRECT_HANDLERS: &[BespokeHandlerId] = &[BespokeHandlerId::PivotRedirect];
const SCHEDULED_HANDLERS: &[BespokeHandlerId] = &[BespokeHandlerId::ScheduledEffects];
const SPECIAL_DAMAGE_HANDLERS: &[BespokeHandlerId] = &[BespokeHandlerId::SpecialDamage];
const SUBSTITUTE_HANDLERS: &[BespokeHandlerId] = &[BespokeHandlerId::Substitute];
const SUPPRESSION_HANDLERS: &[BespokeHandlerId] = &[BespokeHandlerId::SuppressionImmunity];

/// Exhaustive cluster-to-handler dispatch. No wildcard arm: adding a frozen
/// [`BespokeMechanicId`] requires an explicit production owner.
pub const fn handlers_for(mechanic: BespokeMechanicId) -> &'static [BespokeHandlerId] {
    match mechanic {
        BespokeMechanicId::BossCustomEr => BOSS_HANDLERS,
        BespokeMechanicId::ChargeRechargeLock => ACTION_LOCK_HANDLERS,
        BespokeMechanicId::CustomDispatch => CUSTOM_DISPATCH_HANDLERS,
        BespokeMechanicId::DelayedScheduledEffect | BespokeMechanicId::WeatherTerrainField => {
            SCHEDULED_HANDLERS
        }
        BespokeMechanicId::ItemBerryLifecycle => ITEM_HANDLERS,
        BespokeMechanicId::ProtectEndureGuard => GUARD_HANDLERS,
        BespokeMechanicId::SpecialDamageCounter => SPECIAL_DAMAGE_HANDLERS,
        BespokeMechanicId::StatusVolatileTag | BespokeMechanicId::SuppressionUnusualImmunity => {
            SUPPRESSION_HANDLERS
        }
        BespokeMechanicId::SubstituteProxyHp => SUBSTITUTE_HANDLERS,
        BespokeMechanicId::SwitchTrapRedirect => REDIRECT_HANDLERS,
        BespokeMechanicId::TransformFormCopy => FORMS_HANDLERS,
    }
}
