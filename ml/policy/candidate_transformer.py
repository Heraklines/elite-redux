"""ER-native candidate-set policy/value network."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import torch
from torch import Tensor, nn
from torch.nn import functional as F


@dataclass(frozen=True)
class CandidateTransformerConfig:
    feature_count: int
    token_vocabulary_size: int
    token_group_count: int = 5
    domain_count: int = 2
    d_model: int = 320
    layers: int = 4
    heads: int = 8
    feedforward: int = 960
    dropout: float = 0.0
    history_length: int = 8
    trajectory_layers: int = 2


class CandidateSetTransformer(nn.Module):
    """Scores a legal candidate set without depending on candidate order."""

    def __init__(
        self,
        config: CandidateTransformerConfig,
        feature_mean: Tensor | None = None,
        feature_std: Tensor | None = None,
    ) -> None:
        super().__init__()
        self.config = config
        mean = torch.zeros(config.feature_count) if feature_mean is None else feature_mean.float()
        std = torch.ones(config.feature_count) if feature_std is None else feature_std.float()
        self.register_buffer("feature_mean", mean)
        self.register_buffer("feature_std", std.clamp_min(1e-6))
        if config.token_vocabulary_size < 2:
            raise ValueError("token_vocabulary_size must include PAD and UNK")
        if config.token_group_count < 1:
            raise ValueError("token_group_count must be positive")
        if config.domain_count < 1:
            raise ValueError("domain_count must be positive")
        if config.history_length < 0:
            raise ValueError("history_length must be non-negative")
        if config.trajectory_layers < 1:
            raise ValueError("trajectory_layers must be positive")
        self.input_projection = nn.Sequential(
            nn.Linear(config.feature_count, config.d_model),
            nn.GELU(),
            nn.LayerNorm(config.d_model),
        )
        self.normalization_presence_projection = nn.Linear(config.feature_count, config.d_model, bias=False)
        nn.init.zeros_(self.normalization_presence_projection.weight)
        self.feature_presence_projection = nn.Linear(config.feature_count, config.d_model, bias=False)
        self.domain_embedding = nn.Embedding(config.domain_count, config.d_model)
        self.token_embedding = nn.Embedding(config.token_vocabulary_size, config.d_model, padding_idx=0)
        self.token_group_embedding = nn.Embedding(config.token_group_count, config.d_model)
        self.token_projection = nn.Sequential(
            nn.Linear(config.token_group_count * config.d_model, config.d_model),
            nn.GELU(),
            nn.LayerNorm(config.d_model),
        )
        layer = nn.TransformerEncoderLayer(
            d_model=config.d_model,
            nhead=config.heads,
            dim_feedforward=config.feedforward,
            dropout=config.dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(
            layer,
            num_layers=config.layers,
            norm=nn.LayerNorm(config.d_model),
            enable_nested_tensor=False,
        )
        trajectory_layer = nn.TransformerEncoderLayer(
            d_model=config.d_model,
            nhead=config.heads,
            dim_feedforward=config.feedforward,
            dropout=config.dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.trajectory_position_embedding = nn.Embedding(config.history_length + 1, config.d_model)
        self.trajectory_step_embedding = nn.Embedding(3, config.d_model)
        self.trajectory_encoder = nn.TransformerEncoder(
            trajectory_layer,
            num_layers=config.trajectory_layers,
            norm=nn.LayerNorm(config.d_model),
            enable_nested_tensor=False,
        )
        self.policy_head = nn.Sequential(
            nn.LayerNorm(config.d_model),
            nn.Linear(config.d_model, config.d_model // 2),
            nn.GELU(),
            nn.Linear(config.d_model // 2, 1),
        )
        self.value_head = nn.Sequential(
            nn.LayerNorm(config.d_model),
            nn.Linear(config.d_model, config.d_model // 2),
            nn.GELU(),
            nn.Linear(config.d_model // 2, 1),
        )

    def forward(
        self,
        candidate_features: Tensor,
        candidate_mask: Tensor,
        token_ids: Tensor,
        token_mask: Tensor,
        history_features: Tensor | None = None,
        history_candidate_mask: Tensor | None = None,
        history_token_ids: Tensor | None = None,
        history_token_mask: Tensor | None = None,
        history_chosen: Tensor | None = None,
        history_step_mask: Tensor | None = None,
        feature_presence: Tensor | None = None,
        domain_ids: Tensor | None = None,
        history_feature_presence: Tensor | None = None,
        history_domain_ids: Tensor | None = None,
    ) -> tuple[Tensor, Tensor]:
        encoded = self.encode_candidates(
            candidate_features,
            candidate_mask,
            token_ids,
            token_mask,
            feature_presence,
            domain_ids,
        )
        current_mask = candidate_mask.unsqueeze(-1).to(encoded.dtype)
        current_context = (encoded * current_mask).sum(dim=1) / current_mask.sum(dim=1).clamp_min(1)

        if history_features is not None and (
            history_features.ndim != 4 or history_features.shape[0] != candidate_features.shape[0]
        ):
            raise ValueError("history_features must have shape [batch, history, candidates, features]")
        if history_features is None or history_features.shape[1] == 0:
            history_encoded = encoded.new_zeros((encoded.shape[0], 0, encoded.shape[-1]))
            history_step_mask = candidate_mask.new_zeros((encoded.shape[0], 0))
        else:
            required = (
                history_candidate_mask,
                history_token_ids,
                history_token_mask,
                history_chosen,
                history_step_mask,
            )
            if any(value is None for value in required):
                raise ValueError("all history tensors are required when history_features is provided")
            batch_size, history_steps, history_candidates, feature_count = history_features.shape
            if feature_count != self.config.feature_count:
                raise ValueError(f"history feature width must be {self.config.feature_count}")
            if history_steps > self.config.history_length:
                raise ValueError(f"history contains {history_steps} steps, maximum is {self.config.history_length}")
            if history_candidate_mask.shape != history_features.shape[:3]:
                raise ValueError("history_candidate_mask must match history batch/step/candidate dimensions")
            if history_token_ids.ndim != 5 or history_token_ids.shape[:3] != history_features.shape[:3]:
                raise ValueError("history_token_ids must have shape [batch, history, candidates, groups, tokens]")
            if history_token_ids.shape[3] != self.config.token_group_count:
                raise ValueError(f"history_token_ids must contain {self.config.token_group_count} groups")
            if history_token_mask.shape != history_token_ids.shape:
                raise ValueError("history_token_mask must match history_token_ids")
            if history_chosen.shape != (batch_size, history_steps):
                raise ValueError("history_chosen must match history batch/step dimensions")
            if history_step_mask.shape != (batch_size, history_steps):
                raise ValueError("history_step_mask must match history batch/step dimensions")

            safe_candidate_mask = history_candidate_mask.clone()
            safe_history_features = history_features.clone()
            safe_history_presence = (
                torch.ones_like(history_features, dtype=torch.bool)
                if history_feature_presence is None
                else history_feature_presence.clone()
            )
            if safe_history_presence.shape != history_features.shape:
                raise ValueError("history_feature_presence must match history_features")
            if history_domain_ids is None:
                base_domains = (
                    torch.zeros(batch_size, dtype=torch.long, device=history_features.device)
                    if domain_ids is None
                    else domain_ids
                )
                history_domain_ids = base_domains[:, None].expand(-1, history_steps)
            if history_domain_ids.shape != (batch_size, history_steps):
                raise ValueError("history_domain_ids must match history batch/step dimensions")
            padded_steps = ~history_step_mask
            if bool(padded_steps.any()):
                safe_candidate_mask[:, :, 0] |= padded_steps
                safe_history_features[:, :, 0, :] = torch.where(
                    padded_steps[:, :, None],
                    self.feature_mean[None, None, :],
                    safe_history_features[:, :, 0, :],
                )
                safe_history_presence[:, :, 0, :] &= ~padded_steps[:, :, None]
            flattened = self.encode_candidates(
                safe_history_features.reshape(batch_size * history_steps, history_candidates, feature_count),
                safe_candidate_mask.reshape(batch_size * history_steps, history_candidates),
                history_token_ids.reshape(
                    batch_size * history_steps,
                    history_candidates,
                    self.config.token_group_count,
                    history_token_ids.shape[-1],
                ),
                history_token_mask.reshape(
                    batch_size * history_steps,
                    history_candidates,
                    self.config.token_group_count,
                    history_token_mask.shape[-1],
                ),
                safe_history_presence.reshape(batch_size * history_steps, history_candidates, feature_count),
                history_domain_ids.reshape(batch_size * history_steps),
            ).reshape(batch_size, history_steps, history_candidates, self.config.d_model)
            gather_index = history_chosen[:, :, None, None].expand(-1, -1, 1, self.config.d_model)
            history_encoded = flattened.gather(2, gather_index).squeeze(2)

        trajectory = torch.cat([history_encoded, current_context.unsqueeze(1)], dim=1)
        history_steps = history_encoded.shape[1]
        position_start = self.config.history_length - history_steps
        position_ids = torch.arange(position_start, self.config.history_length + 1, device=trajectory.device)
        history_step_ids = torch.where(
            history_step_mask,
            torch.zeros_like(history_step_mask, dtype=torch.long),
            torch.full_like(history_step_mask, 2, dtype=torch.long),
        )
        step_ids = torch.cat(
            [history_step_ids, torch.ones((trajectory.shape[0], 1), dtype=torch.long, device=trajectory.device)],
            dim=1,
        )
        trajectory = (
            trajectory
            + self.trajectory_position_embedding(position_ids)[None, :, :]
            + self.trajectory_step_embedding(step_ids)
        )
        causal_mask = torch.triu(
            torch.ones((history_steps + 1, history_steps + 1), dtype=torch.bool, device=trajectory.device),
            diagonal=1,
        )
        trajectory = self.trajectory_encoder(
            trajectory,
            mask=causal_mask,
        )
        context = trajectory[:, -1]
        policy_logits = self.policy_head(encoded + context.unsqueeze(1)).squeeze(-1)
        policy_logits = policy_logits.masked_fill(~candidate_mask, torch.finfo(policy_logits.dtype).min)
        value_logits = self.value_head(context).squeeze(-1)
        return policy_logits, value_logits

    def encode_candidates(
        self,
        candidate_features: Tensor,
        candidate_mask: Tensor,
        token_ids: Tensor,
        token_mask: Tensor,
        feature_presence: Tensor | None = None,
        domain_ids: Tensor | None = None,
    ) -> Tensor:
        if candidate_features.ndim != 3:
            raise ValueError("candidate_features must have shape [batch, candidates, features]")
        if candidate_mask.shape != candidate_features.shape[:2]:
            raise ValueError("candidate_mask must match the batch/candidate dimensions")
        if token_ids.ndim != 4 or token_ids.shape[:2] != candidate_features.shape[:2]:
            raise ValueError("token_ids must have shape [batch, candidates, groups, tokens]")
        if token_ids.shape[2] != self.config.token_group_count:
            raise ValueError(f"token_ids must contain {self.config.token_group_count} groups")
        if token_mask.shape != token_ids.shape:
            raise ValueError("token_mask must match token_ids")
        if feature_presence is None:
            feature_presence = torch.ones_like(candidate_features, dtype=torch.bool)
        if feature_presence.shape != candidate_features.shape:
            raise ValueError("feature_presence must match candidate_features")
        if domain_ids is None:
            domain_ids = torch.zeros(candidate_features.shape[0], dtype=torch.long, device=candidate_features.device)
        if domain_ids.shape != (candidate_features.shape[0],):
            raise ValueError("domain_ids must have shape [batch]")
        if bool(((domain_ids < 0) | (domain_ids >= self.config.domain_count)).any()):
            raise ValueError(f"domain_ids must be in [0, {self.config.domain_count})")
        normalized = (candidate_features - self.feature_mean) / self.feature_std
        normalized = normalized.masked_fill(~feature_presence, 0)
        normalized = normalized.masked_fill(~candidate_mask.unsqueeze(-1), 0)
        visible_presence = feature_presence & candidate_mask.unsqueeze(-1)
        normalized_projection = self.input_projection[0](normalized) + self.normalization_presence_projection(
            visible_presence.to(normalized.dtype)
        )
        dense_encoded = (
            self.input_projection[2](self.input_projection[1](normalized_projection))
            + self.feature_presence_projection(visible_presence.to(normalized.dtype))
            + self.domain_embedding(domain_ids).unsqueeze(1)
        )
        pooled_groups = self._pool_token_groups(token_ids, token_mask)
        token_encoded = self.token_projection(pooled_groups.flatten(start_dim=2))
        encoded = dense_encoded + token_encoded
        return self.encoder(encoded, src_key_padding_mask=~candidate_mask)

    def _pool_token_groups(self, token_ids: Tensor, token_mask: Tensor) -> Tensor:
        """Mean-pool token roles without materializing every token embedding."""
        masked_token_ids = token_ids.masked_fill(~token_mask, self.token_embedding.padding_idx)
        flat_token_ids = masked_token_ids.reshape(-1, masked_token_ids.shape[-1])
        pooled_groups = F.embedding_bag(
            flat_token_ids,
            self.token_embedding.weight,
            mode="sum",
            padding_idx=self.token_embedding.padding_idx,
        ).reshape(*token_ids.shape[:-1], self.config.d_model)
        token_counts = token_mask.sum(dim=-1, keepdim=True).clamp_min(1).to(pooled_groups.dtype)
        pooled_groups = pooled_groups / token_counts
        group_ids = torch.arange(self.config.token_group_count, device=token_ids.device)
        group_embeddings = self.token_group_embedding(group_ids)
        group_shape = (1,) * (token_ids.ndim - 2) + group_embeddings.shape
        nonempty_groups = token_mask.any(dim=-1, keepdim=True).to(pooled_groups.dtype)
        return pooled_groups + group_embeddings.reshape(group_shape) * nonempty_groups


def parameter_count(model: nn.Module) -> int:
    return sum(parameter.numel() for parameter in model.parameters())


def load_compatible_state_dict(model: CandidateSetTransformer, state_dict: Mapping[str, Tensor]) -> bool:
    """Load schema-v4 weights, accepting only the pre-rebase projection omission."""
    result = model.load_state_dict(state_dict, strict=False)
    allowed_missing = {"normalization_presence_projection.weight"}
    missing = set(result.missing_keys)
    unexpected = set(result.unexpected_keys)
    if missing - allowed_missing or unexpected:
        raise RuntimeError(
            f"incompatible candidate-transformer weights: missing={sorted(missing)}, unexpected={sorted(unexpected)}"
        )
    return bool(missing)
