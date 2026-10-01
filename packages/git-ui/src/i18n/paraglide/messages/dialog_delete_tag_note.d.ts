/**
* | output |
* | --- |
* | "The tag is removed from this repository. Pushed copies stay on the remote until pushed as a deletion." |
*
* @param {Dialog_Delete_Tag_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_delete_tag_note: ((inputs?: Dialog_Delete_Tag_NoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Delete_Tag_NoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Delete_Tag_NoteInputs = {};
