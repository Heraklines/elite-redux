//! Source oracle run34694502130/a1cdc06f, two identical15152B exports
//! SHA6a7b0011527ef729bb366918b980aa56668bc9de0517cfe6dc727a73eeb3dc24.
//! These are scoped algorithm parity witnesses, not a complete reward owner.
#[allow(dead_code)]
#[path = "../src/current_reward_roll.rs"]
mod current_reward_roll;
#[allow(dead_code)]
#[path = "../src/current_reward_common.rs"]
mod current_reward_common;
#[allow(dead_code)]
#[path = "../src/current_reward_generators.rs"]
mod current_reward_generators;
#[allow(dead_code)]
#[path = "../src/current_reward_pool.rs"]
mod current_reward_pool;
#[allow(dead_code)]
#[path = "../src/current_reward_tuning.rs"]
mod current_reward_tuning;
#[allow(dead_code)]
#[path = "../src/current_reward_great.rs"]
mod current_reward_great;
#[allow(dead_code)]
#[path = "../src/current_reward_ultra.rs"]
mod current_reward_ultra;
#[allow(dead_code)]
#[path = "../src/current_reward_high.rs"]
mod current_reward_high;
use current_reward_roll::{Offer, PregenArgs, RollError, SourcePool};
use er_rng::phaser::{PhaserRdg, PhaserRdgState};
use er_types::SafeU53;

struct OraclePool { rng: PhaserRdg, draws: Vec<(u32,u32,u32)> }
impl OraclePool {
    fn at(state: &str) -> Result<Self, RollError> {
        let state=PhaserRdgState::from_state_string(state).map_err(|_| RollError::Invalid)?;
        Ok(Self {rng:PhaserRdg::from_state(&state).map_err(|_| RollError::Invalid)?,draws:Vec::new()})
    }
}
impl SourcePool for OraclePool {
    fn has_tier(&self,tier:u16)->bool {tier<5}
    fn party_luck(&self)->Result<u8,RollError>{Ok(0)}
    fn draw(&mut self,range:u32,minimum:u32)->Result<u32,RollError>{
        let lo=SafeU53::new(u64::from(minimum)).map_err(|_|RollError::Invalid)?;
        let hi=SafeU53::new(u64::from(minimum)+u64::from(range)-1).map_err(|_|RollError::Invalid)?;
        let value=self.rng.integer_in_range(lo,hi).map_err(|_|RollError::Invalid)?.get() as u32;
        self.draws.push((minimum,minimum+range-1,value));Ok(value)
    }
    fn thresholds(&self,tier:u16)->Result<Vec<(u32,usize)>,RollError>{
        if tier!=0{return Err(RollError::UnresolvedSource);}
        // Actual common predicates for healthy initialized Bulbasaur, no usedPP,
        // Map only, ordinary Classic wave1, below the Pokeball cap.
        let context=current_reward_common::Context {
            party:vec![current_reward_common::PartyMember{hp:20,max_hp:20,fainted:false,has_leppa:false,moves:vec![]}],
            classic:true,coop:false,forced_doubles:false,forced_triples:false,wave:1,
            pokeballs:5,maximum_pokeballs:99,lures:vec![],
        };
        let mut sum=0;
        Ok(current_reward_common::weights(&context)?.into_iter().enumerate().filter_map(|(index,weight)|{
            if weight==0{None}else{sum+=weight;Some((sum,index))}
        }).collect())
    }
    fn generate(&mut self,_tier:u16,index:usize,_budget:&mut usize)->Result<Option<Offer>,RollError>{
        let (id,name,group)=match index {
            0=>("POKEBALL","Poké Ball",None),1=>("RARE_CANDY","Rare Candy",None),
            2=>("POTION","Potion",None),3=>("SUPER_POTION","Super Potion",None),
            4=>("ETHER","Ether",None),5=>("MAX_ETHER","Max Ether",None),
            6=>("LURE","Lure",Some("lure")),9=>("TM_CASE","TM Case",None),
            _=>return Err(RollError::UnresolvedSource),
        };
        Ok(Some(Offer{id:id.into(),name:name.into(),group:group.map(str::to_owned),tier:0,upgrade_count:0,pregen_args:None}))
    }
    fn appearance_gate(&mut self,_offer:&Offer,_budget:&mut usize)->Result<bool,RollError>{Ok(true)}
}

