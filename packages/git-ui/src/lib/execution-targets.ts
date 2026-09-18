/**
 * Execution-target choices: this machine, or a host the user's own SSH
 * configuration names.
 *
 * This module exists because two properties of the picker are easy to lose inside a
 * component: opening it reads exactly two things — what the host can do, and which
 * aliases its configuration lists — and it never connects to anything; and Local is
 * the default choice a previously chosen host cannot displace. The component calls
 * `loadTargetOptions` instead of the service, so both properties are asserted here
 * once rather than trusted there.
 *
 * A target is chosen by name throughout. Nothing in this file carries a credential,
 * a key, or a command: a candidate is a string the configuration mentioned, not a
 * machine that has been verified to exist.
 */
import type {
  HostCapabilities,
  SshHostCandidate,
  SshHostList,
} from "@refyard/git-contract";

/**
 * The narrow slice of `HostService` this module needs — the app injects its real
 * host service, a test injects a recording fake. Target creation, connection and
 * Git reads are absent by construction, which is what keeps "open the picker" a
 * read-only gesture no matter who wires it.
 */
export interface TargetDiscoveryPort {
  capabilities(): Promise<HostCapabilities>;
  sshHosts(): Promise<SshHostList>;
}

export interface LocalTargetOption {
  readonly kind: "local";
  readonly optionId: "local";
  readonly label: string;
  readonly description: string;
}

export interface SshTargetOption {
  readonly kind: "ssh-config";
  readonly optionId: string;
  readonly hostId: string;
  readonly sourceId: string;
  readonly alias: string;
  readonly label: string;
  readonly discoveryIncomplete: boolean;
}

export type ExecutionTargetOption = LocalTargetOption | SshTargetOption;

/**
 * What the picker reports when a choice is made. Connecting and creating the target
 * belong to the caller, which is where the SSH provider and its trust policy live.
 */
export type ExecutionTargetSelection =
  | { readonly kind: "local"; readonly label: string }
  | {
      readonly kind: "ssh-config";
      readonly hostId: string;
      readonly label: string;
    }
  | {
      readonly kind: "ssh-config-manual";
      readonly manualAlias: string;
      readonly label: string;
    };

export interface DiscoveryNotice {
  readonly summary: string;
  /** The host's own warnings, in the order it sent them. */
  readonly warnings: readonly string[];
}

export type TargetOptionsLoad =
  | {
      readonly kind: "ready";
      readonly capabilities: HostCapabilities;
      readonly hosts: SshHostList;
      readonly notice: DiscoveryNotice | null;
    }
  | {
      readonly kind: "unavailable";
      /**
       * The capability answer when the first read succeeded, null when it did not.
       * A failed *list* read still leaves this known, which is what lets the picker
       * keep offering This machine while saying the host list is unavailable.
       */
      readonly capabilities: HostCapabilities | null;
      readonly message: string;
    };

const LOCAL_LABEL = "This machine";
const LOCAL_DESCRIPTION = "Run Git against a repository on this machine.";
const INCOMPLETE_SUMMARY =
  "The host could not read all of its SSH configuration, so this list may be incomplete.";
/** The contract bounds `manualAlias` to this length; the field must fit it. */
const MANUAL_ALIAS_MAX = 128;

export function localTargetOption(): LocalTargetOption {
  return {
    kind: "local",
    optionId: "local",
    label: LOCAL_LABEL,
    description: LOCAL_DESCRIPTION,
  };
}

function sshTargetOption(candidate: SshHostCandidate): SshTargetOption {
  return {
    kind: "ssh-config",
    optionId: `host:${candidate.hostId}`,
    hostId: candidate.hostId,
    sourceId: candidate.sourceId,
    alias: candidate.alias,
    label: candidate.displayLabel,
    discoveryIncomplete: candidate.discoveryIncomplete,
  };
}

/** Local first, then the hosts in exactly the order the host listed them. */
export function targetOptionsFromList(
  hosts: SshHostList,
): ExecutionTargetOption[] {
  return [localTargetOption(), ...hosts.hosts.map(sshTargetOption)];
}

function targetOptionSearchText(option: ExecutionTargetOption): string {
  // The contract's candidate carries an opaque `sourceId`, not the path it was read
  // from, so the source identity a client can match on is that id.
  return option.kind === "local"
    ? `${option.label}\n${option.optionId}\n${option.description}`
    : `${option.alias}\n${option.label}\n${option.sourceId}`;
}

export function filterTargetOptions(
  options: readonly ExecutionTargetOption[],
  query: string,
): ExecutionTargetOption[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return [...options];
  return options.filter((option) =>
    targetOptionSearchText(option).toLocaleLowerCase().includes(needle),
  );
}

/**
 * Either half of the capability answer counts: a host may report the flag, the
 * target kind, or both, and a picker that only honoured one would hide the control
 * on a service that supports it.
 */
export function supportsSshTargets(capabilities: HostCapabilities): boolean {
  return (
    capabilities.sshConfig || capabilities.targetKinds.includes("ssh-config")
  );
}

export function discoveryNotice(hosts: SshHostList): DiscoveryNotice | null {
  const warnings = hosts.warnings.map((warning) => warning.message);
  const partial = hosts.hosts.some((host) => host.discoveryIncomplete);
  if (warnings.length === 0 && !partial) return null;
  return { summary: INCOMPLETE_SUMMARY, warnings };
}

export function selectionForOption(
  option: ExecutionTargetOption,
): ExecutionTargetSelection {
  return option.kind === "local"
    ? { kind: "local", label: option.label }
    : { kind: "ssh-config", hostId: option.hostId, label: option.label };
}

/**
 * A hand-entered alias for a host the enumeration could not read. It is trimmed and
 * length-checked to fit the contract field; whether an alias may reach a command at
 * all is the trusted host's validation, not the picker's.
 */
export function manualAliasSelection(
  alias: string,
): ExecutionTargetSelection | null {
  const trimmed = alias.trim();
  if (trimmed.length === 0 || trimmed.length > MANUAL_ALIAS_MAX) return null;
  return { kind: "ssh-config-manual", manualAlias: trimmed, label: trimmed };
}

export function targetSelectionLabel(
  selection: ExecutionTargetSelection | null,
): string {
  return selection === null ? LOCAL_LABEL : selection.label;
}

/**
 * Whether the picker should offer the manual alias entry: when the host admitted its
 * list is incomplete, or when it supports SSH targets but the list read failed.
 * Nothing is offered when the capability read itself failed, because then no answer
 * said SSH is possible here.
 */
export function manualAliasOfferable(load: TargetOptionsLoad): boolean {
  if (load.kind === "ready") return load.notice !== null;
  return load.capabilities !== null && supportsSshTargets(load.capabilities);
}

function targetProblemMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "the host did not explain why it could not read its SSH configuration";
}

/**
 * The one read opening the picker performs: the host's capabilities, then the SSH
 * host list. The host list is a file read on the host — it never contacts a server
 * and never executes configuration — and a failure is reported as `unavailable`
 * with the failure's own message, never as an empty list.
 */
export async function loadTargetOptions(
  port: TargetDiscoveryPort,
): Promise<TargetOptionsLoad> {
  let capabilities: HostCapabilities | null = null;
  try {
    capabilities = await port.capabilities();
    const hosts = await port.sshHosts();
    return {
      kind: "ready",
      capabilities,
      hosts,
      notice: discoveryNotice(hosts),
    };
  } catch (error) {
    return {
      kind: "unavailable",
      capabilities,
      message: targetProblemMessage(error),
    };
  }
}
