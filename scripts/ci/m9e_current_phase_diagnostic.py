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
DELTAS = {"before":{"rust/Cargo.lock":"9e7f2e2a96e9b191015b567c4bb1bd7f3457b0dbebc563394e354f5f132c65dc","rust/crates/er-battle/src/current_target_execution.rs":"ef1493c8d96c7b54964f525dc0737b38b911e7734009a2730316353bd122597f","rust/crates/er-battle/src/current_turn_continuation.rs":"e987bbce112e0fb4bd1c296f7e3a59580eb5cd1abea25050f5e18b176f99b737","rust/crates/er-battle/src/lib.rs":"e3c8df21c8bc774d7624cbdd2d9d847a96b4c69b6423aad5894862d074a0bdb5","rust/crates/er-battle/src/m7_resolver.rs":"dfffaea779e7e3d4d2d7f0fb20bbba70564051036aed760d7e46b4b71114fda9","rust/crates/er-cli/src/current_agent.rs":"7b8f300ae710549892a91ae97bab2dc25f2bb77372eb50690c247e9ce9368ead","rust/crates/er-cli/tests/m9e_fresh_friendship_profile.rs":"76d7b00a28a2b4028a9235732e25dec7030e1188390f1486977f812794f0ba22","rust/crates/er-env/src/current.rs":"ec99d6fa36ceae1401b5a0521718b5220100fdd0fafb5a29dbb171f3b128a2b3","rust/crates/er-game/src/current_bootstrap_storage.rs":"18697c6777edbd872b04607b86792f13079dbb23a229ec60176f3bf6c7e9b169","rust/crates/er-game/src/lib.rs":"c0e376b0449c9daa27972e5942fb65c02ca3c0d1ca1a9e6d2565f6de3e892e4c","rust/crates/er-game/src/m7_progression_control.rs":"ef3a2d0ed837e0377e01f79f7632e973029f9dcc4805434d5adb70f2d6742554","rust/crates/er-game/src/m72_bootstrap.rs":"b771ff1a3bc4c1bf145539094d4ee80de6e5d3807199a879332af0fe735db442","rust/crates/er-game/src/m9e_content_v2.rs":"9a4dbe89507d2e82b60b3fa5107d3211e9b08101e997574299c362cccf250299","rust/crates/er-game/src/m9e_internal_event_v2.rs":"c76f44fa4720b75bd167c86ca4ef0fb4265cd47bfa5683ce5e5cdb61479c6cf3","rust/crates/er-game/src/m9e_material_v6.rs":"80c79f00c87dd8b581cccf65dc329e7223c8915c99adc98f4f09056a2464a118","rust/crates/er-game/src/m9e_new_run_v6.rs":"b43fd0846f670532da050bade946593ee7b08ce77815698aafb7512c6e20ecdc","rust/crates/er-game/src/m9e_runtime_v6.rs":"3a79ec4f30e8b262de6eb6db93ab88e04644fce5ef7ea25ae2df2397078eb63a","rust/crates/er-game/tests/m9e_content_v2.rs":"bb4e57a32dd8224e351e530a32a906e0d538e6a85c3fdee33926e131391d5245","rust/crates/er-game/tests/m9e_material_retention.rs":"0069b3ff0a82eaaab623ffa32ac3fd866b4403bcdd11acebe983338ef35770f3","rust/crates/er-game/tests/m9e_material_v6.rs":"269da25c5bf034487041c738061deea1ede83677ce06cd14276e6dfe01ff43e0","rust/crates/er-game/tests/m9e_runtime_v6.rs":"4e1bf2dfdc4947be09d255d6198ef5f4adb52ce6d6b418699a0065b25d814c6c","rust/crates/er-kernel/Cargo.toml":"2b244502f54359df2852f5f05051a149154629a131f7b862c33a72c12f5aaabd","rust/crates/er-kernel/src/game_kernel_v7.rs":"4578172d237e62a1c126a9631fa8fa3979b9ae3bd3ae207df3884aef04721074","rust/crates/er-kernel/src/snapshot_v7.rs":"2f799081973a0c4286c6ea7b3ffa58f9c2ab8a12395176b7592785494593dd6e","rust/crates/er-kernel/tests/m9e_coop_v7.rs":"6f41a6eb991dca0a6291cf89f61cbd648f1875c559b6f77e55a8eb190e252d74","rust/crates/er-kernel/tests/m9e_current_target_execution.rs":"47e6c3770c91abf761115f446491184caee5f6b1bcb4f30151da9f1f4cb2925f","rust/crates/er-kernel/tests/m9e_material_retention_v7.rs":"b10cbc0692d24cb38b37ed4572ab23b4313ea827b78a58a182abf197d1c2354c","rust/crates/er-kernel/tests/m9e_snapshot_v7.rs":"48a3c7075acbb038727402015fcc39dca491150b60386aaaa41b1e7b2be8a263","rust/crates/er-progression/src/current_friendship.rs":"aee0bbcd18aff379e4d3080925108bda28c69d2f7f9e14131d648c07a1ee05b0","rust/crates/er-progression/src/lib.rs":"725c9a073583a5939ec8d3541eb8d0165ab5ff89491079e11e4490c0cb8fbfd1","rust/crates/er-repro/src/current.rs":"f10b89069fb1b77df738490e5336e1ebd5f342f35afd7bcf1e1eba69e3359c74","rust/crates/er-repro/tests/m9e_current_rebind_repro.rs":"ea91f7112c8992095922fe1f53e28b7724537e0e7727fbf58089cb0e9a6b2eb4","rust/crates/er-repro/tests/m9e_natural_campaign_replay.rs":"87b29f705f6236e97a42ae4c35959674a91ba8f08d58ed3a630c5c6aa2050354","rust/crates/er-rng/src/audit.rs":"7c57cb4108ea24eb4241e85839db8d912b48b3ff80ea61579d7204ff3280059a","rust/crates/er-save/src/m9e_save_v2.rs":"c40214202c7208aa7edd6f138c8debfbf80d35b80b0898c8ebf60fad5dac918f","rust/crates/er-state/src/current_battle_participation.rs":"6951be193c1af2c0b05de1628771421e016a99af3b9faa5757ff199c2f11c3b3","rust/crates/er-state/src/current_experience_owner.rs":"d7db6989ed6af104467d739091d372e13d8ef737f39c3b28642ab716f87e59ef","rust/crates/er-state/src/current_friendship_profile.rs":"5f9c0aa04d50048cc9f251cfe8d88a31162474d5bda2b2e396dc02d15ff6d032","rust/crates/er-state/src/current_turn_execution.rs":"13fd0b0938183524613bea63d047520ebff5045fb1a56856bdda3c0af1e53b34","rust/crates/er-state/src/lib.rs":"33a00ad3a2c88de9019bb15ff5a244202bda7e08d248d1963e9b45529ae85f5c","rust/crates/er-state/src/m9e_state_v6.rs":"08d6c5b16e0945e62c96853f512ad49318630eb129cda0c88e77f7615d8122dd","rust/crates/er-types/src/m7_action.rs":"26cd7a22833373d4c0f0b37a68516a2c80abd86f147f70a5653b7caeb24a06db","rust/crates/er-types/src/m7_menu.rs":"f79b0d2d971ad6591c9b53e06e93616bcca9e878b687a7a685f99fecc977ee8d","rust/crates/er-types/src/ui_menu.rs":"9971297d1a4339a574d547c64ea600f7fd23da229237e97a9fe874e0b429473d","rust/crates/er-types/tests/m9e_menu_validation.rs":"99c2938a7878023a124bc9927b8af92e530d6bb7ccad47ae2d52be47ad0e352f","rust/crates/er-web/examples/m9e_v7_storage_fixtures.rs":"048d32d388fc25e98372cea60e0c03d6a47eb36bc91fd6bf40bc854aa9a31aa6","rust/crates/er-web/examples/m9e_v7_title_storage_fixtures.rs":"e6fa69d6105b9437b7bc3869d483ebe72b0ac06e2425a088c6303522cfbca98f","rust/crates/er-web/src/contracts_v2.rs":"132fc40b4d16a1b7edc99f506361c0e979bbd19b50e38a222b14979b637a5aaf","rust/crates/er-web/src/host_v2.rs":"ede1c513d7fc80e06736f595e83b971c68ea0011bb728df51055589a7b5e572a","rust/crates/er-web/tests/m9e_host_v2.rs":"a218698bee24c393a7358204d5172ef3834883838ecf4d1ea9a51ee311326ba4","src/rust-browser/contracts/browser-contracts-v2.ts":"38d33611663354f6665d6bc32840628a4e563e3e8db68e5692a2db9a9103b50c","src/rust-browser/routes/browser-effects-v2.ts":"88e233f9025c5de3b201f37656687a2f161ac4b7ec916dd1a4e215a71e5556d2","src/rust-browser/routes/rust-current-storage-entry.ts":"8165c47d69f0335961d650cf4039cde8a7d1b039c9dbf24cee714d20d69356e6","test/node/rust-browser/engineering/browser-effects-v2.test.ts":"1779e10b610195eb44b4664bb0d46ff3b4eae6d2189ea0892273037d15540f48"},"after":{"docs/plans/rust-kernel/m9e-continuation-20260910.md":"24467f77cb615a3a2343c36782cfea6704888b1d66660b0ee85f138ad04afd39","docs/plans/rust-kernel/m9e-deferred-learning-draft-3e6e39d.rs.txt":"a7602a7bee7ffcad8ef48ec3396a373eec9b133ed5d6ee783389b2aba68c039c","rust/Cargo.lock":"348f09e4bc5255e5cc1bd456b27dc1322aea4053736f73519f4882d7798a4297","rust/crates/er-battle/src/current_defender_abilities.rs":"f6a01a87167307cd95d0fa1d501de61dfbdfe6cac0c813e5101758d938f36c52","rust/crates/er-battle/src/current_defender_execution.rs":"19ff5d3850e98b9d9391e990bbd0440b0ab8f71446fd8b7591342ad80b8d4fbc","rust/crates/er-battle/src/current_target_execution.rs":"d306296ee6f26cd3156864bfa8b1867bc1246e45f74b2bae072f92b1d81d3005","rust/crates/er-battle/src/current_turn_continuation.rs":"8585835d53fe77ae7d4516fdbbab67723b77d3fb71e611109b9152048b749594","rust/crates/er-battle/src/lib.rs":"ba19f1bf2300d8b6fa243a2a054bd5d9091a9a789dcf29eab6ffa6e1c451f12a","rust/crates/er-battle/src/m7_resolver.rs":"0cf7ccbdfc6262fc1a14965799e4910256d58a1f905d8a4d82bf9e45bc223286","rust/crates/er-cli/src/current_agent.rs":"ca39614bfe67f3480540001ce8a226b3944586e9287031f24aa19d1dc935cf0b","rust/crates/er-cli/tests/m9e_fresh_friendship_profile.rs":"e3514cc8e50bd5aab4537114dfac3700e01071b60fcd30e387b633547ebeba4c","rust/crates/er-env/src/current.rs":"211bd9b48dbf0a4390a971b9982932e466916a21c1f6d8f9ed123a04e504177b","rust/crates/er-game/src/current_achievement_action.rs":"2c6e1808e93b4d329e041508c87bddb1d75bbd059b3445b83cf438e2a85bb1e0","rust/crates/er-game/src/current_achievement_rewards.rs":"57d3481bf6132966fe7d2ead33274910a0e9d92f4475e3b5857cc6040ca3d7d8","rust/crates/er-game/src/current_battle_presentation.rs":"11d7ddda049be7ff1146877b14ef84a450523a2637be17688d2b26cb100bc3ae","rust/crates/er-game/src/current_bootstrap_storage.rs":"4d23c2676e5d4ceea9e30beea164c00920213c792f99aadd6ad93b1c95c69bff","rust/crates/er-game/src/current_experience_settlement.rs":"f3ff728fb18cd7ab30680909fe7cd1a74bbdb031895e68006698f875bab78d7d","rust/crates/er-game/src/current_experience_validation.rs":"3bb6ec921c8cf50225d15233e33b1ccb632d708f4dd624c0a27fb9aa710e7f1e","rust/crates/er-game/src/current_faint_execution.rs":"e3f7b92e28b86cf4ac4910ca3a6e698fa4a20841e8e046cd1c45f40b608156dc","rust/crates/er-game/src/current_faint_transition.rs":"89b6d4914edf26bff4c8389294b57f83b4cef84ef06e520867c0c453a1652500","rust/crates/er-game/src/current_flash_dispatch.rs":"094932ca8178ac2adf425447ca61e0e40548b1a99d0181757319b8a6ca1a60f6","rust/crates/er-game/src/current_flash_egg_pool.rs":"62472785a94ccbd9328616ba991d98d65a538b4bdc5b54c92eb4094a358f4c67","rust/crates/er-game/src/current_flash_egg.rs":"d3783364d383fedfed01b3013eb173ca732d35b6ebef61403b479ce69757a49f","rust/crates/er-game/src/current_friendship_execution.rs":"b5d8ec0dcbc2d52cbfefbe2a8e7e58779a891760f826210275e29f07b924cc3a","rust/crates/er-game/src/current_initial_battle.rs":"122ca3943a98a351f661aab78635555291914b4154b548d9bac471368166d577","rust/crates/er-game/src/current_initial_victory_tail.rs":"6c65b67959e6ad48cc02698d1bb38d3d03e9aebd281645e3bc20c9b39e984806","rust/crates/er-game/src/current_learning_runtime.rs":"897eb2f1d32bfc4fcc3df7ba434a856cfe9a608de95409bc41ca6e07a833d5e2","rust/crates/er-game/src/current_level_account.rs":"f3c67c8cbb5e56c2ae1c0870f2db8fb718dc361d024968206571ae0da705e739","rust/crates/er-game/src/current_level_dispatch.rs":"8695d8463b3a46a599690128af5e56e1586ceb58aabe4b1146b680db600aacc8","rust/crates/er-game/src/current_phase_runtime.rs":"034d88c8b0d6e24106b4ee90a301d24c47b394b0873133f10e51ee2b1880676a","rust/crates/er-game/src/current_random_target_admission.rs":"4139ac7620d8d92a7f57219ecf5a3ecab1188c69698727e8241c2b957d63b68d","rust/crates/er-game/src/current_reward_catalog.json":"1b6183e6a30f642dec0f3b9e0e8d0534d2225c2db65a5e22255169535d0e06c6","rust/crates/er-game/src/current_reward_common.rs":"59120e00594824550afa0047d1486def6ee96b14962f59e1e2af0d7fcc7eee71","rust/crates/er-game/src/current_reward_first_closure.json":"1dc22da75c2cfb415520f88aef216b28bfbbf8a02269c98768ed4d40fd83ee4c","rust/crates/er-game/src/current_reward_first_pool.rs":"1fe1b64a03554a88735bbbf69df9d1b497674486340849634bc6e5ebcb2aa030","rust/crates/er-game/src/current_reward_generated_names.json":"f2da3dd040fedfb03698303efce9192d57b997f405d8965d0975dfc0234643f7","rust/crates/er-game/src/current_reward_generators.rs":"cb5732351c58a07859b2fc935a0011457451341029675c0f4c0a723b9b815879","rust/crates/er-game/src/current_reward_great.rs":"0f9406ccda3621ba48e2fbbdd8907b2a9bab796e06806cc216640332566b5f9d","rust/crates/er-game/src/current_reward_healing.rs":"8b81a0833efe76234f96efd59d86d52bc3a37b47c353cd615614814969b4b225","rust/crates/er-game/src/current_reward_high.rs":"e49e64d96058806306c0e8e5f070e3dd78acd78a619ff1ba667320d63a5dddc9","rust/crates/er-game/src/current_reward_metadata.rs":"98a6221d2bc4c953b9b149c31681eb98c68d571e02b6bbbcb14fc8ace11ce747","rust/crates/er-game/src/current_reward_pool.rs":"290ddc5471e56ee476107174c2d8258e315fc27804f92cfacdd36b87687105ec","rust/crates/er-game/src/current_reward_roll.rs":"e32118a60f86fd861fb0dd648ec9361f4431749b45a70e5c19feba2e6efd4d18","rust/crates/er-game/src/current_reward_runtime.rs":"9cc8aeb53ad9668f09f7ee2067f2ea86a990268a78565f0cc8c54fe0cc33b075","rust/crates/er-game/src/current_reward_selection.rs":"6a36086f3cfb257bbe03768a85fef9b32245bf8b9f9f5995d130cab3130aae0b","rust/crates/er-game/src/current_reward_tm_closure.json":"15341aece834bd0a7e9756f23ae0feab2ce9abe52381b5fead85f3304a509e47","rust/crates/er-game/src/current_reward_tm.rs":"87f20e3d29917fbd9e0b0f557357d61dc3a89a0898f976465adf374ecbc7ea9d","rust/crates/er-game/src/current_reward_transition.rs":"2797fac78ccbf2f3855899bb3e214db2436367fba1460ef94fc8ec8acb3e3bcc","rust/crates/er-game/src/current_reward_tuning.rs":"0c82c3edd52e6dfea15b0bd8af3e78315a9ea27d675cca2979c07748e72ffc94","rust/crates/er-game/src/current_reward_ultra.rs":"61935f5823e84498ee868e13d614d4d6ea8ef078137705efe4bb9a70bee74805","rust/crates/er-game/src/current_source_progression.rs":"7237c150ffbd786d5123278186a20b727757a3d706464693b47db9a420ae7a0b","rust/crates/er-game/src/current_source_turn_progress.rs":"1ada7b43401b52ce02ed5bbfab7ba3df51f2b8cced709daa3b001f3a2fe670bf","rust/crates/er-game/src/current_starter_pokerus_pool.rs":"f840a54e290d120c87ea3e8d224fef42f77b72f12e4ac338276878568a677021","rust/crates/er-game/src/current_starter_pokerus.rs":"35e5857b62c4868ef2451118222fccef20a17ef86acc3abeed50d2c5d0cdeed2","rust/crates/er-game/src/current_victory_pump.rs":"331d4537583c956cab4ed2bf9e3ed900abd50b13543dd164df13c9238b579983","rust/crates/er-game/src/current_victory_start.rs":"98228ecae744d3ce07cc35d3bf08696e23ec6232334f892d1d7ba30caab01b7b","rust/crates/er-game/src/current_victory_transition.rs":"10e8c995175f3a7de8a639bf0aeada26828afc721d41a10e134a422bb558dc9c","rust/crates/er-game/src/lib.rs":"250ce19aa55fcac4365ec3479ada0e89a1af42a9edf9a455b7cc34c6132f9b2b","rust/crates/er-game/src/m7_progression_control.rs":"1f7502342de05c0546b92f44dcd96ab7d4a6d78bae11cc53ff2f62b659f3c222","rust/crates/er-game/src/m72_bootstrap.rs":"94a9f885c9554050170c2f965d782b7480b9a8bca8d74c479cf6165534eeb9fb","rust/crates/er-game/src/m9e_content_v2.rs":"c95562ff6c3fc90d1f84ba61ee397524178cdcd74083bbc3c6b87a1abb83d7fa","rust/crates/er-game/src/m9e_internal_event_v2.rs":"d7dc862cc3db495401cdf13a5414aada98f23aeac9fa9cd8a93f39660b06faf3","rust/crates/er-game/src/m9e_material_v6.rs":"fbdb554418853e16e21a390f532bfc52aa00e864f724c4057c70fc4ed80945ae","rust/crates/er-game/src/m9e_new_run_v6.rs":"54a58558dd85d9f04c71bd8578daf5a0674dcef56277df40369de976e00cdf9c","rust/crates/er-game/src/m9e_presentation_payload.rs":"5ef8402a4bbd75181a00c039d1610690fe7e30f85408517c5ce69f8ea81835ec","rust/crates/er-game/src/m9e_runtime_v6.rs":"562303716b3d4983c43b6983a1fbf23fd445e4588aee3639d406fff1d405765f","rust/crates/er-game/tests/m9e_content_v2.rs":"e0a9ce267aaee14be2944cf24bfc76f7cc92f8dd7ab3797c6f7bc63be4941d31","rust/crates/er-game/tests/m9e_current_reward_source.rs":"36921690c894c1392ba71a0ed29f38f0ffe64d6189b9192fb8faa73c273d2000","rust/crates/er-game/tests/m9e_current_starter_pokerus.rs":"4ad7e0fd4fa3b8cbb3fdfd7131cc6be562616b96eb41df70987d8918c8d194fb","rust/crates/er-game/tests/m9e_material_retention.rs":"24a7c415fe13cf08ce17e7b8d0184f39c0f32b6be91100fa1aefb41b173e4682","rust/crates/er-game/tests/m9e_material_v6.rs":"0a333ec72f7fce848e74efaa34b7dfb37a2b3629d6fe99916765390905b68ae7","rust/crates/er-game/tests/m9e_runtime_v6.rs":"37019ff1ac5537c9114007d56dd245e2cfb88eac1631b27d3f02f2ec54aff1ce","rust/crates/er-kernel/Cargo.toml":"e326261c496f8d62019cfa2866b1b0762422148e32f111b4797117eb01df5a28","rust/crates/er-kernel/src/current_learning_control_v7.rs":"fb63873e32807dca0bd7eca2c2efc5cf44a167bb9beed3e17b8b67bdddea71ca","rust/crates/er-kernel/src/current_phase_receipt_v7.rs":"e11fae1fff496255b096a08c4fc1ca8c9e841ad79a47a7f37b0148cdb6abc061","rust/crates/er-kernel/src/current_phase_restore_v7.rs":"ce964357fd0c1f7471a1bd818cc1a5fe19de6ce033bf67b3def5b0e27dfb7bf1","rust/crates/er-kernel/src/current_phase_v7.rs":"b5f4c1ea93ac60666ca3266930eceaaff130985f3624027526b4032032f4633e","rust/crates/er-kernel/src/game_kernel_v7.rs":"13f8725f854572b55f74b388f65d8f5dad07dd2fff36df5dee646a25af8f7fdd","rust/crates/er-kernel/src/snapshot_v7.rs":"c9869c4f2dbf18a0ab7dcf8719e625c7340aa4d13c27eb27a656d530293350de","rust/crates/er-kernel/tests/m9e_coop_v7.rs":"a15c713e1349c83aee5a04d42bfb19f1d29e21b5bca083e970847be7df128467","rust/crates/er-kernel/tests/m9e_current_defender_ability.rs":"a6fd54a30be31d17573aad10571b72f6505e328206e89f7944f98b5f4b024dac","rust/crates/er-kernel/tests/m9e_current_phase_execution.rs":"65b9b44ebab349ce549ae1a1d8baf90556dc46aae004559fa73fe680eaf04709","rust/crates/er-kernel/tests/m9e_current_target_execution.rs":"b1d1c8f48bdb3d2c10d4c9b1e98f5d085ea2374ca96c578b7e9778f73726660b","rust/crates/er-kernel/tests/m9e_material_retention_v7.rs":"d45f5469144aa6342dcd4f9699db7f83d21a6f2d45381cf143fffd2b969982be","rust/crates/er-kernel/tests/m9e_snapshot_v7.rs":"f0e4358991023e803214eee8a3db7e746f0b8218f0cf3f338145b3c3304410e3","rust/crates/er-progression/src/current_friendship_phase.rs":"fa3241bea04d0c245680d0972aaae1cbc95b0b175a35ee0e23184024f861899b","rust/crates/er-progression/src/current_friendship.rs":"c49300f197d3850d5e7bbb7d49e1b3e6064a549b3af573d4fe4f6f7915527333","rust/crates/er-progression/src/current_stats.rs":"f5f179791c255f07902e78d2984a461ae31d57dab2eb6ab5a4a39874a38afe5e","rust/crates/er-progression/src/lib.rs":"1d6e629eb2efc8d7392b1a081433674c98cc0ae7ed07cea9d54f9e179f5bdf8e","rust/crates/er-repro/src/current.rs":"aa9848d555f00810462002bde1a2ff8a0212de5a4224b091ec43576e7b70e9e4","rust/crates/er-repro/tests/m9e_current_rebind_repro.rs":"c84a8ab6ac31e5e53173b9a2468f713da1be85fd7279013de3fc093cd59c5e08","rust/crates/er-repro/tests/m9e_natural_campaign_replay.rs":"ff099ccd6771f09aa7a093d1fd6774e6b0242ffc2137408e4ffce6b0fdfe984f","rust/crates/er-rng/src/audit.rs":"20ad3f2d5824a6bef2e0b8ad5636d7cc670faeb1f167b31cb858b446d80c3e08","rust/crates/er-save/src/m9e_save_v2.rs":"aff40ba616386c13ea93ef13488b657a80bf525d93ef6b8ba42c8457c4a42713","rust/crates/er-state/src/current_achievement_execution.rs":"c69463ff2c0122568b1245718307740e5b063f56f5f37b1d1e8c44954f670df3","rust/crates/er-state/src/current_achievement_tracker.rs":"59d2157a6bebbb6a4b9b580760e7df6c7a95f74a8fd76e53c056bf0573ca6520","rust/crates/er-state/src/current_battle_participation.rs":"bad862016596eabfa48f43775993edf87557e5ec5e4c84f9d09069091e80783a","rust/crates/er-state/src/current_battle_source_events.rs":"d38784cb85256be411f690a2ec5f39ad18e66b32856b9625ab48a3bb428588ab","rust/crates/er-state/src/current_defender_dispatch.rs":"70d8367f163cf8f1f5823ead97fcd4449bbd17311d926eb84a96e9214cdf8304","rust/crates/er-state/src/current_egg_account.rs":"4642452c15c6f3fcedd5879b55202f21080c8941cdb8d34f7aaa3cc2510fbcb7","rust/crates/er-state/src/current_experience_owner.rs":"2c7eac2b3d7e2c6e83beadcb5e20af20648e8cec9adb4dad641e00186207ebc6","rust/crates/er-state/src/current_experience_settlement.rs":"71dba8e314a60f0c3c0d0b7ae6b684fc66a1e9306d7a3b819ae9e5b70ac62add","rust/crates/er-state/src/current_faint_execution.rs":"34836eb1786672dc35fa091ddb881046dd192c7d2fb808b4c70134ba73895cca","rust/crates/er-state/src/current_friendship_phase.rs":"5552fe10d067a8e1f4b322d591ee21c425516eabd8379068c4a93afa11ee8874","rust/crates/er-state/src/current_friendship_profile.rs":"a13e171819f0255290cb7c08f07a885e3d8240d2b1376c35b81b5925df1f08a6","rust/crates/er-state/src/current_friendship_rewards.rs":"76dd0f8072f8a328d06478d7e3d2a7cedee499b5f5567468b2104aea0b65f8d0","rust/crates/er-state/src/current_initial_victory_tail.rs":"13d95ac33fd98681c20984d315335a7fa60ed86efdba650b92c63350fc90ab02","rust/crates/er-state/src/current_presentation.rs":"6cb30a93d236a498fb5a59dddda53edfaa514bf5794a20160fb08a25907b9898","rust/crates/er-state/src/current_random_target_commands.rs":"613ae2df999c30515f9b33f82c3534437d9a499127cf2c187736ede9f16b57aa","rust/crates/er-state/src/current_reward_run.rs":"6f659caf7c48810af70b58c0c8da7c25f09c179acc4bec8923669a0b9ed8a2a2","rust/crates/er-state/src/current_reward_selection.rs":"38f05971a11c41c8cf647b0df62a5d0a5c1d9c25864ea1294ffdce7921471301","rust/crates/er-state/src/current_reward_tm.rs":"1f5aec93ce8584b0ff7378eb15fd46e17f4b2d60fc88961c7e9c785960f3c336","rust/crates/er-state/src/current_source_progression.rs":"f41263aa3a429fb0f2f88bd7a8089ed1b44ef72f82d3200753db059b9f7178a7","rust/crates/er-state/src/current_turn_execution.rs":"30dff7e848909bc80726e8199156740a60468968c2c5d194afaa9e0d43c66fe7","rust/crates/er-state/src/current_victory_execution.rs":"ac0cfc7c6361f6209c901de679632d58a1620994cfb44e5668196a98cdff1005","rust/crates/er-state/src/lib.rs":"0df5019f7bfa9c902adaaf41c0aa21d02443715fd9e2c62d75deba68bc2c4a93","rust/crates/er-state/src/m9e_state_v6.rs":"dcde91a45ace8dd425ec1058d6637b041c28272defc6728e53677f2ea9c36ed2","rust/crates/er-types/src/m7_action.rs":"3acf38ef3de9f28629dc1160188a42e84efe570941c508a7749c7f4a300227e5","rust/crates/er-types/src/m7_menu.rs":"ebc210dfaa04172de48dce3c538891a663ba13092db2235cd52e5e3b7ba2a4a7","rust/crates/er-types/src/ui_menu.rs":"d822400d99743dcb4e06dfa091a3c7819500094cde0031fe0f5b9fd04499255e","rust/crates/er-types/tests/m9e_menu_validation.rs":"222aaac167a4aa96d5e76532295fc3c315f5d775cabdd0c3e3a26862604ca6fd","rust/crates/er-web/examples/m9e_v7_storage_fixtures.rs":"2dbdbdf8504d618da82c2fac26362e0042437f690a09db00b1630d8b963f0bb1","rust/crates/er-web/examples/m9e_v7_title_storage_fixtures.rs":"6b41362333b5d4f846095f9b29cd163464997c39dd733cca7a9351fbeb6ac4dc","rust/crates/er-web/src/contracts_v2.rs":"4e506d54f5b1a36c3e7719e64a1b347ee718b74a60aed0b949e66dff955a8ca0","rust/crates/er-web/src/host_v2.rs":"094985677b552c149051ac184449164ef834f4f603f8ac4b694824cffe12c43d","rust/crates/er-web/tests/m9e_host_v2.rs":"17ed02cacedff82c97ccb68a3e417d3de1c9a085d9cfaaa89b0ffa184317e23b","scripts/ci/m9e_current_phase_js_diagnostic.py":"6515e5a64434a6cb096d2280df5d957f7aac46400692281ac81988f4984e86a5","src/rust-browser/contracts/browser-contracts-v2.ts":"f7d47bb4979c369e12e480692d3458079388112ae49510b98a741f824226b255","src/rust-browser/routes/browser-effects-v2.ts":"2c3da95070ac632544b25856515a327243e450ae917afc6190d10c27dcf04a11","src/rust-browser/routes/rust-current-storage-entry.ts":"216e298ec71af5644d309e04305f59e31fcbdb0804ab6693eeb035b693608e68","test/node/rust-browser/engineering/browser-effects-v2.test.ts":"d31edede5555d6465d8c3b24f70453a1e7791185a0359a2f219f42ff684a8e42"}}
TARGETS = {"m9e_fresh_friendship_profile":{"crate":"er-cli","ids":["fresh_catalog_requires_qualified_complete_progression_not_only_oracle_sha","fresh_owner_restore_rejects_catalog_and_schema_forgery_transactionally","fresh_title_accounts_survive_natural_state_save_and_captured_replay","unknown_profile_restore_does_not_create_accounts_or_erase_legacy_bytes"]},"m9e_content_v2":{"crate":"er-game","ids":["direct_bundle_rejects_legacy_core_fields","direct_content_v2_prepares_every_current_domain","state_v6_validates_the_complete_content_identity","unresolved_starter_move_fails_closed"]},"m9e_material_v6":{"crate":"er-game","ids":["common_applier_is_idempotent_conflict_safe_and_snapshot_stable","material_rejects_variant_domain_revision_and_mutation_gaps"]},"m9e_runtime_v6":{"crate":"er-game","ids":["bootstrap_candidate_is_serialized_and_installed_through_the_common_applier","replica_cannot_dispatch_canonical_actions","save_action_allocates_one_typed_request_and_emits_canonical_save_v2"]},"m9e_material_retention":{"crate":"er-game","ids":["bounded_material_suffix_crosses_three_full_4096_windows_through_dispatch_and_apply","retention_policy_restore_and_revision_exhaustion_reject_without_retirement","small_suffix_retained_conflicts_late_invalid_and_stale_material_preserve_full_frontier"]},"m9e_snapshot_v7":{"crate":"er-kernel","ids":["active_snapshot_round_trips_at_a_quiescent_boundary","quiescent_v6_snapshot_migrates_without_gameplay_side_effects","terminal_lifecycle_requires_complete_control_and_terminal_identity","typed_pending_effects_cross_validate_allocator_and_content"]},"m9e_material_retention_v7":{"crate":"er-kernel","ids":["v7_material_rollover_restores_pending_effects_and_continues_exact_snapshots","v7_restore_rejects_historical_gapped_evidence_and_continues_a_valid_suffix"]},"m9e_game_kernel_v7":{"ids":["authority_ai_can_choose_a_legal_enemy_switch","authority_ai_exhausted_max_pp_uses_struggle_without_extra_decisions_or_pp","authority_ai_max_pp_boundaries_drive_raw_choices_without_extra_rng","final_wave_victory_terminates_the_run","gamepad_buttons_drive_bootstrap_and_active_controls","held_action_cannot_cross_bootstrap_menu_instance","natural_solo_battle_reaches_terminal_using_only_physical_keys","nonterminal_battle_progresses_to_next_wave","raw_keys_complete_natural_start_and_install_serialized_v6_state","read_preserves_saved_difficulty_over_other_naturally_selected_live_difficulty","read_rebind_clears_real_repeat_ownership_without_cancelling_unrelated_work","read_rebind_keeps_larger_saved_floors_and_no_active_run_behavior","read_rebind_preserves_saved_semantics_and_executes_write_after_restore","read_rebind_rejects_stale_action_context_and_preserves_canonical_battle_root","read_rebind_rolls_back_menu_revision_presentation_and_replay_exhaustion"],"crate":"er-kernel"},"m9e_current_move_targets":{"ids":["invalid_owner_context_fails_without_inventing_rng_or_callback_results","source_random_draw_precedes_alive_filter_and_other_never_falls_back_to_ally","source_spread_promotion_keeps_adjacency_and_multihit_exception","whole_source_targeting_matches_all_twenty_categories_and_owner_call_order"],"crate":"er-battle"},"m9e_current_target_execution":{"crate":"er-kernel","ids":["actual_target_menu_retains_move_restore_and_cancel_owner","current_stat_calculation_matches_six_actual_source_observations","exhausted_pp_knockout_retains_actual_struggle_preimage","last_pp_knockout_retains_resolved_move_across_interlude_restore","natural_raw_turn_uses_current_targets_and_preserves_save_material","poison_redirect_and_source_passive_gate_share_actual_owner","queued_faint_retargets_opponents_but_preserves_same_side_cancellation","retained_turn_faint_blocks_later_move_at_live_reward_preimage","retained_turn_matches_uninterrupted_actions_rng_and_finalization","source_spread_group_executes_all_opponents_and_multihit_exception","unsupported_selection_and_owner_stripping_fail_atomically"]},"m9e_current_starter_pokerus":{"crate":"er-game","ids":["clock_counter_overflow_and_forged_restore_fail_atomically","daily_selection_matches_all_actual_source_dates","historical_absence_remains_unknown_and_requires_actual_fresh_profile","pending_clock_cancel_restore_and_request_floor_are_owned","picks_retain_their_source_day_through_reentry_and_natural_construction","removed_and_corrupted_picks_cannot_reuse_an_unrelated_daily_receipt"]},"m9e_current_defender_ability":{"crate":"er-kernel","ids":["actual_innate_absorb_uses_admitted_slot_and_shared_immutable_query","actual_poison_redirect_absorbs_with_ordered_payload_and_material_conservation"]},"m9e_coop_v7":{"crate":"er-kernel","ids":["coop_waits_for_all_human_commands","natural_coop_raw_proposal_converges_and_generation_is_fenced","private_party_reopens_restore_exact_root_and_apply_canonical_material","replica_delivers_save_presentation_once_without_repeating_authority_storage"]},"m9e_current_phase_execution":{"crate":"er-kernel","ids":["controlled_early_ko_flash_owns_clock_egg_candy_and_canceled_suffix","controlled_raw_initial_victory_tail_settles_once_and_retains_boundary","epoch_zero_max_unlock_does_not_request_or_repeat_achievement_reward","raw_knockout_waits_for_xp_prompt_then_level_stats_with_exact_material_restore"]},"m9e_natural_progression_v7":{"crate":"er-kernel","ids":["natural_victory_experience_recalculates_stats_preserves_damage_and_restores"]},"m9e_natural_campaign_v7":{"crate":"er-kernel","ids":["natural_current_campaign_reaches_policy_terminal_without_state_injection"]},"m9e_natural_coop_campaign_v7":{"crate":"er-kernel","ids":["natural_owned_cooperative_campaign_reaches_wave_200_victory"]},"m9e_natural_campaign_replay":{"crate":"er-repro","ids":["natural_current_campaign_replays_every_external_input_and_resumes_to_wave_200"]},"er_game":{"kind":"lib","ids":["authority_commands::compile_shape_tests::replacement_fingerprint_evidence_accepts_empty_snapshot","current_faint_execution::tests::faint_score_matches_five_actual_source_method_observations","current_initial_battle::tests::initial_classic_constructor_matches_actual_source_seed_and_level","current_initial_battle::tests::second_wave_single_constructor_matches_direct_source_trace","current_initial_victory_tail::source_score_tests::settled_score_matches_actual_source_turns_two_through_twelve","m7_content::tests::duplicate_behavior_classification_fails_closed","m7_content::tests::empty_run_program_catalog_fails_closed","m7_internal_event::tests::fifo_is_ordered_budgeted_and_quiescent","m7_progression_control::tests::capture_menu_has_stable_ball_and_decline_graph","m9e_internal_event_v2::tests::ai_budget_failure_retains_replayable_evidence","m9e_internal_event_v2::tests::empty_network_frame_is_rejected_before_processing","m9e_internal_event_v2::tests::fifo_processes_children_to_quiescence_in_order","run_menu::tests::direction_then_submit_uses_stable_option_identity","run_menu::tests::key_release_never_submits","run_menu::tests::presentation_barrier_rejects_human_input"],"crate":"er-game","source_inputs":["rust/crates/er-game/src/authority_commands.rs","rust/crates/er-game/src/m7_content.rs","rust/crates/er-game/src/m7_internal_event.rs","rust/crates/er-game/src/m7_progression_control.rs","rust/crates/er-game/src/current_faint_execution.rs","rust/crates/er-game/src/m9e_internal_event_v2.rs","rust/crates/er-game/src/run_menu.rs","rust/crates/er-game/src/current_initial_battle.rs","rust/crates/er-game/src/current_initial_victory_tail.rs"]},"er_state":{"kind":"lib","source_inputs":["rust/crates/er-state/src/current_achievement_execution.rs","rust/crates/er-state/src/m7_state.rs","rust/crates/er-state/src/m9e_state_v6.rs","rust/crates/er-state/src/mechanic_state_v2.rs","rust/crates/er-state/src/surface_digest.rs","rust/crates/er-state/src/bespoke_v2/guard.rs","rust/crates/er-state/src/bespoke_v2/item_lifecycle.rs","rust/crates/er-state/src/bespoke_v2/pivot_redirect.rs","rust/crates/er-state/src/bespoke_v2/special_damage.rs","rust/crates/er-state/src/bespoke_v2/suppression_immunity.rs","rust/crates/er-state/src/bespoke_v2/transform_imposter.rs"],"crate":"er-state","ids":["bespoke_v2::guard::tests::arbitrarily_deep_chains_validate","bespoke_v2::guard::tests::coherent_state_with_mixed_activity_validates_and_queries","bespoke_v2::guard::tests::default_state_validates","bespoke_v2::guard::tests::guard_kind_classification_matches_oracle_block_status","bespoke_v2::guard::tests::rejects_duplicate_self_guard_owner","bespoke_v2::guard::tests::rejects_out_of_order_or_disjoint_guard_ordinals","bespoke_v2::guard::tests::rejects_self_guard_on_non_pokemon_scope","bespoke_v2::guard::tests::rejects_side_guard_kind_duplication_and_bad_scope","bespoke_v2::guard::tests::rejects_unordered_endure_owner_vectors","bespoke_v2::guard::tests::rejects_wrong_schema_version","bespoke_v2::guard::tests::side_guard_chain_extension_matches_oracle_counter_rule","bespoke_v2::item_lifecycle::tests::default_state_validates_and_rejects_schema_drift","bespoke_v2::item_lifecycle::tests::duplicate_owner_slot_is_rejected","bespoke_v2::item_lifecycle::tests::out_of_order_instances_are_rejected","bespoke_v2::item_lifecycle::tests::suppression_windows_must_stay_sorted","bespoke_v2::item_lifecycle::tests::zero_stacks_and_empty_keys_are_rejected","bespoke_v2::pivot_redirect::tests::admits_and_orders_family_entries","bespoke_v2::pivot_redirect::tests::cleanup_helpers_remove_owned_entries_and_validate","bespoke_v2::pivot_redirect::tests::rejects_commander_self_pairing_and_outside_references","bespoke_v2::pivot_redirect::tests::rejects_duplicate_redirect_source","bespoke_v2::pivot_redirect::tests::rejects_zero_remaining_turns","bespoke_v2::pivot_redirect::tests::tick_expires_only_timed_traps","bespoke_v2::special_damage::tests::accumulates_and_releases_bide_style_totals_exactly","bespoke_v2::special_damage::tests::clear_window_keeps_accumulator_and_reset_clears_everything","bespoke_v2::special_damage::tests::records_eligible_attacks_in_receipt_order","bespoke_v2::special_damage::tests::rejects_full_record_window","bespoke_v2::special_damage::tests::rejects_status_category_zero_damage_and_stale_order_without_mutating_input","bespoke_v2::suppression_immunity::tests::default_state_validates","bespoke_v2::suppression_immunity::tests::handoff_units_classify_into_typed_lanes","bespoke_v2::suppression_immunity::tests::table_shape_matches_frozen_closure","bespoke_v2::suppression_immunity::tests::unknown_and_malformed_hashes_are_rejected","bespoke_v2::transform_imposter::tests::reject_out_of_order_entries_and_shape_mismatch","bespoke_v2::transform_imposter::tests::reject_pp_above_cap_and_zero_ids","bespoke_v2::transform_imposter::tests::typeless_copy_is_representable_and_never_carries_a_chart_entry","bespoke_v2::transform_imposter::tests::valid_copied_state_round_trips_canonically","current_achievement_execution::tests::level_achievement_thresholds_keep_source_declaration_order","current_achievement_execution::tests::level_cursor_rejects_wrong_pending_key_and_missing_clock","current_achievement_execution::tests::level_zero_unlock_and_invalid_date_preserve_account_atomically","m7_state::tests::duplicate_profile_identity_fails_closed","m7_state::tests::profile_only_game_state_validates_without_an_active_run","m7_state::tests::wrong_game_schema_fails_before_nested_state","m9e_state_v6::tests::allocator_validation_rejects_zero_and_below_minimum","m9e_state_v6::tests::empty_state_derives_one_and_domain_allocations_are_independent","m9e_state_v6::tests::exhausted_allocation_is_atomic","mechanic_state_v2::tests::empty_v2_store_validates","mechanic_state_v2::tests::migration_fails_closed_without_behavior_mapping","mechanic_state_v2::tests::migration_preserves_instance_order_and_ids","mechanic_state_v2::tests::wrong_schema_version_fails","surface_digest::tests::digest_ignores_the_carried_digest_but_tracks_surface_changes"]},"m9e_host_v2":{"crate":"er-web","ids":["all_five_initialization_modes_and_repro_effect_are_live","browser_host_survives_request_window","browser_network_and_transport_requests_execute_protocol_state","browser_requests_are_atomic_and_conflicting_retries_fail_closed","browser_storage_results_apply_cas_and_loaded_state","browser_time_and_lifecycle_requests_execute_kernel_state_changes","current_repro_exact_cached_retry_does_not_record_twice","current_session_and_browser_match_natural_input_and_external_outcomes","exported_current_repro_replays_raw_non_key_rejection_and_continues","invalid_current_capsule_initialization_is_atomic_and_can_retry","natural_browser_route_produces_typed_ui_transport_presentation_audio_and_assets","presentation_failure_retains_barrier_until_successful_settlement","rejected_browser_sequence_preserves_state_and_exact_cached_response","save_and_terminal_controls_produce_storage_and_terminal_effects"]},"m9e_current_reward_source":{"crate":"er-game","ids":["qualified_common_roll_stream_matches_actual_source","qualified_complete_tuned_pool_metadata_matches_actual_source","qualified_initial_regeneration_stream_matches_actual_source"]},"m4_types":{"ids":["logical_menu_canonicalizes_option_and_edge_order_without_using_layout","logical_menu_rejects_duplicate_options_duplicate_edges_and_bad_selection","modifier_tier_and_closed_surface_enums_reject_unknown_wire_values","run_hashes_are_strict_blake3_v1_values","run_values_preserve_safe_u53_boundaries_and_reject_overflow"],"crate":"er-types"},"m9e_menu_validation":{"crate":"er-types","ids":["borrowed_projection_keeps_logical_identity_error_precedence","cancel_requires_visible_enabled_option_before_logical_duplicate_validation","hidden_and_missing_selection_or_edge_endpoints_reject_before_cancel_and_duplicates","option_action_and_layout_errors_precede_visibility_even_for_hidden_options","visible_graph_allows_disabled_nodes_unsorted_storage_and_hidden_duplicate_ids","visible_membership_does_not_hide_duplicate_navigation_keys"]}}
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

