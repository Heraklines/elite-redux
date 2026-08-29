//! Deterministic M3B-05 stage/status checks.

use std::error::Error;

use er_battle::stat_stage::{
    EffectiveStatInput, StagePolicy, apply_stage_delta, effective_battle_stat, effective_speed,
    effective_stat, js_signed_shift_right_one, stage_for_stat, stage_ratio,
};
use er_battle::status::{
    ParalysisActivationOutcome, StatusApplicationInput, StatusApplicationOutcome, StatusBypass,
    StatusChanceOutcome, StatusError, StatusRejection, StatusResidualInput, StatusResidualOutcome,
    apply_status, apply_status_with_chance, burn_damage_multiplier, check_paralysis,
    resolve_residual, roll_status_chance, status_type_immunity,
};
use er_rng::audit::{RngReason, RngStream};
use er_rng::battle::{BattleRngState, RngRuntime};
use er_rng::phaser::{PhaserRdgState, RunRngState};
use er_types::SafeU53;
use er_types::battle_ids::TurnIndex;
use er_types::battle_model::{
    BattleStat, BattleStats, MoveCategory, PokemonType, PokemonTyping, StatStages, StatusKind,
    StatusState,
};

fn typing(primary: PokemonType, secondary: Option<PokemonType>) -> PokemonTyping {
    PokemonTyping { primary, secondary }
}

fn status_state(kind: StatusKind) -> StatusState {
    StatusState {
        kind,
        toxic_turn_count: 0,
        sleep_turns_remaining: None,
    }
}

fn zero_stages() -> StatStages {
    StatStages {
        attack: 0,
        defense: 0,
        special_attack: 0,
        special_defense: 0,
        speed: 0,
        accuracy: 0,
        evasion: 0,
    }
}

fn runtime_at_saved_state(
    battle_seed: &str,
    saved_substream: &str,
) -> Result<RngRuntime, Box<dyn Error>> {
    let run = RunRngState {
        rdg: PhaserRdgState::from_state_string(
            "!rnd,1,0.6266140460502356,0.847576079890132,0.8177344433497638",
        )?,
    };
    let turn = TurnIndex::new(SafeU53::new(1)?)?;
    let battle = BattleRngState {
        battle_seed: battle_seed.to_owned(),
        turn,
        saved_substream: Some(PhaserRdgState::from_state_string(saved_substream)?),
    };
    Ok(RngRuntime::from_states(run, Some(battle))?)
}

#[test]
fn all_seven_stages_use_the_published_ratio_table_and_caps() -> Result<(), Box<dyn Error>> {
    let expected = [
        0.25,
        2.0 / 7.0,
        1.0 / 3.0,
        0.4,
        0.5,
        2.0 / 3.0,
        1.0,
        1.5,
        2.0,
        2.5,
        3.0,
        3.5,
        4.0,
    ];
    for (stage, expected_ratio) in (-6_i8..=6).zip(expected) {
        assert!((stage_ratio(stage) - expected_ratio).abs() < 1.0e-12);
    }
    assert_eq!(stage_ratio(-120), 0.25);
    assert_eq!(stage_ratio(120), 4.0);

    let stats = BattleStats {
        hp: 100,
        attack: 100,
        defense: 100,
        special_attack: 100,
        special_defense: 100,
        speed: 100,
    };
    let mut stages = zero_stages();
    for stat in [
        BattleStat::Attack,
        BattleStat::Defense,
        BattleStat::SpecialAttack,
        BattleStat::SpecialDefense,
        BattleStat::Speed,
        BattleStat::Accuracy,
        BattleStat::Evasion,
    ] {
        let mutation = apply_stage_delta(&mut stages, stat, -120);
        assert_eq!(mutation.after, -6);
        assert_eq!(stage_for_stat(&stages, stat), -6);
        let mutation = apply_stage_delta(&mut stages, stat, -1);
        assert!(!mutation.changed);
        assert_eq!(mutation.before, -6);
    }
    let mutation = apply_stage_delta(&mut stages, BattleStat::Attack, 120);
    assert_eq!(mutation.after, 6);
    let mutation = apply_stage_delta(&mut stages, BattleStat::Attack, 1);
    assert!(!mutation.changed);

    let mut clean = zero_stages();
    let mutation = apply_stage_delta(&mut clean, BattleStat::Attack, 2);
    assert_eq!(mutation.before, 0);
    assert_eq!(mutation.after, 2);
    let attack = effective_battle_stat(
        &stats,
        &clean,
        BattleStat::Attack,
        StatusKind::None,
        StagePolicy::Normal,
    )?;
    assert_eq!(attack.value, 200);
    Ok(())
}

