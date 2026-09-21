/**
 * Semantic validation — the rules JSON Schema cannot state.
 *
 * Every check here is a rule Git enforces later, or a rule the service enforces
 * because getting it wrong is unsafe. They are kept out of the Zod schemas so the
 * contract stays exportable to JSON Schema and so each rule can be tested by
 * itself, with the failure it prevents written down.
 *
 * Nothing in this module reads the host: byte counting is done in pure code and
 * no path is resolved here. Resolving a destination against an approved root is
 * the host's job, and this module's job is to reject what could never be valid.
 */
import { z } from "zod";
import {
  clientRequestIdSchema,
  pathIdSchema,
  previewTokenSchema,
  type ClientRequestId,
} from "./ids.js";
import { historyQuerySchema, type HistoryQuery } from "./reads.js";
import { createTargetRequestSchema, type CreateTargetRequest } from "./host.js";
import { LIMITS } from "./limits.js";
import {
  branchNameSchema,
  commitMessageSchema,
  fullRefNameSchema,
  remoteNameSchema,
  remoteUrlSchema,
  stashRefSchema,
  tagNameSchema,
} from "./names.js";
import {
  MUTATION_KINDS,
  OPERATION_SCHEMAS,
  targetKindsOf,
  type MutationKind,
} from "./operations.js";
import {
  MutationRequestSchema,
  type ParsedMutationRequest,
} from "./requests.js";
import { mutationTargetSchema, relativeDestinationSchema } from "./targets.js";
import {
  invalid,
  invalidMany,
  type ValidationProblem,
  type ValidationResult,
} from "./errors.js";

/** UTF-8 byte length without TextEncoder: the contract package has no host APIs. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate: a valid pair is four bytes, a lone one encodes as U+FFFD.
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function problem(message: string, path: string): ValidationProblem {
  return { code: "InvalidOperationPayload", message, path };
}

/**
 * Rules from `git check-ref-format`, applied to one name component (a branch or
 * tag name). Each message names the rule, because "invalid branch name" without
 * the reason forces a user to guess.
 */
function refNameComponentProblems(
  value: string,
  what: string,
  path: string,
): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const reject = (message: string) =>
    problems.push(problem(`${what} ${message}`, path));

  if (value.length === 0) {
    reject("must not be empty");
    return problems;
  }
  if (value === "@") reject('must not be the single character "@"');
  if (value.startsWith("-"))
    reject('must not start with "-" (it would be read as an option)');
  if (value.startsWith("/") || value.endsWith("/"))
    reject('must not start or end with "/"');
  if (value.endsWith(".")) reject('must not end with "."');
  if (value.toLowerCase().endsWith(".lock"))
    reject('must not end with ".lock"');
  if (value.includes("..")) reject('must not contain ".."');
  if (value.includes("@{")) reject('must not contain "@{"');
  if (value.includes("//")) reject('must not contain "//"');
  if (/[\u0000-\u0020\u007f]/.test(value))
    reject("must not contain control characters or spaces");
  if (/[~^:?*[\\]/.test(value)) reject("must not contain ~ ^ : ? * [ or \\");
  for (const component of value.split("/")) {
    if (component === "") reject("must not contain an empty path component");
    else if (component.startsWith("."))
      reject('must not have a path component starting with "."');
  }
  return problems;
}

export function validateBranchName(
  value: string,
  path = "operation.branchName",
): ValidationProblem[] {
  const shape = branchNameSchema.safeParse(value);
  if (!shape.success) {
    return shape.error.issues.map((issue) => problem(issue.message, path));
  }
  return refNameComponentProblems(value, "branch name", path);
}

export function validateTagName(
  value: string,
  path = "operation.tagName",
): ValidationProblem[] {
  const shape = tagNameSchema.safeParse(value);
  if (!shape.success) {
    return shape.error.issues.map((issue) => problem(issue.message, path));
  }
  return refNameComponentProblems(value, "tag name", path);
}

