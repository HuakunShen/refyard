/**
* | output |
* | --- |
* | "Squash \"{subject}\" into the commit below?" |
*
* @param {Dialog_Squash_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_squash_title: ((inputs: Dialog_Squash_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Squash_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Squash_TitleInputs = {
    subject: NonNullable<unknown>;
};
