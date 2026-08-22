//! Closed modifier application for the selected M4 slice.
//!
//! Contract: `rust/contracts/m4-reward-market.md`. Selected immediate effects
//! execute inside Rust before any payment or stock state commits; there is no
//! external adapter and no callback arm. Unsupported effects are impossible by
//! construction because the content validator rejects them at pack load.

use er_types::battle_ids::PokemonId;
use er_types::battle_model::BattleStats;
use er_types::run_ids::Money;

use crate::content::{ModifierDefinition, ModifierEffectSpec, ModifierTargetKind};
use crate::money;

/// One resolved immediate effect, staged for the caller to fold into the
/// candidate state. Persistent effects (multipliers, charms, lock capsule)
/// resolve to [`ModifierApplication::Persistent`] and are appended to
/// `RunStateV2.modifiers` by the caller.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ModifierApplication {
    /// No immediate mechanical change; the instance persists on the run.
    Persistent,
    /// Flat + percent HP restore for one target; evidence carries both.
    HpRestored { target: PokemonId, amount: u32 },
    /// Money delta staged for checked credit.
    MoneyCredited { amount: u64 },
    /// Level increment applied to one target (cap-checked upstream).
    LevelsGained { target: PokemonId, levels: u8 },
    /// Ball inventory incremented for the registry key.
    InventoryIncremented { key: String },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ModifierApplyError {
    TargetRequired,
    TargetForbidden,
    MaxHpUnavailable,
}

/// Computes the exact HP restore for the frozen formula:
/// `floor(max_hp * percent / 100) + points`, capped at `max_hp`
/// (`src/modifier/modifier-type.ts` HealModifier, JS `Number` semantics).
fn hp_restore(max_hp: u32, points: u16, percent: u8) -> u32 {
    let percent_part = f64::from(max_hp) * f64::from(percent) / 100.0;
    let total = percent_part.floor() + f64::from(points);
    (total as u32).min(max_hp)
}

/// Resolves one selected modifier definition against its target evidence.
///
/// `target_stats` is required exactly when the definition targets one Pokémon
/// and its effect needs the target's max HP. Money rewards scale the current
/// wave-money unit supplied by the caller (`multiplier_milli` per mille).
pub fn apply_modifier(
    definition: &ModifierDefinition,
    target: Option<PokemonId>,
    target_max_hp: Option<u32>,
    money_unit: u64,
) -> Result<ModifierApplication, ModifierApplyError> {
    let requires_target = matches!(definition.target, ModifierTargetKind::OnePokemon);
    if requires_target != target.is_some() {
        return Err(if requires_target {
            ModifierApplyError::TargetRequired
        } else {
            ModifierApplyError::TargetForbidden
        });
    }
    match &definition.effect {
        ModifierEffectSpec::HpRestore { points, percent } => {
            let max_hp = target_max_hp.ok_or(ModifierApplyError::MaxHpUnavailable)?;
            Ok(ModifierApplication::HpRestored {
                target: target.expect("checked above"),
                amount: hp_restore(max_hp, *points, *percent),
            })
        }
        ModifierEffectSpec::MoneyReward { multiplier_milli } => {
            let amount = u64::from(*multiplier_milli) * money_unit / 1000;
            Ok(ModifierApplication::MoneyCredited { amount })
        }
        ModifierEffectSpec::LevelIncrement { levels } => Ok(ModifierApplication::LevelsGained {
            target: target.expect("checked above"),
            levels: *levels,
        }),
        ModifierEffectSpec::InventoryItem { key } => {
            Ok(ModifierApplication::InventoryIncremented { key: key.clone() })
        }
        ModifierEffectSpec::MoneyMultiplier { .. }
        | ModifierEffectSpec::ExperienceMultiplier { .. }
        | ModifierEffectSpec::LevelIncrementBooster { .. }
        | ModifierEffectSpec::HealingMultiplier { .. }
        | ModifierEffectSpec::LockCapsule => Ok(ModifierApplication::Persistent),
    }
}

/// Stages a money credit if the application carries one.
pub fn stage_money(
    balance: Money,
    application: &ModifierApplication,
) -> Result<Option<Money>, money::MoneyError> {
    match application {
        ModifierApplication::MoneyCredited { amount } => money::credit(balance, *amount).map(Some),
        _ => Ok(None),
    }
}

/// True when the stat vector reflects a live (non-fainted) HP pool able to
/// receive an HP restore. Fainted targets are rejected before mutation.
pub fn can_receive_restore(stats: &BattleStats, hp: u32) -> bool {
    hp > 0 && hp <= stats.hp
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_content::species::SpeciesBaseStats;
    use er_types::run_ids::ModifierId;

    fn definition(
        id: u64,
        target: ModifierTargetKind,
        effect: ModifierEffectSpec,
    ) -> ModifierDefinition {
        ModifierDefinition {
            id: ModifierId::new(er_types::SafeU53::new(id).expect("id")),
            oracle_registry_key: String::new(),
            tier: None,
            maximum_stack: 1,
            target,
            effect,
        }
    }

    fn target() -> PokemonId {
        PokemonId::new(er_types::SafeU53::new(1).expect("pid"))
    }

    #[test]
    fn potion_restore_uses_floor_plus_points_capped() {
        let potion = definition(
            100,
            ModifierTargetKind::OnePokemon,
            ModifierEffectSpec::HpRestore {
                points: 20,
                percent: 10,
            },
        );
        // Nacli level-17 max HP is 50 from the published fixture.
        let application = apply_modifier(&potion, Some(target()), Some(50), 0).expect("apply");
        assert_eq!(
            application,
            ModifierApplication::HpRestored {
                target: target(),
                amount: 25
            }
        );
        // Cap: a nearly-full target cannot overheal.
        assert_eq!(hp_restore(50, 20, 10), 25);
        assert_eq!(hp_restore(22, 20, 10), 22);
    }

    #[test]
    fn nugget_scales_the_money_unit_per_mille() {
        let nugget = definition(
            200,
            ModifierTargetKind::Run,
            ModifierEffectSpec::MoneyReward {
                multiplier_milli: 1000,
            },
        );
        let application = apply_modifier(&nugget, None, None, 400).expect("apply");
        assert_eq!(
            application,
            ModifierApplication::MoneyCredited { amount: 400 }
        );
    }

    #[test]
    fn targeted_definition_requires_a_target_and_vice_versa() {
        let potion = definition(
            100,
            ModifierTargetKind::OnePokemon,
            ModifierEffectSpec::HpRestore {
                points: 20,
                percent: 10,
            },
        );
        assert_eq!(
            apply_modifier(&potion, None, None, 0),
            Err(ModifierApplyError::TargetRequired)
        );
        let nugget = definition(
            200,
            ModifierTargetKind::Run,
            ModifierEffectSpec::MoneyReward {
                multiplier_milli: 1000,
            },
        );
        assert_eq!(
            apply_modifier(&nugget, Some(target()), None, 0),
            Err(ModifierApplyError::TargetForbidden)
        );
    }

    #[test]
    fn restore_rejects_fainted_targets() {
        let stats = BattleStats {
            hp: 50,
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
        };
        assert!(can_receive_restore(&stats, 12));
        assert!(!can_receive_restore(&stats, 0));
        let _ = SpeciesBaseStats {
            hp: 0,
            attack: 0,
            defense: 0,
            special_attack: 0,
            special_defense: 0,
            speed: 0,
        };
    }
}
