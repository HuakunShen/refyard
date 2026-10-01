/**
* | output |
* | --- |
* | "existing branch" |
*
* @param {Worktree_Existing_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_existing_branch: ((inputs?: Worktree_Existing_BranchInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_Existing_BranchInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_Existing_BranchInputs = {};
