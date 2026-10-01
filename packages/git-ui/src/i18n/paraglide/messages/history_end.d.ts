/**
* | output |
* | --- |
* | "End of the loaded history" |
*
* @param {History_EndInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_end: ((inputs?: History_EndInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<History_EndInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type History_EndInputs = {};
