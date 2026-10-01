/**
* | output |
* | --- |
* | "Delete {name}" |
*
* @param {Dialog_Delete_Branch_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_delete_branch_confirm: ((inputs: Dialog_Delete_Branch_ConfirmInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Delete_Branch_ConfirmInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Delete_Branch_ConfirmInputs = {
    name: NonNullable<unknown>;
};
