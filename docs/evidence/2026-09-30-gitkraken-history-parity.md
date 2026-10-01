# GitKraken history comparison — 2026-09-30

Compared GitKraken Desktop 12.5.0 with a locally built Refyard Parity app from the current working tree. The verification app used a temporary Tauri configuration override (`dev.refyard.parity`, `Refyard Parity`) and the repository desktop frontend build; the installed `/Applications/Refyard.app` was not used as evidence of current-source behavior. No Git mutations were performed against the user's xross-dev repository.

## Changes and observed behavior

- Both trusted Git planners now use `--date-order`, preserving descendant-before-parent traversal while interleaving recent commits from parallel branches.
- The history tip budget is 5,001: all 5,000 parser-accepted refs plus detached HEAD. A normal accepted ref listing therefore no longer loses branches after the first 16 alphabetic tips. Snapshot-pinned continuation and commit paging are retained.
- Density choices are Compact and Comfortable. Compact remains the 28px default. Removed Roomy preferences fall back to Compact.
- In the current-source native app, xross-dev history begins with dev, Terminus, M2 auth, M2 provider, then the next dev commits, matching the comparison app's observed sequence. Branch labels and multiple lanes are visible.
- Native Settings visibly selects Compact and contains no Roomy option.

## Verification

| Check | Result |
| --- | --- |
| New real-Git history tests before implementation | FAIL as intended: missing branch commits and lane-first ordering |
| Native >16-tip regression before implementation | FAIL as intended: 16 returned instead of 41 |
| Density and stored Roomy regressions before implementation | FAIL as intended |
| Focused history/planner/geometry/storage tests after implementation | PASS |
| `cargo test --workspace` | PASS, exit 0 |
| `pnpm check` with registry access permitted | PASS, exit 0 |
| `bun scripts/check-boundaries.ts` | PASS, exit 0 |
| `bun scripts/check-contract.ts` | PASS, exit 0 |
| Desktop frontend Vite build | PASS, exit 0 |
| Native debug build and independent app bundle | PASS, exit 0 |
| Complete Vitest suite with loopback listeners permitted | PARTIAL, exit 1: 1,170 pass, 1 fail |
| `cargo fmt --all --check` | BLOCKED, exit 1: existing user edits in planner mod.rs and untracked repository.rs |
| Native app visual checks | PASS for multi-branch history and density choices |
| Windows/Linux, browser engine matrix, updater | NOT RUN |

The full Vitest failure is `tests/pack/release-identity.test.ts`, case `declares AGPLv3 and the next publishable version`: it expects 0.1.2 but the unchanged committed npm manifest declares 0.2.0. Both conflicting values were confirmed in HEAD. The assertion was left unchanged. The first sandboxed full-suite attempt could not bind loopback listeners; the permitted rerun is the relevant result above.

## Remaining menu and graph parity

Current-source commit menu was inspected read-only on the same historical commit: create branch, create tag (annotation is available in the dialog), create worktree, revert, cherry-pick, drop, reset, copy SHA/message/GitHub link.

GitKraken also exposes detached checkout, rebase onto a commit, interactive rebase, edit message, move up/down, patch export, compare against working directory, and proprietary AI/Cloud Patch actions. These are an inventory of observed differences, not completed features. Existing Refyard reset/revert/drop confirmation and capability gating must be retained when aligning menu grouping and adding supported semantic operations. Graph avatar nodes, stable distinct branch colours and additional-worktree WIP rows also need focused visual comparison; no claim of complete graph parity is made.

No release, PR merge, branch deletion, or push was performed. Existing uncommitted repository planner, ignore file, logo and skills-lock work was preserved. Implementation remains uncommitted because the repository instructions require stopping on a failing verification gate.

## Settings translation repair

Language choice labels were empty strings; density choice names were derived from English identifiers. Language choices now call the existing catalog functions, and both density selectors use translated name keys (Compact/Comfortable; 紧凑/舒适). English and Chinese retain their native language names.

