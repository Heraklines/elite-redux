use std::error::Error;

use er_battle::damage::{DamageError, DamageInput, calculate_damage, to_dmg_value};
use er_battle::js_math::{
    js_ceil, js_clamp, js_floor, js_max, js_min, js_round, js_trunc, safe_integer_from_f64,
};
use er_rng::audit::{RngCallsiteId, RngPublicApi, RngReason, RngStream};
use er_rng::battle::{BattleRngState, RngRuntime};
use er_rng::phaser::{PhaserRdg, RunRngState};
use er_types::SafeU53;
use er_types::battle_ids::TurnIndex;
use er_types::battle_model::MoveCategory;

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn runtime() -> TestResult<RngRuntime> {
    let turn = TurnIndex::new(SafeU53::new(1)?)?;
    let run = RunRngState {
        rdg: PhaserRdg::from_seed("m3-damage-run").state(),
    };
    let battle = BattleRngState::new("m3-damage-battle", turn);
    Ok(RngRuntime::from_states(run, Some(battle))?)
}
fn physical_fixture_input() -> DamageInput {
    // physical-hit / critical-hit / burn-physical-penalty use the selected
    // POUND (move 1) boundary and explicitly exported effective stats.
    DamageInput::new(100, MoveCategory::Physical, 40.0, 148.0, 83.0).with_stab_multiplier(1.5)
}

#[test]
fn javascript_rounding_and_signed_zero_boundaries_are_preserved() -> TestResult {
    assert_eq!(js_floor(-0.0).to_bits(), (-0.0_f64).to_bits());
    assert_eq!(js_ceil(-0.0).to_bits(), (-0.0_f64).to_bits());
    assert_eq!(js_trunc(-0.25).to_bits(), (-0.0_f64).to_bits());
    assert_eq!(js_round(-0.5).to_bits(), (-0.0_f64).to_bits());
    assert_eq!(js_round(-0.1).to_bits(), (-0.0_f64).to_bits());
    assert_eq!(js_round(-0.500_000_000_000_000_1), -1.0);
    assert_eq!(js_round(0.5), 1.0);

    assert_eq!(js_min(0.0, -0.0).to_bits(), (-0.0_f64).to_bits());
    assert_eq!(js_max(0.0, -0.0).to_bits(), 0.0_f64.to_bits());
    assert!(js_min(f64::NAN, 1.0).is_nan());
    assert!(js_max(1.0, f64::NAN).is_nan());
    assert_eq!(js_clamp(-2.0, -1.0, 1.0), -1.0);
    assert_eq!(js_clamp(2.0, -1.0, 1.0), 1.0);

    assert_eq!(safe_integer_from_f64(-0.0)?, 0);
    assert_eq!(
        safe_integer_from_f64(9_007_199_254_740_991.0)?,
        9_007_199_254_740_991
    );
    assert!(safe_integer_from_f64(1.5).is_err());
    assert!(safe_integer_from_f64(f64::INFINITY).is_err());
    Ok(())
}

#[test]
fn physical_base_damage_keeps_source_expression_order() -> TestResult {
    let input = physical_fixture_input();
    let mut rng = runtime()?;
    let result = calculate_damage(&input, &mut rng)?;
    let variance = match result.variance {
        Some(variance) => variance,
        None => return Err(DamageError::NonFiniteArithmetic.into()),
    };

    let level_multiplier = (2.0 * f64::from(input.level)) / 5.0 + 2.0;
    let mut expected_base = level_multiplier * input.power;
    expected_base *= input.offensive_stat;
    expected_base /= input.defensive_stat;
    expected_base /= 50.0;
    expected_base += 2.0;
    assert_eq!(result.base_damage, expected_base);

    let random_multiplier = (variance.roll.get() as f64) / 100.0;
    let mut expected_chain = expected_base * input.target_multiplier;
    expected_chain *= input.critical_multiplier;
    expected_chain *= random_multiplier;
    expected_chain *= input.stab_multiplier;
    expected_chain *= input.effectiveness_multiplier;
    let neutral_burn_multiplier = 1.0;
    expected_chain *= neutral_burn_multiplier;
    assert_eq!(result.pre_field_damage, to_dmg_value(expected_chain)?);
    assert_eq!(result.damage, result.pre_field_damage);
    Ok(())
}

