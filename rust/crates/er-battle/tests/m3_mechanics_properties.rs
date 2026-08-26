//! Deterministic exhaustive/property-style checks for the current pure M3 APIs.

use std::error::Error;

use er_battle::derive_battle_outcome;
use er_battle::stat_stage::{
    EffectiveStatInput, StagePolicy, apply_stage_delta, apply_stage_policy, clamp_stage,
    effective_stat, stage_for_stat, stage_mutation, stage_ratio,
};
use er_battle::status::{
    StatusApplicationInput, StatusApplicationOutcome, StatusBypass, StatusError, StatusRejection,
    StatusResidualInput, StatusResidualOutcome, apply_status, powder_immunity, resolve_residual,
};
use er_battle::type_effectiveness::{
    EffectivenessClass, EffectivenessMultiplier, TypeEffectiveness, compose_type_multipliers,
    resolve_type_effectiveness,
};
use er_content::pack::selected_type_chart;
use er_state::battle::{BattleOutcome, BattleState};
use er_types::battle_model::{
    BattleStat, MoveCategory, PokemonType, PokemonTyping, SingleTypeMultiplier, StatStages,
    StatusKind, StatusState,
};
use serde_json::Value;

const OUTCOME_FIXTURE: &str =
    include_str!("../../../fixtures/m3/oracle/battle-cases/physical-hit.json");

fn property_error(message: impl Into<String>) -> Box<dyn Error> {
    Box::new(std::io::Error::other(message.into()))
}

fn normalize_oracle_status(status: &mut Value) -> Result<(), Box<dyn Error>> {
    let kind = status
        .get("kind")
        .and_then(|value| value.get("kind"))
        .and_then(Value::as_str)
        .ok_or_else(|| property_error("oracle status kind is not the frozen nested tag"))?
        .to_owned();
    status
        .as_object_mut()
        .ok_or_else(|| property_error("oracle status is not an object"))?
        .insert("kind".to_owned(), Value::String(kind));
    Ok(())
}

fn initial_battle() -> Result<BattleState, Box<dyn Error>> {
    let document: Value = serde_json::from_str(OUTCOME_FIXTURE)?;
    let mut battle = document
        .get("initial_state")
        .and_then(|value| value.get("canonical"))
        .and_then(|value| value.get("battle"))
        .cloned()
        .ok_or_else(|| property_error("physical-hit: canonical initial battle is missing"))?;
    let battle_object = battle
        .as_object_mut()
        .ok_or_else(|| property_error("physical-hit: canonical battle is not an object"))?;
    for party_name in ["player_party", "enemy_party"] {
        let party = battle_object
            .get_mut(party_name)
            .and_then(Value::as_array_mut)
            .ok_or_else(|| property_error(format!("physical-hit: {party_name} is not an array")))?;
        for pokemon in party {
            let status = pokemon
                .get_mut("status")
                .ok_or_else(|| property_error("physical-hit: party member status is missing"))?;
            normalize_oracle_status(status)?;
        }
    }
    let format = battle_object
        .get_mut("format")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| property_error("physical-hit: format is not an object"))?;
    if format.remove("slots").is_none() {
        return Err(property_error(
            "physical-hit: frozen oracle format slots are missing",
        ));
    }
    Ok(serde_json::from_value(battle)?)
}

fn status_state(kind: StatusKind, toxic_turn_count: u16) -> StatusState {
    StatusState {
        kind,
        toxic_turn_count,
        sleep_turns_remaining: None,
    }
}

fn supported_types() -> [PokemonType; 18] {
    [
        PokemonType::Normal,
        PokemonType::Fire,
        PokemonType::Water,
        PokemonType::Electric,
        PokemonType::Grass,
        PokemonType::Ice,
        PokemonType::Fighting,
        PokemonType::Poison,
        PokemonType::Ground,
        PokemonType::Flying,
        PokemonType::Psychic,
        PokemonType::Bug,
        PokemonType::Rock,
        PokemonType::Ghost,
        PokemonType::Dragon,
        PokemonType::Dark,
        PokemonType::Steel,
        PokemonType::Fairy,
    ]
}

