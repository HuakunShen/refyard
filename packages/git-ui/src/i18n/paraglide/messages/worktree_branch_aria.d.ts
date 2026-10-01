/**
* | output |
* | --- |
* | "branch this worktree works on" |
*
* @param {Worktree_Branch_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_branch_aria: ((inputs?: Worktree_Branch_AriaInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_Branch_AriaInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_Branch_AriaInputs = {};
