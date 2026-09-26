/**
* | output |
* | --- |
* | "new branch name" |
*
* @param {Worktree_New_Branch_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_new_branch_name: ((inputs?: Worktree_New_Branch_NameInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_New_Branch_NameInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_New_Branch_NameInputs = {};
