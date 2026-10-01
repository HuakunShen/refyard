/**
* | output |
* | --- |
* | "Soft — keep everything staged" |
*
* @param {Reset_Soft_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const reset_soft_hint: ((inputs?: Reset_Soft_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Reset_Soft_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Reset_Soft_HintInputs = {};
