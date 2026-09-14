/**
 * Real Git output, captured byte-for-byte by `bun scripts/capture-fixtures.ts`.
 *
 * These are *measured* formats, not documentation transcriptions: the generator
 * builds a scratch repository, drives it into each state, and records exactly what
 * Git printed (git version 2.50.1 (Apple Git-155), macOS arm64). Fixed identities and dates make the commit
 * ids reproducible, so regenerating on the same Git version produces this file
 * unchanged — and a diff after a Git upgrade is the signal that a format moved.
 *
 * Escapes are visible on purpose: `\u0000` is a NUL record separator, `\n` inside a
 * path is a real newline in a file name, and they are the difference between a parser
 * that survives those names and one that quietly corrupts them.
 */

export interface ByteFixture {
  /** The command that produced it, exactly as the generator ran it. */
  readonly command: string;
  /** The exact bytes, as a string whose code units are the bytes. */
  readonly bytes: string;
}

/** Capture commands, in the order the generator ran them. */
export const CAPTURE_GIT_VERSION = "git version 2.50.1 (Apple Git-155)";

export const BYTE_FIXTURES = {
  /** git status --porcelain=v2 --branch -z */
  statusCleanWithBranch: {
    command: "git status --porcelain=v2 --branch -z",
    bytes:
      "# branch.oid 2880c581c186fa19dd10596479a25bd54a9797b5\u0000# branch.head main\u0000",
  },
  /** git status --porcelain=v2 --branch --show-stash --ignored=matching -z */
  statusAllRecordTypes: {
    command:
      "git status --porcelain=v2 --branch --show-stash --ignored=matching -z",
    bytes:
      "# branch.oid 00a6d892293f4d9b75084493e2bc1981f71aa5bc\u0000# branch.head main\u00001 MM N... 100644 100644 100644 df967b96a579e45a18b8251732d16804b2e56a55 07d44e579bbd9318d1fd6c91d387248d8ab8b120 base.txt\u00001 D. N... 100644 000000 000000 2d030d7bc1bbfbdee332aaf691447b30cdea375b 0000000000000000000000000000000000000000 delete-me.txt\u00002 R. N... 100644 100644 100644 43372edea46de0470388d72da4ad490183f95954 43372edea46de0470388d72da4ad490183f95954 R100 moved \u65b0\tname.txt\u0000rename-src.txt\u0000? line\nbreak.txt\u0000? tab\tname.txt\u0000! ignored.txt\u0000",
  },
  /** git diff --numstat -z --no-ext-diff --no-textconv HEAD */
  numstatRename: {
    command: "git diff --numstat -z --no-ext-diff --no-textconv HEAD",
    bytes:
      "2\t1\tbase.txt\u00000\t1\tdelete-me.txt\u00000\t0\t\u0000rename-src.txt\u0000moved \u65b0\tname.txt\u0000",
  },
  /** git diff --name-status -z --no-ext-diff --no-textconv HEAD */
  nameStatusRename: {
    command: "git diff --name-status -z --no-ext-diff --no-textconv HEAD",
    bytes:
      "M\u0000base.txt\u0000D\u0000delete-me.txt\u0000R100\u0000rename-src.txt\u0000moved \u65b0\tname.txt\u0000",
  },
  /** git ls-files --stage -z */
  lsFilesStage: {
    command: "git ls-files --stage -z",
    bytes:
      "100644 f89d64dab6bbf0db7bfd8b939dfe59b2e7977894 0\t.gitignore\u0000100644 07d44e579bbd9318d1fd6c91d387248d8ab8b120 0\tbase.txt\u0000100644 43372edea46de0470388d72da4ad490183f95954 0\tmoved \u65b0\tname.txt\u0000",
  },
  /** git diff --no-color --no-ext-diff --no-textconv --cached -- base.txt */
  patchText: {
    command:
      "git diff --no-color --no-ext-diff --no-textconv --cached -- base.txt",
    bytes:
      "diff --git a/base.txt b/base.txt\nindex df967b9..07d44e5 100644\n--- a/base.txt\n+++ b/base.txt\n@@ -1 +1 @@\n-base\n+staged change\n",
  },
  /** git status --porcelain=v2 -z */
  statusModeAndBinaryChange: {
    command: "git status --porcelain=v2 -z",
    bytes:
      "1 .M N... 100644 100644 100644 6164d9f90821c3bf1dd2b0ccc10d92277d28ddfb 6164d9f90821c3bf1dd2b0ccc10d92277d28ddfb bin.dat\u00001 .M N... 100644 100644 100755 4163036efa65bd4a469e752267498f01ea36a55c 4163036efa65bd4a469e752267498f01ea36a55c script.sh\u0000",
  },
  /** git diff --numstat -z HEAD */
  numstatBinary: {
    command: "git diff --numstat -z HEAD",
    bytes: "-\t-\tbin.dat\u00000\t0\tscript.sh\u0000",
  },
  /** git diff --no-color HEAD -- script.sh */
  patchModeChange: {
    command: "git diff --no-color HEAD -- script.sh",
    bytes:
      "diff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755\n",
  },
  /** git reflog show --format=%gd%x00%H%x00%gs%x00%ct refs/stash */
  stashList: {
    command: "git reflog show --format=%gd%x00%H%x00%gs%x00%ct refs/stash",
    bytes:
      "stash@{0}\u0000eb5a27bf62d02c5a27611055e25e9cd66d88d4c8\u0000On main: line one line two\u00001767225600\n",
  },
  /** git status --porcelain=v2 -z */
  statusUnmerged: {
    command: "git status --porcelain=v2 -z",
    bytes:
      "u UU N... 100644 100644 100644 100644 1a6ab8d38a1feb68499d87e63440af216064f3d0 21d65f9bcc9b45c737fa7ba476aeb90a0d296cbd 0fa2621178dfa495bb0d1b0fd329e30eb5d953bb base.txt\u0000",
  },
  /** git diff --name-status -z (conflicted) */
  nameStatusUnmerged: {
    command: "git diff --name-status -z (conflicted)",
    bytes: "U\u0000base.txt\u0000M\u0000base.txt\u0000",
  },
  /** git ls-files --unmerged --stage -z */
  lsFilesUnmerged: {
    command: "git ls-files --unmerged --stage -z",
    bytes:
      "100644 1a6ab8d38a1feb68499d87e63440af216064f3d0 1\tbase.txt\u0000100644 21d65f9bcc9b45c737fa7ba476aeb90a0d296cbd 2\tbase.txt\u0000100644 0fa2621178dfa495bb0d1b0fd329e30eb5d953bb 3\tbase.txt\u0000",
  },
  /** git rev-list --topo-order --parents --max-count=3 HEAD */
  revListTopology: {
    command: "git rev-list --topo-order --parents --max-count=3 HEAD",
    bytes:
      "fef12e3705ae5eb4037d164d06a78a9dda8392c2 d21595332413c62dbd2bc0b53bd88575d5a61a1b\nd21595332413c62dbd2bc0b53bd88575d5a61a1b 9315856cb6d1f7e13d2ba8266384fab3e81e9297\n9315856cb6d1f7e13d2ba8266384fab3e81e9297 7192fcddf81d3e09d3ba4af8ee7536929215302c\n",
  },
  /** git cat-file --batch (with fef12e3705ae5eb4037d164d06a78a9dda8392c2 on stdin) */
  catFileCommit: {
    command:
      "git cat-file --batch (with fef12e3705ae5eb4037d164d06a78a9dda8392c2 on stdin)",
    bytes:
      "fef12e3705ae5eb4037d164d06a78a9dda8392c2 commit 236\ntree c0e14ba07f9e9d38242041c863e8c5e5f4dddd27\nparent d21595332413c62dbd2bc0b53bd88575d5a61a1b\nauthor Fixture Author <author@refyard.invalid> 1767225600 +0000\ncommitter Fixture Author <author@refyard.invalid> 1767225600 +0000\n\nmain side\n\n",
  },
  /** git cat-file --batch (with an unusable object name on stdin) */
  catFileMissing: {
    command: "git cat-file --batch (with an unusable object name on stdin)",
    bytes: "0000000000000000000000000000000000000000 missing\n",
  },
  /** git for-each-ref --format=… --sort=refname */
  forEachRef: {
    command: "git for-each-ref --format=… --sort=refname",
    bytes:
      "refs/heads/main\u0000fef12e3705ae5eb4037d164d06a78a9dda8392c2\u0000commit\u0000\u0000\u0000\u0000*\u0000\nrefs/heads/other\u0000aa1e487a8d014bc751e7745174ad4e9e20e0d584\u0000commit\u0000\u0000\u0000\u0000 \u0000\nrefs/stash\u0000eb5a27bf62d02c5a27611055e25e9cd66d88d4c8\u0000commit\u0000\u0000\u0000\u0000 \u0000\n",
  },
  /** git worktree list --porcelain -z */
  worktreeList: {
    command: "git worktree list --porcelain -z",
    bytes:
      "worktree /private/var/folders/n6/tx2574_56h33v09wbc2hk_nm0000gn/T/refyard-fixtures-AIZHXR/repo\u0000HEAD fef12e3705ae5eb4037d164d06a78a9dda8392c2\u0000branch refs/heads/main\u0000\u0000",
  },
  /** git for-each-ref --format=… --sort=refname (with tags) */
  forEachRefWithTags: {
    command: "git for-each-ref --format=… --sort=refname (with tags)",
    bytes:
      "refs/heads/main\u0000fef12e3705ae5eb4037d164d06a78a9dda8392c2\u0000commit\u0000\u0000\u0000\u0000*\u0000\nrefs/heads/other\u0000aa1e487a8d014bc751e7745174ad4e9e20e0d584\u0000commit\u0000\u0000\u0000\u0000 \u0000\nrefs/stash\u0000eb5a27bf62d02c5a27611055e25e9cd66d88d4c8\u0000commit\u0000\u0000\u0000\u0000 \u0000\nrefs/tags/annotated\u0000d0e87308edf84600829701054101b9e49655966d\u0000tag\u0000\u0000\u0000\u0000 \u0000fef12e3705ae5eb4037d164d06a78a9dda8392c2\nrefs/tags/lightweight\u0000fef12e3705ae5eb4037d164d06a78a9dda8392c2\u0000commit\u0000\u0000\u0000\u0000 \u0000\n",
  },
  /** git status --porcelain=v2 -z (submodule added) */
  statusWithSubmodule: {
    command: "git status --porcelain=v2 -z (submodule added)",
    bytes:
      "1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 b00450ff363f8cb1d6771cb15c6b0a053c4d8ea6 .gitmodules\u00001 A. S... 000000 160000 160000 0000000000000000000000000000000000000000 d90d95f6f5dd4f646fe476d13d282a4e76556d55 vendor/sub\u0000",
  },
  /** git ls-files --stage -z (gitlink) */
  lsFilesGitlink: {
    command: "git ls-files --stage -z (gitlink)",
    bytes:
      "100644 f89d64dab6bbf0db7bfd8b939dfe59b2e7977894 0\t.gitignore\u0000100644 b00450ff363f8cb1d6771cb15c6b0a053c4d8ea6 0\t.gitmodules\u0000100644 21d65f9bcc9b45c737fa7ba476aeb90a0d296cbd 0\tbase.txt\u0000100644 6164d9f90821c3bf1dd2b0ccc10d92277d28ddfb 0\tbin.dat\u0000100644 7249b2f60bf1b1faef75b5034cfa0edcdb2e9567 0\tline\nbreak.txt\u0000100644 43372edea46de0470388d72da4ad490183f95954 0\tmoved \u65b0\tname.txt\u0000100644 4163036efa65bd4a469e752267498f01ea36a55c 0\tscript.sh\u0000100644 35a394e459bb2e7af167fce1dd4ab0253ae53464 0\ttab\tname.txt\u0000160000 d90d95f6f5dd4f646fe476d13d282a4e76556d55 0\tvendor/sub\u0000",
  },
  /** git diff --submodule=short HEAD */
  patchSubmodule: {
    command: "git diff --submodule=short HEAD",
    bytes:
      'diff --git a/.gitmodules b/.gitmodules\nnew file mode 100644\nindex 0000000..b00450f\n--- /dev/null\n+++ b/.gitmodules\n@@ -0,0 +1,3 @@\n+[submodule "vendor/sub"]\n+\tpath = vendor/sub\n+\turl = /var/folders/n6/tx2574_56h33v09wbc2hk_nm0000gn/T/refyard-fixtures-AIZHXR/submodule\ndiff --git a/vendor/sub b/vendor/sub\nnew file mode 160000\nindex 0000000..d90d95f\n--- /dev/null\n+++ b/vendor/sub\n@@ -0,0 +1 @@\n+Subproject commit d90d95f6f5dd4f646fe476d13d282a4e76556d55\n',
  },
  /** git push --porcelain origin refs/heads/main:refs/heads/main */
  pushNewBranch: {
    command: "git push --porcelain origin refs/heads/main:refs/heads/main",
    bytes:
      "To /var/folders/n6/tx2574_56h33v09wbc2hk_nm0000gn/T/refyard-fixtures-AIZHXR/remote.git\n*\trefs/heads/main:refs/heads/main\t[new branch]\nDone\n",
  },
  /** git push --porcelain origin refs/heads/main:refs/heads/main */
  pushUpToDate: {
    command: "git push --porcelain origin refs/heads/main:refs/heads/main",
    bytes:
      "To /var/folders/n6/tx2574_56h33v09wbc2hk_nm0000gn/T/refyard-fixtures-AIZHXR/remote.git\n=\trefs/heads/main:refs/heads/main\t[up to date]\nDone\n",
  },
  /** git push --porcelain origin refs/heads/main:refs/heads/main (from the clone) */
  pushFastForward: {
    command:
      "git push --porcelain origin refs/heads/main:refs/heads/main (from the clone)",
    bytes:
      "To /var/folders/n6/tx2574_56h33v09wbc2hk_nm0000gn/T/refyard-fixtures-AIZHXR/remote.git\n \trefs/heads/main:refs/heads/main\tcdb7e06..b29de1a\nDone\n",
  },
  /** git fetch --porcelain origin */
  fetchUpdate: {
    command: "git fetch --porcelain origin",
    bytes:
      "  cdb7e06fa9c6de49fc2cf6afadf1788b03a8ac1b b29de1af846b232b5076c74b517ed1c48d71b631 refs/remotes/origin/main\n",
  },
  /** git fetch --porcelain origin (nothing new) */
  fetchNoChange: {
    command: "git fetch --porcelain origin (nothing new)",
    bytes: "",
  },
  /** git push --porcelain origin refs/heads/main:refs/heads/main (non-fast-forward) */
  pushRejected: {
    command:
      "git push --porcelain origin refs/heads/main:refs/heads/main (non-fast-forward)",
    bytes:
      "To /var/folders/n6/tx2574_56h33v09wbc2hk_nm0000gn/T/refyard-fixtures-AIZHXR/remote.git\n!\trefs/heads/main:refs/heads/main\t[rejected] (non-fast-forward)\nDone\n",
  },
  /** git push --porcelain --force-with-lease origin refs/heads/main:refs/heads/main */
  pushForced: {
    command:
      "git push --porcelain --force-with-lease origin refs/heads/main:refs/heads/main",
    bytes:
      "To /var/folders/n6/tx2574_56h33v09wbc2hk_nm0000gn/T/refyard-fixtures-AIZHXR/remote.git\n+\trefs/heads/main:refs/heads/main\tb29de1a...bf0108b (forced update)\nDone\n",
  },
  /** git rev-parse --path-format=absolute --absolute-git-dir --git-common-dir --show-toplevel --is-bare-repository --show-object-format --is-shallow-repository */
  repositoryLayout: {
    command:
      "git rev-parse --path-format=absolute --absolute-git-dir --git-common-dir --show-toplevel --is-bare-repository --show-object-format --is-shallow-repository",
    bytes:
      "/private/var/folders/n6/tx2574_56h33v09wbc2hk_nm0000gn/T/refyard-fixtures-AIZHXR/repo/.git\n/private/var/folders/n6/tx2574_56h33v09wbc2hk_nm0000gn/T/refyard-fixtures-AIZHXR/repo/.git\n/private/var/folders/n6/tx2574_56h33v09wbc2hk_nm0000gn/T/refyard-fixtures-AIZHXR/repo\nfalse\nsha1\nfalse\n",
  },
} as const satisfies Record<string, ByteFixture>;

export type ByteFixtureName = keyof typeof BYTE_FIXTURES;

/**
 * The fixture's bytes.
 *
 * The literals hold text that was decoded from Git output as UTF-8, so they are
 * re-encoded as UTF-8 here. That is sound for these captures because Git printed
 * valid UTF-8 for every field; a future fixture with deliberately invalid bytes
 * (the unrepresentable-path case) must be stored as base64 instead of text.
 */
export function fixtureBytes(name: ByteFixtureName): Uint8Array {
  return new TextEncoder().encode(BYTE_FIXTURES[name].bytes);
}
