# PokéRogue Redux — pinned TypeScript input oracle

Project: PokéRogue Redux. The snapshot is `3b534099919efae827019d4a3f3c4ab0ecd6d67b` and the protocol identifier is `er-coop-47`; the authoritative declaration is `COOP_PROTOCOL_VERSION` at [`src/data/elite-redux/coop/coop-transport.ts:138`]. The machine-readable artifact is [`schemas/kernel/source/input-map-v1.json`](../../../schemas/kernel/source/input-map-v1.json). The snapshot and protocol values are metadata for this inventory, not a Rust design. [`schemas/kernel/source/input-map-v1.json:1-11`]

The legacy source paths are preserved verbatim: `src/enums/buttons.ts`, `src/inputs-controller.ts`, `src/ui-inputs.ts`, and `src/ui/handlers/ui-handler.ts`. [`src/enums/buttons.ts:1-19`; `src/inputs-controller.ts:79-187`; `src/ui-inputs.ts:28-81`; `src/ui/handlers/ui-handler.ts:1-28`]

## Resolution chain

`InputsController.init()` subscribes the Phaser gamepad `down`/`up` and keyboard `keydown`/`keyup` channels, and subscribes the game blur event to `loseFocus()`. The keyboard subscription is inside the outer `if (typeof globalScene.input.gamepad !== "undefined")` guard, so an absent Phaser gamepad manager also prevents keyboard listener registration. [`src/inputs-controller.ts:144-187`]

For keyboard and gamepad input, the source resolves an incoming numeric code by scanning `config.deviceMapping`, reading the matching custom/default setting, and indexing `config.settings` for the logical `Button`. The scan returns the first matching device-mapping entry. [`src/configs/inputs/config-handler.ts:getKeyWithKeycode (lines 17-39)`; `src/configs/inputs/config-handler.ts:getSettingNameWithKeycode (lines 41-61)`; `src/configs/inputs/config-handler.ts:getButtonWithKeycode (lines 76-86)`]

The default keyboard table is `CFG_KEYBOARD_QWERTY`, with 77 declared Phaser key constants, a default setting for every declared key, and a development-only `KEY_Q` binding. [`src/configs/inputs/cfg-keyboard-qwerty.ts:6-97`; `src/configs/inputs/cfg-keyboard-qwerty.ts:187-222`; `src/configs/inputs/cfg-keyboard-qwerty.ts:224-302`]

The numeric `browser_key_code` values in the JSON are the values of the exact Phaser constants named by the source. The repository declares Phaser `^3.90.0` and locks `3.90.0`; the resolved external table is `phaser@3.90.0/src/input/keyboard/keys/KeyCodes.js`. [`package.json:72-87`; `pnpm-lock.yaml:1885-1886`; `src/configs/inputs/cfg-keyboard-qwerty.ts:9-97`]

`getConfig(id)` lowercases the gamepad identifier and selects profiles in this order: unlicensed SNES for IDs containing `081f` and `e401`; Xbox 360 for IDs containing `xbox` and `360`; DualShock for IDs containing `054c`; Pro Controller for IDs containing `057e` and `2009`; otherwise Generic. [`src/inputs-controller.ts:getConfig (lines 521-538)`]

The complete default keyboard, five gamepad profiles, and DOM touch-element tables are in the deterministic `mappings` object. The gamepad entries use `Phaser.Input.Gamepad.Button.index`; the keyboard path uses `KeyboardEvent.keyCode`. [`schemas/kernel/source/input-map-v1.json:263-486`; `src/inputs-controller.ts:362-429`; `src/inputs-controller.ts:440-510`]

## Logical buttons

The numeric values below are the sequential TypeScript enum values. The down/up dispatch columns are the exact `UiInputs` action map; `noop` means the registered keyup callback is empty. [`src/enums/buttons.ts:1-19`; `src/ui-inputs.ts:getActionsKeyDown (lines 89-115)`; `src/ui-inputs.ts:getActionsKeyUp (lines 117-139)`]

