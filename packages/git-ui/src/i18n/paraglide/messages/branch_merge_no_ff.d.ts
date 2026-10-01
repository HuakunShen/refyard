/**
* | output |
* | --- |
* | "merge always creates a commit (--no-ff)" |
*
* @param {Branch_Merge_No_FfInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_merge_no_ff: ((inputs?: Branch_Merge_No_FfInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Branch_Merge_No_FfInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Branch_Merge_No_FfInputs = {};
