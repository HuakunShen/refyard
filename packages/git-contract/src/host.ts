/**
 * HostService shapes — who can execute, and where.
 *
 * These describe the *execution target* axis: this machine, or a host the service
 * read from the user's own SSH configuration. They deliberately carry no
 * connection material: there is no password, private key, key path, arbitrary
 * executable, or raw command anywhere in this module, because a target is chosen
 * by name and the host machine's OpenSSH decides the rest.
 */
import { z } from "zod";
import { problemSchema } from "./errors.js";
import {
  operationIdSchema,
  snapshotIdSchema,
  sshHostIdSchema,
  sshSourceIdSchema,
  targetGenerationSchema,
  targetIdSchema,
} from "./ids.js";

/**
 * Which runtime is serving the API. Reported, never inferred by a client: the UI
 * must not claim a node service is native (or the reverse) to unlock behaviour.
 */
export const hostKindSchema = z.enum(["node", "rust"]).meta({
  id: "HostKind",
  description:
    "The runtime answering this API. `rust` is the native host; `node` is the packaged service. Neither implies the other's capabilities.",
});

export const executionTargetKindSchema = z.enum(["local", "ssh-config"]).meta({
  id: "ExecutionTargetKind",
  description:
    "Where Git runs: this machine, or a specific host the user selected from their SSH configuration.",
});

export const executionTargetStateSchema = z
  .enum(["idle", "connecting", "ready", "unavailable"])
  .meta({
    id: "ExecutionTargetState",
    description:
      "Connection state of one execution target. Only `ready` may be read from; `unavailable` carries a problem, never an empty result.",
  });

/**
 * What the host can do about targets and machines. A browser-hosted UI reads this
 * to decide what to offer, so a false answer is a missing feature and never a
 * silently failing control.
 */
export const hostCapabilitiesSchema = z
  .strictObject({
    sshConfig: z.boolean(),
    localFolderPicker: z.boolean(),
    uncertainOperationAcknowledgement: z.boolean(),
    cliCommandInstaller: z.boolean(),
    targetKinds: z.array(executionTargetKindSchema),
  })
  .meta({
    id: "HostCapabilities",
    description:
      "Host-level abilities. `localFolderPicker` is true only where the host can open a real OS directory dialog; a browser must use the path picker instead. `cliCommandInstaller` is true only where this process can install the `refyard` command into the person's PATH, which is an ability of an installed desktop app.",
  });

export const hostWarningSchema = z
  .strictObject({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(512),
  })
  .meta({
    id: "HostWarning",
    description:
      "Something the host could not fully account for while answering — for example a conditional Include it will not evaluate. Warnings accompany partial answers; they are not errors.",
  });

export const sshHostCandidateSchema = z
  .strictObject({
    hostId: sshHostIdSchema,
    sourceId: sshSourceIdSchema,
    alias: z.string().min(1).max(128),
    displayLabel: z.string().min(1).max(256),
    discoveryIncomplete: z.boolean(),
  })
  .meta({
    id: "SshHostCandidate",
    description:
      "One concrete alias read from an SSH config source. It is a candidate, not a verified machine: nothing here proves the host exists, is reachable, or has the key the user thinks it has.",
  });

export const sshHostListSchema = z
  .strictObject({
    hosts: z.array(sshHostCandidateSchema),
    warnings: z.array(hostWarningSchema),
    revision: z.string().min(1).max(128),
  })
  .meta({
    id: "SshHostList",
    description:
      "Host aliases read from configuration files, with the revision of the source set they came from. Reading this never contacts a server and never executes configuration.",
  });

export const executionTargetSummarySchema = z
  .strictObject({
    targetId: targetIdSchema,
    kind: executionTargetKindSchema,
    label: z.string().min(1).max(256),
    state: executionTargetStateSchema,
    remotePathBrowse: z.boolean(),
    generation: targetGenerationSchema,
    /**
     * Why the target is not ready, when it is not. A client shows this instead of a
     * generic "unavailable": the probe's own reason (refused, timed out, no shell, no
     * Git) is the whole diagnostic.
     */
    problem: problemSchema.optional(),
  })
  .meta({
    id: "ExecutionTargetSummary",
    description:
      "One target a session can run Git against. `generation` changes when the target is rebuilt — a re-read of configuration, a reconnect — and invalidates snapshots, cursors and previews bound to the previous one.",
  });

