/**
* | output |
* | --- |
* | "Squash into Parent…" |
*
* @param {Menu_Squash_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_squash_commit: ((inputs?: Menu_Squash_CommitInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Menu_Squash_CommitInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Menu_Squash_CommitInputs = {};
