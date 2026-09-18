# Deliverable B — a remote repository read from the desktop application

The same `.app` as deliverable A, now opening a repository that lives on another machine: the
host is chosen from the user's own SSH configuration, the path is typed as it exists there, and
every read runs through this machine's OpenSSH against a container that has no Refyard artifact,
no JavaScript runtime and no language runtime of any kind installed.

Everything below was produced by running it. Nothing is projected from a unit test; the tests
that also cover this path are named where they exist, and the two claims they cannot make —
that the window rendered, and that the far side stayed clean — are only made here.

## The artifact

| Fact               | Value                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Build command      | `pnpm desktop:build` (`bun scripts/build-desktop.ts`: SPA into `apps/web/build-desktop`, then `pnpm exec tauri build`)          |
| Bundle             | `apps/desktop/src-tauri/target/release/bundle/macos/Refyard.app`                                                                |
| Installed bytes    | 12 MiB (walked; 11.9 MiB reported by the build script)                                                                          |
| Executable SHA-256 | `2e0c12e6b8b7a913149fdb3fa337a0907ba511d5734c371136712998ef7cfc6e`                                                              |
| Source             | built from the working tree committed as `feat(workbench): open local and ssh repositories through one ui`, on top of `5692787` |
| Signed             | no                                                                                                                              |

## The fixture it read from

`pnpm native:ssh:fixture -- start` (Docker, Alpine 3.20, OpenSSH 9.7p1, git 2.45.4), reached at
`127.0.0.1:32784` through the alias `refyard-ssh-fixture`. The container carries no Refyard
artifact and no runtime:

```
$ docker exec refyard-native-ssh-fixture ps -ef
PID   USER     TIME  COMMAND
    1 root      0:00 sshd: /usr/sbin/sshd -D -e -f /etc/ssh/sshd_config [listener] 0 of 10-100 startups
  917 root      0:00 ps -ef

$ docker exec refyard-native-ssh-fixture find / -xdev -iname '*refyard*'
/srv/refyard fixture's rëpo

$ docker exec refyard-native-ssh-fixture sh -c 'for p in node bun deno refyard python3 npx curl; do command -v $p || echo "absent: $p"; done'
absent: node / bun / deno / refyard / python3 / npx / curl
```

The one `refyard`-named path on the server is the seeded repository _directory_, not an
artifact. Only `sshd` is running; no process of ours is started there, and nothing is uploaded.

## The launch

```
env -i PATH=/usr/bin:/bin \
  HOME="$PWD/target/native-ssh-fixture/home" TMPDIR=/tmp LANG=C \
  REFYARD_SSH_CONFIG="$PWD/target/native-ssh-fixture/home/.ssh/config" \
  .../Refyard.app/Contents/MacOS/refyard-desktop
```

`REFYARD_SSH_CONFIG` is why this run is possible at all. OpenSSH resolves `~/.ssh/config` from
the passwd entry, not from `HOME` — measured, not assumed:

```
$ HOME=/tmp/sshhome.XXXX ssh -G probe-alias | grep -E '^(hostname|user) '
user hk
hostname probe-alias        # the scratch config's Host entry was not read
```

So a host that lists `$HOME/.ssh/config` while `ssh` reads the passwd home would list one file
and execute another. When the variable names an absolute path, that file is both the one
enumerated and the one handed to `ssh` with `-F`; unset — the product default — is OpenSSH's own
rules, so a system-wide `/etc/ssh/ssh_config` is not silently dropped.

## What the window showed

Read through the accessibility API after choosing `refyard-ssh-fixture` in the location control
and typing the remote path:

```
tab:        refyard fixture's rëpo    refyard-ssh-fixture
header:     refyard fixture's rëpo · main · refyard-ssh-fixture
navigation: Repositories 1 · Working Copy 3 · Refs 1

History
  fixture: second content   main   Refyard Fixture   8 months ago   dba31eea
  fixture: initial content                Refyard Fixture   8 months ago   001e17e0
  End of the loaded history

Working Copy
  /srv/refyard fixture's rëpo · main · 3 changed
  Unstaged Files 3
    .M a.txt
    .M weird 'quoted' name.txt
    ?? untracked file.txt  untracked
  Staged Files 0        Nothing staged.
  Commit   0 staged paths   [Commit] [Amend…] [Amend, keep message]   (all disabled)

Commit dba31eea0f1564bcb3ff7fb081fa74c9726c5e4c · refs/heads/main
  Refyard Fixture <fixture@refyard.invalid> · 2026-01-03 03:04 UTC
  tree 739f4e82 · parents 001e17e0 · 2 files +4 −0
  README.md modified +2 −0     docs/notes.md added +2 −0

Diff for a.txt (unstaged)
  @@ -1,2 +1,3 @@     alpha / beta  →  alpha / beta / +gamma
```