#[test]
fn critical_stage_policy_is_explicit_and_does_not_mutate_storage() -> Result<(), Box<dyn Error>> {
    let negative = effective_stat(EffectiveStatInput {
        stat: BattleStat::Attack,
        base_stat: 100,
        stage: -2,
        status: StatusKind::None,
        stage_policy: StagePolicy::IgnoreNegative,
    })?;
    assert_eq!(negative.applied_stage, 0);
    assert_eq!(negative.value, 100);

    let positive = effective_stat(EffectiveStatInput {
        stat: BattleStat::Defense,
        base_stat: 100,
        stage: 2,
        status: StatusKind::None,
        stage_policy: StagePolicy::IgnorePositive,
    })?;
    assert_eq!(positive.applied_stage, 0);
    assert_eq!(positive.value, 100);

    let mut stages = zero_stages();
    stages.attack = -2;
    let normal = effective_battle_stat(
        &BattleStats {
            hp: 100,
            attack: 100,
            defense: 100,
            special_attack: 100,
            special_defense: 100,
            speed: 100,
        },
        &stages,
        BattleStat::Attack,
        StatusKind::None,
        StagePolicy::Normal,
    )?;
    assert_eq!(normal.value, 50);
    assert_eq!(stages.attack, -2);
    Ok(())
}

#[test]
fn effective_speed_preserves_js_shift_point_and_final_floor() -> Result<(), Box<dyn Error>> {
    let speed = effective_speed(101, 1, StatusKind::Paralysis, StagePolicy::Normal)?;
    assert_eq!(speed.value, 75);
    assert!(speed.paralysis_shifted);
    assert_eq!(speed.applied_stage, 1);

    let floor = effective_speed(1, -6, StatusKind::None, StagePolicy::Normal)?;
    assert_eq!(floor.value, 1);

    // A direct large-number check proves this is a signed JS ToInt32 shift,
    // rather than floating-point division by two.
    assert_eq!(js_signed_shift_right_one(4_294_967_297.0)?, 0.0);
    assert_eq!(js_signed_shift_right_one(-1.0)?, -1.0);
    Ok(())
}

