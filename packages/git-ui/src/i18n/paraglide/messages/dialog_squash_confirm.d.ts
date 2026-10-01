/**
* | output |
* | --- |
* | "Squash" |
*
* @param {Dialog_Squash_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_squash_confirm: ((inputs?: Dialog_Squash_ConfirmInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Squash_ConfirmInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Squash_ConfirmInputs = {};
