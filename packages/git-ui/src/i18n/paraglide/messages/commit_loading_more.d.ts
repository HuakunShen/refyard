/**
* | output |
* | --- |
* | "Loading more…" |
*
* @param {Commit_Loading_MoreInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_loading_more: ((inputs?: Commit_Loading_MoreInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Loading_MoreInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Loading_MoreInputs = {};
