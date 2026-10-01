/**
* | output |
* | --- |
* | "Adds a linked worktree inside the approved root, with a new branch starting at this commit. Your checked-out branch and working tree stay where they are." |
*
* @param {Dialog_Worktree_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_worktree_note: ((inputs?: Dialog_Worktree_NoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Worktree_NoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Worktree_NoteInputs = {};
