/**
* | output |
* | --- |
* | "Clear" |
*
* @param {Common_ClearInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_clear: ((inputs?: Common_ClearInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Common_ClearInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Common_ClearInputs = {};