The new browser regression failed first on the empty Auto label. After rebuilding the web UI and refreshing the CLI's copied assets, the regression and existing Chinese-interface test pass on Chromium and WebKit (four cases). The combined three-engine run exits 1 because Firefox cannot launch: its process reports `Could not find profile folder`, including with a temporary directory under `/private/tmp`. Firefox settings behavior is BLOCKED, not a passing result.

Svelte diagnostics report zero errors and two existing warnings. The updated desktop frontend build and native debug build both exit 0. The already running development process needs a reload/restart to load rebuilt assets; the installed application was not replaced.

## Rebase conflict UI review and repair

The shared repository sidebar dispatched cherry-pick completion separately but dispatched every other sequencer state to merge completion. Thus the panel displayed Continue/Abort rebase while submitting continueMerge/abortMerge. The existing backend correctly rejected both mismatched operations, leaving the user stranded in the rebase.

RepositorySidebar now dispatches the rebase state to the existing onRebaseContinue/onRebaseAbort handlers. Both Node and Rust hosts already register those effects; no public contract, argv generation, transport, or backend capability was added. ConflictPanel's outdated comment claiming rebase was unsupported was corrected.

Two new isolated real-Git browser regressions failed first with the backend message that a rebase was in progress. After the repair, Chromium and WebKit pass all eight workflow cases (merge continue/abort and rebase continue/abort, exit 0). Tests assert unresolved paths disable continuation, staged resolution yields a replayed commit on the chosen upstream with its subject preserved, abort requires confirmation and restores original HEAD/content/current branch, and the UI clears the operation controls. Firefox remains unverified for these workflows due to the launch failure recorded above. Svelte diagnostics exit 0 with two existing warnings. Web and desktop frontend builds exit 0.

A fresh read-only inspection of GitKraken 12.5.0's xross-dev commit context menu confirms Checkout this commit, Rebase dev onto this commit, Create patch from commit and Compare commit against working directory. Refyard's rebase entry is currently attached to local branch badges only. The proposed next bounded change is a capability-gated commit rebase entry using the existing rebase semantic operation, with current branch/target commit/history-rewrite confirmation. Design approval is pending; the new menu entry is not implemented or claimed as complete.

## Conflict recovery localization and focused architecture review

ConflictPanel contained hard-coded English for operation status, conflict counts and stages, recovery guidance, Continue/Abort buttons, and abort confirmation. It now uses the same generated catalogs as the rest of the UI, with names for every contract-defined in-progress state. English operation labels retain their existing wording. The unsupported-state note now describes lack of completion support rather than asserting that the operation originated outside Refyard: status exposes the operation state, not its initiating tool. Backend outcome diagnostics are preserved verbatim.

The new Chinese rebase browser case first failed as intended, showing English text after a locale switch. Chromium and WebKit then pass all 14 conflict workflow cases, exit 0: the original merge/rebase continuation and abort cases plus Chinese merge, cherry-pick and rebase abort flows. The translated cases start conflicts in isolated fixture Git repositories, so they also verify that a supported externally initiated operation can be recovered using its correct backend effect. They assert translated state/count/stages/guidance, disabled continuation while unresolved, translated abort confirmation, disappearance of recovery controls, and restoration of original HEAD and content. Firefox remains NOT RUN for this change because of the earlier browser launch failure.

The web frontend, desktop frontend and native debug build exit 0. Svelte diagnostics exit 0 (zero errors, two existing warnings); boundary and contract checks exit 0; `git diff --check` exits 0. These focused results do not supersede the existing complete-suite release identity failure above.

Focused architecture findings:

