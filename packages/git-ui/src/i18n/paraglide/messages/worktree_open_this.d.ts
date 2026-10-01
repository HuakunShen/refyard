/**
* | output |
* | --- |
* | "Open this worktree" |
*
* @param {Worktree_Open_ThisInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_open_this: ((inputs?: Worktree_Open_ThisInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_Open_ThisInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_Open_ThisInputs = {};
