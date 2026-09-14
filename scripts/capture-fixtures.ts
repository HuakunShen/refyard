#!/usr/bin/env bun
/**
 * Regenerate `tests/fixtures/bytes.ts` from real Git output.
 *
 * The parser fixtures are not hand-written: this script builds a scratch
 * repository, drives it into each state the parsers must handle, and writes the
 * exact bytes Git produced. Fixed identities and dates make the commit ids
 * reproducible, so regenerating on a machine with the same Git version yields the
 * same file — which is why the fixtures can be committed and reviewed as a diff.
 *
 * Run it after a Git upgrade, and treat any change in the diff as a format change
 * that the parsers must be taught about:
 *
 *     bun scripts/capture-fixtures.ts
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chmodSync, mkdtempSync } from "node:fs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const target = join(repoRoot, "tests/fixtures/bytes.ts");

const scratch = mkdtempSync(join(tmpdir(), "refyard-fixtures-"));
const home = join(scratch, "home");
const repo = join(scratch, "repo");
const remote = join(scratch, "remote.git");
const other = join(scratch, "other");
const submodule = join(scratch, "submodule");
await mkdir(home, { recursive: true });
await mkdir(repo, { recursive: true });
await writeFile(join(home, ".gitconfig"), "", "utf8");

const baseEnv: Record<string, string> = {
  PATH: process.env["PATH"] ?? "",
  HOME: home,
  GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Fixture Author",
  GIT_AUTHOR_EMAIL: "author@refyard.invalid",
  GIT_COMMITTER_NAME: "Fixture Author",
  GIT_COMMITTER_EMAIL: "author@refyard.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00+00:00",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00+00:00",
  GIT_DEFAULT_BRANCH: "main",
  LC_ALL: "C",
};

/**
 * Run Git and return stdout. Commands that are *expected* to fail (a rejected
 * push, a conflicted merge) still produce the output the parser must handle, so
 * failure is announced as `expectFailure` rather than swallowed: a command that
 * quietly stops failing means the fixture no longer captures the case it exists
 * for.
 */
