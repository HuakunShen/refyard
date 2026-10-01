/**
* | output |
* | --- |
* | "Reset {branch} to \"{subject}\"?" |
*
* @param {Dialog_Reset_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_reset_title: ((inputs: Dialog_Reset_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Reset_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Reset_TitleInputs = {
    branch: NonNullable<unknown>;
    subject: NonNullable<unknown>;
};
