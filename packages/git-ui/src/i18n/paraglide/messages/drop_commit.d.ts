/**
* | output |
* | --- |
* | "Drop commit" |
*
* @param {Drop_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const drop_commit: ((inputs?: Drop_CommitInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Drop_CommitInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Drop_CommitInputs = {};
