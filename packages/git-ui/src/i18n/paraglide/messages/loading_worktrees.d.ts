/**
* | output |
* | --- |
* | "Reading worktrees…" |
*
* @param {Loading_WorktreesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const loading_worktrees: ((inputs?: Loading_WorktreesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Loading_WorktreesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Loading_WorktreesInputs = {};
