/**
 * Contract version constants.
 *
 * `API_MAJOR` is the number the browser checks before it will call a write
 * endpoint; a mismatch means the UI and the service do not share a contract and
 * the session is discarded rather than used. `CONTRACT_VERSION` moves for
 * additive changes inside the same major and is recorded in evidence and
 * `GET /capabilities` so a reported bug can name the exact schema revision.
 */
export const API_MAJOR = 1;

export const CONTRACT_VERSION = "1.0.0";
