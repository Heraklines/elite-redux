//! Hand-reviewed scalar cases from pinned 399d source, not a generated runtime
//! oracle. Growth tables reuse the existing remotely qualified source witness.
use std::error::Error;

use er_progression::GrowthRateDefinitionV1;
use er_progression::current_experience::{
    CurrentExperienceError, DefeatedExperienceSource, ExperienceForm, ExperiencePosition,
    NeutralExperienceRecipient, OrdinaryExperienceBattle, add_normal_classic_experience,
    defeated_experience_value, neutral_defeat_award, normal_classic_level_cap,
};
use er_types::SafeU53;
use er_types::run_ids::{Experience, GrowthRateId};

type Result<T> = std::result::Result<T, Box<dyn Error>>;
fn experience(value: u64) -> Result<Experience> {
    Ok(Experience::new(SafeU53::new(value)?))
}
fn source(
    base: u64,
    level: u16,
    battle: OrdinaryExperienceBattle,
) -> Result<DefeatedExperienceSource> {
    Ok(DefeatedExperienceSource {
        base_experience: SafeU53::new(base)?,
        level,
        battle,
        form: ExperienceForm::Other,
    })
}
fn recipient(count: u32) -> NeutralExperienceRecipient {
    NeutralExperienceRecipient {
        level: 5,
        hp: 1,
        participated: true,
        participant_count: count,
    }
}
fn growth() -> Result<GrowthRateDefinitionV1> {
    let witness: serde_json::Value =
        serde_json::from_slice(include_bytes!("fixtures/m9e_growth_oracle.json"))?;
    let curve = &witness["curves"][2];
    assert_eq!(curve["rate"], 2);
    let table = curve["table"]
        .as_array()
        .ok_or("growth table absent")?
        .iter()
        .map(|value| experience(value.as_u64().ok_or("invalid growth entry")?))
        .collect::<Result<Vec<_>>>()?;
    Ok(GrowthRateDefinitionV1 {
        id: GrowthRateId::new(2),
        experience_by_level: table,
    })
}

#[test]
fn normal_classic_caps_cover_every_wave_and_each_decade_boundary() -> Result<()> {
    // game-mode.ts blob c6ddb518eface43db2bde94699b768441d4a4dec:192-199.
    // Literal results for difficulty waves 10,20,...,200; no expected-value call
    // repeats the implementation's formula. Every supported wave is checked.
    let caps = [
        10, 16, 24, 32, 38, 48, 56, 64, 74, 84, 94, 104, 114, 126, 138, 150, 162, 174, 188, 200,
    ];
    for (decade, expected) in caps.into_iter().enumerate() {
        let first = u16::try_from(decade * 10 + 1)?;
        for wave in first..=first + 9 {
            assert_eq!(normal_classic_level_cap(wave)?, expected, "wave {wave}");
        }
    }
    for wave in [0, 201, u16::MAX] {
        assert!(matches!(
            normal_classic_level_cap(wave),
            Err(CurrentExperienceError::Input)
        ));
    }
    Ok(())
}

#[test]
fn neutral_defeat_values_preserve_form_trainer_and_distribution_floor_order() -> Result<()> {
    // pokemon.ts getExpValue, pokemon-species.ts getBaseExp, and battle-scene.ts
    // applyPartyExp at pinned399d. Trainer raw97.5 is floored to97 BEFORE /N.
    // Independent expected intermediate pools distinguish that ordering even
    // where the final integral participant award happens to be equal.
    let cases = [
        (64, 5, OrdinaryExperienceBattle::Wild, 65.0, 1, 65),
        (64, 5, OrdinaryExperienceBattle::Wild, 65.0, 2, 32),
        (64, 5, OrdinaryExperienceBattle::Trainer, 97.0, 1, 97),
        (64, 5, OrdinaryExperienceBattle::Trainer, 97.0, 2, 48),
        (64, 5, OrdinaryExperienceBattle::Trainer, 97.0, 3, 32),
        (7, 2, OrdinaryExperienceBattle::Wild, 3.8, 1, 3),
        (7, 2, OrdinaryExperienceBattle::Trainer, 5.0, 2, 2),
        (0, 5, OrdinaryExperienceBattle::Wild, 1.0, 1, 1),
    ];
    for (base, level, battle, pool, count, expected) in cases {
        let defeated = source(base, level, battle)?;
        assert_eq!(defeated_experience_value(defeated)?, pool);
        assert_eq!(
            neutral_defeat_award(1, defeated, recipient(count))?,
            experience(expected)?
        );
    }
    for form in [
        ExperienceForm::Mega,
        ExperienceForm::MegaX,
        ExperienceForm::MegaY,
        ExperienceForm::Primal,
        ExperienceForm::Gigantamax,
        ExperienceForm::Eternamax,
    ] {
        let mut defeated = source(64, 5, OrdinaryExperienceBattle::Wild)?;
        defeated.form = form;
        assert_eq!(defeated_experience_value(defeated)?, 97.0);
        assert_eq!(
            neutral_defeat_award(1, defeated, recipient(2))?,
            experience(48)?
        );
        defeated.battle = OrdinaryExperienceBattle::Trainer;
        assert_eq!(defeated_experience_value(defeated)?, 145.0);
        assert_eq!(
            neutral_defeat_award(1, defeated, recipient(2))?,
            experience(72)?
        );
    }
    Ok(())
}

