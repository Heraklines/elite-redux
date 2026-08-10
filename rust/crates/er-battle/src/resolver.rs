//! Shared atomic battle-transition surface owned by M3 integration.

use er_rng::audit::RngDraw;
use er_rng::battle::BattleRngState;
use er_state::digest::MechanicalStateDigest;
use er_state::snapshot::GameState;
use er_types::battle_command::{CommandCollectionState, CommandSet, ReplacementSelection};
use er_types::battle_ids::{FaintOccurrenceId, FieldSlot, MoveSlotIndex, PokemonId, TurnIndex};
use er_types::battle_model::{
    BattleOutcome, BattleStat, FaintOccurrence, ReplacementProgress, ResolvedAction, StatusState,
};
use er_types::battle_ui::BattlePresentationEvent;
use serde::{Deserialize, Serialize};

/// Ordered mechanical evidence for one atomic battle transition.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum BattleMutation {
    PpChanged {
        pokemon: PokemonId,
        move_slot: MoveSlotIndex,
        before: u16,
        after: u16,
    },
    HpChanged {
        pokemon: PokemonId,
        before: u32,
        after: u32,
    },
    StatusChanged {
        pokemon: PokemonId,
        before: StatusState,
        after: StatusState,
    },
    StatStageChanged {
        pokemon: PokemonId,
        stat: BattleStat,
        before: i8,
        after: i8,
    },
    FieldChanged {
        slot: FieldSlot,
        before: Option<PokemonId>,
        after: Option<PokemonId>,
    },
    CommandCollectionChanged {
        before: CommandCollectionState,
        after: CommandCollectionState,
    },
    FaintQueued {
        occurrence: FaintOccurrence,
    },
    FaintProgressChanged {
        occurrence: FaintOccurrenceId,
        before: ReplacementProgress,
        after: ReplacementProgress,
    },
    FaintResolved {
        occurrence: FaintOccurrenceId,
    },
    BattleRngChanged {
        before: BattleRngState,
        after: BattleRngState,
    },
    TurnAdvanced {
        before: TurnIndex,
        after: TurnIndex,
    },
    OutcomeChanged {
        before: BattleOutcome,
        after: BattleOutcome,
    },
}

/// Exact logical decision that follows a successful battle transition.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum BattleNextDecision {
    CommandFrontier,
    Replacement { occurrence: FaintOccurrenceId },
    Complete(BattleOutcome),
}

/// Complete pure result of resolving one admitted turn.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BattleTransition {
    pub before_state: GameState,
    pub after_state: GameState,
    pub before_digest: MechanicalStateDigest,
    pub after_digest: MechanicalStateDigest,
    pub accepted_commands: CommandSet,
    pub action_order: Vec<ResolvedAction>,
    pub mutations: Vec<BattleMutation>,
    pub presentation: Vec<BattlePresentationEvent>,
    pub rng_audit: Vec<RngDraw>,
    pub outcome: BattleOutcome,
    pub next_decision: BattleNextDecision,
}

/// Complete pure result of applying one stored faint replacement decision.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BattleReplacementTransition {
    pub before_state: GameState,
    pub after_state: GameState,
    pub before_digest: MechanicalStateDigest,
    pub after_digest: MechanicalStateDigest,
    pub occurrence: FaintOccurrence,
    pub selection: ReplacementSelection,
    pub mutations: Vec<BattleMutation>,
    pub presentation: Vec<BattlePresentationEvent>,
    pub outcome: BattleOutcome,
    pub next_decision: BattleNextDecision,
}
