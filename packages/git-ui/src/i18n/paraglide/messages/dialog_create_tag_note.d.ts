/**
* | output |
* | --- |
* | "Create a tag that points at this exact commit." |
*
* @param {Dialog_Create_Tag_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_create_tag_note: ((inputs?: Dialog_Create_Tag_NoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Create_Tag_NoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Create_Tag_NoteInputs = {};
