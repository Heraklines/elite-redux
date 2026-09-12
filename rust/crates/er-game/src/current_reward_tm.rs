//! Content-closed initial TM Case learning. Compatibility is a complete source
//! registry, not a sampled move. No client effect or replacement slot is trusted.
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error as Error;
use er_state::current_achievement_tracker::CurrentAchievementTrackerV1 as Tracker;
use er_state::current_reward_selection::CurrentRewardSelectionV1 as Selection;
use er_state::current_reward_tm::{
    CurrentRewardTmPhaseV1 as Phase, CurrentRewardTmV1 as Tm, CurrentUsedTmsV1 as History,
};
use er_state::m7_state::PokemonStateV5;
use er_state::m9e_state_v6::GameStateV6;
use er_types::SafeU53;
use er_types::battle_ids::{MoveId, PokemonId};
use er_types::battle_model::MoveSlotState;
use serde::Deserialize;
use std::sync::OnceLock;
fn invalid() -> Error {
    Error::Action
}
#[derive(Deserialize)]
struct Closure {
    source_sha: String,
    species: u64,
    form: u16,
    tm: TmClosure,
}
#[derive(Deserialize)]
struct TmClosure {
    omniform: bool,
    max_moves: u8,
    compatible: Vec<u64>,
    used: UsedClosure,
}
#[derive(Deserialize)]
struct UsedClosure {
    own: bool,
    defined: bool,
    value: serde_json::Value,
}
static CLOSURE: OnceLock<Option<Closure>> = OnceLock::new();
fn closure() -> Result<&'static Closure, Error> {
    let closure = CLOSURE
        .get_or_init(|| serde_json::from_str(include_str!("current_reward_tm_closure.json")).ok())
        .as_ref()
        .ok_or_else(invalid)?;
    if closure.source_sha != "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7"
        || closure.species != 1
        || closure.form != 0
        || closure.tm.omniform
        || closure.tm.max_moves != 4
        || !closure.tm.used.own
        || closure.tm.used.defined
        || !closure.tm.used.value.is_null()
        || closure.tm.compatible.len() != 37
    {
        return Err(invalid());
    }
    Ok(closure)
}
pub(crate) fn history(state: &GameStateV6, holder: PokemonId) -> Result<&History, Error> {
    state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .and_then(|o| o.source_progression.as_ref())
        .and_then(|s| s.party.iter().find(|p| p.pokemon == holder))
        .and_then(|p| p.used_tms.as_ref())
        .ok_or_else(invalid)
}
pub(crate) fn set_history(
    state: &mut GameStateV6,
    holder: PokemonId,
    value: History,
) -> Result<(), Error> {
    state
        .current_battle_participation
        .as_mut()
        .and_then(|p| p.experience.as_mut())
        .and_then(|o| o.source_progression.as_mut())
        .and_then(|s| s.party.iter_mut().find(|p| p.pokemon == holder))
        .ok_or_else(invalid)?
        .used_tms = Some(value);
    Ok(())
}
pub(crate) fn available(pokemon: &PokemonStateV5) -> Result<Vec<MoveId>, Error> {
    let source = closure()?;
    if pokemon.species_id.get().get() != source.species
        || pokemon.form_index != source.form
        || pokemon.fusion.is_some()
        || pokemon.tera_type.is_some()
        || !pokemon.held_items.is_empty()
        || pokemon.mechanics != er_state::mechanic_state_v2::MechanicStateStoreV2::default()
        || pokemon.types.primary != er_types::battle_model::PokemonType::Grass
        || pokemon.types.secondary != Some(er_types::battle_model::PokemonType::Poison)
    {
        return Err(invalid());
    }
    let mut result = Vec::new();
    for id in &source.tm.compatible {
        let movement = MoveId::new(SafeU53::new(*id).map_err(|_| invalid())?);
        if *id != 0
            && !result.contains(&movement)
            && !pokemon
                .moves
                .iter()
                .flatten()
                .any(|slot| slot.move_id == movement)
        {
            result.push(movement);
        }
    }
    Ok(result)
}
pub(crate) fn prepare(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    selection: &Selection,
    holder: PokemonId,
    ordinal: u32,
) -> Result<Tm, Error> {
    let pokemon = selection
        .party_before
        .iter()
        .find(|p| p.id == holder)
        .ok_or_else(invalid)?;
    let available = available(pokemon)?;
    let movement = *available
        .get(usize::try_from(ordinal).map_err(|_| invalid())?)
        .ok_or_else(invalid)?;
    content
        .battle
        .move_definition(movement)
        .map_err(|_| invalid())?;
    // The ordinary empty-slot path uses moveset.length, so reject holes rather
    // than taking an arbitrary first None from an impossible source preimage.
    let occupied = pokemon
        .moves
        .iter()
        .take_while(|slot| slot.is_some())
        .count();
    if pokemon.moves[occupied..].iter().any(Option::is_some) {
        return Err(Error::Domain("source TM moveset is not contiguous".into()));
    }
    let history_before = history(before, holder)?.clone();
    if history_before != History::Undefined {
        return Err(Error::Domain(
            "initial TM history is not the qualified fresh undefined value".into(),
        ));
    }
    let tracker_before = Box::new(
        before
            .current_achievement_tracker
            .as_ref()
            .ok_or_else(invalid)?
            .clone(),
    );
    let menu_instance = before
        .active_run
        .as_ref()
        .and_then(|r| r.control.action_context.as_ref())
        .ok_or_else(invalid)?
        .menu_instance;
    Ok(Tm {
        holder,
        movement,
        slot: occupied as u8,
        menu_instance,
        messages: Vec::new(),
        history_before,
        tracker_before,
        phase: Phase::Queued,
    })
}
pub(crate) struct Replay {
    pub party: Vec<PokemonStateV5>,
    pub history: History,
    pub tracker: Tracker,
}
pub(crate) fn replay(
    before: &GameStateV6,
    selection: &Selection,
    tm: &Tm,
) -> Result<Replay, Error> {
    let mut party = selection.party_before.clone();
    let pokemon = party
        .iter_mut()
        .find(|p| p.id == tm.holder)
        .ok_or_else(invalid)?;
    let occupied = pokemon
        .moves
        .iter()
        .take_while(|slot| slot.is_some())
        .count();
    if tm.history_before != History::Undefined
        || tm.slot > 4
        || !available(pokemon)?.contains(&tm.movement)
        || pokemon.moves[occupied..].iter().any(Option::is_some)
        || (occupied < 4 && usize::from(tm.slot) != occupied)
        || (tm.phase.applied() && tm.slot >= 4)
    {
        return Err(invalid());
    }
    validate_messages(pokemon, tm)?;
    let mut tracker = *tm.tracker_before.clone();
    let mut history = tm.history_before.clone();
    if tm.phase.applied() {
        pokemon.moves[usize::from(tm.slot)] = Some(MoveSlotState {
            move_id: tm.movement,
            pp_used: 0,
            pp_ups: 0,
            max_pp_override: None,
        });
        history = history.append(tm.movement).ok_or_else(invalid)?;
        let mut run = before.active_run.as_ref().ok_or_else(invalid)?.clone();
        run.party = party.clone();
        // Source exceptions are Palkia+Hyper Beam and Psychic+Draco Meteor.
        // Actual source Bulbasaur is Grass/Poison; the initial owner excludes
        // fusion, Tera and typing mechanics. The player stamp still always runs.
        tracker
            .stamp_learned_move(&run, tm.holder, tm.movement)
            .map_err(|_| invalid())?;
    }
    Ok(Replay {
        party,
        history,
        tracker,
    })
}
pub(crate) fn payload(
    selection: &Selection,
    tm: &Tm,
    kind: er_state::current_reward_tm::CurrentRewardTmMessageKindV1,
) -> Result<crate::m9e_material_v6::GamePresentationPayloadV1, Error> {
    use crate::m9e_material_v6::{
        GamePresentationMoveLearningV1 as S, GamePresentationPayloadV1 as P,
    };
    use er_state::current_reward_tm::CurrentRewardTmMessageKindV1 as K;
    if kind == K::Learned {
        return Ok(P::MoveLearned {
            holder: tm.holder,
            move_id: tm.movement,
        });
    }
    let step = match kind {
        K::Intro => S::WantsToLearn,
        K::ForgetQuestion => S::WhichMove,
        K::NotLearned => S::DidNotLearn,
        K::Forgotten => {
            let old_move = selection
                .party_before
                .iter()
                .find(|p| p.id == tm.holder)
                .and_then(|p| p.moves.get(usize::from(tm.slot)))
                .and_then(Option::as_ref)
                .ok_or_else(invalid)?
                .move_id;
            S::Forgot { old_move }
        }
        K::Learned => return Err(invalid()),
    };
    Ok(P::MoveLearning {
        holder: tm.holder,
        move_id: tm.movement,
        step,
    })
}

