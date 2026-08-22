//! Canonical digest of one retained M4 run surface.

use er_canonical::content_digest;
use er_types::run_ids::SurfaceDigest;
use serde::Serialize;
use thiserror::Error;

use crate::run_v2::RunSurfaceState;

pub const SURFACE_DIGEST_DOMAIN_V1: &str = "pokerogue-redux/m4/surface/v1";

#[derive(Debug, Error)]
pub enum SurfaceDigestErrorV1 {
    #[error("surface state is invalid: {0}")]
    InvalidSurface(#[from] crate::run_v2::RunStateValidationError),
    #[error("surface digest canonicalization failed: {0}")]
    Canonical(#[from] er_canonical::CanonicalError),
    #[error("surface digest value is invalid: {0}")]
    InvalidDigest(#[from] er_types::run_ids::SurfaceDigestError),
}

#[derive(Serialize)]
struct SurfaceDigestPreimageV1<'a> {
    domain: &'static str,
    surface: &'a RunSurfaceState,
}

/// Computes a non-self-referential digest by replacing the carried digest with
/// the canonical all-zero sentinel in the preimage.
pub fn compute_surface_digest_v1(
    surface: &RunSurfaceState,
) -> Result<SurfaceDigest, SurfaceDigestErrorV1> {
    surface.validate()?;
    let mut normalized = surface.clone();
    normalized.header_mut().surface_digest =
        SurfaceDigest::new(format!("blake3-v1:{}", "0".repeat(64)))?;
    let raw = content_digest(&SurfaceDigestPreimageV1 {
        domain: SURFACE_DIGEST_DOMAIN_V1,
        surface: &normalized,
    })?;
    Ok(SurfaceDigest::new(format!("blake3-v1:{raw}"))?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::SafeU53;
    use er_types::battle_ids::MenuInstanceId;
    use er_types::run_ids::{RunInteractionSequence, RunSurfaceId};
    use er_types::run_model::RunSurfaceKind;
    use er_types::ui::CancelPolicy;
    use er_types::ui_menu::{LogicalMenu, LogicalMenuOption};
    use er_types::{MenuOptionId, OperationId, SeatId};

    fn surface() -> RunSurfaceState {
        let owner = SeatId::new(SafeU53::new(1).expect("seat"));
        let option = MenuOptionId::new("crossroads/stay").expect("option");
        let menu = LogicalMenu::new(
            MenuInstanceId::new(SafeU53::new(1).expect("menu")),
            owner,
            "surface-control",
            option.clone(),
            vec![LogicalMenuOption::new(option, true, None).expect("option")],
            Vec::new(),
            CancelPolicy::Disabled,
        )
        .expect("menu");
        RunSurfaceState::Crossroads(crate::run_v2::CrossroadsSurfaceState {
            header: crate::run_v2::SurfaceHeader {
                schema_version: crate::run_v2::RUN_SURFACE_STATE_SCHEMA_VERSION,
                surface_id: RunSurfaceId::new(SafeU53::new(1).expect("surface")),
                kind: RunSurfaceKind::Crossroads,
                owner_seat: owner,
                interaction_sequence: RunInteractionSequence::new(SafeU53::ZERO),
                action_ordinal: 0,
                operation_id: OperationId::new("1:1:CROSSROADS_PICK:9600001").expect("operation"),
                menu,
                surface_digest: SurfaceDigest::new(format!("blake3-v1:{}", "0".repeat(64)))
                    .expect("digest"),
            },
            source_wave: er_types::battle_ids::WaveIndex::new(SafeU53::new(1).expect("wave"))
                .expect("positive wave"),
        })
    }

    #[test]
    fn digest_ignores_the_carried_digest_but_tracks_surface_changes() {
        let first = surface();
        let digest = compute_surface_digest_v1(&first).expect("digest");
        let mut carried = first.clone();
        carried.header_mut().surface_digest = digest.clone();
        assert_eq!(compute_surface_digest_v1(&carried).expect("repeat"), digest);
        let mut changed = carried;
        changed.header_mut().action_ordinal = 1;
        assert_ne!(
            compute_surface_digest_v1(&changed).expect("changed"),
            digest
        );
    }
}
