/**
* | output |
* | --- |
* | "Check for updates" |
*
* @param {Updates_CheckInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const updates_check: ((inputs?: Updates_CheckInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Updates_CheckInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Updates_CheckInputs = {};
