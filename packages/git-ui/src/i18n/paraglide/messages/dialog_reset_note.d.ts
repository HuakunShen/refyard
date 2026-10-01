/**
* | output |
* | --- |
* | "Moves the checked-out branch to this commit. The working tree is never touched and no content is lost." |
*
* @param {Dialog_Reset_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_reset_note: ((inputs?: Dialog_Reset_NoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Reset_NoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Reset_NoteInputs = {};
