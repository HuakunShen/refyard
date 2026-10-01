/**
* | output |
* | --- |
* | "Drop \"{subject}\"?" |
*
* @param {Dialog_Drop_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_drop_title: ((inputs: Dialog_Drop_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Drop_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Drop_TitleInputs = {
    subject: NonNullable<unknown>;
};
