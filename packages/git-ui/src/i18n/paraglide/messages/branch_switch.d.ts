/**
* | output |
* | --- |
* | "Switch" |
*
* @param {Branch_SwitchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_switch: ((inputs?: Branch_SwitchInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Branch_SwitchInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Branch_SwitchInputs = {};
