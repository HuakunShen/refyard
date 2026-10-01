/**
* | output |
* | --- |
* | "Create tag" |
*
* @param {Dialog_Create_Tag_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_create_tag_confirm: ((inputs?: Dialog_Create_Tag_ConfirmInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Create_Tag_ConfirmInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Create_Tag_ConfirmInputs = {};
