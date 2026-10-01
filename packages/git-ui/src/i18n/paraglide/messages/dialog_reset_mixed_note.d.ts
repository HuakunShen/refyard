/**
* | output |
* | --- |
* | "Moves the branch and resets the index to the commit. Staged work becomes unstaged; every file keeps its content." |
*
* @param {Dialog_Reset_Mixed_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_reset_mixed_note: ((inputs?: Dialog_Reset_Mixed_NoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Reset_Mixed_NoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Reset_Mixed_NoteInputs = {};