- Native registration sets `canonical_common_dir` from the resolved layout in `crates/refyard-host/src/registry.rs`; `repository_write_key` in `service.rs` then keys writes by execution target and this common directory. The fallback comment in `service.rs` is outdated, but the registration path does populate the common directory. This review did not find separate per-worktree keys in that production path.
- (Resolved by the capability repair below.) ConflictPanel hardcoded supported recovery states, and RepositorySidebar gates the entire panel on the presence of `merge`. With a backend advertising only rebase recovery, that gate would hide the panel; with merge but no rebase recovery, the hardcoded list would offer unavailable actions. Per-operation recovery capability gating is a follow-up, not part of this localization repair.
- `standing_plan` in `crates/refyard-host/src/writes/sequencer.rs` constructs fixed rev-parse argv in the host instead of a core planner. No browser-provided argv is accepted there, but moving this probe into refyard-core would restore the repository's planner-only boundary. This is a concrete native architecture follow-up; no whole-repository boundary compliance claim is made.

The proposed commit rebase menu entry still awaits design approval. The overall GitKraken parity goal remains incomplete.

## Per-operation conflict recovery capabilities

The capability defect was reproduced with a real stopped rebase and an intercepted, schema-validated capability response advertising continueRebase/abortRebase but no merge: the recovery panel was absent. RepositorySidebar now displays the stopped operation independently of starting-merge support. A pure mutation model derives continue and abort availability independently for merge, cherry-pick and rebase; absent or unrelated capabilities fail closed. Only supported callbacks reach ConflictPanel.

ConflictPanel accepts absent callbacks, preserves the operation and conflict files even on a read-only host, hides each unsupported action, and explains a missing continue/abort capability in both languages. The no-conflicts summary no longer tells an abort-only host's user to continue. No new mutation DTO, backend effect, or Git argv was introduced.

Verification:

- Initial recovery-only browser regression: FAIL as intended, panel absent.
- Mutation model unit cases: 7 PASS, exit 0, including recovery-only capability sets, separate sibling actions, missing capabilities and unrelated sequencer states.
- Chromium and WebKit: 22 PASS, exit 0, covering four partial capability scenarios plus the full English and Chinese conflict workflows. The capability scenarios use controlled responses with service workers blocked, while recovery still runs against the real Node host and isolated Git repository. They verify exact visible controls and actual abort/continue results; they do not claim a separately shipped partial backend was exercised.
- Web frontend, desktop frontend and native debug builds: PASS, exit 0.
- Svelte diagnostics: PASS, exit 0, zero errors and two existing warnings.
- Boundary check, contract check and diff whitespace check: PASS, exit 0.
- Firefox recovery behavior: NOT RUN, previous launch failure remains.

(Reproduced and repaired below.) Review follow-up: the mutation controller scoped staging/commit result messages to repository and worktree, but merge/branch/remote result getters return unscoped strings. The controller is created once at the page composition root. Test switching repositories after a completed mutation before deciding whether those outcomes can appear under the wrong repository. This is a source-level finding awaiting a browser reproduction, not a claimed repair.

## Mutation feedback stays with its target

The cross-repository feedback defect was reproduced in Chromium: after creating a branch in repository A and opening repository B, A's success message still appeared under B. The mutation controller was created once for the page and stored branch/remote/worktree/submodule/merge/stash/tag results as unscoped strings.

Those result families now store the context captured when the write began, together with its repository/worktree target scope. Their getters show the result only for the matching selected target. Repository-wide results remain visible across linked worktrees in the same repository; a branch switch, merge recovery, stash application or other worktree action remains local to its worktree. Synchronous local refusals are scoped as well. Existing staging/commit scoping and the guard against applying a late response after a target switch are retained. No Git operation semantics or public DTO changed.

Verification:

- New branch feedback browser regression: FAIL as intended before implementation (the old message remained under repository B).
- Chromium and WebKit: 16 PASS, exit 0. Four new scenarios on each engine cover branch/tag/merge results across repository tabs, restoration of feedback when returning, repository-wide feedback across linked worktrees, and isolation of branch-switch outcomes. Existing context-menu ref creation, worktree creation, branch actions and remote removal also pass.
- Mutation model and route ownership unit checks: 8 PASS, exit 0. These retain orchestration checks; browser regressions are the direct evidence for message scoping.
- Svelte diagnostics: PASS, exit 0, zero errors and two existing warnings.
- Boundary, contract and diff whitespace checks: PASS, exit 0.
- Web frontend, desktop frontend and native debug builds: PASS, exit 0.
- Firefox: NOT RUN for this repair, earlier browser launch failure remains.

