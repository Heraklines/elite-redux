# M8.1 co-op reload

A co-op reload is one pair transaction. Host and guest candidates are verified, restored, replayed, and accepted together. Mixed kernel generations are never routable.

The pair snapshot includes both endpoint snapshots, virtual clock, actual queued packet bodies/deadlines, presenter, storage, fault script/RNG, protocol frontiers, session epoch, membership revision, and transport connection generations. The supervisor acquires one pair reload fence after both endpoints reach external-input quiescence.

The candidate pair restores from the same captured pair image and replays the same ordered tail through the existing simulated network. Exact session, seat, authority, proposal identity, retained frontier, and connection-generation invariants must hold. A semantic-change policy must declare pair-visible changes explicitly.

Commit order is: validate both candidates; freeze both active routes; deliver/replay final shared tail; compare; allocate one next kernel-generation number; switch both endpoint routes and the pair route table in one supervisor transaction; release the fence. No network frame, timer, presentation outcome, storage result, or player input may observe a half-switched pair.

Late output from either old endpoint is rejected by kernel generation before protocol-frame generation checks. Candidate failure or post-switch acceptance failure atomically restores both predecessor routes. Rollback cannot cross a committed external persistence effect unless the predecessor has consumed the same effect sequence.
