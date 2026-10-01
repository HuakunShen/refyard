/**
* | output |
* | --- |
* | "Upstream…" |
*
* @param {Branch_UpstreamInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_upstream: ((inputs?: Branch_UpstreamInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Branch_UpstreamInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Branch_UpstreamInputs = {};