fn status_rejection_label(reason: &StatusRejection) -> &'static str {
    match reason {
        StatusRejection::ExistingMajorStatus { .. } => "EXISTING_MAJOR_STATUS",
        StatusRejection::TypeImmunity { .. } => "TYPE_IMMUNITY",
        StatusRejection::PowderImmunity { .. } => "POWDER_IMMUNITY",
        StatusRejection::IntrinsicSentinel => "INTRINSIC_SENTINEL",
        StatusRejection::SleepWindowRequired => "SLEEP_WINDOW_REQUIRED",
        StatusRejection::ReroutedToFrostbiteTag => "REROUTED_TO_FROSTBITE_TAG",
        StatusRejection::RoutedToFaintSubstate => "ROUTED_TO_FAINT_SUBSTATE",
    }
}

fn expected_status_rejection(
    requested: StatusKind,
    target_types: PokemonTyping,
    powder: bool,
) -> Option<&'static str> {
    if powder && powder_immunity(target_types) {
        return Some("POWDER_IMMUNITY");
    }
    let primary_blocks = matches!(
        (requested, target_types.primary),
        (StatusKind::Poison, PokemonType::Poison | PokemonType::Steel)
            | (StatusKind::Paralysis, PokemonType::Electric)
            | (StatusKind::Burn, PokemonType::Fire)
    );
    let secondary_blocks = target_types.secondary.is_some_and(|secondary| {
        matches!(
            (requested, secondary),
            (StatusKind::Poison, PokemonType::Poison | PokemonType::Steel)
                | (StatusKind::Paralysis, PokemonType::Electric)
                | (StatusKind::Burn, PokemonType::Fire)
        )
    });
    if primary_blocks || secondary_blocks {
        Some("TYPE_IMMUNITY")
    } else {
        None
    }
}

fn expected_composition(
    left: EffectivenessMultiplier,
    right: EffectivenessMultiplier,
) -> Option<EffectivenessMultiplier> {
    use EffectivenessMultiplier::{Four, Half, One, Quarter, Two, Zero};
    if left == Zero || right == Zero {
        return Some(Zero);
    }
    match (left, right) {
        (Half, Half) => Some(Quarter),
        (Half, One) | (One, Half) => Some(Half),
        (Half, Two) | (Two, Half) => Some(One),
        (One, One) => Some(One),
        (One, Two) | (Two, One) => Some(Two),
        (Two, Two) => Some(Four),
        _ => None,
    }
}

#[test]
fn outcome_precedence_is_exhaustive_over_live_and_fainted_flags() -> Result<(), Box<dyn Error>> {
    let template = initial_battle()?;
    for player_hp_positive in [false, true] {
        for player_fainted in [false, true] {
            for enemy_hp_positive in [false, true] {
                for enemy_fainted in [false, true] {
                    let mut battle = template.clone();
                    let player = battle
                        .player_party
                        .get_mut(0)
                        .ok_or_else(|| property_error("outcome fixture has no player"))?;
                    player.hp = if player_hp_positive {
                        player.max_hp.max(1)
                    } else {
                        0
                    };
                    player.fainted = player_fainted;
                    let enemy = battle
                        .enemy_party
                        .get_mut(0)
                        .ok_or_else(|| property_error("outcome fixture has no enemy"))?;
                    enemy.hp = if enemy_hp_positive {
                        enemy.max_hp.max(1)
                    } else {
                        0
                    };
                    enemy.fainted = enemy_fainted;

                    let player_living = player_hp_positive && !player_fainted;
                    let enemy_living = enemy_hp_positive && !enemy_fainted;
                    let expected = if !player_living {
                        BattleOutcome::Defeat
                    } else if !enemy_living {
                        BattleOutcome::Victory
                    } else {
                        BattleOutcome::Ongoing
                    };
                    assert_eq!(derive_battle_outcome(&battle), expected);
                }
            }
        }
    }
    Ok(())
}