export function validateFullRefName(
  value: string,
  path: string,
): ValidationProblem[] {
  const shape = fullRefNameSchema.safeParse(value);
  if (!shape.success) {
    return shape.error.issues.map((issue) => problem(issue.message, path));
  }
  const problems = refNameComponentProblems(
    value.slice("refs/".length),
    "ref",
    path,
  );
  return problems;
}

export function validateRemoteName(
  value: string,
  path: string,
): ValidationProblem[] {
  const shape = remoteNameSchema.safeParse(value);
  if (!shape.success) {
    return shape.error.issues.map((issue) => problem(issue.message, path));
  }
  if (value.startsWith(".") || value.startsWith("-")) {
    return [problem('remote name must not start with "." or "-"', path)];
  }
  return [];
}

/**
 * A Windows absolute path: `C:\repos\app.git`, `C:/repos/app.git`, or a UNC share.
 *
 * A drive letter or a UNC prefix followed by a separator. `C:repos` (a path relative
 * to the drive's current directory) is deliberately not matched: it names a
 * different directory depending on where the caller is.
 */
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/\u0000-\u0020]+[\\/])/;

/**
 * Remote URLs and approved local paths.
 *
 * Only `https://`, `ssh://`, a scp-like `user@host:path`, or an absolute local
 * path are accepted. `ext::` and friends let a remote name run an arbitrary
 * command, so they are refused here rather than trusted to Git's configuration.
 *
 * "Absolute" covers Windows as well as POSIX. The check is a string shape rather
 * than a platform call, because this package has no host APIs: a drive-absolute
 * `C:\\repos\\app.git` / `C:/repos/app.git` and a UNC `\\\\server\\share\\app.git` are
 * accepted alongside `/srv/git/app.git`. Nothing is lost by that: a leading `-`
 * (an option), a `::` (a transport helper) and a control character or space are
 * refused before this point, so the shape can only be a path. Without it, a
 * Windows user could not add a local remote at all — the browser sends the path
 * the user picked, and a worked example of that (`C:\\...`) was refused while the
 * whole suite passed on macOS and Linux.
 */
export function validateRemoteUrl(
  value: string,
  path: string,
): ValidationProblem[] {
  const shape = remoteUrlSchema.safeParse(value);
  if (!shape.success) {
    return shape.error.issues.map((issue) => problem(issue.message, path));
  }
  // Most specific diagnosis first: a URL like `ext::sh -c whoami` also contains
  // spaces, and "no spaces" would hide the reason it is actually refused.
  if (value.startsWith("-")) {
    return [
      problem('must not start with "-" (it would be read as an option)', path),
    ];
  }
  if (value.includes("::")) {
    return [
      problem(
        "transport helper syntax (for example ext::) is not accepted; use https://, ssh:// or an approved local path",
        path,
      ),
    ];
  }
  if (/[\u0000-\u0020\u007f]/.test(value)) {
    return [problem("must not contain control characters or spaces", path)];
  }
  if (value.startsWith("/")) {
    return [];
  }
  if (WINDOWS_ABSOLUTE.test(value)) {
    return [];
  }
  const scpLike = /^[A-Za-z0-9._~%+-]+@[A-Za-z0-9._-]+:[^\u0000-\u0020]+$/;
  if (scpLike.test(value)) {
    return [];
  }
  if (value.startsWith("https://") || value.startsWith("ssh://")) {
    return [];
  }
  return [
    problem(
      "only https:// and ssh:// URLs, user@host:path remotes, or absolute local paths are accepted",
      path,
    ),
  ];
}

/**
 * A destination inside an approved root: relative, contained, and not something
 * Git would treat as metadata.
 */
