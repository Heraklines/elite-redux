//! M3A-10 owns stable battle menu, UI projection, and presentation DTOs.

use std::cmp::Ordering;
use std::fmt;

use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use crate::battle_control::{BattleControlError, SeatBattleControl};
use crate::battle_ids::{
    AbilityId, BattleId, BattlePresentationEventId, FieldSlot, MoveId, PokemonId, TurnIndex,
    WaveIndex,
};
use crate::battle_model::{BattleStat, StatusState};
use crate::ids::{MenuOptionId, SafeU53, SeatId};

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

/// The frozen M3 presentation-plan digest representation.
pub const PRESENTATION_PLAN_DIGEST_PREFIX: &str = "blake3-v1:";

/// Errors raised while constructing a presentation-plan digest.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PresentationPlanDigestError {
    #[error("presentation-plan digest must start with blake3-v1:")]
    InvalidPrefix,
    #[error("presentation-plan digest must contain exactly 64 lowercase hexadecimal digits")]
    InvalidHex,
}

/// A versioned digest of an ordered typed presentation plan.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct PresentationPlanDigest(String);

impl PresentationPlanDigest {
    pub fn new(value: impl Into<String>) -> Result<Self, PresentationPlanDigestError> {
        let value = value.into();
        let Some(hex) = value.strip_prefix(PRESENTATION_PLAN_DIGEST_PREFIX) else {
            return Err(PresentationPlanDigestError::InvalidPrefix);
        };
        if hex.len() != 64
            || !hex
                .bytes()
                .all(|digit| matches!(digit, b'0'..=b'9' | b'a'..=b'f'))
        {
            return Err(PresentationPlanDigestError::InvalidHex);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for PresentationPlanDigest {
    type Error = PresentationPlanDigestError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl fmt::Display for PresentationPlanDigest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl<'de> Deserialize<'de> for PresentationPlanDigest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// The four explicit directional edges supported by the M3 reducer.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NavigationDirection {
    Up,
    Down,
    Left,
    Right,
}

/// One stable menu-navigation edge.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MenuNavigationEdge {
    pub from: MenuOptionId,
    pub direction: NavigationDirection,
    pub to: MenuOptionId,
}

impl MenuNavigationEdge {
    pub fn new(from: MenuOptionId, direction: NavigationDirection, to: MenuOptionId) -> Self {
        Self {
            from,
            direction,
            to,
        }
    }
}

fn compare_navigation_edges(first: &MenuNavigationEdge, second: &MenuNavigationEdge) -> Ordering {
    first
        .from
        .cmp(&second.from)
        .then(first.direction.cmp(&second.direction))
        .then(first.to.cmp(&second.to))
}

/// Errors raised by the standalone canonical navigation vector.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum MenuNavigationError {
    #[error("navigation edges contain a duplicate (from, direction) key")]
    DuplicateEdgeKey,
    #[error("navigation edges are not in canonical option/direction order")]
    UnsortedEdges,
}

/// A selection plus its explicit directional edges.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MenuNavigation {
    pub selected_option_id: MenuOptionId,
    pub edges: Vec<MenuNavigationEdge>,
}

impl MenuNavigation {
    /// Builds a canonical navigation vector, sorting by option ID and then
    /// `Up`, `Down`, `Left`, `Right` direction order.
    pub fn new(
        selected_option_id: MenuOptionId,
        mut edges: Vec<MenuNavigationEdge>,
    ) -> Result<Self, MenuNavigationError> {
        edges.sort_unstable_by(compare_navigation_edges);
        let value = Self {
            selected_option_id,
            edges,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), MenuNavigationError> {
        for pair in self.edges.windows(2) {
            if pair[0].from == pair[1].from && pair[0].direction == pair[1].direction {
                return Err(MenuNavigationError::DuplicateEdgeKey);
            }
            if compare_navigation_edges(&pair[0], &pair[1]) == Ordering::Greater {
                return Err(MenuNavigationError::UnsortedEdges);
            }
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for MenuNavigation {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct MenuNavigationWire {
            selected_option_id: MenuOptionId,
            edges: Vec<MenuNavigationEdge>,
        }

        let value = MenuNavigationWire::deserialize(deserializer)?;
        Self::new(value.selected_option_id, value.edges).map_err(serde::de::Error::custom)
    }
}

/// Immutable renderer geometry for one stable option identity.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MenuOptionLayout {
    pub option_id: MenuOptionId,
    pub row: u16,
    pub column: u16,
    pub page: u16,
}

impl MenuOptionLayout {
    pub fn new(option_id: MenuOptionId, row: u16, column: u16, page: u16) -> Self {
        Self {
            option_id,
            row,
            column,
            page,
        }
    }

    pub fn geometry(&self) -> (u16, u16, u16) {
        (self.page, self.row, self.column)
    }
}

/// Visibility of a menu option. Hidden options are not navigation endpoints.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MenuOptionVisibility {
    Visible,
    Hidden,
}

impl MenuOptionVisibility {
    pub const fn is_visible(self) -> bool {
        matches!(self, Self::Visible)
    }
}

/// Errors raised by one option's intrinsic identity invariants.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BattleMenuOptionError {
    #[error("menu option label_key must not be empty")]
    EmptyLabelKey,
    #[error("menu option layout identity does not match option_id")]
    LayoutIdentityMismatch,
}