#[test]
fn residual_status_bounds_and_turn_counters_hold_over_deterministic_grid()
-> Result<(), Box<dyn Error>> {
    let statuses = [
        StatusKind::None,
        StatusKind::Paralysis,
        StatusKind::Poison,
        StatusKind::Burn,
    ];
    let boundary_counters = [0, 1, u16::MAX - 1, u16::MAX];

    for max_hp in 1..=64_u32 {
        for hp in 0..=max_hp {
            for kind in statuses {
                let counters = match kind {
                    StatusKind::None | StatusKind::Paralysis => [0, 0, 0, 0],
                    StatusKind::Poison | StatusKind::Burn => boundary_counters,
                    StatusKind::Toxic | StatusKind::Sleep => [0, 0, 0, 0],
                };
                for toxic_turn_count in counters {
                    let input = StatusResidualInput {
                        status: status_state(kind, toxic_turn_count),
                        hp,
                        max_hp,
                    };
                    let result = resolve_residual(input);
                    match (kind, hp, toxic_turn_count, result) {
                        (
                            StatusKind::None | StatusKind::Paralysis,
                            0,
                            _,
                            Ok(StatusResidualOutcome::TargetFainted { status, hp: 0 }),
                        ) => {
                            assert_eq!(status.kind, kind);
                        }
                        (
                            StatusKind::None | StatusKind::Paralysis,
                            hp,
                            0,
                            Ok(StatusResidualOutcome::NotApplicable { status }),
                        ) if hp > 0 => assert_eq!(status, kind),
                        (
                            StatusKind::Poison | StatusKind::Burn,
                            0,
                            _,
                            Ok(StatusResidualOutcome::TargetFainted { status, hp: 0 }),
                        ) => assert_eq!(status.kind, kind),
                        (
                            StatusKind::Poison | StatusKind::Burn,
                            hp,
                            u16::MAX,
                            Err(StatusError::TurnCountOverflow),
                        ) if hp > 0 => {}
                        (
                            StatusKind::Poison | StatusKind::Burn,
                            hp,
                            toxic_turn_count,
                            Ok(StatusResidualOutcome::Applied { mutation }),
                        ) if hp > 0 && toxic_turn_count < u16::MAX => {
                            let divisor = if kind == StatusKind::Poison { 8 } else { 16 };
                            let expected_residual = (max_hp / divisor).max(1);
                            assert_eq!(mutation.status_before, input.status);
                            assert_eq!(
                                mutation.status_after.toxic_turn_count,
                                toxic_turn_count + 1
                            );
                            assert_eq!(mutation.residual_amount, expected_residual);
                            assert_eq!(mutation.damage, expected_residual.min(hp));
                            assert_eq!(mutation.hp_after, hp - mutation.damage);
                            assert!(mutation.damage <= mutation.residual_amount);
                            assert!(mutation.damage <= mutation.hp_before);
                            assert!(mutation.hp_after <= mutation.hp_before);
                            assert!(mutation.hp_after <= max_hp);
                        }
                        (kind, hp, toxic_turn_count, result) => {
                            return Err(property_error(format!(
                                "unexpected residual result for {kind:?} HP {hp}/{max_hp} count {toxic_turn_count}: {result:?}"
                            )));
                        }
                    }
                }
            }
        }
    }

    for kind in [StatusKind::None, StatusKind::Paralysis] {
        let result = resolve_residual(StatusResidualInput {
            status: status_state(kind, 1),
            hp: 10,
            max_hp: 10,
        });
        assert!(matches!(
            result,
            Err(StatusError::InvalidStatusState { status }) if status == kind
        ));
    }
    for kind in [StatusKind::Poison, StatusKind::Burn] {
        let invalid_sleep = resolve_residual(StatusResidualInput {
            status: StatusState {
                kind,
                toxic_turn_count: 0,
                sleep_turns_remaining: Some(1),
            },
            hp: 10,
            max_hp: 10,
        });
        assert!(matches!(
            invalid_sleep,
            Err(StatusError::InvalidStatusState { status: actual }) if actual == kind
        ));
    }

    for &(max_hp, hp) in &[(0_u32, 0_u32), (0, 1), (10, 11)] {
        let result = resolve_residual(StatusResidualInput {
            status: status_state(StatusKind::Burn, 0),
            hp,
            max_hp,
        });
        if max_hp == 0 {
            assert!(matches!(result, Err(StatusError::InvalidMaxHp)));
        } else {
            assert!(matches!(result, Err(StatusError::InvalidHp)));
        }
    }

    let boundary_result = resolve_residual(StatusResidualInput {
        status: status_state(StatusKind::Poison, u16::MAX - 1),
        hp: u32::MAX,
        max_hp: u32::MAX,
    })?;
    assert!(matches!(
        boundary_result,
        StatusResidualOutcome::Applied { mutation }
            if mutation.damage == u32::MAX / 8
                && mutation.hp_after == u32::MAX - u32::MAX / 8
                && mutation.status_after.toxic_turn_count == u16::MAX
    ));
    Ok(())
}

