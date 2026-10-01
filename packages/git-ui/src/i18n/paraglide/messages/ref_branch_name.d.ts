/**
* | output |
* | --- |
* | "Branch name" |
*
* @param {Ref_Branch_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const ref_branch_name: ((inputs?: Ref_Branch_NameInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Ref_Branch_NameInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Ref_Branch_NameInputs = {};
