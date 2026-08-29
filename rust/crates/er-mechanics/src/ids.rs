use serde::{Deserialize, Serialize};

macro_rules! node_id {
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
        pub struct $name(u16);

        impl $name {
            pub const ZERO: Self = Self(0);

            pub const fn new(value: u16) -> Self {
                Self(value)
            }

            pub const fn get(self) -> u16 {
                self.0
            }

            pub const fn index(self) -> usize {
                self.0 as usize
            }
        }
    };
}

node_id!(ConditionNodeId);
node_id!(SelectorNodeId);
node_id!(ValueNodeId);

#[derive(
    Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct OperationOrdinal(u16);

impl OperationOrdinal {
    pub const ZERO: Self = Self(0);

    pub const fn new(value: u16) -> Self {
        Self(value)
    }

    pub const fn get(self) -> u16 {
        self.0
    }
}
