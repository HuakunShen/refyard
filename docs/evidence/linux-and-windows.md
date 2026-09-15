# Two machines that are not this one — Linux and Windows

The macOS numbers in `release-matrix.md` come from the machine the work was written on, which is
the weakest part of any such report: a suite that passes where it was written says little about
anywhere else. This file records the same gates run on two other machines, on 2026-09-15, at the
request of the project's owner: an Ubuntu desktop and a Windows desktop, both reachable over SSH.

Nothing here replaces the macOS or container evidence; it is a second and third opinion, and it
found five defects the first run could not (below).

## The machines

| Thing            | Ubuntu (`ufo`)                           | Windows (`rog16-windows`)                                   |
| ---------------- | ---------------------------------------- | ----------------------------------------------------------- |
| Operating system | Ubuntu 24.04, x86_64, kernel 7.0.0-30    | Windows 10.0.26200, x64                                     |
| Node             | 26.8.2 (installed with nvm for this run) | 26.5.0 (already installed; the `engines` range of the day was `>=26 <27`) |
| Git              | 2.43.0                                   | 2.55.0.windows.3                                            |
| pnpm             | 11.25.0 (already installed)              | 11.25.0 (installed through npm for this run — see the note) |
| bun              | 1.4.0 (dev scripts only)                 | 1.3.14 (dev scripts only)                                   |
| Filesystem       | ext4 (`/` and `/tmp`)                    | NTFS (default `C:`)                                         |
| Shell            | bash over SSH                            | `cmd.exe` / PowerShell over SSH                             |
| Revision         | `ab1d5fb`                                | `ab1d5fb`                                                   |

The tree on each machine was produced by rsync (Ubuntu) and by tar over SSH (Windows), and then
verified the only way that survives two platforms: the SHA-256 of **every tracked file**, computed
on both sides and compared. All 374 files matched byte for byte on both machines. `git status` was
deliberately _not_ used as that check — on Windows it reports three files as modified because the
machine's `core.autocrlf=true` rewrites the comparison, and it cannot even open
`packages/git-core/src/bytes/nul.ts` (see finding 2).

A note on the Windows machine itself, because it affected how the gates were run: its own pnpm
installation is broken — `%LOCALAPPDATA%\pnpm\bin\pnpm.cmd` points at a global directory that no
longer exists, so any `pnpm` resolved from `PATH` fails with "the path cannot be traversed because
it contains an untrusted mount point", and so does every `turbo run` that resolves pnpm itself. The
gates were run with a pnpm installed through npm placed first on `PATH` for the session. That is a
fact about the machine, not about this repository, and it is recorded here because a reader
reproducing this will otherwise hit it.

## Gates

Each gate is a root script from AGENTS.md §5, run with the machine's own pnpm after
`pnpm install --frozen-lockfile`. The number is the exit status.

| Gate                    | Ubuntu | Windows | Notes                                                                               |
| ----------------------- | ------ | ------- | ----------------------------------------------------------------------------------- |
| `pnpm check`            | 0      | 0       | TypeScript across 8 workspace tasks                                                 |
| `pnpm check:boundaries` | 0      | 0       | 3 portable packages free of host APIs                                               |
| `pnpm check:contract`   | 0      | 0       | JSON Schema artifacts match the Zod schemas                                         |
| `pnpm test:unit`        | 0      | 0       | 236 cases, 16 files                                                                 |
| `pnpm test:integration` | 0      | 0       | 352 cases, 23 files — real Git in temporary repositories                            |
| `pnpm test:pack`        | 0      | 0       | tarball contents and manifest rules                                                 |
| `pnpm test:portable`    | 0      | 0       | neutral IIFE build of the core, no host globals                                     |
| `pnpm build:release`    | 0      | 0       | staged CLI bundle and web build                                                     |
| `pnpm pack:smoke`       | 0      | 0       | 15 steps against the `npm pack` tarball (Windows skips the SIGTERM step, see below) |
| `pnpm bench:runtime`    | 0      | —       | Ubuntu: 100,000 commits, three lifecycles. Windows: **did not complete** (below)    |

`pnpm test:e2e`, the Playwright suite, is also on the Ubuntu machine: **30 of 30 chromium specs
passed** against the built SPA served by the real host. Firefox and WebKit were **not** run there —
their Playwright builds are not installed on that machine, and installing them was not necessary
for the question being asked (does the product work on Linux), so those two engine rows stay as
they are in `release-matrix.md`: verified on macOS, unverified on Linux. On Windows the e2e suite
was **not run at all**: Playwright's browsers are not installed there either.

