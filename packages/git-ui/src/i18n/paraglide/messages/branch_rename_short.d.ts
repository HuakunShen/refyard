/**
* | output |
* | --- |
* | "Rename" |
*
* @param {Branch_Rename_ShortInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_rename_short: ((inputs?: Branch_Rename_ShortInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Branch_Rename_ShortInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Branch_Rename_ShortInputs = {};
