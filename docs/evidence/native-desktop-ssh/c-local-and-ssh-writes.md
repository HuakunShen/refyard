# Deliverable C — local and SSH writes from the real App

Read-only reads were deliverable B (`b-remote-repository.md`). This is the write half of the
M-native loop: a person stages, unstages and commits **through the window**, against a
repository on this machine and against a repository reached with this machine's own OpenSSH,
with the server's own `git` as the judge. Nothing was written to any repository that matters:
the local target is a throwaway under `/tmp`, the remote target is the fixture container's
seeded repository, and both are inspected afterwards with real Git.

Artifact: `apps/desktop/src-tauri/target/release/bundle/macos/Refyard.app`
(`refyard-desktop`, release, single binary). The write flow above was run on the binary built
before the journal-root fix in §6; the artifact was rebuilt afterwards and is the one whose
hash appears in the acceptance record:

```
$ shasum -a 256 …/Refyard.app/Contents/MacOS/refyard-desktop
df903851b7143f68867e4165407ccf9ce15e7fe274f9bcce7b7cd707ec614860  12869856 bytes
```

## 1. What was done, in the window

Both tabs were open in one window: `refyard app check · refyard-ssh-fixture` (remote) and
`repo · This machine` (local).

| step | remote (`/srv/refyard app check`) | local (`/tmp/refyard-c-local/repo`) |
| --- | --- | --- |
| read the worktree | `1 changed · ?? c.txt untracked` | `1 changed · ?? c.txt untracked` |
| Stage the file | `staged 1 path` → `Staged Files 1 · A. c.txt`, `Unstaged 0 · Working tree is clean.` | same |
| Unstage the file | `unstaged 1 path (working tree untouched)` → back to `?? c.txt untracked` | same |
| Stage again, type a message | `1 staged path`, `Commit` enabled once the message is non-empty | same |
| Commit | `created commit 459b43f9fd09515c5a8faf1b0bcda1815e36a6d8` | `created commit 5314383a3f3235fd2995faf1b4316dc320fc0989` |
| History, without a reload | `second write over ssh · Refyard Fixture · just now · 459b43f9` at the top of the panel | `staged and committed from the app · … · 5314383a` |

The remote tab's history before this session already held `staged and committed from the app`
(`94ac2e05`), so this was the second app-made commit in that repository, made after a stage,
an unstage and a re-stage in the same window.

The commit message was typed into the textarea by real keyboard input. An accessibility
`set_value` on that field changes the text the accessibility API reports but **not** the value
the Svelte component holds, so `Commit` stays disabled — worth knowing for anyone automating
this window: the field needs focus plus typed input, not a value assignment.

## 2. The server's own Git as the judge (remote)

```
$ docker exec -u gituser refyard-native-ssh-fixture git -C '/srv/refyard app check' log \
    --format='%H %an <%ae> %s' -3
459b43f9fd09515c5a8faf1b0bcda1815e36a6d8 Refyard Fixture <fixture@refyard.invalid> second write over ssh
94ac2e056d507835a3e7f0310d88d59987921058 Refyard Fixture <fixture@refyard.invalid> staged and committed from the app
19cc343d14a0a7e3b6bd5dc810068c7e0b1b3ec4 Refyard Fixture <fixture@refyard.invalid> fixture: initial content

$ docker exec -u gituser refyard-native-ssh-fixture git -C '/srv/refyard app check' status --porcelain=v1 --branch
## main

$ docker exec -u gituser refyard-native-ssh-fixture cat '/srv/refyard app check/c.txt'
brand new
```

Three things are load-bearing here. The commit exists with the message that was typed. The
author and committer are the **container's** identity (the fixture's own Git config) — nothing
in the app imposed an identity, and no `-c user.*` was sent. And `git status` afterwards is
clean with the working file still holding its content: the unstage moved the index only.

## 3. The server's own Git as the judge (local)

```
$ cd /tmp/refyard-c-local/repo && git status --porcelain=v1 --branch
## main
?? c.txt
$ git log --format='%H %an <%ae> %s' -2
5314383a3f3235fd2995faf1b4316dc320fc0989 Refyard Fixture <fixture@refyard.invalid> staged and committed from the app
d07c12ef9c2231407a8c5436c1d25c81f7638a06 Refyard Fixture <fixture@refyard.invalid> fixture: initial content
$ cat c.txt
brand new
```

Left exactly as it was found: the file untracked, its content intact, the app-made commit in
the log.

## 4. The write commands, read off the process table