`pack:smoke` on Windows records one step as **skipped** rather than passed: "SIGTERM stops the
service cleanly". Windows has no signals — `process.kill` there is `TerminateProcess`, and there is
no process group to signal — so the graceful-shutdown path that step is about does not exist on
that platform. The service is terminated at the end of the run instead of left behind.

Both machines had the same quiet problem, and it is worth naming before the findings because it
explains why the local runs looked better than they were: the dev CLI finds its web build in
`.refyard-dev/web`, and on both machines that was a **symlink somebody had created by hand**
(`→ apps/web/build`) rather than anything the repository produces. Every local e2e pass therefore
depended on it, and the first CI run — where no such symlink exists — failed all thirty specs on a
missing panel. `bundle-cli.ts` stages the built SPA there now; on the Ubuntu machine, with the
symlink deleted and only `pnpm build && bun scripts/bundle-cli.ts` run, the chromium suite passed
30 of 30 again (revision `575edc6`).

## What the runs found

Five defects, in the order they were found. Each is fixed, and each fix has a case that fails
without it.

1. **A deleted-and-recreated repository kept its approval on Linux.**
   `git status`-visible state as irrelevant; the identity check compared `st_dev` + `st_ino`, and
   on ext4 `rm -r root && mkdir root` hands the _same_ inode number back — measured on that
   machine, both numbers identical. macOS passed because APFS gives the replacement a new number,
   so only the Linux run exposed it: an approval that refuses to survive replacement on one
   filesystem and silently survives it on another is not a check. Directories are now _pinned_ with
   a held descriptor, which the kernel cannot free an inode out from under; Linux additionally
   reports the held inode's link count as 0 once its last name is gone. Fixed in
   `packages/host-node/src/registry/identity.ts`; cases in `tests/node/identity.test.ts`.

2. **`git clone` could not check out this repository on Windows at all.**
   `packages/git-core/src/bytes/nul.ts` is a reserved device name there, with or without an
   extension, so Git refused to write it: `error: invalid path ... fatal: unable to checkout
working tree`. Reproduced on the machine, then renamed to `nul-framing.ts`, and a test now fails
   if any tracked path is one Windows cannot hold — a reserved name, a forbidden character, a
   trailing dot or space, or a case-insensitive collision.

3. **A Windows user could not add a local remote.**
   The URL validator accepted only POSIX-absolute local paths — `/srv/git/app.git` — and refused
   `C:\repos\app.git`, which is the form a Windows browser sends. The validator is host-free and
   cannot ask the platform, so the rule is now a shape rule that covers both (drive-absolute and
   UNC), with the dangerous shapes — `-` as an option, `::` as a transport helper, control
   characters — still refused first. Cases in `tests/contract/schema.test.ts`.

4. **Every submodule read on Windows said "uninitialized".**
   `relativeTo` proved containment by building a `<root>/` prefix and comparing strings, which
   never matches a Windows `C:\...\repo` plus a joined child path, so the submodule's own HEAD
   could not be read at all: `actualOid` was null and the state came out `uninitialized` for
   submodules that were checked out correctly. It resolves both sides now.
   Found by `tests/integration/reads.test.ts` on Windows.

5. **On Windows a repository's display name was its whole path.**
   `baseName` cut the name at the last `/`, and a Windows path has none, so every row in the
   repository list read `C:\Users\shenh\AppData\Local\Temp\...\repo`. It is `basename` now, with
   the filesystem root keeping its own name.

Two more findings were about the tests and the gates rather than the product, and both are the kind
that hide a real failure:

- The e2e repository-creation spec asserted `main` for a repository created with an _empty_ branch
  field — which means "whatever Git calls the initial branch on this machine". It passed on macOS,
  where the developer's global config says `main`, and failed on the Ubuntu machine, where nothing
  does and Git said `master`. The spec fills the field now. What the default _is_ stays covered in
  the integration suite, which compares against a real `git init` in the same environment instead of
  a fixed name.
- The terminal-injection case (a control character in a path) cannot exist on Windows at all: NTFS
  forbids such a name, and Git for Windows refuses to put one in the index either
  (`error: Invalid path`). The case is skipped there with that reason written in it; the escaping
  rule is still exercised on Windows by the patch-content case next to it.

Windows also changed how two gates run, and neither is a product difference:

