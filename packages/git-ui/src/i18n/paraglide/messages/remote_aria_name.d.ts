/**
* | output |
* | --- |
* | "remote name" |
*
* @param {Remote_Aria_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_aria_name: ((inputs?: Remote_Aria_NameInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Remote_Aria_NameInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Remote_Aria_NameInputs = {};
