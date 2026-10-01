/**
* | output |
* | --- |
* | "Status unavailable" |
*
* @param {Copy_Status_UnavailableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_status_unavailable: ((inputs?: Copy_Status_UnavailableInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Copy_Status_UnavailableInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Copy_Status_UnavailableInputs = {};
