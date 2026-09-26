/**
* | output |
* | --- |
* | "lock reason (optional)" |
*
* @param {Worktree_Lock_ReasonInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_lock_reason: ((inputs?: Worktree_Lock_ReasonInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_Lock_ReasonInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_Lock_ReasonInputs = {};
