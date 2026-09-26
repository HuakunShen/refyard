/**
 * Finding the Git executable.
 *
 * `REFYARD_GIT` wins when it is set, because a user may have several Git builds and wants
 * the workbench to use a specific one. Otherwise the bare name `git` is used and the
 * operating system searches `PATH` — this program never guesses at absolute locations like
 * `/usr/bin/git`, which differ between systems and are frequently shadowed by a version
 * manager.
 *
 * It lives beside the other process concerns because every host that assembles a service
 * needs the same answer, and two hosts disagreeing about which Git is running would be a
 * difference in what the workbench can do.
 */
export function resolveGitPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env["REFYARD_GIT"];
  return configured !== undefined && configured.length > 0 ? configured : "git";
}