export function validateRelativeDestination(
  value: string,
  path: string,
): ValidationProblem[] {
  const shape = relativeDestinationSchema.safeParse(value);
  if (!shape.success) {
    return shape.error.issues.map((issue) => problem(issue.message, path));
  }
  if (value.startsWith("/") || value.startsWith("\\")) {
    return [
      problem("must be relative to the approved root, not absolute", path),
    ];
  }
  if (/^[A-Za-z]:/.test(value)) {
    return [problem("must not start with a drive letter", path)];
  }
  const segments = value.split("/");
  for (const segment of segments) {
    if (segment === "")
      return [problem("must not contain empty path segments", path)];
    if (segment === "." || segment === "..") {
      return [problem('must not contain "." or ".." segments', path)];
    }
    if (segment === ".git") {
      return [problem('must not contain a ".git" path segment', path)];
    }
  }
  return [];
}

export function validateCommitMessage(
  value: string,
  path = "operation.message",
): ValidationProblem[] {
  const shape = commitMessageSchema.safeParse(value);
  if (!shape.success) {
    return shape.error.issues.map((issue) => problem(issue.message, path));
  }
  if (value.trim().length === 0) {
    return [problem("commit message must not be blank", path)];
  }
  const bytes = utf8ByteLength(value);
  if (bytes > LIMITS.commitMessageMaxBytes) {
    return [
      problem(
        `commit message is ${bytes} bytes; the limit is ${LIMITS.commitMessageMaxBytes}`,
        path,
      ),
    ];
  }
  return [];
}

/**
 * Paths and their preview tokens are positional. Equal length and unique entries
 * are what stop a shifted array from authorising the wrong file.
 */
export function validatePathSelection(
  pathIds: readonly string[],
  previewTokens: readonly string[],
  path = "operation",
): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  if (pathIds.length !== previewTokens.length) {
    problems.push(
      problem(
        `pathIds has ${pathIds.length} entries but previewTokens has ${previewTokens.length}; they must correspond one-to-one`,
        path,
      ),
    );
    return problems;
  }
  const seenPaths = new Set<string>();
  const seenTokens = new Set<string>();
  for (const [index, pathId] of pathIds.entries()) {
    if (!pathIdSchema.safeParse(pathId).success) {
      problems.push(
        problem(
          `pathIds[${index}] is not a path identifier minted by the host`,
          `${path}.pathIds`,
        ),
      );
    }
    if (seenPaths.has(pathId)) {
      problems.push(
        problem(`pathIds[${index}] repeats an earlier path`, `${path}.pathIds`),
      );
    }
    seenPaths.add(pathId);
  }
  for (const [index, token] of previewTokens.entries()) {
    if (!previewTokenSchema.safeParse(token).success) {
      problems.push(
        problem(
          `previewTokens[${index}] is not a preview token minted by the host`,
          `${path}.previewTokens`,
        ),
      );
    }
    if (seenTokens.has(token)) {
      problems.push(
        problem(
          `previewTokens[${index}] repeats an earlier token`,
          `${path}.previewTokens`,
        ),
      );
    }
    seenTokens.add(token);
  }
  return problems;
}

function validatePlainPathIds(
  pathIds: readonly string[],
  path: string,
): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const seen = new Set<string>();
  for (const [index, pathId] of pathIds.entries()) {
    if (!pathIdSchema.safeParse(pathId).success) {
      problems.push(
        problem(
          `pathIds[${index}] is not a path identifier minted by the host`,
          `${path}.pathIds`,
        ),
      );
    }
    if (seen.has(pathId)) {
      problems.push(
        problem(`pathIds[${index}] repeats an earlier path`, `${path}.pathIds`),
      );
    }
    seen.add(pathId);
  }
  return problems;
}

export function validateStashRef(
  oid: string,
  locator: string,
  path = "operation.stash",
): ValidationProblem[] {
  const shape = stashRefSchema.safeParse({ oid, locator });
  if (!shape.success) {
    return shape.error.issues.map((issue) =>
      problem(issue.message, `${path}.${issue.path.join(".")}`),
    );
  }
  return [];
}

/**
 * Operation-specific rules that depend on more than one field.
 *
 * Kept as one switch so a new operation cannot be added without either appearing
 * here or being explicitly listed as having no cross-field rules.
 */
