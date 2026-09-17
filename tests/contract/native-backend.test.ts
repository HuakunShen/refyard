/**
 * Contract cases for the native backend slice: the host kind a native service may
 * report, the target-aware capability query, the HostService shapes, and the rules
 * that keep credentials and raw exec inputs out of the public contract.
 */
import { describe, expect, it } from "vitest";
import {
  CONTRACT_SCHEMAS,
  CONTRACT_VERSION,
  acknowledgeUncertainOperationRequestSchema,
  capabilitiesQuerySchema,
  capabilitiesResponseSchema,
  createTargetRequestSchema,
  disconnectTargetRequestSchema,
  executionTargetSummarySchema,
  hostCapabilitiesSchema,
  registerRepositoryRequestSchema,
  repositorySummarySchema,
  sshHostListSchema,
  validateCreateTargetRequest,
} from "@refyard/git-contract";
import {
  validCapabilities,
  validExecutionTarget,
  validHostCapabilities,
  validSshHostList,
} from "../support/contract-factories.js";

describe("native host capability reporting", () => {
  it("accepts native capability kind without pretending to be node", () => {
    const value = validCapabilities({
      host: { kind: "rust", version: "0.1.0" },
    });
    expect(capabilitiesResponseSchema.safeParse(value).success).toBe(true);
  });

  it("still accepts the legacy node service it has to keep working with", () => {
    // A new UI that cannot read an older service would strand every existing install.
    const value = validCapabilities({ host: { kind: "node", version: "v26.8.2" } });
    expect(capabilitiesResponseSchema.safeParse(value).success).toBe(true);
  });

  it("refuses a host kind nobody can validate", () => {
    // An unknown kind means the UI cannot know which adapter produced the values.
    const value = { ...validCapabilities(), host: { kind: "python", version: "3" } };
    expect(capabilitiesResponseSchema.safeParse(value).success).toBe(false);
  });
});

describe("target-aware capability query", () => {
  it("keeps the legacy empty query working as the default local target", () => {
    expect(capabilitiesQuerySchema.safeParse({}).success).toBe(true);
  });

  it("accepts a selected execution target", () => {
    expect(capabilitiesQuerySchema.safeParse({ targetId: "tgt_abc123" }).success).toBe(
      true,
    );
  });

  it("accepts a selected repository", () => {
    expect(
      capabilitiesQuerySchema.safeParse({ repositoryId: "repo_abc123" }).success,
    ).toBe(true);
  });

  it("refuses a target query with an unvalidatable id", () => {
    // A free-form string would let a caller address something that is not a target.
    expect(capabilitiesQuerySchema.safeParse({ targetId: "../etc" }).success).toBe(false);
  });
});

describe("execution target creation", () => {
  it("accepts a local target", () => {
    expect(createTargetRequestSchema.safeParse({ kind: "local" }).success).toBe(true);
  });

  it("accepts a config host chosen from the catalogue", () => {
    const value = { kind: "ssh-config", hostId: "host_abc123" };
    expect(createTargetRequestSchema.safeParse(value).success).toBe(true);
  });

  it("accepts a manually entered alias with its config source", () => {
    const value = {
      kind: "ssh-config",
      sourceId: "source_abc123",
      manualAlias: "prod-bastion",
    };
    expect(createTargetRequestSchema.safeParse(value).success).toBe(true);
  });

  it("rejects raw credentials in target creation", () => {
    // The contract has no place for key material; accepting it would invite a UI
    // that collects a private key and hands it to the host as data.
    const value = {
      kind: "ssh-config",
      hostId: "host_abc123",
      privateKey: "not-a-key",
    };
    expect(createTargetRequestSchema.safeParse(value).success).toBe(false);
  });

  it("rejects a manual alias without the config source it was read from", () => {
    // Without a source, the alias would be resolved against an unknown file set.
    const value = { kind: "ssh-config", manualAlias: "prod-bastion" };
    expect(createTargetRequestSchema.safeParse(value).success).toBe(false);
  });

  it("rejects an ssh target that names a host and a manual alias at once", () => {
    const value = {
      kind: "ssh-config",
      hostId: "host_abc123",
      sourceId: "source_abc123",
      manualAlias: "prod-bastion",
    };
    expect(createTargetRequestSchema.safeParse(value).success).toBe(false);
  });

  it("rejects an unknown target kind", () => {
    expect(createTargetRequestSchema.safeParse({ kind: "ssh" }).success).toBe(false);
  });
});

