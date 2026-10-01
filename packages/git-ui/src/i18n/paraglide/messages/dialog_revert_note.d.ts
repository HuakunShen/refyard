/**
* | output |
* | --- |
* | "Creates a new commit that undoes this one, with Git's own revert message and your hooks running. Merge commits are refused, and if the revert conflicts with ..." |
*
* @param {Dialog_Revert_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_revert_note: ((inputs?: Dialog_Revert_NoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Revert_NoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Revert_NoteInputs = {};