export function validateOperationSemantics(
  operation: ParsedMutationRequest["operation"],
  target: ParsedMutationRequest["target"],
): ValidationProblem[] {
  switch (operation.kind) {
    case "initRepository":
      return operation.initialBranch === null
        ? []
        : validateBranchName(
            operation.initialBranch,
            "operation.initialBranch",
          );

    case "cloneRepository": {
      const problems = [
        ...validateRemoteUrl(operation.remoteUrl, "operation.remoteUrl"),
        ...validateRelativeDestination(
          operation.relativeDestination,
          "operation.relativeDestination",
        ),
      ];
      if (target.kind !== "workspace") {
        problems.push(
          problem("cloneRepository must address a workspace target", "target"),
        );
      }
      return problems;
    }

    case "stagePaths":
    case "discardTrackedPaths":
      return validatePathSelection(
        operation.pathIds,
        operation.previewTokens,
        "operation",
      );

    case "unstagePaths":
      return validatePlainPathIds(operation.pathIds, "operation");

    case "updateSubmodule":
    case "syncSubmodule":
      return validatePlainPathIds(operation.pathIds, "operation");

    case "commit":
      return validateCommitMessage(operation.message);

    case "amendCommit":
      return operation.message === null
        ? []
        : validateCommitMessage(operation.message);

    case "createBranch":
      return validateBranchName(operation.branchName);

    case "switchBranch":
    case "deleteBranch":
      return validateBranchName(operation.branchName);

    case "renameBranch":
      return [
        ...validateBranchName(operation.branchName, "operation.branchName"),
        ...validateBranchName(operation.newName, "operation.newName"),
        ...(operation.branchName === operation.newName
          ? [
              problem(
                "newName must differ from the current branch name",
                "operation.newName",
              ),
            ]
          : []),
      ];

    case "setBranchUpstream": {
      const problems = validateBranchName(operation.branchName);
      if (operation.upstream !== null) {
        problems.push(
          ...validateRemoteName(
            operation.upstream.remoteName,
            "operation.upstream.remoteName",
          ),
        );
        problems.push(
          ...validateBranchName(
            operation.upstream.branchName,
            "operation.upstream.branchName",
          ),
        );
      }
      return problems;
    }

    case "addRemote":
      return [
        ...validateRemoteName(operation.remoteName, "operation.remoteName"),
        ...validateRemoteUrl(operation.fetchUrl, "operation.fetchUrl"),
        ...(operation.pushUrl === null
          ? []
          : validateRemoteUrl(operation.pushUrl, "operation.pushUrl")),
      ];

    case "updateRemote": {
      const problems = validateRemoteName(
        operation.remoteName,
        "operation.remoteName",
      );
      if (
        operation.newName === null &&
        operation.fetchUrl === null &&
        operation.pushUrl === null
      ) {
        problems.push(
          problem(
            "at least one change is required: newName, fetchUrl, or pushUrl",
            "operation",
          ),
        );
      }
      if (operation.newName !== null) {
        problems.push(
          ...validateRemoteName(operation.newName, "operation.newName"),
        );
      }
      if (operation.fetchUrl !== null) {
        problems.push(
          ...validateRemoteUrl(operation.fetchUrl, "operation.fetchUrl"),
        );
      }
      if (operation.pushUrl !== null) {
        problems.push(
          ...validateRemoteUrl(operation.pushUrl, "operation.pushUrl"),
        );
      }
      return problems;
    }

    case "removeRemote":
      return validateRemoteName(operation.remoteName, "operation.remoteName");

    case "fetch":
      return validateRemoteName(operation.remoteName, "operation.remoteName");

    case "push":
      return [
        ...validateRemoteName(operation.remoteName, "operation.remoteName"),
        ...validateFullRefName(operation.sourceRef, "operation.sourceRef"),
        ...validateFullRefName(
          operation.destinationRef,
          "operation.destinationRef",
        ),
      ];

    case "pull":
      return validateRemoteName(operation.remoteName, "operation.remoteName");

    case "createStash":
      return operation.message === null
        ? []
        : validateCommitMessage(operation.message);

    case "applyStash":
    case "popStash":
    case "dropStash":
      return validateStashRef(operation.stash.oid, operation.stash.locator);

    case "createTag":
      return [
        ...validateTagName(operation.tagName),
        ...(operation.annotation === null
          ? []
          : validateCommitMessage(
              operation.annotation.message,
              "operation.annotation.message",
            )),
      ];

    case "deleteTag":
      return validateTagName(operation.tagName);

    case "pushTag":
      return [
        ...validateRemoteName(operation.remoteName, "operation.remoteName"),
        ...validateTagName(operation.tagName),
      ];

    case "createWorktree": {
      const problems = validateRelativeDestination(
        operation.relativeDestination,
        "operation.relativeDestination",
      );
      if (
        operation.reference.kind === "existingBranch" ||
        operation.reference.kind === "newBranch"
      ) {
        problems.push(
          ...validateBranchName(
            operation.reference.branchName,
            "operation.reference.branchName",
          ),
        );
      }
      return problems;
    }

    case "removeWorktree":
    case "lockWorktree":
    case "unlockWorktree":
      return [];

    case "addSubmodule":
      return [
        ...validateRemoteUrl(operation.remoteUrl, "operation.remoteUrl"),
        ...validateRelativeDestination(
          operation.relativePath,
          "operation.relativePath",
        ),
        ...(operation.branchName === null
          ? []
          : validateBranchName(operation.branchName, "operation.branchName")),
      ];

    case "merge":
      return operation.message === null
        ? []
        : validateCommitMessage(operation.message);

    case "continueMerge":
      return operation.message === null
        ? []
        : validateCommitMessage(operation.message);

    case "abortMerge":
      return [];

    case "revertCommit":
      // One object name, no cross-field rules: the oid schema already refuses
      // everything that is not a full object name, and there is no second field.
      return [];

    case "resetBranch":
      // The schema allows only the two modes that cannot lose content and one
      // object name; there is no second field to cross-check.
      return [];

    case "cherryPick":
      // One object name: the oid schema already refuses everything that is not
      // a full object name.
      return [];

    case "continueCherryPick":
      return [];

    case "abortCherryPick":
      return [];

    case "rebase":
      // One object name: the oid schema already refuses everything that is not
      // a full object name.
      return [];

    case "continueRebase":
      return [];

    case "abortRebase":
      return [];
  }
}