/// One stable menu option and its immutable presentation metadata.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BattleMenuOption {
    pub option_id: MenuOptionId,
    pub label_key: String,
    pub visibility: MenuOptionVisibility,
    pub enabled: bool,
    pub layout: MenuOptionLayout,
}

impl BattleMenuOption {
    pub fn new(
        option_id: MenuOptionId,
        label_key: impl Into<String>,
        visibility: MenuOptionVisibility,
        enabled: bool,
        layout: MenuOptionLayout,
    ) -> Result<Self, BattleMenuOptionError> {
        let value = Self {
            option_id,
            label_key: label_key.into(),
            visibility,
            enabled,
            layout,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), BattleMenuOptionError> {
        if self.label_key.is_empty() {
            return Err(BattleMenuOptionError::EmptyLabelKey);
        }
        if self.layout.option_id != self.option_id {
            return Err(BattleMenuOptionError::LayoutIdentityMismatch);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for BattleMenuOption {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct BattleMenuOptionWire {
            option_id: MenuOptionId,
            label_key: String,
            visibility: MenuOptionVisibility,
            enabled: bool,
            layout: MenuOptionLayout,
        }

        let value = BattleMenuOptionWire::deserialize(deserializer)?;
        Self::new(
            value.option_id,
            value.label_key,
            value.visibility,
            value.enabled,
            value.layout,
        )
        .map_err(serde::de::Error::custom)
    }
}

/// Errors raised while validating a complete immutable menu graph.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BattleMenuError {
    #[error("menu instance_id must be greater than zero")]
    ZeroInstanceId,
    #[error("menu control_id must not be empty")]
    EmptyControlId,
    #[error("menu must contain at least one option")]
    EmptyOptions,
    #[error("menu options are not in canonical option-id order")]
    UnsortedOptions,
    #[error("menu contains a duplicate option identity")]
    DuplicateOption,
    #[error("selected option is not present in the menu")]
    MissingSelectedOption,
    #[error("selected option must be visible")]
    SelectedOptionHidden,
    #[error("two visible options occupy the same page/row/column")]
    DuplicateVisibleGeometry,
    #[error("navigation edge references an unknown option")]
    UnknownNavigationEndpoint,
    #[error("navigation edge references a hidden option")]
    HiddenNavigationEndpoint,
    #[error("navigation edges contain a duplicate (from, direction) key")]
    DuplicateNavigationEdge,
    #[error("navigation edges are not in canonical option/direction order")]
    UnsortedNavigation,
    #[error("invalid menu option: {0}")]
    Option(#[from] BattleMenuOptionError),
}

/// The immutable menu graph installed inside an actionable control.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BattleMenu {
    pub instance_id: crate::battle_ids::MenuInstanceId,
    pub owner_seat: SeatId,
    pub control_id: String,
    pub selected_option_id: MenuOptionId,
    pub options: Vec<BattleMenuOption>,
    pub navigation: Vec<MenuNavigationEdge>,
}

impl BattleMenu {
    /// Builds the canonical vector form used on the wire.
    pub fn new(
        instance_id: crate::battle_ids::MenuInstanceId,
        owner_seat: SeatId,
        control_id: impl Into<String>,
        selected_option_id: MenuOptionId,
        mut options: Vec<BattleMenuOption>,
        mut navigation: Vec<MenuNavigationEdge>,
    ) -> Result<Self, BattleMenuError> {
        options.sort_unstable_by(|first, second| first.option_id.cmp(&second.option_id));
        navigation.sort_unstable_by(compare_navigation_edges);
        let value = Self {
            instance_id,
            owner_seat,
            control_id: control_id.into(),
            selected_option_id,
            options,
            navigation,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), BattleMenuError> {
        if self.instance_id.get() == SafeU53::ZERO {
            return Err(BattleMenuError::ZeroInstanceId);
        }
        if self.control_id.is_empty() {
            return Err(BattleMenuError::EmptyControlId);
        }
        if self.options.is_empty() {
            return Err(BattleMenuError::EmptyOptions);
        }

        for pair in self.options.windows(2) {
            if pair[0].option_id == pair[1].option_id {
                return Err(BattleMenuError::DuplicateOption);
            }
            if pair[0].option_id > pair[1].option_id {
                return Err(BattleMenuError::UnsortedOptions);
            }
        }

        let mut visible_geometry = Vec::new();
        for option in &self.options {
            option.validate()?;
            if option.visibility.is_visible() {
                let geometry = option.layout.geometry();
                if visible_geometry.contains(&geometry) {
                    return Err(BattleMenuError::DuplicateVisibleGeometry);
                }
                visible_geometry.push(geometry);
            }
        }

        let Some(selected) = self.option(self.selected_option_id.clone()) else {
            return Err(BattleMenuError::MissingSelectedOption);
        };
        if !selected.visibility.is_visible() {
            return Err(BattleMenuError::SelectedOptionHidden);
        }

        for pair in self.navigation.windows(2) {
            if pair[0].from == pair[1].from && pair[0].direction == pair[1].direction {
                return Err(BattleMenuError::DuplicateNavigationEdge);
            }
            if compare_navigation_edges(&pair[0], &pair[1]) == Ordering::Greater {
                return Err(BattleMenuError::UnsortedNavigation);
            }
        }

        for edge in &self.navigation {
            let Some(from) = self.option(edge.from.clone()) else {
                return Err(BattleMenuError::UnknownNavigationEndpoint);
            };
            let Some(to) = self.option(edge.to.clone()) else {
                return Err(BattleMenuError::UnknownNavigationEndpoint);
            };
            if !from.visibility.is_visible() || !to.visibility.is_visible() {
                return Err(BattleMenuError::HiddenNavigationEndpoint);
            }
        }
        Ok(())
    }

    pub fn option(&self, option_id: MenuOptionId) -> Option<&BattleMenuOption> {
        self.options
            .binary_search_by(|option| option.option_id.cmp(&option_id))
            .ok()
            .map(|index| &self.options[index])
    }

    pub fn contains_option(&self, option_id: &MenuOptionId) -> bool {
        self.option(option_id.clone()).is_some()
    }

    pub fn is_visible(&self, option_id: &MenuOptionId) -> bool {
        self.option(option_id.clone())
            .is_some_and(|option| option.visibility.is_visible())
    }
}

impl<'de> Deserialize<'de> for BattleMenu {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct BattleMenuWire {
            instance_id: crate::battle_ids::MenuInstanceId,
            owner_seat: SeatId,
            control_id: String,
            selected_option_id: MenuOptionId,
            options: Vec<BattleMenuOption>,
            navigation: Vec<MenuNavigationEdge>,
        }

        let value = BattleMenuWire::deserialize(deserializer)?;
        Self::new(
            value.instance_id,
            value.owner_seat,
            value.control_id,
            value.selected_option_id,
            value.options,
            value.navigation,
        )
        .map_err(serde::de::Error::custom)
    }
}

/// The typed controls the battle presenter can request.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationBlockingPolicy {
    NonBlocking,
    BlocksHumanInput,
}

/// Whether a presenter may intentionally skip one exact event.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationSkipPolicy {
    Forbidden,
    Allowed,
}

