//! Private first-context source pool. Complete registry and species/move closure
//! are content facts; every health/PP/level predicate is evaluated on live state.
use super::current_reward_roll::{Offer, RollError, SourcePool};
use super::current_reward_tuning::Weight;
use super::{
    current_reward_common as common, current_reward_great as great, current_reward_high as high,
    current_reward_ultra as ultra,
};
use crate::m9e_content_v2::PreparedGameContentV2;
use er_rng::audit::{RngCallsiteId, RngDraw, RngReason};
use er_rng::battle::RngRuntime;
use er_rng::phaser::shift_char_codes;
use er_state::mechanic_state_v2::MechanicStateStoreV2;
use er_state::{current_reward_run::CurrentRewardRunV1, m9e_state_v6::GameStateV6};
use er_types::battle_model::StatusKind;
use er_types::{BehaviorSourceId, SafeU53};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;
static CLOSURE: OnceLock<Result<Value, RollError>> = OnceLock::new();
fn closure() -> Result<&'static Value, RollError> {
    CLOSURE
        .get_or_init(|| {
            serde_json::from_str(include_str!("current_reward_first_closure.json"))
                .map_err(|_| RollError::Invalid)
        })
        .as_ref()
        .map_err(|e| *e)
}
fn number(v: &Value) -> Result<u64, RollError> {
    v.as_u64().ok_or(RollError::Invalid)
}
fn rows(v: &Value) -> Result<&[Value], RollError> {
    v.as_array().map(Vec::as_slice).ok_or(RollError::Invalid)
}

