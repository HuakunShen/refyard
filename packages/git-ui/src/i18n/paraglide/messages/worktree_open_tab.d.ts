/**
* | output |
* | --- |
* | "Open worktree in new tab" |
*
* @param {Worktree_Open_TabInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_open_tab: ((inputs?: Worktree_Open_TabInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_Open_TabInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_Open_TabInputs = {};
