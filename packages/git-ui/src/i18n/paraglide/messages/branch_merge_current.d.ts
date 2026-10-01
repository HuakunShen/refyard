/**
* | output |
* | --- |
* | "Merge into Current" |
*
* @param {Branch_Merge_CurrentInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_merge_current: ((inputs?: Branch_Merge_CurrentInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Branch_Merge_CurrentInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Branch_Merge_CurrentInputs = {};
