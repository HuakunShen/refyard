# SourceGit — Git CLI client findings

Research note for Refyard: command construction, parsing, worktree/submodule/stash, commit graph,
error handling, and test posture of a mature Avalonia Git GUI that shells out to the system `git`.

Every statement below is either **observed** (quote + `file:line`) or **inferred** (marked as such).
Where a mechanism looks like a bug that Refyard must not inherit, it is stated as such — not as a
design decision to emulate.

## Status block

| Item                           | Value                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| Repository                     | `/Volumes/Portable2TB/ExtDev/others/sourcegit` (symlinked as `references/open-source/sourcegit`) |
| `git -C <repo> rev-parse HEAD` | `24511804d1537b8807f55c536a4402398d81e8f6`                                                       |
| HEAD commit date / subject     | 2026-09-14 10:26:24 +0800 — "Merge branch 'release/v2026.20'"                                    |
| `VERSION`                      | `2026.20`                                                                                        |
| Branch                         | `master`                                                                                         |
| License                        | MIT (`LICENSE`); `PackageLicenseExpression` = MIT in `src/SourceGit.csproj`                      |
| Stack                          | .NET 10 / Avalonia 11.3.22, AOT-published, single `src/SourceGit.csproj`                         |
| Working tree                   | clean, no local modifications                                                                    |

Orientation: DeepWiki `sourcegit-scm/sourcegit` "Git Command Execution Layer" (`2.2`) and
"Commit Visualization" (`3.3`) pages were used to confirm file locations before reading. The wiki
exposes **no** page for parsing, error handling, worktree/submodule/stash, or tests; that absence is
itself evidence for section 7.

Files inspected:

| File                                                                                                                                          | Lines           | What it contains                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------- |
| `src/Commands/Command.cs`                                                                                                                     | 264             | The whole process layer: argv assembly, env, redirection, cancellation, stderr capture |
| `src/App.Extensions.cs`                                                                                                                       | 124             | `Quoted()` / `Escaped()` — the only quoting primitives                                 |
| `src/Native/OS.cs`                                                                                                                            | 412             | Git executable discovery, `git --version` probe, `TerminateProcess` dispatch           |
| `src/Native/Linux.cs` / `MacOS.cs` / `Windows.cs`                                                                                             | 240 / 440 / 430 | `setsid` wrapping and process-group kill per platform                                  |
| `src/Commands/Diff.cs`                                                                                                                        | 374             | The only byte-oriented reader; patch/numstat/LFS/submodule heuristics                  |
| `src/Commands/QueryLocalChanges.cs`                                                                                                           | 202             | `status --porcelain` (v1) + the 30-case status switch                                  |
| `src/Commands/QueryRepositoryStatus.cs`                                                                                                       | 64              | `status --porcelain=v2 -b`, positional header parsing                                  |
| `src/Commands/QueryCommits.cs`                                                                                                                | 111             | `log --format=...%x00...`, `IsMerged` marking                                          |
| `src/Commands/QueryBranches.cs`                                                                                                               | 118             | `branch -l --all -v --format=` with NUL-separated fields                               |
| `src/Commands/QueryTags.cs`                                                                                                                   | 62              | GUID-boundary record framing for multi-line tag bodies                                 |
| `src/Commands/QueryStashes.cs`                                                                                                                | 69              | `stash list -z --format="%H%n%P%n%ct%n%gd%n%B"`                                        |
| `src/Commands/Stash.cs`                                                                                                                       | 103             | push/apply/pop/drop/branch/clear argv                                                  |
| `src/Commands/Worktree.cs`                                                                                                                    | 111             | `worktree list/add/prune/lock/unlock/remove`                                           |
| `src/Commands/Submodule.cs`                                                                                                                   | 80              | `submodule add/update/set-url/set-branch/deinit` + `rm -rf`                            |
| `src/Commands/QuerySubmodules.cs`                                                                                                             | 159             | `submodule status` + `.gitmodules` + dirty probe                                       |
| `src/Commands/UpdateIndexInfo.cs`                                                                                                             | 91              | The only stdin writer (`update-index --index-info`)                                    |
| `src/Commands/QueryFileContent.cs`                                                                                                            | 68              | `show rev:path` and `lfs smudge` stdin                                                 |
| `src/Models/CommitGraph.cs`                                                                                                                   | 436             | The lane layout algorithm and its geometry primitives                                  |
| `src/Models/Commit.cs`                                                                                                                        | ~230            | `ParseParents`, `ParseDecorators` (`%D`, `--decorate=full`)                            |
| `src/Models/Change.cs`                                                                                                                        | ~130            | `Change.Set` — the C-quote stripping that is the crux of section 2                     |
| `src/Models/DiffOption.cs`                                                                                                                    | 159             | `diff` argv composition, `--no-index`, `rev:path` notation                             |
| `src/Models/Watcher.cs`                                                                                                                       | 364             | `FileSystemWatcher` + 1 s tick + `_lockCount` gate                                     |
| `src/ViewModels/Checkout.cs`, `StashChanges.cs`, `DropStash.cs`, `ApplyStash.cs`, `RemoveWorktree.cs`, `AddWorktree.cs`, `DeleteSubmodule.cs` | —               | Destructive-operation preconditions                                                    |
| `SourceGit.slnx`, `.github/workflows/{ci,build}.yml`                                                                                          | —               | Test-posture evidence                                                                  |
| `tools/setsid-macos/setsid.c`                                                                                                                 | —               | The macOS process-group shim                                                           |

Searches performed: `grep -rn "cat-file|for-each-ref|-z |pathspec-from-file|-z|core.quotepath"` over
`src/`; `grep -rn "Split('\\0')|%x00"` over `src/`; `grep -rni "xunit|nunit|mstest|\[Fact\]|\[Test\]"`
over the whole repo excluding `depends/` and `.git/`; `grep -rn "StdErr"` over `src/`.

---

## 1. Command construction

### 1.1 All argv is concatenated into one string

**Observed.** `Command` has a single mutable `Args` string (`Command.cs:33`). It is prefixed with
global options in `CreateGitStartInfo` and then handed to `ProcessStartInfo.Arguments` — a **single
string**, parsed by the platform, not an argv array (`Command.cs:186-190`):

```csharp
            builder.Append(Args);

            var start = new ProcessStartInfo();
            start.FileName = useSetSid ? Native.OS.GetSetSidExecutable() : Native.OS.GitExecutable;
            start.Arguments = builder.ToString();
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
```

The prefix is fixed for every Git invocation (`Command.cs:168-171`), plus a mandatory working
directory (`Command.cs:220-222`):

```csharp
            builder
                .Append("--no-pager -c core.quotepath=off -c credential.helper=")
                .Append(Native.OS.CredentialHelper)
                .Append(' ');
```

`Native.OS.CredentialHelper` defaults to `"manager"` (`OS.cs:80-84`) and is the only `-c` option that
is user-configurable; on Linux the UI can swap it for `libsecret` (`ViewModels/Preferences.cs:349-356`).

**Observed — how `-c` options are passed.** There is a second, non-user-visible block of `-c`
options, chosen by an `EditorType` enum, used to route Git's editor invocations back into the app
itself (`Command.cs:22-27`, `:173-184`):

```csharp
            switch (Editor)
            {
                case EditorType.CoreEditor:
                    builder.Append($"""-c core.editor="\"{selfExecFile}\" --core-editor" """);
                    break;
                case EditorType.RebaseEditor:
                    builder.Append($"""-c core.editor="\"{selfExecFile}\" --rebase-message-editor" -c sequence.editor="\"{selfExecFile}\" --rebase-todo-editor" -c rebase.abbreviateCommands=true """);
                    break;
                default:
                    builder.Append("-c core.editor=true ");
                    break;
            }
```

where `selfExecFile = Environment.ProcessPath` (`Command.cs:162`). `EditorType.None` means
`-c core.editor=true`, i.e. "do not open an editor, fail instead". So committing is never done by
writing a message into a pty: the app writes the message to a temp file and passes
`--file=<tmp>` (`Commands/Commit.cs:17-20`, `:33-46`).

**Observed — quoting.** `Quoted()` is the only escaping primitive and is hand-rolled
(`App.Extensions.cs:12-20`):

```csharp
        public static string Quoted(this string value)
        {
            return $"\"{Escaped(value)}\"";
        }

        public static string Escaped(this string value)
        {
            return value.Replace("\"", "\\\"", StringComparison.Ordinal);
        }
```

It quotes unconditionally (even for paths with no spaces), escapes only `"`, and is applied to
paths, ref names, URLs, branch names and temp-file paths — 78 call sites in `src/Commands/*.cs`.

**Inferred (bug class).** `Quoted()` produces POSIX-shell-style escaping inside a _string_ that
`ProcessStartInfo` re-parses with Windows rules on Windows; a path containing a backslash
(`C:\repos\a b`) is not escaped for the POSIX parser and is double-handled on Windows. Any path
containing `\` or a trailing `\` is a live hazard. Refyard's argv-array port removes this entire
class of bug — there is nothing here worth copying except the _set_ of options.

### 1.2 Environment

**Observed** (`Command.cs:202-218`):

```csharp
            // Force using this app as SSH askpass program
            start.Environment.Add("SSH_ASKPASS", selfExecFile); // Can not use parameter here, because it invoked by SSH with `exec`
            start.Environment.Add("SSH_ASKPASS_REQUIRE", "prefer");
            start.Environment.Add("SOURCEGIT_LAUNCH_AS_ASKPASS", "TRUE");
            if (!OperatingSystem.IsLinux())
                start.Environment.Add("DISPLAY", "required");

            // If an SSH private key was provided, sets the environment.
            if (!start.Environment.ContainsKey("GIT_SSH_COMMAND") && !string.IsNullOrEmpty(SSHKey))
                start.Environment.Add("GIT_SSH_COMMAND", $"ssh -i '{SSHKey}' -o AddKeysToAgent=yes");

            // Force using en_US.UTF-8 locale
            if (OperatingSystem.IsLinux())
            {
                start.Environment.Add("LANG", "C");
                start.Environment.Add("LC_ALL", "C");
            }
```

Points worth carrying over: `SSH_ASKPASS_REQUIRE=prefer` plus a `DISPLAY=required` placeholder is how
a GUI steals SSH passphrase prompts from an invisible terminal; `GIT_SSH_COMMAND` is only set when
the caller supplied a per-repo key **and** the ambient environment has not already set it (so the
user's own `GIT_SSH_COMMAND`/`core.sshCommand` wins); `SSH_ASKPASS` must be a file path because
`ssh` `exec`s it. The comment says `en_US.UTF-8` but the code sets `C` — the intent was "pin the
message locale", the effect is also that Git stops transcoding path bytes to the terminal charset.

**Inferred.** `LANG=C` is a deliberate trade: it makes Git's _diagnostics_ ASCII and predictable to
match on, at the cost of asking Git to treat the terminal encoding as ASCII. Combined with
`core.quotepath=off` this pushes raw non-ASCII path bytes onto stdout. That is the intended
byte-preservation path, but since the reader decodes UTF-8 (1.4) it only works for UTF-8-named
repos.

### 1.3 stdin

**Observed.** The shared process layer never redirects stdin: `CreateGitStartInfo` sets only
`RedirectStandardOutput`/`RedirectStandardError` (`Command.cs:194-200`); `ExecAsync`, `ReadToEnd`
and `ReadToEndAsync` never touch `StandardInput`. Any Git invocation that might prompt therefore
hangs until cancelled. Two commands bypass `Command` with their own `ProcessStartInfo`:

- `Commands/UpdateIndexInfo.cs:51-73` builds `-c core.editor=true update-index --index-info`, sets
  `StandardInputEncoding = new UTF8Encoding(false)` (BOM-less UTF-8), writes a mode/hash/tab/path
  patch and closes stdin.
- `Commands/QueryFileContent.cs:37-57` writes a three-line LFS pointer
  (`version https://git-lfs.github.com/spec/v1`, `oid sha256:…`, `size …`) into `git lfs smudge`.

