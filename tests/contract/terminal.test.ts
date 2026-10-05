/**
 * Contract tests: the terminal surface.
 *
 * The terminal is the one place where a shape mistake is not a broken panel but a
 * shell running somewhere the caller did not mean. These tests pin the frames both
 * transports speak — that a session id is host-minted, that a payload is bounded
 * base64 and nothing else, and that `capabilities.terminal` is optional so a host
 * without a PTY module can omit it while an older client still reads the answer.
 */
import { describe, expect, it } from "vitest";
import {
  CONTRACT_SCHEMAS,
  LIMITS,
  capabilitiesResponseSchema,
  terminalCloseRequestSchema,
  terminalExitFrameSchema,
  terminalInputRequestSchema,
  terminalOpenRequestSchema,
  terminalOpenResponseSchema,
  terminalOutputFrameSchema,
  terminalResizeRequestSchema,
} from "@refyard/git-contract";

const SESSION_ID = "term_abc123";
const REPOSITORY_ID = "repo_aaaaaaaaaaaaaaaa";

describe("terminal requests", () => {
  it("an open request names an approved repository and a bounded grid, nothing else", () => {
    const parsed = terminalOpenRequestSchema.parse({
      repositoryId: REPOSITORY_ID,
      cols: 80,
      rows: 24,
    });
    expect(parsed).toEqual({
      repositoryId: REPOSITORY_ID,
      cols: 80,
      rows: 24,
    });
    // The caller never names a shell, a path or an argument: a request that
    // carries one is rejected instead of silently obeyed.
    const smuggled = terminalOpenRequestSchema.safeParse({
      repositoryId: REPOSITORY_ID,
      cols: 80,
      rows: 24,
      shell: "/bin/sh",
    });
    expect(smuggled.success).toBe(false);
  });

  it("grid sizes outside a real terminal are refused before a pty exists", () => {
    expect(
      terminalOpenRequestSchema.safeParse({
        repositoryId: REPOSITORY_ID,
        cols: 1,
        rows: 24,
      }).success,
    ).toBe(false);
    expect(
      terminalOpenRequestSchema.safeParse({
        repositoryId: REPOSITORY_ID,
        cols: 80,
        rows: 501,
      }).success,
    ).toBe(false);
  });

  it("input payloads must be base64 and stay within the frame bound", () => {
    expect(
      terminalInputRequestSchema.parse({
        sessionId: SESSION_ID,
        data: "bHMgLWxhCg==",
      }).data,
    ).toBe("bHMgLWxhCg==");
    // Raw bytes are not transportable through JSON frames; a caller that sends
    // them is broken and must learn that here rather than emit shell gibberish.
    expect(
      terminalInputRequestSchema.safeParse({
        sessionId: SESSION_ID,
        data: "ls -la\n",
      }).success,
    ).toBe(false);
    const oversized = terminalInputRequestSchema.safeParse({
      sessionId: SESSION_ID,
      data: "A".repeat(LIMITS.terminalPayloadMaxBytes + 1),
    });
    expect(oversized.success).toBe(false);
  });

  it("resize and close carry only the session and their effect", () => {
    expect(
      terminalResizeRequestSchema.parse({
        sessionId: SESSION_ID,
        cols: 120,
        rows: 40,
      }),
    ).toEqual({ sessionId: SESSION_ID, cols: 120, rows: 40 });
    expect(terminalCloseRequestSchema.parse({ sessionId: SESSION_ID })).toEqual(
      { sessionId: SESSION_ID },
    );
  });

  it("session ids are host-minted term_ identifiers, not caller strings", () => {
    expect(
      terminalOpenResponseSchema.safeParse({
        sessionId: "my-terminal",
        shell: "/bin/zsh",
        cwd: "/tmp/repo",
      }).success,
    ).toBe(false);
    expect(
      terminalOpenResponseSchema.parse({
        sessionId: SESSION_ID,
        shell: "/bin/zsh",
        cwd: "/tmp/repo",
      }).sessionId,
    ).toBe(SESSION_ID);
  });
});