#[test]
fn qualified_initial_regeneration_stream_matches_actual_source()->Result<(),RollError>{
    let mut pool=OraclePool::at("!rnd,1,0.7569267088547349,0.8554245429113507,0.5650219917297363")?;
    let mut budget=4096;
    assert_eq!(current_reward_generators::simple("TEMP_STAT_STAGE_BOOSTER",&mut pool,&mut budget)?,PregenArgs::TemporaryStat{stat:3});
    assert_eq!(current_reward_generators::simple("BERRY",&mut pool,&mut budget)?,PregenArgs::Berry{kind:0});
    assert_eq!(current_reward_generators::simple("BASE_STAT_BOOSTER",&mut pool,&mut budget)?,PregenArgs::BaseStat{stat:5});
    assert_eq!(current_reward_generators::simple("MINT",&mut pool,&mut budget)?,PregenArgs::Mint{nature:22});
    assert_eq!(current_reward_generators::attack_type(&[vec![11]],&mut pool,&mut budget)?,Some(PregenArgs::AttackType{kind:11}));
    assert_eq!(pool.draws,vec![(1,6,3),(0,11,0),(0,5,5),(0,24,22)]);
    assert_eq!(pool.rng.state().state_string,"!rnd,2058891,0.23871867964044213,0.8970677766483277,0.6264764200896025");
    Ok(())
}

#[test]
fn qualified_common_roll_stream_matches_actual_source()->Result<(),RollError>{
    let mut pool=OraclePool::at("!rnd,2058891,0.23871867964044213,0.8970677766483277,0.6264764200896025")?;
    let offers=current_reward_roll::three_options(&mut pool)?;
    assert_eq!(offers.iter().map(|offer|offer.id.as_str()).collect::<Vec<_>>(),vec!["TM_CASE","LURE","RARE_CANDY"]);
    assert!(offers.iter().all(|offer|offer.tier==0&&offer.upgrade_count==0&&offer.pregen_args.is_none()));
    assert_eq!(pool.draws.len(),11);
    assert_eq!(pool.rng.state().state_string,"!rnd,337008,0.9894045835826546,0.36157823260873556,0.12534510577097535");
    Ok(())
}

