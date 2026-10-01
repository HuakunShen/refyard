/**
* | output |
* | --- |
* | "new branch" |
*
* @param {Worktree_New_Branch_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_new_branch_label: ((inputs?: Worktree_New_Branch_LabelInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_New_Branch_LabelInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_New_Branch_LabelInputs = {};
