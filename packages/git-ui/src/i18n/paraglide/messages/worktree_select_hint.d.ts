/**
* | output |
* | --- |
* | "Select a worktree below. Its changed files and commit message are on the right." |
*
* @param {Worktree_Select_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_select_hint: ((inputs?: Worktree_Select_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_Select_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_Select_HintInputs = {};
