/**
* | output |
* | --- |
* | "No upstream" |
*
* @param {Branch_No_UpstreamInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_no_upstream: ((inputs?: Branch_No_UpstreamInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Branch_No_UpstreamInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Branch_No_UpstreamInputs = {};
