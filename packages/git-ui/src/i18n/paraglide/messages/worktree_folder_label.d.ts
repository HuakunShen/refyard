/**
* | output |
* | --- |
* | "Worktree folder, relative to the approved root" |
*
* @param {Worktree_Folder_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_folder_label: ((inputs?: Worktree_Folder_LabelInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Worktree_Folder_LabelInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Worktree_Folder_LabelInputs = {};
