/**
 * The CLI's own version string.
 *
 * It is separate from the contract version on purpose: the CLI can be older or
 * newer than the service it talks to, and `GET /health` plus `GET /api/v1/capabilities`
 * are what a caller compares against, not this number.
 */
export const CLI_VERSION = "0.0.0-dev";
