//! Current material-owned presentation identities and exact effect receipts.
use er_types::{PresentationEventId, SafeU53};
use serde::{Deserialize, Serialize};

pub const MAX_CURRENT_PRESENTATION_RECEIPTS_V1: usize = 4_096;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentPresentationReceiptV1 {
    pub event_id: PresentationEventId,
    /// er_canonical::fixture_digest of the complete GamePresentationEffectV2.
    pub effect_sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentPresentationOwnerV1 {
    pub next_event_id: SafeU53,
    pub receipts: Vec<CurrentPresentationReceiptV1>,
}

impl CurrentPresentationOwnerV1 {
    pub fn fresh(next_event_id: SafeU53) -> Self {
        Self { next_event_id, receipts: Vec::new() }
    }

    pub fn valid(&self) -> bool {
        self.next_event_id != SafeU53::ZERO
            && self.receipts.len() <= MAX_CURRENT_PRESENTATION_RECEIPTS_V1
            && self.receipts.iter().all(|receipt| receipt.event_id.get() != SafeU53::ZERO
                && receipt.event_id.get() < self.next_event_id
                && receipt.effect_sha256.len() == 64
                && receipt.effect_sha256.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f')))
            && self.receipts.windows(2).all(|pair| pair[0].event_id.get().get().checked_add(1)
                == Some(pair[1].event_id.get().get()))
            && self.receipts.last().is_none_or(|last| last.event_id.get().get().checked_add(1)
                == Some(self.next_event_id.get()))
    }
}
