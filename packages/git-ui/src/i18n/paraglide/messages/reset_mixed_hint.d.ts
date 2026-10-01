/**
* | output |
* | --- |
* | "Mixed — unstage changes" |
*
* @param {Reset_Mixed_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const reset_mixed_hint: ((inputs?: Reset_Mixed_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Reset_Mixed_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Reset_Mixed_HintInputs = {};
