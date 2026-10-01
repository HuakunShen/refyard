/**
* | output |
* | --- |
* | "The two commits become one, combining \"{parent}\" and \"{subject}\". No content is lost." |
*
* @param {Dialog_Squash_Named_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_squash_named_note: ((inputs: Dialog_Squash_Named_NoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Squash_Named_NoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Squash_Named_NoteInputs = {
    parent: NonNullable<unknown>;
    subject: NonNullable<unknown>;
};