describe("manual ssh alias validation", () => {
  const manual = (manualAlias: string) => ({ kind: "ssh-config", sourceId: "source_abc123", manualAlias });

  it("accepts a plain alias token", () => {
    expect(validateCreateTargetRequest(manual("prod-bastion")).ok).toBe(true);
  });

  it("refuses an alias that would be read as an ssh option", () => {
    // `ssh -oProxyCommand=…` is how an alias becomes an arbitrary local command.
    const result = validateCreateTargetRequest(manual("-oProxyCommand=curl"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems[0]?.code).toBe("InvalidRequest");
    }
  });

  it("refuses an alias containing shell metacharacters", () => {
    for (const alias of ["prod;rm -rf /", "prod$(id)", "prod`id`", "prod|tee", "prod&"]) {
      expect(validateCreateTargetRequest(manual(alias)).ok).toBe(false);
    }
  });

  it("refuses an alias containing whitespace or control characters", () => {
    for (const alias of ["prod host", "prod\thost", "prod\nhost", "prod\u0000host"]) {
      expect(validateCreateTargetRequest(manual(alias)).ok).toBe(false);
    }
  });

  it("refuses wildcard aliases because they are not one machine", () => {
    for (const alias of ["*.corp", "prod?", "!blocked"]) {
      expect(validateCreateTargetRequest(manual(alias)).ok).toBe(false);
    }
  });
});

describe("host service shapes", () => {
  it("reports host capabilities as booleans plus the target kinds it can create", () => {
    const value = validHostCapabilities({
      sshConfig: true,
      localFolderPicker: true,
      uncertainOperationAcknowledgement: true,
      targetKinds: ["local", "ssh-config"],
    });
    expect(hostCapabilitiesSchema.safeParse(value).success).toBe(true);
  });

  it("refuses a capability answer that claims a target kind nobody implements", () => {
    const value = { ...validHostCapabilities(), targetKinds: ["local", "xross"] };
    expect(hostCapabilitiesSchema.safeParse(value).success).toBe(false);
  });

  it("lists ssh hosts with their source and an incompleteness flag", () => {
    expect(sshHostListSchema.safeParse(validSshHostList()).success).toBe(true);
  });

  it("carries discovery warnings beside a possibly incomplete host list", () => {
    const value = validSshHostList({
      warnings: [{ code: "discoveryIncomplete", message: "conditional Include skipped" }],
      hosts: [
        {
          hostId: "host_FixtureOne",
          sourceId: "source_FixtureConfig",
          alias: "fixture-direct",
          displayLabel: "fixture-direct",
          discoveryIncomplete: true,
        },
      ],
    });
    expect(sshHostListSchema.safeParse(value).success).toBe(true);
  });

  it("summarises an execution target without exposing connection details", () => {
    const value = validExecutionTarget({ kind: "ssh-config", label: "fixture-direct" });
    expect(executionTargetSummarySchema.safeParse(value).success).toBe(true);
  });

  it("refuses a target summary that carries connection material", () => {
    const value = { ...validExecutionTarget(), privateKeyPath: "/home/user/.ssh/id_ed25519" };
    expect(executionTargetSummarySchema.safeParse(value).success).toBe(false);
  });

  it("requires only a targetId to disconnect", () => {
    expect(disconnectTargetRequestSchema.safeParse({ targetId: "tgt_abc123" }).success).toBe(
      true,
    );
    expect(disconnectTargetRequestSchema.safeParse({ targetId: "tgt_abc123", force: true }).success).toBe(
      false,
    );
  });
});

