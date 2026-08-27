//! M7 game-owned direct battle entry points.

use er_battle::m7_resolver::{BattleTransitionV5, BattleV5Error, TurnAuthorityContextV1};
use er_state::m7_state::GameStateV5;
use er_types::battle_command::CommandSet;

use crate::m7_content::PreparedGameContentV1;

pub fn resolve_turn_v5(
    before: &GameStateV5,
    commands: &CommandSet,
    content: &PreparedGameContentV1,
    authority: &TurnAuthorityContextV1,
) -> Result<BattleTransitionV5, BattleV5Error> {
    er_battle::m7_resolver::resolve_turn_v5(before, commands, &content.battle, authority)
}