#[test]
fn stab_effectiveness_order_and_second_field_boundary_are_explicit() -> TestResult {
    // type-weakness supplies the closed x2 effectiveness modifier; the field
    // value demonstrates that the second conversion follows the first floor.
    let input = DamageInput::new(1, MoveCategory::Special, 1.0, 1.0, 1.0)
        .with_critical_multiplier(1.5)
        .with_stab_multiplier(1.5)
        .with_effectiveness_multiplier(2.0)
        .with_field_multiplier(1.5);
    let mut rng = runtime()?;
    let result = calculate_damage(&input, &mut rng)?;
    let variance = match result.variance {
        Some(variance) => variance,
        None => return Err(DamageError::NonFiniteArithmetic.into()),
    };

    let random_multiplier = (variance.roll.get() as f64) / 100.0;
    let mut expected = result.base_damage * input.target_multiplier;
    expected *= input.critical_multiplier;
    expected *= random_multiplier;
    expected *= input.stab_multiplier;
    expected *= input.effectiveness_multiplier;
    let neutral_burn_multiplier = 1.0;
    expected *= neutral_burn_multiplier;
    let first = to_dmg_value(expected)?;
    let second = to_dmg_value((first.get() as f64) * input.field_multiplier)?;

    assert_eq!(result.pre_field_damage, first);
    assert_eq!(result.damage, second);
    assert_eq!(result.field_multiplier, 1.5);
    Ok(())
}

#[test]
fn resistant_damage_keeps_the_nonimmune_minimum_of_one() -> TestResult {
    // type-resistance is the selected half-effectiveness fixture.
    let input = DamageInput::new(1, MoveCategory::Physical, 1.0, 1.0, 10_000.0)
        .with_effectiveness_multiplier(0.5);
    let mut rng = runtime()?;
    let result = calculate_damage(&input, &mut rng)?;

    assert!(!result.no_effect);
    assert_eq!(result.pre_field_damage, SafeU53::new(1)?);
    assert_eq!(result.damage, SafeU53::new(1)?);
    assert_eq!(rng.audit_entries().len(), 1);
    Ok(())
}

#[test]
fn burn_halves_physical_damage_but_not_special_damage() -> TestResult {
    // burn-physical-penalty uses a burned Rattata and POUND.  Burn is a
    // multiplier slot after effectiveness, not a base-stat rewrite.
    let normal = physical_fixture_input();
    let burned = normal.with_burned(true);
    let mut normal_rng = runtime()?;
    let mut burned_rng = normal_rng.clone();
    let normal_result = calculate_damage(&normal, &mut normal_rng)?;
    let burned_result = calculate_damage(&burned, &mut burned_rng)?;

    assert_eq!(normal_result.variance, burned_result.variance);
    assert_eq!(normal_result.burn_multiplier, 1.0);
    assert_eq!(burned_result.burn_multiplier, 0.5);
    let variance = match burned_result.variance {
        Some(variance) => variance,
        None => return Err(DamageError::NonFiniteArithmetic.into()),
    };
    let random_multiplier = (variance.roll.get() as f64) / 100.0;
    let mut expected = burned_result.base_damage * burned.target_multiplier;
    expected *= burned.critical_multiplier;
    expected *= random_multiplier;
    expected *= burned.stab_multiplier;
    expected *= burned.effectiveness_multiplier;
    expected *= burned_result.burn_multiplier;
    assert_eq!(burned_result.pre_field_damage, to_dmg_value(expected)?);

    let special = DamageInput::new(100, MoveCategory::Special, 40.0, 148.0, 83.0).with_burned(true);
    let unburned_special = special.with_burned(false);
    let mut special_rng = runtime()?;
    let mut unburned_special_rng = special_rng.clone();
    let special_result = calculate_damage(&special, &mut special_rng)?;
    let unburned_result = calculate_damage(&unburned_special, &mut unburned_special_rng)?;
    assert_eq!(special_result.burn_multiplier, 1.0);
    assert_eq!(special_result, unburned_result);
    Ok(())
}