#[test]
fn stage_clamp_policy_and_mutation_are_exhaustive_and_idempotent() -> Result<(), Box<dyn Error>> {
    let stats = [
        BattleStat::Attack,
        BattleStat::Defense,
        BattleStat::SpecialAttack,
        BattleStat::SpecialDefense,
        BattleStat::Speed,
        BattleStat::Accuracy,
        BattleStat::Evasion,
    ];
    let policies = [
        StagePolicy::Normal,
        StagePolicy::IgnoreNegative,
        StagePolicy::IgnorePositive,
    ];

    for raw in i8::MIN..=i8::MAX {
        let clamped = clamp_stage(raw);
        assert!((-6..=6).contains(&clamped));
        assert_eq!(clamp_stage(clamped), clamped);
        for policy in policies {
            let applied = apply_stage_policy(raw, policy);
            assert!((-6..=6).contains(&applied));
            assert_eq!(apply_stage_policy(applied, policy), applied);
            match policy {
                StagePolicy::Normal => assert_eq!(applied, clamped),
                StagePolicy::IgnoreNegative => assert_eq!(applied, clamped.max(0)),
                StagePolicy::IgnorePositive => assert_eq!(applied, clamped.min(0)),
            }
        }
        let ratio = stage_ratio(raw);
        assert!((0.25..=4.0).contains(&ratio));
        assert_eq!(stage_ratio(raw), stage_ratio(clamped));
    }

    for stat in stats {
        for current in i8::MIN..=i8::MAX {
            for delta in i8::MIN..=i8::MAX {
                let before = clamp_stage(current);
                let requested = i16::from(before) + i16::from(delta);
                let expected_after = requested.clamp(-6, 6) as i8;
                let mutation = stage_mutation(stat, current, delta);
                assert_eq!(mutation.stat, stat);
                assert_eq!(mutation.before, before);
                assert_eq!(mutation.after, expected_after);
                assert_eq!(mutation.changed, mutation.before != mutation.after);

                let mut stages = StatStages {
                    attack: 0,
                    defense: 0,
                    special_attack: 0,
                    special_defense: 0,
                    speed: 0,
                    accuracy: 0,
                    evasion: 0,
                };
                let applied = apply_stage_delta(&mut stages, stat, delta);
                assert_eq!(applied, stage_mutation(stat, 0, delta));
                assert_eq!(stage_for_stat(&stages, stat), applied.after);
                assert!((-6..=6).contains(&stage_for_stat(&stages, stat)));
            }
        }
    }
    Ok(())
}

#[test]
fn effective_stats_preserve_bounds_stage_policy_and_paralysis_order() -> Result<(), Box<dyn Error>>
{
    let stats = [
        BattleStat::Attack,
        BattleStat::Defense,
        BattleStat::SpecialAttack,
        BattleStat::SpecialDefense,
        BattleStat::Speed,
    ];
    let statuses = [
        StatusKind::None,
        StatusKind::Burn,
        StatusKind::Poison,
        StatusKind::Paralysis,
    ];
    let policies = [
        StagePolicy::Normal,
        StagePolicy::IgnoreNegative,
        StagePolicy::IgnorePositive,
    ];
    let base_values = [0, 1, 2, 3, 7, 100, u32::MAX / 4];

    for base_stat in base_values {
        for stage in -6..=6 {
            for stat in stats {
                for status in statuses {
                    for stage_policy in policies {
                        let outcome = effective_stat(EffectiveStatInput {
                            stat,
                            base_stat,
                            stage,
                            status,
                            stage_policy,
                        })?;
                        assert_eq!(outcome.input_stage, stage);
                        assert_eq!(
                            outcome.applied_stage,
                            apply_stage_policy(stage, stage_policy)
                        );
                        assert!((0.25..=4.0).contains(&outcome.stage_ratio));
                        assert!(outcome.value >= 1);
                        assert_eq!(
                            outcome.paralysis_shifted,
                            stat == BattleStat::Speed && status == StatusKind::Paralysis
                        );
                    }
                }
            }
        }
    }
    Ok(())
}