Sampled while the window was working (`ps` every ~40 ms, filtered to the app's own children):

```
75596 19851 /usr/bin/ssh -T -o BatchMode=yes -o RequestTTY=no -o RemoteCommand=none \
  -o SessionType=default -o StdinNull=no -o ForkAfterAuthentication=no \
  -o ClearAllForwardings=yes -o ForwardAgent=no -o ForwardX11=no -o PermitLocalCommand=no \
  -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=2 \
  -F /Volumes/Portable2TB/ExtDev/refyard-native-desktop-ssh/target/native-ssh-fixture/home/.ssh/config \
  refyard-ssh-fixture \
  git -C '/srv/refyard app check' '--literal-pathspecs' 'add' \
      '--pathspec-from-file=-' '--pathspec-file-nul' '--'

77583 19851 /usr/bin/ssh … refyard-ssh-fixture \
  git -C '/srv/refyard app check' '--literal-pathspecs' 'restore' '--staged' \
      '--pathspec-from-file=-' '--pathspec-file-nul' '--'

…/ssh … refyard-ssh-fixture \
  git -C '/srv/refyard app check' 'commit' '--cleanup=verbatim' '--file=-'
```

Reads, for the same repository, were `status --porcelain=v2 --branch -z`,
`for-each-ref`, `rev-list --topo-order --parents --max-count=101 --stdin`,
`rev-parse --verify --quiet HEAD`, `symbolic-ref --quiet HEAD`, `remote -v`, `cat-file --batch`
and one `sh -c` blob reader that prints a reason word and `head -c 8388609` of the file — the
path is passed as a positional argument, never interpolated into the script text.

Four things about the write argv are worth stating plainly, because each is a rule in
`AGENTS.md` and each is visible here rather than asserted:

- **the path is data.** `--literal-pathspecs` so a file called `*` is a file, and
  `--pathspec-from-file=- --pathspec-file-nul` so the bytes travel on stdin NUL-delimited, with
  a trailing NUL. A path that is not valid UTF-8 cannot be mangled by an argument vector
  because it never enters one.
- **unstage is `restore --staged`,** which moves the index and never the working tree; there is
  no `checkout`, no `reset --hard`, no `-f`.
- **the commit message goes through `--cleanup=verbatim --file=-`,** so the message is the bytes
  that were typed, and there is **no `--no-verify`** — hooks run, exactly as the container's own
  `git commit` would.
- **the SSH policy is the same 14 options for every command,** reads and writes alike:
  `BatchMode=yes`, `StrictHostKeyChecking=yes`, `StdinNull=no` (writes need stdin),
  `RequestTTY=no`, `ClearAllForwardings=yes`, `ForwardAgent=no`, `PermitLocalCommand=no`,
  `ConnectTimeout=15`, … The client is `/usr/bin/ssh`, the config is the file the host was told
  about with `-F`, and the command is a direct child of the app: no shell, no `sh -c` around
  the local `ssh`, no `sshpass`.

For the **local** target the sampled child of the app is `git` itself
(`(git)` in the process table, state `RN`) — no `ssh`, no shell. macOS `ps` cannot render the
argv of a short-lived process that is on CPU (it prints the basename in parentheses), so the
local argv was not captured from the process table; it is the same planner output, pinned by
`crates/refyard-core/src/plan/paths.rs` and its tests, and the effect it has is verified above
by the repository itself.

## 5. Shutdown

```
$ ps -o pid=,stat=,command= -p 19851
gone (pid 19851)
$ pgrep -fl refyard-desktop
none
$ ps -Ao pid=,ppid=,command= | grep refyard-ssh-fixture
none
```

Quitting from the app menu leaves no `refyard-desktop` process and no `ssh` child behind; the
only `/usr/bin/ssh` processes on the machine afterwards belong to the coding agent that ran
this session, not to the app.

## 6. Where the app's own journal lives

Found while writing this record: the desktop composition root was opening the operation
journal **in memory**, so the "a write whose result is unknown blocks the next one until a
person confirms it" rule would have been true for as long as the process lived and forgotten on
exit — in the one build where a person actually depends on it. The rule now has one
implementation (`crates/refyard-host/src/state_root.rs`) matching the Node host's
(`packages/host-node/src/registry/roots.ts`), and the window uses it.

Measured on the real app, twice, by launching the bundle and looking at what it opened:

```
$ env -i PATH=/usr/bin:/bin HOME=/tmp/refyard-c-local/home TMPDIR=/tmp LANG=C \
    REFYARD_STATE_DIR=/tmp/refyard-state-root-check …/Refyard.app/Contents/MacOS/refyard-desktop
$ find /tmp/refyard-state-root-check
/tmp/refyard-state-root-check/journal/records

$ env -i PATH=/usr/bin:/bin HOME=/tmp/refyard-state-default-check TMPDIR=/tmp LANG=C \
    …/Refyard.app/Contents/MacOS/refyard-desktop
$ find /tmp/refyard-state-default-check -maxdepth 5
/tmp/refyard-state-default-check/Library/Application Support/refyard/journal/records
```

The second run is the product default with nothing set: macOS's per-user
`Application Support/refyard`. The first is the variable a fixture or a portable install pins.
Both directories exist before any write happens, so a restart reads the same layout the
previous process wrote. Both instances exited on `SIGTERM` with no process left behind.

## 7. What this does not cover


- **macOS arm64 only.** No Windows or Linux window was run for this deliverable.
- **One SSH host, one fixture key.** The container's host key was verified against a
  `known_hosts` built from the generated key; the user's own `known_hosts` was never touched,
  and no other host was contacted.
- **No remote untracked-file diff.** The remote diff read covers modified and staged paths;
  showing an untracked file's contents remotely is still open (carried in the D14 status list).
- **Timestamps of remote commits read as "in the future"** in the window, because the container
  clock is UTC while the reader is UTC+8. Cosmetic, unfixed, recorded in D14.
- **The e2e flake.** `tests/e2e/context-menu.spec.ts` failed once in a full chromium run
  (55 passed, 1 failed) because a stage/unstage assertion ran before the panel refreshed; the
  missing waits were added and three isolated runs plus two full runs were green afterwards.
  That suite exercises the Node service, not this app.
- **The durable journal of the windowed app.** The desktop composition root now opens its
  journal under the platform's per-user state directory
  (`crates/refyard-host/src/state_root.rs`, same rule as the Node host's
  `packages/host-node/src/registry/roots.ts`) instead of keeping it in memory, with
  `REFYARD_STATE_DIR` as the override a fixture uses; the wiring is covered by
  `a_write_through_the_window_leaves_a_record_the_next_process_can_read` and by the host
  crate's reopen/reconcile tests. A crash-and-restart of the *windowed* app under a killed
  write was not performed for this deliverable — the restart path it exercises is the same one
  those host tests drive, and D13's shutdown work is where a kill is scheduled.
