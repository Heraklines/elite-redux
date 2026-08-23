use er_content::pack::m5_pack::{BattleContentPackV2, ClassificationKind};
use er_types::battle_ids::BattleSide;
use er_types::mechanics::{
    MechanicScope, MechanicSourceId, MechanicSourceKind, MechanicsProgramId, SourceOrdinal,
};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum MechanicSourceRank {
    Move,
    ActiveAbility,
    PassiveAbility,
    HeldItem,
    MajorStatus,
    VolatileStatus,
    Weather,
    Terrain,
    SideCondition,
    ArenaTag,
    BattlerTag,
    PositionalTag,
    Bespoke,
}

impl From<MechanicSourceKind> for MechanicSourceRank {
    fn from(value: MechanicSourceKind) -> Self {
        match value {
            MechanicSourceKind::Move => Self::Move,
            MechanicSourceKind::ActiveAbility => Self::ActiveAbility,
            MechanicSourceKind::PassiveAbility => Self::PassiveAbility,
            MechanicSourceKind::HeldItem => Self::HeldItem,
            MechanicSourceKind::MajorStatus => Self::MajorStatus,
            MechanicSourceKind::VolatileStatus => Self::VolatileStatus,
            MechanicSourceKind::Weather => Self::Weather,
            MechanicSourceKind::Terrain => Self::Terrain,
            MechanicSourceKind::SideCondition => Self::SideCondition,
            MechanicSourceKind::ArenaTag => Self::ArenaTag,
            MechanicSourceKind::BattlerTag => Self::BattlerTag,
            MechanicSourceKind::PositionalTag => Self::PositionalTag,
            MechanicSourceKind::Bespoke => Self::Bespoke,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActiveMechanicSource {
    pub source: MechanicSourceId,
    pub scope: MechanicScope,
    pub side: Option<BattleSide>,
    pub field_position: Option<u8>,
    pub source_ordinal: SourceOrdinal,
}

impl ActiveMechanicSource {
    fn sort_key(
        &self,
    ) -> (
        MechanicSourceRank,
        Option<BattleSide>,
        Option<u8>,
        &MechanicSourceId,
        SourceOrdinal,
        MechanicScope,
    ) {
        (
            self.source.kind.into(),
            self.side,
            self.field_position,
            &self.source,
            self.source_ordinal,
            self.scope,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExecutableMechanic {
    Program(MechanicsProgramId),
    Bespoke(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrderedMechanicSource {
    pub source: MechanicSourceId,
    pub scope: MechanicScope,
    pub source_rank: MechanicSourceRank,
    pub side: Option<BattleSide>,
    pub field_position: Option<u8>,
    pub source_ordinal: SourceOrdinal,
    pub executable: ExecutableMechanic,
}

pub fn order_active_sources(
    mut sources: Vec<ActiveMechanicSource>,
) -> Result<Vec<ActiveMechanicSource>, MechanicSourceError> {
    for source in &sources {
        source
            .source
            .validate()
            .map_err(|_| MechanicSourceError::InvalidIdentity)?;
    }
    sources.sort_by(|left, right| left.sort_key().cmp(&right.sort_key()));
    for pair in sources.windows(2) {
        if pair[0].sort_key() == pair[1].sort_key() {
            return Err(MechanicSourceError::DuplicateActiveSource);
        }
    }
    Ok(sources)
}

pub fn collect_mechanic_sources(
    pack: &BattleContentPackV2,
    active: Vec<ActiveMechanicSource>,
) -> Result<Vec<OrderedMechanicSource>, MechanicSourceError> {
    let active = order_active_sources(active)?;
    let mut ordered = Vec::new();
    for source in active {
        let index = pack
            .classifications
            .0
            .binary_search_by(|entry| entry.subject.cmp(&source.source))
            .map_err(|_| MechanicSourceError::MissingClassification)?;
        let classification = &pack.classifications.0[index];
        match classification.kind {
            ClassificationKind::Compiled => {
                for program_id in &classification.programs {
                    let index = usize::try_from(program_id.get().get())
                        .map_err(|_| MechanicSourceError::MissingProgram)?;
                    if !matches!(pack.programs.get(index), Some(Some(_))) {
                        return Err(MechanicSourceError::MissingProgram);
                    }
                    ordered.push(OrderedMechanicSource {
                        source: source.source.clone(),
                        scope: source.scope,
                        source_rank: source.source.kind.into(),
                        side: source.side,
                        field_position: source.field_position,
                        source_ordinal: source.source_ordinal,
                        executable: ExecutableMechanic::Program(*program_id),
                    });
                }
            }
            ClassificationKind::Bespoke => {
                let symbol = classification
                    .bespoke_symbol
                    .clone()
                    .ok_or(MechanicSourceError::MissingBespoke)?;
                ordered.push(OrderedMechanicSource {
                    source: source.source.clone(),
                    scope: source.scope,
                    source_rank: source.source.kind.into(),
                    side: source.side,
                    field_position: source.field_position,
                    source_ordinal: source.source_ordinal,
                    executable: ExecutableMechanic::Bespoke(symbol),
                });
            }
            ClassificationKind::Unsupported => {
                return Err(MechanicSourceError::ReachableUnsupported {
                    source: source.source,
                });
            }
        }
    }
    Ok(ordered)
}

#[derive(Debug, Eq, Error, PartialEq)]
pub enum MechanicSourceError {
    #[error("active mechanic source identity is invalid")]
    InvalidIdentity,
    #[error("active mechanic source is duplicated")]
    DuplicateActiveSource,
    #[error("active mechanic source has no classification")]
    MissingClassification,
    #[error("compiled mechanic references a missing program")]
    MissingProgram,
    #[error("bespoke mechanic has no symbol")]
    MissingBespoke,
    #[error("reachable mechanic is unsupported: {source:?}")]
    ReachableUnsupported { source: MechanicSourceId },
}
