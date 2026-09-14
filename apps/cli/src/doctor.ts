/**
 * `refyard doctor` — what this machine can do, printed for a human or a script.
 *
 * The human output is grouped so the first thing a user sees is the verdict, and
 * the machine output is `--json`: the same report with the same field names as the
 * TypeScript type, so a script does not have to parse prose. Neither output
 * contains a path the user did not already know, a credential, or a guess about a
 * capability that was not probed.
 */
import { runDoctor, type DoctorReport } from "@refyard/host-node";

export interface DoctorCommandOptions {
  readonly json: boolean;
  readonly gitPath: string;
  readonly write: (line: string) => void;
}

export async function runDoctorCommand(
  options: DoctorCommandOptions,
): Promise<number> {
  const report = await runDoctor({ gitPath: options.gitPath });
  if (options.json) {
    options.write(JSON.stringify(toJson(report), null, 2));
    return report.executableFound ? 0 : 2;
  }

  options.write(`refyard doctor`);
  options.write(
    `  node: ${report.nodeVersion} (${report.platform} ${report.arch})`,
  );
  if (report.executableFound) {
    options.write(
      `  git:  ${report.gitVersion ?? "unknown version"} at ${report.gitPath}`,
    );
  } else {
    options.write(`  git:  not usable (${options.gitPath})`);
  }
  options.write(
    `  functional baseline: ${report.featureVersionSupported ? "met" : "not met"} (>= 2.43.0)`,
  );
  options.write(
    `  object formats: ${report.objectFormats.join(", ") || "none detected"}`,
  );
  options.write(`  machine formats:`);
  for (const probe of report.probes) {
    options.write(
      `    ${probe.supported ? "ok  " : "no  "} ${probe.name}: ${probe.detail}`,
    );
  }
  if (report.reasons.length > 0) {
    options.write(`  notes:`);
    for (const reason of report.reasons) {
      options.write(`    - ${reason}`);
    }
  }
  options.write(
    `  reads available: capabilities, repositories, status, history, refs,`,
  );
  options.write(`                   diff, worktrees, submodules, stashes`);
  options.write(`  mutations available: none in this build`);
  return report.executableFound ? 0 : 2;
}

/** The report as JSON, with the probe list flattened for `jq`-style use. */
export function toJson(report: DoctorReport): Record<string, unknown> {
  return {
    nodeVersion: report.nodeVersion,
    platform: report.platform,
    arch: report.arch,
    gitPath: report.gitPath,
    gitVersion: report.gitVersion,
    executableFound: report.executableFound,
    featureVersionSupported: report.featureVersionSupported,
    objectFormats: [...report.objectFormats],
    features: report.features,
    probes: report.probes.map((probe) => ({ ...probe })),
    reasons: [...report.reasons],
  };
}
