"""Remote-only intermediate owned phase diagnostic with complete inherited regressions."""
import base64
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.request

BASE = "dcd09ddf17ef2e979b2d344c279ba0e6c5a1f89b"
BRANCH = "codex/m9e-current-phase-focused-20260910"
CI = [".github/workflows/m9e-current-phase-focused.yml", "scripts/ci/m9e_current_phase_diagnostic.py"]
DELTAS = {"after":{"docs/plans/rust-kernel/m9e-continuation-20260910.md":"3b90034b3a15b7df5ee6c82f3e0da96f02516a065626b45cc369628ce5a620da","docs/plans/rust-kernel/m9e-deferred-learning-draft-3e6e39d.rs.txt":"a7602a7bee7ffcad8ef48ec3396a373eec9b133ed5d6ee783389b2aba68c039c","rust/Cargo.lock":"348f09e4bc5255e5cc1bd456b27dc1322aea4053736f73519f4882d7798a4297","rust/crates/er-battle/src/current_defender_abilities.rs":"db46cd06916fccce98fa14a195fedcb0a88eb7b8bd131d23e0b7eba197dbca02","rust/crates/er-battle/src/current_defender_execution.rs":"0418e74ee29777987bb76bb5701f6d9384da0a8b45287699d2acb970b81d143c","rust/crates/er-battle/src/current_target_execution.rs":"f4fcddc05a56de1954b8b5ec5fb7615d73e7f401a229faa9e87f8d23f650b77c","rust/crates/er-battle/src/current_turn_continuation.rs":"fb049da72b774e498f991f95453bfeb7ff4c06617585354dae86feb48b09d57a","rust/crates/er-battle/src/lib.rs":"ba19f1bf2300d8b6fa243a2a054bd5d9091a9a789dcf29eab6ffa6e1c451f12a","rust/crates/er-battle/src/m7_resolver.rs":"5db1d5cddb6312034321bbccf308251215eb6afa49a7efeb665c453583d02b46","rust/crates/er-cli/src/current_agent.rs":"ea6dc6ad4f0fc2c7a36653507c0b56625f4414ef4e78638364b91e0cc67bf86c","rust/crates/er-cli/tests/m9e_fresh_friendship_profile.rs":"a892521741adb094fd9d43aeda55842d6be0dce55a2662576f0596e2dfcb0519","rust/crates/er-env/src/current.rs":"490fa5ae1145eb284da1bbf6606e95e7d3c06defc76e858be1ab16f898b94d59","rust/crates/er-game/src/current_achievement_action.rs":"f9ba5061f9b4fd576dfd8f60acecddaa65b0e7c56b9292fba4f82af05d7ebed6","rust/crates/er-game/src/current_battle_presentation.rs":"719ab5b251bb172ecae36a035a89d0d19b9ed89630d35b507af31428ec415053","rust/crates/er-game/src/current_bootstrap_storage.rs":"4d23c2676e5d4ceea9e30beea164c00920213c792f99aadd6ad93b1c95c69bff","rust/crates/er-game/src/current_experience_settlement.rs":"f3ff728fb18cd7ab30680909fe7cd1a74bbdb031895e68006698f875bab78d7d","rust/crates/er-game/src/current_experience_validation.rs":"d43c7a4177cbae8516c18b75266863a034c81c1204b09fbfff29db22c6153e9a","rust/crates/er-game/src/current_faint_execution.rs":"280ab6b9890a509f5a8b4ab4e1ac12b69621bf5256ebd75c6f4f7f989dc75b0c","rust/crates/er-game/src/current_faint_transition.rs":"89b6d4914edf26bff4c8389294b57f83b4cef84ef06e520867c0c453a1652500","rust/crates/er-game/src/current_friendship_execution.rs":"b5d8ec0dcbc2d52cbfefbe2a8e7e58779a891760f826210275e29f07b924cc3a","rust/crates/er-game/src/current_learning_runtime.rs":"897eb2f1d32bfc4fcc3df7ba434a856cfe9a608de95409bc41ca6e07a833d5e2","rust/crates/er-game/src/current_level_account.rs":"f3c67c8cbb5e56c2ae1c0870f2db8fb718dc361d024968206571ae0da705e739","rust/crates/er-game/src/current_phase_runtime.rs":"7e6365208f7c092cbae91f39c8909c18671fa9fe26d974b8f6765fbc29f324a8","rust/crates/er-game/src/current_source_progression.rs":"76c8b9341538955f2ed68385649a81a4c81c3c863eae0a1baf40624911c2726d","rust/crates/er-game/src/current_starter_pokerus_pool.rs":"f840a54e290d120c87ea3e8d224fef42f77b72f12e4ac338276878568a677021","rust/crates/er-game/src/current_starter_pokerus.rs":"35e5857b62c4868ef2451118222fccef20a17ef86acc3abeed50d2c5d0cdeed2","rust/crates/er-game/src/current_victory_pump.rs":"7e1a66295d00246587091055f0c5ea3d70e34f00e0fc5db1d13c0a36b96c45da","rust/crates/er-game/src/current_victory_start.rs":"98228ecae744d3ce07cc35d3bf08696e23ec6232334f892d1d7ba30caab01b7b","rust/crates/er-game/src/current_victory_transition.rs":"8c3a42f800423c037c048655c5c2c59cfbf77a6f2fb58e38c8bac3734385de8f","rust/crates/er-game/src/lib.rs":"480dd37d861a107ef3b0dc20b4077f8f6aac16df2ee0c3779a861c6e60cf6b33","rust/crates/er-game/src/m7_progression_control.rs":"1f7502342de05c0546b92f44dcd96ab7d4a6d78bae11cc53ff2f62b659f3c222","rust/crates/er-game/src/m72_bootstrap.rs":"94a9f885c9554050170c2f965d782b7480b9a8bca8d74c479cf6165534eeb9fb","rust/crates/er-game/src/m9e_content_v2.rs":"232ca8528322708178e413ba371ee0c7a359dd0dda8300975b2c298fd061e1ae","rust/crates/er-game/src/m9e_internal_event_v2.rs":"d7dc862cc3db495401cdf13a5414aada98f23aeac9fa9cd8a93f39660b06faf3","rust/crates/er-game/src/m9e_material_v6.rs":"97f278b6f7110e60f04da3a69ba7d306c01fac1aa68fc2c30c78642736d6e985","rust/crates/er-game/src/m9e_new_run_v6.rs":"61f10bdea4156f43bac6049e21fee8dd997aa459ec62131b329c2f314fbc24c0","rust/crates/er-game/src/m9e_presentation_payload.rs":"ceffb2f554ba6851bb57b46c86cfb1f4cfdb22328bef284655408e5eefc8bead","rust/crates/er-game/src/m9e_runtime_v6.rs":"2fc723f569bc62d63046189f98b61290b4b0aff930e673058390d6a6d2164e49","rust/crates/er-game/tests/m9e_content_v2.rs":"1b31c7b739759f36683d0c793ecc520a09d3d318179a8d77df227956deddbe4f","rust/crates/er-game/tests/m9e_current_starter_pokerus.rs":"4ad7e0fd4fa3b8cbb3fdfd7131cc6be562616b96eb41df70987d8918c8d194fb","rust/crates/er-game/tests/m9e_material_retention.rs":"74c345d60620cad14d63a218b41be085d198742a32a7ff187d994c0d4a7e9aba","rust/crates/er-game/tests/m9e_material_v6.rs":"6b5957e2228f3d9c9ad2cec5bd741b5e93439c639547989d611a5cb715313184","rust/crates/er-game/tests/m9e_runtime_v6.rs":"298e153bea9f4bdc296aa4bf7d9309e0ca41227b5482d7e6910f347a05cc5f65","rust/crates/er-kernel/Cargo.toml":"e326261c496f8d62019cfa2866b1b0762422148e32f111b4797117eb01df5a28","rust/crates/er-kernel/src/current_learning_control_v7.rs":"fb63873e32807dca0bd7eca2c2efc5cf44a167bb9beed3e17b8b67bdddea71ca","rust/crates/er-kernel/src/current_phase_receipt_v7.rs":"cddfe408ff989dea83c0df92f30f8718c36239fba6bf9972b594efdf235832c4","rust/crates/er-kernel/src/current_phase_restore_v7.rs":"6f4c458d1607ceae72e516c47a4960779c05c3c56cdab68404be8a4f51193960","rust/crates/er-kernel/src/current_phase_v7.rs":"201cf98f863dd167bb9120daaad197a61bad6a565d183eac1f0e5863fae84da6","rust/crates/er-kernel/src/game_kernel_v7.rs":"4e9dd18efae89715cc7d3d6257c405e9e9e9bb097f18b7237db2708231363dae","rust/crates/er-kernel/src/snapshot_v7.rs":"989b38ed38c46dc244ca1f2aae9253038e893c6af54326f35794272e2e545f61","rust/crates/er-kernel/tests/m9e_coop_v7.rs":"a15c713e1349c83aee5a04d42bfb19f1d29e21b5bca083e970847be7df128467","rust/crates/er-kernel/tests/m9e_current_defender_ability.rs":"ac64eeb23d4e7cc9a0de32e463eee02b597b5535e38f6aaa2bee69a434801c5c","rust/crates/er-kernel/tests/m9e_current_phase_execution.rs":"f4ac588efe48af755326f40355cc21be6a001935a62bff43e5821e547d299737","rust/crates/er-kernel/tests/m9e_current_target_execution.rs":"ddc600887acc5b2ccd2a42f64f8037a3155c3ed3aa2e7ad3b69d551c04dd473e","rust/crates/er-kernel/tests/m9e_material_retention_v7.rs":"b3ef3445f3367424cd3297e495d6e374abe5d4e10bf9de4c7950c4321650068b","rust/crates/er-kernel/tests/m9e_snapshot_v7.rs":"772e5f24e9e700ec4a684d2e345306fb2f97aca19e923f710d95387e2abc22eb","rust/crates/er-progression/src/current_friendship_phase.rs":"fa3241bea04d0c245680d0972aaae1cbc95b0b175a35ee0e23184024f861899b","rust/crates/er-progression/src/current_friendship.rs":"c49300f197d3850d5e7bbb7d49e1b3e6064a549b3af573d4fe4f6f7915527333","rust/crates/er-progression/src/current_stats.rs":"f5f179791c255f07902e78d2984a461ae31d57dab2eb6ab5a4a39874a38afe5e","rust/crates/er-progression/src/lib.rs":"1d6e629eb2efc8d7392b1a081433674c98cc0ae7ed07cea9d54f9e179f5bdf8e","rust/crates/er-repro/tests/m9e_current_rebind_repro.rs":"afd241db7ef23b75e24ad8ed950cce75369db720f92dd482212ff38c1eca29b4","rust/crates/er-save/src/m9e_save_v2.rs":"0e55a872b701cd814d14cf80289b8804d639aad68847e1311ebfa9c562718048","rust/crates/er-state/src/current_achievement_tracker.rs":"59d2157a6bebbb6a4b9b580760e7df6c7a95f74a8fd76e53c056bf0573ca6520","rust/crates/er-state/src/current_battle_participation.rs":"bad862016596eabfa48f43775993edf87557e5ec5e4c84f9d09069091e80783a","rust/crates/er-state/src/current_battle_source_events.rs":"b50152bddaf6851f45b1203896d1b820d4e4a26daf0439efe8d722982ed3f81b","rust/crates/er-state/src/current_defender_dispatch.rs":"70d8367f163cf8f1f5823ead97fcd4449bbd17311d926eb84a96e9214cdf8304","rust/crates/er-state/src/current_experience_owner.rs":"ee3a3ebbd0cde7738c7098a3ccde10028defc487d5b2ff88672c733a29f29176","rust/crates/er-state/src/current_experience_settlement.rs":"71dba8e314a60f0c3c0d0b7ae6b684fc66a1e9306d7a3b819ae9e5b70ac62add","rust/crates/er-state/src/current_faint_execution.rs":"34836eb1786672dc35fa091ddb881046dd192c7d2fb808b4c70134ba73895cca","rust/crates/er-state/src/current_friendship_phase.rs":"5552fe10d067a8e1f4b322d591ee21c425516eabd8379068c4a93afa11ee8874","rust/crates/er-state/src/current_friendship_profile.rs":"a7b127cc477fc6b19f3497cf40ca8d78c21dd12f6cc79535697ba299f99e7e6e","rust/crates/er-state/src/current_friendship_rewards.rs":"e93828bf54a667d72064d3333454010920bc3a435e03a62c08f6dd28c199229f","rust/crates/er-state/src/current_presentation.rs":"6cb30a93d236a498fb5a59dddda53edfaa514bf5794a20160fb08a25907b9898","rust/crates/er-state/src/current_source_progression.rs":"1e3745593f70328e54a2b41fa38273bced631181091e87f63af62188e088119c","rust/crates/er-state/src/current_turn_execution.rs":"30dff7e848909bc80726e8199156740a60468968c2c5d194afaa9e0d43c66fe7","rust/crates/er-state/src/current_victory_execution.rs":"c200c9a3348ecb08e3f13b1fcebd4a908f8e041be273b6e73dab711941e25b66","rust/crates/er-state/src/lib.rs":"338d34241b06092b296bf29e6bb6be4b737c847f0e7977d516ff8b543a2a5a75","rust/crates/er-state/src/m9e_state_v6.rs":"87c8d0896772e5b89b767bdd91ae02305fcd6619b3cbcd981152e171f4e1d989","rust/crates/er-types/src/m7_action.rs":"3acf38ef3de9f28629dc1160188a42e84efe570941c508a7749c7f4a300227e5","rust/crates/er-web/examples/m9e_v7_storage_fixtures.rs":"2dbdbdf8504d618da82c2fac26362e0042437f690a09db00b1630d8b963f0bb1","rust/crates/er-web/examples/m9e_v7_title_storage_fixtures.rs":"6b41362333b5d4f846095f9b29cd163464997c39dd733cca7a9351fbeb6ac4dc","rust/crates/er-web/src/contracts_v2.rs":"0840db05691dfdb1cd2722dc8911f220d5dd16d86446259cb71bc26bb530383c","rust/crates/er-web/src/host_v2.rs":"d30909d0ea0f5e52b2fe3854611a3f4c1650b70ba7e8428cc22c93e1fea18ca3"},"before":{"rust/Cargo.lock":"9e7f2e2a96e9b191015b567c4bb1bd7f3457b0dbebc563394e354f5f132c65dc","rust/crates/er-battle/src/current_target_execution.rs":"ef1493c8d96c7b54964f525dc0737b38b911e7734009a2730316353bd122597f","rust/crates/er-battle/src/current_turn_continuation.rs":"e987bbce112e0fb4bd1c296f7e3a59580eb5cd1abea25050f5e18b176f99b737","rust/crates/er-battle/src/lib.rs":"e3c8df21c8bc774d7624cbdd2d9d847a96b4c69b6423aad5894862d074a0bdb5","rust/crates/er-battle/src/m7_resolver.rs":"dfffaea779e7e3d4d2d7f0fb20bbba70564051036aed760d7e46b4b71114fda9","rust/crates/er-cli/src/current_agent.rs":"7b8f300ae710549892a91ae97bab2dc25f2bb77372eb50690c247e9ce9368ead","rust/crates/er-cli/tests/m9e_fresh_friendship_profile.rs":"76d7b00a28a2b4028a9235732e25dec7030e1188390f1486977f812794f0ba22","rust/crates/er-env/src/current.rs":"ec99d6fa36ceae1401b5a0521718b5220100fdd0fafb5a29dbb171f3b128a2b3","rust/crates/er-game/src/current_bootstrap_storage.rs":"18697c6777edbd872b04607b86792f13079dbb23a229ec60176f3bf6c7e9b169","rust/crates/er-game/src/lib.rs":"c0e376b0449c9daa27972e5942fb65c02ca3c0d1ca1a9e6d2565f6de3e892e4c","rust/crates/er-game/src/m7_progression_control.rs":"ef3a2d0ed837e0377e01f79f7632e973029f9dcc4805434d5adb70f2d6742554","rust/crates/er-game/src/m72_bootstrap.rs":"b771ff1a3bc4c1bf145539094d4ee80de6e5d3807199a879332af0fe735db442","rust/crates/er-game/src/m9e_content_v2.rs":"9a4dbe89507d2e82b60b3fa5107d3211e9b08101e997574299c362cccf250299","rust/crates/er-game/src/m9e_internal_event_v2.rs":"c76f44fa4720b75bd167c86ca4ef0fb4265cd47bfa5683ce5e5cdb61479c6cf3","rust/crates/er-game/src/m9e_material_v6.rs":"80c79f00c87dd8b581cccf65dc329e7223c8915c99adc98f4f09056a2464a118","rust/crates/er-game/src/m9e_new_run_v6.rs":"b43fd0846f670532da050bade946593ee7b08ce77815698aafb7512c6e20ecdc","rust/crates/er-game/src/m9e_runtime_v6.rs":"3a79ec4f30e8b262de6eb6db93ab88e04644fce5ef7ea25ae2df2397078eb63a","rust/crates/er-game/tests/m9e_content_v2.rs":"bb4e57a32dd8224e351e530a32a906e0d538e6a85c3fdee33926e131391d5245","rust/crates/er-game/tests/m9e_material_retention.rs":"0069b3ff0a82eaaab623ffa32ac3fd866b4403bcdd11acebe983338ef35770f3","rust/crates/er-game/tests/m9e_material_v6.rs":"269da25c5bf034487041c738061deea1ede83677ce06cd14276e6dfe01ff43e0","rust/crates/er-game/tests/m9e_runtime_v6.rs":"4e1bf2dfdc4947be09d255d6198ef5f4adb52ce6d6b418699a0065b25d814c6c","rust/crates/er-kernel/Cargo.toml":"2b244502f54359df2852f5f05051a149154629a131f7b862c33a72c12f5aaabd","rust/crates/er-kernel/src/game_kernel_v7.rs":"4578172d237e62a1c126a9631fa8fa3979b9ae3bd3ae207df3884aef04721074","rust/crates/er-kernel/src/snapshot_v7.rs":"2f799081973a0c4286c6ea7b3ffa58f9c2ab8a12395176b7592785494593dd6e","rust/crates/er-kernel/tests/m9e_coop_v7.rs":"6f41a6eb991dca0a6291cf89f61cbd648f1875c559b6f77e55a8eb190e252d74","rust/crates/er-kernel/tests/m9e_current_target_execution.rs":"47e6c3770c91abf761115f446491184caee5f6b1bcb4f30151da9f1f4cb2925f","rust/crates/er-kernel/tests/m9e_material_retention_v7.rs":"b10cbc0692d24cb38b37ed4572ab23b4313ea827b78a58a182abf197d1c2354c","rust/crates/er-kernel/tests/m9e_snapshot_v7.rs":"48a3c7075acbb038727402015fcc39dca491150b60386aaaa41b1e7b2be8a263","rust/crates/er-progression/src/current_friendship.rs":"aee0bbcd18aff379e4d3080925108bda28c69d2f7f9e14131d648c07a1ee05b0","rust/crates/er-progression/src/lib.rs":"725c9a073583a5939ec8d3541eb8d0165ab5ff89491079e11e4490c0cb8fbfd1","rust/crates/er-repro/tests/m9e_current_rebind_repro.rs":"ea91f7112c8992095922fe1f53e28b7724537e0e7727fbf58089cb0e9a6b2eb4","rust/crates/er-save/src/m9e_save_v2.rs":"c40214202c7208aa7edd6f138c8debfbf80d35b80b0898c8ebf60fad5dac918f","rust/crates/er-state/src/current_battle_participation.rs":"6951be193c1af2c0b05de1628771421e016a99af3b9faa5757ff199c2f11c3b3","rust/crates/er-state/src/current_experience_owner.rs":"d7db6989ed6af104467d739091d372e13d8ef737f39c3b28642ab716f87e59ef","rust/crates/er-state/src/current_friendship_profile.rs":"5f9c0aa04d50048cc9f251cfe8d88a31162474d5bda2b2e396dc02d15ff6d032","rust/crates/er-state/src/current_turn_execution.rs":"13fd0b0938183524613bea63d047520ebff5045fb1a56856bdda3c0af1e53b34","rust/crates/er-state/src/lib.rs":"33a00ad3a2c88de9019bb15ff5a244202bda7e08d248d1963e9b45529ae85f5c","rust/crates/er-state/src/m9e_state_v6.rs":"08d6c5b16e0945e62c96853f512ad49318630eb129cda0c88e77f7615d8122dd","rust/crates/er-types/src/m7_action.rs":"26cd7a22833373d4c0f0b37a68516a2c80abd86f147f70a5653b7caeb24a06db","rust/crates/er-web/examples/m9e_v7_storage_fixtures.rs":"048d32d388fc25e98372cea60e0c03d6a47eb36bc91fd6bf40bc854aa9a31aa6","rust/crates/er-web/examples/m9e_v7_title_storage_fixtures.rs":"e6fa69d6105b9437b7bc3869d483ebe72b0ac06e2425a088c6303522cfbca98f","rust/crates/er-web/src/contracts_v2.rs":"132fc40b4d16a1b7edc99f506361c0e979bbd19b50e38a222b14979b637a5aaf","rust/crates/er-web/src/host_v2.rs":"ede1c513d7fc80e06736f595e83b971c68ea0011bb728df51055589a7b5e572a"}}
TARGETS = {"m9e_fresh_friendship_profile":{"crate":"er-cli","ids":["fresh_catalog_requires_qualified_complete_progression_not_only_oracle_sha","fresh_owner_restore_rejects_catalog_and_schema_forgery_transactionally","fresh_title_accounts_survive_natural_state_save_and_captured_replay","unknown_profile_restore_does_not_create_accounts_or_erase_legacy_bytes"]},"m9e_content_v2":{"crate":"er-game","ids":["direct_bundle_rejects_legacy_core_fields","direct_content_v2_prepares_every_current_domain","state_v6_validates_the_complete_content_identity","unresolved_starter_move_fails_closed"]},"m9e_material_v6":{"crate":"er-game","ids":["common_applier_is_idempotent_conflict_safe_and_snapshot_stable","material_rejects_variant_domain_revision_and_mutation_gaps"]},"m9e_runtime_v6":{"crate":"er-game","ids":["bootstrap_candidate_is_serialized_and_installed_through_the_common_applier","replica_cannot_dispatch_canonical_actions","save_action_allocates_one_typed_request_and_emits_canonical_save_v2"]},"m9e_material_retention":{"crate":"er-game","ids":["bounded_material_suffix_crosses_three_full_4096_windows_through_dispatch_and_apply","retention_policy_restore_and_revision_exhaustion_reject_without_retirement","small_suffix_retained_conflicts_late_invalid_and_stale_material_preserve_full_frontier"]},"m9e_snapshot_v7":{"crate":"er-kernel","ids":["active_snapshot_round_trips_at_a_quiescent_boundary","quiescent_v6_snapshot_migrates_without_gameplay_side_effects","terminal_lifecycle_requires_complete_control_and_terminal_identity","typed_pending_effects_cross_validate_allocator_and_content"]},"m9e_material_retention_v7":{"crate":"er-kernel","ids":["v7_material_rollover_restores_pending_effects_and_continues_exact_snapshots","v7_restore_rejects_historical_gapped_evidence_and_continues_a_valid_suffix"]},"m9e_game_kernel_v7":{"ids":["authority_ai_can_choose_a_legal_enemy_switch","authority_ai_exhausted_max_pp_uses_struggle_without_extra_decisions_or_pp","authority_ai_max_pp_boundaries_drive_raw_choices_without_extra_rng","final_wave_victory_terminates_the_run","gamepad_buttons_drive_bootstrap_and_active_controls","held_action_cannot_cross_bootstrap_menu_instance","natural_solo_battle_reaches_terminal_using_only_physical_keys","nonterminal_battle_progresses_to_next_wave","raw_keys_complete_natural_start_and_install_serialized_v6_state","read_preserves_saved_difficulty_over_other_naturally_selected_live_difficulty","read_rebind_clears_real_repeat_ownership_without_cancelling_unrelated_work","read_rebind_keeps_larger_saved_floors_and_no_active_run_behavior","read_rebind_preserves_saved_semantics_and_executes_write_after_restore","read_rebind_rejects_stale_action_context_and_preserves_canonical_battle_root","read_rebind_rolls_back_menu_revision_presentation_and_replay_exhaustion"],"crate":"er-kernel"},"m9e_current_move_targets":{"ids":["invalid_owner_context_fails_without_inventing_rng_or_callback_results","source_random_draw_precedes_alive_filter_and_other_never_falls_back_to_ally","source_spread_promotion_keeps_adjacency_and_multihit_exception","whole_source_targeting_matches_all_twenty_categories_and_owner_call_order"],"crate":"er-battle"},"m9e_current_target_execution":{"crate":"er-kernel","ids":["actual_target_menu_retains_move_restore_and_cancel_owner","current_stat_calculation_matches_six_actual_source_observations","exhausted_pp_knockout_retains_actual_struggle_preimage","last_pp_knockout_retains_resolved_move_across_interlude_restore","natural_raw_turn_uses_current_targets_and_preserves_save_material","poison_redirect_and_source_passive_gate_share_actual_owner","queued_faint_retargets_opponents_but_preserves_same_side_cancellation","retained_turn_faint_blocks_later_move_at_live_reward_preimage","retained_turn_matches_uninterrupted_actions_rng_and_finalization","source_spread_group_executes_all_opponents_and_multihit_exception","unsupported_selection_and_owner_stripping_fail_atomically"]},"m9e_current_starter_pokerus":{"crate":"er-game","ids":["clock_counter_overflow_and_forged_restore_fail_atomically","daily_selection_matches_all_actual_source_dates","historical_absence_remains_unknown_and_requires_actual_fresh_profile","pending_clock_cancel_restore_and_request_floor_are_owned","picks_retain_their_source_day_through_reentry_and_natural_construction","removed_and_corrupted_picks_cannot_reuse_an_unrelated_daily_receipt"]},"m9e_current_defender_ability":{"crate":"er-kernel","ids":["actual_innate_absorb_uses_admitted_slot_and_shared_immutable_query","actual_poison_redirect_absorbs_with_ordered_payload_and_material_conservation"]},"m9e_coop_v7":{"crate":"er-kernel","ids":["coop_waits_for_all_human_commands","natural_coop_raw_proposal_converges_and_generation_is_fenced","private_party_reopens_restore_exact_root_and_apply_canonical_material","replica_delivers_save_presentation_once_without_repeating_authority_storage"]},"m9e_current_phase_execution":{"crate":"er-kernel","ids":["epoch_zero_max_unlock_does_not_request_or_repeat_achievement_reward","raw_knockout_waits_for_xp_prompt_then_level_stats_with_exact_material_restore"]},"m9e_natural_progression_v7":{"crate":"er-kernel","ids":["natural_victory_experience_recalculates_stats_preserves_damage_and_restores"]},"m9e_natural_campaign_v7":{"crate":"er-kernel","ids":["natural_current_campaign_reaches_policy_terminal_without_state_injection"]},"m9e_natural_coop_campaign_v7":{"crate":"er-kernel","ids":["natural_owned_cooperative_campaign_reaches_wave_200_victory"]},"m9e_natural_campaign_replay":{"crate":"er-repro","ids":["natural_current_campaign_replays_every_external_input_and_resumes_to_wave_200"]},"er_game":{"kind":"lib","ids":["authority_commands::compile_shape_tests::replacement_fingerprint_evidence_accepts_empty_snapshot","current_faint_execution::tests::faint_score_matches_five_actual_source_method_observations","m7_content::tests::duplicate_behavior_classification_fails_closed","m7_content::tests::empty_run_program_catalog_fails_closed","m7_internal_event::tests::fifo_is_ordered_budgeted_and_quiescent","m7_progression_control::tests::capture_menu_has_stable_ball_and_decline_graph","m9e_internal_event_v2::tests::ai_budget_failure_retains_replayable_evidence","m9e_internal_event_v2::tests::empty_network_frame_is_rejected_before_processing","m9e_internal_event_v2::tests::fifo_processes_children_to_quiescence_in_order","run_menu::tests::direction_then_submit_uses_stable_option_identity","run_menu::tests::key_release_never_submits","run_menu::tests::presentation_barrier_rejects_human_input"],"crate":"er-game","source_inputs":["rust/crates/er-game/src/authority_commands.rs","rust/crates/er-game/src/m7_content.rs","rust/crates/er-game/src/m7_internal_event.rs","rust/crates/er-game/src/m7_progression_control.rs","rust/crates/er-game/src/current_faint_execution.rs","rust/crates/er-game/src/m9e_internal_event_v2.rs","rust/crates/er-game/src/run_menu.rs"]}}
ROOT = Path(__file__).resolve().parents[2]
RUNNER = Path(os.environ["RUNNER_TEMP"]).resolve()
OUT = RUNNER / "m9e-current-phase"
TARGET = RUNNER / "m9e-current-phase-target"
START = float(os.environ["M9E_STARTED_AT"])
DEADLINE = START + 1800
COMMANDS = []

