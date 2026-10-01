/**
* | output |
* | --- |
* | "Create Worktree from Here…" |
*
* @param {Menu_Create_Worktree_HereInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_create_worktree_here: ((inputs?: Menu_Create_Worktree_HereInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Menu_Create_Worktree_HereInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Menu_Create_Worktree_HereInputs = {};
