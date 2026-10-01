/**
* | output |
* | --- |
* | "No worktrees loaded." |
*
* @param {Worktree_NoneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_none: ((inputs?: Worktree_NoneInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_NoneInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_NoneInputs = {};
