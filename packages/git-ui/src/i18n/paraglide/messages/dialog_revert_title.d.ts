/**
* | output |
* | --- |
* | "Revert \"{subject}\"?" |
*
* @param {Dialog_Revert_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_revert_title: ((inputs: Dialog_Revert_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Revert_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Revert_TitleInputs = {
    subject: NonNullable<unknown>;
};