- `test:portable` pasted a Windows path into generated TypeScript, where `\U`, `\s` and `\d` were
  read as escapes; the placeholder is JSON-encoded now.
- `pack:smoke` cannot observe a long-running `npm exec` child on Windows: what it writes reaches
  the parent only at exit, whether the parent's stdout is a pipe or a file (tried with Node and
  with bun, through `cmd.exe` and directly). A short-lived command is captured normally. The
  service is therefore started from the installed package that `npm exec` would have run, installed
  by npm from the same tarball. `npm.cmd` also cannot be spawned without a shell there — Node
  refuses with `EINVAL` — so the wrapper goes through `cmd.exe` with the arguments quoted.

## Round two — the browser suite on both machines

The first round left two rows unstated rather than guessed: no engine other than chromium had ever
run on the Linux machine, and the e2e suite had never run on Windows at all. Both were closed on
2026-09-16, after the first release.

### Ubuntu: Firefox, and WebKit blocked by one apt package

`pnpm exec playwright install firefox webkit` succeeded — no root needed for the browsers
themselves — and `pnpm test:e2e` at revision `8a7664f` came back:

| Engine   | Result                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| Chromium | **30 of 30 pass**                                                                                             |
| Firefox  | **30 of 30 pass** — the first time this engine has run on Linux                                              |
| WebKit   | **30 of 30 fail to launch**: `Host system is missing dependencies to run browsers … sudo apt-get install libavif16` |

The WebKit failures are instant (~175 ms each) and the service side of each one is healthy — the
harness's failure dump shows the service serving its UI and printing a pairing URL before the
browser is asked for anything. The engine needs `libavif16`, and installing it needs root on that
machine, which this run did not have; the row stays **unverified** rather than assumed. The fix is
one command, written here so the next attempt starts with it:
`sudo pnpm exec playwright install-deps` (or `sudo apt-get install libavif16`).

After the environment fix below was in place, chromium and Firefox were re-run at revision
`ef5a6f8` on that machine: **60 passed in 6.1 m, exit 0** — a regression check on the change, not a
re-measurement of the rows above.

### Windows: the first browser run, and the defect it found

The first `pnpm test:e2e` ever executed on Windows (revision `8a7664f`) came back **74 passed, 16
failed**, and fifteen of the sixteen were the same thing in three engines:

```
- Expected  - 0
+ Received  + 1
  Uint8Array [ 98, 97, 115, 101, + 13, 10 ]      // "base\r\n" where the fixture wrote "base\n"
```

`staging.spec.ts` (discard restores the file), `stash.spec.ts`, `workflows.spec.ts` (merge abort),
`workspace.spec.ts` (clone) and `worktree.spec.ts` all failed this way — every one of them a place
where **Git writes a working-tree file**, and every one of them comparing bytes. The cause was in
the product, not the test:

6. **The service ran Git with a configuration the session did not choose.**
   The environment handed to Git is built from an allow-list, and `GIT_CONFIG_GLOBAL`,
   `GIT_CONFIG_SYSTEM` and `GIT_CONFIG_NOSYSTEM` were not on it. Those three do not redirect Git at
   anything or make it run anything — they name *which config files are read* — and dropping them
   means the service reads the default files no matter what the caller's environment says. On that
   Windows machine the difference is visible in bytes: Git for Windows' installer sets
   `core.autocrlf=true` in `C:/Program Files/Git/etc/gitconfig`, so the service wrote CRLF while the
   fixture's own Git — which does see those variables — wrote LF, and the suite compared the two.
   Measured on the machine, both directions: `git config --show-origin --get core.autocrlf` →
   `file:C:/Program Files/Git/etc/gitconfig true`, and with the fixture's own environment → unset.
   The same hole had a second, quieter effect on every platform: a user (or a CI job) pointing
   `GIT_CONFIG_GLOBAL` at an alternate profile was silently ignored.
   Fixed in `packages/host-node/src/process/environment.ts`; cases in `tests/node/runner.test.ts`
   (the three names reach the child; the `-c`-equivalent ones still do not) and
   `tests/node/git-environment.test.ts` (a real checkout through a host built the way `refyard serve`
   builds one writes the line endings the session's config asks for, with the fixture's own Git as
   the control). Both fail before the change.

With that fix (revision `ef5a6f8`) the same suite came back **89 passed, 1 failed**, and the
remaining failure had no failing assertion in it:

