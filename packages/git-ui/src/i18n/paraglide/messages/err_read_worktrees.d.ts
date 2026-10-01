/**
* | output |
* | --- |
* | "Could not read worktrees" |
*
* @param {Err_Read_WorktreesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_read_worktrees: ((inputs?: Err_Read_WorktreesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Err_Read_WorktreesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Err_Read_WorktreesInputs = {};
