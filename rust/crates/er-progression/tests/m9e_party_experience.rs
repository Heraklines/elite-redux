use er_progression::current_party_experience::{
    PartyExperiencePlanError, UnboostedPartyExperienceInput, UnboostedPartyExperienceMember,
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
fn actual_pinned_source_matrix_matches_every_phase_binary64_argument() {
    let path = std::env::var("M9E_PARTY_XP_ORACLE")
        .expect("remote actual pinned JavaScript source oracle is mandatory");
    let text = std::fs::read_to_string(path).expect("actual source cases");
    let lines: Vec<_> = text.lines().collect();
    assert_eq!(lines.len(), 144);
    for (case, line) in lines.into_iter().enumerate() {
        let columns: Vec<_> = line.split('\t').collect();
        assert_eq!(columns.len(), 12);
        let optional_u8 =
            |index: usize| (columns[index] != "-").then(|| columns[index].parse::<u8>().expect("source stack count"));
        let party = columns[9]
            .split(',')
            .map(|member| {
                let values: Vec<u32> = member.split(':').map(|v| v.parse().expect("source numeric field")).collect();
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
            multiplier_override: (columns[8] != "-").then(|| columns[8].parse().expect("source override")),
            party,
        };
        let plan = plan_unboosted_party_experience(&value).expect("admitted source input");
        let expected_friends: Vec<usize> = if columns[10] == "-" {
            vec![]
        } else {
            columns[10].split(',').map(|v| v.parse().expect("source numeric field")).collect()
        };
        assert_eq!(
            plan.battle_friendship_calls, expected_friends,
            "case {case}"
        );
        let expected_phases: Vec<(usize, bool, u64)> = if columns[11] == "-" {
            vec![]
        } else {
            columns[11]
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
fn balance_redistributes_without_share_and_preserves_fractional_phase_arguments() {
    let plan = plan_unboosted_party_experience(&input()).expect("admitted source input");
    assert_eq!(plan.battle_friendship_calls, vec![0]);
    assert_eq!(plan.phase_insertions.len(), 2);
    assert_eq!(plan.phase_insertions[0].party_index, 0);
    assert!(plan.phase_insertions[0].on_field);
    assert_eq!(
        plan.phase_insertions[0].experience.to_bits(),
        80.8_f64.to_bits()
    );
    assert_eq!(plan.phase_insertions[1].party_index, 1);
    assert!(!plan.phase_insertions[1].on_field);
    assert_eq!(
        plan.phase_insertions[1].experience.to_bits(),
        20.200000000000003_f64.to_bits()
    );
}

#[test]
fn living_at_cap_friendship_and_full_participant_denominator_preserve_source_order() {
    let mut value = input();
    value.exp_balance_stacks = None;
    value.participant_count = 3;
    value.trainer = true;
    value.party[0].level = 50;
    value.party[1].participated = true;
    value.party.push(UnboostedPartyExperienceMember {
        hp: 0,
        level: 10,
        participated: true,
        pokerus: false,
        on_field: false,
    });
    let plan = plan_unboosted_party_experience(&value).expect("admitted source input");
    assert_eq!(plan.battle_friendship_calls, vec![0, 1]);
    assert_eq!(plan.phase_insertions.len(), 1);
    assert_eq!(plan.phase_insertions[0].party_index, 1);
    assert_eq!(plan.phase_insertions[0].experience, 50.0);
    value.pokemon_defeated = false;
    assert!(
        plan_unboosted_party_experience(&value)
            .expect("admitted source input")
            .battle_friendship_calls
            .is_empty()
    );
}

#[test]
fn invalid_input_and_overflow_do_not_produce_a_partial_plan() {
    for invalid in [f64::NAN, f64::INFINITY, -1.0] {
        let mut value = input();
        value.raw_exp_value = invalid;
        assert_eq!(
            plan_unboosted_party_experience(&value),
            Err(PartyExperiencePlanError::Input)
        );
    }
    let mut value = input();
    value.exp_balance_stacks = Some(5);
    assert_eq!(
        plan_unboosted_party_experience(&value),
        Err(PartyExperiencePlanError::Input)
    );
    value = input();
    value.participant_count = 0;
    assert_eq!(
        plan_unboosted_party_experience(&value),
        Err(PartyExperiencePlanError::Input)
    );
    value.party[0].participated = false;
    assert!(
        plan_unboosted_party_experience(&value)
            .expect("admitted source input")
            .phase_insertions
            .is_empty()
    );
    value = input();
    value.raw_exp_value = 9_007_199_254_740_991.0;
    value.trainer = true;
    assert_eq!(
        plan_unboosted_party_experience(&value),
        Err(PartyExperiencePlanError::Overflow)
    );
}
