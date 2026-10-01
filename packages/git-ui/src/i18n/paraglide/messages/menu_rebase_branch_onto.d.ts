/**
* | output |
* | --- |
* | "Rebase {branch} onto {upstream}" |
*
* @param {Menu_Rebase_Branch_OntoInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_rebase_branch_onto: ((inputs: Menu_Rebase_Branch_OntoInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Menu_Rebase_Branch_OntoInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Menu_Rebase_Branch_OntoInputs = {
    branch: NonNullable<unknown>;
    upstream: NonNullable<unknown>;
};