The source fix covers all seven formerly unscoped result families. Browser scenarios directly exercise branch/tag/merge messages and remote/worktree regressions; no claim is made that every stash/submodule feedback path was independently exercised on every host. The complete-suite release identity gate remains unresolved, so these changes remain uncommitted and no release was made.

## Recovery confirmations do not transfer to another operation or target

ConfirmAction keeps an armed state while its callback prop can change. Two browser regressions reproduced stale abort confirmations: (1) an externally aborted rebase followed by a conflicted merge retained the old confirm button; (2) switching from repository A's stopped rebase to repository B's stopped rebase retained it as well. Both regressions failed first in Chromium with the old confirmation still present.

ConflictPanel now keys its abort confirmation by the reported sequencer state. RepositorySidebar keys the recovery panel by repository/worktree identity. Changing those identities discards the armed confirmation and requires a fresh first click before an abort can be confirmed. Background reads with the same identities preserve ordinary confirmation behavior. This is UI state ownership; mutation DTOs, snapshot preconditions and backend abort effects are unchanged.

Chromium and WebKit pass 22 selected recovery/context cases, exit 0, including both new regressions, actual merge abort after re-arming, existing merge/rebase abort paths, Chinese confirmation text, cross-repository feedback and linked-worktree feedback. Svelte diagnostics exit 0 (zero errors, two existing warnings). Boundary, contract and whitespace checks exit 0. Web frontend, desktop frontend and native debug builds exit 0. Firefox remains NOT RUN for this change.

The new identity tests directly cover operation-type changes and repository changes. Worktree identity is included in the source key but a separate same-operation cross-worktree arming case was not run. Replacing one operation with another of the same kind on the same target without an observed idle state is not proven by these tests; this repair is not a claim of full operation-instance fingerprint binding. Overall GitKraken parity and the release gate remain incomplete.

## Native recovery probes respect planner ownership

The native sequencer host assembled `rev-parse --verify --quiet` arguments itself. Recovery now receives core plans: the existing merge and cherry-pick probes, and a separate quiet rebase recovery probe. The existing diagnostic rebase probe remains unchanged so its stderr contract is preserved. Recovery command arguments and absent-marker exit-code behavior are unchanged.

The ownership regression failed first with “recovery read argv belongs in core” (exit 101). After implementation, core tests pass 212 cases; native branch-write tests pass 31 cases and merge tests pass 9 cases, all exit 0 against isolated Git fixtures. The current-source native desktop debug build and diff whitespace check also exit 0. This verifies the sequencer module boundary, not a complete audit of every native host module. No additional native UI end-to-end check was run for this internal refactor.

## Graph context menus follow the selected language

The new Chromium regression reproduced English graph actions after selecting Chinese: the create-branch menu item still read “Create Branch Here…”. CommitList now resolves all its action labels through the shared translation catalogue, including branch/tag/worktree creation, replay/reset actions, branch checkout/delete, directional merge/rebase, remote checkout and grouped-ref copy actions. English labels retain their existing wording. Branch/ref names remain interpolation inputs, not translated text. This changes labels only; no Git intent or confirmation requirement changed.

Verification: the new regression failed as intended before implementation (exit 1). The full context-menu suite on Chromium and WebKit then completed with 23 PASS, 1 existing SKIP, exit 0. The skip is WebKit clipboard-content inspection, whose existing test requires Chromium clipboard permissions; it was not added or changed in this repair. Chinese commit actions, local branch merge/rebase direction and tag deletion labels, then switching back to English, are directly covered. Remote checkout, squash and grouped copy labels were localized in source but not separately exercised in Chinese. Existing English Git behavior cases passed against isolated fixtures. Firefox was NOT RUN due to the previously recorded launch failure.

