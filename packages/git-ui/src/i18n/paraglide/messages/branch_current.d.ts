/**
* | output |
* | --- |
* | "Current branch" |
*
* @param {Branch_CurrentInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_current: ((inputs?: Branch_CurrentInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Branch_CurrentInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Branch_CurrentInputs = {};
