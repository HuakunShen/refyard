/**
* | output |
* | --- |
* | "Reset branch to \"{subject}\"?" |
*
* @param {Dialog_Reset_Unnamed_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_reset_unnamed_title: ((inputs: Dialog_Reset_Unnamed_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Reset_Unnamed_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Reset_Unnamed_TitleInputs = {
    subject: NonNullable<unknown>;
};