Svelte diagnostics exit 0 with zero errors and two existing warnings. Boundary, contract and diff whitespace checks exit 0. Web frontend, desktop frontend, CLI bundle and native debug builds exit 0. No additional native UI end-to-end run was performed for this translation change. Follow-up audit: several confirmation-dialog titles/descriptions in CommitList still contain English literals, so this is not complete localization or complete GitKraken parity. The existing release-identity gate remains unresolved; no commit, push or release was made.

## Graph action dialogs follow the selected language

A browser regression reproduced Chinese graph menus opening an English create-ref dialog. Graph confirmation titles, descriptions, action labels and input hints now use the shared catalogue for branch/tag creation and deletion, revert, cherry-pick, drop, reset, squash and worktree creation. The translations retain commit/ref names and explain the existing index, working-tree, remote-copy and history-rewrite effects; no Git behavior or confirmation requirement changed.

The regression then exposed a shared ConfirmDialog default that still said “Cancel” in Chinese. Its absent-label fallback now uses common_cancel, while an explicit caller label remains authoritative. A subsequent run caught the drop description still displaying English; that missed catalogue connection was corrected without removing the history-rewrite assertion.

Evidence: the initial regression failed with an English create-ref title. The next run failed in both browsers waiting for Chinese cancellation, and the following run failed with the English drop description. After both repairs, the targeted dialog checks pass on Chromium and WebKit (2 PASS, exit 0). The final complete context-menu suite passes 25 cases with 1 existing WebKit clipboard-inspection skip, exit 0. It directly opens and cancels eight commit action dialogs plus branch/tag deletion dialogs, checks Chinese impact text and reset mode descriptions, and verifies reset descriptions after switching back to English. Existing English mutation cases still run against isolated Git fixtures. Chinese mutation submission itself and Firefox were NOT RUN for this repair.

Final web and desktop frontend builds, CLI bundle and native desktop debug build exit 0. Svelte diagnostics exit 0 with zero errors and two existing warnings. Boundary and contract checks exit 0; whitespace verification passes. Native-window end-to-end behavior was not re-exercised. Whole-product localization and GitKraken parity remain incomplete; the known release-identity gate remains unresolved, and nothing was committed, pushed or released.

Follow-up evidence from this dialog test: the root commit still offers a drop action and opens its confirmation even though the described backend policy refuses dropping the first commit. Review commit-shape eligibility in graph menus; do not remove backend refusals to make the UI action work.

## Commit-shape restrictions are explained before confirmation

The next browser regression confirmed that the root commit's Drop action was enabled. Core/host workflows already refuse root drops and merge-commit revert/cherry-pick/drop; the menu did not reflect those known restrictions. CommitList now uses a pure metadata model to disable those actions and shows a translated reason below the label. Root revert/cherry-pick, ordinary single-parent replay, copying, reference creation and reset remain available when their existing capabilities allow them. A missing parent or a parentless boundary disables dropping without calling that boundary the first commit. A known boundary with an available parent remains eligible. Backend ancestry checks, snapshot preconditions, hooks and confirmations are unchanged and remain authoritative.

ContextAction supports a disabledReason, rendered by both shared menu components. The floating layer shows the reason inline, so it does not depend on hovering a disabled control; it constrains its width for wrapping. No raw Git arguments or new mutation DTO was introduced.

Evidence: the new Chromium regression first failed because root Drop was enabled. The pure model's first test run failed because its new module did not yet exist. After implementation, 7 unit cases pass across the model and context-action suites, exit 0. The initial full browser run also exposed an old translation case expecting a root Drop button to contain only its label; its input was changed to an eligible single-parent commit while preserving the exact translation assertions. The separate new case retains root and merge disabled-state/reason assertions. The dialog translation case similarly uses a valid non-root drop target. No backend refusal or assertion was removed.

