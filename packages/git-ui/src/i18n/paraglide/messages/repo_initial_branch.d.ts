/**
* | output |
* | --- |
* | "initial branch" |
*
* @param {Repo_Initial_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_initial_branch: ((inputs?: Repo_Initial_BranchInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Repo_Initial_BranchInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Repo_Initial_BranchInputs = {};
