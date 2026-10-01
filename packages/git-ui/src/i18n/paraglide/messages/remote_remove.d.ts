/**
* | output |
* | --- |
* | "Remove remote" |
*
* @param {Remote_RemoveInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_remove: ((inputs?: Remote_RemoveInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Remote_RemoveInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Remote_RemoveInputs = {};
