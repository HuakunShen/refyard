/**
* | output |
* | --- |
* | "worktree commit" |
*
* @param {Worktree_Aria_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_aria_commit: ((inputs?: Worktree_Aria_CommitInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_Aria_CommitInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_Aria_CommitInputs = {};
