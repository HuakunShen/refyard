/**
* | output |
* | --- |
* | "commit object name" |
*
* @param {Worktree_Commit_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_commit_aria: ((inputs?: Worktree_Commit_AriaInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_Commit_AriaInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_Commit_AriaInputs = {};
