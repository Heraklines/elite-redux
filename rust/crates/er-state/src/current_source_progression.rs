//! Resolved current source configuration owned by actual fresh construction.
//! Absence is unknown. This record is never added while restoring old state.
use er_types::SeatId;
use er_types::battle_ids::{BattleId, PokemonId, SpeciesId, WaveIndex};
use er_types::m72_bootstrap::StarterSelectionV1;
use er_types::run_ids::GameRunId;
use serde::{Deserialize, Serialize};

use crate::m7_state::RunStateV3;

/// Actual initialized source399d configuration observed by cfff32c11, twice.
/// It includes the real MapModifier stack1 (not an empty source modifier list),
/// with no relevant five stat/six XP families; ordinary Classic challenges,
/// Fun/fusion/pseudoMega/curse/Moody exceptions remain absent at construction.
/// Unsupported mutation paths must reject or invalidate this provenance.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentSourceConfigurationV1 {
    FreshOrdinaryClassic399d,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentSourcePokemonV1 {
    pub pokemon: PokemonId,
    /// The exact accepted selection, including its distinct bootstrap identity.
    pub selection: StarterSelectionV1,
    /// Source evolution preserves this index except its explicit 3-to-2 remap.
    /// Do not infer it from resolved IDs: multiple slots may have the same ID.
    pub ability_index: u8,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentSourceInitialEnemyV1 {
    pub pokemon: PokemonId,
    pub species: SpeciesId,
    pub form_index: u16,
    /// Actual constructed level, not an inferred source encounter-level rule.
    pub level: u16,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentSourceProgressionV1 {
    pub run_id: GameRunId,
    pub profile_owner: SeatId,
    pub configuration: CurrentSourceConfigurationV1,
    /// These identify the actual constructor's ordinary initial wild encounter.
    /// They do not authorize a later trainer, boss, ghost or changed format.
    pub initial_battle: BattleId,
    pub initial_wave: WaveIndex,
    pub initial_enemy: CurrentSourceInitialEnemyV1,
    pub initial_faint: crate::current_faint_execution::CurrentInitialEnemyFaintV1,
    pub party: Vec<CurrentSourcePokemonV1>,
}

impl CurrentSourceProgressionV1 {
    /// Restore shape and identity checks. Source context still needs the live
    /// content-aware runtime admission; these checks do not recreate history.
    pub fn valid(&self, run: &RunStateV3) -> bool {
        self.run_id == run.run_id
            && self.initial_wave.get().get() == 1
            && self.initial_enemy.pokemon.get().get() != 0
            && self.initial_enemy.species.get().get() != 0
            && self.initial_enemy.level > 0
            && self.initial_faint.valid(self.initial_enemy.pokemon)
            && (1..=6).contains(&self.party.len())
            && self.party.len() == run.party.len()
            && self.party.iter().enumerate().all(|(index, row)| {
                let pokemon = &run.party[index];
                row.pokemon == pokemon.id
                    && row.pokemon != self.initial_enemy.pokemon
                    && pokemon.owner_seat == Some(self.profile_owner)
                    && row.selection.owner_seat == self.profile_owner
                    && row.selection.ability_index == 0
                    && row.ability_index <= 2
                    && self.party[..index].iter().all(|earlier| {
                        earlier.pokemon != row.pokemon
                            && earlier.selection.pokemon_id != row.selection.pokemon_id
                    })
            })
    }
}