**Observed — the pathspec-file idiom replaces most stdin use.** Rather than feeding paths on stdin,
several mutating commands write a temp file and pass `--pathspec-from-file=<tmp>`:
`add --force --verbose --pathspec-from-file=…` (`Add.cs:9`),
`reset --pathspec-from-file=…` (`Reset.cs:16`),
`restore --progress --worktree --recurse-submodules --pathspec-from-file=…` (`Restore.cs:9`),
`stash push --include-untracked --pathspec-from-file=…` (`Stash.cs:50`), and
`Discard.ChangesAsync` writes one path per line with `File.WriteAllLinesAsync`
(`Discard.cs:86-92`).

**Inferred (bug class).** Neither `--pathspec-file-nul` nor `--pathspec-file-nul`-equivalent
NUL separation is ever passed — `grep -rn "pathspec-file-nul" src/` returns nothing — and
`File.WriteAllLinesAsync` uses `\n` as the separator. A path containing a newline therefore splits
into two pathspecs. This is precisely the hole Refyard's "NUL framing + `--pathspec-file-nul`" rule
exists to close.

### 1.4 Reading stdout/stderr — this layer is string-based, not byte-based

**Observed** (`Command.cs:194-200`):

```csharp
            if (redirect)
            {
                start.RedirectStandardOutput = true;
                start.RedirectStandardError = true;
                start.StandardOutputEncoding = Encoding.UTF8;
                start.StandardErrorEncoding = Encoding.UTF8;
            }
```

Consequently every reader in `Command` is a **string** reader:

- `ReadToEnd` / `ReadToEndAsync` use `proc.StandardOutput.ReadToEnd()` /
  `ReadToEndAsync(CancellationToken)` (`Command.cs:113-157`).
- `ExecAsync` wires `OutputDataReceived` / `ErrorDataReceived` — i.e. **line-based** events, with
  the decoder's own EOL splitting (`Command.cs:47-49`), and `HandleOutput` receives a `string`
  with NUL bytes still embedded in it.
- Ad-hoc long-lived readers (`QueryLocalChanges`, `QueryCommits`, `QueryRevisionObjects`,
  `QueryConflictFileState`) call `proc.StandardOutput.ReadLineAsync()`.

**Observed — the single byte-oriented reader.** `Commands/Diff.cs` is the only place that copies
`StandardOutput.BaseStream` into a `MemoryStream` and walks bytes (`Diff.cs:68-90`):

```csharp
                using var ms = new MemoryStream();
                await proc.StandardOutput.BaseStream.CopyToAsync(ms, CancellationToken).ConfigureAwait(false);

                if (ms.TryGetBuffer(out var buffer))
                {
                    var start = buffer.Offset;
                    var end = buffer.Offset + buffer.Count;
                    while (start < end)
                    {
                        var lineEnd = Array.IndexOf(buffer.Array, (byte)'\n', start);
                        if (lineEnd < 0)
                        {
                            ParseLine(buffer[start..]);
                            break;
                        }

                        ParseLine(buffer[start..lineEnd]);
                        if (_result.IsBinary)
                            break;

                        start = lineEnd + 1;
                    }
                }
```

Splitting is on `\n` only, so a CRLF file keeps its `\r` in the content — which is how the UI is
able to label the line ending later (`Views/TextDiffView.axaml.cs:302` inspects
`RawContent[^1] == '\r'`). Each line is then decoded for the UI **and** the post-prefix bytes are
retained (`Diff.cs:208-212`):

```csharp
        private bool ParseChunkBodyLine(string line, ArraySegment<byte> lineBytes)
        {
            var prefix = line[0];
            var content = line.Substring(1);
            var rawContent = lineBytes[1..].ToArray();
```

`RawContent` exists for exactly one consumer: `PatchGenerator` re-emits it byte-for-byte when
building a partial-staging patch (`Models/PatchGenerator.cs:333`:
`writer.BaseStream.Write(line.RawContent);`). This is the closest SourceGit comes to Refyard's
"parse bytes, never re-encode" rule — and it is confined to one command.

**Observed — EOL handling elsewhere.** Dozens of parsers do
`rs.StdOut.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)` (e.g.
`QueryBranches.cs:28`, `QueryRepositoryStatus.cs:26`, `CountLocalChanges.cs:20`,
`Blame.cs:34`, `QuerySubmodules.cs:30`) — accepting both EOLs and dropping empty lines. Several
others call `.Trim()` on a field, which is destructive for paths:
`Worktree.cs:30` `FullPath = line.Substring(9).Trim()`, `:44`/`:48` for HEAD/branch;
`IsBinary.GetResultAsync` (`IsBinary.cs:22`) trims the whole stdout before matching.

**Observed — non-UTF-8 output.** There is no charset detection, no fallback decoder, no
`CodePagesEncodingProvider`, and no `core.quotepath` re-enable path anywhere in `src/`
(`grep -rn "CodePagesEncodingProvider|Encoding.Latin|Encoding.GetEncoding"` returns nothing).
The three mitigations are: `core.quotepath=off` (so Git does not octal-escape non-ASCII path
bytes), `LANG=C`/`LC_ALL=C` on Linux (so diagnostics are ASCII), and UTF-8 decoding with the
framework's replacement behavior.

**Inferred.** For a repo with Latin-1 (non-UTF-8) filenames, `StandardOutputEncoding = UTF8` turns
those path bytes into U+FFFD _before any parser sees them_, and the original bytes are
unrecoverable. `Diff.cs` is the only command where they could have been recovered, and it keeps
them only for line content, not for the `diff --git`/`+++ b/` header paths. This is the single
biggest gap between SourceGit and Refyard's byte-first contract; section 8 says what to do instead.

### 1.5 Running, cancellation, and the `setsid` wrapper

**Observed** (`Command.cs:51-68`):

```csharp
            var captured = new CapturedProcess() { Process = proc };
            var capturedLock = new object();
            try
            {
                proc.Start();

                // Not safe, please only use `CancellationToken` in readonly commands.
                if (CancellationToken.CanBeCanceled)
                {
                    CancellationToken.Register(() =>
                    {
                        lock (capturedLock)
                        {
                            if (captured is { Process: { HasExited: false } })
                                Native.OS.TerminateProcess(captured.Process);
                        }
                    });
                }
            }
```

The `CapturedProcess` box exists so the registration closure can null out the reference after exit
and avoid killing a recycled PID. The in-code comment — "Not safe, please only use
`CancellationToken` in readonly commands" — is the only guard against cancelling a mutation
half-way; it is a convention, not a mechanism.

When cancellation _is_ armed, the child is placed in its own process group so the whole tree can be
signalled (`Command.cs:161-166`):

```csharp
            var useSetSid = CancellationToken.CanBeCanceled && Native.OS.SupportSetSid();
            var selfExecFile = Environment.ProcessPath;
            var builder = new StringBuilder(2048);

            if (useSetSid)
                builder.Append(Native.OS.GitExecutable.Quoted()).Append(' ');
```

so the final argv string reads `setsid "/usr/bin/git" --no-pager -c … <Args>`. `TerminateProcess`
then signals the group (`Native/Linux.cs:190-211`, mirrored in `Native/MacOS.cs:143-170`):

```csharp
        public void TerminateProcess(Process proc)
        {
            if (kill(-proc.Id, 15) != 0)
            {
                // If the process already exited, we can just ignore the error.
                if (Marshal.GetLastPInvokeError() == 3 /* ESRCH */)
                    return;
                ...
                try
                {
                    proc.Kill(true);
                }
```

Signature note: **SIGTERM (15) only**, never SIGKILL — so Git gets the chance to clean up its own
lock files and index.lock. Windows instead attaches to the child's console and sends CTRL_C, with a
2 s grace before `Kill(true)` (`Native/Windows.cs:235-258`). macOS only gets process-group kills if
a `setsid` binary sits next to the app executable (`Native/MacOS.cs:23`, `:133-141`, built from
`tools/setsid-macos/setsid.c`); otherwise it falls back to `proc.Kill(true)`, which is .NET's
tree-kill but not group-based for detached grandchildren.

**Observed — no timeouts anywhere.** `grep -rn "Timeout|WaitForExit(" src/` finds no per-command
timeout; the only `WaitForExit(2000)` is the Windows terminate grace period. A Git command blocked
on a credential prompt or a network mount runs forever unless the user cancels it.

---

## 2. Parsing

**Observed — the framing inventory.** `grep -rn "Split('\\0')|%x00|%00" src/` returns exactly these
NUL-framed sites:

| Command                                    | Field separator               | Record separator           | `-z`?   |
| ------------------------------------------ | ----------------------------- | -------------------------- | ------- |
| `QueryCommits`                             | `%x00` (8 fields)             | `\n`                       | no      |
| `QuerySubmoduleRevision`                   | `%x00` (8 fields)             | `\0`                       | —       |
| `QueryPickableCommits`                     | `%x00` (8 fields)             | `\n`                       | no      |
| `QueryFileHistory`                         | `%x00` (5 fields)             | `\n`, `@`-prefixed records | no      |
| `QueryBranches`                            | `%00` (7 fields)              | `\n`                       | no      |
| `QueryTags`                                | `%00` (7 fields)              | GUID boundary string       | no      |
| `QueryStashes`                             | `%n` (newline)                | `\0` from `-z`             | **yes** |
| `QueryRefsContainsCommit`                  | `%(refname)` only             | `\n`                       | no      |
| `QueryRevisionObjects` (`ls-tree`)         | regex + rest-of-line          | `\n`                       | no      |
| `QueryLocalChanges` (`status --porcelain`) | regex `(.+)`                  | `\n`                       | no      |
| `Diff`                                     | header keywords               | `\n` (byte level)          | no      |
| `IsLFSFiltered`                            | `check-attr -z filter <path>` | `\0`                       | **yes** |

So `-z` is used only on the two commands whose _last_ field is never a path. **Every command whose
last field is a path is newline-framed and relies on `core.quotepath=off` plus the C-quote stripping
in `Change.Set`.** That is the crux of this section.

### 2.1 `git status` — two different commands, neither byte-safe

**Observed — the working-copy list** (`QueryLocalChanges.cs:14-28`):

```csharp
        public QueryLocalChanges(string repo, bool includeUntracked = true, bool noOptionalLocks = true)
        {
            WorkingDirectory = repo;
            Context = repo;

            var builder = new StringBuilder();
            if (noOptionalLocks)
                builder.Append("--no-optional-locks ");
            if (includeUntracked)
                builder.Append("-c core.untrackedCache=true -c status.showUntrackedFiles=all status -uall --ignore-submodules=dirty --porcelain");
            else
                builder.Append("status -uno --ignore-submodules=dirty --porcelain");

            Args = builder.ToString();
        }
```

**Observed** — `--porcelain` (v1, not v2), no `-z`, read with a line reader and a permissive regex
(`QueryLocalChanges.cs:11-12`, `:55-62`):

```csharp
        [GeneratedRegex(@"^(\s?[\w\?]{1,4})\s+(.+)$")]
        private static partial Regex REG_FORMAT();
```