#[test]
fn status_admission_covers_application_immunity_powder_and_no_overwrite() {
    let clean = status_state(StatusKind::None);
    let applied = apply_status(StatusApplicationInput {
        requested: StatusKind::Burn,
        current: clean,
        target_types: typing(PokemonType::Normal, None),
        powder: false,
        bypass: StatusBypass::None,
    });
    assert!(matches!(
        applied,
        Ok(StatusApplicationOutcome::Applied { mutation })
            if mutation.after == status_state(StatusKind::Burn)
    ));

    let burn_immune = apply_status(StatusApplicationInput {
        requested: StatusKind::Burn,
        current: clean,
        target_types: typing(PokemonType::Fire, None),
        powder: false,
        bypass: StatusBypass::None,
    });
    assert!(matches!(
        burn_immune,
        Ok(StatusApplicationOutcome::Rejected {
            reason: StatusRejection::TypeImmunity {
                status: StatusKind::Burn,
                immune_type: PokemonType::Fire,
            }
        })
    ));

    for immune_type in [PokemonType::Poison, PokemonType::Steel] {
        let poison_immune = apply_status(StatusApplicationInput {
            requested: StatusKind::Poison,
            current: clean,
            target_types: typing(immune_type, None),
            powder: false,
            bypass: StatusBypass::None,
        });
        assert!(matches!(
            poison_immune,
            Ok(StatusApplicationOutcome::Rejected {
                reason: StatusRejection::TypeImmunity {
                    status: StatusKind::Poison,
                    ..
                }
            })
        ));
    }

    let dual_poison_immune = apply_status(StatusApplicationInput {
        requested: StatusKind::Poison,
        current: clean,
        target_types: typing(PokemonType::Steel, Some(PokemonType::Poison)),
        powder: false,
        bypass: StatusBypass::None,
    });
    assert!(matches!(
        dual_poison_immune,
        Ok(StatusApplicationOutcome::Rejected {
            reason: StatusRejection::TypeImmunity {
                status: StatusKind::Poison,
                immune_type: PokemonType::Steel,
            }
        })
    ));

    let paralysis_immune = apply_status(StatusApplicationInput {
        requested: StatusKind::Paralysis,
        current: clean,
        target_types: typing(PokemonType::Electric, None),
        powder: false,
        bypass: StatusBypass::None,
    });
    assert!(matches!(
        paralysis_immune,
        Ok(StatusApplicationOutcome::Rejected {
            reason: StatusRejection::TypeImmunity {
                status: StatusKind::Paralysis,
                immune_type: PokemonType::Electric,
            }
        })
    ));

    let powder_immune = apply_status(StatusApplicationInput {
        requested: StatusKind::Poison,
        current: clean,
        target_types: typing(PokemonType::Grass, Some(PokemonType::Poison)),
        powder: true,
        bypass: StatusBypass::None,
    });
    assert!(matches!(
        powder_immune,
        Ok(StatusApplicationOutcome::Rejected {
            reason: StatusRejection::PowderImmunity {
                immune_type: PokemonType::Grass,
            }
        })
    ));

    let existing = apply_status(StatusApplicationInput {
        requested: StatusKind::Poison,
        current: status_state(StatusKind::Burn),
        target_types: typing(PokemonType::Normal, None),
        powder: false,
        bypass: StatusBypass::None,
    });
    assert!(matches!(
        existing,
        Ok(StatusApplicationOutcome::Rejected {
            reason: StatusRejection::ExistingMajorStatus {
                existing: StatusKind::Burn,
            }
        })
    ));

    let bypass = apply_status(StatusApplicationInput {
        requested: StatusKind::Poison,
        current: clean,
        target_types: typing(PokemonType::Poison, None),
        powder: false,
        bypass: StatusBypass::TypeImmunity,
    });
    assert!(matches!(
        bypass,
        Err(StatusError::UnsupportedBypass {
            bypass: StatusBypass::TypeImmunity,
        })
    ));
}

#[test]
fn unsupported_toxic_sleep_and_status_none_fail_closed() {
    let clean = status_state(StatusKind::None);
    for requested in [StatusKind::None, StatusKind::Toxic, StatusKind::Sleep] {
        let result = apply_status(StatusApplicationInput {
            requested,
            current: clean,
            target_types: typing(PokemonType::Normal, None),
            powder: false,
            bypass: StatusBypass::None,
        });
        assert!(matches!(
            result,
            Err(StatusError::UnsupportedStatus { status }) if status == requested
        ));
    }
    let toxic = resolve_residual(StatusResidualInput {
        status: status_state(StatusKind::Toxic),
        hp: 100,
        max_hp: 100,
    });
    assert!(matches!(
        toxic,
        Err(StatusError::UnsupportedStatus {
            status: StatusKind::Toxic
        })
    ));
    assert!(matches!(
        status_type_immunity(StatusKind::Sleep, typing(PokemonType::Fire, None)),
        Err(StatusError::UnsupportedStatus {
            status: StatusKind::Sleep
        })
    ));
}