export interface ValidateMutationOptions {
  /**
   * Operation kinds this build actually implements. An operation declared in the
   * contract but not implemented here is `UnsupportedOperation`, not a silent
   * acceptance — that is how M1 refuses writes without pretending.
   */
  readonly supportedKinds?: readonly MutationKind[];
}

function issuesToProblems(
  error: z.ZodError,
  code: ValidationProblem["code"],
): ValidationProblem[] {
  return error.issues.map((issue) => {
    const path =
      issue.path.length === 0 ? undefined : issue.path.map(String).join(".");
    return path === undefined
      ? { code, message: issue.message }
      : { code, message: issue.message, path };
  });
}

const envelopeSchema = z.strictObject({
  clientRequestId: clientRequestIdSchema,
  target: z.unknown(),
  operation: z.unknown(),
});

/**
 * Validate one mutation request: envelope, target, operation, their pairing, and
 * the semantic rules above. Returns either the parsed request or every problem
 * found, so a UI can show them all instead of one at a time.
 */
export function validateMutationRequest(
  input: unknown,
  options: ValidateMutationOptions = {},
): ValidationResult<ParsedMutationRequest> {
  const envelope = envelopeSchema.safeParse(input);
  if (!envelope.success) {
    return invalidMany(issuesToProblems(envelope.error, "InvalidRequest"));
  }

  const operationKind = readOperationKind(envelope.data.operation);
  if (operationKind === null) {
    return invalid(
      "InvalidRequest",
      "operation must be an object with a known `kind`",
      "operation.kind",
    );
  }

  const supported = options.supportedKinds;
  if (supported !== undefined && !supported.includes(operationKind)) {
    return invalid(
      "UnsupportedOperation",
      `${operationKind} is not implemented by this service build`,
      "operation.kind",
    );
  }

  const target = mutationTargetSchema.safeParse(envelope.data.target);
  if (!target.success) {
    return invalidMany(issuesToProblems(target.error, "InvalidRequest"));
  }

  const allowedTargets = targetKindsOf(operationKind);
  if (!allowedTargets.includes(target.data.kind)) {
    return invalid(
      "InvalidOperationPayload",
      `${operationKind} cannot address a ${target.data.kind} target; it accepts ${allowedTargets.join(", ")}`,
      "target.kind",
    );
  }

  const parsed = MutationRequestSchema.safeParse(input);
  if (!parsed.success) {
    return invalidMany(issuesToProblems(parsed.error, "InvalidRequest"));
  }

  // Target-level rules apply to every operation that addresses a workspace: a
  // destination inside an approved root is relative, contained, and never a
  // `.git` path, whether it is a clone destination, an init location, or a new
  // worktree. Checking it here means a new workspace operation inherits the rule.
  const targetProblems =
    parsed.data.target.kind === "workspace"
      ? validateRelativeDestination(
          parsed.data.target.relativeDestination,
          "target.relativeDestination",
        )
      : [];
  const semantic = [
    ...targetProblems,
    ...validateOperationSemantics(parsed.data.operation, parsed.data.target),
  ];
  if (semantic.length > 0) {
    return invalidMany(semantic);
  }

  return { ok: true, value: parsed.data };
}