7. **Teardown on Windows failed on a directory another handle still held.**
   `EBUSY: resource busy or locked, rmdir '…\refyard-fixture-…\repo'` was thrown by the fixture's
   own disposal, after the spec's assertions had all passed — the service a spec had just stopped
   can still be closing its last file handle, and Windows refuses to remove a directory while one is
   open (POSIX removes it happily, which is why this never appeared on macOS or Linux). `rm` retries
   `EBUSY`/`EPERM`/`ENOTEMPTY` when asked; teardown now asks, with a case that holds a handle open
   across `dispose()` — deterministic on Windows, trivially true elsewhere, and said that way in the
   test.

At revision `1464a1b`, Windows ran the whole suite clean: **90 passed in 4.9 m, three engines** —
the first complete browser run on that machine.

### Windows: `bench:runtime`, and why it never completed

The first round left this gate as "did not complete, cause not diagnosed". The cause was in the
tool, and the diagnosis is now measured rather than inferred:

8. **The benchmark measured memory by running `ps`, which does not exist on Windows.**
   `rssOf()` spawned `ps -o rss= -p <pid>`, and on Windows that spawn fails. The promise resolved on
   the child's `exit` event, which never arrives for a process that never started, so the gate waited
   forever: the 100,000-commit fixture had been built in seconds, the service was up and answering
   HTTP 200, and nothing else happened — which is exactly what the first round observed and could
   not explain. It also threw `ENOENT` as an unhandled `error` event in the attempt that streamed
   its output. `rssOf()` now asks Windows through PowerShell (`WorkingSet64`, in bytes, converted to
   KiB so both platforms report the same unit), reports `null` — "unknown" — when a platform cannot
   be asked at all, and never leaves the promise pending.

With that fix the gate completes on Windows at full size: 100,000 commits, three lifecycle runs,
exit 0. The numbers are not comparable across platforms without care — the same fixture, the same
packaged CLI, the same three runs:

| Measurement                         | macOS (this machine) | Windows 10.0.26200 |
| ----------------------------------- | -------------------- | ------------------ |
| `cold-start-to-ready`               | 0.497 s              | 0.97 s             |
| `status-read-throughput`            | 189 reads/second     | 104 reads/second   |
| `history-first-page`                | 414 ms               | 547 ms             |
| `service-rss-after-start`           | 87 MiB               | 70 MiB             |
| `service-rss-after-reads`           | 93 MiB               | 74 MiB             |
| `diff-service-rss-after-start`      | 88 MiB               | 71 MiB             |
| `diff-service-rss-after-batch`      | 192 MiB              | 137 MiB            |
| `status-after-switching-services`   | 18 ms                | 36 ms              |
| `graceful-shutdown`                 | 5 ms                 | 7 ms — see below   |

One measurement does **not** mean the same thing on both platforms: `graceful-shutdown`. Windows has
no signals, so stopping the service there is `TerminateProcess`, not a drain; the 7 ms is how long
that takes, not evidence that a bounded drain happened. The drain path is exercised on macOS, on
Linux and in CI, and `pack:smoke` records its Windows SIGTERM step as skipped for the same reason.

## What is still unverified

Named plainly, because a matrix row is only as good as its status word:

- **Windows e2e** — closed in round two: **90 of 90 in three engines**, revision `1464a1b`. What
  stays unverified there is what the suite does not reach; see the interop list below.
- **`bench:runtime` on Windows** — closed in round two: the gate completes at full size (100,000
  commits, three lifecycles, exit 0). The first round's non-completion was diagnosed and fixed: the
  benchmark measured memory with `ps`, which does not exist there. The one number that does not
  transfer is `graceful-shutdown`, because Windows has no signals — that path is untested there.
- **Linux WebKit** — **blocked, not failed**: the engine needs `libavif16` on that machine, which
  needs root (`sudo pnpm exec playwright install-deps`). Chromium and Firefox both pass there; this
  row stays unverified until someone runs that command.
- **CI on Windows**: the workflow runs `ubuntu-latest` and `macos-latest`. Windows is not in the
  matrix, so the Windows rows above rest on the manual run on this one machine.
- **Safari, iOS, Android, assistive technology**: unchanged from `release-matrix.md`.
- **Windows interop details** the suite does not reach: long paths beyond `MAX_PATH` without the
  registry opt-in, UNC or network filesystems, junctions and reparse points, and a repository whose
  paths contain characters legal on NTFS but not representable in the service's encoding.
- **Timing-sensitive behaviour on either machine**: the suites were each run once. A single pass is
  evidence that the gates pass, not evidence that nothing is flaky.