#[test]
fn residuals_increment_turn_count_and_preserve_minimum_one_rounding() -> Result<(), Box<dyn Error>>
{
    // Published poison-residual and poison-application cases use max HP/8 and
    // increment the count before the HP mutation.
    let poison = resolve_residual(StatusResidualInput {
        status: status_state(StatusKind::Poison),
        hp: 7,
        max_hp: 7,
    })?;
    let poison_mutation = match poison {
        StatusResidualOutcome::Applied { mutation } => mutation,
        other => return Err(format!("unexpected poison outcome: {other:?}").into()),
    };
    assert_eq!(poison_mutation.residual_amount, 1);
    assert_eq!(poison_mutation.damage, 1);
    assert_eq!(poison_mutation.hp_after, 6);
    assert_eq!(poison_mutation.status_after.toxic_turn_count, 1);

    let continued_poison = resolve_residual(StatusResidualInput {
        status: StatusState {
            kind: StatusKind::Poison,
            toxic_turn_count: 4,
            sleep_turns_remaining: None,
        },
        hp: 80,
        max_hp: 80,
    })?;
    assert!(matches!(
        continued_poison,
        StatusResidualOutcome::Applied { mutation }
            if mutation.status_after.toxic_turn_count == 5 && mutation.damage == 10
    ));

    let overflow = resolve_residual(StatusResidualInput {
        status: StatusState {
            kind: StatusKind::Burn,
            toxic_turn_count: u16::MAX,
            sleep_turns_remaining: None,
        },
        hp: 80,
        max_hp: 80,
    });
    assert!(matches!(overflow, Err(StatusError::TurnCountOverflow)));

    // Published burn-residual and burn-physical-penalty cases use max HP/16.
    let burn = resolve_residual(StatusResidualInput {
        status: status_state(StatusKind::Burn),
        hp: 32,
        max_hp: 32,
    })?;
    let burn_mutation = match burn {
        StatusResidualOutcome::Applied { mutation } => mutation,
        other => return Err(format!("unexpected burn outcome: {other:?}").into()),
    };
    assert_eq!(burn_mutation.residual_amount, 2);
    assert_eq!(burn_mutation.damage, 2);
    assert_eq!(burn_mutation.status_after.toxic_turn_count, 1);

    let minimum_burn = resolve_residual(StatusResidualInput {
        status: status_state(StatusKind::Burn),
        hp: 3,
        max_hp: 15,
    })?;
    assert!(matches!(
        minimum_burn,
        StatusResidualOutcome::Applied { mutation }
            if mutation.residual_amount == 1 && mutation.damage == 1
    ));

    let capped = resolve_residual(StatusResidualInput {
        status: status_state(StatusKind::Poison),
        hp: 2,
        max_hp: 100,
    })?;
    assert!(matches!(
        capped,
        StatusResidualOutcome::Applied { mutation }
            if mutation.residual_amount == 12 && mutation.damage == 2 && mutation.hp_after == 0
    ));

    let no_residual = resolve_residual(StatusResidualInput {
        status: status_state(StatusKind::Paralysis),
        hp: 10,
        max_hp: 10,
    })?;
    assert_eq!(
        no_residual,
        StatusResidualOutcome::NotApplicable {
            status: StatusKind::Paralysis,
        }
    );
    Ok(())
}

