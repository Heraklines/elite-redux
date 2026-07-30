import unittest

import torch

from candidate_transformer import CandidateSetTransformer, CandidateTransformerConfig


class CandidateSetTransformerTest(unittest.TestCase):
    def test_candidate_permutation_only_permutes_policy_scores(self) -> None:
        torch.manual_seed(7)
        model = CandidateSetTransformer(
            CandidateTransformerConfig(feature_count=5, d_model=16, layers=2, heads=4, feedforward=32)
        ).eval()
        features = torch.randn(1, 4, 5)
        mask = torch.ones(1, 4, dtype=torch.bool)
        permutation = torch.tensor([2, 0, 3, 1])
        with torch.inference_mode():
            logits, value = model(features, mask)
            permuted_logits, permuted_value = model(features[:, permutation], mask)
        torch.testing.assert_close(permuted_logits, logits[:, permutation], atol=1e-5, rtol=1e-5)
        torch.testing.assert_close(permuted_value, value, atol=1e-5, rtol=1e-5)

    def test_padding_cannot_receive_probability_mass(self) -> None:
        model = CandidateSetTransformer(
            CandidateTransformerConfig(feature_count=3, d_model=8, layers=1, heads=2, feedforward=16)
        ).eval()
        features = torch.randn(1, 3, 3)
        mask = torch.tensor([[True, True, False]])
        with torch.inference_mode():
            logits, _ = model(features, mask)
        self.assertLess(float(logits[0, 2]), -1e8)


if __name__ == "__main__":
    unittest.main()