export const createTargetRequestSchema = z
  .union([
    z.strictObject({ kind: z.literal("local") }),
    z.strictObject({
      kind: z.literal("ssh-config"),
      hostId: sshHostIdSchema,
    }),
    z.strictObject({
      kind: z.literal("ssh-config"),
      sourceId: sshSourceIdSchema,
      manualAlias: z.string().min(1).max(128),
    }),
  ])
  .meta({
    id: "CreateTargetRequest",
    description:
      "Selects where future Git work runs: this machine, a candidate from the host list, or a manually entered alias bound to the config source it should be read from. Credentials are never part of this request.",
  });

export const disconnectTargetRequestSchema = z
  .strictObject({ targetId: targetIdSchema })
  .meta({
    id: "DisconnectTargetRequest",
    description:
      "Releases one target this session owns. It must not tear down connections another session is still using.",
  });

export const acknowledgeUncertainOperationRequestSchema = z
  .strictObject({
    operationId: operationIdSchema,
    confirmedSnapshotId: snapshotIdSchema,
    confirmed: z.literal(true),
  })
  .meta({
    id: "AcknowledgeUncertainOperationRequest",
    description:
      "Lifts the write block an uncertain operation left behind, after the caller has re-read state and confirmed against a fresh snapshot. It never rewrites the uncertain operation's outcome.",
  });

/**
 * The directories a desktop host was started with — `refyard <dir>`.
 *
 * A native-only surface: a browser has no command line, and the HTTP service has no
 * process of its own to have been started with one. Every directory is absolute and was
 * resolved against the working directory the command ran in; a refusal carries the operand
 * exactly as it was written, so the window can quote it back instead of opening nothing
 * and saying nothing.
 */
export const launchRequestSchema = z
  .strictObject({
    directories: z.array(z.string().min(1)),
    refused: z.array(
      z.strictObject({
        named: z.string().min(1),
        problem: z.string().min(1),
      }),
    ),
  })
  .meta({
    id: "LaunchRequest",
    description:
      "What a desktop process was asked to open: absolute directories that exist, plus the operands that could not be used and why.",
  });

/** What installing the `refyard` command into the person's PATH did. */
export const cliCommandInstallSchema = z
  .strictObject({
    installed: z.boolean(),
    commandPath: z.string().min(1).nullable(),
    onPath: z.boolean(),
    message: z.string().min(1),
  })
  .meta({
    id: "CliCommandInstall",
    description:
      "The outcome of installing the `refyard` command. `installed` is true only when a command now exists at `commandPath`; `onPath` says whether that directory is on the host process's PATH, which a refusal explains in `message`.",
  });

export type HostKind = z.infer<typeof hostKindSchema>;
export type ExecutionTargetKind = z.infer<typeof executionTargetKindSchema>;
export type ExecutionTargetState = z.infer<typeof executionTargetStateSchema>;
export type HostCapabilities = z.infer<typeof hostCapabilitiesSchema>;
export type LaunchRequest = z.infer<typeof launchRequestSchema>;
export type CliCommandInstall = z.infer<typeof cliCommandInstallSchema>;
export type HostWarning = z.infer<typeof hostWarningSchema>;
export type SshHostCandidate = z.infer<typeof sshHostCandidateSchema>;
export type SshHostList = z.infer<typeof sshHostListSchema>;
export type ExecutionTargetSummary = z.infer<
  typeof executionTargetSummarySchema
>;
export type CreateTargetRequest = z.infer<typeof createTargetRequestSchema>;
export type DisconnectTargetRequest = z.infer<
  typeof disconnectTargetRequestSchema
>;
export type AcknowledgeUncertainOperationRequest = z.infer<
  typeof acknowledgeUncertainOperationRequestSchema
>;
