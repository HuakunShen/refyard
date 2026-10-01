/**
* | output |
* | --- |
* | "worktree branch" |
*
* @param {Worktree_Aria_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_aria_branch: ((inputs?: Worktree_Aria_BranchInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_Aria_BranchInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_Aria_BranchInputs = {};
