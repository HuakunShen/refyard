/**
* | output |
* | --- |
* | "Merge in" |
*
* @param {Branch_Merge_InInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_merge_in: ((inputs?: Branch_Merge_InInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Branch_Merge_InInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Branch_Merge_InInputs = {};
