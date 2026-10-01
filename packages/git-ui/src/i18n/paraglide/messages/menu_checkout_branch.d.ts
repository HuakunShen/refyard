/**
* | output |
* | --- |
* | "Checkout" |
*
* @param {Menu_Checkout_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_checkout_branch: ((inputs?: Menu_Checkout_BranchInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Menu_Checkout_BranchInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Menu_Checkout_BranchInputs = {};
