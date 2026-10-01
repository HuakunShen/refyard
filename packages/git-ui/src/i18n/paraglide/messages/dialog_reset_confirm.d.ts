/**
* | output |
* | --- |
* | "Reset branch" |
*
* @param {Dialog_Reset_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_reset_confirm: ((inputs?: Dialog_Reset_ConfirmInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Reset_ConfirmInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Reset_ConfirmInputs = {};
