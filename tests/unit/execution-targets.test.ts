/**
 * Execution-target choices in the launcher: this machine, or an SSH host candidate
 * read from the user's own configuration.
 *
 * The rule these tests protect is that opening the picker is a *read of two
 * answers* — what the host can do, and which aliases its configuration names — and
 * never a connection attempt. The recording fake below fails the moment the picker
 * grows a third call, which is exactly how "choosing a host" turns into "contacting
 * a host" without anyone noticing.
 */
import { describe, expect, it } from "vitest";
import type {
  HostCapabilities,
  SshHostCandidate,
  SshHostList,
} from "@refyard/git-contract";
import {
  discoveryNotice,
  filterTargetOptions,
  loadTargetOptions,
  manualAliasOfferable,
  manualAliasSelection,
  selectionForOption,
  supportsSshTargets,
  targetOptionsFromList,
  targetSelectionLabel,
  type TargetDiscoveryPort,
  type TargetOptionsLoad,
} from "@refyard/git-ui/lib/execution-targets";
import {
  validHostCapabilities,
  validSshHostList,
} from "../support/contract-factories.js";

const SSH_CAPABILITIES = validHostCapabilities({
  sshConfig: true,
  targetKinds: ["local", "ssh-config"],
});

function candidate(overrides: Partial<SshHostCandidate>): SshHostCandidate {
  const base: SshHostCandidate = {
    hostId: "host_Fixture",
    sourceId: "source_FixtureConfig",
    alias: "fixture",
    displayLabel: "fixture",
    discoveryIncomplete: false,
  };
  return { ...base, ...overrides };
}

function readyLoad(hosts: SshHostList): TargetOptionsLoad {
  return {
    kind: "ready",
    capabilities: SSH_CAPABILITIES,
    hosts,
    notice: discoveryNotice(hosts),
  };
}

function optionIds(options: readonly { optionId: string }[]): string[] {
  return options.map((option) => option.optionId);
}

describe("execution target options", () => {
  const list = validSshHostList({
    hosts: [
      candidate({
        hostId: "host_ProdWeb",
        alias: "prod-web-1",
        displayLabel: "Production web",
        sourceId: "source_Corp",
      }),
      candidate({
        hostId: "host_Staging",
        alias: "staging",
        displayLabel: "Staging",
        sourceId: "source_Home",
      }),
    ],
  });

  it("keeps This machine first and keeps the host list's own order", () => {
    // A host the list did not put first must not be promoted by sorting: the order
    // is the configuration's, and rearranging it invents a preference nobody set.
    expect(optionIds(targetOptionsFromList(list))).toEqual([
      "local",
      "host:host_ProdWeb",
      "host:host_Staging",
    ]);
  });

  it("offers Local as the default choice and never a remembered SSH host", () => {
    const options = targetOptionsFromList(list);
    const local = options[0];
    if (local === undefined) throw new Error("the local option is missing");
    expect(selectionForOption(local)).toEqual({
      kind: "local",
      label: "This machine",
    });
    // The launcher displays the label of whatever was chosen; with nothing chosen it
    // must say This machine rather than the last SSH host this session saw.
    expect(targetSelectionLabel(null)).toBe("This machine");
  });

  it("reports an SSH candidate as a selection without connecting to it", () => {
    const options = targetOptionsFromList(list);
    const host = options[1];
    if (host === undefined) throw new Error("the first host option is missing");
    expect(selectionForOption(host)).toEqual({
      kind: "ssh-config",
      hostId: "host_ProdWeb",
      label: "Production web",
    });
    expect(targetSelectionLabel(selectionForOption(host))).toBe(
      "Production web",
    );
  });

  it("filters by alias, display label and the source the DTO exposes", () => {
    // `SshHostCandidate` carries an opaque `sourceId`, not a config path: the
    // client-visible source identity is the id, so that is what search can use.
    const options = targetOptionsFromList(list);
    expect(optionIds(filterTargetOptions(options, "WEB-1"))).toEqual([
      "host:host_ProdWeb",
    ]);
    expect(optionIds(filterTargetOptions(options, "production"))).toEqual([
      "host:host_ProdWeb",
    ]);
    expect(optionIds(filterTargetOptions(options, "source_Home"))).toEqual([
      "host:host_Staging",
    ]);
    expect(optionIds(filterTargetOptions(options, "  "))).toEqual(
      optionIds(options),
    );
    expect(optionIds(filterTargetOptions(options, "machine"))).toEqual([
      "local",
    ]);
    expect(optionIds(filterTargetOptions(options, "nothing-matches"))).toEqual(
      [],
    );
  });

  it("accepts either capability shape as proof that SSH is available", () => {
    expect(supportsSshTargets(validHostCapabilities())).toBe(false);
    expect(supportsSshTargets(validHostCapabilities({ sshConfig: true }))).toBe(
      true,
    );
    expect(
      supportsSshTargets(
        validHostCapabilities({ targetKinds: ["local", "ssh-config"] }),
      ),
    ).toBe(true);
  });
});