#[test]
fn variance_uses_one_frozen_battle_audit_entry_and_preserves_run_state() -> TestResult {
    let input = physical_fixture_input();
    let mut rng = runtime()?;
    let run_before = rng.run_state();
    let result = calculate_damage(&input, &mut rng)?;
    let variance = match result.variance {
        Some(variance) => variance,
        None => return Err(DamageError::NonFiniteArithmetic.into()),
    };
    assert_eq!(rng.audit_entries().len(), 1);
    let draw = &rng.audit_entries()[0];
    assert_eq!(draw.reason, RngReason::DamageVariance);
    assert_eq!(draw.public_api, RngPublicApi::RandSeedInt);
    assert_eq!(draw.stream, RngStream::Battle);
    assert_eq!(draw.callsite_id, RngCallsiteId::damage_variance());
    assert_eq!(draw.minimum, SafeU53::new(85)?);
    assert_eq!(draw.cardinality, SafeU53::new(16)?);
    assert_eq!(draw.result, variance.roll);
    assert!(draw.consumed);
    assert_eq!(draw.primitive_draw_count, 2);
    assert_eq!(rng.run_state(), run_before);
    draw.validate()?;
    Ok(())
}

#[test]
fn native_damage_and_full_audit_are_exactly_deterministic() -> TestResult {
    // special-hit-priority and physical-hit both rely on native binary64
    // calculations; equal initial runtimes must remain eventwise identical.
    let input = DamageInput::new(100, MoveCategory::Special, 40.0, 134.0, 98.0)
        .with_effectiveness_multiplier(2.0);
    let mut left = runtime()?;
    let mut right = left.clone();
    let left_result = calculate_damage(&input, &mut left)?;
    let right_result = calculate_damage(&input, &mut right)?;
    assert_eq!(left_result, right_result);
    assert_eq!(left.audit_entries(), right.audit_entries());
    assert_eq!(left, right);
    Ok(())
}

#[test]
fn invalid_inputs_and_native_immunity_consume_no_rng() -> TestResult {
    let mut status_runtime = runtime()?;
    let status_before = status_runtime.clone();
    let status_input = DamageInput::new(100, MoveCategory::Status, 0.0, 100.0, 100.0);
    assert!(matches!(
        calculate_damage(&status_input, &mut status_runtime),
        Err(DamageError::StatusCategory)
    ));
    assert_eq!(status_runtime, status_before);

    let mut zero_power_runtime = runtime()?;
    let zero_power_before = zero_power_runtime.clone();
    let zero_power = DamageInput::new(100, MoveCategory::Physical, 0.0, 100.0, 100.0);
    assert!(matches!(
        calculate_damage(&zero_power, &mut zero_power_runtime),
        Err(DamageError::InvalidPower)
    ));
    assert_eq!(zero_power_runtime, zero_power_before);

    let mut invalid_stat_runtime = runtime()?;
    let invalid_stat_before = invalid_stat_runtime.clone();
    let invalid_stat = DamageInput::new(100, MoveCategory::Physical, 40.0, -1.0, 100.0);
    assert!(matches!(
        calculate_damage(&invalid_stat, &mut invalid_stat_runtime),
        Err(DamageError::InvalidOffensiveStat)
    ));
    assert_eq!(invalid_stat_runtime, invalid_stat_before);

    // type-native-immunity is an early ELECTRIC -> GROUND zero modifier;
    // it must not create a variance audit entry.
    let mut immune_runtime = runtime()?;
    let immune_before = immune_runtime.clone();
    let immune_input = DamageInput::new(100, MoveCategory::Special, 40.0, 134.0, 45.0)
        .with_effectiveness_multiplier(0.0);
    let immune = calculate_damage(&immune_input, &mut immune_runtime)?;
    assert!(immune.is_no_effect());
    assert_eq!(immune.damage, SafeU53::ZERO);
    assert_eq!(immune.variance, None);
    assert_eq!(immune_runtime, immune_before);
    Ok(())
}