function git(
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly stdin?: string;
    readonly expectFailure?: boolean;
  } = {},
): Uint8Array {
  const result = spawnSync("git", [...args], {
    cwd: options.cwd ?? repo,
    env: baseEnv,
    shell: false,
    input: options.stdin,
  });
  if (options.expectFailure === true) {
    if (result.status === 0) {
      throw new Error(
        `git ${args.join(" ")} was expected to fail but succeeded`,
      );
    }
  } else if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.status}): ${result.stderr.toString()}`,
    );
  }
  return new Uint8Array(result.stdout);
}

const captured: { name: string; command: string; bytes: Uint8Array }[] = [];
function capture(name: string, command: string, bytes: Uint8Array): void {
  captured.push({ name, command, bytes });
}

/* ------------------------------------------------------------------ the states */

await git(["init", "--quiet", "--initial-branch=main"]);
await writeFile(join(repo, "base.txt"), "base\n");
await git(["add", "-A"]);
await git(["commit", "--quiet", "-m", "base"]);
capture(
  "statusCleanWithBranch",
  "git status --porcelain=v2 --branch -z",
  git(["status", "--porcelain=v2", "--branch", "-z"]),
);

await writeFile(join(repo, "rename-src.txt"), "rename me\n");
await writeFile(join(repo, "delete-me.txt"), "delete me\n");
await git(["add", "-A"]);
await git(["commit", "--quiet", "-m", "add files"]);
await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
await git(["add", ".gitignore"]);
await git(["commit", "--quiet", "-m", "ignore file"]);

// Every record type in one read: staged rename, staged delete, staged+unstaged
// modification, untracked with a newline and a tab in the name, and ignored.
await git(["mv", "rename-src.txt", "moved 新\tname.txt"]);
await git(["rm", "--quiet", "delete-me.txt"]);
await writeFile(join(repo, "base.txt"), "staged change\n");
await git(["add", "base.txt"]);
await writeFile(join(repo, "base.txt"), "staged change\nplus unstaged\n");
await writeFile(join(repo, "line\nbreak.txt"), "newline name\n");
await writeFile(join(repo, "tab\tname.txt"), "tab name\n");
await writeFile(join(repo, "ignored.txt"), "ignored\n");
capture(
  "statusAllRecordTypes",
  "git status --porcelain=v2 --branch --show-stash --ignored=matching -z",
  git([
    "status",
    "--porcelain=v2",
    "--branch",
    "--show-stash",
    "--ignored=matching",
    "-z",
  ]),
);
capture(
  "numstatRename",
  "git diff --numstat -z --no-ext-diff --no-textconv HEAD",
  git(["diff", "--numstat", "-z", "--no-ext-diff", "--no-textconv", "HEAD"]),
);
capture(
  "nameStatusRename",
  "git diff --name-status -z --no-ext-diff --no-textconv HEAD",
  git([
    "diff",
    "--name-status",
    "-z",
    "--no-ext-diff",
    "--no-textconv",
    "HEAD",
  ]),
);
capture(
  "lsFilesStage",
  "git ls-files --stage -z",
  git(["ls-files", "--stage", "-z"]),
);
capture(
  "patchText",
  "git diff --no-color --no-ext-diff --no-textconv --cached -- base.txt",
  git([
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--cached",
    "--",
    "base.txt",
  ]),
);

// Binary and mode changes.
await git(["add", "-A"]);
await git(["commit", "--quiet", "-m", "staged set"]);
await writeFile(join(repo, "bin.dat"), Uint8Array.from([0, 1, 2, 3, 255, 254]));
await git(["add", "bin.dat"]);
await git(["commit", "--quiet", "-m", "binary"]);
await writeFile(join(repo, "bin.dat"), Uint8Array.from([0, 1, 2, 3, 255, 253]));
await writeFile(join(repo, "script.sh"), "#!/bin/sh\necho hi\n");
await git(["add", "script.sh"]);
await git(["commit", "--quiet", "-m", "script"]);
chmodSync(join(repo, "script.sh"), 0o755);
capture(
  "statusModeAndBinaryChange",
  "git status --porcelain=v2 -z",
  git(["status", "--porcelain=v2", "-z"]),
);
capture(
  "numstatBinary",
  "git diff --numstat -z HEAD",
  git(["diff", "--numstat", "-z", "HEAD"]),
);
capture(
  "patchModeChange",
  "git diff --no-color HEAD -- script.sh",
  git(["diff", "--no-color", "HEAD", "--", "script.sh"]),
);

// A stash, with a message containing a newline to see how Git stores it.
await writeFile(join(repo, "base.txt"), "stash me\n");
git(["stash", "push", "--quiet", "--message=line one\nline two"]);
capture(
  "stashList",
  "git reflog show --format=%gd%x00%H%x00%gs%x00%ct refs/stash",
  git(["reflog", "show", "--format=%gd%x00%H%x00%gs%x00%ct", "refs/stash"]),
);

// Unmerged index.
await git(["checkout", "--quiet", "-b", "other"]);
await writeFile(join(repo, "base.txt"), "other side\n");
await git(["commit", "--quiet", "-am", "other side"]);
await git(["checkout", "--quiet", "main"]);
await writeFile(join(repo, "base.txt"), "main side\n");
await git(["commit", "--quiet", "-am", "main side"]);
git(["merge", "other"], { expectFailure: true });
capture(
  "statusUnmerged",
  "git status --porcelain=v2 -z",
  git(["status", "--porcelain=v2", "-z"]),
);
capture(
  "nameStatusUnmerged",
  "git diff --name-status -z (conflicted)",
  git(["diff", "--name-status", "-z"]),
);
capture(
  "lsFilesUnmerged",
  "git ls-files --unmerged --stage -z",
  git(["ls-files", "--unmerged", "--stage", "-z"]),
);
git(["merge", "--abort"]);

// History and objects.
capture(
  "revListTopology",
  "git rev-list --topo-order --parents --max-count=3 HEAD",
  git(["rev-list", "--topo-order", "--parents", "--max-count=3", "HEAD"]),
);
const headOid = new TextDecoder().decode(git(["rev-parse", "HEAD"])).trim();
capture(
  "catFileCommit",
  `git cat-file --batch (with ${headOid} on stdin)`,
  git(["cat-file", "--batch"], { stdin: `${headOid}\n` }),
);
capture(
  "catFileMissing",
  "git cat-file --batch (with an unusable object name on stdin)",
  git(["cat-file", "--batch"], { stdin: `${"0".repeat(40)}\n` }),
);
capture(
  "forEachRef",
  "git for-each-ref --format=… --sort=refname",
  git([
    "for-each-ref",
    "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)%00%(upstream)%00%(upstream:track)%00%(HEAD)%00%(*objectname)",
    "--sort=refname",
  ]),
);
capture(
  "worktreeList",
  "git worktree list --porcelain -z",
  git(["worktree", "list", "--porcelain", "-z"]),
);

// Tags: a lightweight and an annotated one, so `objecttype`/peeled differ.
git(["tag", "lightweight"]);
git([
  "-c",
  "user.name=Fixture Author",
  "-c",
  "user.email=author@refyard.invalid",
  "tag",
  "-a",
  "annotated",
  "-m",
  "annotation",
]);
capture(
  "forEachRefWithTags",
  "git for-each-ref --format=… --sort=refname (with tags)",
  git([
    "for-each-ref",
    "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)%00%(upstream)%00%(upstream:track)%00%(HEAD)%00%(*objectname)",
    "--sort=refname",
  ]),
);

// A real submodule, so gitlinks and `Subproject commit` are measured.
await mkdir(submodule, { recursive: true });
await git(["init", "--quiet", "--initial-branch=main"], { cwd: submodule });
await writeFile(join(submodule, "s.txt"), "sub\n");
await git(["add", "-A"], { cwd: submodule });
await git(["commit", "--quiet", "-m", "sub base"], { cwd: submodule });
git([
  "-c",
  "protocol.file.allow=always",
  "submodule",
  "add",
  "--quiet",
  submodule,
  "vendor/sub",
]);
capture(
  "statusWithSubmodule",
  "git status --porcelain=v2 -z (submodule added)",
  git(["status", "--porcelain=v2", "-z"]),
);
capture(
  "lsFilesGitlink",
  "git ls-files --stage -z (gitlink)",
  git(["ls-files", "--stage", "-z"]),
);
capture(
  "patchSubmodule",
  "git diff --submodule=short HEAD",
  git(["diff", "--submodule=short", "HEAD"]),
);

// Network porcelain against a local bare remote.
git(["init", "--bare", "--quiet", "--initial-branch=main", remote], {
  cwd: scratch,
});
git(["symbolic-ref", "HEAD", "refs/heads/main"], { cwd: remote });
await git(["add", "-A"]);
await git(["commit", "--quiet", "-m", "before remote"]);
await git(["remote", "add", "origin", remote]);
capture(
  "pushNewBranch",
  "git push --porcelain origin refs/heads/main:refs/heads/main",
  git(["push", "--porcelain", "origin", "refs/heads/main:refs/heads/main"]),
);
capture(
  "pushUpToDate",
  "git push --porcelain origin refs/heads/main:refs/heads/main",
  git(["push", "--porcelain", "origin", "refs/heads/main:refs/heads/main"]),
);
await git(["clone", "--quiet", remote, other], { cwd: scratch });
await writeFile(join(other, "remote.txt"), "remote\n");
git(["add", "-A"], { cwd: other });
git(["commit", "--quiet", "-m", "remote side"], { cwd: other });
capture(
  "pushFastForward",
  "git push --porcelain origin refs/heads/main:refs/heads/main (from the clone)",
  git(["push", "--porcelain", "origin", "refs/heads/main:refs/heads/main"], {
    cwd: other,
  }),
);
capture(
  "fetchUpdate",
  "git fetch --porcelain origin",
  git(["fetch", "--porcelain", "origin"]),
);
capture(
  "fetchNoChange",
  "git fetch --porcelain origin (nothing new)",
  git(["fetch", "--porcelain", "origin"]),
);
await writeFile(join(repo, "local.txt"), "local\n");
await git(["add", "-A"]);
await git(["commit", "--quiet", "-m", "local side"]);
capture(
  "pushRejected",
  "git push --porcelain origin refs/heads/main:refs/heads/main (non-fast-forward)",
  git(["push", "--porcelain", "origin", "refs/heads/main:refs/heads/main"], {
    expectFailure: true,
  }),
);
capture(
  "pushForced",
  "git push --porcelain --force-with-lease origin refs/heads/main:refs/heads/main",
  git([
    "push",
    "--porcelain",
    "--force-with-lease",
    "origin",
    "refs/heads/main:refs/heads/main",
  ]),
);
capture(
  "repositoryLayout",
  "git rev-parse --path-format=absolute --absolute-git-dir --git-common-dir --show-toplevel --is-bare-repository --show-object-format --is-shallow-repository",
  git([
    "rev-parse",
    "--path-format=absolute",
    "--absolute-git-dir",
    "--git-common-dir",
    "--show-toplevel",
    "--is-bare-repository",
    "--show-object-format",
    "--is-shallow-repository",
  ]),
);

/* ------------------------------------------------------------------- emission */

const gitVersion = new TextDecoder().decode(git(["--version"])).trim();

function escape(text: string): string {
  let out = "";
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (character === "\\") {
      out += "\\\\";
    } else if (character === '"') {
      out += '\\"';
    } else if (character === "\n") {
      out += "\\n";
    } else if (character === "\t") {
      out += "\\t";
    } else if (character === "\r") {
      out += "\\r";
    } else if (code < 0x20 || code > 0x7e) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      out += character;
    }
  }
  return out;
}

/** Bytes as a readable TS string literal: printable ASCII, hex escapes otherwise. */
function literal(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return `"${escape(text)}"`;
}

const lines: string[] = [];
lines.push("/**");
lines.push(
  " * Real Git output, captured byte-for-byte by `bun scripts/capture-fixtures.ts`.",
);
lines.push(" *");
lines.push(
  " * These are *measured* formats, not documentation transcriptions: the generator",
);
lines.push(
  " * builds a scratch repository, drives it into each state, and records exactly what",
);
lines.push(
  ` * Git printed (${gitVersion}, macOS arm64). Fixed identities and dates make the commit`,
);
lines.push(
  " * ids reproducible, so regenerating on the same Git version produces this file",
);
lines.push(
  " * unchanged — and a diff after a Git upgrade is the signal that a format moved.",
);
lines.push(" *");
lines.push(
  " * Escapes are visible on purpose: `\\u0000` is a NUL record separator, `\\n` inside a",
);
lines.push(
  " * path is a real newline in a file name, and they are the difference between a parser",
);
lines.push(" * that survives those names and one that quietly corrupts them.");
lines.push(" */");
lines.push("");
lines.push("export interface ByteFixture {");
lines.push(
  "  /** The command that produced it, exactly as the generator ran it. */",
);
lines.push("  readonly command: string;");
lines.push(
  "  /** The exact bytes, as a string whose code units are the bytes. */",
);
lines.push("  readonly bytes: string;");
lines.push("}");
lines.push("");
lines.push("/** Capture commands, in the order the generator ran them. */");
lines.push(
  "export const CAPTURE_GIT_VERSION = " + JSON.stringify(gitVersion) + ";",
);
lines.push("");
lines.push("export const BYTE_FIXTURES = {");
for (const entry of captured) {
  lines.push(`  /** ${entry.command} */`);
  lines.push(`  ${entry.name}: {`);
  lines.push(`    command: ${JSON.stringify(entry.command)},`);
  lines.push(`    bytes: ${literal(entry.bytes)},`);
  lines.push(`  },`);
}
lines.push("} as const satisfies Record<string, ByteFixture>;");
lines.push("");
lines.push("export type ByteFixtureName = keyof typeof BYTE_FIXTURES;");
lines.push("");
lines.push("/**");
lines.push(" * The fixture's bytes.");
lines.push(" *");
lines.push(
  " * The literals hold text that was decoded from Git output as UTF-8, so they are",
);
lines.push(
  " * re-encoded as UTF-8 here. That is sound for these captures because Git printed",
);
lines.push(
  " * valid UTF-8 for every field; a future fixture with deliberately invalid bytes",
);
lines.push(
  " * (the unrepresentable-path case) must be stored as base64 instead of text.",
);
lines.push(" */");
lines.push("export function fixtureBytes(name: ByteFixtureName): Uint8Array {");
lines.push("  return new TextEncoder().encode(BYTE_FIXTURES[name].bytes);");
lines.push("}");
lines.push("");

await writeFile(target, lines.join("\n"), "utf8");
await rm(scratch, { recursive: true, force: true });
console.log(`wrote ${target} with ${captured.length} fixtures (${gitVersion})`);
