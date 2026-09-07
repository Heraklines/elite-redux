use std::error::Error;

use er_progression::GrowthRateDefinitionV1;
use er_progression::progression::current_growth_experience_for_level;
use er_types::SafeU53;
use er_types::run_ids::{Experience, GrowthRateId};

#[test]
fn current_growth_matches_pinned_javascript_for_every_u16_level() -> Result<(), Box<dyn Error>> {
    let path = std::env::var("M9E_GROWTH_ORACLE")?;
    let bytes = std::fs::read(path)?;
    assert!(bytes.len() < 16 * 1024 * 1024);
    let rows: Vec<(u8, u16, u64)> = serde_json::from_slice(&bytes)?;
    let per_growth = usize::from(u16::MAX);
    assert_eq!(rows.len(), 6 * per_growth);
    for growth_id in 0_u8..6 {
        let begin = usize::from(growth_id) * per_growth;
        let table = rows[begin..begin + 100]
            .iter()
            .map(|(_, _, value)| SafeU53::new(*value).map(Experience::new))
            .collect::<Result<Vec<_>, _>>()?;
        let growth = GrowthRateDefinitionV1 {
            id: GrowthRateId::new(growth_id),
            experience_by_level: table.clone(),
        };
        for (index, &(actual_id, level, expected)) in rows[begin..begin + per_growth].iter().enumerate() {
            assert_eq!(actual_id, growth_id);
            assert_eq!(usize::from(level), index + 1);
            assert_eq!(
                current_growth_experience_for_level(&growth, level)?.get().get(),
                expected,
                "pinned oracle differs at growth={growth_id}, level={level}"
            );
        }
        assert_eq!(growth.experience_by_level, table);
    }
    Ok(())
}

#[test]
fn current_growth_rejects_zero_level_unknown_rate_and_incomplete_table() {
    let mut growth = GrowthRateDefinitionV1 {
        id: GrowthRateId::new(2),
        experience_by_level: vec![Experience::new(SafeU53::ZERO); 100],
    };
    assert!(current_growth_experience_for_level(&growth, 0).is_err());
    growth.id = GrowthRateId::new(6);
    assert!(current_growth_experience_for_level(&growth, 1).is_err());
    assert!(current_growth_experience_for_level(&growth, 101).is_err());
    growth.id = GrowthRateId::new(2);
    growth.experience_by_level.pop();
    assert!(current_growth_experience_for_level(&growth, 1).is_err());
    assert!(current_growth_experience_for_level(&growth, 101).is_err());
}
