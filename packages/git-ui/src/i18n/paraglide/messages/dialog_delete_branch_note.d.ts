/**
* | output |
* | --- |
* | "Only fully merged branches can be deleted; unmerged work is refused by Git." |
*
* @param {Dialog_Delete_Branch_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_delete_branch_note: ((inputs?: Dialog_Delete_Branch_NoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Delete_Branch_NoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Delete_Branch_NoteInputs = {};
