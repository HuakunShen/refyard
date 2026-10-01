/**
* | output |
* | --- |
* | "Check automatically when the app starts" |
*
* @param {Updates_Check_AutoInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const updates_check_auto: ((inputs?: Updates_Check_AutoInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Updates_Check_AutoInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Updates_Check_AutoInputs = {};
