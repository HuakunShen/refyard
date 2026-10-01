/**
* | output |
* | --- |
* | "Revert commit" |
*
* @param {Revert_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const revert_commit: ((inputs?: Revert_CommitInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Revert_CommitInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Revert_CommitInputs = {};
