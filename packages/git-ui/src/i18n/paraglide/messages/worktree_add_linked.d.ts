/**
* | output |
* | --- |
* | "Add linked worktree" |
*
* @param {Worktree_Add_LinkedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_add_linked: ((inputs?: Worktree_Add_LinkedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_Add_LinkedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_Add_LinkedInputs = {};