#[test]
fn neutral_distribution_retains_full_participant_denominator_and_recipient_eligibility()
-> Result<()> {
    let defeated = source(64, 5, OrdinaryExperienceBattle::Trainer)?;
    // Three source participants, but only one living below cap: denominator is
    // still three. Neither the capped participant nor fainted recipient earns.
    let eligible = recipient(3);
    let capped = NeutralExperienceRecipient {
        level: 10,
        ..eligible
    };
    let fainted = NeutralExperienceRecipient { hp: 0, ..eligible };
    assert_eq!(
        neutral_defeat_award(1, defeated, eligible)?,
        experience(32)?
    );
    for excluded in [
        capped,
        fainted,
        NeutralExperienceRecipient {
            level: 11,
            ..eligible
        },
        NeutralExperienceRecipient {
            participated: false,
            ..eligible
        },
        recipient(0),
    ] {
        assert_eq!(
            neutral_defeat_award(1, defeated, excluded)?,
            Experience::ZERO
        );
    }
    // Crossing the next wave's cap makes the same level10 participant eligible.
    assert_eq!(neutral_defeat_award(11, defeated, capped)?, experience(32)?);
    Ok(())
}

#[test]
fn capped_addition_preserves_multi_level_gains_discards_new_excess_and_keeps_old_experience()
-> Result<()> {
    let growth = growth()?;
    let cases = [
        (5, 125, 604, 11, 9, 729),
        (9, 729, 500, 1, 10, 1000),
        (10, 1100, 500, 1, 10, 1100),
        (12, 1728, 500, 1, 12, 1728),
        (100, 1_000_000, 30_301, 111, 101, 1_030_301),
        (100, 1_000_000, 2_000_000, 111, 104, 1_124_864),
        (199, 7_880_599, 500_000, 191, 200, 8_000_000),
        (5, 125, 0, 1, 5, 125),
    ];
    for (level, total, amount, wave, expected_level, expected_total) in cases {
        let before = ExperiencePosition {
            level,
            total: experience(total)?,
        };
        let after = add_normal_classic_experience(&growth, before, experience(amount)?, wave)?;
        assert_eq!(
            after,
            ExperiencePosition {
                level: expected_level,
                total: experience(expected_total)?
            }
        );
        assert_eq!(
            before,
            ExperiencePosition {
                level,
                total: experience(total)?
            }
        );
    }
    Ok(())
}

#[test]
fn invalid_and_overflowing_experience_inputs_leave_borrowed_source_state_unchanged() -> Result<()> {
    let mut growth = growth()?;
    let table = growth.experience_by_level.clone();
    let before = ExperiencePosition {
        level: 5,
        total: experience(125)?,
    };
    let maximum = experience(9_007_199_254_740_991)?;
    assert!(matches!(
        add_normal_classic_experience(&growth, before, maximum, 1),
        Err(CurrentExperienceError::Overflow)
    ));
    assert!(add_normal_classic_experience(&growth, before, Experience::ZERO, 0).is_err());
    assert!(
        add_normal_classic_experience(
            &growth,
            ExperiencePosition { level: 0, ..before },
            Experience::ZERO,
            1
        )
        .is_err()
    );
    let huge = source(
        9_007_199_254_740_991,
        u16::MAX,
        OrdinaryExperienceBattle::Trainer,
    )?;
    assert!(matches!(
        neutral_defeat_award(1, huge, recipient(1)),
        Err(CurrentExperienceError::Overflow)
    ));
    assert!(
        neutral_defeat_award(
            1,
            source(64, 0, OrdinaryExperienceBattle::Wild)?,
            recipient(1)
        )
        .is_err()
    );
    assert!(
        neutral_defeat_award(
            1,
            source(64, 5, OrdinaryExperienceBattle::Wild)?,
            NeutralExperienceRecipient {
                level: 0,
                ..recipient(1)
            }
        )
        .is_err()
    );
    assert_eq!(growth.experience_by_level, table);
    assert_eq!(
        before,
        ExperiencePosition {
            level: 5,
            total: experience(125)?
        }
    );
    growth.id = GrowthRateId::new(6);
    assert!(matches!(
        add_normal_classic_experience(&growth, before, Experience::ZERO, 1),
        Err(CurrentExperienceError::Growth(_))
    ));
    growth.id = GrowthRateId::new(2);
    growth.experience_by_level.pop();
    let invalid_table = growth.experience_by_level.clone();
    assert!(matches!(
        add_normal_classic_experience(&growth, before, Experience::ZERO, 1),
        Err(CurrentExperienceError::Growth(_))
    ));
    assert_eq!(growth.experience_by_level, invalid_table);
    Ok(())
}