```csharp
                while (await proc.StandardOutput.ReadLineAsync().ConfigureAwait(false) is { } line)
                {
                    var match = REG_FORMAT().Match(line);
                    if (!match.Success)
                        continue;

                    var change = new Models.Change() { Path = match.Groups[2].Value };
                    var status = match.Groups[1].Value;
```

The status characters are then expanded by a hand-written 30-case `switch` (`:64-178`) that
enumerates every legal XY pair, including the seven unmerged codes `DD AU UD UA DU AA UU`
mapped to `ConflictReason`. `??` maps to `Untracked` with `Index = None`. Anything not in the table
leaves both states `None` and is silently dropped by the guard at `:180-181`.

`--no-optional-locks` is chosen _adaptively_: the first query takes the index lock, repeat queries
do not (`ViewModels/Repository.cs:1306`,
`var noOptionalLocks = Interlocked.Add(ref _queryLocalChangesTimes, 1) > 1;`). **Inferred**: this
avoids fighting a concurrently running Git over `index.lock` on refresh storms, at the cost of
possibly reading a stale index.

**Observed — the repo header** uses porcelain **v2** and parses by _line index_
(`QueryRepositoryStatus.cs:20-50`):

```csharp
            Args = "status --porcelain=v2 -b -uall --ignore-submodules=dirty";
            var rs = await ReadToEndAsync().ConfigureAwait(false);
            if (!rs.IsSuccess)
                return null;

            var status = new Models.RepositoryStatus();
            var lines = rs.StdOut.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries);
            var count = lines.Length;
            if (count < 2)
                return null;

            var sha1 = lines[0].Substring(13).Trim(); // Remove "# branch.oid " prefix
            var head = lines[1].Substring(14).Trim(); // Remove "# branch.head " prefix
```

`lines[0]`, `lines[1]` and `lines[3]` are addressed positionally, with magic substring offsets and a
comment naming the prefix each offset corresponds to; `# branch.ab +N -M` is only consumed when it
happens to be line 3, otherwise the change count is `count - 3`.

**Inferred.** This is the most brittle parser in the file set: it depends on Git emitting exactly
`# branch.oid`, `# branch.head`, `# branch.upstream`, `# branch.ab` in that order — which Git does
today for `--porcelain=v2 -b`, but nothing in the code checks the prefix before slicing. Refyard
should parse the `# ` headers as `key value` pairs.

**Observed — the C-quote stripping.** Every path from a newline-framed command passes through
`Change.Set` (`Models/Change.cs:58-81`):

```csharp
        public void Set(ChangeState index, ChangeState workTree = ChangeState.None)
        {
            Index = index;
            WorkTree = workTree;

            if (index == ChangeState.Renamed || index == ChangeState.Copied || workTree == ChangeState.Renamed)
            {
                var parts = Path.Split('\t', 2);
                if (parts.Length < 2)
                    parts = Path.Split(" -> ", 2);
                if (parts.Length == 2)
                {
                    OriginalPath = parts[0];
                    Path = parts[1];
                }
            }

            if (Path[0] == '"')
                Path = Path.Substring(1, Path.Length - 2);

            if (!string.IsNullOrEmpty(OriginalPath) && OriginalPath[0] == '"')
                OriginalPath = OriginalPath.Substring(1, OriginalPath.Length - 2);
        }
```

**Inferred (three concrete defects, none of which Refyard may inherit).**

1. It removes the surrounding `"` but never C-unescapes `\"`, `\\`, `\t`, `\n`, `\r` or the octal
   `\NNN` forms. A path containing a double quote survives as `a\"b` instead of `a"b`.
2. Rename pairs are split on a literal TAB first, then on `" -> "`. Git's porcelain v1 rename form
   is `R  ORIG -> PATH` where each side is quoted **independently**; a path containing `->` as
   text (legal) or a tab (legal) mis-splits. It also strips at most one leading `"` per side, so a
   quoted-rename line `R  "a b" -> "c d"` ends with `Path == "c d"` — quote stripped — but only
   because `Substring(1, len-2)` happens to drop both quotes.
3. `Path.Substring(1, Path.Length - 2)` throws `ArgumentOutOfRangeException` when `Path` is the
   single character `"` (length 1 → length-2 = −1). A one-character filename consisting of a quote
   is refused by Git itself on some platforms, so this is a narrow but reachable crash path in a
   rename context.

The reason none of this bites in practice is `core.quotepath=off`: Git then only quotes when the
path contains `"`, `\`, or a control byte (`\t`, `\n`, …) — i.e. exactly the cases that are
mishandled. SourceGit has chosen the configuration that makes the common case work and left the
uncommon case broken.

### 2.2 `git log --format=…%x00…` — the workhorse

**Observed** (`QueryCommits.cs:11-17`):

```csharp
        public QueryCommits(string repo, string limits, bool markMerged = true)
        {
            WorkingDirectory = repo;
            Context = repo;
            Args = $"log --no-show-signature --decorate=full --format=%H%x00%P%x00%D%x00%aN±%aE%x00%at%x00%cN±%cE%x00%ct%x00%s {limits}";
            _markMerged = markMerged;
        }