function readOperationKind(operation: unknown): MutationKind | null {
  if (
    typeof operation !== "object" ||
    operation === null ||
    !("kind" in operation)
  ) {
    return null;
  }
  const kind = operation.kind;
  if (typeof kind !== "string") {
    return null;
  }
  const known = MUTATION_KINDS.find((candidate) => candidate === kind);
  return known ?? null;
}

/** The operation kinds this contract declares — a guard for capability checks. */
export function isMutationKind(value: unknown): value is MutationKind {
  return (
    typeof value === "string" && MUTATION_KINDS.some((kind) => kind === value)
  );
}

/** Parse one operation payload against its own schema, for tests and journals. */
export function parseOperationPayload(
  kind: MutationKind,
  value: unknown,
): z.ZodSafeParseResult<unknown> {
  return OPERATION_SCHEMAS[kind].safeParse(value);
}

export type { ClientRequestId };

/** Validate and normalize a history request without resolving host authority. */
export function validateHistoryQuery(
  input: unknown,
): ValidationResult<HistoryQuery> {
  const parsed = historyQuerySchema.safeParse(input);
  if (!parsed.success)
    return invalidMany(issuesToProblems(parsed.error, "InvalidRequest"));
  const query = parsed.data;
  const problems: ValidationProblem[] = [];
  const reject = (message: string, path: string): void => {
    problems.push({ code: "InvalidRequest", message, path });
  };
  const filters = [
    "message",
    "author",
    "oidPrefix",
    "refFullName",
    "committedAfter",
    "committedBefore",
    "pathId",
  ];
  if (query.cursor !== undefined) {
    for (const field of filters) {
      if (Reflect.get(query, field) !== undefined)
        reject("a cursor continuation cannot redefine history filters", field);
    }
  }
  for (const [field, text] of Object.entries({
    message: query.message,
    author: query.author,
  })) {
    if (text === undefined) continue;
    if (/[\0\r\n]/.test(text))
      reject(
        "literal history searches must be a single line without NUL",
        field,
      );
    let scalars = 0;
    let unpairedSurrogate = false;
    for (const scalar of text.trim()) {
      const code = scalar.charCodeAt(0);
      if (scalar.length === 1 && code >= 0xd800 && code <= 0xdfff)
        unpairedSurrogate = true;
      scalars += 1;
    }
    if (unpairedSurrogate)
      reject(
        "literal history searches must not contain unpaired surrogates",
        field,
      );
    if (scalars < 1 || scalars > 512)
      reject(
        "literal history searches must contain 1–512 Unicode scalar values after trimming",
        field,
      );
  }
  if (query.refFullName !== undefined) {
    for (const finding of validateFullRefName(query.refFullName, "refFullName"))
      reject(finding.message, "refFullName");
  }
  if (query.oidPrefix !== undefined && query.pathId !== undefined)
    reject("object-id lookup cannot be combined with path history", "pathId");
  for (const [field, timestamp] of Object.entries({
    committedAfter: query.committedAfter,
    committedBefore: query.committedBefore,
  })) {
    if (timestamp !== undefined && !validCalendarTimestamp(timestamp))
      reject("must be a real UTC calendar instant", field);
  }
  if (
    query.committedAfter !== undefined &&
    query.committedBefore !== undefined &&
    normalizedTimestamp(query.committedAfter) >
      normalizedTimestamp(query.committedBefore)
  )
    reject(
      "committedAfter must not be later than committedBefore",
      "committedAfter",
    );
  if (problems.length > 0) return invalidMany(problems);
  return {
    ok: true,
    value: {
      ...query,
      ...(query.message === undefined ? {} : { message: query.message.trim() }),
      ...(query.author === undefined ? {} : { author: query.author.trim() }),
    },
  };
}

