/**
* | output |
* | --- |
* | "Create worktree from here" |
*
* @param {Worktree_From_HereInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_from_here: ((inputs?: Worktree_From_HereInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_From_HereInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_From_HereInputs = {};
