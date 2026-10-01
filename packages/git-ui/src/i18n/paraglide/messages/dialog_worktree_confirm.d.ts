/**
* | output |
* | --- |
* | "Create worktree" |
*
* @param {Dialog_Worktree_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_worktree_confirm: ((inputs?: Dialog_Worktree_ConfirmInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Worktree_ConfirmInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Worktree_ConfirmInputs = {};
