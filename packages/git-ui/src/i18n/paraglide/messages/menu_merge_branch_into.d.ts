/**
* | output |
* | --- |
* | "Merge {source} into {target}" |
*
* @param {Menu_Merge_Branch_IntoInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_merge_branch_into: ((inputs: Menu_Merge_Branch_IntoInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Menu_Merge_Branch_IntoInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Menu_Merge_Branch_IntoInputs = {
    source: NonNullable<unknown>;
    target: NonNullable<unknown>;
};
