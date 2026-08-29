//! Battle command/replacement scenario construction.

use er_game::m7_content::PreparedGameContentV1;
use er_types::GameControlKindV2;

use super::{CanonicalConstructionResultV1, ScenarioDomainFactoryV1};
use crate::scenario::BattleScenarioV1;

pub fn build<F: ScenarioDomainFactoryV1>(
    factory: &F,
    specification: &BattleScenarioV1,
    content: &PreparedGameContentV1,
) -> Result<CanonicalConstructionResultV1, String> {
    if !matches!(
        specification.desired_control,
        GameControlKindV2::BattleCommand | GameControlKindV2::BattleReplacement
    ) {
        return Err("battle scenarios require command or replacement frontier".to_owned());
    }
    let result = factory.battle(specification, content)?;
    if !result.validation.state_valid
        || !result.validation.content_valid
        || !result.validation.control_valid
        || !result.validation.stable_boundary
    {
        return Err("canonical battle constructor did not close validation".to_owned());
    }
    Ok(result)
}
