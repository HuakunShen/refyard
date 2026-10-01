/**
* | output |
* | --- |
* | "The two commits become one, combining both changes. No content is lost." |
*
* @param {Dialog_Squash_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_squash_note: ((inputs?: Dialog_Squash_NoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Squash_NoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Squash_NoteInputs = {};
