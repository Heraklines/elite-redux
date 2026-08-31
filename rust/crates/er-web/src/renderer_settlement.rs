//! Narrow renderer-to-kernel presentation settlement translation.

use er_renderer::{PresentationOutcomeV2, RendererPresentationSettlementV1};
use er_types::battle_ids::BattlePresentationEventId;
use er_types::battle_ui::PresentationSettlementOutcome;
use er_types::{KernelInput, OperationId, SafeU53, SeatId};
use thiserror::Error;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum RendererSettlementAdapterErrorV1 {
    #[error("renderer settlement is invalid")]
    InvalidSettlement,
    #[error("renderer presentation identity cannot be represented by the kernel")]
    InvalidIdentity,
}

pub fn renderer_settlement_to_kernel_input_v1(
    endpoint: SeatId,
    settlement: RendererPresentationSettlementV1,
) -> Result<KernelInput, RendererSettlementAdapterErrorV1> {
    settlement
        .validate()
        .map_err(|_| RendererSettlementAdapterErrorV1::InvalidSettlement)?;
    let operation_id = OperationId::new(settlement.event_id.operation_id)
        .map_err(|_| RendererSettlementAdapterErrorV1::InvalidIdentity)?;
    let sequence = SafeU53::new(settlement.event_id.sequence)
        .map_err(|_| RendererSettlementAdapterErrorV1::InvalidIdentity)?;
    let outcome = match settlement.outcome {
        PresentationOutcomeV2::Settled => PresentationSettlementOutcome::Settled,
        PresentationOutcomeV2::IntentionallySkipped => {
            PresentationSettlementOutcome::IntentionallySkipped
        }
        PresentationOutcomeV2::Failed { reason } => {
            PresentationSettlementOutcome::Failed { reason }
        }
    };
    outcome
        .validate()
        .map_err(|_| RendererSettlementAdapterErrorV1::InvalidSettlement)?;
    Ok(KernelInput::BattlePresentationOutcome {
        endpoint,
        event_id: BattlePresentationEventId::new(operation_id, sequence),
        outcome,
    })
}

#[cfg(test)]
mod tests {
    use er_renderer::{
        PresentationEventIdV1, PresentationOutcomeV2, RenderSceneGenerationV1,
        RendererGenerationIdentityV1, RendererPresentationSettlementV1,
    };
    use er_types::battle_ids::BattlePresentationEventId;
    use er_types::battle_ui::PresentationSettlementOutcome;
    use er_types::{KernelInput, OperationId, SafeU53, SeatId};

    use super::renderer_settlement_to_kernel_input_v1;

    #[test]
    fn adapter_is_the_only_kernel_input_translation_boundary() {
        let endpoint = SeatId::new(SafeU53::new(1).expect("seat is safe"));
        let settlement = RendererPresentationSettlementV1 {
            event_id: PresentationEventIdV1::new("battle/1/wave/1/turn/1/result", 3)
                .expect("event identity is valid"),
            scene_generation: RenderSceneGenerationV1::new(9),
            renderer_generation: RendererGenerationIdentityV1::new("renderer:primary")
                .expect("renderer identity is valid"),
            outcome: PresentationOutcomeV2::Settled,
        };
        assert_eq!(
            renderer_settlement_to_kernel_input_v1(endpoint, settlement)
                .expect("translation succeeds"),
            KernelInput::BattlePresentationOutcome {
                endpoint,
                event_id: BattlePresentationEventId::new(
                    OperationId::new("battle/1/wave/1/turn/1/result")
                        .expect("operation identity is valid"),
                    SafeU53::new(3).expect("sequence is safe"),
                ),
                outcome: PresentationSettlementOutcome::Settled,
            }
        );
    }
}