Final complete Chromium/WebKit context-menu suite: 27 PASS, 1 existing WebKit clipboard-inspection SKIP, exit 0. It checks root and merge reasons in both languages, a disabled root click opening no confirmation, regular single-parent replay actions staying enabled, unrelated merge-row actions remaining available, and unchanged fixture HEAD. Existing real Git mutation cases pass in isolated repositories. Missing-parent/boundary variants are unit-covered, not browser-tested against an actual shallow clone in this repair. Firefox and native-window end-to-end interaction were NOT RUN.

Svelte diagnostics exit 0 with zero errors and two existing warnings. Boundary, contract and whitespace checks exit 0. Web/desktop frontend builds, CLI bundle and native desktop debug build exit 0. This repairs menu honesty for the currently supported operations; mainline-parent selection for merge replay, whole GitKraken parity and the release gate remain incomplete. No commit, push or release was made.

Follow-up source audit: ContextMenuLayer captures all document scrolls and closes after its opening grace window, including scrolls originating inside its own overflow container. Reproduce whether a short viewport's scrollable menu dismisses itself before lower actions can be reached. This is a source-level hypothesis, not a claimed runtime repair.

## Scrollable context menus remain usable in short windows

The short-viewport browser regression reproduced the suspected dismissal defect: the menu overflowed at 1440×420, but a wheel scroll made it disappear before lower actions were reachable. The failed screenshot confirms the menu was absent; the polling assertion reported the last scrollTop value of zero. ContextMenuLayer now ignores captured scrolls originating within its own element, returns immediately while closed, and retains the existing opening-gesture grace period for outside scrolls. Overscroll containment prevents scrolling at a menu edge from chaining into the background and triggering outside-scroll dismissal. Escape and outside-pointer dismissal code are unchanged.

The new test uses an isolated 20-commit history, waits beyond the deliberate 150 ms opening grace, scrolls the menu with actual wheel input, verifies its bottom action lies within the visible menu, wheels again at the boundary, opens a lower reset confirmation, cancels, then scrolls the underlying history and verifies dismissal. No reset is submitted. The regression first failed before the fix (exit 1), then passed on Chromium and WebKit (2 PASS, exit 0). Final complete context-menu suite: 29 PASS, 1 existing WebKit clipboard-inspection SKIP, exit 0.

Web/desktop frontend builds, CLI bundle and current-source native desktop debug build exit 0. Svelte diagnostics exit 0 with zero errors and two existing warnings. Boundary, contract and whitespace checks exit 0. Browser tools used local Node 26.10.0; repository-pinned 26.8.2 was not independently exercised for this repair. Firefox, touch input and native-window end-to-end scrolling were NOT RUN. This proves the tested wheel and background-scroll behavior, not every input method or full GitKraken parity. No commit, push or release was made.

Next source-level review target: the custom floating layer handles Escape but does not implement arrow-key menu navigation, while the other shared context-menu component delegates navigation to its menu primitive. Reproduce keyboard behavior before choosing a repair.

## Floating context menus support directional keyboard selection

The browser regression reproduced the keyboard gap: ArrowDown left focus on the floating menu container instead of selecting its first action. ContextMenuLayer now handles ArrowDown/ArrowUp with wrapping and Home/End for first/last enabled items. It excludes disabled buttons and separators, prevents these keys from scrolling the background, focuses the chosen button, and scrolls that item into view inside the menu. Enabled focused items receive the same highlight used for pointer hover. Native button activation still drives Enter; no extra mutation dispatch path was introduced. The document key listener acts only while this menu is open and holds focus, so inactive menu instances no longer consume Escape.

The regression failed before implementation (exit 1). Final complete Chromium/WebKit context-menu suite: 31 PASS, 1 existing WebKit clipboard-inspection SKIP, exit 0. The new case verifies first selection, End/Home, wrapping in both directions, skipping the root's disabled drop, Enter opening the cherry-pick confirmation without submitting it, cancellation, and Escape dismissal. Existing scroll and actual Git operation cases pass in isolated fixtures.

