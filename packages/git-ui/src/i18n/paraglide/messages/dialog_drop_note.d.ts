/**
* | output |
* | --- |
* | "Removes this commit from the checked-out branch and replays the commits after it onto its parent — a history rewrite. A conflict stops it for you to resolve,..." |
*
* @param {Dialog_Drop_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_drop_note: ((inputs?: Dialog_Drop_NoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Drop_NoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Drop_NoteInputs = {};
