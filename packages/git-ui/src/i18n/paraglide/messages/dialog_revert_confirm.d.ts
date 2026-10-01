/**
* | output |
* | --- |
* | "Revert \"{subject}\"" |
*
* @param {Dialog_Revert_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_revert_confirm: ((inputs: Dialog_Revert_ConfirmInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Revert_ConfirmInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Revert_ConfirmInputs = {
    subject: NonNullable<unknown>;
};