| Value | Button | `input_down` action | `input_up` action |
| ---: | --- | --- | --- |
| 0 | `UP` | `buttonDirection(UP)` | `noop` |
| 1 | `DOWN` | `buttonDirection(DOWN)` | `noop` |
| 2 | `LEFT` | `buttonDirection(LEFT)` | `noop` |
| 3 | `RIGHT` | `buttonDirection(RIGHT)` | `noop` |
| 4 | `SUBMIT` | `buttonTouch()` | `noop` |
| 5 | `ACTION` | `buttonAb(ACTION)` | `noop` |
| 6 | `CANCEL` | `buttonAb(CANCEL)` | `noop` |
| 7 | `MENU` | `buttonMenu()` | `noop` |
| 8 | `STATS` | `buttonGoToFilter(STATS)` | `buttonStats(false)` |
| 9 | `CYCLE_SHINY` | `buttonCycleOption(CYCLE_SHINY)` | `noop` |
| 10 | `CYCLE_FORM` | `buttonCycleOption(CYCLE_FORM)` | `noop` |
| 11 | `CYCLE_GENDER` | `buttonCycleOption(CYCLE_GENDER)` | `noop` |
| 12 | `CYCLE_ABILITY` | `buttonCycleOption(CYCLE_ABILITY)` | `noop` |
| 13 | `CYCLE_NATURE` | `buttonCycleOption(CYCLE_NATURE)` | `noop` |
| 14 | `CYCLE_TERA` | `buttonCycleOption(CYCLE_TERA)` | `buttonInfo(false)` |
| 15 | `SPEED_UP` | `buttonSpeedChange(true)` | `noop` |
| 16 | `SLOW_DOWN` | `buttonSpeedChange(false)` | `noop` |
| 17 | `DEV_CUSTOM` | development-only dynamic `customDevFunction()` | `noop` |

`SUBMIT` first calls `processInput(SUBMIT)` and only calls `processInput(ACTION)` if the first call is falsy. Direction buttons call `processInput` and request a five-unit vibration when the result succeeds. [`src/ui-inputs.ts:141-153`; `src/ui-inputs.ts:83-87`]

`STATS` normally toggles info/stat overlays, but forwards to the current UI handler on a whitelist; `CYCLE_TERA` can fall back to the arena/moveset info behavior. The cycle-button whitelist is also what lets the listed concrete handlers receive the cycle buttons instead of swallowing them. [`src/ui-inputs.ts:155-199`; `src/ui-inputs.ts:251-297`]

`UiHandler.processInput(button)` is abstract; this inventory records the public input dispatch up to that interface and does not infer the behavior of every concrete handler. [`src/ui/handlers/ui-handler.ts:20-28`; `src/ui-inputs.ts:166-297`]

## Button-down, button-up, locks, and repeat

The controller and touch repeat delay is exactly 250 ms. [`src/inputs-controller.ts:29`; `src/touch-controls.ts:5`]

Keyboard down emits one `input_down`, clears the existing interval for that logical button, starts a 250 ms interval, and then adds the logical `Button` to `buttonLock`. A later browser keydown is dropped while that logical button is locked; `event.repeat` is not inspected. [`src/inputs-controller.ts:362-399`]

Keyboard up emits `input_up`, splices the first matching logical button from `buttonLock`, and clears the logical button interval. A recorded text-field suppression is the exception: it deletes the recorded keycode and returns without emitting `input_up`. [`src/inputs-controller.ts:406-428`]

Gamepad down uses `button.index`, applies the selected profile/custom mapping, drops a down while the logical button is locked, and otherwise follows the same first-down plus 250 ms interval pattern. Its repeat callback clears itself when the logical button is no longer locked. [`src/inputs-controller.ts:440-481`]

Gamepad up requires a non-null pad, enabled gamepad support, and the selected gamepad ID; it then emits `input_up`, splices the logical lock, and clears that logical interval. [`src/inputs-controller.ts:492-510`]

