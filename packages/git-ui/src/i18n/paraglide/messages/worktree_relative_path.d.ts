/**
* | output |
* | --- |
* | "relative/path" |
*
* @param {Worktree_Relative_PathInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_relative_path: ((inputs?: Worktree_Relative_PathInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_Relative_PathInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_Relative_PathInputs = {};
