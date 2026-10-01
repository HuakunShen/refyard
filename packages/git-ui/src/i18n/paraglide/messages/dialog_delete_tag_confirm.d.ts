/**
* | output |
* | --- |
* | "Delete tag {name}" |
*
* @param {Dialog_Delete_Tag_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_delete_tag_confirm: ((inputs: Dialog_Delete_Tag_ConfirmInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Delete_Tag_ConfirmInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Delete_Tag_ConfirmInputs = {
    name: NonNullable<unknown>;
};