#[test]
fn qualified_complete_tuned_pool_metadata_matches_actual_source()->Result<(),RollError>{
    let mut pools=current_reward_pool::base();
    assert_eq!(pools.iter().map(Vec::len).sum::<usize>(),129);
    current_reward_tuning::apply(&mut pools)?;
    let actual=pools.iter().enumerate().flat_map(|(tier,rows)|rows.iter().enumerate().map(move |(index,row)|{
        match row.weight {
            current_reward_tuning::Weight::Fixed(value)=>(tier,index,row.id,false,Some(value)),
            current_reward_tuning::Weight::SourcePredicate(id)=>{assert_eq!(id,row.id);(tier,index,row.id,true,None)},
        }
    })).collect::<Vec<_>>();
    let expected=vec![
        (0, 0, "POKEBALL", true, None),
        (0, 1, "RARE_CANDY", false, Some(2)),
        (0, 2, "POTION", true, None),
        (0, 3, "SUPER_POTION", true, None),
        (0, 4, "ETHER", true, None),
        (0, 5, "MAX_ETHER", true, None),
        (0, 6, "LURE", true, None),
        (0, 7, "TEMP_STAT_STAGE_BOOSTER", false, Some(4)),
        (0, 8, "BERRY", false, Some(2)),
        (0, 9, "TM_CASE", false, Some(2)),
        (1, 0, "GREAT_BALL", true, None),
        (1, 1, "PP_UP", false, Some(2)),
        (1, 2, "FULL_HEAL", true, None),
        (1, 3, "REVIVE", true, None),
        (1, 4, "MAX_REVIVE", true, None),
        (1, 5, "SACRED_ASH", true, None),
        (1, 6, "HYPER_POTION", true, None),
        (1, 7, "MAX_POTION", true, None),
        (1, 8, "FULL_RESTORE", true, None),
        (1, 9, "ELIXIR", true, None),
        (1, 10, "MAX_ELIXIR", true, None),
        (1, 11, "DIRE_HIT", false, Some(4)),
        (1, 12, "SUPER_LURE", true, None),
        (1, 13, "NUGGET", false, Some(0)),
        (1, 14, "SPECIES_STAT_BOOSTER", false, Some(2)),
        (1, 15, "EVOLUTION_ITEM", true, None),
        (1, 16, "ER_UPGRADED_MAP", true, None),
        (1, 17, "SOOTHE_BELL", false, Some(2)),
        (1, 18, "MEMORY_MUSHROOM", true, None),
        (1, 19, "ER_ABILITY_CAPSULE", false, Some(2)),
        (1, 20, "ER_EJECT_BUTTON", false, Some(0)),
        (1, 21, "ER_EJECT_PACK", false, Some(0)),
        (1, 22, "ER_SHED_SHELL", false, Some(0)),
        (1, 23, "ER_ADRENALINE_ORB", false, Some(0)),
        (1, 24, "ER_ROOM_SERVICE", false, Some(0)),
        (1, 25, "ER_MENTAL_HERB", false, Some(1)),
        (1, 26, "ER_BLUNDER_POLICY", false, Some(0)),
        (1, 27, "ER_STICKY_BARB", false, Some(0)),
        (1, 28, "BASE_STAT_BOOSTER", false, Some(3)),
        (1, 29, "TERA_SHARD", true, None),
        (1, 30, "VOUCHER", true, None),
        (2, 0, "ULTRA_BALL", true, None),
        (2, 1, "MAX_LURE", true, None),
        (2, 2, "BIG_NUGGET", true, None),
        (2, 3, "PP_MAX", false, Some(3)),
        (2, 4, "MINT", false, Some(4)),
        (2, 5, "RARE_EVOLUTION_ITEM", false, Some(5)),
        (2, 6, "FORM_CHANGE_ITEM", false, Some(5)),
        (2, 7, "AMULET_COIN", false, Some(2)),
        (2, 8, "EVIOLITE", true, None),
        (2, 9, "RARE_SPECIES_STAT_BOOSTER", false, Some(12)),
        (2, 10, "LEEK", true, None),
        (2, 11, "TOXIC_ORB", true, None),
        (2, 12, "FLAME_ORB", true, None),
        (2, 13, "FROSTBITE_ORB", true, None),
        (2, 14, "MYSTICAL_ROCK", true, None),
        (2, 15, "REVIVER_SEED", false, Some(4)),
        (2, 16, "CANDY_JAR", true, None),
        (2, 17, "ATTACK_TYPE_BOOSTER", false, Some(9)),
        (2, 18, "RARER_CANDY", false, Some(4)),
        (2, 19, "GOLDEN_PUNCH", true, None),
        (2, 20, "IV_SCANNER", true, None),
        (2, 21, "EXP_CHARM", true, None),
        (2, 22, "EXP_SHARE", true, None),
        (2, 23, "TERA_ORB", true, None),
        (2, 24, "QUICK_CLAW", false, Some(3)),
        (2, 25, "WIDE_LENS", false, Some(7)),
        (2, 26, "ER_CHILI_SAMPLE", false, Some(4)),
        (2, 27, "ER_COPPER_ROD", false, Some(4)),
        (2, 28, "ER_RUSTY_CLAW", false, Some(4)),
        (2, 29, "ER_SPIKED_KNUCKLES", false, Some(4)),
        (2, 30, "ER_LOADED_DICE", false, Some(4)),
        (2, 31, "ER_LUCKY_HEART", false, Some(4)),
        (2, 32, "ER_DEX_NAV", false, Some(6)),
        (2, 33, "ER_POWER_HERB", false, Some(4)),
        (2, 34, "ER_LEARNERS_SHROOM", false, Some(4)),
        (2, 35, "ER_GREATER_ABILITY_CAPSULE", false, Some(2)),
        (2, 36, "MOVE_RANDOMIZER", false, Some(4)),
        (2, 37, "ER_EXPERT_BELT", false, Some(3)),
        (2, 38, "ER_HEAVY_DUTY_BOOTS", false, Some(1)),
        (2, 39, "ER_AIR_BALLOON", false, Some(1)),
        (2, 40, "ER_SAFETY_GOGGLES", false, Some(1)),
        (2, 41, "ER_COVERT_CLOAK", false, Some(0)),
        (2, 42, "ER_CLEAR_AMULET", false, Some(1)),
        (2, 43, "ER_ABILITY_SHIELD", false, Some(1)),
        (2, 44, "ER_THROAT_SPRAY", false, Some(0)),
        (2, 45, "ER_PUNCHING_GLOVE", false, Some(3)),
        (2, 46, "ER_MUSCLE_BAND", true, None),
        (2, 47, "ER_WISE_GLASSES", true, None),
        (2, 48, "ER_ZOOM_LENS", false, Some(1)),
        (2, 49, "ER_IRON_BALL", false, Some(0)),
        (2, 50, "ER_FLOAT_STONE", false, Some(1)),
        (2, 51, "ER_SMOKE_BALL", false, Some(0)),
        (2, 52, "ER_UTILITY_UMBRELLA", false, Some(0)),
        (2, 53, "ABILITY_RANDOMIZER", false, Some(4)),
        (2, 54, "BERRY_POUCH", false, Some(4)),
        (2, 55, "DNA_SPLICERS", false, Some(2)),
        (3, 0, "ROGUE_BALL", true, None),
        (3, 1, "RELIC_GOLD", true, None),
        (3, 2, "LEFTOVERS", false, Some(3)),
        (3, 3, "SHELL_BELL", false, Some(3)),
        (3, 4, "GRIP_CLAW", false, Some(5)),
        (3, 5, "SCOPE_LENS", false, Some(4)),
        (3, 6, "BATON", false, Some(2)),
        (3, 7, "SOUL_DEW", false, Some(7)),
        (3, 8, "CATCHING_CHARM", true, None),
        (3, 9, "ABILITY_CHARM", true, None),
        (3, 10, "MOVE_SLOT_EXPANDER", false, Some(4)),
        (3, 11, "ER_GREATER_MOVE_RANDOMIZER", true, None),
        (3, 12, "ER_OMNI_GEM", false, Some(3)),
        (3, 13, "ER_METRONOME_ITEM", false, Some(3)),
        (3, 14, "ER_BOOSTER_ENERGY", true, None),
        (3, 15, "DAMAGE_CALCULATOR", true, None),
        (3, 16, "FOCUS_BAND", false, Some(5)),
        (3, 17, "KINGS_ROCK", false, Some(3)),
        (3, 18, "LOCK_CAPSULE", true, None),
        (3, 19, "SUPER_EXP_CHARM", true, None),
        (3, 20, "RARE_FORM_CHANGE_ITEM", true, None),
        (3, 21, "MEGA_BRACELET", true, None),
        (3, 22, "DYNAMAX_BAND", true, None),
        (3, 23, "VOUCHER_PLUS", true, None),
        (4, 0, "MASTER_BALL", true, None),
        (4, 1, "SHINY_CHARM", false, Some(14)),
        (4, 2, "HEALING_CHARM", false, Some(18)),
        (4, 3, "MULTI_LENS", false, Some(18)),
        (4, 4, "VOUCHER_PREMIUM", true, None),
        (4, 5, "MINI_BLACK_HOLE", true, None),
        (4, 6, "ER_GREATER_ABILITY_RANDOMIZER", false, Some(2)),
    ];
    assert_eq!(actual,expected);
    Ok(())
}
