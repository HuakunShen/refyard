/**
* | output |
* | --- |
* | "Reset branch to here" |
*
* @param {Reset_Branch_HereInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const reset_branch_here: ((inputs?: Reset_Branch_HereInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Reset_Branch_HereInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Reset_Branch_HereInputs = {};