pub(crate) struct FirstRewardPool {
    rng: RngRuntime,
    thresholds: [Vec<(u32, usize)>; 5],
    weights: [Vec<u32>; 5],
    attack_types: Vec<Vec<u8>>,
}
impl FirstRewardPool {
    pub(crate) fn from_state(
        state: &GameStateV6,
        content: &PreparedGameContentV2,
        owned: &CurrentRewardRunV1,
    ) -> Result<Self, RollError> {
        crate::current_source_progression::current_source_progression(state, content)
            .map_err(|_| RollError::UnresolvedSource)?;
        let run = state.active_run.as_ref().ok_or(RollError::Invalid)?;
        if run.party.len() != 1
            || run.wave.get().get() != 1
            || *owned != CurrentRewardRunV1::fresh_ordinary_with_startup_map()
        {
            return Err(RollError::UnresolvedSource);
        }
        let p = &run.party[0];
        if p.hp == 0
            || p.fainted
            || p.status.kind != StatusKind::None
            || p.mechanics != MechanicStateStoreV2::default()
            || !p.held_items.is_empty()
            || p.fusion.is_some()
            || p.tera_type.is_some()
            || p.shiny
            || p.variant != 0
        {
            return Err(RollError::UnresolvedSource);
        }
        let source = closure()?;
        if source["source_sha"] != "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7" {
            return Err(RollError::Invalid);
        }
        let binder = &source["binder"];
        let party = rows(&binder["party"])?;
        if party.len() != 1 {
            return Err(RollError::Invalid);
        }
        let captured = &party[0];
        if p.species_id.get().get() != number(&captured["species"])?
            || u64::from(p.form_index) != number(&captured["form"])?
            || p.level == 0
            || u64::from(p.level) > number(&captured["level_cap"])?
            || captured["form_key"] != ""
            || captured["forms"]["present"] != false
            || !rows(&captured["forms"]["rows"])?.is_empty()
            || !rows(&captured["held"])?.is_empty()
        {
            return Err(RollError::UnresolvedSource);
        }
        let mode = &binder["mode"];
        if mode["classic"] != true
            || !rows(&mode["challenges"])?.is_empty()
            || [
                "daily",
                "fun",
                "coop",
                "spliced_only",
                "fresh_start",
                "fun_mega",
            ]
            .iter()
            .any(|k| mode[*k] != false)
        {
            return Err(RollError::UnresolvedSource);
        }
        // Current raw Bulbasaur sources have no unlocked orb/weather/terrain/
        // temporary-luck/Moody families. Do not infer unlocked from raw innate ID.
        let targeting =
            er_battle::current_target_execution::CurrentTargetExecution::from_state(state)
                .map_err(|_| RollError::UnresolvedSource)?;
        let abilities = targeting
            .ability_sources(run, p)
            .map_err(|_| RollError::UnresolvedSource)?;
        let mut active = false;
        for source in abilities {
            match source {
                BehaviorSourceId::ActiveAbility { numeric_id } if numeric_id.get() == 5006 => {
                    active = true
                }
                BehaviorSourceId::PassiveAbility { numeric_id }
                    if matches!(numeric_id.get(), 65 | 47) => {}
                _ => return Err(RollError::UnresolvedSource),
            }
        }
        if !active {
            return Err(RollError::UnresolvedSource);
        }
        let moves = rows(&captured["move_closure"])?;
        let mut pp = Vec::new();
        let mut attack_types = Vec::new();
        let mut move_ids = Vec::new();
        let mut inaccurate = false;
        let mut sound = false;
        for movement in p.moves.iter().flatten() {
            if movement.pp_ups != 0 || movement.max_pp_override.is_some() {
                return Err(RollError::UnresolvedSource);
            }
            let id = movement.move_id.get().get();
            let row = moves
                .iter()
                .find(|r| r["id"].as_u64() == Some(id))
                .ok_or(RollError::UnresolvedSource)?;
            if !rows(&row["variable_types"])?.is_empty() {
                return Err(RollError::UnresolvedSource);
            }
            let total = u32::try_from(number(&row["pp"])?).map_err(|_| RollError::Invalid)?;
            if u32::from(movement.pp_used) > total {
                return Err(RollError::Invalid);
            }
            pp.push(common::MovePp {
                total,
                used: u32::from(movement.pp_used),
            });
            if row["attack"] == true {
                attack_types.push(vec![
                    u8::try_from(number(&row["type"])?).map_err(|_| RollError::Invalid)?,
                ]);
            }
            let accuracy = row["accuracy"].as_i64().ok_or(RollError::Invalid)?;
            inaccurate |= (0..100).contains(&accuracy);
            sound |= row["sound"] == true;
            move_ids.push(id);
        }
        if move_ids.is_empty() {
            return Err(RollError::UnresolvedSource);
        }
        let level_rows = rows(&captured["level_rows"])?;
        let memory = level_rows
            .iter()
            .filter(|r| {
                r[0].as_u64()
                    .is_some_and(|level| level <= u64::from(p.level))
                    && r[1].as_u64().is_some_and(|id| !move_ids.contains(&id))
            })
            .count();
        let evolutions = rows(&captured["evolutions"]["rows"])?;
        // Complete initialized registry edges qualify null/NONE absence. Never
        // replace a sampled null generator by an unconditional empty table.
        if evolutions
            .iter()
            .any(|e| !e["item"].is_null() && e["item"].as_u64() != Some(0))
        {
            return Err(RollError::UnresolvedSource);
        }
        let common = common::Context {
            party: vec![common::PartyMember {
                hp: p.hp,
                max_hp: p.max_hp,
                fainted: p.fainted,
                has_leppa: false,
                moves: pp,
            }],
            classic: true,
            coop: false,
            forced_doubles: false,
            forced_triples: false,
            wave: 1,
            pokeballs: u32::from(owned.balls[0]),
            maximum_pokeballs: 99,
            lures: vec![],
        };
        let great = great::Context {
            common: &common,
            party: vec![great::PartyFacts {
                has_status: false,
                held_status_matches: false,
                level: p.level,
                learnable_level_moves: memory,
                held_blunder_policy: false,
                inaccurate_move: inaccurate,
                unlocked_magic_guard: false,
                excluded_tera_species: false,
                fused: false,
            }],
            great_balls: u32::from(owned.balls[1]),
            daily: false,
            fun: false,
            spliced_only: false,
            event_fusions_boosted: false,
            reroll_count: 0,
        };
        // All source orb beneficiary IDs are absent in this exact ability and
        // complete move closure, so canSetStatus is not used as an admission fact.
        if move_ids.iter().any(|id| matches!(*id, 263 | 375)) {
            return Err(RollError::UnresolvedSource);
        }
        let ultra = ultra::Context {
            common: &common,
            party: vec![ultra::PartyFacts {
                gmax: false,
                species_or_fusion_can_evolve: !evolutions.is_empty(),
                held_eviolite: false,
                leek_species_or_fusion: false,
                held_species_crit_booster: false,
                held_orb: false,
                status_moves: false,
                can_toxic: false,
                can_burn: false,
                ice_type: false,
                orb_general_ability: false,
                poison_specific_ability: false,
                flare_specific_ability: false,
                mystical_rock_at_max: false,
                weather_terrain_ability: false,
                // Complete admitted move closure contains Grassy Terrain580 as its only weather/terrain move.
                weather_terrain_move: move_ids.contains(&580),
                sound_move: sound,
            }],
            held_ids: BTreeSet::new(),
            ultra_balls: u32::from(owned.balls[2]),
            daily: false,
            fun: false,
            fun_mega: false,
            fresh_start_challenge: false,
            eviolite_unlocked: binder["unlocks"]["eviolite"]
                .as_bool()
                .ok_or(RollError::Invalid)?,
        };
        let high = high::Context {
            common: &common,
            rogue_balls: u32::from(owned.balls[3]),
            master_balls: u32::from(owned.balls[4]),
            mystery_last_legal_wave: 180,
            has_mystery_rate_modifier: false,
            has_booster_energy: false,
            unlocked_protosynthesis_or_quark: false,
            has_damage_calculator: false,
            daily: false,
            fun: false,
            fun_mega: false,
            endless: false,
            spliced_only: false,
            event_fusions_boosted: false,
            unfused_members: 1,
            fresh_start_challenge: false,
            mini_black_hole_unlocked: binder["unlocks"]["mini_black_hole"]
                .as_bool()
                .ok_or(RollError::Invalid)?,
            reroll_count: 0,
        };
        let mut values = BTreeMap::new();
        for (id, value) in common::IDS.into_iter().zip(common::weights(&common)?) {
            values.insert(id, value);
        }
        for (id, value) in great::IDS.into_iter().zip(great::weights(&great)?) {
            values.insert(id, value);
        }
        for id in ultra::IDS {
            values.insert(id, ultra::weight(id, &ultra)?);
        }
        for (id, value) in high::ROGUE_IDS.into_iter().zip(high::rogue(&high)?) {
            values.insert(id, value);
        }
        for (id, value) in high::MASTER_IDS.into_iter().zip(high::master(&high)?) {
            values.insert(id, value);
        }
        let mut source_pools = super::current_reward_pool::base();
        super::current_reward_tuning::apply(&mut source_pools)?;
        let mut weights: [Vec<u32>; 5] = std::array::from_fn(|_| Vec::new());
        for (tier, source_rows) in source_pools.into_iter().enumerate() {
            for super::current_reward_tuning::Row {
                weight,
                payload: (),
                ..
            } in source_rows
            {
                weights[tier].push(match weight {
                    Weight::Fixed(n) => n,
                    Weight::SourcePredicate(id) => {
                        *values.get(id).ok_or(RollError::UnresolvedSource)?
                    }
                });
            }
        }
        let seed = shift_char_codes(&run.seed, 1).map_err(|_| RollError::Invalid)?;
        let reset_run = RngRuntime::from_run_seed(&seed).run_state();
        let battle = run.battle.as_ref().ok_or(RollError::Invalid)?;
        // updateSeed replaces the run stream only. Every audit entry retains
        // the actual unchanged battle stream instead of claiming its absence.
        let rng = RngRuntime::from_states(reset_run, Some(battle.battle_rng.clone()))
            .map_err(|_| RollError::Invalid)?;
        Ok(Self {
            rng,
            thresholds: std::array::from_fn(|_| Vec::new()),
            weights,
            attack_types,
        })
    }
    pub(crate) fn state(&self) -> er_rng::phaser::PhaserRdgState {
        self.rng.run_state().rdg
    }
    pub(crate) fn audit(&self) -> Vec<RngDraw> {
        self.rng.audit_entries().to_vec()
    }
    pub(crate) fn regenerate(&mut self, budget: &mut usize) -> Result<(), RollError> {
        if self.thresholds.iter().any(|rows| !rows.is_empty()) {
            return Err(RollError::Invalid);
        }
        for row in super::current_reward_metadata::rows()? {
            if row.generator {
                self.generate(row.tier as u16, row.index, budget)?;
            }
            let weight = *self
                .weights
                .get(row.tier)
                .and_then(|w| w.get(row.index))
                .ok_or(RollError::Invalid)?;
            if weight > 0 {
                let total = self.thresholds[row.tier]
                    .last()
                    .map_or(0_u32, |r| r.0)
                    .checked_add(weight)
                    .ok_or(RollError::Invalid)?;
                self.thresholds[row.tier].push((total, row.index));
            }
        }
        Ok(())
    }
}
impl SourcePool for FirstRewardPool {
    fn has_tier(&self, tier: u16) -> bool {
        usize::from(tier) < 5 && !self.weights[usize::from(tier)].is_empty()
    }
    fn thresholds(&self, tier: u16) -> Result<Vec<(u32, usize)>, RollError> {
        self.thresholds
            .get(usize::from(tier))
            .cloned()
            .ok_or(RollError::Invalid)
    }
    fn party_luck(&self) -> Result<u8, RollError> {
        Ok(0)
    }
    fn draw(&mut self, range: u32, minimum: u32) -> Result<u32, RollError> {
        let cardinality = SafeU53::new(u64::from(range)).map_err(|_| RollError::Invalid)?;
        let minimum = SafeU53::new(u64::from(minimum)).map_err(|_| RollError::Invalid)?;
        Ok(self
            .rng
            .run_rand_seed_int(
                cardinality,
                minimum,
                RngReason::RandomSelector,
                RngCallsiteId::current_reward_generation(),
            )
            .map_err(|_| RollError::Invalid)?
            .get() as u32)
    }
    fn singleton(&mut self, minimum: u32) -> Result<(), RollError> {
        self.draw(1, minimum).map(|_| ())
    }
    fn generate(
        &mut self,
        tier: u16,
        index: usize,
        budget: &mut usize,
    ) -> Result<Option<Offer>, RollError> {
        let row = super::current_reward_metadata::rows()?
            .iter()
            .find(|r| r.tier == usize::from(tier) && r.index == index)
            .ok_or(RollError::Invalid)?
            .clone();
        if !row.generator {
            return Ok(Some(super::current_reward_metadata::offer(&row, None)?));
        }
        let args = match row.id.as_str() {
            "TEMP_STAT_STAGE_BOOSTER" | "BERRY" | "BASE_STAT_BOOSTER" | "MINT" => Some(
                super::current_reward_generators::simple(&row.id, self, budget)?,
            ),
            "ATTACK_TYPE_BOOSTER" => {
                let types = self.attack_types.clone();
                super::current_reward_generators::attack_type(&types, self, budget)?
            }
            "SPECIES_STAT_BOOSTER" | "RARE_SPECIES_STAT_BOOSTER" => {
                // Bulbasaur is absent from every species-item membership, with
                // either value of the new-content flag. Assert both closures;
                // both paths terminate before drawing for this admitted species.
                let members = [super::current_reward_generators::SpeciesMember {
                    species: 1,
                    fusion_species: None,
                    held_contains: vec![],
                }];
                let rare = row.id == "RARE_SPECIES_STAT_BOOSTER";
                let left = super::current_reward_generators::species_item(
                    rare, false, &members, self, budget,
                )?;
                let right = super::current_reward_generators::species_item(
                    rare, true, &members, self, budget,
                )?;
                if left.is_some() || right.is_some() {
                    return Err(RollError::Invalid);
                }
                None
            }
            "EVOLUTION_ITEM" | "RARE_EVOLUTION_ITEM" => {
                super::current_reward_generators::evolution_item(
                    row.id == "RARE_EVOLUTION_ITEM",
                    &[],
                    self,
                    budget,
                )?
            }
            // from_state checked the complete initialized form registry absence.
            "FORM_CHANGE_ITEM" | "RARE_FORM_CHANGE_ITEM" => None,
            // Explicit fresh Map-only ownership excludes the Tera access orb.
            "TERA_SHARD" => super::current_reward_generators::tera(false, &[], self, budget)?,
            _ => return Err(RollError::UnresolvedSource),
        };
        args.map(|args| super::current_reward_metadata::offer(&row, Some(args)))
            .transpose()
    }
    fn appearance_gate(&mut self, _offer: &Offer, _budget: &mut usize) -> Result<bool, RollError> {
        // Exact first species closure has no form entries: no constructed
        // FormChangeItem can reach this callback. Other classes are source true.
        Ok(true)
    }
}
