/**
 * Host service: which execution target a session may use, and what the host can
 * offer around it.
 *
 * Deliberately narrow. There is no password, private key, key path, arbitrary
 * executable, raw argv, or remote shell text anywhere in this interface — a target
 * is selected by name and the host machine's own OpenSSH decides the rest. Choosing
 * a custom SSH config file is a trusted-host setting, so it never arrives as a
 * filesystem path from a remote page.
 */
import type {
  AcknowledgeUncertainOperationRequest,
  CliCommandInstall,
  CreateTargetRequest,
  ExecutionTargetSummary,
  HostCapabilities,
  LaunchRequest,
  OperationRecord,
  SshHostList,
} from "@refyard/git-contract";

export interface HostService {
  capabilities(): Promise<HostCapabilities>;
  sshHosts(): Promise<SshHostList>;
  targets(): Promise<readonly ExecutionTargetSummary[]>;
  createTarget(request: CreateTargetRequest): Promise<ExecutionTargetSummary>;
  disconnectTarget(targetId: string): Promise<void>;
  /**
   * Opens a real OS directory dialog. Native adapters only: an HTTP adapter reports
   * UnsupportedOperation so a browser falls back to `filesystemEntries` instead of
   * a control that can never work.
   */
  pickLocalDirectory(): Promise<string | null>;
  acknowledgeUncertainOperation(
    request: AcknowledgeUncertainOperationRequest,
  ): Promise<OperationRecord>;
  /**
   * The directories the host process was started with — `refyard <dir>` — answered once
   * per launch. Present only on a native adapter whose host has a command line; a browser
   * has none, and a caller opens those directories through the ordinary registration the
   * picker's answer uses.
   *
   * This is an offer, not an instruction: the directories are registered by the caller,
   * exactly like a dropped folder, and a refusal says which operand could not be used.
   */
  takeLaunchPaths?(): Promise<LaunchRequest>;
  /**
   * A second `refyard <dir>` while this app is running. Present only where the host can
   * receive one; the listener returns its own unsubscribe.
   */
  onLaunchPaths?(listener: (request: LaunchRequest) => void): () => void;
  /**
   * Installs the `refyard` command into a directory on the person's PATH.
   *
   * Present only where `capabilities().cliCommandInstaller` is true: the answer says where
   * the command was installed, whether that directory is on the host process's PATH, and —
   * when it is not — the line to add. Nothing outside the person's home is written.
   */
  installCliCommand?(): Promise<CliCommandInstall>;
  /**
   * Folders (or files) dragged onto the window, with the phase of the drag — the
   * shape a desktop webview reports and a browser cannot: a dropped folder arrives as
   * a full path, which is exactly what opening a repository needs. Present only on
   * adapters whose host can see the drop; a caller offers the affordance only when the
   * method exists.
   */
  onDragDropPaths?(
    listener: (
      event:
        | {
            readonly phase: "enter" | "over";
            readonly paths: readonly string[];
          }
        | { readonly phase: "leave" }
        | { readonly phase: "drop"; readonly paths: readonly string[] },
    ) => void,
  ): () => void;
}
