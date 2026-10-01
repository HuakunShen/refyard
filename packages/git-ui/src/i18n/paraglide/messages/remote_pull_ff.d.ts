/**
* | output |
* | --- |
* | "Pull (ff-only)" |
*
* @param {Remote_Pull_FfInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_pull_ff: ((inputs?: Remote_Pull_FfInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Remote_Pull_FfInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Remote_Pull_FfInputs = {};
