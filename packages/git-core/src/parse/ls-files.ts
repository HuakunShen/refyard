/**
 * `git ls-files --stage -z` parser: the index, including gitlinks.
 *
 * Measured shape (git 2.50.1):
 *
 * ```
 * 100644 f89d64da… 0\t.gitignore\0
 * 100644 43372ede… 0\tmoved 新\tname.txt\0
 * ```
 *
 * Three space-separated ASCII fields — mode, object name, stage — then a TAB and
 * the raw path. The path may contain tabs, so the TAB count is fixed (exactly two
 * separators before it) rather than "split on tab". Stage `0` is a normal entry;
 * stages `1`/`2`/`3` are the base/ours/theirs of a conflict, and mode `160000` is
 * a gitlink — a commit recorded in the index, not a directory of files. That
 * distinction is what makes submodule status a three-OID question later, so it is
 * preserved here rather than folded into "modified".
 */
import { GitOutputParseError } from "../ports.js";
import { FrameReader, splitNulFrames } from "../bytes/nul-framing.js";
import { CORE_LIMITS } from "../bytes/limits.js";

export interface IndexEntry {
  /** Octal mode as Git printed it, e.g. `100644`, `120000`, `160000`. */
  readonly mode: string;
  readonly oid: string;
  /** 0 for a normal entry, 1–3 for unmerged stages. */
  readonly stage: 0 | 1 | 2 | 3;
  /** Raw path bytes. */
  readonly path: Uint8Array;
  /** True when mode is `160000`: the index records a commit, not a file. */
  readonly gitlink: boolean;
}

const FORMAT = "ls-files --stage -z";

export function parseLsFilesStage(
  bytes: Uint8Array,
  options: { maxEntries?: number } = {},
): IndexEntry[] {
  const maxEntries = options.maxEntries ?? CORE_LIMITS.refListMaxEntries;
  const frames = splitNulFrames(bytes, FORMAT);
  const entries: IndexEntry[] = [];

  for (const frame of frames) {
    if (frame.byteLength === 0) {
      continue;
    }
    if (entries.length >= maxEntries) {
      throw new GitOutputParseError(
        FORMAT,
        `index listing exceeded ${maxEntries} entries`,
      );
    }
    const reader = new FrameReader(frame, FORMAT);
    const mode = reader.takeField();
    reader.expectSpace();
    const oid = reader.takeOid();
    reader.expectSpace();
    // The stage is a single character and is followed by a TAB, not a space: the
    // path after it may itself contain tabs, so the separator count is fixed.
    const stageField = reader.takeFixedString(1);
    const tab = reader.takeBytes(1)[0];
    if (tab !== 0x09) {
      throw new GitOutputParseError(
        FORMAT,
        "expected a tab before the path",
        reader.offset - 1,
      );
    }
    const path = reader.takeRest();
    if (path.byteLength === 0) {
      throw new GitOutputParseError(FORMAT, "index entry has an empty path");
    }
    if (!/^[0-7]{6}$/.test(mode)) {
      throw new GitOutputParseError(FORMAT, `unexpected file mode '${mode}'`);
    }
    if (stageField.length !== 1 || !/^[0-3]$/.test(stageField)) {
      throw new GitOutputParseError(FORMAT, `unexpected stage '${stageField}'`);
    }
    const stage = Number.parseInt(stageField, 10) as 0 | 1 | 2 | 3;
    entries.push({ mode, oid, stage, path, gitlink: mode === "160000" });
  }

  return entries;
}
