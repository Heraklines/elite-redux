//! Canonical source tracker records for an explicitly fresh current run.
//! Initial values follow pinned399d battleState()/freshState(), not legacy absence.
//! The execution adapter must fold every admitted source hook before advancing.
use std::collections::{BTreeMap, BTreeSet};
use er_types::battle_ids::{MoveId, PokemonId, TurnIndex, WaveIndex};
use er_types::run_ids::GameRunId;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentAchievementTrackerV1 {
    pub run_id: GameRunId,
    /// Source battleState is lazy and resets on actual wave change.
    pub battle: Option<CurrentAchievementBattleV1>,
    /// Source scene.erAchievementRunState initially contains neither field.
    pub absol_warning_wave: Option<WaveIndex>,
    pub absol_warning_failed: Option<bool>,
    /// Source resetErAchievementRunState is called at actual fresh launch.
    pub persistent: CurrentAchievementRunV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentAchievementRunV1 {
    pub bargain_accepted: bool,
    pub bargain_refused_pending_boss: bool,
    pub black_market_credited: bool,
    pub learned_move_stamps: BTreeMap<MoveId, WaveIndex>,
    pub parallel_play_ko_ids: BTreeSet<PokemonId>,
    /// Actual source fresh sentinel is -1, not wave zero.
    pub last_credited_revive_wave: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentAchievementBattleV1 {
    pub wave_index: WaveIndex,
    pub beam_spam_used: Option<bool>,
    pub beam_spam_invalid: Option<bool>,
    pub weave_streak: u32,
    pub switched_in_player_ids: BTreeSet<PokemonId>,
    pub turn_one_charged_moves: BTreeSet<String>,
    pub damage_source_turn: TurnIndex,
    pub damage_sources_by_target: BTreeMap<PokemonId, BTreeSet<String>>,
    pub last_spread_move: Option<CurrentAchievementSpreadMoveV1>,
    pub faint_ledger_turn: Option<TurnIndex>,
    pub player_field_faints: BTreeSet<PokemonId>,
    pub enemy_field_faints: BTreeSet<PokemonId>,
    pub flash_turn: Option<TurnIndex>,
    pub player_acted_this_turn: Option<bool>,
    pub player_ever_acted: bool,
    pub flash_failed: bool,
    pub player_fainted_this_battle: bool,
    pub enemy_ko_turns: BTreeMap<PokemonId, TurnIndex>,
    pub enemy_ko_killers: BTreeMap<PokemonId, CurrentAchievementKillerV1>,
    pub player_dealt_direct_damage: bool,
    pub relic_saved_mon_ids: BTreeSet<PokemonId>,
    pub last_enemy_killer_id: Option<PokemonId>,
    pub ko_stints: BTreeMap<PokemonId, CurrentAchievementKoStintV1>,
    pub no_sell_token: Option<CurrentAchievementNoSellV1>,
    pub charge_low_hp_user_ids: BTreeSet<PokemonId>,
    pub boss_damage_tracking: BTreeMap<PokemonId, CurrentAchievementBossDamageV1>,
    pub longest_turn_number: Option<TurnIndex>,
    pub longest_turn_effects: Option<BTreeSet<String>>,
    pub last_mon_standing_armed: bool,
    pub identity_theft_armed: bool,
    pub spread_ko_key: Option<String>,
    pub spread_ko_count: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentAchievementSpreadMoveV1 { pub move_id: MoveId, pub user_id: PokemonId, pub turn: TurnIndex }
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentAchievementKillerV1 { pub user_id: PokemonId, pub field_index: u8 }
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentAchievementKoStintV1 {
    pub kos: u32, pub had_plus_six: bool, pub entered_low_hp: bool, pub healed: bool,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentAchievementNoSellV1 { pub attacker_id: PokemonId, pub survivor_id: PokemonId }
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentAchievementBossDamageV1 {
    pub first_damage_turn: TurnIndex, pub full_hp_at_first_damage: bool, pub ohko_used: bool,
}

impl CurrentAchievementTrackerV1 {
    /// Only the source-owned fresh launch may install this record. Restore of
    /// an absent record never calls this constructor.
    pub fn fresh(run_id: GameRunId) -> Self {
        Self {
            run_id, battle: None, absol_warning_wave: None, absol_warning_failed: None,
            persistent: CurrentAchievementRunV1 {
                bargain_accepted: false, bargain_refused_pending_boss: false,
                black_market_credited: false, learned_move_stamps: BTreeMap::new(),
                parallel_play_ko_ids: BTreeSet::new(), last_credited_revive_wave: -1,
            },
        }
    }

    pub fn valid(&self, run: &crate::m7_state::RunStateV3) -> bool {
        if self.run_id != run.run_id
            || self.persistent.last_credited_revive_wave < -1
            || i128::from(self.persistent.last_credited_revive_wave) > i128::from(run.wave.get().get())
            || self.persistent.learned_move_stamps.iter().any(|(move_id, wave)|
                move_id.get() == er_types::SafeU53::ZERO || *wave > run.wave)
            || self.absol_warning_failed.is_some() != self.absol_warning_wave.is_some()
        { return false; }
        let Some(owner) = &self.battle else { return true; };
        let Some(battle) = &run.battle else { return false; };
        owner.wave_index == run.wave && owner.damage_source_turn <= battle.turn
            && owner.flash_turn.is_some() == owner.player_acted_this_turn.is_some()
            && owner.longest_turn_number.is_some() == owner.longest_turn_effects.is_some()
            && owner.spread_ko_key.is_some() == owner.spread_ko_count.is_some()
            && (owner.faint_ledger_turn.is_some()
                || (owner.player_field_faints.is_empty() && owner.enemy_field_faints.is_empty()))
            && owner.flash_turn.is_none_or(|turn| turn <= battle.turn)
            && owner.faint_ledger_turn.is_none_or(|turn| turn <= battle.turn)
            && owner.longest_turn_number.is_none_or(|turn| turn <= battle.turn)
    }

    /// The source assignment hook writes this stamp after setMove. An Undo
    /// restores only movesets and must not roll this canonical state back.
    /// The caller separately owns species/type-specific achievement dispatch.
    pub fn stamp_learned_move(
        &mut self, run: &crate::m7_state::RunStateV3, pokemon: PokemonId, move_id: MoveId,
    ) -> Result<(), crate::m9e_state_v6::GameStateV6Error> {
        if !self.valid(run) || !run.party.iter().any(|member| member.id == pokemon
            && member.moves.iter().flatten().any(|slot| slot.move_id == move_id))
        { return Err(crate::m9e_state_v6::GameStateV6Error::Invalid); }
        self.persistent.learned_move_stamps.insert(move_id, run.wave);
        Ok(())
    }
}

impl CurrentAchievementBattleV1 {
    /// Exact defined fields in source battleState's new-wave initializer;
    /// optional source fields stay absent until the corresponding real hook.
    pub fn fresh(wave_index: WaveIndex, turn: TurnIndex) -> Self {
        Self {
            wave_index, beam_spam_used: None, beam_spam_invalid: None, weave_streak: 0,
            switched_in_player_ids: BTreeSet::new(), turn_one_charged_moves: BTreeSet::new(),
            damage_source_turn: turn, damage_sources_by_target: BTreeMap::new(),
            last_spread_move: None, faint_ledger_turn: None,
            player_field_faints: BTreeSet::new(), enemy_field_faints: BTreeSet::new(),
            flash_turn: None, player_acted_this_turn: None, player_ever_acted: false,
            flash_failed: false, player_fainted_this_battle: false,
            enemy_ko_turns: BTreeMap::new(), enemy_ko_killers: BTreeMap::new(),
            player_dealt_direct_damage: false, relic_saved_mon_ids: BTreeSet::new(),
            last_enemy_killer_id: None, ko_stints: BTreeMap::new(), no_sell_token: None,
            charge_low_hp_user_ids: BTreeSet::new(), boss_damage_tracking: BTreeMap::new(),
            longest_turn_number: None, longest_turn_effects: None,
            last_mon_standing_armed: false, identity_theft_armed: false,
            spread_ko_key: None, spread_ko_count: None,
        }
    }
}
