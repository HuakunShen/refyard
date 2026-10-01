/**
* | output |
* | --- |
* | "Add remote" |
*
* @param {Remote_AddInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_add: ((inputs?: Remote_AddInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Remote_AddInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Remote_AddInputs = {};
