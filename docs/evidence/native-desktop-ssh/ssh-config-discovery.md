# SSH host discovery — the candidate list, and what it is not

The launcher can now run Git somewhere other than this machine, and the first half of that is
knowing what a person's own SSH configuration names. This record covers that half: reading the
configuration, the picker that shows it, and the checks that keep it a read.

Nothing here connects to anything. There is no SSH client in this milestone, no key is touched, and
no configuration line is executed — the second half, executing Git through system OpenSSH, is the
next milestone and this record says nothing about it.

## What was built

| Piece | Where |
|---|---|
| Lexer: `Host` patterns, `Include`, quoting, comments | `crates/refyard-host/src/ssh/config_lex.rs` |
| Source walk: includes, globs, budgets, cycles, revision | `crates/refyard-host/src/ssh/source.rs` |
| `ConfigCatalogue` and the id/revision scheme | `crates/refyard-host/src/ssh/config_catalogue.rs` |
| The service's answer | `ApplicationService::ssh_hosts` in `crates/refyard-host/src/service.rs` |
| The host DTOs | `crates/refyard-contract/src/host.rs` |
| The picker and its pure logic | `packages/git-ui/src/components/ExecutionTargetPicker.svelte`, `packages/git-ui/src/lib/execution-targets.ts` |

Budgets are the design's: depth 8, 128 files, 2 MiB. Relative `Include` paths resolve against the
user's SSH directory. A conditional or token-dependent `Include` cannot be enumerated, so it earns a
warning and marks discovery incomplete instead of being silently skipped.

## Verified against this machine's real configuration

The picker was opened in the real `.app` (built by `pnpm desktop:build`, launched with `open`) and
listed, in this order:

```
This machine                                       ← the default, always first
orb                                                ← from Include ~/.orbstack/ssh/config
bitlake-dev-win  digital-ocean-pm-data  truenas  rog16  rog16-windows  rog16-wsl
tailscale-rog16  dev-server  dev-desktop  Polyquant  pi1  pi3  ufo  ufo-windows
ufo-eth  ufo-tailscale  ufo-win  bitlake-mac-mini  mac-mini  coolify-office
bitlake-dev-proxy-ec2  bitlake-dev-ec2-prod  bitlake-dev-ec2-dev  bitlake-truenas
bitlake-truenas-dokploy  bitlake-office-dev2  banwagong-jp  hostinger-malaysia
```

29 aliases, and an independent `awk` pass over `~/.ssh/config` plus the OrbStack file — splitting
every `Host` line, dropping `*`, `?`, `!` and `%` patterns — computes the same 29, in the same
order. The one alias that comes from an `Include` is there, which is what makes the Include support
a fact rather than a claim.

While the picker was open the app had **no child process at all** (`ps -ax -o pid,ppid,command`,
filtered to children of the host pid, empty) and still held **no socket**
(`lsof -nP -a -p <pid> -i` empty). Reading a configuration that contains a `Match exec` or a
`ProxyCommand` therefore executed nothing — not because those lines are filtered out of the answer,
but because nothing runs at all.

## Verified in the suite

| Command | Result |
|---|---|
| `cargo test -p refyard-host --test ssh_config` | 27 passed |
| `cargo test --workspace` | 334 passed (contract 23, core 140, host 106, environment 6, filesystem 11, process 10, reads 11, ssh_config 27) |
| `cargo test -p refyard-desktop` | 17 passed |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `cargo fmt --all --check` | clean |
| `pnpm test:unit` | 46 files, 422 passed |
| `pnpm check` | 11 tasks, svelte-check 0 errors 0 warnings, root `tsc` clean |
| `pnpm exec playwright test tests/e2e/workspace.spec.ts tests/e2e/workflows.spec.ts` | 18 passed (chromium, firefox, webkit) |

Two of those tests carry more weight than their line count suggests. One stages a configuration
containing `Match exec` and a `ProxyCommand` that would create a file, runs the listing, and asserts
the file does not exist — the "reading never executes" guarantee, made falsifiable. The other asserts
that a partial include still lists the hosts it could read, with a warning and
`discoveryIncomplete: true`, so a truncated list can never be presented as a complete one.

## Decisions where the specification was ambiguous

Each of these was chosen deliberately; a reviewer may want to reverse one, and each is pinned by a
test so reversing it is a visible change.

- **An unreadable primary file is an error, not an empty list.** The specification says a *missing*
  primary is fine (a machine with no SSH config has no aliases). A file that exists and cannot be
  read is different: an empty list would answer "this machine declares no hosts" about a file nobody
  could read, so it is refused as `Forbidden`.
- **An unterminated quote makes its file contribute nothing**, with a `config-unparsable` warning and
  discovery marked incomplete, rather than guessing where the argument ends.
- **`#` is a comment only at the start of a token.** Real OpenSSH treats `Host hash#tail` as the
  literal alias `hash#tail`; a naive "`#` starts a comment anywhere" lexer would have dropped it.
- **`Host = prod` names `prod`** (the leading `=` is a separator), while a `=` later in a pattern
  stays part of it.
- **Globs never cross `/`**, support `[...]` classes and `\` escapes, require a leading `.` to match a
  dotfile, and skip directories. A glob that matches nothing is not a warning — there was nothing to
  read; a *literal* path that is missing is.
- **`~` inside an `Include` resolves against the include base's parent**, because the API carries the
  SSH directory rather than a home directory; `~user` is unenumerable and warns.
- **A cycle stops that chain** (other glob targets are still read) and marks discovery incomplete.
- **Budgets stop the whole walk.** Depth, file count and byte limits are per source set, and hitting
  one leaves a warning on the list rather than a failure.
- **The revision is `sha256-<hex>`** over each file's bytes in read order, and ids are `source_` and
  `host_` prefixed hashes — deterministic, so a selection survives a restart.

## Not verified, and not claimed

- **No host has been contacted.** There is no provider yet; `targetKinds` still names only the local
  target, so the UI does not offer to open one. The picker says so where it disables Open and Browse
  while an SSH host is selected.
- **The contract carries no source path.** `SshHostCandidate` has an opaque `sourceId` and the list
  has no source table, so the picker can only show `alias · sourceId` — a person cannot see whether an
  alias came from `~/.ssh/config` or an included file. Adding a display path is a contract change and
  belongs with the milestone that also needs it for connection diagnostics.
- **A hand-entered alias cannot name its source**, for the same reason: the contract's manual form
  requires a `sourceId` the client does not have when the list is empty or partial.
- **Stored recent targets are not shape-checked** when the launcher hydrates them from storage, so a
  value written by another build would pass through unvalidated.
- **Only macOS arm64** was exercised, and the unix-only tests (mode 000, symlinks) have not run
  anywhere else.