There is an oracle bug/risk on unmatched keyboard and gamepad keyups: after a mapped `buttonUp` is found, both handlers compute `buttonLock.indexOf(buttonUp)` and unconditionally call `buttonLock.splice(index, 1)`. When the index is `-1`, JavaScript removes the last lock entry if the array is non-empty (otherwise it is a no-op), then the handler still clears the released button's interval. This can remove an unrelated logical lock; this document records the production behavior without changing production code. [`src/inputs-controller.ts:419-427`; `src/inputs-controller.ts:501-509`]

Locks are logical-button-wide for keyboard and gamepad, not keyed by physical keycode or by `(gamepad, index)`. Therefore simultaneous physical inputs that resolve to one logical button share one lock and one interval. [`src/inputs-controller.ts:83-104`; `src/inputs-controller.ts:376-397`; `src/inputs-controller.ts:461-479`]

Touch uses the `data-key` string as its lock key. A touch/pointer down simulates keyboard `input_down`, starts the same 250 ms timer, and a `touchend`/`pointerup` simulates keyboard `input_up`, removes active classes, splices the lock, and clears the timer. [`src/touch-controls.ts:63-139`]

`touchcancel` has no release path: its listener does not call `touchButtonUp`, emit `input_up`, remove an active class, splice `buttonLock`, or clear the repeat interval. Its only effect is conditional deletion of `dataset.skipPointerEvent` when the current target is an `HTMLElement` whose dataset contains `skipPointerDown`; `touchstart` sets `skipPointerEvent`, so that condition is mismatched and normally does nothing. [`src/touch-controls.ts:64-87`]

The controller constructor initializes an `interactions` object for every enum value except `MENU` and `STATS`, with `pressTime`, `isPressed`, and `source` fields. The live keyboard/gamepad handlers never read that object; they use `buttonLock` instead. Consequently, the observed runtime repeats mapped `MENU` and `STATS` despite the constructor comment saying they should not repeat. [`src/inputs-controller.ts:83-95`; `src/inputs-controller.ts:108-132`; `src/inputs-controller.ts:372-397`; `src/inputs-controller.ts:458-479`]

## Printable text-entry suppression

`isDomTextInputFocused()` returns true only when `document` exists, `document.activeElement` is non-null, and the active element is an `INPUT`, `TEXTAREA`, or content-editable element. [`src/inputs-controller.ts:isDomTextInputFocused (lines 31-50)`]

`isPrintableKeyEvent()` means only that `event.key` is a string of length one. While such a key is down with a focused DOM text field, the controller records that physical `event.keyCode` in `suppressedPrintableKeyCodes` and emits no game input. Non-printable key names continue through the mapping. [`src/inputs-controller.ts:isPrintableKeyEvent (lines 52-55)`; `src/inputs-controller.ts:362-374`]

The matching keyup mirrors the recorded keydown decision rather than rechecking current focus. This preserves down/up symmetry when a keydown was accepted and a text field gained focus before keyup, and when a keydown was suppressed and focus later changed. [`src/inputs-controller.ts:85-94`; `src/inputs-controller.ts:406-417`]

If a printable key was accepted before focus moved into a DOM text field, its repeat interval stays allocated but returns without emitting while the field is focused; that key's eventual keyup still clears the interval and lock. [`src/inputs-controller.ts:383-397`; `src/inputs-controller.ts:408-427`]

## Focus and blur

The Phaser game blur event calls `loseFocus()`, which clears controller intervals and locks/suppression state and then calls `TouchControl.deactivatePressedKey()`. [`src/inputs-controller.ts:144-149`; `src/inputs-controller.ts:195-198`; `src/inputs-controller.ts:557-565`]

Blur cleanup emits no synthetic `input_up`; it only clears timers/locks and, for touch, removes the DOM `active` classes. There is no explicit focus-gain listener in `InputsController.init()`, so the existing listeners remain attached after focus returns. [`src/inputs-controller.ts:144-187`; `src/inputs-controller.ts:557-565`; `src/touch-controls.ts:208-219`]