Web/desktop frontend builds, CLI bundle and native debug build exit 0. Svelte diagnostics exit 0 with zero errors and two existing warnings; boundary, contract and whitespace checks exit 0. Node 26.10.0 was used for browser tooling. Firefox and native-window keyboard interaction were NOT RUN. This covers directional selection and button activation, not full keyboard accessibility: trigger focus restoration, Tab dismissal and typeahead remain review targets. Whole GitKraken parity and the existing release-identity gate remain incomplete. No commit, push or release was made.

## Menu dismissal restores focus without redirecting later input

Escape initially closed the menu but did not restore its opening control. The new regression failed on the submission row's focus assertion before implementation. Menu state now carries an optional local trigger node; CommitList supplies the row button, ref badge or column-settings gear. Escape and action selection restore a connected trigger, while outside pointer/scroll dismissal does not steal focus. Items are excluded from the surrounding Tab order and directional navigation still focuses them programmatically. Tab/Shift+Tab chooses the adjacent visible enabled control in declared tab order, with native browser fallback at the document boundary. A first native-Tab attempt passed Chromium but failed WebKit's strict next-row assertion; the explicit selection repaired that difference without changing the assertion.

An expanded menu run then exposed an input-focus race. Its captured operation payload contained tagName `historical-tagcreated from the commit menu` and annotation null; the backend rejected the invalid name. The installed bits-ui 2.19.2 source, `dist/bits/utilities/focus-scope/focus-scope.svelte.js` in handleOpenAutoFocus, schedules first-field focus in requestAnimationFrame. A controlled test delaying frame callbacks by 250 ms reproduced annotation focus being stolen after editing started. Shared Dialog.Content now uses the public onOpenAutoFocus hook to focus synchronously, preserving existing focus inside the dialog, explicit autofocus preference and a caller's cancellation/custom callback. Its close-focus behavior remains delegated to the primitive. A shared tab-stop helper serves both menu exit and initial dialog focus. No library source was copied or modified.

A later WebKit run exposed a separate menu-state defect: creating a branch reported success while repository reads were still refreshing; a menu opened in that interval captured disabled=true and stayed disabled after the refresh. A new isolated test holds real status responses after a real branch write and first failed because Create Tag never re-enabled. ContextAction now accepts a live disabledWhile predicate alongside fixed disabled restrictions. Both menu components render and re-check this predicate at activation; graph commit/ref actions use it for transient busy state. Root/merge restrictions remain fixed, and copy actions are unaffected. The controlled busy test passes on both engines, including root Drop remaining disabled after refresh release. Service workers are blocked only for that intercepted-response test file.

Final complete context-menu, busy-state and conflict workflow suites on Chromium/WebKit: 53 PASS, 1 existing WebKit clipboard-inspection SKIP, exit 0. Direct coverage includes Escape return to row/ref/gear, forward/reverse Tab, outside-click focus, cancel-dialog return, delayed-frame annotation stability, real branch/tag creation, live busy release and actual merge/rebase recovery. The targeted focus/ref-creation run also passed 8 cases, and the dedicated busy test passed 2 cases. No assertion or backend validation was weakened; all Git writes used isolated temporary repositories.

Related unit suites: 7 PASS, exit 0. Boundary, contract and whitespace checks exit 0. Svelte diagnostics exit 0 with zero errors and two existing warnings. Web/desktop frontend builds, CLI bundle and native debug build exit 0 using local Node 26.10.0 for browser tooling. One final-run approval request was dismissed because its permission session ended; the renewed request ran the final passing suite. Firefox, native-window focus interaction, document-boundary Tab and custom autofocus callbacks were not independently exercised. Typeahead, keyboard menu positioning and whole GitKraken parity remain review targets. The release-identity gate remains unresolved; nothing was committed, pushed or released.


## Graph tracks and author-node presentation

The user requested photos inside commit nodes, author names alone in the Author
column, and parallel tracks around Xross merge
`e8e312c3ae194a418596e40a3ed5c192b6a31fd1`.

