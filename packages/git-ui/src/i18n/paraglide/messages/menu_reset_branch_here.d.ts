/**
* | output |
* | --- |
* | "Reset Branch to Here…" |
*
* @param {Menu_Reset_Branch_HereInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_reset_branch_here: ((inputs?: Menu_Reset_Branch_HereInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Menu_Reset_Branch_HereInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Menu_Reset_Branch_HereInputs = {};
