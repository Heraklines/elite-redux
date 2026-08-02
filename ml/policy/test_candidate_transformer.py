import unittest

import torch

from candidate_transformer import CandidateSetTransformer, CandidateTransformerConfig


class CandidateSetTransformerTest(unittest.TestCase):
    def test_embedding_bag_pooling_matches_explicit_masked_mean(self) -> None:
        torch.manual_seed(3)
        model = CandidateSetTransformer(
            CandidateTransformerConfig(
                feature_count=3,
                token_vocabulary_size=16,
                d_model=8,
                layers=1,
                heads=2,
                feedforward=16,
            )
        ).eval()
        token_ids = torch.randint(1, 16, (2, 3, 5, 7))
        token_mask = torch.rand_like(token_ids, dtype=torch.float32) > 0.35
        token_mask[0, 1, 2] = False
        group_ids = torch.arange(model.config.token_group_count)
        explicit = model.token_embedding(token_ids)
        explicit = explicit + model.token_group_embedding(group_ids)[None, None, :, None, :]
        expanded_mask = token_mask.unsqueeze(-1).to(explicit.dtype)
        explicit = (explicit * expanded_mask).sum(dim=3) / expanded_mask.sum(dim=3).clamp_min(1)

        pooled = model._pool_token_groups(token_ids, token_mask)

        torch.testing.assert_close(pooled, explicit, atol=1e-6, rtol=1e-6)

    def test_candidate_permutation_only_permutes_policy_scores(self) -> None:
        torch.manual_seed(7)
        model = CandidateSetTransformer(
            CandidateTransformerConfig(
                feature_count=5,
                token_vocabulary_size=16,
                d_model=16,
                layers=2,
                heads=4,
                feedforward=32,
            )
        ).eval()
        features = torch.randn(1, 4, 5)
        mask = torch.ones(1, 4, dtype=torch.bool)
        token_ids = torch.randint(1, 16, (1, 4, 5, 3))
        token_mask = torch.ones_like(token_ids, dtype=torch.bool)
        permutation = torch.tensor([2, 0, 3, 1])
        with torch.inference_mode():
            logits, value = model(features, mask, token_ids, token_mask)
            permuted_logits, permuted_value = model(
                features[:, permutation],
                mask,
                token_ids[:, permutation],
                token_mask[:, permutation],
            )
        torch.testing.assert_close(permuted_logits, logits[:, permutation], atol=1e-5, rtol=1e-5)
        torch.testing.assert_close(permuted_value, value, atol=1e-5, rtol=1e-5)

    def test_padding_cannot_receive_probability_mass(self) -> None:
        model = CandidateSetTransformer(
            CandidateTransformerConfig(
                feature_count=3,
                token_vocabulary_size=8,
                d_model=8,
                layers=1,
                heads=2,
                feedforward=16,
            )
        ).eval()
        features = torch.randn(1, 3, 3)
        mask = torch.tensor([[True, True, False]])
        token_ids = torch.ones((1, 3, 5, 2), dtype=torch.long)
        token_mask = torch.ones_like(token_ids, dtype=torch.bool)
        with torch.inference_mode():
            logits, _ = model(features, mask, token_ids, token_mask)
        self.assertLess(float(logits[0, 2]), -1e8)

    def test_token_order_is_permutation_invariant_within_each_role(self) -> None:
        torch.manual_seed(11)
        model = CandidateSetTransformer(
            CandidateTransformerConfig(
                feature_count=3,
                token_vocabulary_size=16,
                d_model=8,
                layers=1,
                heads=2,
                feedforward=16,
            )
        ).eval()
        features = torch.randn(1, 2, 3)
        candidate_mask = torch.ones(1, 2, dtype=torch.bool)
        token_ids = torch.randint(1, 16, (1, 2, 5, 4))
        token_mask = torch.ones_like(token_ids, dtype=torch.bool)
        token_permutation = torch.tensor([2, 0, 3, 1])
        with torch.inference_mode():
            logits, value = model(features, candidate_mask, token_ids, token_mask)
            permuted_logits, permuted_value = model(
                features,
                candidate_mask,
                token_ids[:, :, :, token_permutation],
                token_mask[:, :, :, token_permutation],
            )
        torch.testing.assert_close(permuted_logits, logits, atol=1e-5, rtol=1e-5)
        torch.testing.assert_close(permuted_value, value, atol=1e-5, rtol=1e-5)

    def test_absent_features_are_invariant_to_placeholder_value_but_domain_is_visible(self) -> None:
        torch.manual_seed(13)
        model = CandidateSetTransformer(
            CandidateTransformerConfig(
                feature_count=3,
                token_vocabulary_size=8,
                d_model=8,
                layers=1,
                heads=2,
                feedforward=16,
            )
        ).eval()
        features = torch.tensor([[[1.0, 2.0, 3.0], [3.0, 4.0, 5.0]]])
        changed_absent = features.clone()
        changed_absent[:, :, 1] = 10000
        candidate_mask = torch.ones(1, 2, dtype=torch.bool)
        presence = torch.tensor([[[True, False, True], [True, False, True]]])
        token_ids = torch.ones((1, 2, 5, 1), dtype=torch.long)
        token_mask = torch.ones_like(token_ids, dtype=torch.bool)
        with torch.inference_mode():
            first = model(features, candidate_mask, token_ids, token_mask, feature_presence=presence, domain_ids=torch.tensor([1]))
            second = model(changed_absent, candidate_mask, token_ids, token_mask, feature_presence=presence, domain_ids=torch.tensor([1]))
            er_domain = model(features, candidate_mask, token_ids, token_mask, feature_presence=presence, domain_ids=torch.tensor([0]))
        torch.testing.assert_close(first[0], second[0])
        torch.testing.assert_close(first[1], second[1])
        self.assertFalse(torch.allclose(first[1], er_domain[1]))


if __name__ == "__main__":
    unittest.main()