The server's own Git, run inside the container as the account the app connects with:

```
$ docker exec -u gituser ... git -C "/srv/refyard fixture's rëpo" status --short
 M a.txt
 M "weird 'quoted' name.txt"
?? "untracked file.txt"

$ docker exec -u gituser ... git -C "..." log --oneline --no-decorate -3
dba31ee fixture: second content
001e17e fixture: initial content

$ docker exec -u gituser ... git -C "..." diff -- a.txt
@@ -1,2 +1,3 @@
 alpha
 beta
+gamma

$ docker exec -u gituser ... git -C "..." show --stat --oneline dba31eea
 README.md     | 2 ++
 docs/notes.md | 2 ++
 2 files changed, 4 insertions(+)
```

Every count, marker, object name and commit message matches, including the file whose name
contains spaces and apostrophes and the one whose content is `alpha/beta/gamma`.

## How the reads run

Sampling the app's process tree every 100 ms while the window was open caught each read's own
process. One full command line, verbatim:

```
/usr/bin/ssh -T -o BatchMode=yes -o RequestTTY=no -o RemoteCommand=none -o SessionType=default
  -o StdinNull=no -o ForkAfterAuthentication=no -o ClearAllForwardings=yes -o ForwardAgent=no
  -o ForwardX11=no -o PermitLocalCommand=no -o StrictHostKeyChecking=yes -o ConnectTimeout=15
  -o ServerAliveInterval=15 -o ServerAliveCountMax=2
  -F /…/target/native-ssh-fixture/home/.ssh/config refyard-ssh-fixture
  git -C '/srv/refyard fixture'"'"'s rëpo' '--no-optional-locks' 'status' '--porcelain=v2' '--branch' '-z'
```

That line is the whole design in one measurement:

- the program is **this machine's `/usr/bin/ssh`**, not a bundled client;
- the option set is the fixed policy, applied as data — batch mode, no TTY, no agent or X11
  forwarding, no local command, `StrictHostKeyChecking=yes`, and no `-F` unless one was chosen;
- the alias is passed **as written** in the configuration; the resolver is OpenSSH, not us;
- the remote path is single-quote encoded (`'"'"'`), so the space, the apostrophe and `ë` reach
  `git -C` as one argument and cannot become a second command;
- the read is `status --porcelain=v2 --branch -z` — NUL framing, parsed from bytes.

Other reads seen in the same window: `for-each-ref --format=…%00…`, `rev-parse --verify --quiet
HEAD`, `symbolic-ref --quiet HEAD`, `remote -v`.

## Process and network facts

- **The app holds no socket and no listener.** `lsof -nP -a -p <pid> -i` and
  `… -iTCP -sTCP:LISTEN` are both empty: the workbench talks to its host over Tauri IPC, and the
  remote machine is reached by spawning `ssh`, never by a local listener.
- **The environment was `PATH=/usr/bin:/bin`** with no `node`, `bun` or `deno` on it.
- **Quitting leaves nothing.** No `refyard-desktop` process remains, and no `ssh` child survives
  (`pgrep -fl "ssh -T -o BatchMode"` is empty afterwards).
- The only stderr the process wrote was macOS's keyboard-LED notice.

## Tests that cover the same path (and what they cannot cover)

- `cargo test -p refyard-host --test ssh_exec -- --ignored --test-threads=1` — 14 passed. Reads
  over SSH; raw stdout byte-identical to the local run for status, history and diff.
- `cargo test --test ssh_target -- --ignored` in `apps/desktop/src-tauri` — 1 passed. The window's
  own command bodies: create the target from a listed candidate, register the remote path on it,
  read status and history, drop the target, and be _refused_ afterwards rather than answered by
  this machine.
- `pnpm exec playwright test tests/e2e/ssh-repository-launcher.spec.ts` — 15 passed across
  chromium, firefox and webkit, against a recording fake of the host routes. It is a fake: a
  WebView cannot be driven from Playwright, so that spec proves the UI's behaviour, and this
  record — the window, the real `ssh`, the clean server — is the part it cannot.