#[test]
fn paralysis_activation_has_exact_draw_and_no_draw_branches() -> Result<(), Box<dyn Error>> {
    // This saved state is the published paralysis-speed-order state immediately
    // before its activation draw; the next [0, 3] result is zero.
    let mut full = runtime_at_saved_state(
        "Cr68377BkZCjiHsT",
        "!rnd,1443036,0.583589319139719,0.47671497194096446,0.956423472147435",
    )?;
    let full_result = check_paralysis(&mut full, StatusKind::Paralysis)?;
    assert_eq!(
        full_result,
        ParalysisActivationOutcome::FullyParalyzed {
            draw: SafeU53::ZERO,
        }
    );
    assert_eq!(full.audit_entries().len(), 1);
    let draw = &full.audit_entries()[0];
    assert_eq!(draw.stream, RngStream::Battle);
    assert_eq!(draw.reason, RngReason::ParalysisActivation);
    assert_eq!(
        draw.callsite_id.as_str(),
        "3b534099919efae827019d4a3f3c4ab0ecd6d67b:src/phases/move-phase.ts:546"
    );
    assert_eq!(draw.minimum, SafeU53::ZERO);
    assert_eq!(draw.cardinality, SafeU53::new(4)?);
    assert_eq!(draw.result, SafeU53::ZERO);

    // The nonzero published state proves the continuation branch.
    let mut can_act = runtime_at_saved_state(
        "mbftVsas5Qq1MhQQ",
        "!rnd,585953,0.10012590698897839,0.7147539500147104,0.982146994676441",
    )?;
    let can_act_result = check_paralysis(&mut can_act, StatusKind::Paralysis)?;
    assert!(matches!(
        can_act_result,
        ParalysisActivationOutcome::CanAct { draw } if draw != SafeU53::ZERO
    ));

    let mut no_draw = runtime_at_saved_state(
        "mbftVsas5Qq1MhQQ",
        "!rnd,585953,0.10012590698897839,0.7147539500147104,0.982146994676441",
    )?;
    let before = no_draw.clone();
    assert_eq!(
        check_paralysis(&mut no_draw, StatusKind::None)?,
        ParalysisActivationOutcome::NotParalyzed
    );
    assert_eq!(no_draw, before);
    assert!(no_draw.audit_entries().is_empty());
    Ok(())
}

#[test]
fn burn_physical_penalty_is_selected_and_bypass_fails_closed() -> Result<(), Box<dyn Error>> {
    assert_eq!(
        burn_damage_multiplier(StatusKind::Burn, MoveCategory::Physical, StatusBypass::None)?,
        0.5
    );
    assert_eq!(
        burn_damage_multiplier(StatusKind::Burn, MoveCategory::Special, StatusBypass::None)?,
        1.0
    );
    assert_eq!(
        burn_damage_multiplier(StatusKind::None, MoveCategory::Physical, StatusBypass::None)?,
        1.0
    );
    assert!(matches!(
        burn_damage_multiplier(
            StatusKind::Burn,
            MoveCategory::Physical,
            StatusBypass::BurnDamageReduction,
        ),
        Err(StatusError::UnsupportedBypass {
            bypass: StatusBypass::BurnDamageReduction,
        })
    ));
    Ok(())
}

#[test]
fn chance_gate_has_source_no_draw_guarantees_and_strict_failure() -> Result<(), Box<dyn Error>> {
    let mut runtime = runtime_at_saved_state(
        "mbftVsas5Qq1MhQQ",
        "!rnd,585953,0.10012590698897839,0.7147539500147104,0.982146994676441",
    )?;
    assert_eq!(
        roll_status_chance(&mut runtime, None)?,
        StatusChanceOutcome::Guaranteed
    );
    assert_eq!(
        roll_status_chance(&mut runtime, Some(100))?,
        StatusChanceOutcome::Guaranteed
    );
    assert!(runtime.audit_entries().is_empty());
    let guaranteed_application = apply_status_with_chance(
        &mut runtime,
        StatusApplicationInput {
            requested: StatusKind::Burn,
            current: status_state(StatusKind::None),
            target_types: typing(PokemonType::Normal, None),
            powder: false,
            bypass: StatusBypass::None,
        },
        Some(100),
    )?;
    assert!(matches!(
        guaranteed_application,
        StatusApplicationOutcome::Applied { mutation }
            if mutation.after == status_state(StatusKind::Burn)
    ));
    assert!(runtime.audit_entries().is_empty());
    let result = roll_status_chance(&mut runtime, Some(0))?;
    assert!(matches!(result, StatusChanceOutcome::Failed { draw } if draw.get() <= 99));
    assert_eq!(runtime.audit_entries().len(), 1);
    assert_eq!(
        runtime.audit_entries()[0].reason,
        RngReason::SecondaryEffect
    );
    Ok(())
}
