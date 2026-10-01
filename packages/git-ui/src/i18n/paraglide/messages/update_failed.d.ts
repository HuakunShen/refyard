/**
* | output |
* | --- |
* | "The update could not be installed" |
*
* @param {Update_FailedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const update_failed: ((inputs?: Update_FailedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Update_FailedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Update_FailedInputs = {};
