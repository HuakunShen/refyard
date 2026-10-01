/**
* | output |
* | --- |
* | "Create a branch that points at this exact commit without switching HEAD." |
*
* @param {Dialog_Create_Branch_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_create_branch_note: ((inputs?: Dialog_Create_Branch_NoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Create_Branch_NoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Create_Branch_NoteInputs = {};
