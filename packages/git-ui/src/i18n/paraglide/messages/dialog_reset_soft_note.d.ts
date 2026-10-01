/**
* | output |
* | --- |
* | "Moves the branch and leaves the index exactly as it is, so the same changes stay staged on top of the new head." |
*
* @param {Dialog_Reset_Soft_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_reset_soft_note: ((inputs?: Dialog_Reset_Soft_NoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Reset_Soft_NoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Reset_Soft_NoteInputs = {};
