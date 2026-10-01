/**
* | output |
* | --- |
* | "Unlock" |
*
* @param {Worktree_UnlockInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_unlock: ((inputs?: Worktree_UnlockInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_UnlockInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_UnlockInputs = {};
