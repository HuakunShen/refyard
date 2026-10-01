/**
* | output |
* | --- |
* | "Commit" |
*
* @param {Commit_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_commit: ((inputs?: Commit_CommitInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_CommitInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_CommitInputs = {};