fn validate_messages(pokemon: &PokemonStateV5, tm: &Tm) -> Result<(), Error> {
    use er_state::current_reward_tm::CurrentRewardTmMessageKindV1 as M;
    if tm.menu_instance == er_types::battle_ids::MenuInstanceId::ZERO || tm.messages.len() > 4096 {
        return Err(invalid());
    }
    let kinds = tm.messages.iter().map(|m| m.kind).collect::<Vec<_>>();
    let full = pokemon.moves.iter().all(Option::is_some);
    if !full {
        if !match tm.phase {
            Phase::Queued => kinds.is_empty(),
            Phase::Present { .. } | Phase::Complete { .. } => kinds == [M::Learned],
            _ => false,
        } {
            return Err(invalid());
        }
        return Ok(());
    }
    let mut last = None;
    for kind in &kinds {
        let valid = match kind {
            M::Intro => matches!(last, None | Some(M::Intro) | Some(M::ForgetQuestion)),
            M::ForgetQuestion => last == Some(M::Intro),
            M::NotLearned => matches!(last, Some(M::Intro) | Some(M::ForgetQuestion)),
            M::Forgotten => last == Some(M::ForgetQuestion),
            M::Learned => last == Some(M::Forgotten),
        };
        if !valid {
            return Err(invalid());
        }
        last = Some(*kind);
    }
    let valid = match tm.phase {
        Phase::Queued => {
            matches!(last, None | Some(M::Intro) | Some(M::ForgetQuestion)) && tm.slot == 4
        }
        Phase::Intro { .. } | Phase::Replace | Phase::ForgetQueued => {
            last == Some(M::Intro) && tm.slot == 4
        }
        Phase::ForgetPrompt { .. } | Phase::ChooseSlot => {
            last == Some(M::ForgetQuestion) && tm.slot == 4
        }
        Phase::Stop | Phase::DeclineQueued => {
            matches!(last, Some(M::Intro) | Some(M::ForgetQuestion)) && tm.slot == 4
        }
        Phase::DeclinePresent { .. } | Phase::Declined { .. } => {
            last == Some(M::NotLearned) && tm.slot == 4
        }
        Phase::LearningQueued => last == Some(M::ForgetQuestion) && tm.slot < 4,
        Phase::Forgotten { .. } => last == Some(M::Forgotten) && tm.slot < 4,
        Phase::Present { .. } | Phase::Complete { .. } => last == Some(M::Learned) && tm.slot < 4,
    };
    if !valid {
        return Err(invalid());
    }
    Ok(())
}