```

and the consumer (`QueryCommits.cs:63-77`):

```csharp
                while (await proc.StandardOutput.ReadLineAsync().ConfigureAwait(false) is { } line)
                {
                    var parts = line.Split('\0');
                    if (parts.Length != 8)
                        continue;

                    var commit = new Models.Commit() { SHA = parts[0] };
                    commit.ParseParents(parts[1]);
                    commit.ParseDecorators(parts[2]);
                    commit.Author = Models.User.FindOrAdd(parts[3]);
                    commit.AuthorTime = ulong.Parse(parts[4]);
                    commit.Committer = Models.User.FindOrAdd(parts[5]);
                    commit.CommitterTime = ulong.Parse(parts[6]);
                    commit.Subject = parts[7];
```

Techniques worth copying:

- **NUL as the in-record separator, newline as the record separator.** NUL cannot appear in a
  commit header field, so `Split('\0')` with an exact field-count check is a cheap integrity test;
  the record delimiter stays `\n` so a streaming `ReadLineAsync` loop works without buffering the
  whole history. (`%s` is single-line by definition, so the last field cannot contain `\n`.)
- **A non-ASCII name/email joiner** (`±`, U+00B1) is used inside a field to keep the name and email
  in one NUL slot. **Inferred**: this is strictly worse than using two slots — a person name may
  legally contain `±`; and it forces a `Split('±', 2)`-style reparse downstream.
- **`--decorate=full` plus `%D`**, so the parser sees `refs/heads/main` rather than `main` and can
  decide the decorator type from the prefix instead of guessing (`Models/Commit.cs:63-117`:
  `tag: refs/tags/`, `HEAD -> refs/heads/`, `HEAD`, `refs/heads/`, `refs/remotes/`). `%D` is
  comma-separated and ref names may contain commas → the parser splits on `,` and therefore
  mis-handles a ref containing a comma. **Inferred**: this is the one place where the codebase
  relies on a separator Git does not guarantee.
- **`IsMerged` marking**: `HEAD -> refs/heads/…` or a bare `HEAD` decorator sets `IsMerged = true`
  during the scan (`Commit.cs:85`, `:94`), and if no decorated commit was found the code falls back
  to a second query, `log --since=@<lastCommitTime> --format=%H` over the current branch, marking
  the first hit (`QueryCommits.cs:85-99`, `QueryCurrentBranchCommitHashes.cs:13`).

`--no-show-signature` is applied on every `log`/`show` format command (`QueryCommits.cs:15`,
`QueryFileHistory.cs:23`, `QueryCommitFullMessage.cs:10`, `QueryStashes.cs:13`,
`QuerySubmoduleRevision.cs:27`) so GPG signature noise never mixes into a format string.

### 2.3 `git branch --format` with NUL fields

**Observed** (`QueryBranches.cs:14-19`):

```csharp
        public QueryBranches(string repo)
        {
            WorkingDirectory = repo;
            Context = repo;
            Args = "branch -l --all -v --format=\"%(refname)%00%(committerdate:unix)%00%(objectname)%00%(HEAD)%00%(upstream)%00%(upstream:trackshort)%00%(worktreepath)\"";
        }
```

parsed as one record per line with exactly seven NUL-separated fields (`:63-68`):

```csharp
        private Models.Branch ParseLine(string line, HashSet<string> mismatched)
        {
            var parts = line.Split('\0');
            if (parts.Length != 7)
                return null;
```

Note the deliberate use of **`%(HEAD)`** to get the current-branch marker (`branch.IsCurrent =
parts[3] == "*"`) instead of parsing the `*`/`+` gutter or the `(HEAD detached at …)` text;
`%(worktreepath)` is what lets the UI mark branches checked out in another worktree, and
`%(upstream:trackshort)` (`=`, `>`, `<`, `<>` or empty) is only used as a _hint_ to decide whether
a full `rev-list --left-right a...b` is worth running (`:108-112`, `QueryTrackStatus.cs:17-33`).
Detached HEAD is detected by matching the pseudo-refname text
`(HEAD detached at` / `(HEAD detached from` (`:11-12`, `:74-75`) — because `%(refname)` for a
detached HEAD literally returns that human-readable string, including the `HEAD` abbreviation
chosen by the user's `core.abbrev`.

### 2.4 Multi-line records: a GUID boundary string

**Observed** (`QueryTags.cs:12-16`, `:25-28`):

```csharp
            _boundary = $"----- BOUNDARY OF TAGS {Guid.NewGuid()} -----";

            Context = repo;
            WorkingDirectory = repo;
            Args = $"tag -l --format=\"{_boundary}%(refname)%00%(objecttype)%00%(objectname)%00%(*objectname)%00%(taggername)±%(taggeremail:trim)%00%(creatordate:unix)%00%(contents:subject)%0a%0a%(contents:body)\"";
```

```csharp
            var records = rs.StdOut.Split(_boundary, StringSplitOptions.RemoveEmptyEntries);
            foreach (var record in records)
            {
                var subs = record.Split('\0');
                if (subs.Length != 7)
                    continue;
```

`%B` / `%(contents:body)` are inherently multi-line. The choices are: (a) `-z`-frame the records and
accept that the message may contain NUL (it cannot), (b) emit a random boundary token and split on
it. SourceGit picks (b) for tags and `QueryCommitsForInteractiveRebase.cs:11`, and a raw `%n` for
stashes. **Inferred**: the GUID is generated per `Command` instance, so it is fresh per invocation —
sufficient, but strictly more machinery than `-z` plus a per-record length header would need.

`QueryStashes` is the only place where record framing is genuinely NUL-safe, and even there the
fields inside a record are newline-separated (`QueryStashes.cs:13`, `:23-31`):

```csharp
            Args = "stash list -z --no-show-signature --format=\"%H%n%P%n%ct%n%gd%n%B\"";
```

```csharp
            var items = rs.StdOut.Split('\0', StringSplitOptions.RemoveEmptyEntries);
            foreach (var item in items)
            {
                var current = new Models.Stash();

                var nextPartIdx = 0;
                var start = 0;
                var end = item.IndexOf('\n', start);
                while (end > 0 && nextPartIdx < 4)
```

so four fixed fields are walked by newline and the remainder (`(%B)`, which may contain newlines)
is taken as the message (`:61-62`). This "counted newline walk, then rest-of-record" shape is the
same trick `QueryCommitsForInteractiveRebase` uses with its boundary token.

### 2.5 Diff / numstat

**Observed — argv** (`Diff.cs:41-58`):

```csharp
            var builder = new StringBuilder(256);
            builder.Append("diff --no-color --no-ext-diff --full-index --patch ");
            if (ignoreWhitespace)
                builder.Append("--ignore-space-change --ignore-blank-lines ");
            if (ignoreCRAtEOL)
                builder.Append("--ignore-cr-at-eol ");
            builder.Append("--unified=").Append(numContextLines).Append(' ');
            builder.Append(opt.ToString());

            Args = builder.ToString();
```

and the revision/path operands come from `DiffOption.ToString()` (`Models/DiffOption.cs:133-150`),
which is where the interesting operand forms live:

```csharp
        public override string ToString()
        {
            var builder = new StringBuilder();
            if (!string.IsNullOrEmpty(_extra))
                builder.Append($"{_extra} ");
            foreach (var r in _revisions)
                builder.Append($"{r} ");

            if (_ignorePaths)
                return builder.ToString();

            builder.Append("-- ");
            if (!string.IsNullOrEmpty(_orgPath))
                builder.Append($"{_orgPath.Quoted()} ");
            builder.Append(_path.Quoted());

            return builder.ToString();
        }
```

`_extra` is `--no-index` for an untracked file compared against `/dev/null`, `--cached` for a staged
change, or `--cached <parent>` for amending (`DiffOption.cs:26-43`); `_revisions` is `["<old>", "<new>"]`
or the blob form `"<sha>:<quoted path>"` when the two sides are different files
(`DiffOption.cs:73-74`, `:102-103`). `_ignorePaths` suppresses the trailing `-- <paths>` when the
revisions already name the blobs.

**Observed — the header heuristic stack** (`Diff.cs:172-191`, `:255-282`): keyword prefixes
`diff `, `old mode `, `new mode `, `deleted file mode `, `new file mode `, `Binary files `,
`Subproject commit `, `\ No newline at end of file`; plus two regexes:

```csharp
        [GeneratedRegex(@"^@@ \-(\d+),?\d* \+(\d+),?\d* @@")]
        private static partial Regex REG_INDICATOR();

        [GeneratedRegex(@"^index\s([0-9a-f]{6,64})\.\.([0-9a-f]{6,64})(\s[1-9]{6})?")]
        private static partial Regex REG_HASH_CHANGE();
```

`{6,64}` on both sides of `..` is the SHA-1/SHA-256 accommodation; the mode group is `[1-9]{6}`
(i.e. only modes that do not start with 0 — correct for `100644`, `100755`, `120000`, `160000`).

The chunk-body parser makes one **inverted-priority** decision that is worth understanding
(`Diff.cs:143-170`):

```csharp
            // If we are reading a chunk-body, try to read the current line as chunk-body first (because
            // there are usually more chunk-body lines than chunk-indicator lines).
            if (_isInChunk)
            {
                if (ParseChunkBodyLine(line, lineBytes))
                    return;

                ProcessInlineHighlights();
                _isInChunk = false;
            }
```

Because an added line in the _file content_ can itself begin with `@@ `, `+++ `, `diff ` or
`Binary files `, the parser **stays in chunk-body mode until a line fails the body test** (prefix is
not one of ` `, `-`, `+`, `\`) rather than trusting the first character of a line. That is the right
shape for a line-oriented patch parser and applies directly to Refyard's patch parser. Subtleties it
handles: `_last.NoNewLineEndOfFile` is attached to the _previous_ line (`:245-250`), and `\` is a
body prefix so `\ No newline at end of file` never ends a chunk.

**Observed — binary detection via numstat** (`IsBinary.cs:11-23`):

```csharp
            Args = $"diff --no-color --no-ext-diff --numstat {Models.EmptyTreeHash.Guess(revision)} {revision} -- {path.Quoted()}";
            RaiseError = false;
        }

        public async Task<bool> GetResultAsync()
        {
            var rs = await ReadToEndAsync().ConfigureAwait(false);
            return REG_TEST().IsMatch(rs.StdOut.Trim());
        }

        [GeneratedRegex(@"^\-\s+\-\s+.*$")]
```

i.e. `git diff --numstat` against the empty tree, matching `-\t-\t<path>` for "binary". The empty
tree OID is guessed from the length of the revision string
(`Models/EmptyTreeHash.cs:5-13`): `revision.Length == 40 ? SHA1 : SHA256`. **Inferred**: for a
short SHA or a ref name (`HEAD`) this guess silently picks the SHA-256 empty tree. It is only
correct when `rev-parse` output was fed in.

### 2.6 `ls-tree` — no `-z`, regex, rest-of-line path

**Observed** (`QueryRevisionObjects.cs:11-25`, `:37-47`):

```csharp
        [GeneratedRegex(@"^\d+\s+(\w+)\s+([0-9a-f]+)\s+(.*)$")]
```

```csharp
            builder.Append("ls-tree ").Append(sha);
            if (!string.IsNullOrEmpty(parentFolder))
                builder.Append(" -- ").Append(parentFolder.Quoted());
```

```csharp
                while (await proc.StandardOutput.ReadLineAsync().ConfigureAwait(false) is { } line)
                {
                    var match = REG_FORMAT().Match(line);
                    if (!match.Success)
                        continue;

                    var obj = new Models.Object();
                    obj.SHA = match.Groups[2].Value;
```

`(.*)$` takes the entire remainder as the path — correct for spaces and tabs, but the path is still
subject to Git's C-quoting (there is no `-z`), so a path containing `"` or `\` arrives escaped and is
stored escaped. Also note `[0-9a-f]+` for the object id: works for SHA-1 and SHA-256, but is not
length-validated.

### 2.7 `for-each-ref`

**Observed** (`QueryRefsContainsCommit.cs:10-13`):

```csharp
            RaiseError = false;
            Args = $"for-each-ref --format=\"%(refname)\" --contains {commit}";
```

`--contains` means `refs/heads/*` and `refs/tags/*`; the parse is a newline split plus prefix tests,
and `<ref>/HEAD` entries are skipped (`:20-22`). This is the only `for-each-ref` call in the
codebase; branches and tags get their own porcelain-ish commands (`branch --format`, `tag -l --format`)
rather than one `for-each-ref`. **Inferred**: that is a UI concern (it wants `%(upstream)` and
`%(HEAD)`) rather than a capability gap, but for Refyard a single `for-each-ref` with a
`%00`-separated format plus `-z` would cover the same ground in one call.

---

## 3. Worktree and submodule

### 3.1 Worktree list

**Observed** (`Worktree.cs:16-34`):

```csharp
        public async Task<List<Models.Worktree>> ReadAllAsync()
        {
            Args = "worktree list --porcelain";

            var rs = await ReadToEndAsync().ConfigureAwait(false);
            var worktrees = new List<Models.Worktree>();
            Models.Worktree last = null;
            if (rs.IsSuccess)
            {
                var lines = rs.StdOut.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries);
                foreach (var line in lines)
                {
                    if (line.StartsWith("worktree ", StringComparison.Ordinal))
                    {
                        last = new Models.Worktree() { FullPath = line.Substring(9).Trim() };
```

`worktree list --porcelain` is a **stanza format** (blank-line separated, `key value` per line), and
the parser does track the per-stanza object — but it drops the blank-line semantics and relies on
"a `worktree ` line starts a new record". Recognized keys: `bare`, `HEAD `, `branch `, `detached`,
`locked` (`:38-57`). `locked` carries an optional reason after the keyword, which is ignored.
`FullPath` is `.Trim()`-ed (`:30`) and `HEAD`/`branch` values are `.Trim()`-ed too (`:44`, `:48`).
There is **no `-z`** and no `--porcelain=v2`; a worktree path containing a newline breaks the
stanza parse. **Inferred (bug class, low severity)**: `.Trim()` on a path strips meaningful
leading/trailing whitespace from worktree paths, and would strip it from a `HEAD` value too.

Merge-readiness logic that turns the raw list into UI models lives in `ViewModels/Worktree.cs:23-53`
(first entry is the main worktree, `IsCurrent` by canonical-path equality, `IsLocked` carried
through) — a pure function worth mirroring in Refyard's DTO mapping layer.

### 3.2 Worktree create / remove

**Observed** (`Worktree.cs:64-109`):

```csharp
        public async Task<bool> AddAsync(string fullpath, string name, bool createNew, string tracking)
        {
            var builder = new StringBuilder(1024);
            builder.Append("worktree add ");
            if (!string.IsNullOrEmpty(tracking))
                builder.Append("--track ");
            if (!string.IsNullOrEmpty(name))
                builder.Append(createNew ? "-b " : "-B ").Append(name).Append(' ');
            builder.Append(fullpath.Quoted()).Append(' ');

            if (!string.IsNullOrEmpty(tracking))
                builder.Append(tracking);
            else if (!string.IsNullOrEmpty(name) && !createNew)
                builder.Append(name);

            Args = builder.ToString();
            return await ExecAsync().ConfigureAwait(false);
        }

        public async Task<bool> PruneAsync()
        {
            Args = "worktree prune -v";
            return await ExecAsync().ConfigureAwait(false);
        }

        public async Task<bool> LockAsync(string fullpath)
        {
            Args = $"worktree lock {fullpath.Quoted()}";
            return await ExecAsync().ConfigureAwait(false);
        }

        public async Task<bool> UnlockAsync(string fullpath)
        {
            Args = $"worktree unlock {fullpath.Quoted()}";
            return await ExecAsync().ConfigureAwait(false);
        }

        public async Task<bool> RemoveAsync(string fullpath, bool force)
        {
            if (force)
                Args = $"worktree remove -f {fullpath.Quoted()}";
            else
                Args = $"worktree remove {fullpath.Quoted()}";

            return await ExecAsync().ConfigureAwait(false);
        }
```

Note `-B` vs `-b` is driven by `createNew` (reset an existing branch vs create a new one), and that
the _branch name_ is passed raw (not quoted) whereas the path is quoted. **Observed** preconditions
for creation are validated in the UI model before any command runs
(`ViewModels/AddWorktree.cs:94-116`):

```csharp
            var fullPath = System.IO.Path.IsPathRooted(path) ? path : System.IO.Path.Combine(creator._repo.FullPath, path);
            var info = new DirectoryInfo(fullPath);
            if (info.Exists)
            {
                var files = info.GetFiles();
                if (files.Length > 0)
                    return new ValidationResult("Given path is not empty!!!");
                var folders = info.GetDirectories();
                if (folders.Length > 0)
                    return new ValidationResult("Given path is not empty!!!");
            }
```

So: target must be empty/absent, checked with a plain filesystem stat — **not** "is it inside another
worktree", "is it a subdirectory of the main worktree", or "does a branch of that name already exist
elsewhere". Creation defaults to _not_ forcing, so `git worktree add` itself is the final gate.

**Observed — removal preconditions.** `ViewModels/RemoveWorktree.cs:9-36`: the popup exposes a
`Force` boolean defaulting to `false`; `Sure()` takes `_repo.LockWatcher()` (which bumps the
filesystem watcher's `_lockCount` so refreshes are suppressed, `Watcher.cs:11-21`, `:95-98`,
`:139-142`), runs `worktree remove [-f]`, and completes the log. There is no verification that the
worktree is clean, no backup, no check that the target is not the one the user is looking at. The
only protection is Git's own refusal of a dirty worktree, and the UI's "are you sure" dialog.
**Inferred**: for Refyard's `removeWorktree`, this is exactly the pattern the safety rules forbid —
the backup-then-fail-closed requirement has no analogue here.

### 3.3 Submodule list — three Git calls to build one list

**Observed** (`QuerySubmodules.cs:11-22`):

```csharp
        [GeneratedRegex(@"^([U\-\+ ])([0-9a-f]+)\s(.*?)(\s\(.*\))?$")]
        private static partial Regex REG_FORMAT_STATUS();
        [GeneratedRegex(@"^\s?[\w\?]{1,4}\s+(.+)$")]
        private static partial Regex REG_FORMAT_DIRTY();
        [GeneratedRegex(@"^submodule\.(\S*)\.(\w+)=(.*)$")]
        private static partial Regex REG_FORMAT_MODULE_INFO();
```

```csharp
        public QuerySubmodules(string repo)
        {
            WorkingDirectory = repo;
            Context = repo;
            Args = "submodule status";
        }
```

Sequence:

1. `submodule status` → the leading status char selects `NotInited` (`-`), `RevisionChanged` (`+`),
   `Unmerged` (`U`) or `Normal` (space); the SHA is captured as `[0-9a-f]+` (works for both object
   formats) and the path as a **non-greedy** `(.*?)` so a trailing `" (describe text)"` is dropped
   (`:42-61`). Only `Normal` modules set `needCheckLocalChanges` (`:53-57`).
2. `config --file .gitmodules --list` → url/branch/path per module, keyed by name, with a fallback
   that matches a "name" that is actually a path (`:65-119`). The regex's `(\S*)` for the module
   name means a name containing whitespace cannot be parsed.
3. If any module was `Normal`, one `--no-optional-locks status --porcelain -- <quoted paths>` over
   _just those modules_, upgrading them to `Modified` if they appear (`:122-147`).

The dirty probe is the pattern to copy: it is one extra Git call, it is scoped with `--`, and it is
skipped entirely when every module was already known-dirty from `submodule status`.

### 3.4 Submodule mutation

**Observed** (`Submodule.cs:15-78`):

```csharp
            Args = $"-c protocol.file.allow=always submodule add {url.Quoted()} {relativePath.Quoted()}";
            var succ = await ExecAsync().ConfigureAwait(false);
            if (!succ)
                return false;

            if (recursive)
                Args = $"submodule update --init --recursive -- {relativePath.Quoted()}";
            else
                Args = $"submodule update --init -- {relativePath.Quoted()}";
```

```csharp
            Args = force ? $"submodule deinit -f -- {module.Quoted()}" : $"submodule deinit -- {module.Quoted()}";
```

```csharp
        public async Task<bool> DeleteAsync(string module)
        {
            Args = $"rm -rf {module.Quoted()}";
            return await ExecAsync().ConfigureAwait(false);
        }
```

- `-c protocol.file.allow=always` is passed **only** for `submodule add` — required since Git 2.38's
  file-protocol restriction when adding a submodule from a local path (`GitVersions.cs` records the
  version floors the app checks: `MINIMAL = 2.25.1`, `TESTING_MERGE = 2.38`, `REPLAY = 2.44`).
- `submodule update` is always `-- <path>`-scoped and takes the module list explicitly; the auto-update
  path runs it after a checkout, gated by a confirmation dialog and two settings
  (`ViewModels/Repository.cs:1491-1517`).
- `DeleteAsync` is literally `git rm -rf <path>` with **no repository-state checks whatsoever**;
  `ViewModels/DeleteSubmodule.cs:25-33` only takes the watcher lock and runs it. No `deinit`, no
  `.gitmodules` cleanup check, no worktree-clean check, no backup.
- `SetBranchAsync` uses `submodule set-branch -b <branch> -- <path>` and `-d` to unset
  (`Submodule.cs:36-44`); `SetURLAsync` uses `submodule set-url -- <path> <url>`.

**Inferred.** `submodule add` is the _only_ place a `-c` option is injected by a caller rather than
by the shared prefix, and it is injected at the front of `Args` — which lands _after_ the global
prefix (`--no-pager -c core.quotepath=off -c credential.helper=…`), so the final argv is
`git --no-pager -c … -c protocol.file.allow=always submodule add …`. That ordering is correct; a
planner in Refyard must reproduce it (global `-c` options first, subcommand last).

---

## 4. Stash

### 4.1 Reading the list

**Observed** (`QueryStashes.cs:9-14`): the list is read from **`git stash list`**, not from the
reflog:

```csharp
        public QueryStashes(string repo)
        {
            WorkingDirectory = repo;
            Context = repo;
            Args = "stash list -z --no-show-signature --format=\"%H%n%P%n%ct%n%gd%n%B\"";
        }
```

Field order: `%H` full commit id, `%P` parents, `%ct` committer unix time, `%gd` the **reflog
selector** (`stash@{0}`), `%B` the raw body (first line is `WIP on <branch>: …` or the `-m` message).
Records are NUL-separated thanks to `-z`, fields inside a record are newline-separated, and the
message is "the rest" (`:23-31`, `:61-62`, quoted in 2.4). `Models/Stash.cs` derives two things from
this: `Subject => Message.Split('\n', 2)[0].Trim()` and
`UntrackedParent => EmptyTreeHash.Guess(SHA)`, the latter used to diff a stash that contains
untracked files (stashes have 3+ parents: HEAD, index, and an untracked-files commit).

### 4.2 Targeting apply / pop / drop

**Observed** (`Stash.cs:72-95`):

```csharp
        public async Task<bool> ApplyAsync(string name, bool restoreIndex)
        {
            var opts = restoreIndex ? "--index" : string.Empty;
            Args = $"stash apply -q {opts} {name.Quoted()}";
            return await ExecAsync().ConfigureAwait(false);
        }

        public async Task<bool> CheckoutBranchAsync(string name, string branch)
        {
            Args = $"stash branch {branch.Quoted()} {name.Quoted()}";
            return await ExecAsync().ConfigureAwait(false);
        }

        public async Task<bool> PopAsync(string name)
        {
            Args = $"stash pop -q --index {name.Quoted()}";
            return await ExecAsync().ConfigureAwait(false);
        }

        public async Task<bool> DropAsync(string name)
        {
            Args = $"stash drop -q {name.Quoted()}";
            return await ExecAsync().ConfigureAwait(false);
        }
```

The callers pass `Stash.Name`, i.e. **the `%gd` selector string** — not the SHA:

- `ViewModels/DropStash.cs:23-25`: `.DropAsync(Stash.Name)`.
- `ViewModels/ApplyStash.cs:39-51`: `.ApplyAsync(Stash.Name, RestoreIndex)` and, when
  `DropAfterApply` is set, `.DropAsync(Stash.Name)` **using the same selector again after the
  apply**.
- `ViewModels/ClearStashes.cs:20-22`: `stash clear`.

The only place a literal selector appears is the app's own auto-stash, which pops `stash@{0}`
because it just pushed it in the same operation (`ViewModels/Checkout.cs:68-97`,
`ViewModels/Pull.cs:135`/`:170`).

**Observed** guarantees that pop/drop hit the intended entry:

1. The UI list is refreshed from `stash list` after every operation
   (`_repo.MarkStashesDirtyManually()`, e.g. `DropStash.cs:28`), and the stash page's selection is
   an object from that list (`ViewModels/StashesPage.cs:147-159`).
2. `Repo.LockWatcher()` is taken for the duration of the pop/drop
   (`DropStash.cs:17`, `ApplyStash.cs:33`) so the app's filesystem watcher does not interleave a
   refresh.
3. `stash pop -q --index` restores the index as well, i.e. the _default_ is the non-lossy variant.

**Inferred — the identity gap.** There is **no re-verification between listing and acting**:
`stash@{N}` is an index into a stack that any external `git stash` (or a run of the app's own
auto-stash paths, which are not guarded by the same lock) can shift. The parsed SHA is available in
`Models.Stash.SHA` but is never used for any operand.

How much of that is fixable was checked against the Git documentation rather than assumed, and the
answer is **not uniform** (git-scm.com `git-stash`, retrieved 2026-09-14):

| Command                    | Documented `<stash>` operand                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stash apply`              | "Unlike pop, `<stash>` may be any commit that looks like a commit created by stash push or stash create."                                                                                      |
| `stash pop` / `stash drop` | "A reference of the form `stash@{<revision>}`. When no `<stash>` is given, the latest stash is assumed (that is, `stash@{0}`)." — plus the note that a bare integer `<n>` equals `stash@{<n>}` |

So binding `apply` to the listed SHA is documented behavior; binding `pop`/`drop` to a raw commit id
is **not** documented, even if some Git versions resolve it. A stale-proof design therefore has to
either (a) capture the reflog entry's SHA in the preview token, re-run `stash list -z`, and refuse if
the entry at `stash@{N}` no longer has that SHA, or (b) drop by index only after that comparison
succeeds. Refyard must not present option (c) "just pass the SHA to `stash drop`" as portable.

Two more observations from the same code: no backup is made before `drop` (SourceGit's rule for
destructive operations in general is "ask the user", not "save what can be lost"), and in the
`DropAfterApply` path the drop is gated on the apply's success
(`ApplyStash.cs:43` `if (succ) { … }`) but the **drop's own exit status is discarded** — line 49-51
awaits `DropAsync` without binding the result, then calls `_repo.MarkStashesDirtyManually()` and
returns `true` regardless. A failed drop is therefore reported to the UI as a successful
"apply and drop", with the stash still present.

---

## 5. Commit graph

`Models/CommitGraph.cs:74-269` is the whole algorithm. It is a **row-by-row, greedy lane sweep over
an already-ordered commit list**; there is no revision walking, no parents-before-children pass and
no sorting — it consumes the output of `git log --date-order` (or `--topo-order`) directly.

### 5.1 Constants and state

**Observed** (`CommitGraph.cs:76-88`):

```csharp
            const double unitWidth = 12;
            const double halfWidth = 6;
            const double unitHeight = 1;
            const double halfHeight = 0.5;

            var temp = new CommitGraph();
            var unsolved = new List<PathHelper>();
            var ended = new List<PathHelper>();
            var offsetY = -halfHeight;
            var colorPicker = new ColorPicker();
            var defHighlighting = highlighting == CommitGraphHighlighting.All;

            foreach (var commit in commits)
```

- **Lane state is a list of "unsolved paths"** (`PathHelper`), one per open lane, kept in left-to-right
  lane order. Each holds `Next` (the commit SHA that lane is _waiting to reach_), `Path` (the points,
  color and highlight flag), `LastX` (its current lane x) and the last emitted y. The list index is
  effectively the lane slot, but the code never uses the index for drawing — only the live order.
- Rows are one unit tall; y is counted in rows, not pixels (`unitHeight = 1`, `halfHeight = 0.5`).
  The caller multiplies by the row height at render time (`Views/CommitGraph.cs:79-80`).
- x is counted in units of 12, with lane centres at `offsetX` where the first lane slot starts at
  `4 - halfWidth = -2` and is advanced by `unitWidth` before use — so the first real lane centre is
  at x = 10.

### 5.2 The per-commit loop

**Observed** (`CommitGraph.cs:90-142`):

```csharp
            foreach (var commit in commits)
            {
                PathHelper major = null;

                // Update current y offset
                offsetY += unitHeight;

                // Find first curves that links to this commit and marks others that links to this commit ended.
                var offsetX = 4 - halfWidth;
                var maxOffsetOld = unsolved.Count > 0 ? unsolved[^1].LastX : offsetX + unitWidth;
                var isHighlighted = defHighlighting;
                foreach (var l in unsolved)
                {
                    if (l.Next.Equals(commit.SHA, StringComparison.Ordinal))
                    {
                        if (major == null)
                        {
                            offsetX += unitWidth;
                            major = l;
                            isHighlighted = major.IsHighlighted;

                            if (commit.Parents.Count > 0)
                            {
                                major.Next = commit.Parents[0];
                                major.Goto(offsetX, offsetY, halfHeight);
                            }
                            else
                            {
                                major.End(offsetX, offsetY, halfHeight);
                                ended.Add(l);
                            }
                        }
                        else
                        {
                            l.End(major.LastX, offsetY, halfHeight);
                            ended.Add(l);

                            if (!isHighlighted && l.IsHighlighted)
                                isHighlighted = true;
                        }
                    }
                    else
                    {
                        offsetX += unitWidth;
                        l.Pass(offsetX, offsetY, halfHeight);
                    }
                }

                // Remove ended curves from unsolved
                foreach (var l in ended)
                {
                    colorPicker.Recycle(l.Path.Color);
                    unsolved.Remove(l);
                }
                ended.Clear();
```

This is the heart of it, and it has three behaviors worth naming precisely:

- **Compaction.** Every pass through a row _resets_ `offsetX` to the left edge and re-assigns each
  open lane a slot in list order. A lane whose slot is vacated by a closed lane automatically shifts
  left on the next row, because `offsetX` restarts. There is no explicit "shift left" logic and no
  lane index stored on the path — position is recomputed from list position every row.
- **`Pass` vs `Goto` vs `End`.** A lane that does not touch this commit calls `Pass` (a vertical
  segment, possibly with an elbow); the _first_ lane whose `Next` matches the commit calls `Goto`
  (it continues through the commit, adopting `Parents[0]` as its next target); **any further** lane
  whose `Next` also matches calls `End(major.LastX, …)` — it terminates horizontally into the
  winner's lane. That is how two lanes that both awaited this commit (a fork merging back, or a
  duplicate-parent case) collapse into one. The `unsolved.Remove` loop is O(n²) in lanes but lanes
  are few.
- **First-match-wins.** The lane that becomes `major` is the leftmost lane awaiting this commit,
  and it _keeps_ its color (`Path.Color` is fixed for the lifetime of the Path object). The
  consuming lane is therefore always the leftmost, which keeps long-lived branch lanes stable.

### 5.3 New lanes, dots, and extra parents

**Observed** (`CommitGraph.cs:179-208`):

```csharp
                // If no path found, create new curve for branch head
                // Otherwise, create new curve for new merged commit
                if (major == null)
                {
                    offsetX += unitWidth;

                    if (commit.Parents.Count > 0)
                    {
                        major = new PathHelper(commit.Parents[0], isHighlighted, colorPicker.Next(), new Point(offsetX, offsetY));
                        unsolved.Add(major);
                        temp.Paths.Add(major.Path);
                    }
                }
                else if (isHighlighted && !major.IsHighlighted && commit.Parents.Count > 0)
                {
                    major.Highlight();
                    temp.Paths.Add(major.Path);
                }

                // Calculate link position of this commit.
                var position = new Point(major?.LastX ?? offsetX, offsetY);
                var dotColor = major?.Path.Color ?? 0;
                var anchor = new Dot() { Center = position, Color = dotColor, IsHighlighted = isHighlighted };
                if (commit.IsCurrentHead)
                    anchor.Type = DotType.Head;
                else if (commit.Parents.Count > 1)
                    anchor.Type = DotType.Merge;
                else
                    anchor.Type = DotType.Default;
                temp.Dots.Add(anchor);
```

- No lane matched ⇒ this commit is a **root of the loaded window** (a branch tip). If it has parents,
  a brand-new lane is appended at the far right with `Next = Parents[0]` and a fresh color; if it has
  none, `major` stays null and the dot is drawn at the _current_ `offsetX` (the position just past
  all lanes) with color 0 — i.e. a parentless commit at the edge of the window has no lane at all,
  only a dot. Note the parent-less-with-no-lane case still leaves `offsetX` advanced by one unit.
- The dot is always placed at `major.LastX` (the lane that "carries" this commit), so a commit is
  drawn on its own lane even when that lane just moved.
- `commit.Color = dotColor` and `commit.LeftMargin = Math.Max(offsetX, maxOffsetOld) + halfWidth + 2`
  (`:250-252`) are written back onto the **commit model**, which is how the list rows leave room for
  the graph gutter (`Views/Histories.axaml:115` binds `LeftMargin` through a converter). The layout
  result is therefore partly returned by mutation, not only via the `CommitGraph` object.

**Observed — merge parents** (`CommitGraph.cs:210-248`):

```csharp
                // Deal with other parents (the first parent has been processed)
                if (!firstParentOnlyEnabled)
                {
                    if (highlighting == CommitGraphHighlighting.SelectedCommitsOnlyFirstParent)
                        isHighlighted = false;

                    for (int j = 1; j < commit.Parents.Count; j++)
                    {
                        var parentHash = commit.Parents[j];
                        var parent = unsolved.Find(x => x.Next.Equals(parentHash, StringComparison.Ordinal));
                        if (parent != null)
                        {
                            ...
                            temp.Links.Add(new Link
                            {
                                Start = position,
                                End = new Point(parent.LastX, offsetY + halfHeight),
                                Control = new Point(parent.LastX, position.Y),
                                Color = parent.Path.Color,
                                IsHighlighted = isHighlighted,
                            });
                        }
                        else
                        {
                            offsetX += unitWidth;

                            // Create new curve for parent commit that not includes before
                            var l = new PathHelper(parentHash, isHighlighted, colorPicker.Next(), position, new Point(offsetX, position.Y + halfHeight));
                            unsolved.Add(l);
                            temp.Paths.Add(l.Path);
                        }
                    }
                }
```

Two distinct outputs come out of this:

- **If a lane already awaits parent _j_** (i.e. another branch also descends from it), a `Link` is
  emitted: a single quadratic Bézier `Start = dot`, `Control = (targetLastX, dot.y)`,
  `End = (targetLastX, dot.y + 0.5)` — the classic "merge curve" dropping half a row into the other
  lane. Color is taken from the **target** lane, not the merging one.
- **If no lane awaits it**, a new lane is created _starting at the dot position_ with a two-point
  path (dot → `(newOffsetX, dot.y + 0.5)`) and appended to `unsolved`. No `Link` is emitted for this
  case; the curve comes from the path's own points.

`--first-parent` is not a Git-side option here: when the user enables "first parent only", the flags
list is passed to `git log` (`RepositoryUIStates.cs:415-416`) **and** the graph's `firstParentOnlyEnabled`
argument suppresses this extra-parents loop (`:211`). Both must stay in sync, or the graph will
allocate lanes for parents that are not in the list.

### 5.4 Closing out the window (the pagination story)

**Observed** (`CommitGraph.cs:255-266`):

```csharp
            // Deal with curves haven't ended yet.
            for (var i = 0; i < unsolved.Count; i++)
            {
                var path = unsolved[i];
                var endY = (commits.Count - 0.5) * unitHeight;

                if (path.Path.Points.Count == 1 && Math.Abs(path.Path.Points[0].Y - endY) < 0.0001)
                    continue;

                path.End((i + 0.5) * unitWidth + 4, endY + halfHeight, halfHeight);
            }
            unsolved.Clear();
```

Every lane still open when the list runs out is drawn down to the last row and stopped — **there is
no continuation marker and no notion of "history continues below"**. Combined with the call site
(`ViewModels/Repository.cs:1198-1202`):

```csharp
                var builder = new StringBuilder();
                builder
                    .Append('-').Append(Preferences.Instance.MaxHistoryCommits).Append(' ')
                    .Append(_uiStates.BuildHistoryParams(GitDir));
```

(note the single-dash `-N` form of `--max-count`) this means:

- **There is no incremental pagination.** The window is fixed at
  `Preferences.MaxHistoryCommits` (a user setting, `ViewModels/Preferences.cs:132-136`) and the graph
  is recomputed from scratch for the whole list on every refresh
  (`ViewModels/Histories.cs:577`: `Graph = Models.CommitGraph.Generate(commits, firstParentOnly, highlighting, extraHeads);`).
- Because the same `-N` prefix of the same walk order is requested each time, the commit list is a
  prefix of the previous one when nothing changed, so lane assignment is stable _given unchanged
  input_ — but it is **not** incremental: appending 200 more commits changes the tail of the list
  and can legally change lane colors and lane ordering in the already-rendered region. Nothing in
  the code preserves earlier output.
- Color assignment is order-dependent, from a recycling FIFO (`CommitGraph.cs:271-291`):

```csharp
        private class ColorPicker
        {
            public int Next()
            {
                if (_colorsQueue.Count == 0)
                {
                    for (var i = 0; i < s_penCount; i++)
                        _colorsQueue.Enqueue(i);
                }

                return _colorsQueue.Dequeue();
            }

            public void Recycle(int idx)
            {
                if (!_colorsQueue.Contains(idx))
                    _colorsQueue.Enqueue(idx);
            }

            private Queue<int> _colorsQueue = new Queue<int>();
        }
```

with `s_defaultPenColors` = ten named colors (`:423-434`). `Recycle` refuses to enqueue an index
already in the queue, so a color can only be in flight once.

### 5.5 Geometry primitives (the part that is easy to get wrong)

**Observed** (`CommitGraph.cs:293-420`): `PathHelper` owns three mutators, each of which appends
points and updates `LastX`/`_lastY`:

- `Pass(x, y, halfHeight)` — the lane did not touch this row:
  ```csharp
            public void Pass(double x, double y, double halfHeight)
            {
                if (x > LastX)
                {
                    Add(LastX, _lastY);
                    Add(x, y - halfHeight);
                }
                else if (x < LastX)
                {
                    Add(LastX, y - halfHeight);
                    y += halfHeight;
                    Add(x, y);
                }

                LastX = x;
                _lastY = y;
            }
  ```
  The `x < LastX` case is the only place `halfHeight` is added back into `_lastY`: a lane moving
  _left_ emits its elbow at `y - 0.5` and then continues from `y + 0.5`, so the subsequent segment
  is drawn from below the row centre. A lane moving _right_ emits the vertical at the old x up to
  `y - 0.5` and the diagonal from there.
- `Goto(x, y, halfHeight)` — the lane _does_ carry this commit: same shape, except the leftward case
  subtracts a further `halfHeight` when `y - halfHeight > _lastY`, and the final point is `(x, y)`
  (the commit's own row centre) rather than `(x, y + 0.5)`.
- `End(x, y, halfHeight)` — the lane dies here: it appends `(x, y - halfHeight)` on the way, then
  always `Add(x, y)`. Used both by "another lane matched this commit" (x = the winner's x) and by
  the window-end sweep (x = the lane's own current x).
- `Add(x, y)` refuses to append unless `y > _endY`, and updates `_endY`. This monotone-y invariant is
  what makes the sequence of `Pass`/`Goto`/`End` calls safe regardless of order, and it is the single
  most important rule to port: **points must be appended in strictly increasing y**.
- `Highlight()` closes the current `Path` and opens a new one at the same point with the same color
  but `IsHighlighted = true`, appending the new `Path` to the graph in the caller. That is how a
  highlight can begin mid-lane without recoloring the whole ancestry.

Rendering matches the geometry 1:1: `Link`s are drawn as `QuadraticBezierTo(Control, End)`
(`Views/CommitGraph.cs:87-95`), `Path` point sequences as segments with `QuadraticBezierTo` for
rightward moves and `CubicBezierTo` for leftward moves (`:137-152`), y multiplied by the row height
and the visible range clipped + binary-search-free early exit (`if (endY < top) continue;` /
`if (last.Y > bottom) break;`).

### 5.6 Algorithm to reimplement in TypeScript

Inputs required per commit: `sha`, `parents` (first parent first), `isCurrentHead`, and the ordering
from `git log --date-order|--topo-order` limited by `-N`. Output per row: the y offset, the dot
(x, color, kind), the list of curve segments (either `path` point sequences or `link` start/control/end),
and a per-row `leftMargin` (the gutter width).

```
const UNIT_W = 12, HALF_W = 6, HALF_H = 0.5
unsolved: Path[] = []            // lane order matters; index is not stored
colorQueue: FIFO<number>         // refilled from [0..9] when empty
y = -HALF_H

for each commit:
  y += 1
  x = -HALF_W                    // note: 4 - HALF_W
  maxXOld = unsolved.length ? unsolved[last].lastX : x + UNIT_W
  major = null

  for l in unsolved (in order):
    if l.next == commit.sha:
      if major == null:
        x += UNIT_W
        major = l
        if commit.parents.length > 0: l.next = commit.parents[0]; l.goto(x, y)
        else:                         l.end(x, y); ended.push(l)
      else:
        l.end(major.lastX, y); ended.push(l)
    else:
      x += UNIT_W
      l.pass(x, y)

  for l in ended: colorQueue.recycle(l.color); unsolved.remove(l)

  if major == null:
    x += UNIT_W
    if commit.parents.length > 0:
      major = new Path(next = commit.parents[0], color = colorQueue.next(), start = (x, y))
      unsolved.push(major); paths.push(major)

  dot = { x: major?.lastX ?? x, y, color: major?.color ?? 0,
          kind: commit.isCurrentHead ? HEAD : commit.parents.length > 1 ? MERGE : DEFAULT }

  if not firstParentOnly:
    for j in 1..commit.parents.length-1:
      target = unsolved.find(p => p.next == commit.parents[j])
      if target: links.push({ start: dot, control: (target.lastX, y), end: (target.lastX, y + HALF_H), color: target.color })
      else:
        x += UNIT_W
        p = new Path(next = commit.parents[j], color = colorQueue.next(), points = [dot, (x, y + HALF_H)])
        unsolved.push(p); paths.push(p)

  row.leftMargin = max(x, maxXOld) + HALF_W + 2

// window end: open lanes stop at the last row
for i, p in unsolved: p.end((i + 0.5) * UNIT_W + 4, (commits.length - 0.5) + HALF_H)
```

Two caveats a fresh implementation must decide on deliberately (SourceGit does not):

1. **Determinism across windows.** Emitting colors from a recycling FIFO makes colors a function of
   the whole input list. Any incremental/append-only implementation must either keep a color map
   keyed by lane identity or accept recoloring on refetch.
2. **Dangling lanes.** Ending every open lane at the last loaded row means "more history below"
   is indistinguishable from "this lane really ends here". If Refyard paginates, it needs an explicit
   open-ended flag on those last-row endpoints.

---

## 6. Error handling

### 6.1 Representation

**Observed** (`Command.cs:13-20`):

```csharp
        public class Result
        {
            public bool IsSuccess { get; set; } = false;
            public string StdOut { get; set; } = string.Empty;
            public string StdErr { get; set; } = string.Empty;

            public static Result Failed(string reason) => new Result() { StdErr = reason };
        }
```

`IsSuccess` is nothing but `proc.ExitCode == 0` (`:132`, `:155`). `RaiseError` (default `true`,
`:37`) is the only knob a caller has; read-only probes that are expected to fail set it to `false`
(`IsLFSFiltered.cs:12`, `QueryGitCommonDir.cs:14`, `IsBinary.cs:17`,
`QueryFileHistory.cs:14`, `Blame.cs:17`, `QueryRepositoryStatus.cs:15`, `QueryRefsContainsCommit.cs:11`).

### 6.2 stderr is not classified — it is collected and shown

**Observed** (`Command.cs:232-254`):

```csharp
        private void HandleOutput(string line, List<string> errs)
        {
            if (line == null)
                return;

            Log?.AppendLine(line);

            // Lines to hide in error message.
            if (line.Length > 0)
            {
                if (line.StartsWith("remote: Enumerating objects:", StringComparison.Ordinal) ||
                    line.StartsWith("remote: Counting objects:", StringComparison.Ordinal) ||
                    line.StartsWith("remote: Compressing objects:", StringComparison.Ordinal) ||
                    line.StartsWith("Filtering content:", StringComparison.Ordinal) ||
                    line.StartsWith("hint:", StringComparison.Ordinal))
                    return;

                if (REG_PROGRESS().IsMatch(line))
                    return;
            }

            errs.Add(line);
        }
```

`HandleOutput` is wired to **both** `OutputDataReceived` and `ErrorDataReceived` (`:48-49`), so the
error list is a mix of stdout and stderr lines minus progress noise (`\d+%` regex, `:261-262`).
Then (`Command.cs:98-110`):

```csharp
            if (!CancellationToken.IsCancellationRequested && proc.ExitCode != 0)
            {
                if (RaiseError)
                {
                    var errMsg = string.Join("\n", errs).Trim();
                    if (!string.IsNullOrEmpty(errMsg))
                        RaiseException(errMsg);
                }

                return false;
            }

            return true;
```

`RaiseException` is a UI toast, not an exception (`:227-230`):
`Models.Notification.Send(Context, error, true);`. **Inferred**: there is **no error taxonomy at
all** — no distinction between "your index.lock is stale", "no such revision", "authentication
required", "merge conflict", "hook rejected the commit", "not a git repository", or "the process
could not be spawned". Everything is a string in a notification, and the machine-readable
distinction Refyard needs (retryable vs fatal vs unknown, "a lock is held", "hooks refused") simply
does not exist here. The only caller that formats stderr explicitly is
`QueryCommitsForInteractiveRebase.cs:22-26`
(`RaiseException($"Failed to query commits for interactive-rebase. Reason: {rs.StdErr}")`).

### 6.3 Cancellation is treated as success

**Observed** (`Command.cs:82-110`), the most surprising behavior in the file:

```csharp
            try
            {
                await proc.WaitForExitAsync(CancellationToken).ConfigureAwait(false);
            }
            catch (Exception e)
            {
                HandleOutput(e.Message, errs);
            }

            lock (capturedLock)
            {
                captured.Process = null;
            }

            Log?.AppendLine(string.Empty);

            if (!CancellationToken.IsCancellationRequested && proc.ExitCode != 0)
            {
```

The guard is `!CancellationToken.IsCancellationRequested`, so when the token fired, the exit-code
check is **skipped and `ExecAsync()` returns `true`**. Combined with the in-code warning that
cancellation is only safe for read-only commands (`:57`), the design assumes callers will never
cancel a mutation. **Inferred (hazard):** if a caller ever arms a token on a mutation, a cancelled
`git commit`/`git checkout` reports success to the view model. Refyard's "unknown results are
reported as unknown" rule exists precisely to prevent this; SourceGit's `true` here is a
mis-classification.

### 6.4 Timeout and process-tree cleanup

**Observed.** No timeouts (see 1.5). Cancellation and cleanup are platform-specific:

| Platform | Mechanism                                                                                                                                                                               | Evidence                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Linux    | `setsid git …` always; `kill(-pid, 15)` on the group; `ESRCH` (3) means already gone; else `proc.Kill(true)`                                                                            | `Linux.cs:180-211`                                                   |
| macOS    | `setsid` only if a `setsid` binary sits beside the app executable; otherwise `proc.Kill(true)`                                                                                          | `MacOS.cs:23`, `:133-141`, `:143-170`, `tools/setsid-macos/setsid.c` |
| Windows  | `AttachConsole(pid)` + `SetConsoleCtrlHandler(NULL, TRUE)` + `GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)`; 2 s grace; else `proc.Kill(true)`; `FreeConsole`/handler restore in `finally` | `Windows.cs:235-258`                                                 |

The Linux/macOS path is deliberately SIGTERM-first with a comment citing `kill(2)`; the tree dies as
a group because `setsid` gave it a private session, which is why the `setsid` prefix is added only
when a token is armed (`Command.cs:161`). `QueryLocalChanges` bypasses all of this and calls
`proc.Kill(true)` directly (`QueryLocalChanges.cs:50`), because it never runs under a `setsid`
prefix.

**Inferred.** `kill(-pid, SIGTERM)` relies on the child still being the group leader; if `setsid`
itself failed (e.g. it is not executable) the group id is wrong and the kill silently misses.
Nothing verifies that the `setsid` prefix actually took effect.

---

## 7. Tests

**Observed — there are no tests of any kind.** Evidence:

- `SourceGit.slnx` lists exactly three projects: `src/SourceGit.csproj` and the two vendored
  `depends/AvaloniaEdit/*.csproj`. No test project is mentioned.
- `grep -rni "xunit|nunit|mstest|\[Fact\]|\[Test\]"` over the repo (excluding `.git/` and the
  vendored `depends/`) matches nothing.
- `src/SourceGit.csproj` has no `<PackageReference>` for a test framework.
- `.github/workflows/ci.yml` calls `build.yml` (which only runs `dotnet build`, `dotnet publish`,
  `tar`, `upload-artifact`) and `package.yml`. `dotnet test` is never invoked; there is no coverage
  step, no fixture directory, no golden-file corpus.
- DeepWiki's page index for the repository has no testing page ("Development Guide", "Build System",
  "Packaging and Distribution" only).

**Observed — what the workflows _do_ check.** `format-check.yml` and `localization-check.yml` exist
(`SourceGit.slnx` lists them), i.e. formatting and translation-key parity are the only automated
correctness gates besides compilation.

**Observed — the closest thing to a raw-output assertion.** `QueryLocalChanges.GetResultAsync`
wraps its whole loop in `catch { /* Ignore exceptions. */ }` (`QueryLocalChanges.cs:189-192`), as do
`Diff.ReadAsync` (`Diff.cs:94-97`), `QueryRevisionObjects` (`:62-65`), `CompareRevisions` (`:87-90`)
and `QueryFileHistory` (the `rs.IsSuccess` early return). A parse regression therefore surfaces as an
empty list, not as a failure.

**Inferred.** This is the single most important finding for Refyard's process: the parsers in this
codebase have **no regression net whatsoever**, which is why the defects catalogued in section 2
(no C-unescaping, positional `status --porcelain=v2` header parsing, `-z`-less path commands,
`.Trim()` on worktree paths, `not firstParent` graph flag duplicated in two places) have survived
into release 2026.20. There is nothing here to copy for test infrastructure; there is a strong
negative signal about what happens to a byte-unsafe parser without a fixture corpus.

---

## What Refyard should take, and what it should not

### Worth taking (adapting to argv arrays and bytes)

1. **Global `-c` prefix, fixed and centralized.** `--no-pager -c core.quotepath=off -c credential.helper=…`
   before the subcommand, plus the user's editor choice expressed as `-c core.editor=…`
   (`Command.cs:168-184`). For Refyard this belongs in the planner layer as a non-negotiable prefix;
   `--no-pager` in particular prevents Git from spawning a pager inside a spawned process group,
   and `core.quotepath=off` is a prerequisite for any path that will later be compared byte-wise.
   **But** Refyard must pair it with actual C-unquoting or with `-z` everywhere — see item 6 below.
2. **`-c core.editor=true`** as the default "no interactive editor" stance, with real message entry
   done by writing a temp file and passing `--file=<tmp>` (`Commit.cs:17-20`, `:33-46`). One
   `-c core.editor` and one `-c sequence.editor` pointing at the host binary covers rebase
   (`Command.cs:178-179`) — the host must accept `--core-editor`/`--rebase-todo-editor` style flags
   or write the sequence file itself.
3. **`SSH_ASKPASS` / `SSH_ASKPASS_REQUIRE=prefer` / `DISPLAY=required` plus a per-repo
   `GIT_SSH_COMMAND` that only applies when the environment has not already set it**
   (`Command.cs:202-211`). This is the mechanism that keeps credential prompting out of a
   non-interactive child, and it is directly reusable.
4. **`-N` (single dash) `--max-count`, `--decorate=full`, `%x00` field separators, exact field-count
   validation, `--no-show-signature` on every formatted `log`/`show`** (`QueryCommits.cs:15`,
   `Commit.cs:63-117`). The `HEAD -> refs/heads/x` / `HEAD` decorator test is a clean way to find
   the current-branch commit and to mark the branch's ancestry (`QueryCommits.cs:79-99`) — worth
   porting as `isMerged`/`isCurrentHead` derivation, with the fallback query
   (`log --since=@<t> --format=%H`) kept as a documented second pass rather than a silent guess.
5. **State probing as separate, cheap, narrowly scoped commands**: `rev-parse --is-bare-repository`
   guarded by a filesystem precheck (`IsBareRepository.cs:10-16`), `rev-parse --git-dir` /
   `--git-common-dir` with relative-path resolution against the working directory
   (`QueryGitDir.cs:17-24`, `QueryGitCommonDir.cs:15-29`), `cat-file -t` for object type
   (`IsCommitSHA.cs:10-17`), and the `submodule status` → `.gitmodules` config → scoped dirty probe
   sequence (`QuerySubmodules.cs:22-147`). The three-call submodule shape is a good model: cheap
   status first, expensive dirtiness only for the modules that need it, all paths after `--`.
6. **`-z` on `stash list` with a counted-field walk** (`QueryStashes.cs:13`, `:23-31`) — the
   record framing here is correct; the field framing inside a record is not (newline-separated), so
   Refyard should use one NUL-separated field list plus one length-prefixed body field instead.
7. **`--pathspec-from-file=<tmp>`** for bulk path operations (`Add.cs:9`, `Restore.cs:9`,
   `Reset.cs:16`, `Stash.cs:50`, `Discard.cs:86-92`) — with `--pathspec-file-nul`, which SourceGit
   never passes. This is the right IPC shape for "many paths" without argv length limits, and it
   gets it 90% right; Refyard closes the last 10%.
8. **The graph algorithm's _shape_** (section 5.6): a single pass over an already-ordered list, open
   lanes in a list whose order is the lane order, first-match-wins for the consuming lane,
   `End`-into-the-winner for extra matching lanes, first parent continues the lane and extra parents
   become either a `Link` into an existing lane or a new lane. It is small, pure, and directly
   portable — with the two caveats in 5.6 addressed.
9. **The graph's drawing vocabulary**: dots typed `Default`/`Head`/`Merge`, per-row `color` and
   `leftMargin`, `QuadraticBezierTo` for rightward bends and `CubicBezierTo` for leftward bends, and
   the monotone-y `Add()` invariant. Also the "highlight by splitting the Path at a point with the
   same color" trick (`CommitGraph.cs:396-407`) — that is a genuinely nice way to express partial
   highlighting without a separate geometry pass.
10. **The diff parser's decision to stay in chunk-body mode until a line fails the body test**
    (`Diff.cs:143-170`) rather than trusting prefixes, and its `\ No newline at end of file`
    attachment to the previous line, its byte-level `\n` splitting that preserves `\r` for the
    caller, and the `{6,64}` object-id regexes that accept both SHA-1 and SHA-256
    (`Diff.cs:13-16`). Also numstat's `-\t-` as the binary signal (`IsBinary.cs:8-23`) and the
    `+`/`-`/`U`/space `submodule status` prefix mapping (`QuerySubmodules.cs:11`, `:42-61`).
11. **The watcher/lock idea**: a filesystem watcher with a debounce tick that _skips entirely_ while
    a mutation holds a lock (`Watcher.cs:11-21`, `:95-98`, `:139-142`), plus an "everything is dirty
    after this operation" mark so refreshing does not race the command it follows. Refyard's single
    writer per common Git directory is a stronger primitive, but the "suppress refresh while a
    mutation is in flight" behavior is what makes a CLI-shelling UI feel immediate.

### What does not apply, or must be actively rejected

1. **The whole string-based `Args` model.** A single concatenated string plus `Quoted()` is the root
   cause of the `\`-escaping bug class, of the POSIX-vs-Windows re-parse hazard, and of the pathspec
   newline hole. Refyard's planners must emit `args: string[]`, with a single `quote`-free path for
   user data and no shell anywhere. Nothing in `Command.cs`'s argv assembly should be translated
   line-for-line.
2. **`StandardOutputEncoding = Encoding.UTF8` and every `ReadLineAsync`/`ReadToEnd` path.** This is
   the direct opposite of Refyard's byte-safe rule; it destroys non-UTF-8 path bytes irreversibly
   (section 1.4) and loses NUL framing. `Diff.cs`'s `BaseStream` copy is the only technique worth
   taking, and even it is not enough (it keeps bytes only for line _content_, not headers).
3. **`core.quotepath=off` as the _only_ answer to quoting.** It is necessary but not sufficient:
   Git still C-quotes paths containing `"`, `\`, or a control byte, and SourceGit's "unquote" is a
   two-character strip with no unescaping (`Change.cs`), which is wrong for exactly those paths.
   Refyard should either take `-z` on every path-bearing command (status, ls-files, ls-tree,
   diff --name-status, log --name-status, for-each-ref, worktree list, submodule status) or
   implement a real C-unquoter _and_ test it against `\t`, `\n`, `\\`, `\"`, and non-UTF-8 bytes.
   `-z` is strictly cheaper.
4. **The `±` name/email joiner and the `%D` comma split** (`QueryCommits.cs:15`,
   `Commit.cs:68`). Both assume a character cannot appear in a legal field. Use separate NUL fields
   for name and email, and `--decorate=full` with `%(refname)`-style NUL framing per ref (or
   `for-each-ref` + a local ref→commit map) instead of parsing `%D`'s prose.
5. **Positional `status --porcelain=v2` header parsing** with magic substring offsets
   (`QueryRepositoryStatus.cs:31-49`). Parse `# key value`; treat missing keys as unknown, not as
   empty.
6. **`.Trim()` on any Git-produced path** (`Worktree.cs:30`, `:44`, `:48`; `IsBinary.cs:22`;
   `QueryRevisionObjects`'s `(.*)$` is fine but the same spirit). Paths may legitimately begin or end
   with whitespace; trimming is a silent data corruption. Same for `StringSplitOptions.RemoveEmptyEntries`
   on path lists — an empty line is not a legal path, but silently dropping records is how a
   parser bug becomes an empty list.
7. **The catch-all `catch { /* Ignore exceptions. */ }`** around parsers
   (`QueryLocalChanges.cs:189-192`, `Diff.cs:94-97`, `QueryRevisionObjects.cs:62-65`,
   `CompareRevisions.cs:87-90`). For Refyard a parse failure must be a typed error, never an empty
   list.
8. **Cancelled-command-as-success** (`Command.cs:98`). Refyard must return
   `unknown`/`cancelled`, never `succeeded`, when the token fired.
9. **No timeouts.** A credential prompt or an unreachable remote hangs forever. Refyard's host needs
   a policy (and, crucially, must distinguish "timed out and the child was killed" from
   "the child exited after we stopped reading", since Git may have side effects either way).
10. **The `setsid`-dependent kill path.** `kill(-pid, SIGTERM)` only works when the wrapper actually
    took effect (and on macOS only when a bundled helper exists). A Node host can get the same
    guarantee portably by spawning with `detached: true` and killing the process group itself on
    POSIX, or via a job object on Windows — but it must _verify_ the group exists rather than assume.
    Also: never escalate to SIGKILL immediately for Git mutations; SIGTERM-first is the right call
    and SourceGit's comment citing `kill(2)` shows they thought about it.
11. **Index-based stash targeting** (`stash@{N}` from `%gd`, `DropStash.cs:25`, `ApplyStash.cs:41`,
    and the result-ignoring second `drop` in `ApplyStash.cs:47-54`). Bind `apply` to the stash
    commit id that was listed (documented to accept any stash-like commit); for `pop`/`drop`, where
    only the `stash@{n}`/index form is documented, re-read `stash list -z` and verify that the entry
    at `stash@{N}` still has the SHA recorded in the preview token before running the operation —
    refuse if it does not. Nothing in SourceGit does any of this, and it is the most likely
    "destroyed user data" bug in the stash feature set.
12. **`submodule deinit`/`rm -rf` with no preconditions** (`Submodule.cs:68-78`,
    `DeleteSubmodule.cs:25-33`), and **`worktree remove` with only a `Force` checkbox**
    (`RemoveWorktree.cs:17-36`). No backups, no "is this worktree dirty", no "is this the worktree
    you are standing in". These are exactly the operations Refyard's safety rules gate on
    confirmation + backup + fail-closed preconditions; SourceGit's behavior is a cautionary
    comparison, not a model.
13. **Discard-by-filesystem-delete.** `Discard.ChangesAsync` does `Directory.Delete(fullPath, true)`
    / `File.Delete(fullPath)` itself for untracked changes before calling `git restore`
    (`Discard.cs:63-92`), and `Discard.AllAsync` does the same plus `git clean` and, separately,
    `git reset --hard` when "include modified" is set (`Discard.cs:15-51`). The direct filesystem
    deletes bypass Git's own protect rules (submodule `.git` files, symlink handling) and contradict
    Refyard's "restore tracked files to the index, never `git clean`, never to HEAD" rule outright.
14. **`EmptyTreeHash.Guess(revision)`** keyed on `revision.Length == 40` (`EmptyTreeHash.cs:5-13`).
    For a ref name or short SHA this picks the wrong object-format constant. Refyard already knows
    the repository's object format from `rev-parse --show-object-format`; use that.
15. **Index-based, non-incremental graph recomputation** (`Repository.cs:1198-1202` + the
    window-end sweep). Fixed `-N`, full recompute, open lanes truncated at the last row, and
    FIFO-recycled colors mean the graph is neither incremental nor stable across window sizes, and
    "more history below" is not representable. Reimplementing the lane sweep is worth it; copying
    the pagination model is not.
16. **Duplicated state between Git flags and in-process flags.** `--first-parent` is passed to
    `git log` _and_ mirrored into `firstParentOnlyEnabled` in the graph (`RepositoryUIStates.cs:415-416`,
    `CommitGraph.cs:211`). Two sources of truth for one semantic; with no tests (section 7) a
    divergence would only show up as visual corruption. Refyard should derive the graph mode from the
    plan that produced the commit list.
17. **The absolute absence of a test suite.** Not something to port — something to be the opposite
    of. The concrete prescription for Refyard: a fixture corpus of raw Git stdout byte blobs (real
    repo outputs, with the command line recorded next to each fixture) driving every parser, plus
    integration tests that run real Git in the isolated temp repos `tests/support/repo.ts` already
    provides, asserting on bytes rather than on decoded strings — including the cases SourceGit is
    broken for: paths with spaces, tabs, `"`, `\`, a literal newline, a leading/trailing space, a
    leading `-`, and a non-UTF-8 byte sequence.
