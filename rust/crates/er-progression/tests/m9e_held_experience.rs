use er_progression::current_party_experience::{
    HeldExperienceBooster, PartyExperiencePlanError, UnboostedPartyExperienceInput,
    UnboostedPartyExperienceMember, plan_party_experience_with_held_boosters,
    plan_unboosted_party_experience,
};

fn input() -> UnboostedPartyExperienceInput {
    UnboostedPartyExperienceInput {
        raw_exp_value: 101.0,
        trainer: false,
        pokemon_defeated: true,
        level_cap: 50,
        participant_count: 1,
        exp_share_stacks: None,
        exp_balance_stacks: Some(1),
        multiple_participant_stacks: None,
        multiplier_override: None,
        party: vec![
            UnboostedPartyExperienceMember {
                hp: 1,
                level: 20,
                participated: true,
                pokerus: false,
                on_field: true,
            },
            UnboostedPartyExperienceMember {
                hp: 1,
                level: 10,
                participated: false,
                pokerus: false,
                on_field: false,
            },
        ],
    }
}

#[test]
fn actual_whole_source_held_matrix_matches_every_fractional_phase_argument() {
    let path = std::env::var("M9E_HELD_XP_ORACLE")
        .expect("remote actual pinned JavaScript source oracle is mandatory");
    let text = std::fs::read_to_string(path).expect("actual source cases");
    let lines: Vec<_> = text.lines().collect();
    assert_eq!(lines.len(), 288);
    for (case, line) in lines.into_iter().enumerate() {
        let columns: Vec<_> = line.split('\t').collect();
        assert_eq!(columns.len(), 13);
        let optional_u8 = |index: usize| {
            (columns[index] != "-")
                .then(|| columns[index].parse::<u8>().expect("source stack count"))
        };
        let party = columns[9]
            .split(',')
            .map(|member| {
                let values: Vec<u32> = member
                    .split(':')
                    .map(|v| v.parse().expect("source numeric field"))
                    .collect();
                assert_eq!(values.len(), 3);
                UnboostedPartyExperienceMember {
                    hp: values[0],
                    level: u16::try_from(values[1]).expect("source level"),
                    participated: values[2] & 1 != 0,
                    pokerus: values[2] & 2 != 0,
                    on_field: values[2] & 4 != 0,
                }
            })
            .collect();
        let value = UnboostedPartyExperienceInput {
            raw_exp_value: columns[0].parse().expect("source raw XP"),
            trainer: columns[1] == "1",
            pokemon_defeated: columns[2] == "1",
            level_cap: columns[3].parse().expect("source level cap"),
            participant_count: columns[4].parse().expect("source participant count"),
            exp_share_stacks: optional_u8(5),
            exp_balance_stacks: optional_u8(6),
            multiple_participant_stacks: optional_u8(7),
            multiplier_override: (columns[8] != "-")
                .then(|| columns[8].parse().expect("source override")),
            party,
        };
        let held: Vec<Vec<HeldExperienceBooster>> = columns[10]
            .split(',')
            .map(|member| {
                member
                    .split(';')
                    .map(|pair| {
                        let (percent, stacks) =
                            pair.split_once(':').expect("source held booster pair");
                        HeldExperienceBooster {
                            boost_percent: percent.parse().expect("source held percent"),
                            stacks: stacks.parse().expect("source held stacks"),
                        }
                    })
                    .collect()
            })
            .collect();
        let plan =
            plan_party_experience_with_held_boosters(&value, &held).expect("admitted source input");
        let expected_friends: Vec<usize> = if columns[11] == "-" {
            vec![]
        } else {
            columns[11]
                .split(',')
                .map(|v| v.parse().expect("source numeric field"))
                .collect()
        };
        assert_eq!(
            plan.battle_friendship_calls, expected_friends,
            "case {case}"
        );
        let expected_phases: Vec<(usize, bool, u64)> = if columns[12] == "-" {
            vec![]
        } else {
            columns[12]
                .split(',')
                .map(|phase| {
                    let values: Vec<_> = phase.split(':').collect();
                    assert_eq!(values.len(), 3);
                    (
                        values[0].parse().expect("source party index"),
                        values[1] == "1",
                        u64::from_str_radix(values[2], 16).expect("source binary64 bits"),
                    )
                })
                .collect()
        };
        let actual: Vec<_> = plan
            .phase_insertions
            .iter()
            .map(|p| (p.party_index, p.on_field, p.experience.to_bits()))
            .collect();
        assert_eq!(actual, expected_phases, "case {case}");
    }
}

#[test]
fn held_booster_receives_fractional_product_before_distribution_floor() {
    let mut value = input();
    value.raw_exp_value = 7.0;
    value.participant_count = 2;
    value.exp_balance_stacks = None;
    let held = vec![
        vec![HeldExperienceBooster {
            boost_percent: 20.0,
            stacks: 1,
        }],
        vec![],
    ];
    let plan =
        plan_party_experience_with_held_boosters(&value, &held).expect("fractional source input");
    assert_eq!(plan.phase_insertions.len(), 1);
    assert_eq!(plan.phase_insertions[0].experience, 4.0);
    assert_eq!(plan.battle_friendship_calls, vec![0]);
}

#[test]
fn explicit_empty_held_context_preserves_unboosted_source_behavior() {
    let value = input();
    let before = plan_unboosted_party_experience(&value).expect("original source input");
    let after = plan_party_experience_with_held_boosters(&value, &[vec![], vec![]])
        .expect("explicit empty context");
    assert_eq!(before, after);
    let mut value = value;
    value.party[0].hp = 0;
    value.party[1].level = 50;
    let held = vec![
        vec![HeldExperienceBooster {
            boost_percent: 20.0,
            stacks: 99
        }];
        2
    ];
    let plan =
        plan_party_experience_with_held_boosters(&value, &held).expect("ineligible source party");
    assert!(plan.phase_insertions.is_empty());
    assert!(plan.battle_friendship_calls.is_empty());
}

#[test]
fn malformed_held_context_and_unsafe_awards_are_rejected_atomically() {
    let value = input();
    assert_eq!(
        plan_party_experience_with_held_boosters(&value, &[]),
        Err(PartyExperiencePlanError::Input)
    );
    for (percent, stacks) in [(20.0, 100), (-1.0, 0), (f64::NAN, 0), (f64::INFINITY, 1)] {
        let held = vec![
            vec![HeldExperienceBooster {
                boost_percent: percent,
                stacks,
            }],
            vec![],
        ];
        assert_eq!(
            plan_party_experience_with_held_boosters(&value, &held),
            Err(PartyExperiencePlanError::Input)
        );
    }
    let mut value = value;
    value.raw_exp_value = 9_007_199_254_740_991.0;
    let held = vec![
        vec![HeldExperienceBooster {
            boost_percent: 100.0,
            stacks: 1,
        }],
        vec![],
    ];
    assert_eq!(
        plan_party_experience_with_held_boosters(&value, &held),
        Err(PartyExperiencePlanError::Overflow)
    );
}
