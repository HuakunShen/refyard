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

/**
 * 1.2.0 adds the native-host slice: the `rust` host kind, a target-aware
 * capability query, optional `targetId` on repository shapes, and the HostService
 * schemas. Every addition is optional from the point of view of a 1.1.0 client, so
 * a new UI can still read a legacy node service — within the same major.
 */
export const CONTRACT_VERSION = "1.2.0";
