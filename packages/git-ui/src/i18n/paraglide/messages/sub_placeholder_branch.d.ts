/**
* | output |
* | --- |
* | "branch (tracked)" |
*
* @param {Sub_Placeholder_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sub_placeholder_branch: ((inputs?: Sub_Placeholder_BranchInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Sub_Placeholder_BranchInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Sub_Placeholder_BranchInputs = {};
