/**
* | output |
* | --- |
* | "Branch / Tag" |
*
* @param {History_Column_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_column_branch: ((inputs?: History_Column_BranchInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<History_Column_BranchInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type History_Column_BranchInputs = {};