Read-only Git inspection found first parent `41e7815ea206bed20d7a5751ec7a692c7840c7fa`
and second parent `8f81b42caa45947c176523eec75d269f33200f2a`. A 271-commit
`--all --date-order` topology snapshot is checked into
`tests/fixtures/graph/xross-e8e312.json`, with every other OID anonymized and no
messages, author data, or file contents. No Git writes were performed in Xross.

Failing tests reproduced insertion moving unrelated tracks, a root clearing other
live tracks, and an already active second parent opening a duplicate track. The
layout now carries stable positions across pages, reuses free positions only for
new tracks, preserves unrelated tracks at roots, and connects additional parents
already on screen. Geometry first matches pending OID plus position, preventing
an additional demonstrated crossing when two tracks await the same ancestor.
The three earlier adjacency assertions explicitly required pushing existing
tracks sideways. They were replaced with equally exact assertions for the user's
new parallel-track requirement, rather than relaxed or skipped.

The Author column now displays names alone. Non-merge graph nodes display a
photo with a lane-colored ring, or local initials when absent/unavailable; merge
nodes remain dots. Existing photo opt-out stops graph photo requests and persists.
GitHub noreply identity mapping remains, while ordinary emails use normalized
SHA256 Gravatar URLs with `d=404`. Only the specific Gravatar image origin was
added to the Node/static/worker/Tauri CSP; API connection restrictions remain.
The description is translated into English and Chinese. SHA256 identifiers are
calculated locally without SubtleCrypto, checked against system SHA256 across
Unicode and block-boundary inputs. This avoids requiring a secure browser
context for a public image identifier; it is not an authentication primitive.

Source evidence: GitKraken's official FAQ states that commit avatars are linked
through .gitconfig email via Gravatar:
https://help.gitkraken.com/gitkraken-desktop/faq/ . Its profile documentation also
describes connected-provider avatars:
https://help.gitkraken.com/gitkraken-desktop/profiles/ . Gravatar specifies
normalized SHA256 identifiers and its 404 fallback:
https://docs.gravatar.com/rest/hash/ and https://docs.gravatar.com/sdk/images/ .
These documents do not prove which lookup GitKraken used for the user's photo.

Measured checks (all exit 0):
- Graph and avatar unit tests: 77 passed, including real topology/pagination,
  stable SVG geometry, hashing without WebCrypto, and system hash comparisons.
- Static worker, head segment and package-boundary unit tests: 40 passed.
- Chromium/WebKit avatar + workbench layout regression: 26 passed.
- Chromium/WebKit graph-column compression regression: 2 passed.
- After removing WebCrypto dependency, avatar regression repeated with
  SubtleCrypto explicitly unavailable: 6 passed.
- Svelte check: 0 errors, 2 pre-existing warnings in CommitList.
- Boundary and contract checks; whitespace diff check: passed.
- Normal web/CLI assets, desktop web assets, native debug build: passed.

Logs: `/private/tmp/refyard-graph-final-e2e.log`,
`/private/tmp/refyard-graph-compress-final.log`,
`/private/tmp/refyard-avatar-native-final-e2e.log`,
`/private/tmp/refyard-avatar-native-svelte.log`,
`/private/tmp/refyard-avatar-native-cargo.log`.

Native visual inspection used only the current-source debug bundle
`apps/desktop/src-tauri/target/debug/bundle/macos/Refyard Parity.app`
(identifier `dev.refyard.parity`), not the installed Refyard. It was closed,
updated with the freshly built executable, ad-hoc signed, reopened, and used to
read Xross history. The actual e8e312 merge was selected and its full SHA and
parents verified in the native detail panel. The graph showed straight parallel
surviving tracks and a single side-parent connection instead of the earlier
moving/crossing tracks. Native authors still showed initials: actual retrieval
of the user's photo was not established. Tests use local image responses, so
passing tests prove placement, URLs, CSP and fallback, not live Gravatar account
matching. Ordinary-email-to-GitHub-account resolution through a connected
provider is not implemented in this round. Firefox and other OS WebViews were
not exercised. No commit, push, publication or release was performed.
