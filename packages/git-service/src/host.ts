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
  CreateTargetRequest,
  ExecutionTargetSummary,
  HostCapabilities,
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