## What this does not cover

- **Only macOS arm64**, unsigned, over one Linux/OpenSSH 9.7p1 server on loopback. A real remote
  host, a jump host, a non-POSIX remote shell and Windows are unexercised.
- **Credentials were the fixture's own key file.** The agent, 1Password and `Confirm` prompts
  (D14) were not exercised — the fixture environment deliberately carries no `SSH_AUTH_SOCK`.
- **The untracked file has no remote patch.** `status` lists `untracked file.txt`, and the diff
  lists the two tracked modifications only. Synthesizing an untracked patch means reading the
  file, and this build refuses to read a _local_ path for a remote repository rather than show
  the wrong machine's bytes. A remote file read is D10's work.
- **`truncated: true` is also set for a limitation that is not a bound.** The commit view says
  "This listing was truncated" for a 2-file, 322-byte commit, because the response carries the
  limitation "patches are fetched per path; request one with pathId to see its patch" and the
  contract's `truncated` is derived from "any limitation". The Node service does exactly the same
  (`packages/host-node/src/coordinator/reads.ts:1014`), so this is faithful to the reference and
  not a regression — but the wording over-claims, and it should be fixed on the UI side or by
  splitting the field.
- **No screenshot file is stored**, for the same reason as deliverable A: this environment has no
  Screen Recording permission for `screencapture`. The window is recorded above as its
  accessibility transcription.
- **One e2e spec was flaky and is now fixed, and the fix is worth naming.** The first full
  chromium run of this milestone reported 55 passed, 1 failed —
  `context-menu.spec.ts:157` (`stages, unstages and confirms discard from a path context menu`) —
  while the same spec passed alone and in the next full run. The cause is in the spec, not the
  app: it waited for **Git** to have staged the file and then immediately right-clicked, so the
  click could land before the panel's own status refresh; the menu's `Unstage` action is enabled
  from what the panel believes. The fix adds the assertion the test always meant — that the panel
  shows the file as staged (respectively unstaged) before the next menu is opened — so it is a
  stronger test, not a weakened one. Full chromium suite afterwards: 56 passed, twice.
- **The gates this milestone ran**, all on this machine, all macOS arm64:
  `cargo test --workspace` 397 passed / 14 ignored, `cargo clippy -D warnings` and `cargo fmt
--check` clean; `cargo test` in `apps/desktop/src-tauri` 19 passed (18 + 1 unit), plus the one
  fixture test with `--ignored`; `pnpm check` 11 tasks and root `tsc` clean; `pnpm test:unit` 428
  passed; `pnpm test:integration` 418 passed; `pnpm check:boundaries` and `pnpm check:contract`
  clean; Playwright 56 passed on chromium plus 15 on firefox and webkit for the new spec.
- **Not exercised here:** the hosted-UI form, and the HTTP transport against this native build.

## Which acceptance rows this evidence speaks to

| Row | What this record shows                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------- |
| B05 | The same remote path on another target is a separate tab and a separate cache namespace; the local tab keeps its own data         |
| C01 | The location control opened on `This machine`; nothing connected until an SSH host was chosen                                     |
| C02 | The host list offered `refyard-ssh-fixture · source_603a99b1…` from the chosen configuration source                               |
| C07 | Listing hosts ran no `ssh`: the only `ssh` processes in the window were the reads above, each with a Git command                  |
| C09 | The alias `refyard-ssh-fixture` was passed to OpenSSH unchanged                                                                   |
| C11 | `StrictHostKeyChecking=yes` with the client's own `known_hosts`; the connection succeeded against a key generated on this machine |
| D01 | A real server with no Refyard artifact and no runtime; the window showed real status, history and diff                            |
| D02 | `RequestTTY=no`, `StdinNull=no`, `status -z`: no terminal, and stdout parsed as bytes                                             |
| D03 | The path with a space, an apostrophe and `ë` was single-quote encoded into one argument                                           |
| D05 | The remote path was never resolved or stat'ed on this machine; it is shown as the far side spells it                              |
| D13 | The remote side received commands only: no upload, no installer, no helper, no `npx`/`curl`                                       |

Rows this record does not speak to are left unsaid: D04/D07/D08/D11/D12 need reads or fixtures
that were not part of this run, D06/D09 need unborn, detached, bare and worktree cases, D10 is a
disconnect case in the UI, D14 needs the real credential store, and every write row (E*) belongs
to the milestone that implements writes.
