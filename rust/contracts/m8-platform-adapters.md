# M8 browser platform adapters

## Input

Keyboard uses `KeyboardEvent.code` and sends keydown/up. Browser repeat is noncanonical. Gamepad/touch/pointer/focus/blur/text-entry events normalize to Rust raw input. Pointer selection requests a Rust navigation plan and sends its raw events; it never submits an option ID.

## Clock/lifecycle

Rust owns timer IDs, deadlines, pause classes, and consequences. JavaScript schedules only a monotonic `performance.now()` wakeup. Visibility, pagehide/show, freeze/resume, unload, online/offline are explicit events. No JavaScript timer advances canonical state.

## Storage

IndexedDB/cloud adapters read/write/list/delete opaque bytes plus generation metadata. Writes/deletes are transactional CAS. Conflict, missing, quota, corruption, permission, and timeout are typed. TypeScript save migration enters Rust through the validated migration boundary.

## Transport

Browser owns RTCPeerConnection/DataChannel/signaling delivery. Rust owns frames, proposals, receipts, retransmission, recovery, and generation semantics. Direct frames are byte-bounded before decode. Rust modes use authenticated P33 signaling only. Compatibility mismatch and mixed authority fail before gameplay.

## Assets/audio

Adapters execute typed requests and return typed results/outcomes. They cannot mutate state. All requests are sequence/generation fenced and disposed with the session.
