/**
* | output |
* | --- |
* | "e.g. worktrees/my-branch" |
*
* @param {Dialog_Worktree_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_worktree_placeholder: ((inputs?: Dialog_Worktree_PlaceholderInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Dialog_Worktree_PlaceholderInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Dialog_Worktree_PlaceholderInputs = {};
