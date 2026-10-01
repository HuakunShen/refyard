/**
* | output |
* | --- |
* | "Cherry-Pick Commit…" |
*
* @param {Menu_Cherry_Pick_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_cherry_pick_commit: ((inputs?: Menu_Cherry_Pick_CommitInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Menu_Cherry_Pick_CommitInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Menu_Cherry_Pick_CommitInputs = {};