describe("terminal frames", () => {
  it("an output frame is tagged output with base64 bytes", () => {
    const parsed = terminalOutputFrameSchema.parse({
      kind: "output",
      sessionId: SESSION_ID,
      data: "aGVsbG8=",
    });
    expect(parsed.kind).toBe("output");
  });

  it("an exit frame carries the code, or null when the host ended the session", () => {
    expect(
      terminalExitFrameSchema.parse({
        kind: "exit",
        sessionId: SESSION_ID,
        exitCode: 0,
      }).exitCode,
    ).toBe(0);
    expect(
      terminalExitFrameSchema.parse({
        kind: "exit",
        sessionId: SESSION_ID,
        exitCode: null,
      }).exitCode,
    ).toBeNull();
    // A frame without its discriminant is not a frame either transport may send.
    expect(
      terminalExitFrameSchema.safeParse({
        sessionId: SESSION_ID,
        exitCode: 0,
      }).success,
    ).toBe(false);
  });
});

describe("capabilities.terminal", () => {
  it("is absent from a host without a PTY module, and an older client still parses it", () => {
    const withoutTerminal = capabilitiesResponseSchema.parse({
      apiMajor: 1,
      contractVersion: "1.3.0",
      serviceInstanceId: "srvc_abc",
      host: { kind: "node", version: "v26.8.2" },
      git: {
        executableDisplay: "/usr/bin/git",
        version: "2.51.0",
        features: {
          porcelainV2Status: true,
          worktreeListZ: true,
          catFileBatch: true,
          pushPorcelain: true,
          fetchPorcelain: true,
          objectFormats: ["sha1"],
        },
      },
      reads: [],
      operations: [],
      limits: {
        historyDefaultPageSize: 200,
        historyMaxPageSize: 500,
        patchMaxBytesPerFile: 1,
        patchMaxLinesPerFile: 1,
        objectMaxBytes: 1,
        logicalCacheMaxBytes: 1,
        previewTokenTtlSeconds: 1,
        readonlyDeadlineSeconds: 1,
        networkDeadlineSeconds: 1,
        hookDeadlineSeconds: 1,
        queuedOperationsPerActor: 1,
        concurrentGitProcesses: 1,
        concurrentReadersPerRepository: 1,
        eventRingMaxEvents: 1,
        eventRingMaxBytes: 1,
        pathSelectionMaxEntries: 1,
        historyTipsMax: 1,
        commitMessageMaxBytes: 1,
        branchNameMaxLength: 1,
      },
      unavailable: [],
    });
    expect(withoutTerminal.terminal).toBeUndefined();
  });

  it("a host with a PTY module advertises the shell it will run", () => {
    const shell = terminalCapabilityShell();
    expect(shell).toBe("/bin/zsh");
  });

  it("every terminal schema is registered so the generated bundle can reference it", () => {
    for (const name of [
      "TerminalSessionId",
      "TerminalCapability",
      "TerminalOpenRequest",
      "TerminalOpenResponse",
      "TerminalInputRequest",
      "TerminalResizeRequest",
      "TerminalCloseRequest",
      "TerminalOutputFrame",
      "TerminalExitFrame",
    ]) {
      expect(CONTRACT_SCHEMAS[name], `${name} is registered`).toBeDefined();
    }
  });
});

/** The smallest capabilities answer that carries `terminal`, parsed for its shell. */
function terminalCapabilityShell(): string {
  const parsed = capabilitiesResponseSchema.parse({
    apiMajor: 1,
    contractVersion: "1.3.0",
    serviceInstanceId: "srvc_abc",
    host: { kind: "node", version: "v26.8.2" },
    git: {
      executableDisplay: "/usr/bin/git",
      version: "2.51.0",
      features: {
        porcelainV2Status: true,
        worktreeListZ: true,
        catFileBatch: true,
        pushPorcelain: true,
        fetchPorcelain: true,
        objectFormats: ["sha1"],
      },
    },
    reads: [],
    operations: [],
    limits: {
      historyDefaultPageSize: 200,
      historyMaxPageSize: 500,
      patchMaxBytesPerFile: 1,
      patchMaxLinesPerFile: 1,
      objectMaxBytes: 1,
      logicalCacheMaxBytes: 1,
      previewTokenTtlSeconds: 1,
      readonlyDeadlineSeconds: 1,
      networkDeadlineSeconds: 1,
      hookDeadlineSeconds: 1,
      queuedOperationsPerActor: 1,
      concurrentGitProcesses: 1,
      concurrentReadersPerRepository: 1,
      eventRingMaxEvents: 1,
      eventRingMaxBytes: 1,
      pathSelectionMaxEntries: 1,
      historyTipsMax: 1,
      commitMessageMaxBytes: 1,
      branchNameMaxLength: 1,
    },
    unavailable: [],
    terminal: { shell: "/bin/zsh" },
  });
  return parsed.terminal?.shell ?? "";
}
