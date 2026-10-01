/**
* | output |
* | --- |
* | "Copy Branch Name" |
*
* @param {Copy_Branch_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_branch_name: ((inputs?: Copy_Branch_NameInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Copy_Branch_NameInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Copy_Branch_NameInputs = {};
