/**
* | output |
* | --- |
* | "No matching commits" |
*
* @param {No_Matching_CommitsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const no_matching_commits: ((inputs?: No_Matching_CommitsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<No_Matching_CommitsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type No_Matching_CommitsInputs = {};
