/**
* | output |
* | --- |
* | "Loading the full message…" |
*
* @param {Commit_Loading_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_loading_message: ((inputs?: Commit_Loading_MessageInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Loading_MessageInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Loading_MessageInputs = {};
