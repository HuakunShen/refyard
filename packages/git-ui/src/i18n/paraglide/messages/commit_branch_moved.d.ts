/**
* | output |
* | --- |
* | "The branch moved while you were reading" |
*
* @param {Commit_Branch_MovedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_branch_moved: ((inputs?: Commit_Branch_MovedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Commit_Branch_MovedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Commit_Branch_MovedInputs = {};
