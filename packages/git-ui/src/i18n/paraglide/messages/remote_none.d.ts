/**
* | output |
* | --- |
* | "No remotes configured." |
*
* @param {Remote_NoneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_none: ((inputs?: Remote_NoneInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Remote_NoneInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Remote_NoneInputs = {};
