/**
* | output |
* | --- |
* | "Cherry-pick commit" |
*
* @param {Cherry_Pick_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const cherry_pick_commit: ((inputs?: Cherry_Pick_CommitInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Cherry_Pick_CommitInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Cherry_Pick_CommitInputs = {};
