/**
 * Typed factories for the public contract shapes used across tests.
 *
 * They build complete, schema-valid DTOs from the contract's own constants — a
 * fixture that is missing a required field fails in the factory, not in the
 * assertion that meant to test something else. Overrides are shallow and typed,
 * so a case can change only the field it is about.
 */
import {
  API_MAJOR,
  CONTRACT_VERSION,
  RUNTIME_LIMITS,
  type CapabilitiesResponse,
  type CreateTargetRequest,
  type ExecutionTargetSummary,
  type HostCapabilities,
  type SshHostList,
} from "@refyard/git-contract";

const SERVICE_INSTANCE = "srvc_FixtureInstance01";

/** A capabilities response from a host that implements the read-only slice. */
export function validCapabilities(
  overrides: Partial<CapabilitiesResponse> = {},
): CapabilitiesResponse {
  return {
    apiMajor: API_MAJOR,
    contractVersion: CONTRACT_VERSION,
    serviceInstanceId: SERVICE_INSTANCE,
    host: { kind: "node", version: "v26.8.2" },
    git: {
      executableDisplay: "/usr/bin/git",
      version: "2.50.1",
      features: {
        porcelainV2Status: true,
        worktreeListZ: true,
        catFileBatch: true,
        pushPorcelain: true,
        fetchPorcelain: true,
        objectFormats: ["sha1"],
      },
    },
    reads: ["capabilities", "repositories", "status", "history", "refs", "diff"],
    operations: [],
    limits: { ...RUNTIME_LIMITS },
    unavailable: [],
    ...overrides,
  };
}

export function validHostCapabilities(
  overrides: Partial<HostCapabilities> = {},
): HostCapabilities {
  return {
    sshConfig: false,
    localFolderPicker: false,
    uncertainOperationAcknowledgement: false,
    targetKinds: ["local"],
    ...overrides,
  };
}

export function validSshHostList(
  overrides: Partial<SshHostList> = {},
): SshHostList {
  return {
    hosts: [
      {
        hostId: "host_FixtureOne",
        sourceId: "source_FixtureConfig",
        alias: "fixture-direct",
        displayLabel: "fixture-direct",
        discoveryIncomplete: false,
      },
    ],
    warnings: [],
    revision: "rev-fixture-1",
    ...overrides,
  };
}

export function validExecutionTarget(
  overrides: Partial<ExecutionTargetSummary> = {},
): ExecutionTargetSummary {
  return {
    targetId: "tgt_FixtureLocal",
    kind: "local",
    label: "Local",
    state: "idle",
    remotePathBrowse: false,
    generation: "gen-1",
    ...overrides,
  };
}

export function validCreateTarget(): Extract<
  CreateTargetRequest,
  { kind: "local" }
> {
  return { kind: "local" };
}
