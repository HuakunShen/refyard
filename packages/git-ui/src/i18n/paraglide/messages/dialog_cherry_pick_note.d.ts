/**
* | output |
* | --- |
* | "Applies this commit's change onto your checked-out branch as a new commit, keeping the original message and author. A conflict stops it for you to resolve, l..." |
*
* @param {Dialog_Cherry_Pick_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_cherry_pick_note: ((inputs?: Dialog_Cherry_Pick_NoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Cherry_Pick_NoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Cherry_Pick_NoteInputs = {};
