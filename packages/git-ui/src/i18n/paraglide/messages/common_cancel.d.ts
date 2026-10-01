/**
* | output |
* | --- |
* | "Cancel" |
*
* @param {Common_CancelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_cancel: ((inputs?: Common_CancelInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Common_CancelInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Common_CancelInputs = {};