Touch-control configuration mode disables touch input while the controls are being moved and enables it again when the mode closes. The handler also uses a 500 ms `setTimeout` before installing its pointer listeners. [`src/ui/settings/move-touch-controls-handler.ts:352-389`; `src/ui/settings/move-touch-controls-handler.ts:360-364`]

## Touch physical inputs

`TouchControl.init()` binds every DOM node with `data-key`. The current `index.html` declares 21 elements: the four d-pad directions, action/cancel/submit/menu, stats, the cycle buttons, and the two summary flyout controls. Their exact element IDs, `data-key` values, and logical buttons are in `mappings.touch_data_key`. [`src/touch-controls.ts:37-64`; `index.html:93-190`; `schemas/kernel/source/input-map-v1.json:457-479`]

Touch emits `controller_type: "keyboard"` plus `isTouch: true`; `UiInputs.detectInputMethod()` therefore records the source as `touch`, while dispatching through the same logical-button action map as keyboard input. [`src/touch-controls.ts:150-170`; `src/ui-inputs.ts:42-53`]

## Ambient dependencies and configuration boundaries

The pipeline depends on the `globalScene` singleton, Phaser event/keycode/gamepad objects, DOM focus and touch nodes, `setInterval`/`clearInterval`, the 500 ms `setTimeout` in move-touch-controls-handler.ts, `navigator.vibrate`, and `import.meta.env.MODE` for the development-only button. The exact dependency inventory and source references are in `global_dependencies`. [`src/global-scene.ts:1-6`; `src/inputs-controller.ts:144-187`; `src/ui-inputs.ts:83-87`; `src/constants/app-constants.ts:1-6`; `src/ui/settings/move-touch-controls-handler.ts:360-364`; `schemas/kernel/source/input-map-v1.json:608-663`]

## Declared defaults versus runtime custom mappings

Keyboard and gamepad configurations clone their defaults into `custom` when no saved custom configuration exists, and mapping edits/injected configs can replace those defaults. Runtime `custom` is a per-physical-key table whose values are a setting alias or `-1`; it is not folded into the declared-default `mappings` tables. The full alias tables and blacklist constraints are represented in `runtime_custom_mapping`: keyboard `ALT_BUTTON_*` names resolve to the corresponding canonical `BUTTON_*` setting, gamepad settings have no `ALT_*` family, keyboard configuration keys protect Enter/Escape/Space/Backspace/directions/Delete/Home, and Generic gamepad protects its four d-pad keys. [`src/inputs-controller.ts:300-328`; `src/inputs-controller.ts:623-640`; `src/configs/inputs/config-handler.ts:195-203,255-287`; `src/configs/inputs/cfg-keyboard-qwerty.ts:187-222,303-314`; `src/configs/inputs/pad-generic.ts:47-83`; `src/system/settings/settings-keyboard.ts:8-44,128-137`; `src/system/settings/settings-gamepad.ts:9-28,80-85`; `schemas/kernel/source/input-map-v1.json:487-546`]

## Dead declarations and missing evidence

The dead `interactions` declaration and the development-only `KEY_Q`/`DEV_CUSTOM` branch are recorded explicitly in `dead_declarations`; the Pro Controller Home button is physically declared but unbound by default, and the SNES optional trigger/stick names are present in its default object without physical entries in `deviceMapping`. [`src/inputs-controller.ts:95,122-132`; `src/configs/inputs/cfg-keyboard-qwerty.ts:222,253`; `src/configs/inputs/pad-procon.ts:11-28,66-83`; `src/configs/inputs/pad-unlicensed-snes.ts:11-24,57-73`]

The remaining limits are explicit in `missing_evidence`: browser-specific generation of the deprecated `KeyboardEvent.keyCode`, user-persisted custom mappings, and concrete per-screen `processInput` behavior require evidence beyond this static physical-input/default-mapping extraction. [`src/inputs-controller.ts:367-374,419`; `src/inputs-controller.ts:307-310,322-326`; `src/ui/handlers/ui-handler.ts:20-28`]
