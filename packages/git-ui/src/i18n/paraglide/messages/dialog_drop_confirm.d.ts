/**
* | output |
* | --- |
* | "Drop \"{subject}\"" |
*
* @param {Dialog_Drop_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_drop_confirm: ((inputs: Dialog_Drop_ConfirmInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Drop_ConfirmInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Drop_ConfirmInputs = {
    subject: NonNullable<unknown>;
};
