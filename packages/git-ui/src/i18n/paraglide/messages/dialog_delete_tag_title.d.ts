/**
* | output |
* | --- |
* | "Delete tag {name}?" |
*
* @param {Dialog_Delete_Tag_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_delete_tag_title: ((inputs: Dialog_Delete_Tag_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Delete_Tag_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Delete_Tag_TitleInputs = {
    name: NonNullable<unknown>;
};
