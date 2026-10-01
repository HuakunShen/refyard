/**
* | output |
* | --- |
* | "Create tag at {commit}" |
*
* @param {Dialog_Create_Tag_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_create_tag_title: ((inputs: Dialog_Create_Tag_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Create_Tag_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Create_Tag_TitleInputs = {
    commit: NonNullable<unknown>;
};
