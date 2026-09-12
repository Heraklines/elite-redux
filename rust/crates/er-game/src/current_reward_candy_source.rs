//! Narrow source399d Rare Candy arithmetic and empty-child proof.
//! The caller must own the reward offer, UTC responses and account transaction.
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error as E;
use er_state::m7_state::PokemonStateV5;

/// Exact capped-positive Pokemon branch; candy progress still receives full6.
pub(crate) fn friendship(before: u16) -> Result<u16,E> {
    if before>255 {return Err(E::Action);}
    Ok(if before.saturating_add(6)>200 {before.max(200)} else {before+6})
}

/// Positively represented no-booster Candy parent, with actual empty learn and
/// evolution results. It does not call an XP award or a Faint owner.
pub(crate) fn apply_level(
    before: &PokemonStateV5,
    content: &PreparedGameContentV2,
) -> Result<PokemonStateV5,E> {
    // First closed cohort: ordinary initialized base Kanto trio, non-fusion,
    // no held/temporary/permanent stat modifiers and one source Candy level.
    // The range allows the genuine wave-cap crossing10->11.
    if !matches!(before.species_id.get().get(),1|4|7) || before.form_index!=0
        || !(1..=10).contains(&before.level) || before.fusion.is_some()
        || !before.held_items.is_empty() || before.hp==0 || before.fainted
        || before.mechanics!=er_state::mechanic_state_v2::MechanicStateStoreV2::default()
        || before.status.kind!=er_types::battle_model::StatusKind::None
        || before.tera_type.is_some() || before.max_hp!=before.stats.hp
    {return Err(E::Action);}
    let bonuses=&before.permanent_bonuses;
    if [bonuses.hp,bonuses.attack,bonuses.defense,bonuses.special_attack,bonuses.special_defense,bonuses.speed]
        .into_iter().any(|value|value!=0) {return Err(E::Action);}
    let mut after=before.clone();
    after.level=before.level.checked_add(1).ok_or(E::Action)?;
    after.friendship=friendship(before.friendship)?;
    let definition=content.progression.species(after.species_id,after.form_index).ok_or(E::Action)?;
    let growth=content.progression.growth_rate(definition.growth_rate).ok_or(E::Action)?;
    // Source getMaxExpLevel(true) is MAX_SAFE_INTEGER in the owned no-override
    // configuration, so every admitted u16 level writes total growth EXP.
    after.experience=er_progression::progression::current_growth_experience_for_level(growth,after.level)
        .map_err(|_|E::Action)?;
    empty_children(&after,before.level,content)?;
    let species=content.battle.species(after.species_id).map_err(|_|E::Action)?;
    let form=content.battle.form(&er_types::FormId::parse(format!("{}:0",after.species_id.get().get()))
        .map_err(|_|E::Action)?).map_err(|_|E::Action)?;
    if form.species!=after.species_id{return Err(E::Action);}
    let nature=content.progression.pack().natures.iter().find(|n|n.id==after.effective_nature).ok_or(E::Action)?;
    let stats=er_progression::current_stats::calculate_current_unmodified_stats(
        &after,form.stat_override.unwrap_or(species.base_stats),nature).map_err(|_|E::Action)?;
    after.hp=er_progression::current_stats::current_hp_after_stat_calculation(after.hp,after.max_hp,stats.hp)
        .map_err(|_|E::Action)?;
    after.max_hp=stats.hp;after.stats=stats;
    Ok(after)
}

pub(crate) fn empty_children(pokemon:&PokemonStateV5,previous:u16,content:&PreparedGameContentV2)->Result<(),E>{

    let definition=content.progression.species(pokemon.species_id,pokemon.form_index).ok_or(E::Action)?;
    if previous<100 && definition.level_moves.iter().any(|row|
        row.level>0 && i32::from(row.level)>i32::from(previous) && i32::from(row.level)<=i32::from(pokemon.level))
    {return Err(E::Domain("Rare Candy retains unresolved LearnMoveBatch children".into()));}
    if pokemon.pause_evolutions{return Ok(());}
    for id in &definition.evolutions {
        let evolution=content.progression.evolution(*id).ok_or(E::Action)?;
        if evolution.source_species!=pokemon.species_id{return Err(E::Action);}
        if evolution.source_form.is_some_and(|form|form!=pokemon.form_index){continue;}
        // Source evaluates condition callbacks before final item equality. An
        // item edge cannot be silently skipped before that owned evaluation.
        if evolution.consume_item.is_some(){return Err(E::Domain("Rare Candy item evolution condition ordering is unresolved".into()));}
        if condition(&evolution.condition,pokemon)? {
            return Err(E::Domain("Rare Candy retains unresolved Evolution children".into()));
        }
    }
    Ok(())
}
fn condition(value:&er_progression::content_v2::EvolutionConditionV2,pokemon:&PokemonStateV5)->Result<bool,E>{
    use er_progression::content_v2::EvolutionConditionV2 as C;
    match value{
        C::Always=>Ok(true),C::MinimumLevel(level)=>Ok(pokemon.level>=*level),
        C::MinimumFriendship(value)=>Ok(pokemon.friendship>=*value),
        C::KnownMove(id)=>Ok(pokemon.moves.iter().flatten().any(|slot|slot.move_id==*id)),
        C::All(values)=>{for value in values{if !condition(value,pokemon)?{return Ok(false);}}Ok(true)},
        // Unsupported source time/RNG/form predicates never imply no evolution.
        _=>Err(E::Domain("Rare Candy evolution predicate is unresolved".into())),
    }
}