/**
* | output |
* | --- |
* | "Delete {name}?" |
*
* @param {Dialog_Delete_Branch_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_delete_branch_title: ((inputs: Dialog_Delete_Branch_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Delete_Branch_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Delete_Branch_TitleInputs = {
    name: NonNullable<unknown>;
};
