/**
* | output |
* | --- |
* | "Rewrite the tip, same message" |
*
* @param {Commit_Rewrite_Tip_SameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_rewrite_tip_same: ((inputs?: Commit_Rewrite_Tip_SameInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Rewrite_Tip_SameInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Rewrite_Tip_SameInputs = {};
