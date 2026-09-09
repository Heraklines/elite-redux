use er_progression::current_phase_experience::{
    GlobalExperienceBooster, PhaseExperienceError, ResolvedExperiencePhase,
    resolve_phase_experience,
};

#[test]
fn whole_actual_phase_matrix_matches_every_add_exp_argument() {
    let path = std::env::var("M9E_PHASE_XP_ORACLE").expect("actual remote source matrix required");
    let text = std::fs::read_to_string(path).expect("read actual pinned phase output");
    assert_eq!(text.lines().count(), 336);
    for (index, line) in text.lines().enumerate() {
        let fields: Vec<_> = line.split('\t').collect();
        assert_eq!(fields.len(), 7);
        let number = |i: usize| fields[i].parse::<f64>().expect("source numeric argument");
        let phase = if fields[1] == "0" {
            ResolvedExperiencePhase::Party { ability: number(2) }
        } else {
            assert_eq!(fields[1], "1", "source phase discriminator");
            ResolvedExperiencePhase::Field {
                ability: number(2),
                moody: number(3),
                coordinator: number(4),
            }
        };
        let boosters: Vec<_> = if fields[5] == "-" {
            Vec::new()
        } else {
            fields[5]
                .split(',')
                .map(|pair| {
                    let (percent, stacks) = pair.split_once(':').expect("source booster pair");
                    GlobalExperienceBooster {
                        boost_percent: percent.parse().expect("source boost percent"),
                        stacks: stacks.parse().expect("source stack count"),
                    }
                })
                .collect()
        };
        let actual =
            resolve_phase_experience(number(0), &boosters, phase).expect("admitted source row");
        assert_eq!(
            actual.to_bits(),
            number(6).to_bits(),
            "source row {index}: {line}"
        );
    }
}

#[test]
fn global_boosters_floor_each_application_and_preserve_order() {
    let small = GlobalExperienceBooster {
        boost_percent: 20.0,
        stacks: 1,
    };
    let large = GlobalExperienceBooster {
        boost_percent: 60.0,
        stacks: 2,
    };
    let phase = ResolvedExperiencePhase::Party { ability: 1.0 };
    assert_eq!(
        resolve_phase_experience(1.9, &[small, large], phase),
        Ok(4.0)
    );
    assert_eq!(
        resolve_phase_experience(101.5, &[small, large], phase),
        Ok(266.0)
    );
    assert_eq!(
        resolve_phase_experience(101.5, &[large, small], phase),
        Ok(267.0)
    );
    assert_eq!(
        resolve_phase_experience(
            1.9,
            &[GlobalExperienceBooster {
                boost_percent: 60.0,
                stacks: 0
            }],
            phase
        ),
        Ok(1.0)
    );
}

#[test]
fn field_product_and_bench_ability_follow_distinct_source_paths() {
    assert_eq!(
        resolve_phase_experience(
            101.5,
            &[],
            ResolvedExperiencePhase::Field {
                ability: 1.5,
                moody: 0.75,
                coordinator: 1.25
            }
        ),
        Ok(142.0)
    );
    assert_eq!(
        resolve_phase_experience(101.5, &[], ResolvedExperiencePhase::Party { ability: 1.5 }),
        Ok(152.0)
    );
    assert_eq!(
        resolve_phase_experience(
            0.9,
            &[],
            ResolvedExperiencePhase::Field {
                ability: 2.0,
                moody: 2.0,
                coordinator: 2.0
            }
        ),
        Ok(7.0)
    );
}

#[test]
fn invalid_context_and_unsafe_arithmetic_fail_without_an_award() {
    let phase = ResolvedExperiencePhase::Party { ability: 1.0 };
    for raw in [f64::NAN, f64::INFINITY, -1.0, 9_007_199_254_740_992.0] {
        assert_eq!(
            resolve_phase_experience(raw, &[], phase),
            Err(PhaseExperienceError::Input)
        );
    }
    for (percent, stacks) in [
        (20.0, 100),
        (60.0, 31),
        (100.0, 11),
        (-1.0, 0),
        (f64::NAN, 0),
    ] {
        assert_eq!(
            resolve_phase_experience(
                1.0,
                &[GlobalExperienceBooster {
                    boost_percent: percent,
                    stacks
                }],
                phase
            ),
            Err(PhaseExperienceError::Input)
        );
    }
    assert_eq!(
        resolve_phase_experience(
            1.0,
            &[],
            ResolvedExperiencePhase::Field {
                ability: 1.0,
                moody: f64::NAN,
                coordinator: 1.0
            }
        ),
        Err(PhaseExperienceError::Input)
    );
    assert_eq!(
        resolve_phase_experience(
            9_007_199_254_740_991.0,
            &[GlobalExperienceBooster {
                boost_percent: 100.0,
                stacks: 1
            }],
            phase
        ),
        Err(PhaseExperienceError::Overflow)
    );
    assert_eq!(
        resolve_phase_experience(
            1.0,
            &[],
            ResolvedExperiencePhase::Field {
                ability: 9_007_199_254_740_991.0,
                moody: 2.0,
                coordinator: 1.0
            }
        ),
        Err(PhaseExperienceError::Overflow)
    );
}