def require(value, message):
    if not value:
        raise RuntimeError(message)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def bounded_write(path, value, maximum):
    raw = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    require(len(raw) <= maximum, "compact result exceeds retained bound")
    path.write_bytes(raw)

def run(name, argv, cwd=ROOT, maximum=8 << 20):
    remaining = DEADLINE - 20 - time.time()
    require(remaining > 0, "shared deadline exhausted before " + name)
    seconds = min(600, remaining)
    log = OUT / "diagnostics" / (name + ".log")
    started = time.monotonic()
    with log.open("wb") as output:
        process = subprocess.Popen(argv, cwd=cwd, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        limit = started + seconds
        reason = None
        while process.poll() is None:
            if time.monotonic() >= limit or log.stat().st_size > maximum:
                reason = "deadline or diagnostic log bound exceeded"
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
                break
            time.sleep(0.1)
    raw = log.read_bytes()
    COMMANDS.append(dict(name=name, argv=argv, cwd=str(cwd.relative_to(ROOT)) or ".", limit_seconds=seconds,
                         elapsed_ms=int((time.monotonic()-started)*1000), returncode=process.returncode,
                         log_bytes=len(raw), log_sha256=sha(raw)))
    require(reason is None and process.returncode == 0 and len(raw) <= maximum, reason or name + " failed")
    require(time.time() <= DEADLINE-20, "reserved cleanup deadline exhausted")
    return raw

def git(*args):
    return run("git-"+str(len(COMMANDS)), ["git", *args])

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def source_oracle():
    """Independent source-derived projection, not a full TS GameData execution."""
    pins = {
        "src/data/balance/starters.ts": "21bd9442711f1f7381f5e7e5c4a51dac43db0584272fd5b4767493f8a68e39ef",
        "src/enums/species-id.ts": "6323f21fd3dfb859b6ae682f2f94507ad140ceeff811fdee43289779cf6665ba",
        "src/enums/passive.ts": "f4a2b339a018fe01700fb42586bb7b72006a2922d87fdf5d213a385758b310b6",
    }
    for path, digest in pins.items():
        require(sha((ROOT/path).read_bytes()) == digest, "pinned literal source differs: "+path)
    oid = "b88d78bbcf0e36c937af4fa30e45e73d7e5aea90"
    try:
        request = urllib.request.Request("https://api.github.com/repos/Heraklines/elite-redux/git/blobs/"+oid,
            headers={"Authorization": "Bearer "+os.environ["GITHUB_TOKEN"], "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "m9e-fresh-account-source"})
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            require(response.status == 200, "source HTTP status")
            body = response.read(524289)
        require(len(body) <= 524288, "single immutable source response bound")
        value = json.loads(body)
        require(value.get("sha") == oid and value.get("encoding") == "base64" and type(value.get("size")) is int and value["size"] == 325510, "source blob metadata")
        raw = base64.b64decode("".join(value["content"].splitlines()), validate=True)
        require(len(raw) == 325510 and sha(raw) == "16a69ee97d552e16ab6bb6bb2504d358a05fcf1ca80a6d53c38a4f3d1910e89f"
                and hashlib.sha1(f"blob {len(raw)}\0".encode()+raw).hexdigest() == oid, "source blob identity")
    except Exception:
        raise RuntimeError("bounded pinned GameData source retrieval/validation failed") from None
    init = "\n".join(raw.decode().splitlines()[6884:6919])
    require(all(token in init for token in ("Object.keys(speciesStarterCosts)", "species.speciesId >= 10000", "candyCount: 0", "friendship: 0", "passiveAttr: 0")), "exact reviewed constructor semantics")
    ids, next_id = {}, 0
    enum_text = (ROOT/"src/enums/species-id.ts").read_text()
    entries = re.findall(r"^  ([A-Z][A-Z0-9_]*)(?: = ([0-9]+))?,\s*$", enum_text, re.M)
    require(len(entries) == len(re.findall(r"^  [A-Z].*$", enum_text, re.M)) == 1082, "complete numeric enum source")
    for name, explicit in entries:
        if explicit:
            next_id = int(explicit)
        ids[name] = next_id
        next_id += 1
    block = re.search(r"export const speciesStarterCosts = \{(.*?)\n\};", (ROOT/"src/data/balance/starters.ts").read_text(), re.S).group(1)
    entries = re.findall(r"^  \[SpeciesId\.([A-Z0-9_]+)\]: ([0-9]+),\s*$", block, re.M)
    require(len(entries) == len([line for line in block.splitlines() if line.strip()]) == 570, "complete starter cost literals")
    expected_table = [(ids[name], int(cost), name) for name, cost in entries]
    rust = (ROOT/"rust/crates/er-game/src/current_friendship_profile.rs").read_text()
    actual_table = [(int(species), int(cost), name) for species, cost, name in re.findall(r"^\s*\(([0-9]+), ([0-9]+)\),[ \t]+// ([A-Z0-9_]+)$", rust, re.M)]
    require(actual_table == expected_table, "every Rust table row must match actual pinned source")
    definitions_path = ROOT/"rust/fixtures/m9/engineering/complete-progression-definitions-v1.json"
    definitions_raw = definitions_path.read_bytes()
    require(len(definitions_raw) == 3724089 and sha(definitions_raw) == "bba00376cae18feae56bebe38c5be0f1bb3aae3fd9a6e99e3ec7fa60a15de08f", "qualified complete allSpecies export")
    definitions = json.loads(definitions_raw)
    species = definitions["species"]
    require(len(species) == 3384 and all(type(row["species_id"]) is int and row["species_id"] > 0 for row in species), "complete source species definitions")
    custom = {row["species_id"] for row in species if row["species_id"] >= 10000}
    keys = sorted({entry[0] for entry in expected_table} | custom)
    require(len(keys) > 570 and len(keys) <= 4096, "complete bounded fresh account closure")
    path = OUT/"diagnostics/fresh-account-oracle.json"
    bounded_write(path, keys, 65536)
    # Reuse the already hash-verified source body; retain only the requested
    # initialization excerpt needed to establish fresh ribbon ownership.
    source_lines = raw.decode().splitlines()
    starts = [index for index, line in enumerate(source_lines)
        if re.match(r"^\s*(?:(?:private|public|protected)\s+)?initDexData\(", line)]
    require(len(starts) == 1, "exact fresh dex initialization definition")
    start = starts[0]
    excerpt = "\n".join(f"{index+1:05}: {source_lines[index]}"
        for index in range(start, min(start + 160, len(source_lines)))) + "\n"
    require(len(excerpt.encode()) <= 16384, "narrow dex initialization excerpt bound")
    proof = dict(qualification="source-derived complete seed-set comparison; not full TypeScript execution",
        oracle_sha="399d5d368f0b5642ebf8f45bd8a5e73350fa4de7", source_hashes=pins,
        game_data_blob=oid, game_data_bytes=len(raw), game_data_sha256=sha(raw), constructor_excerpt_sha256=sha(init.encode()),
        starter_rows=570, custom_species=len(custom), source_definition_rows=3384, total_accounts=len(keys),
        definitions_sha256=sha(definitions_raw), oracle_bytes=path.stat().st_size, oracle_sha256=sha(path.read_bytes()),
        dex_initializer_excerpt=excerpt, dex_initializer_excerpt_sha256=sha(excerpt.encode()))
    print(json.dumps(proof, sort_keys=True, separators=(",", ":")))

def main():
    require(os.environ.get("GITHUB_REPOSITORY") == "Heraklines/elite-redux" and os.environ.get("GITHUB_REF") == "refs/heads/"+BRANCH, "isolated source branch required")
    require(os.environ.get("GITHUB_REF_NAME") == BRANCH and os.environ.get("GITHUB_EVENT_NAME") == "push", "actual branch and push event")
    require(re.fullmatch(r"[0-9]{10}", os.environ["M9E_STARTED_AT"]) and 0 <= time.time()-START < 1780, "precheckout shared budget")
    require(os.name == "posix" and os.uname().machine == "x86_64", "Ubuntu x64")
    require(OUT.parent == RUNNER and TARGET.parent == RUNNER and not OUT.exists() and not TARGET.exists(), "fresh owned directories")
    (OUT/"compact").mkdir(parents=True)
    (OUT/"diagnostics").mkdir()
    TARGET.mkdir()
    os.environ["CARGO_TARGET_DIR"] = str(TARGET)
    result = dict(status="failed", qualification="bounded initial Faint/Victory/XP integration and inherited whole-target regressions; no browser, full source ability parity or aggregate M9 qualification",
        schema_version=1, branch=os.environ["GITHUB_REF_NAME"], event=os.environ["GITHUB_EVENT_NAME"], started_at=START, source_sha=os.environ["GITHUB_SHA"], run_id=os.environ["GITHUB_RUN_ID"], run_attempt=os.environ["GITHUB_RUN_ATTEMPT"], base_sha=BASE, tests_executed=0, formatting_required=False, commands=COMMANDS)
    try:
        require(git("rev-parse", "HEAD").decode().strip() == result["source_sha"], "actual source HEAD")
        paths = git("diff", "--name-only", BASE, "HEAD").decode().splitlines()
        require(sorted(paths) == sorted([*DELTAS["after"], *CI]), "exact reviewed source delta")
        for path, expected in DELTAS["before"].items():
            require(sha(git("show", BASE+":"+path)) == expected, "base source differs: "+path)
        for path, expected in DELTAS["after"].items():
            require(sha((ROOT/path).read_bytes()) == expected, "reviewed source differs: "+path)
        pins = sorted(set([*DELTAS["after"], *CI, "rust/Cargo.toml", "rust/Cargo.lock", "rust/rust-toolchain.toml",
            *["rust/crates/"+crate+"/Cargo.toml" for crate in ("er-types", "er-battle", "er-state", "er-game", "er-save", "er-kernel", "er-env", "er-cli", "er-repro", "er-web", "er-progression")],
            "rust/crates/er-cli/src/main.rs", "rust/crates/er-repro/src/current.rs", "test/kernel-fixtures/m9/export-progression-content.ts",
            "src/data/balance/starters.ts", "src/enums/species-id.ts", "src/enums/passive.ts",
            "scripts/ci/m9e_current_move_targets_oracle.mjs",
            *["rust/crates/"+row["crate"]+("/src/lib.rs" if row.get("kind") == "lib" else "/tests/"+name+".rs") for name,row in TARGETS.items()],
            *[path for row in TARGETS.values() for path in row.get("source_inputs", [])]]))
        result["source_hashes"] = {path: sha((ROOT/path).read_bytes()) for path in pins}
        for path in pins:
            if path not in DELTAS["after"] and path not in CI:
                require(sha(git("show",BASE+":"+path)) == result["source_hashes"][path], "unchanged exact base input: "+path)
        fixture_tree = git("ls-tree", "-r", "HEAD", "--", "rust/fixtures/m9/engineering")
        require(fixture_tree == git("ls-tree", "-r", BASE, "--", "rust/fixtures/m9/engineering"), "all existing fixture metadata unchanged")
        result["fixture_tree_sha256"] = sha(fixture_tree)
        result["phase_execution_scope"] = dict(crate="er-kernel", target="m9e_current_phase_execution",
            scope="whole raw XP target selected; execution and success are recorded only in actual artifact results")
        result["source_oracle"] = json.loads(run("source-oracle", [sys.executable, str(Path(__file__).resolve()), "--source-oracle"], maximum=65536))
        os.environ["ER_M9E_FRESH_ACCOUNT_ORACLE"] = str(OUT/"diagnostics/fresh-account-oracle.json")
        run("toolchain-install", ["rustup", "toolchain", "install", "1.97.1", "--profile", "minimal", "--component", "rustfmt", "--component", "clippy"])
        rustc = run("rustc-version", ["rustc", "-Vv"], ROOT/"rust").decode()
        require("release: 1.97.1\n" in rustc and "host: x86_64-unknown-linux-gnu\n" in rustc, "pinned actual compiler")
        result["rustc"] = rustc
        originals = {path: (ROOT/path).read_bytes() for path in DELTAS["after"] if path.endswith(".rs")}
        run("rustfmt", ["rustfmt", "--edition", "2024", "--config", "skip_children=true", *originals])
        patch, format_rows, file_patches = b"", [], []
        for path, original in originals.items():
            formatted = (ROOT/path).read_bytes()
            if formatted != original:
                file_patch = "".join(difflib.unified_diff(original.decode().splitlines(True), formatted.decode().splitlines(True), fromfile="a/"+path, tofile="b/"+path, n=0)).encode()
                patch += file_patch
                file_patches.append((path, file_patch))
                format_rows.append(dict(path=path, before_sha256=sha(original), after_sha256=sha(formatted)))
        if patch:
            # Handoff permits pagination when the routine diagnostic exceeds its
            # target. Never split a file, enlarge a member, or retrieve an archive.
            pages = []
            page_raw, page_paths = b"", []
            for path, file_patch in file_patches:
                require(len(file_patch) <= 262144, "one formatter file exceeds named member bound")
                if page_raw and len(page_raw)+len(file_patch) > 262144:
                    pages.append((page_raw, page_paths))
                    page_raw, page_paths = b"", []
                page_raw += file_patch
                page_paths.append(path)
            if page_raw:
                pages.append((page_raw, page_paths))
            page_index = [dict(path=f"format-{index+1:02}.patch", bytes=len(raw), sha256=sha(raw), files=paths)
                for index, (raw, paths) in enumerate(pages)]
            allowed = len(patch) <= 524288 and len(pages) <= 2
            result["format_patch"] = dict(bytes=len(patch), sha256=sha(patch), files=format_rows,
                context_lines=0, emitted=allowed, pages=page_index,
                member_limit_bytes=262144, aggregate_limit_bytes=524288)
            require(allowed, "two-page formatter evidence bound")
            require([path for _, paths in pages for path in paths] == [row["path"] for row in format_rows],
                "exact ordered formatter page partition")
            for page, (raw, _) in zip(page_index, pages, strict=True):
                (OUT/"diagnostics"/page["path"]).write_bytes(raw)
            result["formatting_required"] = True
            result["formatting_failure"] = "exact remote formatter pages required before qualification"
            # Collect causal feedback against the committed source only. Formatting
            # remains a qualification failure even if every later check succeeds.
            for path, original in originals.items():
                (ROOT/path).write_bytes(original)
            for path, digest in result["source_hashes"].items():
                require(sha((ROOT/path).read_bytes()) == digest, "original pinned source restore failed: "+path)
            result["formatter_feedback_source_restored"] = True
        cases = OUT/"diagnostics/target-source-cases.jsonl"
        oracle = json.loads(run("target-source-oracle", ["node", "--disable-warning=ExperimentalWarning", "scripts/ci/m9e_current_move_targets_oracle.mjs", str(cases)], maximum=65536))
        require(oracle["cases"] == 200 and oracle["runtime"] == "v24.9.0" and oracle["whole_target_function"] is True and oracle["whole_line_adjacency"] is True and oracle["resolved_owner_inputs_only"] is True, "whole current target source")
        require(oracle["output_bytes"] == cases.stat().st_size <= 262144 and oracle["output_sha256"] == sha(cases.read_bytes()), "complete source observations")
        for path, expected in oracle["source_hashes"].items():
            require(sha((ROOT/path).read_bytes()) == expected and sha(git("show",BASE+":"+path)) == expected, "whole unchanged target source")
        result["target_oracle"] = oracle
        os.environ["M9E_CURRENT_MOVE_TARGETS_ORACLE"] = str(cases)
        profile_keys = ["CARGO_PROFILE_"+mode+"_"+field for mode in ("DEV", "TEST") for field in ("OPT_LEVEL", "DEBUG_ASSERTIONS", "OVERFLOW_CHECKS", "DEBUG")]
        result["profile_environment"] = {key: os.environ.get(key) for key in profile_keys}
        require(all(value == ("true" if key.endswith(("DEBUG_ASSERTIONS", "OVERFLOW_CHECKS")) else "0") for key, value in result["profile_environment"].items()), "ordinary correctness profile")
        require(not any(os.environ.get(key) for key in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "RUST_MIN_STACK", "RUST_TEST_THREADS")), "no ambient flags or execution overrides")
        run("all-target-consumer-check", ["cargo", "check", "--locked", "--workspace", "--all-targets"], ROOT/"rust")
        run("proposal-clippy", ["cargo", "clippy", "--locked", "-p", "er-types", "-p", "er-battle", "-p", "er-state", "-p", "er-game", "-p", "er-kernel", "-p", "er-save", "-p", "er-env", "-p", "er-cli", "-p", "er-progression", "-p", "er-web", "--tests", "--no-deps", "--", "-D", "warnings"], ROOT/"rust")
        selector = ["-p", "er-battle", "-p", "er-game", "-p", "er-kernel", "-p", "er-cli", "-p", "er-repro"] + [argument for name, row in TARGETS.items() if row.get("kind") != "lib" for argument in ("--test", name)]
        raw = run("proposal-build", ["cargo", "test", "--locked", *selector, "--no-run", "--message-format=json"], ROOT/"rust")
        rows = [json.loads(line) for line in raw.splitlines() if line.startswith(b"{")]
        require([row.get("success") for row in rows if row.get("reason") == "build-finished"] == [True], "complete successful Cargo stream")
        library_raw = run("proposal-library-build", ["cargo", "test", "--locked", "-p", "er-game", "--lib", "--no-run", "--message-format=json"], ROOT/"rust")
        library_rows = [json.loads(line) for line in library_raw.splitlines() if line.startswith(b"{")]
        require([row.get("success") for row in library_rows if row.get("reason") == "build-finished"] == [True], "complete successful library Cargo stream")
        library_artifacts = [row for row in library_rows if row.get("reason") == "compiler-artifact" and row.get("executable")]
        require(len(library_artifacts) == 1 and library_artifacts[0]["target"]["name"] == "er_game"
            and library_artifacts[0]["target"]["kind"] == ["lib"] and library_artifacts[0]["profile"]["test"] is True,
            "exact complete er-game library test artifact")
        rows.extend(library_artifacts)
        artifacts = [row for row in rows if row.get("reason") == "compiler-artifact" and row.get("executable")]
        hosts = [row for row in artifacts if not row["profile"]["test"]]
        require(len(hosts) == 1 and hosts[0]["target"]["name"] == "er-cli" and hosts[0]["target"]["kind"] == ["bin"], "one compile-only CLI artifact")
        host = hosts[0]
        host_binary = Path(host["executable"])
        host_profile = host["profile"]
        require(host["manifest_path"] == str(ROOT/"rust/crates/er-cli/Cargo.toml") and host["target"]["src_path"] == str(ROOT/"rust/crates/er-cli/src/main.rs")
            and host.get("features") == [] and host_profile["test"] is False and host_profile["opt_level"] == "0"
            and host_profile["debug_assertions"] is True and host_profile["overflow_checks"] is True and host_profile["debuginfo"] == 0
            and host_binary == TARGET/"debug/er-cli" and host_binary.is_file() and not host_binary.is_symlink() and host_binary.resolve() == host_binary
            and 0 < host_binary.stat().st_size <= 128 << 20, "actual compile-only CLI source/profile")
        result["compile_only_cli"] = dict(target=host["target"], profile=host_profile, manifest_path=host["manifest_path"], path=str(host_binary), bytes=host_binary.stat().st_size, sha256=sha(host_binary.read_bytes()), executions=0)
        tests = [row for row in artifacts if row["profile"]["test"]]
        require(len(tests) == 19 and {row["target"]["name"] for row in tests} == set(TARGETS), "nineteen complete native targets including the whole er-game library")
        result["artifacts"] = []
        for artifact in sorted(tests, key=lambda row: row["target"]["name"]):
            name = artifact["target"]["name"]
            crate, ids = TARGETS[name]["crate"], TARGETS[name]["ids"]
            target_kind = TARGETS[name].get("kind", "test")
            target_source = "rust/crates/"+crate+("/src/lib.rs" if target_kind == "lib" else "/tests/"+name+".rs")
            profile = artifact["profile"]
            binary = Path(artifact["executable"])
            require(artifact["manifest_path"] == str(ROOT/("rust/crates/"+crate+"/Cargo.toml")) and artifact["target"]["src_path"] == str(ROOT/target_source)
                and artifact["target"]["kind"] == [target_kind] and artifact.get("features") == [] and profile["test"] is True and profile["opt_level"] == "0"
                and profile["debug_assertions"] is True and profile["overflow_checks"] is True and profile["debuginfo"] == 0
                and binary.is_absolute() and binary.parent == TARGET/"debug/deps" and binary.is_file() and not binary.is_symlink() and binary.resolve() == binary
                and re.fullmatch(re.escape(name)+r"-[0-9a-f]{16}", binary.name) and 0 < binary.stat().st_size <= 128 << 20, "actual artifact/source/profile identity")
            listing = run(name+"-list", [str(binary), "--list", "--format", "terse"], ROOT/("rust/crates/"+crate), maximum=16384)
            require(listing == "".join(test+": test\n" for test in ids).encode(), "exact whole target IDs")
            digest = sha(binary.read_bytes())
            output = run(name+"-execute", [str(binary), "--format", "terse"], ROOT/("rust/crates/"+crate), maximum=32768)
            require(re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output) == [(str(len(ids)).encode(), b"0", b"0", b"0", b"0")], "every whole-target test must pass")
            require(sha(binary.read_bytes()) == digest, "executed artifact changed")
            result["artifacts"].append(dict(target=artifact["target"], profile=profile, manifest_path=artifact["manifest_path"], path=str(binary), bytes=binary.stat().st_size, sha256=digest, ids=ids, listing_bytes=len(listing), listing_sha256=sha(listing)))
            result["tests_executed"] += len(ids)
        require(result["tests_executed"] == 82, "all58 inherited tests plus4 coop,2 phase,1 progression,1 campaign,1 coop-campaign,1 replay,2 retained KO source tests and12 whole-library tests")
        require(sha(cases.read_bytes()) == result["target_oracle"]["output_sha256"], "whole target oracle changed")
        require(sha(host_binary.read_bytes()) == result["compile_only_cli"]["sha256"], "compile-only CLI artifact changed")
        require(sha((OUT/"diagnostics/fresh-account-oracle.json").read_bytes()) == result["source_oracle"]["oracle_sha256"], "independent source oracle changed")
        for path, digest in result["source_hashes"].items():
            require(sha((ROOT/path).read_bytes()) == digest, "source changed during execution: "+path)
        if result["formatting_required"]:
            result["first_failure"] = result["formatting_failure"]
        else:
            result["status"] = "passed"
    except Exception as error:
        result["first_failure"] = str(error)[:2048]
        result["execution_failure"] = result["first_failure"]
    finally:
        require(TARGET.resolve().parent == RUNNER and TARGET.name == "m9e-current-phase-target", "cleanup ownership")
        begun = time.monotonic()
        try:
            cleanup = subprocess.run([sys.executable, "-c", "import shutil,sys; shutil.rmtree(sys.argv[1])", str(TARGET)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, check=False)
            okay = cleanup.returncode == 0
        except (subprocess.TimeoutExpired, OSError):
            okay = False
        result["cleanup"] = dict(target_removed=not TARGET.exists(), success=okay, limit_seconds=20, elapsed_ms=int((time.monotonic()-begun)*1000))
        result["elapsed_seconds"] = time.time()-START
        if not okay or TARGET.exists() or time.time() > DEADLINE:
            result["status"] = "failed"
            result["cleanup_failure"] = "cleanup or shared deadline failed"
            result.setdefault("first_failure", result["cleanup_failure"])
        if result["status"] != "passed":
            failure = (result.get("first_failure", "qualification failed")+"\n").encode()
            if COMMANDS:
                failure += (OUT/"diagnostics"/(COMMANDS[-1]["name"]+".log")).read_bytes()[-22000:]
            (OUT/"compact/failure.txt").write_bytes(failure[:24576])
        # Keep every command record remotely. Only repetitive source-read Git
        # records are projected by an exact index identity in the compact proof.
        index_raw = (json.dumps(COMMANDS, sort_keys=True, separators=(",", ":"))+"\n").encode()
        require(len(index_raw) <= 262144, "complete command index bound")
        (OUT/"diagnostics/command-index.json").write_bytes(index_raw)
        git_commands = [row for row in COMMANDS if row["name"].startswith("git-")]
        result["command_index"] = dict(path="command-index.json", bytes=len(index_raw), sha256=sha(index_raw),
            commands=len(COMMANDS), git_commands=len(git_commands),
            all_git_queries_succeeded=all(row["returncode"] == 0 for row in git_commands))
        result["commands"] = [row for row in COMMANDS if not row["name"].startswith("git-")]
        bounded_write(OUT/"compact/summary.json", result, 65536)
    raise SystemExit(0 if result["status"] == "passed" else 1)

if __name__ == "__main__":
    if sys.argv[1:] == ["--source-oracle"]:
        source_oracle()
    else:
        require(not sys.argv[1:], "no unsupported producer arguments")
        main()
