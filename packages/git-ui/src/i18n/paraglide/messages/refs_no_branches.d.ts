/**
* | output |
* | --- |
* | "No branches yet." |
*
* @param {Refs_No_BranchesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const refs_no_branches: ((inputs?: Refs_No_BranchesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Refs_No_BranchesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Refs_No_BranchesInputs = {};