function normalizedTimestamp(timestamp: string): string {
  return timestamp.length === 20 ? `${timestamp.slice(0, -1)}.000Z` : timestamp;
}

function validCalendarTimestamp(timestamp: string): boolean {
  const year = Number(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(5, 7));
  const day = Number(timestamp.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (days[month - 1] ?? 0) &&
    Number(timestamp.slice(11, 13)) < 24 &&
    Number(timestamp.slice(14, 16)) < 60 &&
    Number(timestamp.slice(17, 19)) < 60
  );
}

/**
 * A token that may be handed to the local `ssh` as its single destination
 * argument.
 *
 * The character set is a safety property, not a style rule: a leading `-` would be
 * read as an option (`-oProxyCommand=…` runs a local command), whitespace would
 * split one argument into two, `*`/`?`/`!` would address more than one machine, and
 * shell metacharacters would matter the moment anyone interpolates the value into a
 * command string. An alias that fails here is refused before any process exists.
 */
const SSH_ALIAS_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/;

export function validateSshAlias(
  value: string,
  path = "manualAlias",
): ValidationProblem[] {
  if (!SSH_ALIAS_TOKEN.test(value)) {
    return [
      {
        // A host request, not a mutation payload: the caller sent a malformed
        // request rather than an unacceptable Git operation.
        code: "InvalidRequest",
        message:
          "must be a concrete ssh host alias: 1–128 characters of [A-Za-z0-9._:@+-], not starting with punctuation, with no whitespace, wildcard, or shell metacharacter",
        path,
      },
    ];
  }
  return [];
}

/**
 * Validates a target-creation request, including the manual alias it may carry.
 * The host resolves the alias through the real OpenSSH configuration; this check
 * only guarantees the value cannot become an option, a word split, or a pattern.
 */
export function validateCreateTargetRequest(
  input: unknown,
): ValidationResult<CreateTargetRequest> {
  const parsed = createTargetRequestSchema.safeParse(input);
  if (!parsed.success)
    return invalidMany(issuesToProblems(parsed.error, "InvalidRequest"));
  const request = parsed.data;
  if ("manualAlias" in request) {
    const problems = validateSshAlias(request.manualAlias);
    if (problems.length > 0) return invalidMany(problems);
  }
  return { ok: true, value: request };
}
