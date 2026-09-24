/**
* | output |
* | --- |
* | "Worktrees" |
*
* @param {Sidebar_WorktreesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_worktrees: ((inputs?: Sidebar_WorktreesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Sidebar_WorktreesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Sidebar_WorktreesInputs = {};