describe("partial discovery", () => {
  it("shows the host's warnings and calls the list incomplete", () => {
    const warned = validSshHostList({
      warnings: [
        {
          code: "IncludeUnreadable",
          message: "could not read ~/.ssh/config.d/work",
        },
      ],
    });
    const notice = discoveryNotice(warned);
    expect(notice).not.toBeNull();
    expect(notice?.summary).toContain("may be incomplete");
    expect(notice?.warnings).toEqual(["could not read ~/.ssh/config.d/work"]);
    expect(manualAliasOfferable(readyLoad(warned))).toBe(true);
  });

  it("treats a partially discovered candidate as an incomplete list too", () => {
    // A candidate inside a conditional block is listed but not proven; presenting
    // it without the notice would claim the enumeration read more than it did.
    const partial = validSshHostList({
      hosts: [candidate({ discoveryIncomplete: true })],
    });
    expect(discoveryNotice(partial)).not.toBeNull();
    expect(manualAliasOfferable(readyLoad(partial))).toBe(true);
  });

  it("stays quiet when the host reported no gaps", () => {
    const complete = validSshHostList();
    expect(discoveryNotice(complete)).toBeNull();
    expect(manualAliasOfferable(readyLoad(complete))).toBe(false);
  });

  it("takes a manual alias only when it could name a host", () => {
    expect(manualAliasSelection("  ")).toBeNull();
    expect(manualAliasSelection("x".repeat(129))).toBeNull();
    expect(manualAliasSelection(" prod ")).toEqual({
      kind: "ssh-config-manual",
      manualAlias: "prod",
      label: "prod",
    });
  });
});

describe("opening the target picker", () => {
  it("reads exactly the capabilities and the SSH host list, in that order", async () => {
    const calls: string[] = [];
    const decoys = {
      async capabilities(): Promise<HostCapabilities> {
        calls.push("capabilities");
        return SSH_CAPABILITIES;
      },
      async sshHosts(): Promise<SshHostList> {
        calls.push("sshHosts");
        return validSshHostList();
      },
      // Present so the test fails if any of these ever runs during a load: a target
      // created or a Git read issued while merely browsing hosts would contact a
      // machine the user has not chosen.
      async targets(): Promise<readonly never[]> {
        calls.push("targets");
        return [];
      },
      async createTarget(): Promise<never> {
        calls.push("createTarget");
        throw new Error("unreachable");
      },
      async disconnectTarget(): Promise<void> {
        calls.push("disconnectTarget");
      },
    };
    const port: TargetDiscoveryPort = decoys;

    const load = await loadTargetOptions(port);

    expect(calls).toEqual(["capabilities", "sshHosts"]);
    expect(load.kind).toBe("ready");
  });

  it("reports a host that cannot list as unavailable, in the problem's words", async () => {
    const calls: string[] = [];
    const port: TargetDiscoveryPort = {
      async capabilities() {
        calls.push("capabilities");
        return SSH_CAPABILITIES;
      },
      async sshHosts() {
        calls.push("sshHosts");
        throw new Error(
          "this service predates execution targets, so it cannot list ssh hosts",
        );
      },
    };

    const load = await loadTargetOptions(port);

    expect(load.kind).toBe("unavailable");
    if (load.kind !== "unavailable") throw new Error("expected unavailable");
    expect(load.message).toBe(
      "this service predates execution targets, so it cannot list ssh hosts",
    );
    // The capability answer survived, so the picker can still offer This machine and
    // a hand-entered alias instead of pretending the machine list is empty.
    expect(load.capabilities).toEqual(SSH_CAPABILITIES);
    expect(manualAliasOfferable(load)).toBe(true);
  });

  it("does not call the host list when the capability read already failed", async () => {
    const calls: string[] = [];
    const port: TargetDiscoveryPort = {
      async capabilities() {
        calls.push("capabilities");
        throw new Error("the session was released");
      },
      async sshHosts(): Promise<SshHostList> {
        calls.push("sshHosts");
        return validSshHostList();
      },
    };

    const load = await loadTargetOptions(port);

    expect(calls).toEqual(["capabilities"]);
    expect(load.kind).toBe("unavailable");
    if (load.kind !== "unavailable") throw new Error("expected unavailable");
    expect(load.capabilities).toBeNull();
    expect(load.message).toBe("the session was released");
    // Without a capability answer the picker cannot honestly offer SSH at all, and a
    // manual alias must not appear as if the host had said it supports one.
    expect(manualAliasOfferable(load)).toBe(false);
  });

  it("uses a fallback message when a rejection carries no message", async () => {
    const port: TargetDiscoveryPort = {
      async capabilities(): Promise<HostCapabilities> {
        return SSH_CAPABILITIES;
      },
      async sshHosts(): Promise<SshHostList> {
        throw "not an error";
      },
    };

    const load = await loadTargetOptions(port);

    if (load.kind !== "unavailable") throw new Error("expected unavailable");
    expect(load.message.length).toBeGreaterThan(0);
  });
});
