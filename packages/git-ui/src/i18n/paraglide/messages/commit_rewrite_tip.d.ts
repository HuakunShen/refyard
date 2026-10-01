/**
* | output |
* | --- |
* | "Rewrite the tip commit" |
*
* @param {Commit_Rewrite_TipInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_rewrite_tip: ((inputs?: Commit_Rewrite_TipInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Rewrite_TipInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Rewrite_TipInputs = {};