describe("acknowledging an uncertain operation", () => {
  const request = {
    operationId: "op_abc123",
    confirmedSnapshotId: "snap_abc123",
    confirmed: true,
  };

  it("accepts an explicit confirmation bound to a fresh snapshot", () => {
    expect(acknowledgeUncertainOperationRequestSchema.safeParse(request).success).toBe(true);
  });

  it("refuses a missing confirmation flag", () => {
    // Without `confirmed: true` the request is an accident, not a decision.
    const { confirmed: _confirmed, ...withoutFlag } = request;
    expect(acknowledgeUncertainOperationRequestSchema.safeParse(withoutFlag).success).toBe(
      false,
    );
  });

  it("refuses an unconfirmed acknowledgement", () => {
    expect(
      acknowledgeUncertainOperationRequestSchema.safeParse({ ...request, confirmed: false })
        .success,
    ).toBe(false);
  });

  it("refuses an acknowledgement that carries a result claim", () => {
    // A client cannot turn `unknown` into `succeeded` by asserting it.
    const value = { ...request, status: "succeeded" };
    expect(acknowledgeUncertainOperationRequestSchema.safeParse(value).success).toBe(false);
  });
});

describe("legacy compatibility of repository shapes", () => {
  const summary = {
    repositoryId: "repo_abc123",
    allowedRootId: "root_abc123",
    displayName: "repo",
    displayPath: "/tmp/repo",
    objectFormat: "sha1",
    worktreeIds: ["wt_abc123"],
    primaryWorktreeId: "wt_abc123",
    head: { kind: "born", branchName: "main", oid: "0".repeat(40), detached: false },
    operationInProgress: null,
    lastFetchedAt: null,
  };

  it("keeps a repository summary from a legacy node service valid", () => {
    expect(repositorySummarySchema.safeParse(summary).success).toBe(true);
  });

  it("allows a repository summary to name the target it belongs to", () => {
    expect(
      repositorySummarySchema.safeParse({ ...summary, targetId: "tgt_abc123" }).success,
    ).toBe(true);
  });

  it("keeps a legacy registration request valid", () => {
    expect(registerRepositoryRequestSchema.safeParse({ path: "/tmp/repo" }).success).toBe(
      true,
    );
  });

  it("allows registration against a named target", () => {
    const value = { path: "/srv/repo", targetId: "tgt_abc123" };
    expect(registerRepositoryRequestSchema.safeParse(value).success).toBe(true);
  });

  it("refuses a registration that smuggles in repository bytes or credentials", () => {
    const value = { path: "/tmp/repo", password: "hunter2" };
    expect(registerRepositoryRequestSchema.safeParse(value).success).toBe(false);
  });
});

describe("contract revision", () => {
  it("is the additive native revision of API major 1", () => {
    expect(CONTRACT_VERSION).toBe("1.2.0");
  });

  it("names every new host shape in the wire registry", () => {
    // A shape that is not registered never reaches the generated JSON Schema, so a
    // Rust implementation could not be validated against it.
    const expected: Readonly<Record<string, unknown>> = {
      HostCapabilities: hostCapabilitiesSchema,
      SshHostList: sshHostListSchema,
      ExecutionTargetSummary: executionTargetSummarySchema,
      CreateTargetRequest: createTargetRequestSchema,
      DisconnectTargetRequest: disconnectTargetRequestSchema,
      AcknowledgeUncertainOperationRequest: acknowledgeUncertainOperationRequestSchema,
    };
    for (const [name, schema] of Object.entries(expected)) {
      expect(CONTRACT_SCHEMAS[name]).toBe(schema);
    }
  });
});