#[test]
fn type_effectiveness_composition_and_chart_resolution_are_exhaustive() -> Result<(), Box<dyn Error>>
{
    let single_values = [
        SingleTypeMultiplier::Zero,
        SingleTypeMultiplier::Half,
        SingleTypeMultiplier::One,
        SingleTypeMultiplier::Two,
    ];
    for primary in single_values {
        let primary_effectiveness = EffectivenessMultiplier::from_single_type(primary);
        assert_eq!(
            compose_type_multipliers(primary, None),
            Some(primary_effectiveness)
        );
        for secondary in single_values {
            let left = EffectivenessMultiplier::from_single_type(primary);
            let right = EffectivenessMultiplier::from_single_type(secondary);
            let expected = expected_composition(left, right);
            assert_eq!(compose_type_multipliers(primary, Some(secondary)), expected);
            assert_eq!(compose_type_multipliers(secondary, Some(primary)), expected);
            assert_eq!(left.compose(right), expected);
        }
    }

    for multiplier in [
        EffectivenessMultiplier::Zero,
        EffectivenessMultiplier::Quarter,
        EffectivenessMultiplier::Half,
        EffectivenessMultiplier::One,
        EffectivenessMultiplier::Two,
        EffectivenessMultiplier::Four,
    ] {
        match multiplier {
            EffectivenessMultiplier::Zero => {
                assert!(multiplier.is_immune());
                assert!(multiplier.is_non_super_effective());
            }
            EffectivenessMultiplier::Quarter | EffectivenessMultiplier::Half => {
                assert!(multiplier.is_resistant());
                assert!(multiplier.is_non_super_effective());
            }
            EffectivenessMultiplier::One => {
                assert!(multiplier.is_neutral());
                assert!(multiplier.is_non_super_effective());
            }
            EffectivenessMultiplier::Two | EffectivenessMultiplier::Four => {
                assert!(multiplier.is_weak());
                assert!(multiplier.is_super_effective());
            }
        }
        assert_eq!(
            multiplier.is_non_super_effective(),
            !multiplier.is_super_effective()
        );
        assert_eq!(
            TypeEffectiveness::new(multiplier).allows_follow_up_resolution(),
            !multiplier.is_immune()
        );
    }

    let chart = selected_type_chart();
    let attack_types = [
        PokemonType::Normal,
        PokemonType::Fire,
        PokemonType::Poison,
        PokemonType::Grass,
        PokemonType::Electric,
    ];
    let defender_types = supported_types();
    for attack in attack_types {
        for primary in defender_types {
            let one = resolve_type_effectiveness(
                &chart,
                attack,
                &PokemonTyping {
                    primary,
                    secondary: None,
                },
            )?;
            assert_eq!(
                one.multiplier,
                EffectivenessMultiplier::from_single_type(chart.multiplier(attack, primary))
            );
            assert_eq!(
                one.class(),
                if one.multiplier.is_immune() {
                    EffectivenessClass::Immune
                } else if one.multiplier.is_resistant() {
                    EffectivenessClass::Resistant
                } else if one.multiplier.is_neutral() {
                    EffectivenessClass::Neutral
                } else {
                    EffectivenessClass::SuperEffective
                }
            );
            for secondary in defender_types {
                if primary == secondary {
                    continue;
                }
                let typing = PokemonTyping {
                    primary,
                    secondary: Some(secondary),
                };
                let resolved = resolve_type_effectiveness(&chart, attack, &typing)?;
                let expected = compose_type_multipliers(
                    chart.multiplier(attack, primary),
                    Some(chart.multiplier(attack, secondary)),
                )
                .ok_or_else(|| property_error("selected chart exceeded closed multiplier set"))?;
                assert_eq!(resolved.multiplier, expected);
                let reversed = resolve_type_effectiveness(
                    &chart,
                    attack,
                    &PokemonTyping {
                        primary: secondary,
                        secondary: Some(primary),
                    },
                )?;
                assert_eq!(resolved, reversed);
            }
        }
    }
    Ok(())
}

