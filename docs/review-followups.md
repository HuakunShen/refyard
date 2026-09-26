# Deferred review follow-ups

The 2026-09-26 combined Xross/Refyard review found these P2 issues. They are
recorded for one focused UI repair pass, not silently promoted to completion.

| Priority | Surface | Finding | Repair and proof |
|---|---|---|---|
| P2 | Embedded UI | Preset background SVGs use root-relative `/backgrounds/` URLs, which do not resolve under an embedded path prefix. | Resolve assets against the build base; run the embedded build and load both presets in a real frame. |
| P2 | Stacked layout | The resize handle stays at the persisted navigation height when the navigation band collapses to 56px. | Derive the handle position from the effective collapsed height; test the collapse-then-resize sequence. |
| P2 | Language settings | Changing language increments `localeEpoch` around the entire page, remounting the open Settings dialog and losing keyboard focus. | Update locale in place or scope remount narrowly; keyboard-test the language selector and focus retention. |

The same review found two P1 issues. The unauthenticated DeepSeek Harness
repository-approval/pairing route was excluded from the Xross vendor integration
branch; its source remains in its original feature branch until a verified
Harness session-authentication contract exists. Single-repository selection was
changed to fail closed when the requested repository is missing, with a focused
regression test.