/// The exact settlement result for one event identity.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum PresentationSettlementOutcome {
    Settled,
    IntentionallySkipped,
    Failed { reason: String },
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum PresentationSettlementOutcomeError {
    #[error("failed presentation settlement reason must not be empty")]
    EmptyFailureReason,
}

impl PresentationSettlementOutcome {
    pub fn failed(reason: impl Into<String>) -> Result<Self, PresentationSettlementOutcomeError> {
        let reason = reason.into();
        if reason.is_empty() {
            return Err(PresentationSettlementOutcomeError::EmptyFailureReason);
        }
        Ok(Self::Failed { reason })
    }

    pub fn validate(&self) -> Result<(), PresentationSettlementOutcomeError> {
        if let Self::Failed { reason } = self
            && reason.is_empty()
        {
            return Err(PresentationSettlementOutcomeError::EmptyFailureReason);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for PresentationSettlementOutcome {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct PresentationSettlementBasicWire {
            kind: String,
        }

        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct PresentationSettlementFailedWire {
            kind: String,
            reason: String,
        }

        #[derive(Deserialize)]
        #[serde(untagged)]
        enum PresentationSettlementOutcomeWire {
            Basic(PresentationSettlementBasicWire),
            Failed(PresentationSettlementFailedWire),
        }

        let value = match PresentationSettlementOutcomeWire::deserialize(deserializer)? {
            PresentationSettlementOutcomeWire::Basic(value) => match value.kind.as_str() {
                "SETTLED" => Self::Settled,
                "INTENTIONALLY_SKIPPED" => Self::IntentionallySkipped,
                "FAILED" => {
                    return Err(serde::de::Error::custom(
                        "failed presentation settlement requires a reason",
                    ));
                }
                _ => {
                    return Err(serde::de::Error::custom(
                        "unknown presentation settlement outcome kind",
                    ));
                }
            },
            PresentationSettlementOutcomeWire::Failed(value) if value.kind == "FAILED" => {
                Self::Failed {
                    reason: value.reason,
                }
            }
            PresentationSettlementOutcomeWire::Failed(_) => {
                return Err(serde::de::Error::custom(
                    "presentation settlement reason is only valid for FAILED",
                ));
            }
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

/// Closed typed presentation event kinds in the supported M3 battle slice.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum BattlePresentationKind {
    MoveUsed {
        actor: PokemonId,
        move_id: MoveId,
        targets: Vec<FieldSlot>,
    },
    AbilityActivated {
        pokemon: PokemonId,
        ability_id: AbilityId,
    },
    HpChanged {
        pokemon: PokemonId,
        before: u32,
        after: u32,
    },
    StatusApplied {
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
    Switched {
        slot: FieldSlot,
        outgoing: Option<PokemonId>,
        incoming: PokemonId,
    },
    Fainted {
        pokemon: PokemonId,
        occurrence: crate::battle_ids::FaintOccurrenceId,
    },
    BattleWon,
    BattleLost,
}

impl<'de> Deserialize<'de> for BattlePresentationKind {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct MoveUsedWire {
            kind: String,
            actor: PokemonId,
            move_id: MoveId,
            targets: Vec<FieldSlot>,
        }

        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct AbilityActivatedWire {
            kind: String,
            pokemon: PokemonId,
            ability_id: AbilityId,
        }

        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct HpChangedWire {
            kind: String,
            pokemon: PokemonId,
            before: u32,
            after: u32,
        }

        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct StatusAppliedWire {
            kind: String,
            pokemon: PokemonId,
            before: StatusState,
            after: StatusState,
        }

        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct StatStageChangedWire {
            kind: String,
            pokemon: PokemonId,
            stat: BattleStat,
            before: i8,
            after: i8,
        }

        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct SwitchedWire {
            kind: String,
            slot: FieldSlot,
            #[serde(deserialize_with = "deserialize_required_nullable")]
            outgoing: Option<PokemonId>,
            incoming: PokemonId,
        }

        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct FaintedWire {
            kind: String,
            pokemon: PokemonId,
            occurrence: crate::battle_ids::FaintOccurrenceId,
        }

        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct NoPayloadWire {
            kind: String,
        }

        #[derive(Deserialize)]
        #[serde(untagged)]
        enum BattlePresentationKindWire {
            MoveUsed(MoveUsedWire),
            AbilityActivated(AbilityActivatedWire),
            HpChanged(HpChangedWire),
            StatusApplied(StatusAppliedWire),
            StatStageChanged(StatStageChangedWire),
            Switched(SwitchedWire),
            Fainted(FaintedWire),
            NoPayload(NoPayloadWire),
        }

        let value = match BattlePresentationKindWire::deserialize(deserializer)? {
            BattlePresentationKindWire::MoveUsed(value) if value.kind == "MOVE_USED" => {
                Self::MoveUsed {
                    actor: value.actor,
                    move_id: value.move_id,
                    targets: value.targets,
                }
            }
            BattlePresentationKindWire::AbilityActivated(value)
                if value.kind == "ABILITY_ACTIVATED" =>
            {
                Self::AbilityActivated {
                    pokemon: value.pokemon,
                    ability_id: value.ability_id,
                }
            }
            BattlePresentationKindWire::HpChanged(value) if value.kind == "HP_CHANGED" => {
                Self::HpChanged {
                    pokemon: value.pokemon,
                    before: value.before,
                    after: value.after,
                }
            }
            BattlePresentationKindWire::StatusApplied(value) if value.kind == "STATUS_APPLIED" => {
                Self::StatusApplied {
                    pokemon: value.pokemon,
                    before: value.before,
                    after: value.after,
                }
            }
            BattlePresentationKindWire::StatStageChanged(value)
                if value.kind == "STAT_STAGE_CHANGED" =>
            {
                Self::StatStageChanged {
                    pokemon: value.pokemon,
                    stat: value.stat,
                    before: value.before,
                    after: value.after,
                }
            }
            BattlePresentationKindWire::Switched(value) if value.kind == "SWITCHED" => {
                Self::Switched {
                    slot: value.slot,
                    outgoing: value.outgoing,
                    incoming: value.incoming,
                }
            }
            BattlePresentationKindWire::Fainted(value) if value.kind == "FAINTED" => {
                Self::Fainted {
                    pokemon: value.pokemon,
                    occurrence: value.occurrence,
                }
            }
            BattlePresentationKindWire::NoPayload(value) if value.kind == "BATTLE_WON" => {
                Self::BattleWon
            }
            BattlePresentationKindWire::NoPayload(value) if value.kind == "BATTLE_LOST" => {
                Self::BattleLost
            }
            _ => {
                return Err(serde::de::Error::custom(
                    "unknown or mismatched battle presentation kind",
                ));
            }
        };
        Ok(value)
    }
}

/// One ordered, allocator-free typed presentation request.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattlePresentationEvent {
    pub event_id: BattlePresentationEventId,
    pub policy: PresentationBlockingPolicy,
    pub skip_policy: PresentationSkipPolicy,
    pub kind: BattlePresentationKind,
}

impl BattlePresentationEvent {
    pub fn new(
        event_id: BattlePresentationEventId,
        policy: PresentationBlockingPolicy,
        skip_policy: PresentationSkipPolicy,
        kind: BattlePresentationKind,
    ) -> Self {
        Self {
            event_id,
            policy,
            skip_policy,
            kind,
        }
    }
}

/// The immutable per-seat battle UI boundary exposed to the kernel.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BattleUiProjection {
    pub schema_version: u32,
    pub battle_id: BattleId,
    pub wave: WaveIndex,
    pub turn: TurnIndex,
    pub seat_control: SeatBattleControl,
    pub actionable: bool,
}

pub const BATTLE_UI_PROJECTION_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BattleUiProjectionError {
    #[error("unsupported BattleUiProjection schema version {actual}; expected {expected}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("invalid seat control projection: {0}")]
    SeatControl(#[from] BattleControlError),
    #[error("an actionable control projection must carry a decision operation identity")]
    MissingDecisionOperation,
    #[error(
        "a waiting or complete control projection must not carry a decision operation identity"
    )]
    UnexpectedDecisionOperation,
    #[error("the projected menu owner does not match the projected seat")]
    MenuOwnerMismatch,
    #[error("a waiting or complete control projection cannot be marked actionable")]
    NonActionableControlMarkedActionable,
}

impl BattleUiProjection {
    pub fn new(
        schema_version: u32,
        battle_id: BattleId,
        wave: WaveIndex,
        turn: TurnIndex,
        seat_control: SeatBattleControl,
        actionable: bool,
    ) -> Result<Self, BattleUiProjectionError> {
        let value = Self {
            schema_version,
            battle_id,
            wave,
            turn,
            seat_control,
            actionable,
        };
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), BattleUiProjectionError> {
        if self.schema_version != BATTLE_UI_PROJECTION_SCHEMA_VERSION {
            return Err(BattleUiProjectionError::SchemaVersion {
                expected: BATTLE_UI_PROJECTION_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        self.seat_control.validate()?;
        if self.seat_control.control.requires_decision_operation()
            != self.seat_control.decision_operation_id.is_some()
        {
            return if self.seat_control.control.requires_decision_operation() {
                Err(BattleUiProjectionError::MissingDecisionOperation)
            } else {
                Err(BattleUiProjectionError::UnexpectedDecisionOperation)
            };
        }
        if self
            .seat_control
            .control
            .owner_seat()
            .is_some_and(|owner_seat| owner_seat != self.seat_control.seat)
        {
            return Err(BattleUiProjectionError::MenuOwnerMismatch);
        }
        self.seat_control.control.validate_control_ids(
            self.battle_id,
            self.wave,
            self.turn,
            self.seat_control.seat,
            self.seat_control.decision_operation_id.as_ref(),
        )?;
        if self.actionable && !self.seat_control.control.is_actionable() {
            return Err(BattleUiProjectionError::NonActionableControlMarkedActionable);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for BattleUiProjection {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct BattleUiProjectionWire {
            schema_version: u32,
            battle_id: BattleId,
            wave: WaveIndex,
            turn: TurnIndex,
            seat_control: SeatBattleControl,
            actionable: bool,
        }

        let value = BattleUiProjectionWire::deserialize(deserializer)?;
        Self::new(
            value.schema_version,
            value.battle_id,
            value.wave,
            value.turn,
            value.seat_control,
            value.actionable,
        )
        .map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use std::error::Error;

    use super::*;
    use crate::battle_control::{
        BattleControl, CommandRootControl, ReplacementSelectControl, WaitingControl, WaitingReason,
    };
    use crate::battle_ids::{AuthorityEpoch, BattleSide, FaintOccurrenceId, MenuInstanceId};
    use crate::battle_model::{BattleOutcome, FaintSource};
    use crate::ids::{MenuOptionId, OperationId, SafeU53, SeatId};

    fn safe(value: u64) -> Result<SafeU53, Box<dyn Error>> {
        Ok(SafeU53::new(value)?)
    }

    fn option(
        option_id: &str,
        row: u16,
        visibility: MenuOptionVisibility,
        enabled: bool,
    ) -> Result<BattleMenuOption, Box<dyn Error>> {
        let option_id = MenuOptionId::new(option_id)?;
        BattleMenuOption::new(
            option_id.clone(),
            format!("label.{}", option_id.as_str()),
            visibility,
            enabled,
            MenuOptionLayout::new(option_id, row, 0, 0),
        )
        .map_err(Into::into)
    }

    fn menu_for_owner(owner_seat: u64) -> Result<BattleMenu, Box<dyn Error>> {
        let fight = MenuOptionId::new("command/fight")?;
        let switch = MenuOptionId::new("command/switch")?;
        BattleMenu::new(
            MenuInstanceId::new(safe(1)?),
            SeatId::new(safe(owner_seat)?),
            "battle/1/wave/1/turn/1/control/player/0/seat/1/command",
            fight,
            vec![
                option("command/switch", 1, MenuOptionVisibility::Visible, true)?,
                option("command/fight", 0, MenuOptionVisibility::Visible, true)?,
            ],
            vec![MenuNavigationEdge::new(
                switch,
                NavigationDirection::Up,
                MenuOptionId::new("command/fight")?,
            )],
        )
        .map_err(Into::into)
    }

    fn menu() -> Result<BattleMenu, Box<dyn Error>> {
        menu_for_owner(1)
    }

    fn command_control(owner_seat: u64) -> Result<BattleControl, Box<dyn Error>> {
        Ok(BattleControl::CommandRoot(CommandRootControl::new(
            PokemonId::new(safe(7)?),
            FieldSlot {
                side: BattleSide::Player,
                position: 0,
            },
            menu_for_owner(owner_seat)?,
        )?))
    }

    fn replacement_control(operation_id: &str) -> Result<BattleControl, Box<dyn Error>> {
        let selected_option_id = MenuOptionId::new("party/42/slot/3")?;
        let menu = BattleMenu::new(
            MenuInstanceId::new(safe(1)?),
            SeatId::new(safe(1)?),
            format!("{operation_id}/control/replacement"),
            selected_option_id.clone(),
            vec![option(
                selected_option_id.as_str(),
                0,
                MenuOptionVisibility::Visible,
                true,
            )?],
            Vec::new(),
        )?;
        Ok(BattleControl::ReplacementSelect(
            ReplacementSelectControl::new(
                FaintOccurrenceId::new(safe(9)?),
                FaintSource {
                    epoch: AuthorityEpoch::new(safe(3)?),
                    wave: WaveIndex::new(safe(1)?)?,
                    resolved_turn: TurnIndex::new(safe(1)?)?,
                    turn_occurrence: 4,
                },
                PokemonId::new(safe(7)?),
                FieldSlot {
                    side: BattleSide::Player,
                    position: 0,
                },
                SeatId::new(safe(1)?),
                menu,
                selected_option_id.clone(),
                selected_option_id,
            )?,
        ))
    }

    fn waiting_control() -> Result<BattleControl, Box<dyn Error>> {
        Ok(BattleControl::Waiting(WaitingControl::new(
            WaitingReason::PartnerCommand,
            vec![OperationId::new(
                "battle/1/wave/1/turn/1/command/player/0/seat/1",
            )?],
        )?))
    }

    fn projection(
        seat: u64,
        decision_operation_id: Option<OperationId>,
        control: BattleControl,
        actionable: bool,
    ) -> Result<BattleUiProjection, BattleUiProjectionError> {
        BattleUiProjection::new(
            BATTLE_UI_PROJECTION_SCHEMA_VERSION,
            BattleId::new(SafeU53::new(1).expect("test battle ID is safe")),
            WaveIndex::new(SafeU53::new(1).expect("test wave is safe"))
                .expect("test wave is positive"),
            TurnIndex::new(SafeU53::new(1).expect("test turn is safe"))
                .expect("test turn is positive"),
            SeatBattleControl::new(
                SeatId::new(SafeU53::new(seat).expect("test seat is safe")),
                decision_operation_id,
                control,
            ),
            actionable,
        )
    }

    fn unchecked_projection(
        seat: u64,
        decision_operation_id: Option<OperationId>,
        control: BattleControl,
        actionable: bool,
    ) -> BattleUiProjection {
        BattleUiProjection {
            schema_version: BATTLE_UI_PROJECTION_SCHEMA_VERSION,
            battle_id: BattleId::new(SafeU53::new(1).expect("test battle ID is safe")),
            wave: WaveIndex::new(SafeU53::new(1).expect("test wave is safe"))
                .expect("test wave is positive"),
            turn: TurnIndex::new(SafeU53::new(1).expect("test turn is safe"))
                .expect("test turn is positive"),
            seat_control: SeatBattleControl::new(
                SeatId::new(SafeU53::new(seat).expect("test seat is safe")),
                decision_operation_id,
                control,
            ),
            actionable,
        }
    }

    #[test]
    fn menu_constructors_normalize_vectors_and_preserve_stable_identity()
    -> Result<(), Box<dyn Error>> {
        let menu = menu()?;
        assert_eq!(menu.options[0].option_id.as_str(), "command/fight");
        assert_eq!(menu.options[1].option_id.as_str(), "command/switch");
        assert_eq!(menu.navigation.len(), 1);
        assert_eq!(menu.selected_option_id.as_str(), "command/fight");
        Ok(())
    }

    #[test]
    fn menu_rejects_hidden_selection_and_hidden_navigation() -> Result<(), Box<dyn Error>> {
        let hidden = option("command/hidden", 0, MenuOptionVisibility::Hidden, false)?;
        let visible = option("command/visible", 1, MenuOptionVisibility::Visible, true)?;
        let hidden_id = hidden.option_id.clone();
        let visible_id = visible.option_id.clone();
        let hidden_selected = BattleMenu::new(
            MenuInstanceId::new(safe(1)?),
            SeatId::new(safe(1)?),
            "control",
            hidden_id.clone(),
            vec![hidden.clone(), visible.clone()],
            Vec::new(),
        );
        assert!(matches!(
            hidden_selected,
            Err(BattleMenuError::SelectedOptionHidden)
        ));

        let hidden_edge = BattleMenu::new(
            MenuInstanceId::new(safe(1)?),
            SeatId::new(safe(1)?),
            "control",
            visible_id.clone(),
            vec![hidden, visible],
            vec![MenuNavigationEdge::new(
                visible_id,
                NavigationDirection::Down,
                hidden_id,
            )],
        );
        assert!(matches!(
            hidden_edge,
            Err(BattleMenuError::HiddenNavigationEndpoint)
        ));
        Ok(())
    }

    #[test]
    fn projection_requires_the_exact_decision_operation_presence() -> Result<(), Box<dyn Error>> {
        let operation_id = OperationId::new("battle/1/wave/1/turn/1/command/player/0/seat/1")?;
        assert_eq!(
            projection(1, None, command_control(1)?, false),
            Err(BattleUiProjectionError::MissingDecisionOperation)
        );
        assert_eq!(
            projection(1, Some(operation_id.clone()), waiting_control()?, false),
            Err(BattleUiProjectionError::UnexpectedDecisionOperation)
        );
        assert!(projection(1, Some(operation_id), command_control(1)?, false).is_ok());
        Ok(())
    }

    #[test]
    fn projection_rejects_foreign_menu_ownership() -> Result<(), Box<dyn Error>> {
        assert_eq!(
            projection(
                1,
                Some(OperationId::new(
                    "battle/1/wave/1/turn/1/command/player/0/seat/1",
                )?),
                command_control(2)?,
                true,
            ),
            Err(BattleUiProjectionError::MenuOwnerMismatch)
        );
        Ok(())
    }

    #[test]
    fn projection_never_makes_waiting_or_complete_actionable() -> Result<(), Box<dyn Error>> {
        assert_eq!(
            projection(1, None, waiting_control()?, true),
            Err(BattleUiProjectionError::NonActionableControlMarkedActionable)
        );
        assert_eq!(
            projection(
                1,
                None,
                BattleControl::Complete(BattleOutcome::Victory),
                true,
            ),
            Err(BattleUiProjectionError::NonActionableControlMarkedActionable)
        );
        Ok(())
    }

    #[test]
    fn projection_rejects_contextually_wrong_control_ids() -> Result<(), Box<dyn Error>> {
        let mut control = command_control(1)?;
        let BattleControl::CommandRoot(command) = &mut control else {
            unreachable!("test helper always builds CommandRoot");
        };
        command.menu.control_id =
            "battle/01/wave/1/turn/1/control/player/0/seat/1/command".to_owned();
        let operation_id = OperationId::new("battle/1/wave/1/turn/1/command/player/0/seat/1")?;
        assert_eq!(
            projection(1, Some(operation_id.clone()), control.clone(), true),
            Err(BattleUiProjectionError::SeatControl(
                BattleControlError::ControlIdMismatch
            ))
        );

        let encoded =
            serde_json::to_string(&unchecked_projection(1, Some(operation_id), control, true))?;
        assert!(serde_json::from_str::<BattleUiProjection>(&encoded).is_err());
        Ok(())
    }

    #[test]
    fn projection_reconstructs_exact_command_and_replacement_operations()
    -> Result<(), Box<dyn Error>> {
        assert_eq!(
            projection(
                1,
                Some(OperationId::new(
                    "battle/2/wave/1/turn/1/command/player/0/seat/1",
                )?),
                command_control(1)?,
                true,
            ),
            Err(BattleUiProjectionError::SeatControl(
                BattleControlError::DecisionOperationIdMismatch
            ))
        );

        let exact = "RC/e3/b1/w1/t1/o4/f0/s1";
        assert!(
            projection(
                1,
                Some(OperationId::new(exact)?),
                replacement_control(exact)?,
                true,
            )
            .is_ok()
        );

        let mutated = "RC/e3/b1/w1/t1/o5/f0/s1";
        assert_eq!(
            projection(
                1,
                Some(OperationId::new(mutated)?),
                replacement_control(mutated)?,
                true,
            ),
            Err(BattleUiProjectionError::SeatControl(
                BattleControlError::DecisionOperationIdMismatch
            ))
        );
        Ok(())
    }

    #[test]
    fn invalid_projection_wires_are_rejected() -> Result<(), Box<dyn Error>> {
        let operation_id = OperationId::new("battle/1/wave/1/turn/1/command/player/0/seat/1")?;
        let invalid = vec![
            unchecked_projection(1, None, command_control(1)?, false),
            unchecked_projection(1, Some(operation_id.clone()), waiting_control()?, false),
            unchecked_projection(1, Some(operation_id), command_control(2)?, true),
            unchecked_projection(
                1,
                Some(OperationId::new(
                    "battle/2/wave/1/turn/1/command/player/0/seat/1",
                )?),
                command_control(1)?,
                false,
            ),
            unchecked_projection(
                1,
                Some(OperationId::new("RC/e3/b1/w1/t1/o5/f0/s1")?),
                replacement_control("RC/e3/b1/w1/t1/o5/f0/s1")?,
                false,
            ),
            unchecked_projection(1, None, waiting_control()?, true),
            unchecked_projection(
                1,
                None,
                BattleControl::Complete(BattleOutcome::Victory),
                true,
            ),
        ];
        for projection in invalid {
            let encoded = serde_json::to_string(&projection)?;
            assert!(serde_json::from_str::<BattleUiProjection>(&encoded).is_err());
        }
        Ok(())
    }

    #[test]
    fn tagged_presentation_values_are_closed_and_strict() -> Result<(), Box<dyn Error>> {
        assert_eq!(serde_json::to_string(&NavigationDirection::Up)?, "\"UP\"");
        let failed = PresentationSettlementOutcome::failed("renderer-timeout")?;
        assert_eq!(
            serde_json::to_string(&failed)?,
            r#"{"kind":"FAILED","reason":"renderer-timeout"}"#
        );
        assert!(
            serde_json::from_str::<PresentationSettlementOutcome>(
                r#"{"kind":"SETTLED","extra":true}"#
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<BattlePresentationKind>(r#"{"kind":"BATTLE_WON","extra":true}"#)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn typed_presentation_event_round_trips_without_open_payloads() -> Result<(), Box<dyn Error>> {
        let operation_id = crate::ids::OperationId::new("turn/e1/w1/t1/result")?;
        let event = BattlePresentationEvent::new(
            BattlePresentationEventId::new(operation_id, safe(0)?),
            PresentationBlockingPolicy::BlocksHumanInput,
            PresentationSkipPolicy::Allowed,
            BattlePresentationKind::Switched {
                slot: FieldSlot {
                    side: BattleSide::Player,
                    position: 0,
                },
                outgoing: None,
                incoming: crate::battle_ids::PokemonId::new(safe(1)?),
            },
        );
        let encoded = serde_json::to_string(&event)?;
        let decoded: BattlePresentationEvent = serde_json::from_str(&encoded)?;
        assert_eq!(decoded, event);
        assert!(
            serde_json::from_str::<BattlePresentationEvent>(&encoded.replace(
                "\"kind\":\"SWITCHED\"",
                "\"kind\":\"SWITCHED\",\"extra\":true"
            ))
            .is_err()
        );
        Ok(())
    }
}
