/**
* | output |
* | --- |
* | "Create worktree from \"{subject}\"?" |
*
* @param {Dialog_Worktree_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_worktree_title: ((inputs: Dialog_Worktree_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Worktree_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Worktree_TitleInputs = {
    subject: NonNullable<unknown>;
};
