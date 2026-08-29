//! M3A-02 stable battle identifiers, canonical wire wrappers, and topology.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use crate::ids::{OperationId, SafeU53, SafeU53Error, StringIdError};

/// The largest field position representable by the M3 topology value type.
pub const MAX_FIELD_POSITION: u8 = 2;

/// The largest side capacity representable by the M3 topology value type.
pub const MAX_BATTLE_CAPACITY: u8 = MAX_FIELD_POSITION + 1;

macro_rules! safe_u53_id {
    ($name:ident) => {
        #[derive(
            Clone,
            Copy,
            Debug,
            Default,
            Eq,
            Hash,
            Ord,
            PartialEq,
            PartialOrd,
            Serialize,
            Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(SafeU53);

        impl $name {
            pub const ZERO: Self = Self(SafeU53::ZERO);

            pub const fn new(value: SafeU53) -> Self {
                Self(value)
            }

            pub const fn get(self) -> SafeU53 {
                self.0
            }

            pub const fn into_inner(self) -> SafeU53 {
                self.0
            }

            pub fn try_from_u64(value: u64) -> Result<Self, SafeU53Error> {
                SafeU53::new(value).map(Self::new)
            }
        }

        impl From<SafeU53> for $name {
            fn from(value: SafeU53) -> Self {
                Self::new(value)
            }
        }

        impl From<$name> for SafeU53 {
            fn from(value: $name) -> Self {
                value.get()
            }
        }

        impl From<$name> for u64 {
            fn from(value: $name) -> Self {
                value.get().get()
            }
        }

        impl TryFrom<u64> for $name {
            type Error = SafeU53Error;

            fn try_from(value: u64) -> Result<Self, Self::Error> {
                Self::try_from_u64(value)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

macro_rules! positive_safe_u53_id {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
        #[serde(transparent)]
        pub struct $name(SafeU53);

        impl $name {
            pub fn new(value: SafeU53) -> Result<Self, PositiveIdError> {
                if value == SafeU53::ZERO {
                    Err(PositiveIdError::Zero)
                } else {
                    Ok(Self(value))
                }
            }

            pub const fn get(self) -> SafeU53 {
                self.0
            }

            pub const fn into_inner(self) -> SafeU53 {
                self.0
            }

            pub fn try_from_u64(value: u64) -> Result<Self, PositiveIdError> {
                Self::new(SafeU53::new(value).map_err(PositiveIdError::SafeU53)?)
            }
        }

        impl TryFrom<SafeU53> for $name {
            type Error = PositiveIdError;

            fn try_from(value: SafeU53) -> Result<Self, Self::Error> {
                Self::new(value)
            }
        }

        impl TryFrom<u64> for $name {
            type Error = PositiveIdError;

            fn try_from(value: u64) -> Result<Self, Self::Error> {
                Self::try_from_u64(value)
            }
        }

        impl From<$name> for SafeU53 {
            fn from(value: $name) -> Self {
                value.get()
            }
        }

        impl From<$name> for u64 {
            fn from(value: $name) -> Self {
                value.get().get()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let value = SafeU53::deserialize(deserializer)?;
                Self::new(value).map_err(serde::de::Error::custom)
            }
        }
    };
}

safe_u53_id!(SpeciesId);
safe_u53_id!(MoveId);
safe_u53_id!(AbilityId);
safe_u53_id!(PokemonId);
safe_u53_id!(BattleId);
positive_safe_u53_id!(TurnIndex);
positive_safe_u53_id!(WaveIndex);
safe_u53_id!(GameModeId);
safe_u53_id!(MenuInstanceId);
safe_u53_id!(FaintOccurrenceId);
safe_u53_id!(AuthorityEpoch);

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum PositiveIdError {
    #[error("identifier must be greater than zero")]
    Zero,
    #[error(transparent)]
    SafeU53(#[from] SafeU53Error),
}

/// A non-empty arena-condition identity.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct ArenaConditionId(String);

impl ArenaConditionId {
    pub fn new(value: impl Into<String>) -> Result<Self, StringIdError> {
        let value = value.into();
        if value.is_empty() {
            Err(StringIdError::Empty)
        } else {
            Ok(Self(value))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for ArenaConditionId {
    type Error = StringIdError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl fmt::Display for ArenaConditionId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl<'de> Deserialize<'de> for ArenaConditionId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CanonicalU64DecimalError {
    #[error("canonical u64 decimal must not be empty")]
    Empty,
    #[error("canonical u64 decimal contains a non-ASCII decimal digit at byte {index}")]
    InvalidDigit { index: usize },
    #[error("canonical u64 decimal may not contain a leading zero")]
    LeadingZero,
    #[error("canonical u64 decimal exceeds u64::MAX")]
    Overflow,
}

/// A full-width unsigned integer represented by its canonical decimal text.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct CanonicalU64Decimal(String);

impl CanonicalU64Decimal {
    pub fn new(value: impl Into<String>) -> Result<Self, CanonicalU64DecimalError> {
        let value = value.into();
        validate_canonical_u64_decimal(&value)?;
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }

    pub fn as_u64(&self) -> u64 {
        let mut value = 0_u64;
        for digit in self.0.bytes() {
            value = value * 10 + u64::from(digit - b'0');
        }
        value
    }
}

fn validate_canonical_u64_decimal(value: &str) -> Result<(), CanonicalU64DecimalError> {
    if value.is_empty() {
        return Err(CanonicalU64DecimalError::Empty);
    }
    if value.len() > 1 && value.as_bytes()[0] == b'0' {
        return Err(CanonicalU64DecimalError::LeadingZero);
    }
    for (index, digit) in value.bytes().enumerate() {
        if !digit.is_ascii_digit() {
            return Err(CanonicalU64DecimalError::InvalidDigit { index });
        }
    }
    match value.parse::<u64>() {
        Ok(_) => Ok(()),
        Err(_) => Err(CanonicalU64DecimalError::Overflow),
    }
}

impl TryFrom<String> for CanonicalU64Decimal {
    type Error = CanonicalU64DecimalError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl fmt::Display for CanonicalU64Decimal {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl<'de> Deserialize<'de> for CanonicalU64Decimal {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum CanonicalHexBytesError {
    #[error("canonical hex bytes must have an even number of ASCII characters")]
    OddLength,
    #[error("canonical hex bytes contain an invalid character at byte {index}")]
    InvalidCharacter { index: usize },
}

/// Lowercase, even-length hexadecimal storage for exact opaque bytes.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct CanonicalHexBytes(String);

impl CanonicalHexBytes {
    pub fn new(value: impl Into<String>) -> Result<Self, CanonicalHexBytesError> {
        let value = value.into();
        validate_canonical_hex(&value)?;
        Ok(Self(value))
    }

    pub fn from_bytes(bytes: &[u8]) -> Self {
        let mut value = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            value.push(hex_digit(byte >> 4));
            value.push(hex_digit(byte & 0x0f));
        }
        Self(value)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

fn validate_canonical_hex(value: &str) -> Result<(), CanonicalHexBytesError> {
    if !value.len().is_multiple_of(2) {
        return Err(CanonicalHexBytesError::OddLength);
    }
    for (index, digit) in value.bytes().enumerate() {
        if !matches!(digit, b'0'..=b'9' | b'a'..=b'f') {
            return Err(CanonicalHexBytesError::InvalidCharacter { index });
        }
    }
    Ok(())
}

fn hex_digit(value: u8) -> char {
    match value {
        0..=9 => char::from(b'0' + value),
        10..=15 => char::from(b'a' + (value - 10)),
        _ => '0',
    }
}

impl TryFrom<String> for CanonicalHexBytes {
    type Error = CanonicalHexBytesError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl fmt::Display for CanonicalHexBytes {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl<'de> Deserialize<'de> for CanonicalHexBytes {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ContentPackHashError {
    #[error("content-pack hash must start with blake3-v1:")]
    InvalidPrefix,
    #[error("content-pack hash must contain exactly 64 lowercase hexadecimal digits")]
    InvalidHex,
}

/// The versioned identity of an immutable selected content pack.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct ContentPackHash(String);

impl ContentPackHash {
    pub const PREFIX: &'static str = "blake3-v1:";

    pub fn new(value: impl Into<String>) -> Result<Self, ContentPackHashError> {
        let value = value.into();
        let Some(hex) = value.strip_prefix(Self::PREFIX) else {
            return Err(ContentPackHashError::InvalidPrefix);
        };
        if hex.len() != 64
            || !hex
                .bytes()
                .all(|digit| matches!(digit, b'0'..=b'9' | b'a'..=b'f'))
        {
            return Err(ContentPackHashError::InvalidHex);
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

impl TryFrom<String> for ContentPackHash {
    type Error = ContentPackHashError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl fmt::Display for ContentPackHash {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl<'de> Deserialize<'de> for ContentPackHash {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum SlotIndexError {
    #[error("party index {value} is outside 0..=5")]
    PartyOutOfRange { value: u8 },
    #[error("move slot index {value} is outside 0..=3")]
    MoveSlotOutOfRange { value: u8 },
    #[error("party index {value} cannot be represented as an 8-bit slot")]
    PartyValueTooLarge { value: u64 },
    #[error("move slot index {value} cannot be represented as an 8-bit slot")]
    MoveSlotValueTooLarge { value: u64 },
}

/// A zero-based party position. M3 parties contain at most six members.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct PartyIndex(u8);

impl PartyIndex {
    pub const MAX_VALUE: u8 = 5;
    pub const ZERO: Self = Self(0);

    pub fn new(value: u8) -> Result<Self, SlotIndexError> {
        if value <= Self::MAX_VALUE {
            Ok(Self(value))
        } else {
            Err(SlotIndexError::PartyOutOfRange { value })
        }
    }

    pub const fn get(self) -> u8 {
        self.0
    }

    pub const fn into_inner(self) -> u8 {
        self.0
    }
}

impl TryFrom<u8> for PartyIndex {
    type Error = SlotIndexError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl TryFrom<u64> for PartyIndex {
    type Error = SlotIndexError;

    fn try_from(value: u64) -> Result<Self, Self::Error> {
        let value =
            u8::try_from(value).map_err(|_| SlotIndexError::PartyValueTooLarge { value })?;
        Self::new(value)
    }
}

impl From<PartyIndex> for u8 {
    fn from(value: PartyIndex) -> Self {
        value.get()
    }
}

impl<'de> Deserialize<'de> for PartyIndex {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u8::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

/// A zero-based move position in the canonical four-slot loadout.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct MoveSlotIndex(u8);

impl MoveSlotIndex {
    pub const MAX_VALUE: u8 = 3;
    pub const ZERO: Self = Self(0);

    pub fn new(value: u8) -> Result<Self, SlotIndexError> {
        if value <= Self::MAX_VALUE {
            Ok(Self(value))
        } else {
            Err(SlotIndexError::MoveSlotOutOfRange { value })
        }
    }

    pub const fn get(self) -> u8 {
        self.0
    }

    pub const fn into_inner(self) -> u8 {
        self.0
    }
}

impl TryFrom<u8> for MoveSlotIndex {
    type Error = SlotIndexError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl TryFrom<u64> for MoveSlotIndex {
    type Error = SlotIndexError;

    fn try_from(value: u64) -> Result<Self, Self::Error> {
        let value =
            u8::try_from(value).map_err(|_| SlotIndexError::MoveSlotValueTooLarge { value })?;
        Self::new(value)
    }
}

impl From<MoveSlotIndex> for u8 {
    fn from(value: MoveSlotIndex) -> Self {
        value.get()
    }
}

impl<'de> Deserialize<'de> for MoveSlotIndex {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u8::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BattleSide {
    Player,
    Enemy,
}

impl BattleSide {
    pub const fn opposite(self) -> Self {
        match self {
            Self::Player => Self::Enemy,
            Self::Enemy => Self::Player,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum FieldSlotError {
    #[error("field position {position} is outside 0..={max}")]
    PositionOutOfRange { position: u8, max: u8 },
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
pub struct FieldSlot {
    pub side: BattleSide,
    pub position: u8,
}

impl FieldSlot {
    pub fn new(side: BattleSide, position: u8) -> Result<Self, FieldSlotError> {
        if position <= MAX_FIELD_POSITION {
            Ok(Self { side, position })
        } else {
            Err(FieldSlotError::PositionOutOfRange {
                position,
                max: MAX_FIELD_POSITION,
            })
        }
    }

    pub fn is_before(self, other: Self) -> bool {
        self.side < other.side || (self.side == other.side && self.position < other.position)
    }
}

impl<'de> Deserialize<'de> for FieldSlot {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct FieldSlotWire {
            side: BattleSide,
            position: u8,
        }

        let value = FieldSlotWire::deserialize(deserializer)?;
        Self::new(value.side, value.position).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum AdjacencyEdgeError {
    #[error("adjacency edge endpoints must not be equal: {slot:?}")]
    SelfEdge { slot: FieldSlot },
    #[error("adjacency endpoint {side:?}:{position} is outside 0..={max}")]
    PositionOutOfRange {
        side: BattleSide,
        position: u8,
        max: u8,
    },
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
pub struct AdjacencyEdge {
    pub first: FieldSlot,
    pub second: FieldSlot,
}

impl AdjacencyEdge {
    pub fn new(first: FieldSlot, second: FieldSlot) -> Result<Self, AdjacencyEdgeError> {
        validate_adjacency_slot(first)?;
        validate_adjacency_slot(second)?;
        if first == second {
            return Err(AdjacencyEdgeError::SelfEdge { slot: first });
        }
        if first.is_before(second) {
            Ok(Self { first, second })
        } else {
            Ok(Self {
                first: second,
                second: first,
            })
        }
    }
}

fn validate_adjacency_slot(slot: FieldSlot) -> Result<(), AdjacencyEdgeError> {
    if slot.position <= MAX_FIELD_POSITION {
        Ok(())
    } else {
        Err(AdjacencyEdgeError::PositionOutOfRange {
            side: slot.side,
            position: slot.position,
            max: MAX_FIELD_POSITION,
        })
    }
}

impl<'de> Deserialize<'de> for AdjacencyEdge {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct AdjacencyEdgeWire {
            first: FieldSlot,
            second: FieldSlot,
        }

        let value = AdjacencyEdgeWire::deserialize(deserializer)?;
        Self::new(value.first, value.second).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BattleFormatError {
    #[error("{side:?} capacity must be positive")]
    ZeroCapacity { side: BattleSide },
    #[error("{side:?} capacity {capacity} exceeds the representable maximum {max}")]
    CapacityTooLarge {
        side: BattleSide,
        capacity: u8,
        max: u8,
    },
    #[error("invalid adjacency edge: {0}")]
    InvalidAdjacency(#[from] AdjacencyEdgeError),
    #[error("adjacency endpoint {side:?}:{position} is outside that side's capacity {capacity}")]
    AdjacencyOutOfRange {
        side: BattleSide,
        position: u8,
        capacity: u8,
    },
    #[error("duplicate adjacency edge: {edge:?}")]
    DuplicateAdjacency { edge: AdjacencyEdge },
    #[error("M3 does not support capacities {player_capacity}/{enemy_capacity}")]
    UnsupportedCapacity {
        player_capacity: u8,
        enemy_capacity: u8,
    },
    #[error("adjacency does not match a supported M3 topology")]
    UnsupportedTopology,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct BattleFormat {
    pub player_capacity: u8,
    pub enemy_capacity: u8,
    pub adjacency: Vec<AdjacencyEdge>,
}

impl BattleFormat {
    /// Builds a validated topology representation. Capacity three is
    /// representable here; M3 initialization is checked separately.
    pub fn new(
        player_capacity: u8,
        enemy_capacity: u8,
        adjacency: Vec<AdjacencyEdge>,
    ) -> Result<Self, BattleFormatError> {
        validate_capacity(BattleSide::Player, player_capacity)?;
        validate_capacity(BattleSide::Enemy, enemy_capacity)?;

        let mut normalized = Vec::with_capacity(adjacency.len());
        for edge in adjacency {
            let edge = AdjacencyEdge::new(edge.first, edge.second)?;
            validate_edge_capacity(edge.first, player_capacity, enemy_capacity)?;
            validate_edge_capacity(edge.second, player_capacity, enemy_capacity)?;
            normalized.push(edge);
        }
        normalized.sort_unstable();
        for pair in normalized.windows(2) {
            if pair[0] == pair[1] {
                return Err(BattleFormatError::DuplicateAdjacency { edge: pair[1] });
            }
        }

        Ok(Self {
            player_capacity,
            enemy_capacity,
            adjacency: normalized,
        })
    }

    pub fn single() -> Self {
        Self {
            player_capacity: 1,
            enemy_capacity: 1,
            adjacency: vec![canonical_edge(
                FieldSlot {
                    side: BattleSide::Player,
                    position: 0,
                },
                FieldSlot {
                    side: BattleSide::Enemy,
                    position: 0,
                },
            )],
        }
    }

    pub fn singles() -> Self {
        Self::single()
    }

    pub fn coop_double() -> Self {
        let player_zero = FieldSlot {
            side: BattleSide::Player,
            position: 0,
        };
        let player_one = FieldSlot {
            side: BattleSide::Player,
            position: 1,
        };
        let enemy_zero = FieldSlot {
            side: BattleSide::Enemy,
            position: 0,
        };
        let enemy_one = FieldSlot {
            side: BattleSide::Enemy,
            position: 1,
        };
        Self {
            player_capacity: 2,
            enemy_capacity: 2,
            adjacency: vec![
                canonical_edge(player_zero, player_one),
                canonical_edge(player_zero, enemy_zero),
                canonical_edge(player_zero, enemy_one),
                canonical_edge(player_one, enemy_zero),
                canonical_edge(player_one, enemy_one),
                canonical_edge(enemy_zero, enemy_one),
            ],
        }
    }

    pub fn forced_coop_doubles() -> Self {
        Self::coop_double()
    }

    pub fn validate_m3_supported(&self) -> Result<(), BattleFormatError> {
        match (self.player_capacity, self.enemy_capacity) {
            (1, 1) if self == &Self::single() => Ok(()),
            (2, 2) if self == &Self::coop_double() => Ok(()),
            (1, 1) | (2, 2) => Err(BattleFormatError::UnsupportedTopology),
            (player_capacity, enemy_capacity) => Err(BattleFormatError::UnsupportedCapacity {
                player_capacity,
                enemy_capacity,
            }),
        }
    }

    pub fn is_m3_supported(&self) -> bool {
        self.validate_m3_supported().is_ok()
    }
}

fn validate_capacity(side: BattleSide, capacity: u8) -> Result<(), BattleFormatError> {
    if capacity == 0 {
        Err(BattleFormatError::ZeroCapacity { side })
    } else if capacity > MAX_BATTLE_CAPACITY {
        Err(BattleFormatError::CapacityTooLarge {
            side,
            capacity,
            max: MAX_BATTLE_CAPACITY,
        })
    } else {
        Ok(())
    }
}

fn validate_edge_capacity(
    slot: FieldSlot,
    player_capacity: u8,
    enemy_capacity: u8,
) -> Result<(), BattleFormatError> {
    let capacity = match slot.side {
        BattleSide::Player => player_capacity,
        BattleSide::Enemy => enemy_capacity,
    };
    if slot.position < capacity {
        Ok(())
    } else {
        Err(BattleFormatError::AdjacencyOutOfRange {
            side: slot.side,
            position: slot.position,
            capacity,
        })
    }
}

fn canonical_edge(first: FieldSlot, second: FieldSlot) -> AdjacencyEdge {
    if first.is_before(second) {
        AdjacencyEdge { first, second }
    } else {
        AdjacencyEdge {
            first: second,
            second: first,
        }
    }
}

impl<'de> Deserialize<'de> for BattleFormat {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct BattleFormatWire {
            player_capacity: u8,
            enemy_capacity: u8,
            adjacency: Vec<AdjacencyEdge>,
        }

        let value = BattleFormatWire::deserialize(deserializer)?;
        Self::new(value.player_capacity, value.enemy_capacity, value.adjacency)
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattlePresentationEventId {
    pub operation_id: OperationId,
    pub sequence: SafeU53,
}

impl BattlePresentationEventId {
    pub const fn new(operation_id: OperationId, sequence: SafeU53) -> Self {
        Self {
            operation_id,
            sequence,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::DeserializeOwned;

    fn round_trip<T>(value: &T) -> Result<T, serde_json::Error>
    where
        T: DeserializeOwned + Serialize,
    {
        let encoded = serde_json::to_string(value)?;
        serde_json::from_str(&encoded)
    }

    #[test]
    fn safe_u53_ids_cover_zero_maximum_and_overflow() {
        let max = SpeciesId::new(SafeU53::MAX);
        assert_eq!(max.get(), SafeU53::MAX);
        assert_eq!(SpeciesId::new(SafeU53::ZERO), SpeciesId::ZERO);
        assert!(SpeciesId::try_from_u64(9_007_199_254_740_992).is_err());
        assert!(serde_json::from_str::<SpeciesId>("9007199254740992").is_err());
        assert!(serde_json::from_str::<SpeciesId>("-1").is_err());
        assert!(serde_json::from_str::<SpeciesId>("1.5").is_err());
        let decoded = serde_json::from_str::<SpeciesId>("0");
        assert_eq!(decoded.ok(), Some(SpeciesId::ZERO));
    }

    #[test]
    fn every_non_positive_battle_id_round_trips_at_both_safe_boundaries() {
        macro_rules! check_id {
            ($id:ty) => {
                let zero = <$id>::new(SafeU53::ZERO);
                let max = <$id>::new(SafeU53::MAX);
                assert_eq!(round_trip(&zero).ok(), Some(zero));
                assert_eq!(round_trip(&max).ok(), Some(max));
            };
        }

        check_id!(SpeciesId);
        check_id!(MoveId);
        check_id!(AbilityId);
        check_id!(PokemonId);
        check_id!(BattleId);
        check_id!(GameModeId);
        check_id!(MenuInstanceId);
        check_id!(FaintOccurrenceId);
        check_id!(AuthorityEpoch);
    }

    #[test]
    fn positive_indices_reject_zero_and_preserve_the_safe_boundary() {
        assert_eq!(TurnIndex::new(SafeU53::ZERO), Err(PositiveIdError::Zero));
        assert_eq!(WaveIndex::new(SafeU53::ZERO), Err(PositiveIdError::Zero));
        assert!(TurnIndex::new(SafeU53::MAX).is_ok());
        assert!(WaveIndex::try_from_u64(9_007_199_254_740_992).is_err());
        assert!(serde_json::from_str::<TurnIndex>("0").is_err());
        assert!(serde_json::from_str::<WaveIndex>("-1").is_err());
        assert!(serde_json::from_str::<TurnIndex>("9007199254740992").is_err());
    }

    #[test]
    fn canonical_full_width_wrappers_reject_noncanonical_text() {
        let max = CanonicalU64Decimal::new("18446744073709551615");
        assert!(max.is_ok());
        if let Ok(value) = max {
            assert_eq!(value.as_u64(), u64::MAX);
            assert_eq!(round_trip(&value).ok(), Some(value));
        }
        for value in [
            "",
            "00",
            "01",
            "+1",
            "-1",
            "1.0",
            "1e3",
            "18446744073709551616",
            "１２",
        ] {
            assert!(CanonicalU64Decimal::new(value).is_err(), "accepted {value}");
            let json = format!("\"{value}\"");
            assert!(serde_json::from_str::<CanonicalU64Decimal>(&json).is_err());
        }

        assert_eq!(
            CanonicalHexBytes::new("".to_owned())
                .ok()
                .map(|value| value.as_str().to_owned()),
            Some(String::new())
        );
        assert!(CanonicalHexBytes::new("00a1ff".to_owned()).is_ok());
        assert_eq!(
            CanonicalHexBytes::from_bytes(&[0x00, 0xa1, 0xff]).as_str(),
            "00a1ff"
        );
        for value in ["0", "0x00", "00A1", "00a", "00 a1", "gg"] {
            assert!(
                CanonicalHexBytes::new(value.to_owned()).is_err(),
                "accepted {value}"
            );
            let json = format!("\"{value}\"");
            assert!(serde_json::from_str::<CanonicalHexBytes>(&json).is_err());
        }
    }

    #[test]
    fn content_pack_hash_requires_the_frozen_blake3_shape() {
        let valid = format!("{}{}", ContentPackHash::PREFIX, "a".repeat(64));
        let hash = ContentPackHash::new(valid.clone());
        assert!(hash.is_ok());
        if let Ok(hash) = hash {
            assert_eq!(hash.as_str(), valid);
            assert_eq!(round_trip(&hash).ok(), Some(hash));
        }
        for value in [
            "",
            "blake3-v1:",
            "blake3-v2:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "blake3-v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "blake3-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ] {
            assert!(ContentPackHash::new(value).is_err(), "accepted {value}");
        }
    }

    #[test]
    fn arena_condition_ids_are_non_empty_string_wrappers() {
        assert_eq!(ArenaConditionId::new(""), Err(StringIdError::Empty));
        let condition = ArenaConditionId::new("m3/condition");
        assert!(condition.is_ok());
        if let Ok(condition) = condition {
            assert_eq!(round_trip(&condition).ok(), Some(condition));
        }
        assert!(serde_json::from_str::<ArenaConditionId>("\"\"").is_err());
        assert!(serde_json::from_str::<ArenaConditionId>("7").is_err());
    }

    #[test]
    fn party_and_move_slots_enforce_their_closed_bounds() {
        assert_eq!(PartyIndex::new(0).ok().map(PartyIndex::get), Some(0));
        assert_eq!(PartyIndex::new(5).ok().map(PartyIndex::get), Some(5));
        assert!(PartyIndex::new(6).is_err());
        assert_eq!(MoveSlotIndex::new(0).ok().map(MoveSlotIndex::get), Some(0));
        assert_eq!(MoveSlotIndex::new(3).ok().map(MoveSlotIndex::get), Some(3));
        assert!(MoveSlotIndex::new(4).is_err());
        assert!(serde_json::from_str::<PartyIndex>("6").is_err());
        assert!(serde_json::from_str::<MoveSlotIndex>("4").is_err());
        assert!(serde_json::from_str::<PartyIndex>("-1").is_err());
        assert!(serde_json::from_str::<MoveSlotIndex>("1.0").is_err());
    }

    #[test]
    fn adjacency_normalizes_and_rejects_self_or_out_of_range_slots() {
        let player = FieldSlot {
            side: BattleSide::Player,
            position: 0,
        };
        let enemy = FieldSlot {
            side: BattleSide::Enemy,
            position: 0,
        };
        let edge = AdjacencyEdge::new(enemy, player);
        assert_eq!(edge.map(|edge| edge.first), Ok(player));
        assert_eq!(edge.map(|edge| edge.second), Ok(enemy));
        assert!(AdjacencyEdge::new(player, player).is_err());
        assert!(FieldSlot::new(BattleSide::Player, 3).is_err());
        assert!(
            AdjacencyEdge::new(
                FieldSlot {
                    side: BattleSide::Player,
                    position: 3,
                },
                enemy,
            )
            .is_err()
        );
        let reversed_json =
            r#"{"first":{"side":"ENEMY","position":0},"second":{"side":"PLAYER","position":0}}"#;
        let decoded = serde_json::from_str::<AdjacencyEdge>(reversed_json);
        assert_eq!(decoded.map(|edge| edge.first).ok(), Some(player));
    }

    #[test]
    fn battle_format_normalizes_sorts_and_validates_edges() {
        let player_zero = FieldSlot {
            side: BattleSide::Player,
            position: 0,
        };
        let enemy_zero = FieldSlot {
            side: BattleSide::Enemy,
            position: 0,
        };
        let edge = AdjacencyEdge {
            first: enemy_zero,
            second: player_zero,
        };
        let format = BattleFormat::new(1, 1, vec![edge]);
        assert_eq!(
            format.as_ref().map(|value| value.adjacency[0].first),
            Ok(player_zero)
        );
        assert_eq!(
            format.as_ref().map(|value| value.adjacency[0].second),
            Ok(enemy_zero)
        );
        assert!(BattleFormat::new(1, 1, vec![edge, edge]).is_err());
        assert!(
            BattleFormat::new(
                1,
                1,
                vec![AdjacencyEdge {
                    first: player_zero,
                    second: player_zero,
                }],
            )
            .is_err()
        );
        assert!(
            BattleFormat::new(
                1,
                1,
                vec![AdjacencyEdge {
                    first: FieldSlot {
                        side: BattleSide::Player,
                        position: 1,
                    },
                    second: enemy_zero,
                }],
            )
            .is_err()
        );
        assert!(BattleFormat::new(0, 1, Vec::new()).is_err());
        assert!(BattleFormat::new(4, 1, Vec::new()).is_err());
    }

    #[test]
    fn supported_m3_formats_match_the_frozen_topologies() {
        let single = BattleFormat::single();
        assert!(single.is_m3_supported());
        assert_eq!(single.adjacency.len(), 1);
        assert_eq!(BattleFormat::singles(), single);

        let doubles = BattleFormat::coop_double();
        assert!(doubles.is_m3_supported());
        assert_eq!(doubles.adjacency.len(), 6);
        assert_eq!(BattleFormat::forced_coop_doubles(), doubles);

        let representable_triple = BattleFormat::new(3, 3, Vec::new());
        assert!(representable_triple.is_ok());
        if let Ok(format) = representable_triple {
            assert!(format.validate_m3_supported().is_err());
        }
        assert!(
            BattleFormat::new(1, 2, Vec::new())
                .and_then(|format| format.validate_m3_supported().map(|()| format))
                .is_err()
        );
    }

    #[test]
    fn topology_and_presentation_ids_round_trip_and_reject_unknown_fields() {
        let operation = OperationId::new("turn/e1/w1/t1/result");
        assert!(operation.is_ok());
        let Some(operation) = operation.ok() else {
            return;
        };
        let event = BattlePresentationEventId::new(operation, SafeU53::ZERO);
        assert_eq!(round_trip(&event).ok(), Some(event.clone()));
        let unknown = r#"{"operation_id":"turn/e1/w1/t1/result","sequence":0,"extra":true}"#;
        assert!(serde_json::from_str::<BattlePresentationEventId>(unknown).is_err());
        assert!(
            serde_json::from_str::<FieldSlot>(r#"{"side":"PLAYER","position":0,"extra":true}"#,)
                .is_err()
        );

        let single = BattleFormat::single();
        assert_eq!(round_trip(&single).ok(), Some(single));
        assert!(
            serde_json::from_str::<BattleFormat>(
                r#"{"player_capacity":1,"enemy_capacity":1,"adjacency":[],"extra":true}"#,
            )
            .is_err()
        );
    }
}
