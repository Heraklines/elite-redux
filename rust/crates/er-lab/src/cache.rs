//! Complete-key hermetic cache; any unknown identity disables reuse.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum CacheIdentityPartV1 {
    Known(String),
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompleteCacheKeyV1 {
    pub source_revision: CacheIdentityPartV1,
    pub cargo_lock: CacheIdentityPartV1,
    pub toolchain: CacheIdentityPartV1,
    pub target: CacheIdentityPartV1,
    pub profile: CacheIdentityPartV1,
    pub features: CacheIdentityPartV1,
    pub environment: CacheIdentityPartV1,
    pub content_identity: CacheIdentityPartV1,
    pub scenario_digest: CacheIdentityPartV1,
    pub operation: CacheIdentityPartV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HermeticCacheEntryV1 {
    pub key_digest: String,
    pub payload_digest: String,
    pub bytes: Vec<u8>,
    pub insertion_ordinal: u64,
    pub pinned: bool,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum HermeticCacheErrorV1 {
    #[error("cache bound, identity, or payload is invalid")]
    Invalid,
    #[error("cache has no legal eviction")]
    Capacity,
    #[error("cache payload integrity check failed")]
    Integrity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HermeticCacheV1 {
    maximum_entries: usize,
    maximum_bytes: usize,
    retained_bytes: usize,
    next_ordinal: u64,
    entries: BTreeMap<String, HermeticCacheEntryV1>,
}

impl CompleteCacheKeyV1 {
    pub fn digest(&self) -> Result<Option<String>, HermeticCacheErrorV1> {
        let parts = [
            &self.source_revision,
            &self.cargo_lock,
            &self.toolchain,
            &self.target,
            &self.profile,
            &self.features,
            &self.environment,
            &self.content_identity,
            &self.scenario_digest,
            &self.operation,
        ];
        if parts
            .iter()
            .any(|part| matches!(part, CacheIdentityPartV1::Unknown))
        {
            return Ok(None);
        }
        if parts
            .iter()
            .any(|part| matches!(part, CacheIdentityPartV1::Known(value) if value.is_empty()))
        {
            return Err(HermeticCacheErrorV1::Invalid);
        }
        let bytes =
            er_canonical::canonical_bytes(&self).map_err(|_| HermeticCacheErrorV1::Invalid)?;
        Ok(Some(format!("blake3-v1:{}", blake3::hash(&bytes).to_hex())))
    }
}

impl HermeticCacheV1 {
    pub fn new(maximum_entries: usize, maximum_bytes: usize) -> Result<Self, HermeticCacheErrorV1> {
        if maximum_entries == 0 || maximum_bytes == 0 {
            return Err(HermeticCacheErrorV1::Invalid);
        }
        Ok(Self {
            maximum_entries,
            maximum_bytes,
            retained_bytes: 0,
            next_ordinal: 0,
            entries: BTreeMap::new(),
        })
    }

    pub fn insert(
        &mut self,
        key: &CompleteCacheKeyV1,
        bytes: Vec<u8>,
        pinned: bool,
    ) -> Result<bool, HermeticCacheErrorV1> {
        let Some(key_digest) = key.digest()? else {
            return Ok(false);
        };
        if bytes.is_empty() || bytes.len() > self.maximum_bytes {
            return Err(HermeticCacheErrorV1::Invalid);
        }
        let payload_digest = format!("blake3-v1:{}", blake3::hash(&bytes).to_hex());
        if let Some(existing) = self.entries.get(&key_digest) {
            return if existing.payload_digest == payload_digest && existing.bytes == bytes {
                Ok(false)
            } else {
                Err(HermeticCacheErrorV1::Integrity)
            };
        }
        while self.entries.len() == self.maximum_entries
            || self
                .retained_bytes
                .checked_add(bytes.len())
                .is_none_or(|size| size > self.maximum_bytes)
        {
            let victim = self
                .entries
                .values()
                .filter(|entry| !entry.pinned)
                .min_by_key(|entry| entry.insertion_ordinal)
                .map(|entry| entry.key_digest.clone())
                .ok_or(HermeticCacheErrorV1::Capacity)?;
            let removed = self
                .entries
                .remove(&victim)
                .ok_or(HermeticCacheErrorV1::Capacity)?;
            self.retained_bytes = self
                .retained_bytes
                .checked_sub(removed.bytes.len())
                .ok_or(HermeticCacheErrorV1::Integrity)?;
        }
        let ordinal = self.next_ordinal;
        self.next_ordinal = self
            .next_ordinal
            .checked_add(1)
            .ok_or(HermeticCacheErrorV1::Capacity)?;
        self.retained_bytes = self
            .retained_bytes
            .checked_add(bytes.len())
            .ok_or(HermeticCacheErrorV1::Capacity)?;
        self.entries.insert(
            key_digest.clone(),
            HermeticCacheEntryV1 {
                key_digest,
                payload_digest,
                bytes,
                insertion_ordinal: ordinal,
                pinned,
            },
        );
        Ok(true)
    }

    pub fn get(&self, key: &CompleteCacheKeyV1) -> Result<Option<&[u8]>, HermeticCacheErrorV1> {
        let Some(digest) = key.digest()? else {
            return Ok(None);
        };
        let Some(entry) = self.entries.get(&digest) else {
            return Ok(None);
        };
        if format!("blake3-v1:{}", blake3::hash(&entry.bytes).to_hex()) != entry.payload_digest {
            return Err(HermeticCacheErrorV1::Integrity);
        }
        Ok(Some(&entry.bytes))
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.retained_bytes = 0;
    }
}
