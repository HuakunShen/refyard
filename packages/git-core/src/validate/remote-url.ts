/**
 * Pure safety checks for URLs already present in Git configuration.
 *
 * The public request validator lives in `git-contract`, but portable core cannot
 * import that runtime package: the neutral bundle must not pull Zod or a host
 * module into the Git engine. These checks therefore mirror the same closed URL
 * grammar using only string operations, and return one bounded diagnostic rather
 * than a contract problem object.
 */

const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/\u0000-\u0020]+[\\/])/;
const SCP_LIKE = /^[A-Za-z0-9._~%+-]+@[A-Za-z0-9._-]+:[^\u0000-\u0020]+$/;

/** Return the reason a configured URL must be refused, or null when it is safe. */
export function unsafeRemoteUrlReason(value: string): string | null {
  if (value.length === 0) {
    return "must not be empty";
  }
  if (value.length > 2048) {
    return "must not exceed 2048 characters";
  }
  if (value.startsWith("-")) {
    return 'must not start with "-" (it would be read as an option)';
  }
  if (value.includes("::")) {
    return "transport helper syntax (for example ext::) is not accepted";
  }
  if (/[\u0000-\u0020\u007f]/.test(value)) {
    return "must not contain control characters or spaces";
  }
  if (value.startsWith("/") || WINDOWS_ABSOLUTE.test(value)) {
    return null;
  }
  if (SCP_LIKE.test(value)) {
    return null;
  }
  if (value.startsWith("https://") || value.startsWith("ssh://")) {
    return null;
  }
  return "only https:// and ssh:// URLs, scp-like remotes, or absolute local paths are accepted";
}
