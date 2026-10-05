/**
* | output |
* | --- |
* | "Sets upstream tracking, so later pushes and pulls go here without asking." |
*
* @param {Push_Upstream_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const push_upstream_note: ((inputs?: Push_Upstream_NoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Push_Upstream_NoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Push_Upstream_NoteInputs = {};