def run(name, argv, cwd=ROOT, maximum=8 << 20, allow_command_failure=False):
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
    require(reason is None and (process.returncode == 0 or allow_command_failure) and len(raw) <= maximum, reason or name + " failed")
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

def compact_result(result):
    # Preserve complete identities and all exact IDs in one bounded indexed
    # member. The compact result references its bytes, never drops evidence.
    result["expected_targets"] = TARGETS
    full_raw = (json.dumps(result, sort_keys=True, separators=(",", ":"))+"\n").encode()
    require(len(full_raw) <= 262144, "full qualification index bound")
    (OUT/"diagnostics/qualification-index.json").write_bytes(full_raw)
    compact = dict(result)
    compact["schema_version"] = 2
    compact["qualification_index"] = dict(path="qualification-index.json", bytes=len(full_raw), sha256=sha(full_raw))
    sources = compact.pop("source_hashes", {})
    compact["source_inventory"] = dict(files=len(sources), sha256=sha(json.dumps(sources, sort_keys=True, separators=(",", ":")).encode()),
        index_path="qualification-index.json", index_field="source_hashes")
    compact.pop("expected_targets")
    executed = {row["target"]["name"]: row for row in result.get("artifacts", [])}
    started = {row["name"] for row in result.get("commands", [])}
    compact["target_inventory"] = [dict(name=name, crate=row["crate"], kind=row.get("kind", "test"), expected=len(row["ids"]),
        ids_sha256=sha(json.dumps(row["ids"], separators=(",", ":")).encode()),
        features=["default"] if name == "m9e_host_v2" else [],
        status=("passed" if executed[name]["passed"] else "failed") if name in executed else ("interrupted" if f"{name}-execute" in started else "not_executed"))
        for name, row in sorted(TARGETS.items())]
    compact["artifacts"] = []
    for artifact in result.get("artifacts", []):
        row = dict(artifact)
        ids = row.pop("ids")
        row["ids_count"] = len(ids)
        row["ids_sha256"] = sha(json.dumps(ids, separators=(",", ":")).encode())
        compact["artifacts"].append(row)
    compact["commands"] = [dict(name=row["name"], returncode=row["returncode"], elapsed_ms=row["elapsed_ms"],
        limit_seconds=row["limit_seconds"], log_bytes=row["log_bytes"], log_sha256=row["log_sha256"])
        for row in result.get("commands", [])]
    if "source_oracle" in compact:
        compact["source_oracle"] = {key: value for key, value in compact["source_oracle"].items() if key != "dex_initializer_excerpt"}
    return compact

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
                diff_lines = difflib.unified_diff(original.decode().splitlines(True), formatted.decode().splitlines(True), fromfile="a/"+path, tofile="b/"+path, n=0)
                # difflib preserves a source EOF without a newline but does not
                # emit Git's required marker; joining raw records glues -/+ lines.
                file_patch = "".join(line if line.endswith("\n") else line+"\n\\ No newline at end of file\n" for line in diff_lines).encode()
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
        run("proposal-clippy", ["cargo", "clippy", "--locked", "--keep-going", "-p", "er-types", "-p", "er-battle", "-p", "er-state", "-p", "er-game", "-p", "er-kernel", "-p", "er-save", "-p", "er-env", "-p", "er-cli", "-p", "er-progression", "-p", "er-repro", "-p", "er-web", "--tests", "--no-deps", "--", "-D", "warnings"], ROOT/"rust", allow_command_failure=True)
        result["clippy"] = dict(passed=COMMANDS[-1]["returncode"] == 0,
            returncode=COMMANDS[-1]["returncode"], log="proposal-clippy.log",
            log_bytes=COMMANDS[-1]["log_bytes"], log_sha256=COMMANDS[-1]["log_sha256"])
        selector = ["-p", "er-types", "-p", "er-battle", "-p", "er-game", "-p", "er-kernel", "-p", "er-cli", "-p", "er-repro", "-p", "er-web"] + [argument for name, row in TARGETS.items() if row.get("kind") != "lib" for argument in ("--test", name)]
        raw = run("proposal-build", ["cargo", "test", "--locked", *selector, "--no-run", "--message-format=json"], ROOT/"rust")
        rows = [json.loads(line) for line in raw.splitlines() if line.startswith(b"{")]
        require([row.get("success") for row in rows if row.get("reason") == "build-finished"] == [True], "complete successful Cargo stream")
        library_raw = run("proposal-library-build", ["cargo", "test", "--locked", "-p", "er-game", "-p", "er-state", "--lib", "--no-run", "--message-format=json"], ROOT/"rust")
        library_rows = [json.loads(line) for line in library_raw.splitlines() if line.startswith(b"{")]
        require([row.get("success") for row in library_rows if row.get("reason") == "build-finished"] == [True], "complete successful library Cargo stream")
        library_artifacts = [row for row in library_rows if row.get("reason") == "compiler-artifact" and row.get("executable")]
        require(len(library_artifacts) == 2 and {row["target"]["name"] for row in library_artifacts} == {"er_game", "er_state"}
            and all(row["target"]["kind"] == ["lib"] and row["profile"]["test"] is True for row in library_artifacts),
            "exact complete er-game and er-state library test artifacts")
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
        require(len(tests) == 24 and {row["target"]["name"] for row in tests} == set(TARGETS), "twenty-four complete native targets including both whole libraries, browser host, reward arithmetic and both whole menu-type targets")
        result["artifacts"] = []
        result["target_failures"] = []
        result["targets_attempted"] = 0
        for artifact in sorted(tests, key=lambda row: row["target"]["name"]):
            name = artifact["target"]["name"]
            crate, ids = TARGETS[name]["crate"], TARGETS[name]["ids"]
            target_kind = TARGETS[name].get("kind", "test")
            target_source = "rust/crates/"+crate+("/src/lib.rs" if target_kind == "lib" else "/tests/"+name+".rs")
            profile = artifact["profile"]
            binary = Path(artifact["executable"])
            require(artifact["manifest_path"] == str(ROOT/("rust/crates/"+crate+"/Cargo.toml")) and artifact["target"]["src_path"] == str(ROOT/target_source)
                and artifact["target"]["kind"] == [target_kind] and artifact.get("features") == (["default"] if name == "m9e_host_v2" else []) and profile["test"] is True and profile["opt_level"] == "0"
                and profile["debug_assertions"] is True and profile["overflow_checks"] is True and profile["debuginfo"] == 0
                and binary.is_absolute() and binary.parent == TARGET/"debug/deps" and binary.is_file() and not binary.is_symlink() and binary.resolve() == binary
                and re.fullmatch(re.escape(name)+r"-[0-9a-f]{16}", binary.name) and 0 < binary.stat().st_size <= 128 << 20, "actual artifact/source/profile identity")
            listing = run(name+"-list", [str(binary), "--list", "--format", "terse"], ROOT/("rust/crates/"+crate), maximum=16384)
            require(listing == "".join(test+": test\n" for test in ids).encode(), "exact whole target IDs")
            digest = sha(binary.read_bytes())
            output = run(name+"-execute", [str(binary), "--format", "terse"], ROOT/("rust/crates/"+crate), maximum=32768, allow_command_failure=True)
            counts = re.findall(rb"test result: .*? (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out", output)
            passed = COMMANDS[-1]["returncode"] == 0 and counts == [(str(len(ids)).encode(), b"0", b"0", b"0", b"0")]
            result["targets_attempted"] += 1
            if not passed:
                result["target_failures"].append(dict(target=name, returncode=COMMANDS[-1]["returncode"],
                    expected=len(ids), reported_counts=[[int(value) for value in row] for row in counts],
                    log=name+"-execute.log", log_bytes=len(output), log_sha256=sha(output)))
                # Publish one bounded causal hint while other whole targets run.
                # Complete evidence and mandatory failure gates remain below.
                lines = output.decode("utf-8", errors="replace").splitlines()
                hint = next((line for line in lines if line.startswith("Error:") or "panicked at" in line), "whole target failed; see indexed execution log")[:1024]
                hint = hint.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
                print("::error title=M9 target "+name+"::"+hint, flush=True)
            require(sha(binary.read_bytes()) == digest, "executed artifact changed")
            result["artifacts"].append(dict(target=artifact["target"], profile=profile, features=artifact["features"], manifest_path=artifact["manifest_path"], path=str(binary), bytes=binary.stat().st_size, sha256=digest, ids=ids, listing_bytes=len(listing), listing_sha256=sha(listing), passed=passed))
            if passed:
                result["tests_executed"] += len(ids)
        require(result["targets_attempted"] == 24, "every whole target must be attempted")
        require(sha(cases.read_bytes()) == result["target_oracle"]["output_sha256"], "whole target oracle changed")
        require(sha(host_binary.read_bytes()) == result["compile_only_cli"]["sha256"], "compile-only CLI artifact changed")
        require(sha((OUT/"diagnostics/fresh-account-oracle.json").read_bytes()) == result["source_oracle"]["oracle_sha256"], "independent source oracle changed")
        for path, digest in result["source_hashes"].items():
            require(sha((ROOT/path).read_bytes()) == digest, "source changed during execution: "+path)
        require(not result["target_failures"], "whole target failures: " + ", ".join(row["target"] for row in result["target_failures"]))
        require(result["tests_executed"] == 164, "all164 exact tests across24 complete target inventories")
        require(result["clippy"]["passed"], "mandatory Clippy check failed; whole-target results recorded independently")
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
            if result.get("target_failures"):
                failure += (OUT/"diagnostics"/result["target_failures"][0]["log"]).read_bytes()[-22000:]
            elif result.get("clippy") and not result["clippy"]["passed"]:
                failure += (OUT/"diagnostics"/result["clippy"]["log"]).read_bytes()[-22000:]
            elif COMMANDS:
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
        bounded_write(OUT/"compact/summary.json", compact_result(result), 65536)
    raise SystemExit(0 if result["status"] == "passed" else 1)

if __name__ == "__main__":
    if sys.argv[1:] == ["--source-oracle"]:
        source_oracle()
    else:
        require(not sys.argv[1:], "no unsupported producer arguments")
        main()
