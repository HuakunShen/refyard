/**
* | output |
* | --- |
* | "worktree reference kind" |
*
* @param {Worktree_Aria_Ref_KindInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_aria_ref_kind: ((inputs?: Worktree_Aria_Ref_KindInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_Aria_Ref_KindInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_Aria_Ref_KindInputs = {};
