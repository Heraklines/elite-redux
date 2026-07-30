"""ER-native candidate-set policy/value network."""

from __future__ import annotations

from dataclasses import dataclass

import torch
from torch import Tensor, nn


@dataclass(frozen=True)
class CandidateTransformerConfig:
    feature_count: int
    d_model: int = 320
    layers: int = 4
    heads: int = 8
    feedforward: int = 960
    dropout: float = 0.0


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
        self.input_projection = nn.Sequential(
            nn.Linear(config.feature_count, config.d_model),
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

    def forward(self, candidate_features: Tensor, candidate_mask: Tensor) -> tuple[Tensor, Tensor]:
        if candidate_features.ndim != 3:
            raise ValueError("candidate_features must have shape [batch, candidates, features]")
        if candidate_mask.shape != candidate_features.shape[:2]:
            raise ValueError("candidate_mask must match the batch/candidate dimensions")
        normalized = (candidate_features - self.feature_mean) / self.feature_std
        encoded = self.input_projection(normalized)
        encoded = self.encoder(encoded, src_key_padding_mask=~candidate_mask)
        policy_logits = self.policy_head(encoded).squeeze(-1).masked_fill(~candidate_mask, -1e9)
        mask = candidate_mask.unsqueeze(-1).to(encoded.dtype)
        pooled = (encoded * mask).sum(dim=1) / mask.sum(dim=1).clamp_min(1)
        value_logits = self.value_head(pooled).squeeze(-1)
        return policy_logits, value_logits


def parameter_count(model: nn.Module) -> int:
    return sum(parameter.numel() for parameter in model.parameters())
