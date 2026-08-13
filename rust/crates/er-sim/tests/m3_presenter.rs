use std::error::Error;

use er_sim::{FaultPresenter, InstantPresenter, Presenter, PresenterError};
use er_types::battle_ids::BattlePresentationEventId;
use er_types::battle_ui::{
    BattlePresentationEvent, BattlePresentationKind, PresentationBlockingPolicy,
    PresentationSettlementOutcome, PresentationSkipPolicy,
};
use er_types::{OperationId, SafeU53, SeatId};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn seat() -> Result<SeatId, er_types::SafeU53Error> {
    Ok(SeatId::new(SafeU53::new(1)?))
}

fn event() -> TestResult<BattlePresentationEvent> {
    Ok(BattlePresentationEvent::new(
        BattlePresentationEventId::new(
            OperationId::new("battle/1/wave/1/turn/1/result")?,
            SafeU53::ZERO,
        ),
        PresentationBlockingPolicy::BlocksHumanInput,
        PresentationSkipPolicy::Forbidden,
        BattlePresentationKind::BattleWon,
    ))
}

#[test]
fn instant_presenter_returns_the_exact_typed_battle_identity() -> TestResult {
    let mut presenter = InstantPresenter::new();
    let event = event()?;
    let event_id = event.event_id.clone();

    let completions = presenter.present_battle(seat()?, event)?;

    assert_eq!(completions.len(), 1);
    assert_eq!(completions[0].event_id, event_id.clone());
    assert_eq!(
        completions[0].outcome,
        PresentationSettlementOutcome::Settled
    );
    assert!(presenter.pending_battle_event_ids(seat()?).is_empty());
    assert_eq!(
        presenter.settled_battle_event_ids(seat()?),
        [event_id.clone()].into_iter().collect()
    );
    presenter.dispose();
    assert_eq!(
        presenter.settled_battle_event_ids(seat()?),
        [event_id].into_iter().collect()
    );
    assert!(presenter.export_state()?.disposed);
    Ok(())
}

#[test]
fn fault_presenter_requires_explicit_typed_battle_settlement() -> TestResult {
    let mut presenter = FaultPresenter::new();
    let event = event()?;
    let event_id = event.event_id.clone();

    assert!(presenter.present_battle(seat()?, event)?.is_empty());
    assert_eq!(
        presenter.pending_battle_event_ids(seat()?),
        [event_id.clone()].into_iter().collect()
    );

    let completions = presenter.settle_battle(
        seat()?,
        event_id.clone(),
        PresentationSettlementOutcome::Settled,
    )?;
    assert_eq!(completions[0].event_id, event_id.clone());
    assert!(presenter.pending_battle_event_ids(seat()?).is_empty());
    assert_eq!(
        presenter.settle_battle(
            seat()?,
            event_id.clone(),
            PresentationSettlementOutcome::Settled,
        ),
        Err(PresenterError::BattleAlreadySettled {
            event_id: event_id.clone(),
        })
    );
    presenter.dispose();
    assert!(presenter.pending_battle_event_ids(seat()?).is_empty());
    assert_eq!(
        presenter.settled_battle_event_ids(seat()?),
        [event_id].into_iter().collect()
    );
    assert!(presenter.export_state()?.disposed);
    Ok(())
}
