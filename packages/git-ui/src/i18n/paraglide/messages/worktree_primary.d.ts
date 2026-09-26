/**
* | output |
* | --- |
* | "primary" |
*
* @param {Worktree_PrimaryInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_primary: ((inputs?: Worktree_PrimaryInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_PrimaryInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_PrimaryInputs = {};