#[test]
fn status_admission_is_exhaustive_and_preserves_source_precedence() -> Result<(), Box<dyn Error>> {
    let types = supported_types();
    let requested_statuses = [StatusKind::Poison, StatusKind::Paralysis, StatusKind::Burn];
    let current_statuses = [
        StatusKind::None,
        StatusKind::Poison,
        StatusKind::Paralysis,
        StatusKind::Burn,
    ];

    for primary in types {
        let mut target_typings = vec![PokemonTyping {
            primary,
            secondary: None,
        }];
        for secondary in types {
            if primary != secondary {
                target_typings.push(PokemonTyping {
                    primary,
                    secondary: Some(secondary),
                });
            }
        }
        for target_types in target_typings {
            for requested in requested_statuses {
                for current_kind in current_statuses {
                    for powder in [false, true] {
                        let current = status_state(current_kind, 0);
                        let outcome = apply_status(StatusApplicationInput {
                            requested,
                            current,
                            target_types,
                            powder,
                            bypass: StatusBypass::None,
                        })?;
                        if current_kind != StatusKind::None {
                            assert!(matches!(
                                outcome,
                                StatusApplicationOutcome::Rejected {
                                    reason: StatusRejection::ExistingMajorStatus { existing }
                                } if existing == current_kind
                            ));
                            if let StatusApplicationOutcome::Rejected { reason } = &outcome {
                                assert_eq!(status_rejection_label(reason), "EXISTING_MAJOR_STATUS");
                            }
                            continue;
                        }

                        let expected = expected_status_rejection(requested, target_types, powder);
                        match (expected, outcome) {
                            (
                                Some("POWDER_IMMUNITY"),
                                StatusApplicationOutcome::Rejected { reason },
                            ) => {
                                assert_eq!(status_rejection_label(&reason), "POWDER_IMMUNITY");
                            }
                            (
                                Some("TYPE_IMMUNITY"),
                                StatusApplicationOutcome::Rejected { reason },
                            ) => {
                                assert_eq!(status_rejection_label(&reason), "TYPE_IMMUNITY");
                            }
                            (None, StatusApplicationOutcome::Applied { mutation }) => {
                                assert_eq!(mutation.before, current);
                                assert_eq!(mutation.after, status_state(requested, 0));
                            }
                            (expected, actual) => {
                                return Err(property_error(format!(
                                    "status admission mismatch for {requested:?} on {target_types:?}, powder {powder}: expected {expected:?}, actual {actual:?}"
                                )));
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

#[test]
fn unsupported_status_and_bypass_inputs_fail_closed() -> Result<(), Box<dyn Error>> {
    let normal = PokemonTyping {
        primary: PokemonType::Normal,
        secondary: None,
    };
    for requested in [StatusKind::None, StatusKind::Toxic, StatusKind::Sleep] {
        let result = apply_status(StatusApplicationInput {
            requested,
            current: status_state(StatusKind::None, 0),
            target_types: normal,
            powder: false,
            bypass: StatusBypass::None,
        });
        assert!(matches!(
            result,
            Err(StatusError::UnsupportedStatus { status }) if status == requested
        ));
    }
    for bypass in [
        StatusBypass::TypeImmunity,
        StatusBypass::PowderImmunity,
        StatusBypass::ExistingStatus,
        StatusBypass::BurnDamageReduction,
    ] {
        let result = apply_status(StatusApplicationInput {
            requested: StatusKind::Burn,
            current: status_state(StatusKind::None, 0),
            target_types: normal,
            powder: false,
            bypass,
        });
        assert!(matches!(
            result,
            Err(StatusError::UnsupportedBypass { bypass: actual }) if actual == bypass
        ));
    }
    assert_eq!(
        er_battle::status::burn_damage_multiplier(
            StatusKind::Burn,
            MoveCategory::Physical,
            StatusBypass::None,
        )?,
        0.5
    );
    assert_eq!(
        er_battle::status::burn_damage_multiplier(
            StatusKind::Burn,
            MoveCategory::Special,
            StatusBypass::None,
        )?,
        1.0
    );
    Ok(())
}
