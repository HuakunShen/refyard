/**
* | output |
* | --- |
* | "Commit SHA" |
*
* @param {Filters_Commit_ShaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_commit_sha: ((inputs?: Filters_Commit_ShaInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filters_Commit_ShaInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filters_Commit_ShaInputs = {};
